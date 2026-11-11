/**
 * Drohnen-Presets. Jede Drohne hat eigene Physikwerte (Masse, Trägheit, Motoren, Akku,
 * Aerodynamik) und ein eigenes PID-Tuning. Basis ist der 5"-Freestyle-Quad aus physics.ts.
 */
import type { RatesSettings } from './defaults';
import type { AxisPid } from './flightController';
import { PHYSICS, type ContactPointDef, type MotorLayoutEntry, type QuadConfig } from './physics';

/** Flight-Controller-Abstimmung, wie ein Pilot sie für sein Modell einstellt. */
export interface QuadTune {
  /** Standard-Rates des Modells (im Menü je Modell änderbar). */
  rates: RatesSettings;
  tpaRate: number;
  tpaBreakpoint: number;
  thrustLinear: number;
  vbatSagComp: number;
  gyroLowpassHz: number;
  dtermLowpassHz: number;
  feedforwardLowpassHz: number;
}

/** Nutzlast mit Sprengladung (Spielmechanik). */
export interface PayloadConfig {
  kind: 'explosive';
  /** Wirkradius der Explosion (m). */
  blastRadius: number;
  /** Zünder wird nach so vielen Sekunden Flugzeit scharf (Startschutz). */
  armTime: number;
  /** Aufprallgeschwindigkeit, ab der die Ladung immer zündet (m/s). */
  impactTrigger: number;
}

/** Abwerfbare Last (Versorgungskiste) unter dem Rahmen. */
export interface CargoConfig {
  /** Masse der Last (kg), in frame.mass enthalten. */
  mass: number;
  /** Anteil der Last an den Trägheitsmomenten (kg·m²). */
  inertia: { x: number; y: number; z: number };
  /** Aufhängepunkt unter dem Schwerpunkt (m). */
  hangY: number;
  /** Fallschirm-Widerstandsfläche Cd·A (m²) nach dem Öffnen. */
  chuteArea: number;
}

export interface QuadPreset {
  physics: QuadConfig;
  cargo?: CargoConfig;
  /** Zoomstufen der Kamera. */
  zoomLevels?: number[];
  pid: { roll: AxisPid; pitch: AxisPid; yaw: AxisPid };
  tune: QuadTune;
  payload?: PayloadConfig;
  /** Optik */
  visual: {
    ducts: boolean;
    frameColor: number;
    propColorFront: number;
    propColorRear: number;
    batteryColor: number;
    /** Größe (m) für die Verfolgerkamera. */
    size: number;
    /** Nutzlast unter dem Rahmen anzeigen. */
    payload?: boolean;
  };
  /** FPV-Kamera-Montage im Körper-System (m). */
  cameraMount: { x: number; y: number; z: number };
  /** Bruchgrenzen (Aufprallgeschwindigkeit in m/s). */
  damage: {
    /** Propeller bekommt Macken. */
    propChip: number;
    /** Propeller bricht. */
    propBreak: number;
    /** Arm bricht (Motor fällt ab). */
    armBreak: number;
    /** Rahmen/Elektronik zerstört. */
    frameBreak: number;
  };
}

/** Quad-X-Motorlayout ("Props in") für den gegebenen Achsabstand je Achse. */
function quadX(armX: number, armZ = armX): MotorLayoutEntry[] {
  return [
    { name: 'RR', position: { x: armX, y: 0, z: armZ }, spin: 1 },
    { name: 'FR', position: { x: armX, y: 0, z: -armZ }, spin: -1 },
    { name: 'RL', position: { x: -armX, y: 0, z: armZ }, spin: -1 },
    { name: 'FL', position: { x: -armX, y: 0, z: -armZ }, spin: 1 },
  ];
}

/** Flacher Oktokopter: 8 Motoren auf einem Kreis, Drehsinn abwechselnd. */
function octoFlat(radius: number): MotorLayoutEntry[] {
  return Array.from({ length: 8 }, (_, i) => {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    return {
      name: `M${i + 1}`,
      position: { x: Math.sin(a) * radius, y: 0, z: -Math.cos(a) * radius },
      spin: (i % 2 === 0 ? 1 : -1) as 1 | -1,
    };
  });
}

