/**
 * Flugzeug-Presets mit eigener Aerodynamik.
 *
 * Jede Fläche (Flügelhälfte, Höhenleitwerk, Seitenleitwerk, Winglet) wird einzeln berechnet:
 * lokale Anströmung inkl. Drehbewegung (ω × r), Wind am Ort der Fläche, Abwind des Flügels
 * am Leitwerk, Propellerstrahl über dem Leitwerk. Daraus ergeben sich Stabilität, Dämpfung,
 * Strömungsabriss, Trudeln und Ruderwirkung ohne Sonderregeln.
 *
 * Koordinaten: Körper-System wie die Drohnen (x rechts, y oben, z hinten), Ursprung = Schwerpunkt.
 */
import type { MotorParams } from '../physics/motor';
import type { BatteryParams } from '../physics/battery';
import type { ContactParams } from '../physics/contacts';
import { PHYSICS, type ContactPointDef, type Vec3Like } from './physics';

export interface ControlSurfaceDef {
  /** Rudertiefe relativ zur Flächentiefe. */
  chordFraction: number;
  /** Anteil der Spannweite mit Ruder. */
  spanFraction: number;
  /** Maximaler Ausschlag (Grad). */
  maxDeg: number;
  /** Zumischung der Steuerachsen (+1 = Stick positiv → Hinterkante runter). */
  mix: { roll?: number; pitch?: number; yaw?: number };
}

export interface SurfaceDef {
  name: string;
  /** Neutralpunkt der Fläche (≈ 25 % Tiefe), Körper-System (m). */
  position: Vec3Like;
  span: number;
  chord: number;
  orientation: 'horizontal' | 'vertical';
  /** V-Form (Grad, + = Spitze oben). Vorzeichen der Seite ergibt sich aus position.x. */
  dihedralDeg?: number;
  /** Einstellwinkel (Grad, + = Vorderkante oben). */
  incidenceDeg?: number;
  /** Seitenverhältnis der Gesamtfläche (für Auftriebsanstieg/induzierten Widerstand). */
  aspectRatio: number;
  cl0?: number;
  cd0: number;
  oswald?: number;
  stallDeg: number;
  /** Nickmoment-Beiwert um den Neutralpunkt (Wölbung/Reflex). */
  cm0?: number;
  control?: ControlSurfaceDef;
  /** Namen der Flügelflächen, deren Abwind auf diese Fläche wirkt. */
  downwashFrom?: string[];
  /** Anteil der Fläche im Propellerstrahl (0..1). */
  slipstream?: number;
}

export interface PlaneControlConfig {
  /** Max. Drehraten im Stabilisiert-/Angle-Modus (deg/s). */
  maxRate: { roll: number; pitch: number; yaw: number };
  /** Max. Querneigung / Längsneigung im Angle-Modus (Grad). */
  maxBank: number;
  maxPitch: number;
  /** Ratenregler-Verstärkung (Ruderausschlag pro deg/s Fehler bei Referenzgeschwindigkeit). */
  rateGain: { roll: number; pitch: number; yaw: number };
  /** Referenz-Fluggeschwindigkeit für die Verstärkungsanpassung (m/s). */
  refSpeed: number;
  /** Expo der Ruderausschläge (0..1). */
  expo: number;
  /** Höhenruder-Trimmung (−1..1). */
  pitchTrim: number;
  /** Querruder-Trimmung gegen das Propeller-Drehmoment bei 50 % Gas (−1..1), skaliert mit dem Schub. */
  rollTrim: number;
  /** Servogeschwindigkeit (deg/s Ruderausschlag). */
  servoRate: number;
}

export interface PlaneSpawn {
  /** true = startet am Boden (Fahrwerk), false = Handstart. */
  onGround: boolean;
  height: number;
  speed: number;
  pitchDeg: number;
}

export interface PlaneDamageLimits {
  /** Bruchlast des Flügels als Lastvielfaches (g). */
  maxG: number;
  /** Höchstzulässige Geschwindigkeit (m/s), darüber Flattern. */
  vne: number;
  /** Fahrwerk reißt ab (Aufprall m/s). */
  gearBreak: number;
  /** Flügel/Leitwerk bricht bei Bodenberührung (m/s). */
  wingBreak: number;
  /** Rumpf zerstört (m/s). */
  bodyBreak: number;
}

