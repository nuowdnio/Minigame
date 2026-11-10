import { Vector3 } from 'three';
import { PerlinNoise } from './noise';

export interface WindParams {
  /** Mittlere Windgeschwindigkeit in 10 m Höhe (m/s). */
  speed: number;
  /** Richtung, AUS der der Wind kommt (Grad, 0 = Norden = −z, 90 = Osten = +x). */
  directionDeg: number;
  /** Turbulenz-Skalierung: 0 = laminar, 1 = natürliche Grenzschicht-Turbulenz, 2 = sehr böig. */
  turbulence: number;
  /** Rauigkeitslänge des Geländes (m): 0.0002 Wasser, 0.03 Wiese, 0.5 Wald, 1+ Stadt. */
  roughness: number;
  /** Thermik-Stärke (m/s Aufwind im Kern), 0 = aus. */
  thermalStrength: number;
  seed: number;
}

/** Hindernis für Windschatten (achsenparalleler Quader). */
export interface WindObstacle {
  min: Vector3;
  max: Vector3;
}

interface Thermal {
  x: number;
  z: number;
  radius: number;
  strength: number;
  phase: number;
  period: number;
}

const REF_HEIGHT = 10;

/** Logarithmisches Windprofil der bodennahen Grenzschicht. */
export function logWindProfile(height: number, speedAt10m: number, roughness: number): number {
  if (height <= roughness) return 0;
  return (speedAt10m * Math.log(height / roughness)) / Math.log(REF_HEIGHT / roughness);
}

/**
 * Windfeld:
 *  - mittlerer Wind mit logarithmischem Höhenprofil (Bodenreibung)
 *  - Turbulenz als "eingefrorenes" fraktales Rauschfeld, das mit dem Wind mitgeführt wird
 *    (Taylor-Hypothese); Intensität σ ≈ 2.5·u* wie in der Grenzschicht, Längenskala wächst mit der Höhe
 *  - Böen-Hüllkurve (langsam schwankende Turbulenzstärke)
 *  - Windschatten und Verwirbelung hinter Hindernissen (Lee-Zone ≈ 10 Hindernishöhen)
 *  - Thermikschläuche mit Aufwind im Kern und Abwind am Rand, mit dem Wind driftend
 *  - Vertikalwind verschwindet am Boden
 */
export class WindField {
  private readonly noise: PerlinNoise;
  private readonly gustNoise: PerlinNoise;
  private readonly thermals: Thermal[] = [];
  readonly direction = new Vector3();
  private readonly cross = new Vector3();

