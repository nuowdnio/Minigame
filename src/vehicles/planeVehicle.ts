import { Vector3 } from 'three';
import type { Settings } from '../config/defaults';
import type { PlaneConfig } from '../config/planes';
import type { Environment } from '../env/environment';
import type { Sticks } from '../fc/flightController';
import { PlaneController } from '../fc/planeController';
import { Plane } from '../physics/plane';
import { targetOmega } from '../physics/motor';
import { bodyRatesToFc, type Vehicle } from './vehicle';

const DEG = Math.PI / 180;
const MODE_NAMES = { manual: 'MANUAL', gyro: 'STAB', angle: 'ANGLE' } as const;

/** Starrflügler: Flugregler (Manuell/Stabilisiert/Angle) + Servos + Flugzeugphysik. */
export class PlaneVehicle implements Vehicle {
  readonly kind = 'plane' as const;
  readonly plane: Plane;
  readonly ctrl: PlaneController;
  readonly cameraMount: Vector3;
  readonly size: number;
  private readonly rates = { roll: 0, pitch: 0, yaw: 0 };
  /** Handstart: Modell wird gehalten, bis Gas gegeben wird. */
  launchPending = false;
  private readonly launchVelocity = new Vector3();

  constructor(
    readonly id: string,
    readonly config: PlaneConfig,
    settings: Settings,
  ) {
    this.plane = new Plane(config);
    this.ctrl = new PlaneController(config.control);
    this.ctrl.mode = settings.planeMode;
    const m = config.cameraMount;
    this.cameraMount = new Vector3(m.x, m.y, m.z);
    this.size = config.visual.size;
  }

  get body() {
    return this.plane.body;
  }
  get battery() {
    return this.plane.battery;
  }
  get telemetry() {
    return this.plane.telemetry;
  }
  get armed() {
    return this.ctrl.armed;
  }
  get modeName() {
    return MODE_NAMES[this.ctrl.mode];
  }

  reset(position: Vector3, yaw: number, ambientC: number): void {
    const s = this.config.spawn;
    const p = new Vector3(position.x, position.y + s.height, position.z);
    this.plane.reset(p, yaw, s.onGround ? 0 : s.pitchDeg, s.onGround ? 0 : s.speed, ambientC);
    this.ctrl.reset();
    this.launchPending = !s.onGround;
    if (this.launchPending) {
      this.launchVelocity.copy(this.plane.body.velocity);
      this.plane.body.velocity.set(0, 0, 0);
    }
  }

  get statusHint(): string {
    return this.launchPending ? 'GAS GEBEN FÜR HANDSTART' : '';
  }

  step(dt: number, sticks: Sticks, env: Environment, time: number): void {
    const p = this.plane;
    bodyRatesToFc(p.body.angularVelocity, this.rates);
    this.ctrl.update(sticks, this.rates, p.body.orientation, p.telemetry.airspeed, dt);
    const o = this.ctrl.output;
    // Servos: begrenzte Stellgeschwindigkeit
    const maxStep = this.config.control.servoRate * DEG * dt;
    for (const s of p.surfaces) {
      const c = s.def.control;
      if (!c) continue;
      const cmd = Math.max(-1, Math.min(1, (c.mix.roll ?? 0) * o.roll + (c.mix.pitch ?? 0) * o.pitch + (c.mix.yaw ?? 0) * o.yaw));
      const target = cmd * c.maxDeg * DEG;
      const d = target - s.deflection;
      s.deflection += Math.max(-maxStep, Math.min(maxStep, d));
    }
    p.steerAngle = sticks.yaw * this.config.steerMaxDeg * DEG;
    if (this.launchPending) {
      // Der Pilot hält das Modell; Motor läuft schon hoch, geworfen wird bei genug Gas
      p.motor.update(o.throttle, p.battery.terminalVoltage(), dt);
      p.body.velocity.set(0, 0, 0);
      p.body.angularVelocity.set(0, 0, 0);
      if (this.ctrl.armed && o.throttle > 0.4 && p.motor.omega > 0.7 * targetOmega(o.throttle, p.battery.terminalVoltage(), p.motor.params)) {
        this.launchPending = false;
        p.body.velocity.copy(this.launchVelocity);
      }
      return;
    }
    p.step(dt, o.throttle, env, time);
  }

  applySettings(settings: Settings): void {
    this.ctrl.mode = settings.planeMode;
  }

  cameraTilt(): number {
    return this.config.cameraTiltDeg;
  }
}
