import type * as THREE from 'three';
import type { StaticWorld } from './collision';

/** Gemeinsame Beschreibung einer Spielwelt. */
export interface Arena {
  name: string;
  collision: StaticWorld;
  sun: THREE.DirectionalLight;
  /** Richtung zur Sonne (normiert), für die mitwandernde Schattenkamera. */
  sunDirection: THREE.Vector3;
  /** Startpunkte (Bodenpunkt + Blickrichtung als Gierwinkel). */
  spawns: { quad: THREE.Vector3; quadYaw: number; plane: THREE.Vector3; planeYaw: number };
  /** Standorte der Windsäcke. */
  windsocks: THREE.Vector3[];
}
