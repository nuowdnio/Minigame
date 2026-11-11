import type { Vector3 } from 'three';

/**
 * Entdeckungsmodell (Spielmechanik): ein Beobachter füllt ein Entdeckungsmeter abhängig davon,
 * wie gut er die Drohne hören und sehen kann.
 *  - Hören: Lautstärke (Motorleistung, Größe), nimmt mit der Entfernung stark ab, auch ohne Sichtlinie
 *  - Sehen: nur mit Sichtlinie; gegen den Himmel (über dem Horizont) und bei schneller Bewegung auffälliger
 * Tief und langsam hinter Deckung anzuschleichen lohnt sich.
 */
export interface DetectionInput {
  observer: Vector3;
  target: Vector3;
  targetSpeed: number;
  /** Lautstärke 0..1 (Motorleistung). */
  noise: number;
  /** Größe des Fluggeräts (m). */
  size: number;
  lineOfSight: boolean;
  /** Maximale Reichweite des Beobachters (m). */
  range: number;
}

/** Füllrate des Entdeckungsmeters (1/s); negativ = Meter sinkt. */
export function detectionRate(i: DetectionInput): number {
  const d = Math.max(1, i.observer.distanceTo(i.target));
  if (d > i.range) return -0.3;
  const loud = i.noise * (0.4 + i.size * 1.5);
  const hearing = (2.2 * loud) / (1 + (d / 55) ** 2);
  let seeing = 0;
  if (i.lineOfSight) {
    const elevation = Math.asin(Math.max(-1, Math.min(1, (i.target.y - i.observer.y) / d)));
    const silhouette = elevation > 0.05 ? 1.6 : 0.5; // gegen den Himmel deutlich besser sichtbar
    const motion = 1 + i.targetSpeed / 18;
    seeing = (2.4 * silhouette * motion * (0.3 + i.size * 2)) / (1 + (d / 110) ** 2);
  }
  return hearing + seeing - 0.25;
}

/** Zustand eines Beobachters. */
export class Observer {
  level = 0;
  detected = false;
  private memory = 0;

  constructor(
    public position: Vector3,
    public range: number,
  ) {}

  reset(): void {
    this.level = 0;
    this.detected = false;
    this.memory = 0;
  }

  update(dt: number, input: Omit<DetectionInput, 'observer' | 'range'>): void {
    const rate = detectionRate({ ...input, observer: this.position, range: this.range });
    this.level = Math.max(0, Math.min(1, this.level + rate * dt));
    if (this.level >= 1) {
      this.detected = true;
      this.memory = 5;
    } else if (this.detected) {
      this.memory -= dt;
      if (this.memory <= 0 && this.level < 0.5) this.detected = false;
    }
  }
}
