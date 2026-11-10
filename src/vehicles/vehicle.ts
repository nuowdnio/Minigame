import { Quaternion, Vector3 } from 'three';
import type { Settings } from '../config/defaults';
import type { Environment } from '../env/environment';
import type { Sticks } from '../fc/flightController';
import type { Battery } from '../physics/battery';
import type { QuadTelemetry } from '../physics/quad';
import type { RigidBody } from '../physics/rigidbody';

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

/** Gyro-Raten in FC-Achsen aus der Körper-Winkelgeschwindigkeit (deg/s). */
export function bodyRatesToFc(w: Vector3, out: { roll: number; pitch: number; yaw: number }) {
  out.roll = -w.z * RAD2DEG;
  out.pitch = -w.x * RAD2DEG;
  out.yaw = -w.y * RAD2DEG;
  return out;
}

export { Quaternion };
