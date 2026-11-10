import { Vector3 } from 'three';
import { FLIGHT_CONTROLLER } from '../config/flightController';
import type { Settings } from '../config/defaults';
import type { QuadPreset } from '../config/quads';
import type { Environment } from '../env/environment';
import { FlightController, type GyroRates, type Sticks } from '../fc/flightController';
import { Quad, gaussian } from '../physics/quad';
import { bodyRatesToFc, type Vehicle } from './vehicle';

/** Multicopter: Betaflight-artiger Flight Controller + Quad-Physik. */
export class QuadVehicle implements Vehicle {
  readonly kind = 'quad' as const;
  readonly quad: Quad;
  readonly fc: FlightController;
  readonly cameraMount: Vector3;
  readonly size: number;
  private readonly gyro: GyroRates = { roll: 0, pitch: 0, yaw: 0 };

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
    return this.fc.armed;
  }
  get modeName() {
    return this.fc.mode.toUpperCase();
  }

  reset(position: Vector3, yaw: number, ambientC: number): void {
    // Auf dem Boden absetzen: unterste Kontaktkugel berührt y = position.y
    const lowest = Math.min(...this.quad.contactPoints.map((c) => c.position.y - c.radius));
    this.quad.reset(new Vector3(position.x, position.y - lowest + 0.002, position.z), yaw, ambientC);
    this.fc.reset();
  }

  step(dt: number, sticks: Sticks, env: Environment, time: number): void {
    bodyRatesToFc(this.quad.body.angularVelocity, this.gyro);
    const n = this.preset.physics.gyro.noise;
    this.gyro.roll += gaussian() * n;
    this.gyro.pitch += gaussian() * n;
    this.gyro.yaw += gaussian() * n;
    const out = this.fc.update(sticks, this.gyro, this.quad.telemetry.onGround);
    this.quad.step(dt, out, env, time);
  }

  applySettings(settings: Settings): void {
    this.fc.rates = settings.rates;
    this.fc.mode = settings.flightMode;
  }

  cameraTilt(settings: Settings): number {
    return settings.camera.angle;
  }
}
