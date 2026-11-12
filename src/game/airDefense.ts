import { Vector3 } from 'three';
import type { CollisionWorld, ContactResult } from '../world/collision';
import { Observer } from './detection';
import { lineOfSight } from './radio';

const G = 9.81;
const _c: ContactResult = { normal: new Vector3(), depth: 0 };
const _d = new Vector3();
const _axis = new Vector3();
const _aim = new Vector3();

export interface Round {
  pos: Vector3;
  prev: Vector3;
  vel: Vector3;
  life: number;
}

export interface DroneState {
  position: Vector3;
  velocity: Vector3;
  /** Trefferradius (m). */
  radius: number;
  noise: number;
  size: number;
}

/**
 * Flugabwehr-Stellung (Spielmechanik): entdeckt die Drohne über das Entdeckungsmodell,
 * schwenkt mit begrenzter Geschwindigkeit, berechnet einen Vorhalt und schießt in Feuerstößen
 * mit Leuchtspur. Feuert nur mit freier Sichtlinie – Deckung hinter Gebäuden/Gelände schützt.
 */
export class AirDefenseSite {
  readonly observer: Observer;
  /** Richtung des Rohrs (Welt, normiert). */
  readonly barrel = new Vector3(0, 0.5, 1).normalize();
  readonly rounds: Round[] = [];
  readonly muzzle: Vector3;
  private los = false;
  private losTimer = 0;
  private burst = 0;
  private pause = 0;
  private shotTimer = 0;
  /** Für Effekte: Schuss im letzten Update. */
  fired = 0;
  /** Geschätzte Zielgeschwindigkeit (verzögert, wie ein Feuerleitrechner mit Glättung). */
  private readonly estVel = new Vector3();
  private readonly lastPos = new Vector3();
  private hasLast = false;
  private trackError = 0;
  /** Wie lange das Ziel schon ununterbrochen verfolgt wird (s) – die ersten Feuerstöße streuen stark. */
  trackTime = 0;
  private lostTime = 0;
  disabled = false;

  constructor(
    readonly position: Vector3,
    readonly range = 260,
    readonly muzzleSpeed = 480,
    readonly slewRate = 1.4, // rad/s
    readonly fireRate = 9, // Schuss/s
    readonly spread = 0.009, // rad
  ) {
    this.observer = new Observer(position.clone().setY(position.y + 1.6), range);
    this.muzzle = position.clone().setY(position.y + 1.8);
  }

  get alert(): number {
    return this.observer.level;
  }

  reset(): void {
    this.observer.reset();
    this.rounds.length = 0;
    this.burst = this.pause = this.shotTimer = 0;
    this.disabled = false;
    this.estVel.set(0, 0, 0);
    this.hasLast = false;
    this.trackTime = 0;
    this.lostTime = 0;
  }

