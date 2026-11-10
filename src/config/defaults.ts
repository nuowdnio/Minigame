import { DEFAULT_ENVIRONMENT, type EnvironmentSettings } from './environment';

/**
 * Standardwerte für die vom Spieler einstellbaren Optionen (Einstellungsmenü).
 * Werden im localStorage überschrieben.
 */

export interface AxisRates {
  /** Betaflight "RC Rate" (0.01 – 2.55). */
  rcRate: number;
  /** Betaflight "Super Rate" (0 – 0.99). */
  superRate: number;
  /** Betaflight "RC Expo" (0 – 1). */
  expo: number;
}

export interface RatesSettings {
  roll: AxisRates;
  pitch: AxisRates;
  yaw: AxisRates;
  /** Gaskurve: Mittelpunkt (0..1). */
  throttleMid: number;
  /** Gaskurve: Expo (0..1). */
  throttleExpo: number;
}

export type FlightMode = 'acro' | 'angle' | 'horizon';
export type CameraView = 'fpv' | 'chase';

export type PlaneMode = 'manual' | 'gyro' | 'angle';

export interface Settings {
  /** Gewähltes Fluggerät (siehe vehicles/registry.ts). */
  vehicle: string;
  rates: RatesSettings;
  flightMode: FlightMode;
  /** Flugmodus für Flugzeuge: manuell, stabilisiert (Gyro) oder lagestabilisiert (Angle). */
  planeMode: PlaneMode;
  environment: EnvironmentSettings;
  camera: {
    /** Kamerawinkel nach oben (Uptilt) in Grad, 0 – 50. */
    angle: number;
    /** Horizontales Sichtfeld in Grad. */
    fov: number;
    view: CameraView;
  };
  input: {
    /** Stick-Mode: 2 = Gas links (Standard), 1 = Gas rechts. */
    stickMode: 1 | 2;
    /** Totzone für Gamepad-Sticks (0..0.2). */
    deadband: number;
    /** Bildschirm-Sticks: auto = nur auf Touch-Geräten (iPad, Tablet). */
    touchControls: 'auto' | 'on' | 'off';
    /** Radius der Touch-Sticks (px). Kleiner = empfindlicher. */
    touchStickSize: number;
  };
  graphics: {
    quality: 'low' | 'medium' | 'high';
  };
}

export const DEFAULT_SETTINGS: Settings = {
  vehicle: 'freestyle5',
  rates: {
    roll: { rcRate: 1.0, superRate: 0.7, expo: 0.0 },
    pitch: { rcRate: 1.0, superRate: 0.7, expo: 0.0 },
    yaw: { rcRate: 1.0, superRate: 0.7, expo: 0.0 },
    throttleMid: 0.5,
    throttleExpo: 0.0,
  },
  flightMode: 'acro',
  planeMode: 'gyro',
  environment: { ...DEFAULT_ENVIRONMENT },
  camera: {
    angle: 25,
    fov: 120,
    view: 'fpv',
  },
  input: {
    stickMode: 2,
    deadband: 0.03,
    touchControls: 'auto',
    touchStickSize: 75,
  },
  graphics: {
    quality: 'high',
  },
};
