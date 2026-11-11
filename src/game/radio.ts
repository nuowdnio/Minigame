import { Vector3 } from 'three';
import type { Sticks } from '../fc/flightController';
import type { CollisionWorld, ContactResult } from '../world/collision';

const _p = new Vector3();
const _c: ContactResult = { normal: new Vector3(), depth: 0 };

/**
 * Sichtlinie zwischen zwei Punkten: Abtasten der Strecke gegen die Welt-Geometrie.
 * Die ersten/letzten Meter werden ausgelassen (Sender/Empfänger stehen selbst auf etwas).
 */
export function lineOfSight(world: CollisionWorld, a: Vector3, b: Vector3, step = 3, endMargin = 2): boolean {
  const d = a.distanceTo(b);
  if (d < 2 * endMargin) return true;
  const n = Math.ceil((d - 2 * endMargin) / step);
  for (let i = 0; i <= n; i++) {
    const t = (endMargin + (i / Math.max(1, n)) * (d - 2 * endMargin)) / d;
    _p.lerpVectors(a, b, t);
    if (_p.y < 0.15) return false;
    if (world.sphereContact(_p, 0.15, _c) && _c.depth > 0.1) return false;
  }
  return true;
}

/** Störsender (Spielmechanik): stört das Funk- und Videosignal im Umkreis. */
export interface Jammer {
  position: Vector3;
  /** Wirkradius (m). */
  radius: number;
  /** Stärke (1 = kann eine nahe Verbindung allein trennen). */
  power: number;
}

/**
 * Funkverbindung Bodenstation ↔ Fluggerät (analoges Video + Steuerung).
 * Qualität sinkt mit der Entfernung, bei verdeckter Sichtlinie und durch Störsender.
 * Gebäude oder Gelände zwischen Störsender und Drohne schirmen ab – tief fliegen hilft.
 */
export class RadioLink {
  /** Signalqualität 0..1 (gefiltert). */
  quality = 1;
  /** Verbindung verloren (Failsafe aktiv). */
  lost = false;
  private raw = 1;
  private lowTime = 0;
  private losTimer = 0;
  private stationLos = true;
  private jammerLos: boolean[] = [];
  private flicker = 0;

  constructor(
    public station: Vector3,
    public jammers: Jammer[] = [],
    /** Reichweite der Bodenstation (m). */
    public range = 4000,
  ) {}

  reset(station?: Vector3): void {
    if (station) this.station.copy(station);
    this.quality = 1;
    this.raw = 1;
    this.lost = false;
    this.lowTime = 0;
    this.losTimer = 0;
    this.jammerLos = [];
  }

  /** Steuerungs-Latenz (s), steigt bei schlechter Verbindung. */
  get latency(): number {
    return 0.02 + 0.4 * (1 - this.quality) ** 2;
  }

  /** Stärke des Bildrauschens 0..1. */
  get noise(): number {
    return this.lost ? 1 : Math.max(0, Math.min(1, (0.65 - this.quality) / 0.55));
  }

  /** Gesamte Störwirkung der Störsender am Ort (ohne Glättung). */
  jamming(pos: Vector3): number {
    let jam = 0;
    this.jammers.forEach((j, i) => {
      const d = j.position.distanceTo(pos);
      if (d >= j.radius) return;
      const k = (1 - d / j.radius) ** 1.5;
      jam += j.power * k * (this.jammerLos[i] === false ? 0.3 : 1);
    });
    return jam;
  }

  update(dt: number, pos: Vector3, world: CollisionWorld): void {
    // Sichtlinien nur ~8× pro Sekunde prüfen (teuer)
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.12;
      this.stationLos = lineOfSight(world, this.station, pos);
      this.jammerLos = this.jammers.map((j) => (j.position.distanceTo(pos) < j.radius ? lineOfSight(world, j.position, pos) : true));
    }
    const d = this.station.distanceTo(pos);
    let base = Math.max(0, 1 - (d / this.range) ** 2);
    if (!this.stationLos) base *= 0.8; // Reflexionen/Beugung: etwas schwächer, aber kein Abriss
    this.raw = Math.max(0, Math.min(1, base - this.jamming(pos)));
    // Glättung + Flackern bei schwachem Signal
    this.flicker += (Math.random() - 0.5 - this.flicker) * Math.min(1, dt * 12);
    const target = Math.max(0, Math.min(1, this.raw + (this.raw < 0.6 ? this.flicker * 0.25 : 0)));
    this.quality += (target - this.quality) * Math.min(1, dt / 0.25);
    if (this.quality < 0.08) this.lowTime += dt;
    else this.lowTime = 0;
    if (!this.lost && this.lowTime > 0.3) this.lost = true;
    if (this.lost && this.quality > 0.18) this.lost = false;
  }
}

/**
 * Verzögert die Steuersignale entsprechend der Funk-Latenz; bei Verbindungsverlust greift der
 * Failsafe (Betaflight "Drop": alle Kanäle neutral, Gas aus).
 */
export class StickDelay {
  private readonly buf: { t: number; s: Sticks }[] = [];
  readonly out: Sticks = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };

  process(now: number, input: Sticks, latency: number, lost: boolean): Sticks {
    this.buf.push({ t: now, s: { ...input } });
    while (this.buf.length > 2 && this.buf[1].t <= now - latency) this.buf.shift();
    if (lost) {
      this.out.throttle = this.out.roll = this.out.pitch = this.out.yaw = 0;
      return this.out;
    }
    const s = this.buf[0].s;
    this.out.throttle = s.throttle;
    this.out.roll = s.roll;
    this.out.pitch = s.pitch;
    this.out.yaw = s.yaw;
    return this.out;
  }

  reset(): void {
    this.buf.length = 0;
  }
}