  /**
   * @param onHit wird bei einem Treffer aufgerufen
   */
  update(dt: number, drone: DroneState | null, world: CollisionWorld, onHit: () => void): void {
    this.fired = 0;
    if (drone && !this.disabled) {
      this.losTimer -= dt;
      if (this.losTimer <= 0) {
        this.losTimer = 0.15;
        this.los = this.muzzle.distanceTo(drone.position) < this.range * 1.2 && lineOfSight(world, this.muzzle, drone.position, 3, 3.5);
      }
      this.observer.update(dt, {
        target: drone.position,
        targetSpeed: drone.velocity.length(),
        noise: drone.noise,
        size: drone.size,
        lineOfSight: this.los,
      });
      const dist = this.muzzle.distanceTo(drone.position);
      // Zielgeschwindigkeit aus Positionsänderungen schätzen (geglättet -> Manöver bringen Fehler)
      if (this.hasLast && dt > 0) {
        _d.subVectors(drone.position, this.lastPos).divideScalar(dt);
        this.estVel.lerp(_d, Math.min(1, dt / 0.6));
      }
      this.lastPos.copy(drone.position);
      this.hasLast = true;
      // Zielfehler wächst mit der Winkelgeschwindigkeit des Ziels (schwer zu verfolgen)
      const crossing = _d.copy(drone.velocity).sub(_aim.subVectors(drone.position, this.muzzle).normalize().multiplyScalar(drone.velocity.dot(_aim))).length();
      this.trackError = 0.08 * (crossing / Math.max(10, dist));
      const engaged = this.observer.detected && this.los && dist < this.range;
      // Einschießen: Verfolgungszeit wächst nur bei Sicht, nach 2 s ohne Sicht beginnt es von vorn
      if (engaged) {
        this.trackTime += dt;
        this.lostTime = 0;
      } else {
        this.lostTime += dt;
        if (this.lostTime > 2) this.trackTime = 0;
      }
      if (engaged) {
        // Vorhalt (zwei Iterationen) inkl. Geschossabfall
        let t = dist / this.muzzleSpeed;
        for (let k = 0; k < 2; k++) {
          _aim.copy(drone.position).addScaledVector(this.estVel, t);
          t = this.muzzle.distanceTo(_aim) / this.muzzleSpeed;
        }
        _aim.y += 0.5 * G * t * t;
        _d.subVectors(_aim, this.muzzle).normalize();
        // Rohr mit begrenzter Geschwindigkeit nachführen
        const angle = this.barrel.angleTo(_d);
        const maxStep = this.slewRate * dt;
        if (angle > 1e-4) {
          // Drehung um die Achse senkrecht zu Rohr und Ziel (auch bei Ziel genau hinten)
          _axis.crossVectors(this.barrel, _d);
          if (_axis.lengthSq() < 1e-8) _axis.set(0, 1, 0);
          this.barrel.applyAxisAngle(_axis.normalize(), Math.min(angle, maxStep)).normalize();
        }
        const onTarget = this.barrel.angleTo(_d) < 0.03;
        if (this.pause > 0) this.pause -= dt;
        else if (onTarget) {
          this.burst += dt;
          this.shotTimer -= dt;
          while (this.shotTimer <= 0) {
            this.shotTimer += 1 / this.fireRate;
            this.fire();
          }
          if (this.burst > 1.8) {
            this.burst = 0;
            this.pause = 1.2;
          }
        }
      }
    }
    // Geschosse fliegen
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i];
      r.prev.copy(r.pos);
      r.vel.y -= G * dt;
      r.pos.addScaledVector(r.vel, dt);
      r.life -= dt;
      let gone = r.life <= 0 || r.pos.y < 0;
      if (!gone && drone && segmentDistance(r.prev, r.pos, drone.position) < drone.radius) {
        onHit();
        gone = true;
      }
      if (!gone && world.sphereContact(r.pos, 0.05, _c)) gone = true;
      if (gone) this.rounds.splice(i, 1);
    }
  }

  private fire(): void {
    const dir = this.barrel.clone();
    // Streuung: anfangs grob (Einschießen), nach einigen Sekunden Verfolgung präzise
    const ranging = 1 + 5 * Math.exp(-this.trackTime / 2.5);
    const sp = this.spread * ranging + this.trackError;
    dir.x += (Math.random() - 0.5) * 2 * sp;
    dir.y += (Math.random() - 0.5) * 2 * sp;
    dir.z += (Math.random() - 0.5) * 2 * sp;
    dir.normalize();
    const pos = this.muzzle.clone().addScaledVector(dir, 1.2);
    this.rounds.push({ pos, prev: pos.clone(), vel: dir.multiplyScalar(this.muzzleSpeed), life: 1.6 });
    this.fired++;
  }
}

/** Kürzester Abstand eines Punktes zur Strecke a–b. */
export function segmentDistance(a: Vector3, b: Vector3, p: Vector3): number {
  const abx = b.x - a.x,
    aby = b.y - a.y,
    abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - p.x,
    dy = a.y + aby * t - p.y,
    dz = a.z + abz * t - p.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