/** Kontaktkugeln passend zur Rahmengröße. */
function contacts(armX: number, armZ: number, r: number, top: number): ContactPointDef[] {
  return [
    { position: { x: armX, y: -0.15 * r, z: armZ }, radius: r },
    { position: { x: armX, y: -0.15 * r, z: -armZ }, radius: r },
    { position: { x: -armX, y: -0.15 * r, z: armZ }, radius: r },
    { position: { x: -armX, y: -0.15 * r, z: -armZ }, radius: r },
    { position: { x: 0, y: -r, z: 0 }, radius: r },
    { position: { x: 0, y: top, z: 0 }, radius: r * 1.2 },
  ];
}

const LIION_CURVE: [number, number][] = [
  [0.0, 2.8],
  [0.05, 3.1],
  [0.1, 3.3],
  [0.2, 3.45],
  [0.3, 3.55],
  [0.4, 3.62],
  [0.5, 3.68],
  [0.6, 3.76],
  [0.7, 3.85],
  [0.8, 3.95],
  [0.9, 4.07],
  [1.0, 4.2],
];

/** HV-LiPo (1S Whoop-Akkus): voll geladen 4.35 V. */
const LIHV_CURVE: [number, number][] = PHYSICS.battery.ocvCurve.map(([s, v]) => [s, v + (s > 0.5 ? 0.15 * (s - 0.5) * 2 : 0)]);

function derive(mod: (c: QuadConfig) => void): QuadConfig {
  const c = structuredClone(PHYSICS);
  mod(c);
  return c;
}

