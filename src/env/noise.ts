/**
 * Gradient-Rauschen (Improved Perlin Noise, Ken Perlin 2002) mit Seed,
 * plus fraktale Summe (fBm) für Turbulenz.
 */

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export class PerlinNoise {
  private readonly perm = new Uint8Array(512);

  constructor(seed = 1) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates mit einfachem LCG
    let s = seed >>> 0 || 1;
    for (let i = 255; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** 3D-Rauschen, Wertebereich ca. −1..1, Mittelwert 0. */
  noise3(x: number, y: number, z: number): number {
    const P = this.perm;
    const xi = Math.floor(x),
      yi = Math.floor(y),
      zi = Math.floor(z);
    const xf = x - xi,
      yf = y - yi,
      zf = z - zi;
    const X = xi & 255,
      Y = yi & 255,
      Z = zi & 255;
    const u = fade(xf),
      v = fade(yf),
      w = fade(zf);
    const g = (h: number, dx: number, dy: number, dz: number) => {
      const gr = GRAD3[h % 12];
      return gr[0] * dx + gr[1] * dy + gr[2] * dz;
    };
    const A = P[X] + Y,
      AA = P[A] + Z,
      AB = P[A + 1] + Z;
    const B = P[X + 1] + Y,
      BA = P[B] + Z,
      BB = P[B + 1] + Z;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    return lerp(
      lerp(
        lerp(g(P[AA], xf, yf, zf), g(P[BA], xf - 1, yf, zf), u),
        lerp(g(P[AB], xf, yf - 1, zf), g(P[BB], xf - 1, yf - 1, zf), u),
        v,
      ),
      lerp(
        lerp(g(P[AA + 1], xf, yf, zf - 1), g(P[BA + 1], xf - 1, yf, zf - 1), u),
        lerp(g(P[AB + 1], xf, yf - 1, zf - 1), g(P[BB + 1], xf - 1, yf - 1, zf - 1), u),
        v,
      ),
      w,
    );
  }

  /**
   * Fraktales Rauschen (fBm), auf Standardabweichung ≈ 1 normiert.
   * Jede Oktave halbiert die Wellenlänge und die Amplitude (≈ Kolmogorov-Spektrum für Böen).
   */
  fbm3(x: number, y: number, z: number, octaves = 3): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise3(x * freq, y * freq, z * freq);
      norm += amp * amp;
      amp *= 0.55;
      freq *= 2.03;
    }
    // Perlin-Rauschen hat eine Standardabweichung von ca. 0.22 pro Oktave
    return sum / (Math.sqrt(norm) * 0.22);
  }
}
