import { Quaternion, Vector3 } from 'three';
import type { Settings } from '../config/defaults';
import { PHYSICS } from '../config/physics';
import type { Environment } from '../env/environment';
import type { Sticks } from '../fc/flightController';
import { createVehicle } from '../vehicles/registry';
import type { Vehicle } from '../vehicles/vehicle';

/**
 * Verbindet Fluggerät und Umgebung in einem festen Zeittakt.
 * Hält den vorherigen Zustand für die Render-Interpolation.
 */
export class Simulation {
  vehicle: Vehicle;
  readonly dt: number;
  time = 0;
  /** Geflogene Zeit im scharfen Zustand (s). */
  flightTime = 0;
  readonly prevPosition = new Vector3();
  readonly prevOrientation = new Quaternion();
  readonly spawnPosition = new Vector3(0, 0, 0);
  spawnYaw = 0;

  constructor(
    public env: Environment,
    settings: Settings,
    simHz = PHYSICS.simHz,
  ) {
    this.dt = 1 / simHz;
    this.vehicle = createVehicle(settings.vehicle, settings, this.dt);
    this.reset();
  }

  /** Fluggerät wechseln (setzt zurück). */
  setVehicle(id: string, settings: Settings): void {
    this.vehicle = createVehicle(id, settings, this.dt);
    this.reset();
  }

  applySettings(settings: Settings): void {
    this.vehicle.applySettings(settings);
  }

  /** @param position Bodenpunkt, an dem das Fluggerät abgesetzt wird */
  reset(position = this.spawnPosition, yaw = this.spawnYaw): void {
    if (position !== this.spawnPosition) this.spawnPosition.copy(position);
    this.spawnYaw = yaw;
    this.vehicle.reset(this.spawnPosition, yaw, this.env.groundTemperatureC);
    this.flightTime = 0;
    this.prevPosition.copy(this.vehicle.body.position);
    this.prevOrientation.copy(this.vehicle.body.orientation);
  }

  step(sticks: Sticks): void {
    const b = this.vehicle.body;
    this.prevPosition.copy(b.position);
    this.prevOrientation.copy(b.orientation);
    this.vehicle.step(this.dt, sticks, this.env, this.time);
    this.time += this.dt;
    if (this.vehicle.armed) this.flightTime += this.dt;
  }
}