export interface PlaneConfig {
  damage: PlaneDamageLimits;
  mass: number;
  inertia: Vec3Like;
  surfaces: SurfaceDef[];
  fuselage: { linearDrag: Vec3Like; dragArea: Vec3Like };
  motor: MotorParams & { position: Vec3Like; spin: 1 | -1; slipstreamFactor: number };
  battery: BatteryParams;
  contactPoints: ContactPointDef[];
  contact: ContactParams;
  /** Max. Lenkwinkel des Bug-/Spornrads (Grad). */
  steerMaxDeg: number;
  control: PlaneControlConfig;
  spawn: PlaneSpawn;
  air: { seaLevelDensity: number };
  gravity: number;
  visual: {
    fuselageLength: number;
    fuselageWidth: number;
    fuselageNose: number;
    color: number;
    accent: number;
    size: number;
  };
  cameraMount: Vec3Like;
  cameraTiltDeg: number;
}

const BASE_MOTOR = PHYSICS.motor;

function battery(cells: number, capacityMah: number, ir: number, heat: number): BatteryParams {
  return {
    ...structuredClone(PHYSICS.battery),
    cells,
    capacityMah,
    internalResistance: ir,
    polarizationResistance: ir * 0.4,
    idleCurrent: 0.5,
    heatCapacity: heat,
  };
}

const PLANE_CONTACT: ContactParams = {
  restitution: 0.15,
  friction: 0.55,
  positionCorrection: 0.6,
  iterations: 3,
  rollingResistance: 0.035,
};