  constructor(
    public params: WindParams,
    public obstacles: WindObstacle[] = [],
    public groundY = 0,
  ) {
    this.noise = new PerlinNoise(params.seed);
    this.gustNoise = new PerlinNoise(params.seed + 101);
    this.setParams(params);
    // Thermik-Quellen (deterministisch aus dem Seed)
    let s = params.seed * 7919 + 13;
    const rnd = () => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 6; i++) {
      this.thermals.push({
        x: (rnd() - 0.5) * 900,
        z: (rnd() - 0.5) * 900,
        radius: 25 + rnd() * 35,
        strength: 0.6 + rnd() * 0.8,
        phase: rnd() * Math.PI * 2,
        period: 240 + rnd() * 300,
      });
    }
  }

  setParams(p: WindParams): void {
    this.params = p;
    const th = (p.directionDeg * Math.PI) / 180;
    // Windvektor zeigt dorthin, wohin die Luft strömt
    this.direction.set(-Math.sin(th), 0, Math.cos(th));
    this.cross.set(-this.direction.z, 0, this.direction.x);
  }

  /** Mittlerer Wind (ohne Turbulenz) in einer Höhe über Grund. */
  meanSpeed(height: number): number {
    return logWindProfile(Math.max(height, 0), this.params.speed, this.params.roughness);
  }

  /** Windschatten-Faktor 0..1 (1 = voll im Lee eines Hindernisses). */
  shelter(p: Vector3): number {
    const d = this.direction;
    let best = 0;
    for (const b of this.obstacles) {
      const h = b.max.y - this.groundY;
      if (p.y > b.max.y + 0.5 * h || h < 0.5) continue;
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      const hx = (b.max.x - b.min.x) / 2;
      const hz = (b.max.z - b.min.z) / 2;
      const rx = p.x - cx;
      const rz = p.z - cz;
      const along = rx * d.x + rz * d.z;
      const halfAlong = Math.abs(hx * d.x) + Math.abs(hz * d.z);
      if (along < halfAlong * 0.5) continue;
      const wakeLen = 10 * h;
      const behind = along - halfAlong;
      if (behind > wakeLen) continue;
      const across = Math.abs(rx * this.cross.x + rz * this.cross.z);
      const halfAcross = Math.abs(hx * this.cross.x) + Math.abs(hz * this.cross.z);
      const spread = halfAcross + 0.15 * Math.max(0, behind);
      if (across > spread) continue;
      const lengthFade = 1 - Math.max(0, behind) / wakeLen;
      const heightFade = Math.min(1, Math.max(0, (b.max.y + 0.5 * h - p.y) / h));
      const edgeFade = Math.min(1, (spread - across) / Math.max(0.5, 0.3 * spread));
      const s = lengthFade * heightFade * edgeFade;
      if (s > best) best = s;
    }
    return best;
  }

  /** Vertikaler Thermik-Wind (m/s) an einem Ort. */
  thermal(p: Vector3, t: number, height: number, mean: number): number {
    const strength = this.params.thermalStrength;
    if (strength <= 0 || height < 1) return 0;
    let w = 0;
    const d = this.direction;
    for (const th of this.thermals) {
      // Schlauch driftet mit dem Wind und neigt sich mit der Höhe
      const drift = (t * mean * 0.7) % 1200;
      const cx = th.x + d.x * drift;
      const cz = th.z + d.z * drift;
      const r = Math.hypot(p.x - cx, p.z - cz);
      if (r > th.radius * 3) continue;
      const life = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / th.period + th.phase);
      const core = Math.exp(-(r * r) / (th.radius * th.radius));
      const ring = Math.exp(-((r - 1.6 * th.radius) ** 2) / (0.5 * th.radius * th.radius));
      const develop = Math.min(1, height / 40);
      w += strength * th.strength * life * develop * (core - 0.25 * ring);
    }
    return w;
  }

  /**
   * Windgeschwindigkeit (Welt, m/s) am Ort p zur Zeit t.
   */
  sample(p: Vector3, t: number, out: Vector3): Vector3 {
    const prm = this.params;
    const height = Math.max(0.05, p.y - this.groundY);
    let mean = this.meanSpeed(height);
    const shelter = this.obstacles.length ? this.shelter(p) : 0;
    mean *= 1 - 0.75 * shelter;

    // Turbulenzintensität: σ_u ≈ 2.5·u*, u* = κ·U10/ln(10/z0)
    const uStar = (0.41 * prm.speed) / Math.log(REF_HEIGHT / prm.roughness);
    const gust = 0.65 + 0.7 * Math.max(0, Math.min(1, 0.5 + this.gustNoise.noise3(t / 25, 0.5, 0.5) * 1.6));
    const sigmaU = prm.turbulence * 2.5 * uStar * gust * (1 + 1.5 * shelter);
    const sigmaV = 0.8 * sigmaU;
    const sigmaW = 0.5 * sigmaU * Math.min(1, height / 4);

    // Eingefrorene Turbulenz, mit dem mittleren Wind transportiert
    const L = Math.max(4, Math.min(120, 2.5 * height + 6)) * (1 - 0.5 * shelter);
    const adv = prm.speed * t;
    const qx = (p.x - this.direction.x * adv) / L;
    const qz = (p.z - this.direction.z * adv) / L;
    const qy = p.y / (L * 0.7) + t * 0.03;
    let du = 0,
      dv = 0,
      dw = 0;
    if (sigmaU > 1e-4) {
      du = this.noise.fbm3(qx, qy, qz, 3) * sigmaU;
      dv = this.noise.fbm3(qx + 31.7, qy + 11.3, qz - 47.1, 3) * sigmaV;
      dw = this.noise.fbm3(qx - 71.9, qy + 53.5, qz + 19.7, 3) * sigmaW;
    }

    const d = this.direction;
    const c = this.cross;
    out.x = d.x * (mean + du) + c.x * dv;
    out.z = d.z * (mean + du) + c.z * dv;
    out.y = dw + this.thermal(p, t, height, mean);
    return out;
  }
}