export const QUAD_PRESETS = {
  whoop: {
    physics: derive((c) => {
      c.frame.mass = 0.032;
      c.frame.inertia = { x: 1.6e-5, y: 2.8e-5, z: 1.5e-5 };
      c.frame.motors = quadX(0.0233);
      c.frame.contactPoints = contacts(0.0233, 0.0233, 0.012, 0.018);
      Object.assign(c.motor, {
        kv: 19000,
        maxThrust: 0.3,
        torqueToThrust: 0.007,
        idle: 0.06,
        rotorInertia: 2.5e-8,
        windingResistance: 0.45,
        noLoadCurrent: 0.12,
        escCurrentLimit: 5,
        motorHeatCapacity: 1,
        motorCooling: 0.02,
        motorCoolingPerKrads: 0.03,
        motorMaxTemp: 160,
        escHeatCapacity: 0.3,
        escResistance: 0.02,
        escCooling: 0.03,
        escMaxTemp: 120,
        propDiameter: 0.031,
        propPitch: 0.019,
        zeroThrustSpeedFactor: 1.4,
        ductGain: 1.12,
        translationalLift: 0.05,
      });
      Object.assign(c.battery, {
        cells: 1,
        capacityMah: 300,
        internalResistance: 0.09,
        polarizationResistance: 0.04,
        polarizationTau: 2,
        idleCurrent: 0.25,
        ocvCurve: LIHV_CURVE,
        heatCapacity: 7,
        coolingStill: 0.02,
        coolingPerSpeed: 0.004,
      });
      Object.assign(c.aero, {
        linearDrag: { x: 0.004, y: 0.005, z: 0.004 },
        dragArea: { x: 0.0022, y: 0.005, z: 0.0022 },
        rotorDrag: 0.004,
        angularDrag: 2e-6,
      });
      c.gyro.noise = 0.3;
    }),
    tune: {
      rates: {
        roll: { rcRate: 1.0, superRate: 0.68, expo: 0.1 },
        pitch: { rcRate: 1.0, superRate: 0.68, expo: 0.1 },
        yaw: { rcRate: 1.0, superRate: 0.6, expo: 0.1 },
        throttleMid: 0.5,
        throttleExpo: 0.1,
      },
      tpaRate: 0, tpaBreakpoint: 0.5, thrustLinear: 0.25, vbatSagComp: 0.7,
      gyroLowpassHz: 200, dtermLowpassHz: 90, feedforwardLowpassHz: 30,
    },
    pid: {
      roll: { p: 60, i: 70, d: 40, ff: 90 },
      pitch: { p: 60, i: 70, d: 40, ff: 90 },
      yaw: { p: 55, i: 70, d: 0, ff: 80 },
    },
    visual: { ducts: true, frameColor: 0xe8e8e8, propColorFront: 0xff3a6e, propColorRear: 0x222222, batteryColor: 0xd4b106, size: 0.08 },
    cameraMount: { x: 0, y: 0.012, z: -0.018 },
    damage: { propChip: 6, propBreak: 12, armBreak: 40, frameBreak: 60 },
  },

  cinewhoop: {
    physics: derive((c) => {
      // mit Action-Kamera obendrauf: schwer, träge, viel Luftwiderstand
      c.frame.mass = 0.42;
      c.frame.inertia = { x: 0.0008, y: 0.0014, z: 0.00075 };
      c.frame.motors = quadX(0.05);
      c.frame.contactPoints = contacts(0.05, 0.05, 0.03, 0.03);
      Object.assign(c.motor, {
        kv: 3800,
        maxThrust: 4.3,
        torqueToThrust: 0.011,
        rotorInertia: 1.6e-6,
        windingResistance: 0.11,
        noLoadCurrent: 0.6,
        escCurrentLimit: 35,
        motorHeatCapacity: 10,
        motorCooling: 0.15,
        motorCoolingPerKrads: 0.12,
        motorMaxTemp: 170,
        escHeatCapacity: 2,
        escResistance: 0.008,
        escCooling: 0.25,
        escMaxTemp: 130,
        propDiameter: 0.076,
        propPitch: 0.064,
        ductGain: 1.15,
        translationalLift: 0.06,
      });
      Object.assign(c.battery, {
        cells: 4,
        capacityMah: 850,
        internalResistance: 0.04,
        polarizationResistance: 0.02,
        idleCurrent: 0.6,
        heatCapacity: 90,
        coolingStill: 0.12,
        coolingPerSpeed: 0.02,
      });
      Object.assign(c.aero, {
        linearDrag: { x: 0.025, y: 0.035, z: 0.025 },
        dragArea: { x: 0.02, y: 0.034, z: 0.02 },
        rotorDrag: 0.035,
        angularDrag: 0.00025,
      });
    }),
    tune: {
      rates: {
        roll: { rcRate: 0.8, superRate: 0.45, expo: 0.35 },
        pitch: { rcRate: 0.8, superRate: 0.45, expo: 0.35 },
        yaw: { rcRate: 0.7, superRate: 0.3, expo: 0.3 },
        throttleMid: 0.4,
        throttleExpo: 0.35,
      },
      tpaRate: 0, tpaBreakpoint: 0.5, thrustLinear: 0.3, vbatSagComp: 1.0,
      gyroLowpassHz: 150, dtermLowpassHz: 70, feedforwardLowpassHz: 12,
    },
    pid: {
      roll: { p: 42, i: 90, d: 40, ff: 40 },
      pitch: { p: 44, i: 92, d: 42, ff: 40 },
      yaw: { p: 45, i: 90, d: 0, ff: 40 },
    },
    visual: { ducts: true, frameColor: 0x26292e, propColorFront: 0xffffff, propColorRear: 0x888888, batteryColor: 0x2a62c9, size: 0.18 },
    cameraMount: { x: 0, y: 0.03, z: -0.045 },
    damage: { propChip: 5, propBreak: 9, armBreak: 15, frameBreak: 24 },
  },

  freestyle5: {
    physics: structuredClone(PHYSICS),
    tune: {
      rates: {
        roll: { rcRate: 1.0, superRate: 0.7, expo: 0.0 },
        pitch: { rcRate: 1.0, superRate: 0.7, expo: 0.0 },
        yaw: { rcRate: 1.0, superRate: 0.7, expo: 0.0 },
        throttleMid: 0.5,
        throttleExpo: 0.0,
      },
      tpaRate: 0.4, tpaBreakpoint: 0.5, thrustLinear: 0, vbatSagComp: 0.8,
      gyroLowpassHz: 250, dtermLowpassHz: 90, feedforwardLowpassHz: 40,
    },
    pid: {
      roll: { p: 45, i: 80, d: 30, ff: 120 },
      pitch: { p: 47, i: 84, d: 34, ff: 125 },
      yaw: { p: 45, i: 80, d: 0, ff: 120 },
    },
    visual: { ducts: false, frameColor: 0x1b1b1d, propColorFront: 0xff7a2a, propColorRear: 0x22c1ff, batteryColor: 0x2a62c9, size: 0.25 },
    cameraMount: { x: 0, y: 0.02, z: -0.06 },
    damage: { propChip: 2.5, propBreak: 6, armBreak: 11, frameBreak: 18 },
  },

  race5: {
    physics: derive((c) => {
      // reiner Racer: leicht, schmal, steife Arme, hohe Steigung (5 × 4.8")
      c.frame.mass = 0.47;
      c.frame.inertia = { x: 0.0012, y: 0.0022, z: 0.001 };
      c.frame.motors = quadX(0.072, 0.082);
      c.frame.contactPoints = contacts(0.072, 0.082, 0.017, 0.04);
      Object.assign(c.motor, {
        kv: 2000,
        maxThrust: 13.8,
        rotorInertia: 3.8e-6,
        windingResistance: 0.06,
        propPitch: 0.122,
        zeroThrustSpeedFactor: 1.35,
      });
      Object.assign(c.battery, { capacityMah: 1100, internalResistance: 0.026, heatCapacity: 170 });
      Object.assign(c.aero, {
        linearDrag: { x: 0.01, y: 0.014, z: 0.008 },
        dragArea: { x: 0.007, y: 0.016, z: 0.005 },
        angularDrag: 0.0003,
      });
    }),
    tune: {
      rates: {
        roll: { rcRate: 1.25, superRate: 0.74, expo: 0.1 },
        pitch: { rcRate: 1.25, superRate: 0.74, expo: 0.1 },
        yaw: { rcRate: 1.1, superRate: 0.65, expo: 0.1 },
        throttleMid: 0.5,
        throttleExpo: 0.0,
      },
      tpaRate: 0.65, tpaBreakpoint: 0.35, thrustLinear: 0, vbatSagComp: 1.0,
      gyroLowpassHz: 320, dtermLowpassHz: 120, feedforwardLowpassHz: 70,
    },
    pid: {
      roll: { p: 52, i: 85, d: 30, ff: 180 },
      pitch: { p: 54, i: 88, d: 33, ff: 185 },
      yaw: { p: 55, i: 85, d: 0, ff: 150 },
    },
    visual: { ducts: false, frameColor: 0x111111, propColorFront: 0x39ff14, propColorRear: 0x39ff14, batteryColor: 0xc92a2a, size: 0.24 },
    cameraMount: { x: 0, y: 0.018, z: -0.065 },
    damage: { propChip: 2.5, propBreak: 5.5, armBreak: 10, frameBreak: 16 },
  },

  longrange7: {
    physics: derive((c) => {
      c.frame.mass = 1.05;
      c.frame.inertia = { x: 0.0078, y: 0.014, z: 0.0072 };
      c.frame.motors = quadX(0.111);
      c.frame.contactPoints = contacts(0.111, 0.111, 0.022, 0.05);
      Object.assign(c.motor, {
        kv: 1300,
        maxThrust: 19,
        torqueToThrust: 0.019,
        idle: 0.05,
        rotorInertia: 2.6e-5,
        windingResistance: 0.06,
        noLoadCurrent: 1.0,
        escCurrentLimit: 45,
        motorHeatCapacity: 40,
        motorCooling: 0.4,
        motorCoolingPerKrads: 0.5,
        escHeatCapacity: 3,
        propDiameter: 0.178,
        propPitch: 0.089,
        zeroThrustSpeedFactor: 1.35,
        translationalLift: 0.14,
      });
      Object.assign(c.battery, {
        cells: 6,
        capacityMah: 4000,
        internalResistance: 0.11,
        polarizationResistance: 0.05,
        polarizationTau: 6,
        idleCurrent: 0.9,
        ocvCurve: LIION_CURVE,
        heatCapacity: 300,
        coolingStill: 0.3,
        coolingPerSpeed: 0.05,
      });
      Object.assign(c.aero, {
        linearDrag: { x: 0.02, y: 0.03, z: 0.02 },
        dragArea: { x: 0.013, y: 0.036, z: 0.011 },
        rotorDrag: 0.04,
        angularDrag: 0.0012,
      });
    }),
    tune: {
      rates: {
        roll: { rcRate: 0.9, superRate: 0.55, expo: 0.3 },
        pitch: { rcRate: 0.9, superRate: 0.55, expo: 0.3 },
        yaw: { rcRate: 0.8, superRate: 0.4, expo: 0.3 },
        throttleMid: 0.45,
        throttleExpo: 0.2,
      },
      tpaRate: 0.3, tpaBreakpoint: 0.5, thrustLinear: 0.1, vbatSagComp: 0.6,
      gyroLowpassHz: 150, dtermLowpassHz: 70, feedforwardLowpassHz: 20,
    },
    pid: {
      roll: { p: 45, i: 30, d: 50, ff: 50 },
      pitch: { p: 47, i: 32, d: 53, ff: 50 },
      yaw: { p: 45, i: 80, d: 0, ff: 90 },
    },
    visual: { ducts: false, frameColor: 0x2b2f38, propColorFront: 0xff2a2a, propColorRear: 0x444444, batteryColor: 0x3aa64a, size: 0.35 },
    cameraMount: { x: 0, y: 0.03, z: -0.08 },
    damage: { propChip: 2.2, propBreak: 5, armBreak: 9, frameBreak: 15 },
  },
  bomber7: {
    physics: derive((c) => {
      // 7"-Rahmen mit Sprengladung unter dem Rahmen: schwer, tiefer Schwerpunkt, viel Trägheit
      c.frame.mass = 1.45;
      c.frame.inertia = { x: 0.0115, y: 0.017, z: 0.0105 };
      c.frame.motors = quadX(0.111);
      c.frame.contactPoints = [
        ...contacts(0.111, 0.111, 0.022, 0.05),
        { position: { x: 0, y: -0.075, z: 0.01 }, radius: 0.035, part: 'payload' },
        { position: { x: 0, y: -0.06, z: -0.07 }, radius: 0.03, part: 'payload' },
      ];
      Object.assign(c.motor, {
        kv: 1350,
        maxThrust: 22,
        torqueToThrust: 0.02,
        idle: 0.05,
        rotorInertia: 2.8e-5,
        windingResistance: 0.055,
        noLoadCurrent: 1.1,
        escCurrentLimit: 55,
        motorHeatCapacity: 45,
        motorCooling: 0.4,
        motorCoolingPerKrads: 0.5,
        escHeatCapacity: 4,
        propDiameter: 0.178,
        propPitch: 0.107,
        zeroThrustSpeedFactor: 1.35,
        translationalLift: 0.14,
      });
      Object.assign(c.battery, { cells: 6, capacityMah: 2200, internalResistance: 0.022, heatCapacity: 320 });
      Object.assign(c.aero, {
        linearDrag: { x: 0.025, y: 0.035, z: 0.025 },
        dragArea: { x: 0.018, y: 0.042, z: 0.016 },
        rotorDrag: 0.045,
        angularDrag: 0.0014,
      });
    }),
    tune: {
      rates: {
        roll: { rcRate: 0.85, superRate: 0.5, expo: 0.25 },
        pitch: { rcRate: 0.85, superRate: 0.5, expo: 0.25 },
        yaw: { rcRate: 0.8, superRate: 0.4, expo: 0.25 },
        throttleMid: 0.45,
        throttleExpo: 0.15,
      },
      tpaRate: 0.3, tpaBreakpoint: 0.5, thrustLinear: 0.1, vbatSagComp: 0.6,
      gyroLowpassHz: 150, dtermLowpassHz: 70, feedforwardLowpassHz: 20,
    },
    pid: {
      roll: { p: 45, i: 30, d: 52, ff: 45 },
      pitch: { p: 47, i: 32, d: 55, ff: 45 },
      yaw: { p: 48, i: 80, d: 0, ff: 80 },
    },
    payload: { kind: 'explosive', blastRadius: 7, armTime: 1.5, impactTrigger: 7 },
    zoomLevels: [1, 2],
    visual: { ducts: false, frameColor: 0x3d4a2a, propColorFront: 0xff2a2a, propColorRear: 0x333333, batteryColor: 0x1b1b1b, size: 0.4, payload: true },
    cameraMount: { x: 0, y: 0.03, z: -0.085 },
    damage: { propChip: 2.2, propBreak: 5, armBreak: 9, frameBreak: 15 },
  },
  interceptor: {
    physics: derive((c) => {
      // Abfangdrohne: leicht, stromlinienförmige Haube, sehr steile Propeller, kleiner Akku
      c.frame.mass = 0.5;
      c.frame.inertia = { x: 0.0011, y: 0.002, z: 0.0009 };
      c.frame.motors = quadX(0.07, 0.085);
      c.frame.contactPoints = [...contacts(0.07, 0.085, 0.017, 0.04), { position: { x: 0, y: 0.01, z: -0.11 }, radius: 0.03, part: 'body' }];
      Object.assign(c.motor, {
        kv: 2150,
        maxThrust: 16,
        rotorInertia: 4e-6,
        windingResistance: 0.055,
        escCurrentLimit: 65,
        propPitch: 0.135,
        zeroThrustSpeedFactor: 1.35,
        translationalLift: 0.1,
      });
      Object.assign(c.battery, { capacityMah: 850, internalResistance: 0.024, heatCapacity: 130 });
      Object.assign(c.aero, {
        linearDrag: { x: 0.008, y: 0.012, z: 0.006 },
        dragArea: { x: 0.0055, y: 0.014, z: 0.0035 },
        rotorDrag: 0.022,
        angularDrag: 0.0003,
      });
    }),
    tune: {
      rates: {
        roll: { rcRate: 1.3, superRate: 0.75, expo: 0.1 },
        pitch: { rcRate: 1.3, superRate: 0.75, expo: 0.1 },
        yaw: { rcRate: 1.15, superRate: 0.65, expo: 0.1 },
        throttleMid: 0.5,
        throttleExpo: 0,
      },
      tpaRate: 0.65, tpaBreakpoint: 0.35, thrustLinear: 0, vbatSagComp: 1.0,
      gyroLowpassHz: 320, dtermLowpassHz: 120, feedforwardLowpassHz: 70,
    },
    pid: {
      roll: { p: 52, i: 85, d: 30, ff: 185 },
      pitch: { p: 54, i: 88, d: 33, ff: 190 },
      yaw: { p: 55, i: 85, d: 0, ff: 150 },
    },
    zoomLevels: [1, 2],
    visual: { ducts: false, frameColor: 0x2f3a2f, propColorFront: 0xff6d00, propColorRear: 0x263238, batteryColor: 0x37474f, size: 0.25 },
    cameraMount: { x: 0, y: 0.02, z: -0.09 },
    damage: { propChip: 2.5, propBreak: 6, armBreak: 12, frameBreak: 20 },
  },

  octo: {
    physics: derive((c) => {
      // Schwerlast-Oktokopter (15"-Propeller, 12S) mit 3 kg Versorgungskiste
      c.frame.mass = 9.0;
      c.frame.inertia = { x: 0.62, y: 1.05, z: 0.6 };
      c.frame.motors = octoFlat(0.48);
      c.frame.contactPoints = [
        ...octoFlat(0.48).map((m) => ({ position: { ...m.position, y: -0.02 }, radius: 0.04 })),
        { position: { x: 0.25, y: -0.32, z: 0.25 }, radius: 0.04, part: 'gear' },
        { position: { x: -0.25, y: -0.32, z: 0.25 }, radius: 0.04, part: 'gear' },
        { position: { x: 0.25, y: -0.32, z: -0.25 }, radius: 0.04, part: 'gear' },
        { position: { x: -0.25, y: -0.32, z: -0.25 }, radius: 0.04, part: 'gear' },
        { position: { x: 0, y: 0.12, z: 0 }, radius: 0.12, part: 'body' },
      ];
      Object.assign(c.motor, {
        kv: 400,
        maxThrust: 52,
        torqueToThrust: 0.03,
        idle: 0.05,
        rotorInertia: 2.2e-4,
        windingResistance: 0.09,
        noLoadCurrent: 0.9,
        escCurrentLimit: 60,
        motorHeatCapacity: 150,
        motorCooling: 1.2,
        motorCoolingPerKrads: 3,
        motorMaxTemp: 170,
        escHeatCapacity: 8,
        escResistance: 0.004,
        escCooling: 0.8,
        escMaxTemp: 130,
        propDiameter: 0.38,
        propPitch: 0.14,
        zeroThrustSpeedFactor: 1.3,
        translationalLift: 0.15,
      });
      Object.assign(c.battery, {
        cells: 12,
        capacityMah: 16000,
        internalResistance: 0.035,
        polarizationResistance: 0.015,
        polarizationTau: 8,
        idleCurrent: 1.5,
        heatCapacity: 2600,
        coolingStill: 1.5,
        coolingPerSpeed: 0.2,
      });
      Object.assign(c.aero, {
        linearDrag: { x: 0.15, y: 0.25, z: 0.15 },
        dragArea: { x: 0.09, y: 0.3, z: 0.09 },
        rotorDrag: 0.12,
        angularDrag: 0.04,
      });
      c.gyro.noise = 0.1;
    }),
    cargo: { mass: 3.0, inertia: { x: 0.19, y: 0.02, z: 0.19 }, hangY: -0.25, chuteArea: 1.4 },
    tune: {
      rates: {
        roll: { rcRate: 0.6, superRate: 0.3, expo: 0.4 },
        pitch: { rcRate: 0.6, superRate: 0.3, expo: 0.4 },
        yaw: { rcRate: 0.6, superRate: 0.2, expo: 0.3 },
        throttleMid: 0.45,
        throttleExpo: 0.3,
      },
      tpaRate: 0, tpaBreakpoint: 0.5, thrustLinear: 0.2, vbatSagComp: 1.0,
      gyroLowpassHz: 100, dtermLowpassHz: 50, feedforwardLowpassHz: 10,
    },
    pid: {
      roll: { p: 38, i: 70, d: 45, ff: 30 },
      pitch: { p: 38, i: 70, d: 45, ff: 30 },
      yaw: { p: 50, i: 80, d: 0, ff: 40 },
    },
    zoomLevels: [1, 2, 4],
    visual: { ducts: false, frameColor: 0x3b4a3a, propColorFront: 0xff8f00, propColorRear: 0x212121, batteryColor: 0x263238, size: 1.1 },
    cameraMount: { x: 0, y: -0.08, z: -0.25 },
    damage: { propChip: 2, propBreak: 4, armBreak: 6, frameBreak: 9 },
  },
} satisfies Record<string, QuadPreset>;

export type QuadPresetId = keyof typeof QUAD_PRESETS;
