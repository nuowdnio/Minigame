import { Quaternion, Vector3 } from 'three';
import { FLIGHT_CONTROLLER, type FlightControllerConfig } from '../config/flightController';
import type { Settings } from '../config/defaults';
import { PHYSICS, type PhysicsConfig } from '../config/physics';
import type { Environment } from '../env/environment';
import { FlightController, type GyroRates, type Sticks } from '../fc/flightController';
import { Quad } from '../physics/quad';

const RAD2DEG = 180 / Math.PI;

/** Normalverteiltes Rauschen (Box-Muller). */
function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Verbindet Flight Controller, Quad-Physik und Umgebung in einem festen Zeittakt.
 * Hält den vorherigen Zustand für die Render-Interpolation.
 */
export class Simulation {
  readonly quad: Quad;
  readonly fc: FlightController;
  readonly dt: number;
  time = 0;
  /** Geflogene Zeit im scharfen Zustand (s). */
  flightTime = 0;
  readonly prevPosition = new Vector3();
  readonly prevOrientation = new Quaternion();
  readonly spawnPosition = new Vector3(0, 0.05, 0);
  spawnYaw = 0;
  private readonly gyro: GyroRates = { roll: 0, pitch: 0, yaw: 0 };

  constructor(
    public env: Environment,
    settings: Settings,
    readonly physics: PhysicsConfig = PHYSICS,
    fcConfig: FlightControllerConfig = FLIGHT_CONTROLLER,
  ) {
    this.dt = 1 / physics.simHz;
    this.quad = new Quad(physics);
    this.fc = new FlightController(fcConfig, settings.rates, physics.frame.motors, this.dt);
    this.fc.cfgIdle = physics.motor.idle;
    this.fc.mode = settings.flightMode;
    this.reset();
  }

  applySettings(settings: Settings): void {
    this.fc.rates = settings.rates;
    this.fc.mode = settings.flightMode;
  }

  reset(position = this.spawnPosition, yaw = this.spawnYaw): void {
    this.spawnPosition.copy(position);
    this.spawnYaw = yaw;
    this.quad.reset(position, yaw);
    this.fc.reset();
    this.flightTime = 0;
    this.prevPosition.copy(this.quad.body.position);
    this.prevOrientation.copy(this.quad.body.orientation);
  }

  /** Gyro-Messung aus der Körper-Winkelgeschwindigkeit (inkl. Rauschen). */
  private readGyro(): GyroRates {
    const w = this.quad.body.angularVelocity;
    const n = this.physics.gyro.noise;
    // Körper: x = rechts, y = oben, z = hinten. Positive FC-Raten entsprechen negativen Körper-Raten.
    this.gyro.roll = -w.z * RAD2DEG + gaussian() * n;
    this.gyro.pitch = -w.x * RAD2DEG + gaussian() * n;
    this.gyro.yaw = -w.y * RAD2DEG + gaussian() * n;
    return this.gyro;
  }

  step(sticks: Sticks): void {
    this.prevPosition.copy(this.quad.body.position);
    this.prevOrientation.copy(this.quad.body.orientation);
    const gyro = this.readGyro();
    const outputs = this.fc.update(sticks, gyro, this.quad.telemetry.onGround);
    this.quad.step(this.dt, outputs, this.env, this.time);
    this.time += this.dt;
    if (this.fc.armed) this.flightTime += this.dt;
  }
}
