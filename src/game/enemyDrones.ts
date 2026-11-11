import { Vector3 } from 'three';
import type { EnemyRouteDef } from '../world/military';
import { Observer } from './detection';

export type EnemyState = 'waiting' | 'inbound' | 'loiter' | 'evade' | 'outbound' | 'escaped' | 'down';

const _to = new Vector3();

/**
 * Gegnerische Aufklärungsdrohne (Starrflügler, vereinfachte Flugdynamik):
 * fliegt ein, kreist über ihrem Ziel und fliegt wieder ab. Bemerkt sie den Abfangjäger,
 * weicht sie mit engen Kurven, Höhenwechsel und Vollgas aus.
 */
export class EnemyDrone {
  state: EnemyState = 'waiting';
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  heading = 0;
  speed = 17;
  /** Querneigung (für die Darstellung, rad). */
  bank = 0;
  private targetAlt: number;
  private loiterTime = 0;
  private evadeTime = 0;
  private evadeDir = 1;
  private spawnTimer: number;
  readonly observer: Observer;
  /** Für den Absturz: Sinkgeschwindigkeit und Drehung. */
  fallSpin = 0;

  constructor(
    readonly route: EnemyRouteDef,
    readonly spawnDelay: number,
    readonly cruise = 17,
    readonly dash = 27,
    readonly turnRate = 0.65,
    readonly loiterDuration = 50,
  ) {
    this.targetAlt = route.entry.y;
    this.spawnTimer = spawnDelay;
    this.observer = new Observer(this.position, 180);
  }

  get active(): boolean {
    return this.state !== 'waiting' && this.state !== 'escaped' && this.state !== 'down';
  }

  update(dt: number, player: Vector3 | null, playerSpeed: number, playerNoise: number, playerSize: number): void {
    if (this.state === 'waiting') {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.state = 'inbound';
        this.position.copy(this.route.entry);
        this.heading = Math.atan2(this.route.loiter.x - this.position.x, this.route.loiter.z - this.position.z);
      }
      return;
    }
    if (this.state === 'down') {
      // Absturz: ballistisch mit Trudeln
      this.velocity.y -= 9.81 * dt;
      this.velocity.multiplyScalar(1 - 0.4 * dt);
      this.position.addScaledVector(this.velocity, dt);
      this.fallSpin += dt * 6;
      if (this.position.y < 0.2) {
        this.position.y = 0.2;
        this.velocity.set(0, 0, 0);
      }
      return;
    }
    if (this.state === 'escaped') return;

    // Wahrnehmung des Abfangjägers
    if (player) {
      this.observer.update(dt, { target: player, targetSpeed: playerSpeed, noise: playerNoise, size: playerSize, lineOfSight: true });
      const d = player.distanceTo(this.position);
      if (this.observer.detected && d < 140 && this.state !== 'evade') {
        this.state = 'evade';
        this.evadeTime = 3 + Math.random() * 3;
        this.evadeDir = Math.random() < 0.5 ? -1 : 1;
        this.targetAlt = Math.max(30, Math.min(160, this.position.y + (Math.random() < 0.5 ? -40 : 40)));
      }
    }

    // Ziel des aktuellen Flugabschnitts
    let desired = this.heading;
    let spd = this.cruise;
    if (this.state === 'inbound') {
      _to.subVectors(this.route.loiter, this.position);
      desired = Math.atan2(_to.x, _to.z);
      this.targetAlt = this.route.loiter.y;
      if (Math.hypot(_to.x, _to.z) < 140) this.state = 'loiter';
    } else if (this.state === 'loiter') {
      // Kreisen gegen den Uhrzeigersinn um das Ziel
      _to.subVectors(this.position, this.route.loiter);
      const ang = Math.atan2(_to.x, _to.z);
      desired = ang + Math.PI / 2 + (Math.hypot(_to.x, _to.z) - 120) * 0.004;
      this.loiterTime += dt;
      if (this.loiterTime > this.loiterDuration) this.state = 'outbound';
    } else if (this.state === 'outbound') {
      _to.subVectors(this.route.exit, this.position);
      desired = Math.atan2(_to.x, _to.z);
      this.targetAlt = this.route.exit.y;
      if (Math.hypot(_to.x, _to.z) < 60) this.state = 'escaped';
    } else if (this.state === 'evade') {
      spd = this.dash;
      if (player) {
        _to.subVectors(this.position, player);
        desired = Math.atan2(_to.x, _to.z) + this.evadeDir * 0.9;
      }
      this.evadeTime -= dt;
      if (this.evadeTime <= 0) this.state = this.loiterTime > this.loiterDuration ? 'outbound' : this.loiterTime > 0 ? 'loiter' : 'inbound';
    }

    // Kurvenflug mit begrenzter Drehrate
    let dh = desired - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const turn = Math.max(-this.turnRate, Math.min(this.turnRate, dh * 1.5)) * (this.state === 'evade' ? 1.6 : 1);
    this.heading += turn * dt;
    this.bank += (Math.atan((turn * this.speed) / 9.81) - this.bank) * Math.min(1, dt * 3);
    this.speed += (spd - this.speed) * Math.min(1, dt * 0.8);
    const climb = Math.max(-5, Math.min(5, (this.targetAlt - this.position.y) * 0.4));
    this.velocity.set(Math.sin(this.heading) * this.speed, climb, Math.cos(this.heading) * this.speed);
    this.position.addScaledVector(this.velocity, dt);
  }

  /** Abgefangen: stürzt ab. */
  shootDown(impact: Vector3): void {
    this.state = 'down';
    this.velocity.add(impact.clone().multiplyScalar(0.3));
    this.velocity.y = Math.max(this.velocity.y, 2);
  }
}
