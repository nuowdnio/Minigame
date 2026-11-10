/**
 * Standardwerte der Umwelt (im Spiel unter Einstellungen → Umwelt überschreibbar).
 */
export interface EnvironmentSettings {
  /** Mittlerer Wind in 10 m Höhe (m/s). */
  windSpeed: number;
  /** Windrichtung, aus der der Wind kommt (Grad, 0 = Norden/vorne). */
  windDirection: number;
  /** Turbulenz/Böigkeit (0 = laminar, 1 = natürlich, 2 = stark böig). */
  turbulence: number;
  /** Thermik-Stärke im Kern (m/s), 0 = aus. */
  thermalStrength: number;
  /** Lufttemperatur am Boden (°C). Beeinflusst Luftdichte und Akku. */
  temperature: number;
  /** Relative Luftfeuchte (0..1). */
  humidity: number;
  /** Luftdruck auf Meereshöhe (hPa). */
  pressure: number;
  /** Höhe des Geländes über Meeresspiegel (m). */
  altitude: number;
}

export const DEFAULT_ENVIRONMENT: EnvironmentSettings = {
  windSpeed: 3,
  windDirection: 15,
  turbulence: 1,
  thermalStrength: 1.5,
  temperature: 18,
  humidity: 0.6,
  pressure: 1013.25,
  altitude: 150,
};

/** Rauigkeitslänge der Testwiese (m). */
export const GROUND_ROUGHNESS = 0.03;
