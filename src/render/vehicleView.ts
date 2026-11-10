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
  /** Neu abgebrochene Teile (Objekte) für das Trümmersystem. */
  takeDetached(vehicle: Vehicle): THREE.Object3D[];
  /** Weltpositionen rauchender Teile. */
  smokeSources(vehicle: Vehicle, out: THREE.Vector3[]): THREE.Vector3[];
}

const _p = new THREE.Vector3();

abstract class BaseView {
  private readonly done = new Set<string>();
  abstract get root(): THREE.Group;
  protected abstract detachPart(part: string): THREE.Object3D[];
  protected abstract partPosition(key: string): THREE.Vector3 | null;

  takeDetached(vehicle: Vehicle): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const part of vehicle.damage.brokenParts) {
      if (this.done.has(part)) continue;
      this.done.add(part);
      out.push(...this.detachPart(part));
    }
    return out;
  }

  smokeSources(vehicle: Vehicle, out: THREE.Vector3[]): THREE.Vector3[] {
    out.length = 0;
    for (const key of vehicle.damage.smoking) {
      const local = key === 'battery' ? _p.set(0, 0.03, 0) : this.partPosition(key);
      if (!local) continue;
      out.push(local.clone().applyMatrix4(this.root.matrixWorld));
    }
    return out;
  }
}

class DroneView extends BaseView implements VehicleView {
  readonly mesh: DroneMesh;
  private readonly omegas: number[] = [];
  constructor(id: QuadPresetId) {
    super();
    this.mesh = new DroneMesh(QUAD_PRESETS[id]);
  }
  get root() {
    return this.mesh.root;
  }
  protected detachPart(part: string) {
    return this.mesh.detach(part);
  }
  protected partPosition(key: string) {
    return this.mesh.motorPositions[Number(key.slice(5))] ?? null;
  }
  update(vehicle: Vehicle, dt: number): void {
    if (!(vehicle instanceof QuadVehicle)) return;
    const motors = vehicle.quad.motors;
    for (let i = 0; i < motors.length; i++) this.omegas[i] = motors[i].omega;
    this.mesh.updateProps(this.omegas, dt);
  }
}

class PlaneView extends BaseView implements VehicleView {
  readonly mesh: PlaneMesh;
  private readonly deflections: number[] = [];
  constructor(id: PlanePresetId) {
    super();
    this.mesh = new PlaneMesh(PLANE_PRESETS[id]);
  }
  get root() {
    return this.mesh.root;
  }
  protected detachPart(part: string) {
    return this.mesh.detach(part);
  }
  protected partPosition() {
    return this.mesh.motorPosition;
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
