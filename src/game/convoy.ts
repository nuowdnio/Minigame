import { Vector3 } from 'three';
import type { HazardDef } from '../world/military';

/** Polylinie mit Bogenlängen-Parametrisierung. */
export class Path {
  readonly points: Vector3[];
  readonly cum: number[] = [0];
  readonly length: number;

  constructor(points: Vector3[]) {
    this.points = points.map((p) => p.clone());
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + points[i].distanceTo(points[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }

  /** Punkt und Fahrtrichtung bei Bogenlänge s (vor dem Start/nach dem Ende linear verlängert). */
  sample(s: number, out: Vector3, dir?: Vector3): Vector3 {
    let i = 1;
    while (i < this.points.length - 1 && this.cum[i] < s) i++;
    const a = this.points[i - 1],
      b = this.points[i];
    const seg = this.cum[i] - this.cum[i - 1];
    const t = (s - this.cum[i - 1]) / seg;
    out.lerpVectors(a, b, t);
    if (dir) dir.subVectors(b, a).normalize();
    return out;
  }

  /** Bogenlänge des nächstgelegenen Punktes auf der Route. */
  project(p: Vector3): number {
    let best = Infinity;
    let bestS = 0;
    const tmp = new Vector3();
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1],
        b = this.points[i];
      const ab = tmp.subVectors(b, a);
      const len2 = ab.lengthSq();
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.z - a.z) * ab.z) / len2));
      const x = a.x + ab.x * t,
        z = a.z + ab.z * t;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < best) {
        best = d;
        bestS = this.cum[i - 1] + t * Math.sqrt(len2);
      }
    }
    return bestS;
  }
}

export interface ConvoyVehicle {
  kind: 'jeep' | 'truck';
  /** Abstand hinter dem Führungsfahrzeug (m). */
  offset: number;
  position: Vector3;
  yaw: number;
  damaged: boolean;
}

export interface Hazard extends HazardDef {
  /** Bogenlänge auf der Route. */
  s: number;
  reported: boolean;
  cleared: boolean;
  clearTimer: number;
  triggered: boolean;
}

export type ConvoyEvent =
  | { type: 'stopped'; hazard: Hazard }
  | { type: 'cleared'; hazard: Hazard }
  | { type: 'hit'; hazard: Hazard; vehicle: ConvoyVehicle }
  | { type: 'arrived' };

/**
 * Konvoi: Fahrzeuge folgen der Route mit festem Abstand. Gemeldete Gefahren werden vor Ort
 * geräumt (der Konvoi hält davor an), ungemeldete Gefahren treffen das Führungsfahrzeug.
 */
export class Convoy {
  readonly path: Path;
  readonly vehicles: ConvoyVehicle[];
  readonly hazards: Hazard[];
  /** Bogenlänge des Führungsfahrzeugs. */
  leadS = 0;
  speed = 0;
  readonly cruise = 8;
  started = false;
  finished = false;
  private readonly dir = new Vector3();

  constructor(route: Vector3[], hazards: HazardDef[], readonly clearTime = 6) {
    this.path = new Path(route);
    this.vehicles = (['jeep', 'truck', 'truck', 'truck'] as const).map((kind, i) => ({
      kind,
      offset: i * 16,
      position: new Vector3(),
      yaw: 0,
      damaged: false,
    }));
    this.hazards = hazards
      .map((h) => ({ ...h, position: h.position.clone(), s: this.path.project(h.position), reported: false, cleared: false, clearTimer: 0, triggered: false }))
      .sort((a, b) => a.s - b.s);
    this.place();
  }

  reset(): void {
    this.leadS = 0;
    this.speed = 0;
    this.started = false;
    this.finished = false;
    for (const v of this.vehicles) v.damaged = false;
    for (const h of this.hazards) {
      h.reported = h.cleared = h.triggered = false;
      h.clearTimer = 0;
    }
    this.place();
  }

  /** Nächste noch aktive Gefahr vor dem Konvoi. */
  nextHazard(): Hazard | null {
    return this.hazards.find((h) => !h.cleared && !h.triggered && h.s > this.leadS - 5) ?? null;
  }

  update(dt: number): ConvoyEvent[] {
    const events: ConvoyEvent[] = [];
    if (!this.started || this.finished) {
      this.place();
      return events;
    }
    const h = this.nextHazard();
    let target = this.cruise;
    if (h) {
      if (h.reported) {
        const stopAt = h.s - 25;
        const gap = stopAt - this.leadS;
        // vorausschauend abbremsen
        target = Math.min(target, Math.max(0, Math.sqrt(Math.max(0, 2 * 2.5 * gap))));
        if (gap < 1) {
          if (h.clearTimer === 0) events.push({ type: 'stopped', hazard: h });
          h.clearTimer += dt;
          if (h.clearTimer >= this.clearTime) {
            h.cleared = true;
            events.push({ type: 'cleared', hazard: h });
          }
        }
      } else if (this.leadS >= h.s - 18) {
        h.triggered = true;
        this.vehicles[0].damaged = true;
        events.push({ type: 'hit', hazard: h, vehicle: this.vehicles[0] });
      }
    }
    const a = target > this.speed ? 1.5 : 3.5;
    this.speed += Math.max(-a * dt, Math.min(a * dt, target - this.speed));
    if (this.vehicles[0].damaged) this.speed = 0;
    this.leadS += this.speed * dt;
    if (this.leadS >= this.path.length - 1) {
      this.leadS = this.path.length - 1;
      this.finished = true;
      events.push({ type: 'arrived' });
    }
    this.place();
    return events;
  }

  /** Fahrzeugpositionen aus der Bogenlänge. */
  private place(): void {
    for (const v of this.vehicles) {
      this.path.sample(this.leadS - v.offset, v.position, this.dir);
      v.yaw = Math.atan2(-this.dir.x, -this.dir.z);
    }
  }
}
