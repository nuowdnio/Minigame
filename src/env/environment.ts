import { Vector3 } from 'three';
import { DEFAULT_ENVIRONMENT, GROUND_ROUGHNESS, type EnvironmentSettings } from '../config/environment';
import type { CollisionWorld } from '../world/collision';
import { SimpleCollisionWorld } from '../world/collision';
import { airState, type AirState, type AtmosphereParams } from './atmosphere';
import { WindField, type WindObstacle } from './wind';

/** Umgebung, in der geflogen wird (Luft, Wind, Geometrie). */
export interface Environment {
  /** Höhe über Meeresspiegel, die y = 0 entspricht (m). */
  baseAltitude: number;
  collision: CollisionWorld;
  /** Windgeschwindigkeit (Welt, m/s) am Ort zur Zeit t. */
  wind(position: Vector3, time: number, out: Vector3): Vector3;
  /** Luftzustand (Dichte, Temperatur, Druck) in Höhe y. */
  air(y: number, out: AirState): AirState;
  /** Lufttemperatur am Boden (°C), z. B. für die Akkutemperatur. */
  groundTemperatureC: number;
}

function atmosphereFrom(s: EnvironmentSettings): AtmosphereParams {
  return {
    seaLevelPressureHpa: s.pressure,
    groundTemperatureC: s.temperature,
    relativeHumidity: s.humidity,
    groundAltitude: s.altitude,
  };
}

/**
 * Vollständige Umgebung mit Atmosphäre und Windfeld.
 * Kann zur Laufzeit über update() an neue Einstellungen angepasst werden.
 */
export class WorldEnvironment implements Environment {
  baseAltitude: number;
  groundTemperatureC: number;
  readonly windField: WindField;
  private atmosphere: AtmosphereParams;

  constructor(
    readonly collision: CollisionWorld,
    settings: EnvironmentSettings = DEFAULT_ENVIRONMENT,
    obstacles: WindObstacle[] = [],
    seed = 7,
  ) {
    this.baseAltitude = settings.altitude;
    this.groundTemperatureC = settings.temperature;
    this.atmosphere = atmosphereFrom(settings);
    this.windField = new WindField(
      {
        speed: settings.windSpeed,
        directionDeg: settings.windDirection,
        turbulence: settings.turbulence,
        roughness: GROUND_ROUGHNESS,
        thermalStrength: settings.thermalStrength,
        seed,
      },
      obstacles,
    );
  }

  update(settings: EnvironmentSettings): void {
    this.baseAltitude = settings.altitude;
    this.groundTemperatureC = settings.temperature;
    this.atmosphere = atmosphereFrom(settings);
    this.windField.setParams({
      ...this.windField.params,
      speed: settings.windSpeed,
      directionDeg: settings.windDirection,
      turbulence: settings.turbulence,
      thermalStrength: settings.thermalStrength,
    });
  }

  wind(p: Vector3, t: number, out: Vector3): Vector3 {
    return this.windField.sample(p, t, out);
  }

  air(y: number, out: AirState): AirState {
    return airState(this.baseAltitude + y, this.atmosphere, out);
  }
}

/** Windstille Normatmosphäre auf Meereshöhe (15 °C, trocken) – für Tests. */
export function createCalmEnvironment(collision: CollisionWorld = new SimpleCollisionWorld()): Environment {
  const atmo: AtmosphereParams = {
    seaLevelPressureHpa: 1013.25,
    groundTemperatureC: 15,
    relativeHumidity: 0,
    groundAltitude: 0,
  };
  return {
    baseAltitude: 0,
    groundTemperatureC: 15,
    collision,
    wind: (_p, _t, out) => out.set(0, 0, 0),
    air(y, out) {
      return airState(this.baseAltitude + y, atmo, out);
    },
  };
}
