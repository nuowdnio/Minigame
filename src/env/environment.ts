import { Vector3 } from 'three';
import type { CollisionWorld } from '../world/collision';
import { SimpleCollisionWorld } from '../world/collision';

/** Umgebung, in der die Drohne fliegt (Wind, Höhe, Geometrie). */
export interface Environment {
  /** Höhe über Meeresspiegel, die y = 0 entspricht (m). */
  baseAltitude: number;
  collision: CollisionWorld;
  /** Windgeschwindigkeit (Welt, m/s) am Ort zur Zeit t. */
  wind(position: Vector3, time: number, out: Vector3): Vector3;
}

/** Windstille Umgebung auf Meereshöhe. */
export function createCalmEnvironment(collision: CollisionWorld = new SimpleCollisionWorld()): Environment {
  return {
    baseAltitude: 0,
    collision,
    wind: (_p, _t, out) => out.set(0, 0, 0),
  };
}
