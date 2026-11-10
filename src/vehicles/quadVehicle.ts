import { Vector3 } from 'three';
import { FLIGHT_CONTROLLER } from '../config/flightController';
import type { Settings } from '../config/defaults';
import type { QuadPreset } from '../config/quads';
import type { Environment } from '../env/environment';
import { FlightController, type GyroRates, type Sticks } from '../fc/flightController';
import { attitude } from '../fc/planeController';
import { Quad, gaussian } from '../physics/quad';
import { DamageState, damageScale, type DamageMode } from './damage';
import { bodyRatesToFc, type Vehicle } from './vehicle';

const MOTOR_NAMES = ['Motor hinten rechts', 'Motor vorne rechts', 'Motor hinten links', 'Motor vorne links'];

/** Multicopter: Betaflight-artiger Flight Controller + Quad-Physik + Schadensmodell. */
export class QuadVehicle implements Vehicle {
  readonly kind = 'quad' as const;
  readonly quad: Quad;
  readonly fc: FlightController;
  readonly cameraMount: Vector3;
  readonly size: number;
  readonly damage = new DamageState();
  damageMode: DamageMode;
  private readonly gyro: GyroRates = { roll: 0, pitch: 0, yaw: 0 };
  private readonly zero = [0, 0, 0, 0];

  constructor(
    readonly id: string,
    readonly preset: QuadPreset,
    settings: Settings,
    dt: number,
  ) {
    this.quad = new Quad(preset.physics);
    this.fc = new FlightController(
      { ...FLIGHT_CONTROLLER, pid: structuredClone(preset.pid) },
      settings.rates,
      preset.physics.frame.motors,
      dt,
    );
    this.fc.cfgIdle = preset.physics.motor.idle;
    this.fc.mode = settings.flightMode;
    this.damageMode = settings.damage;
    const m = preset.cameraMount;
    this.cameraMount = new Vector3(m.x, m.y, m.z);
    this.size = preset.visual.size;
  }

  get body() {
    return this.quad.body;
  }
  get battery() {
    return this.quad.battery;
  }
  get telemetry() {
    return this.quad.telemetry;
  }
  get armed() {
    return this.fc.armed && !this.damage.destroyed;
  }
  get modeName() {
    return this.fc.mode.toUpperCase();
  }
  get statusHint(): string {
    return this.damage.destroyed ? 'ZERSTÖRT – RESET (R / ↺)' : '';
  }

  reset(position: Vector3, yaw: number, ambientC: number): void {
    // Auf dem Boden absetzen: unterste Kontaktkugel berührt y = position.y
    const lowest = Math.min(...this.quad.contactPoints.map((c) => c.position.y - c.radius));
    this.quad.reset(new Vector3(position.x, position.y - lowest + 0.002, position.z), yaw, ambientC);
    this.fc.reset();
    this.damage.reset();
  }

  step(dt: number, sticks: Sticks, env: Environment, time: number): void {
    const q = this.quad;
    bodyRatesToFc(q.body.angularVelocity, this.gyro);
    // Gyro-Rauschen + Vibrationen beschädigter Propeller
    let vib = this.preset.physics.gyro.noise;
    for (const m of q.motors) vib += m.imbalance * 60 * (m.omega / q.omegaRef) ** 2;
    this.gyro.roll += gaussian() * vib;
    this.gyro.pitch += gaussian() * vib;
    this.gyro.yaw += gaussian() * vib * 0.5;
    const att = this.fc.mode === 'acro' ? undefined : attitude(q.body.orientation);
    let out = this.fc.update(sticks, this.gyro, q.telemetry.onGround, att);
    if (this.damage.destroyed) out = this.zero;
    q.step(dt, out, env, time);
    this.evaluateDamage(dt);
  }

  /** Schäden aus Kontakten, Propellerschleifen und Überlast bestimmen. */
  private evaluateDamage(dt: number): void {
    const d = this.damage;
    const q = this.quad;
    const t = q.telemetry;
    const scale = damageScale(this.damageMode);
    const lim = this.preset.damage;
    const impacts = t.pointImpact ?? [];
    const strikes = t.propStrike ?? [];

    for (let i = 0; i < q.motors.length; i++) {
      const m = q.motors[i];
      const name = MOTOR_NAMES[i] ?? `Motor ${i + 1}`;
      d.checkMotor(m, name, `motor${i}`);
      if (!Number.isFinite(scale)) continue;
      // Propellerblätter schlagen bei laufendem Motor an (Boden, Wand, Ast …)
      const spin = m.omega / q.omegaRef;
      if (strikes[i] && spin > 0.1 && m.health > 0) {
        const wear = (dt * 6 * spin) / scale;
        m.health = Math.max(0, m.health - wear);
        m.imbalance = Math.min(1, m.imbalance + wear * 1.5);
      }
      // Aufprall am Motor/Propeller
      const v = impacts[i] ?? 0;
      if (v > lim.propChip * scale && m.health > 0) {
        const loss = Math.min(1, (v - lim.propChip * scale) / ((lim.propBreak - lim.propChip) * scale)) * 0.6;
        m.health = Math.max(0, m.health - loss);
        m.imbalance = Math.min(1, m.imbalance + loss);
      }
      if (v > lim.propBreak * scale) m.health = 0;
      // Propeller mit weniger als 30 % Blattfläche zählt als zerbrochen
      if (m.health < 0.3) m.health = 0;
      if (v > lim.armBreak * scale) {
        m.health = 0;
        m.failure = 'motor';
        q.contactPoints[i].removed = true;
        d.break(`arm${i}`, `Arm gebrochen – ${name} abgerissen (${v.toFixed(1)} m/s)`, 'critical');
      }
      if (m.health < 0.85 && m.health > 0) d.emit(`Propeller ${name.replace('Motor ', '')} beschädigt – Vibrationen`, 'warn', `chip${i}`);
      if (m.health <= 0) d.break(`prop${i}`, `Propeller ${name.replace('Motor ', '')} zerbrochen`, 'warn');
    }
    if (Number.isFinite(scale)) {
      for (let i = 0; i < impacts.length; i++) {
        if (impacts[i] > lim.frameBreak * scale) {
          d.break('frame', 'Rahmen gebrochen', 'critical');
          d.destroy(`CRASH mit ${(impacts[i] * 3.6).toFixed(0)} km/h – Drohne zerstört`);
        }
      }
      if (q.motors.every((m) => m.health <= 0 || !m.working) && !d.destroyed) {
        d.destroy('Alle Antriebe ausgefallen');
      }
    }
    d.checkBattery(q.battery);
    if (d.destroyed) for (const m of q.motors) m.health = Math.min(m.health, m.working ? m.health : 0);
    for (let i = 0; i < q.motors.length; i++) d.parts.set(`Prop ${i + 1}`, q.motors[i].working ? q.motors[i].health : 0);
  }

  applySettings(settings: Settings): void {
    this.fc.rates = settings.rates;
    this.fc.mode = settings.flightMode;
    this.damageMode = settings.damage;
  }

  cameraTilt(settings: Settings): number {
    return settings.camera.angle;
  }
}
