import { Quaternion, Vector3 } from 'three';
import type { Settings } from '../config/defaults';
import type { Environment } from '../env/environment';
import type { Sticks } from '../fc/flightController';
import type { Battery } from '../physics/battery';
import type { QuadTelemetry } from '../physics/quad';
import type { RigidBody } from '../physics/rigidbody';
import type { DamageState } from './damage';

export type VehicleKind = 'quad' | 'plane';

/** Gemeinsame Schnittstelle aller Fluggeräte (Drohnen und Flugzeuge). */
export interface Vehicle {
  readonly kind: VehicleKind;
  readonly id: string;
  readonly body: RigidBody;
  readonly battery: Battery;
  readonly telemetry: QuadTelemetry;
  readonly armed: boolean;
  /** Anzeigename des Flugmodus (OSD). */
  readonly modeName: string;
  /** FPV-Kamera-Montage (Körper) und fester Zusatz-Neigungswinkel. */
  readonly cameraMount: Vector3;
  /** Größe für die Verfolgerkamera (m). */
  readonly size: number;
  /** Schadenszustand und Ereignisse. */
  readonly damage: DamageState;
  /** Zoomstufen der Kamera (1 = normal). */
  readonly zoomLevels: number[];
  /** Treffer durch Beschuss (Flugabwehr) – beschädigt zufällige Bauteile. */
  applyHit(): void;
  /** Last abwerfen (nur Fluggeräte mit Last). */
  dropCargo?(): CargoDrop | null;
  /** Hängt gerade eine Last am Fluggerät? */
  readonly cargoAttached?: boolean;
  /** Optionaler Hinweis fürs OSD (z. B. Handstart). */
  readonly statusHint?: string;
  /** Auf Startposition setzen. */
  reset(position: Vector3, yaw: number, ambientC: number): void;
  step(dt: number, sticks: Sticks, env: Environment, time: number): void;
  applySettings(settings: Settings): void;
  /** Kamera-Neigung (Grad), abhängig von Einstellungen und Fluggerät. */
  cameraTilt(settings: Settings): number;
}

export const RAD2DEG = 180 / Math.PI;

/** Abgeworfene Last: Startzustand für die Kistenphysik. */
export interface CargoDrop {
  position: Vector3;
  velocity: Vector3;
  mass: number;
  chuteArea: number;
}

/** Gyro-Raten in FC-Achsen aus der Körper-Winkelgeschwindigkeit (deg/s). */
export function bodyRatesToFc(w: Vector3, out: { roll: number; pitch: number; yaw: number }) {
  out.roll = -w.z * RAD2DEG;
  out.pitch = -w.x * RAD2DEG;
  out.yaw = -w.y * RAD2DEG;
  return out;
}

export { Quaternion };