export const PLANE_PRESETS = {
  trainer: {
    damage: { maxG: 6, vne: 32, gearBreak: 3.5, wingBreak: 6, bodyBreak: 13 },
    mass: 1.25,
    inertia: { x: 0.075, y: 0.16, z: 0.095 },
    surfaces: [
      {
        name: 'wingR', position: { x: 0.35, y: 0.09, z: -0.012 }, span: 0.7, chord: 0.22,
        orientation: 'horizontal', dihedralDeg: 3, incidenceDeg: 2, aspectRatio: 6.4,
        cl0: 0.25, cd0: 0.012, oswald: 0.8, stallDeg: 14, cm0: -0.05,
        control: { chordFraction: 0.25, spanFraction: 0.55, maxDeg: 18, mix: { roll: -1 } },
      },
      {
        name: 'wingL', position: { x: -0.35, y: 0.09, z: -0.012 }, span: 0.7, chord: 0.22,
        orientation: 'horizontal', dihedralDeg: 3, incidenceDeg: 2, aspectRatio: 6.4,
        cl0: 0.25, cd0: 0.012, oswald: 0.8, stallDeg: 14, cm0: -0.05,
        control: { chordFraction: 0.25, spanFraction: 0.55, maxDeg: 18, mix: { roll: 1 } },
      },
      {
        name: 'stab', position: { x: 0, y: 0.03, z: 0.78 }, span: 0.5, chord: 0.13,
        orientation: 'horizontal', incidenceDeg: 1.0, aspectRatio: 3.8,
        cd0: 0.012, oswald: 0.75, stallDeg: 15, downwashFrom: ['wingR', 'wingL'], slipstream: 0.35,
        control: { chordFraction: 0.4, spanFraction: 1, maxDeg: 22, mix: { pitch: 1 } },
      },
      {
        name: 'fin', position: { x: 0, y: 0.12, z: 0.8 }, span: 0.2, chord: 0.15,
        orientation: 'vertical', aspectRatio: 2.6,
        cd0: 0.012, oswald: 0.75, stallDeg: 16, slipstream: 0.5,
        control: { chordFraction: 0.45, spanFraction: 1, maxDeg: 28, mix: { yaw: -1 } },
      },
    ],
    fuselage: { linearDrag: { x: 0.03, y: 0.03, z: 0.01 }, dragArea: { x: 0.03, y: 0.035, z: 0.008 } },
    motor: {
      ...BASE_MOTOR,
      kv: 1000, maxThrust: 14, torqueToThrust: 0.022, idle: 0, rotorInertia: 4e-5,
      windingResistance: 0.06, noLoadCurrent: 1.0, escCurrentLimit: 40,
      motorHeatCapacity: 50, motorCooling: 0.4, motorCoolingPerKrads: 0.8, motorMaxTemp: 170,
      escHeatCapacity: 4, escResistance: 0.005, escCooling: 0.4, escMaxTemp: 120,
      propDiameter: 0.254, propPitch: 0.152, zeroThrustSpeedFactor: 1.25, maxInflowGain: 1.1,
      position: { x: 0, y: 0.02, z: -0.52 }, spin: 1, slipstreamFactor: 0.9,
    },
    battery: battery(3, 2200, 0.03, 180),
    contactPoints: [
      { position: { x: 0.14, y: -0.17, z: 0.05 }, radius: 0.035, wheel: true, part: 'gear' },
      { position: { x: -0.14, y: -0.17, z: 0.05 }, radius: 0.035, wheel: true, part: 'gear' },
      { position: { x: 0, y: -0.17, z: -0.42 }, radius: 0.03, wheel: true, steerable: true, part: 'gear' },
      { position: { x: 0.7, y: 0.12, z: 0 }, radius: 0.03, part: 'wingR' },
      { position: { x: -0.7, y: 0.12, z: 0 }, radius: 0.03, part: 'wingL' },
      { position: { x: 0, y: -0.02, z: 0.86 }, radius: 0.03, part: 'stab' },
      { position: { x: 0, y: 0.23, z: 0.84 }, radius: 0.03, part: 'fin' },
      { position: { x: 0, y: 0.02, z: -0.56 }, radius: 0.045, part: 'prop' },
      { position: { x: 0, y: -0.05, z: 0.3 }, radius: 0.03, part: 'body' },
      { position: { x: 0, y: 0.12, z: -0.1 }, radius: 0.04, part: 'body' },
    ],
    contact: PLANE_CONTACT,
    steerMaxDeg: 25,
    control: {
      maxRate: { roll: 200, pitch: 120, yaw: 60 },
      maxBank: 50, maxPitch: 30,
      rateGain: { roll: 0.006, pitch: 0.008, yaw: 0.012 },
      refSpeed: 14, expo: 0.35, pitchTrim: 0, rollTrim: 0.025, servoRate: 400,
    },
    spawn: { onGround: true, height: 0.21, speed: 0, pitchDeg: 0 },
    air: { seaLevelDensity: 1.225 },
    gravity: 9.81,
    visual: { fuselageLength: 1.0, fuselageWidth: 0.1, fuselageNose: -0.55, color: 0xf2f2f2, accent: 0xd62828, size: 1.6 },
    cameraMount: { x: 0, y: 0.08, z: -0.25 },
    cameraTiltDeg: 0,
  },

  wing: {
    damage: { maxG: 10, vne: 45, gearBreak: 99, wingBreak: 8, bodyBreak: 16 },
    mass: 0.95,
    inertia: { x: 0.022, y: 0.05, z: 0.03 },
    surfaces: [
      {
        name: 'wingR', position: { x: 0.25, y: 0, z: 0.028 }, span: 0.5, chord: 0.22,
        orientation: 'horizontal', dihedralDeg: 2, incidenceDeg: 0, aspectRatio: 4.5,
        cl0: 0.05, cd0: 0.011, oswald: 0.85, stallDeg: 13, cm0: 0.04,
        control: { chordFraction: 0.22, spanFraction: 0.65, maxDeg: 20, mix: { pitch: 1, roll: -1 } },
      },
      {
        name: 'wingL', position: { x: -0.25, y: 0, z: 0.028 }, span: 0.5, chord: 0.22,
        orientation: 'horizontal', dihedralDeg: 2, incidenceDeg: 0, aspectRatio: 4.5,
        cl0: 0.05, cd0: 0.011, oswald: 0.85, stallDeg: 13, cm0: 0.04,
        control: { chordFraction: 0.22, spanFraction: 0.65, maxDeg: 20, mix: { pitch: 1, roll: 1 } },
      },
      {
        name: 'wingletR', position: { x: 0.5, y: 0.05, z: 0.14 }, span: 0.12, chord: 0.12,
        orientation: 'vertical', aspectRatio: 1.5, cd0: 0.012, oswald: 0.7, stallDeg: 18,
      },
      {
        name: 'wingletL', position: { x: -0.5, y: 0.05, z: 0.14 }, span: 0.12, chord: 0.12,
        orientation: 'vertical', aspectRatio: 1.5, cd0: 0.012, oswald: 0.7, stallDeg: 18,
      },
    ],
    fuselage: { linearDrag: { x: 0.02, y: 0.02, z: 0.006 }, dragArea: { x: 0.012, y: 0.02, z: 0.006 } },
    motor: {
      ...BASE_MOTOR,
      kv: 2300, maxThrust: 13, torqueToThrust: 0.012, idle: 0, rotorInertia: 6e-6,
      windingResistance: 0.05, noLoadCurrent: 1.2, escCurrentLimit: 50,
      motorHeatCapacity: 25, motorCooling: 0.3, motorCoolingPerKrads: 0.4, motorMaxTemp: 170,
      escHeatCapacity: 3, escResistance: 0.005, escCooling: 0.4, escMaxTemp: 120,
      propDiameter: 0.152, propPitch: 0.102, zeroThrustSpeedFactor: 1.3, maxInflowGain: 1.1,
      position: { x: 0, y: 0, z: 0.2 }, spin: 1, slipstreamFactor: 0,
    },
    battery: battery(4, 1800, 0.035, 190),
    contactPoints: [
      { position: { x: 0, y: -0.035, z: -0.15 }, radius: 0.025, part: 'body' },
      { position: { x: 0, y: -0.035, z: 0.1 }, radius: 0.025, part: 'body' },
      { position: { x: 0.5, y: 0, z: 0.12 }, radius: 0.025, part: 'wingR' },
      { position: { x: -0.5, y: 0, z: 0.12 }, radius: 0.025, part: 'wingL' },
      { position: { x: 0, y: 0.03, z: 0.22 }, radius: 0.04, part: 'prop' },
      { position: { x: 0, y: 0, z: -0.24 }, radius: 0.03, part: 'body' },
      { position: { x: 0, y: 0.05, z: -0.05 }, radius: 0.03, part: 'body' },
    ],
    contact: PLANE_CONTACT,
    steerMaxDeg: 0,
    control: {
      maxRate: { roll: 280, pitch: 160, yaw: 0 },
      maxBank: 55, maxPitch: 35,
      rateGain: { roll: 0.004, pitch: 0.006, yaw: 0 },
      refSpeed: 18, expo: 0.4, pitchTrim: 0, rollTrim: 0.01, servoRate: 450,
    },
    spawn: { onGround: false, height: 1.8, speed: 11, pitchDeg: 8 },
    air: { seaLevelDensity: 1.225 },
    gravity: 9.81,
    visual: { fuselageLength: 0.42, fuselageWidth: 0.09, fuselageNose: -0.24, color: 0x2e3440, accent: 0xff8c00, size: 1.2 },
    cameraMount: { x: 0, y: 0.04, z: -0.2 },
    cameraTiltDeg: 5,
  },

  glider: {
    damage: { maxG: 5, vne: 30, gearBreak: 99, wingBreak: 5, bodyBreak: 12 },
    mass: 0.95,
    inertia: { x: 0.06, y: 0.33, z: 0.28 },
    surfaces: [
      {
        name: 'wingR', position: { x: 0.5, y: 0.06, z: -0.008 }, span: 1.0, chord: 0.18,
        orientation: 'horizontal', dihedralDeg: 5, incidenceDeg: 2.5, aspectRatio: 11,
        cl0: 0.35, cd0: 0.009, oswald: 0.9, stallDeg: 12, cm0: -0.07,
        control: { chordFraction: 0.22, spanFraction: 0.4, maxDeg: 15, mix: { roll: -1 } },
      },
      {
        name: 'wingL', position: { x: -0.5, y: 0.06, z: -0.008 }, span: 1.0, chord: 0.18,
        orientation: 'horizontal', dihedralDeg: 5, incidenceDeg: 2.5, aspectRatio: 11,
        cl0: 0.35, cd0: 0.009, oswald: 0.9, stallDeg: 12, cm0: -0.07,
        control: { chordFraction: 0.22, spanFraction: 0.4, maxDeg: 15, mix: { roll: 1 } },
      },
      {
        name: 'stab', position: { x: 0, y: 0.03, z: 0.95 }, span: 0.42, chord: 0.1,
        orientation: 'horizontal', incidenceDeg: 1.5, aspectRatio: 4.2,
        cd0: 0.01, oswald: 0.8, stallDeg: 14, downwashFrom: ['wingR', 'wingL'], slipstream: 0.15,
        control: { chordFraction: 0.4, spanFraction: 1, maxDeg: 18, mix: { pitch: 1 } },
      },
      {
        name: 'fin', position: { x: 0, y: 0.11, z: 0.98 }, span: 0.18, chord: 0.13,
        orientation: 'vertical', aspectRatio: 2.8, cd0: 0.01, oswald: 0.75, stallDeg: 16, slipstream: 0.2,
        control: { chordFraction: 0.45, spanFraction: 1, maxDeg: 30, mix: { yaw: -1 } },
      },
    ],
    fuselage: { linearDrag: { x: 0.02, y: 0.02, z: 0.004 }, dragArea: { x: 0.02, y: 0.02, z: 0.004 } },
    motor: {
      ...BASE_MOTOR,
      kv: 1100, maxThrust: 9, torqueToThrust: 0.02, idle: 0, rotorInertia: 2.5e-5,
      windingResistance: 0.07, noLoadCurrent: 0.8, escCurrentLimit: 30,
      motorHeatCapacity: 35, motorCooling: 0.35, motorCoolingPerKrads: 0.7, motorMaxTemp: 170,
      escHeatCapacity: 3, escResistance: 0.006, escCooling: 0.35, escMaxTemp: 120,
      propDiameter: 0.229, propPitch: 0.152, zeroThrustSpeedFactor: 1.25, maxInflowGain: 1.1,
      position: { x: 0, y: 0.0, z: -0.48 }, spin: 1, slipstreamFactor: 0.9,
    },
    battery: battery(3, 1300, 0.04, 110),
    contactPoints: [
      { position: { x: 0, y: -0.04, z: -0.3 }, radius: 0.025, part: 'body' },
      { position: { x: 0, y: -0.035, z: 0.2 }, radius: 0.025, part: 'body' },
      { position: { x: 1.0, y: 0.15, z: 0 }, radius: 0.025, part: 'wingR' },
      { position: { x: -1.0, y: 0.15, z: 0 }, radius: 0.025, part: 'wingL' },
      { position: { x: 0, y: 0.0, z: 1.0 }, radius: 0.025, part: 'stab' },
      { position: { x: 0, y: 0.2, z: 1.0 }, radius: 0.025, part: 'fin' },
      { position: { x: 0, y: 0, z: -0.5 }, radius: 0.035, part: 'prop' },
      { position: { x: 0, y: 0.08, z: 0 }, radius: 0.03, part: 'body' },
    ],
    contact: PLANE_CONTACT,
    steerMaxDeg: 0,
    control: {
      maxRate: { roll: 120, pitch: 90, yaw: 50 },
      maxBank: 45, maxPitch: 25,
      rateGain: { roll: 0.01, pitch: 0.01, yaw: 0.015 },
      refSpeed: 10, expo: 0.3, pitchTrim: 0, rollTrim: 0.018, servoRate: 300,
    },
    spawn: { onGround: false, height: 1.8, speed: 10, pitchDeg: 4 },
    air: { seaLevelDensity: 1.225 },
    gravity: 9.81,
    visual: { fuselageLength: 1.1, fuselageWidth: 0.06, fuselageNose: -0.5, color: 0xffffff, accent: 0x1971c2, size: 2.2 },
    cameraMount: { x: 0, y: 0.05, z: -0.38 },
    cameraTiltDeg: 0,
  },
} satisfies Record<string, PlaneConfig>;

export type PlanePresetId = keyof typeof PLANE_PRESETS;
