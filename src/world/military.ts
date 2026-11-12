import { Vector3 } from 'three';
import type { Jammer } from '../game/radio';

export type HazardKind = 'roadblock' | 'object' | 'vehicle';

export interface HazardDef {
  position: Vector3;
  kind: HazardKind;
  yaw: number;
}

export interface EnemyRouteDef {
  /** Einflugpunkt (weit außerhalb). */
  entry: Vector3;
  /** Mittelpunkt des Kreisens über dem Aufklärungsziel. */
  loiter: Vector3;
  /** Ausflugpunkt. */
  exit: Vector3;
}

/** Militärische Elemente einer Karte (fiktives Übungsszenario). */
export interface MilitaryLayout {
  /** Konvoi-Route (Wegpunkte auf Straßen). */
  convoyRoute: Vector3[];
  hazards: HazardDef[];
  jammers: Jammer[];
  airDefense: Vector3[];
  dropZones: Vector3[];
  enemyRoutes: EnemyRouteDef[];
  spawns: {
    convoy: { position: Vector3; yaw: number };
    intercept: { position: Vector3; yaw: number };
  };
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Layout für die Kleinstadt "Flugdorf" mit Flugplatz. */
export function townMilitaryLayout(): MilitaryLayout {
  return {
    // West -> Ost durch die Stadt, Umweg um den Marktplatz, dann zur Flugplatzeinfahrt
    convoyRoute: [v(-262, 0, 0), v(90, 0, 0), v(90, 0, -90), v(180, 0, -90), v(180, 0, 0), v(370, 0, 0)],
    hazards: [
      // Straßensperren stehen quer zur Fahrbahn
      { position: v(-150, 0, 0), kind: 'roadblock', yaw: Math.PI / 2 },
      { position: v(40, 0, 3.6), kind: 'object', yaw: 0 },
      { position: v(93.4, 0, -55), kind: 'vehicle', yaw: Math.PI / 2 },
      { position: v(180, 0, -40), kind: 'roadblock', yaw: 0 },
    ],
    jammers: [
      { position: v(245, 3, 75), radius: 170, power: 1.3 },
      { position: v(-60, 3, -215), radius: 150, power: 1.1 },
    ],
    // Stellungen so gesetzt, dass Startpunkte gedeckt sind und jede Gefahr auch aus der Deckung
    // heraus gemeldet werden kann (siehe tests/game/missionLayout.test.ts)
    airDefense: [v(120, 0, -20), v(-60, 0, 80), v(-260, 0, 240), v(660, 0, -110)],
    dropZones: [v(610, 0, -170), v(-225, 0, 180), v(-45, 0, 45)],
    // Einflug ~1 km außerhalb (ca. 50 s bis zum Ziel), Ausflug ~1.3 km
    enemyRoutes: [
      { entry: v(-900, 70, -380), loiter: v(0, 80, 0), exit: v(800, 90, 1100) },
      { entry: v(1250, 90, -700), loiter: v(560, 85, 0), exit: v(-1100, 80, 500) },
      { entry: v(-700, 75, 950), loiter: v(-200, 70, 150), exit: v(1100, 85, -900) },
      { entry: v(1300, 65, 700), loiter: v(300, 75, -150), exit: v(-1000, 90, -950) },
    ],
    spawns: {
      convoy: { position: v(-250, 0.03, -9), yaw: -Math.PI / 2 },
      intercept: { position: v(560, 0, 0), yaw: 0 },
    },
  };
}
