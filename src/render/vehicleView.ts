import * as THREE from 'three';
import { PLANE_PRESETS, type PlanePresetId } from '../config/planes';
import { QUAD_PRESETS, type QuadPresetId } from '../config/quads';
import type { Vehicle } from '../vehicles/vehicle';
import { PlaneVehicle } from '../vehicles/planeVehicle';
import { QuadVehicle } from '../vehicles/quadVehicle';
import { DroneMesh } from './droneMesh';
import { PlaneMesh } from './planeMesh';

/** Darstellung eines Fluggeräts (Drohne oder Flugzeug). */
export interface VehicleView {
  root: THREE.Group;
  update(vehicle: Vehicle, dt: number): void;
}

class DroneView implements VehicleView {
  readonly mesh: DroneMesh;
  private readonly omegas: number[] = [];
  constructor(id: QuadPresetId) {
    this.mesh = new DroneMesh(QUAD_PRESETS[id]);
  }
  get root() {
    return this.mesh.root;
  }
  update(vehicle: Vehicle, dt: number): void {
    if (!(vehicle instanceof QuadVehicle)) return;
    const motors = vehicle.quad.motors;
    for (let i = 0; i < motors.length; i++) this.omegas[i] = motors[i].omega;
    this.mesh.updateProps(this.omegas, dt);
  }
}

class PlaneView implements VehicleView {
  readonly mesh: PlaneMesh;
  private readonly deflections: number[] = [];
  constructor(id: PlanePresetId) {
    this.mesh = new PlaneMesh(PLANE_PRESETS[id]);
  }
  get root() {
    return this.mesh.root;
  }
  update(vehicle: Vehicle, dt: number): void {
    if (!(vehicle instanceof PlaneVehicle)) return;
    const s = vehicle.plane.surfaces;
    for (let i = 0; i < s.length; i++) this.deflections[i] = s[i].deflection;
    this.mesh.update(this.deflections, vehicle.plane.motor.omega, vehicle.config.motor.spin, dt);
  }
}

export function createVehicleView(vehicle: Vehicle): VehicleView {
  if (vehicle.kind === 'plane') return new PlaneView(vehicle.id as PlanePresetId);
  return new DroneView(vehicle.id as QuadPresetId);
}
