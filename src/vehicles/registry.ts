import type { RatesSettings, Settings } from '../config/defaults';
import { PLANE_PRESETS, type PlanePresetId } from '../config/planes';
import { QUAD_PRESETS, type QuadPresetId } from '../config/quads';
import { PlaneVehicle } from './planeVehicle';
import { QuadVehicle } from './quadVehicle';
import type { Vehicle, VehicleKind } from './vehicle';

export interface VehicleInfo {
  id: string;
  kind: VehicleKind;
  name: string;
  description: string;
}

export const VEHICLES: VehicleInfo[] = [
  { id: 'whoop', kind: 'quad', name: 'Tiny Whoop 65 mm', description: '1S, 32 g, Ducts – langsam, robust, für drinnen' },
  { id: 'cinewhoop', kind: 'quad', name: 'Cinewhoop 3"', description: '4S, 420 g mit Kamera, Ducts – sanft, langsam, butterweich' },
  { id: 'freestyle5', kind: 'quad', name: 'Freestyle 5"', description: '6S, 650 g – der Allrounder' },
  { id: 'race5', kind: 'quad', name: 'Racer 5"', description: '6S, 470 g, Schub/Gewicht 12:1 – extrem direkt, sehr schnell' },
  { id: 'longrange7', kind: 'quad', name: 'Long Range 7"', description: '6S Li-Ion, 1050 g – träge, effizient, wenig Punch' },
  { id: 'bomber7', kind: 'quad', name: 'Sprengstoff-Drohne 7"', description: '6S, 1450 g mit Sprengladung – explodiert beim Einschlag (z. B. in ein Auto)' },
  { id: 'interceptor', kind: 'quad', name: 'Abfangdrohne', description: '6S, 500 g, Schub/Gewicht 13:1 – extrem schnell, kurze Flugzeit, zum Rammen' },
  { id: 'octo', kind: 'quad', name: 'Schwerlast-Oktokopter', description: '12S, 9 kg mit 3 kg Versorgungskiste – Abwurf mit B / 📦' },
  { id: 'trainer', kind: 'plane', name: 'Trainer (Hochdecker)', description: '1.4 m, Bugfahrwerk – Start von der Piste' },
  { id: 'wing', kind: 'plane', name: 'FPV-Nurflügler', description: '1.0 m, Druckpropeller, Handstart – schnell' },
  { id: 'glider', kind: 'plane', name: 'Segler 2 m', description: 'Elektrosegler, Handstart – Thermik nutzen' },
  { id: 'recon', kind: 'plane', name: 'Aufklärungsflügel', description: '2.2 m, Li-Ion, lange Flugzeit, Zoom-Kamera bis 8× (Z / 🔍)' },
];

export const DEFAULT_VEHICLE = 'freestyle5';

export function createVehicle(id: string, settings: Settings, dt: number): Vehicle {
  if (id in QUAD_PRESETS) return new QuadVehicle(id, QUAD_PRESETS[id as QuadPresetId], settings, dt);
  if (id in PLANE_PRESETS) return new PlaneVehicle(id, PLANE_PRESETS[id as PlanePresetId], settings);
  return new QuadVehicle(DEFAULT_VEHICLE, QUAD_PRESETS.freestyle5, settings, dt);
}

export function vehicleInfo(id: string): VehicleInfo {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES.find((v) => v.id === DEFAULT_VEHICLE)!;
}

/** Aktive Rates einer Drohne: eigene Anpassung oder Standard des Modells. */
export function ratesFor(settings: Settings, id: string): RatesSettings | null {
  if (!(id in QUAD_PRESETS)) return null;
  return settings.rateProfiles[id] ?? structuredClone(QUAD_PRESETS[id as QuadPresetId].tune.rates);
}

/** Standard-Rates eines Modells. */
export function defaultRates(id: string): RatesSettings | null {
  return id in QUAD_PRESETS ? structuredClone(QUAD_PRESETS[id as QuadPresetId].tune.rates) : null;
}
