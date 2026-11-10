/**
 * Atmosphärenmodell nach ICAO-Standardatmosphäre (Troposphäre) mit
 * lokaler Bodentemperatur, Luftdruck (QNH) und Luftfeuchte.
 */

export interface AtmosphereParams {
  /** Luftdruck auf Meereshöhe, QNH (hPa). */
  seaLevelPressureHpa: number;
  /** Lufttemperatur am Boden des Levels (°C). */
  groundTemperatureC: number;
  /** Relative Luftfeuchte 0..1. */
  relativeHumidity: number;
  /** Höhe des Levelbodens über Meeresspiegel (m). */
  groundAltitude: number;
}

export interface AirState {
  /** Temperatur (K). */
  temperatureK: number;
  /** Luftdruck (Pa). */
  pressurePa: number;
  /** Luftdichte (kg/m³). */
  density: number;
}

const G = 9.80665;
/** Spezifische Gaskonstante trockene Luft (J/(kg·K)). */
const R_DRY = 287.058;
/** Spezifische Gaskonstante Wasserdampf (J/(kg·K)). */
const R_VAPOR = 461.495;
/** Temperaturgradient der Troposphäre (K/m). */
export const LAPSE_RATE = 0.0065;

/** Sättigungsdampfdruck nach Magnus (Pa), T in °C. */
export function saturationVaporPressure(tempC: number): number {
  return 610.78 * Math.pow(10, (7.5 * tempC) / (tempC + 237.3));
}

/**
 * Zustand der Luft in einer Höhe über Meeresspiegel.
 * Temperatur fällt mit 6.5 K/km, Druck folgt der barometrischen Höhenformel
 * für eine Atmosphäre mit konstantem Temperaturgradienten. Feuchte Luft ist leichter als trockene.
 */
export function airState(altitudeMsl: number, p: AtmosphereParams, out?: AirState): AirState {
  const o = out ?? { temperatureK: 0, pressurePa: 0, density: 0 };
  const tGround = p.groundTemperatureC + 273.15;
  // Temperatur auf Meereshöhe, so dass am Levelboden die eingestellte Temperatur herrscht
  const t0 = tGround + LAPSE_RATE * p.groundAltitude;
  const t = Math.max(180, t0 - LAPSE_RATE * altitudeMsl);
  const p0 = p.seaLevelPressureHpa * 100;
  const exponent = G / (R_DRY * LAPSE_RATE);
  const pressure = p0 * Math.pow(t / t0, exponent);
  const vapor = Math.min(pressure * 0.2, p.relativeHumidity * saturationVaporPressure(t - 273.15));
  o.temperatureK = t;
  o.pressurePa = pressure;
  o.density = (pressure - vapor) / (R_DRY * t) + vapor / (R_VAPOR * t);
  return o;
}
