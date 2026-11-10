/**
 * Drohnen-Presets. Jede Drohne hat eigene Physikwerte (Masse, Trägheit, Motoren, Akku,
 * Aerodynamik) und ein eigenes PID-Tuning. Basis ist der 5"-Freestyle-Quad aus physics.ts.
 */
import type { AxisPid } from './flightController';
import { PHYSICS, type ContactPointDef, type MotorLayoutEntry, type QuadConfig } from './physics';

export interface QuadPreset {
  physics: QuadConfig;
  pid: { roll: AxisPid; pitch: AxisPid; yaw: AxisPid };
  /** Optik */
  visual: {
    ducts: boolean;
    frameColor: number;
    propColorFront: number;
    propColorRear: number;
    batteryColor: number;
    /** Größe (m) für die Verfolgerkamera. */
    size: number;
  };
  /** FPV-Kamera-Montage im Körper-System (m). */
  cameraMount: { x: number; y: number; z: number };
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
        loadFactor: 0.68,
        maxThrust: 0.3,
        torqueToThrust: 0.007,
        spinUpTau: 0.012,
        spinDownTau: 0.02,
        idle: 0.06,
        rotorInertia: 1.5e-8,
        efficiency: 0.55,
        propDiameter: 0.031,
        propPitch: 0.019,
        zeroThrustSpeedFactor: 1.4,
        ductGain: 1.12,
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
    pid: {
      roll: { p: 60, i: 70, d: 40, ff: 90 },
      pitch: { p: 60, i: 70, d: 40, ff: 90 },
      yaw: { p: 55, i: 70, d: 0, ff: 80 },
    },
    visual: { ducts: true, frameColor: 0xe8e8e8, propColorFront: 0xff3a6e, propColorRear: 0x222222, batteryColor: 0xd4b106, size: 0.08 },
    cameraMount: { x: 0, y: 0.012, z: -0.018 },
  },

  cinewhoop: {
    physics: derive((c) => {
      c.frame.mass = 0.3;
      c.frame.inertia = { x: 0.00055, y: 0.00095, z: 0.0005 };
      c.frame.motors = quadX(0.05);
      c.frame.contactPoints = contacts(0.05, 0.05, 0.03, 0.03);
      Object.assign(c.motor, {
        kv: 3800,
        loadFactor: 0.7,
        maxThrust: 4.6,
        torqueToThrust: 0.011,
        spinUpTau: 0.016,
        spinDownTau: 0.026,
        rotorInertia: 1.2e-6,
        efficiency: 0.65,
        propDiameter: 0.076,
        propPitch: 0.064,
        ductGain: 1.15,
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
        linearDrag: { x: 0.02, y: 0.03, z: 0.02 },
        dragArea: { x: 0.016, y: 0.03, z: 0.016 },
        rotorDrag: 0.03,
        angularDrag: 0.0001,
      });
    }),
    pid: {
      roll: { p: 50, i: 85, d: 38, ff: 100 },
      pitch: { p: 52, i: 88, d: 40, ff: 100 },
      yaw: { p: 50, i: 85, d: 0, ff: 100 },
    },
    visual: { ducts: true, frameColor: 0x26292e, propColorFront: 0xffffff, propColorRear: 0x888888, batteryColor: 0x2a62c9, size: 0.18 },
    cameraMount: { x: 0, y: 0.03, z: -0.045 },
  },

  freestyle5: {
    physics: structuredClone(PHYSICS),
    pid: {
      roll: { p: 45, i: 80, d: 30, ff: 120 },
      pitch: { p: 47, i: 84, d: 34, ff: 125 },
      yaw: { p: 45, i: 80, d: 0, ff: 120 },
    },
    visual: { ducts: false, frameColor: 0x1b1b1d, propColorFront: 0xff7a2a, propColorRear: 0x22c1ff, batteryColor: 0x2a62c9, size: 0.25 },
    cameraMount: { x: 0, y: 0.02, z: -0.06 },
  },

  race5: {
    physics: derive((c) => {
      c.frame.mass = 0.54;
      c.frame.inertia = { x: 0.0017, y: 0.0031, z: 0.0014 };
      c.frame.motors = quadX(0.072, 0.082);
      c.frame.contactPoints = contacts(0.072, 0.082, 0.017, 0.04);
      Object.assign(c.motor, {
        kv: 1960,
        maxThrust: 13.2,
        spinUpTau: 0.015,
        spinDownTau: 0.022,
        propPitch: 0.094,
        zeroThrustSpeedFactor: 1.45,
      });
      Object.assign(c.battery, { capacityMah: 1100, internalResistance: 0.03, heatCapacity: 170 });
      Object.assign(c.aero, {
        linearDrag: { x: 0.012, y: 0.016, z: 0.01 },
        dragArea: { x: 0.008, y: 0.019, z: 0.0055 },
      });
    }),
    pid: {
      roll: { p: 48, i: 85, d: 32, ff: 140 },
      pitch: { p: 50, i: 88, d: 35, ff: 145 },
      yaw: { p: 48, i: 85, d: 0, ff: 130 },
    },
    visual: { ducts: false, frameColor: 0x111111, propColorFront: 0x39ff14, propColorRear: 0x39ff14, batteryColor: 0xc92a2a, size: 0.24 },
    cameraMount: { x: 0, y: 0.018, z: -0.065 },
  },

  longrange7: {
    physics: derive((c) => {
      c.frame.mass = 1.05;
      c.frame.inertia = { x: 0.0078, y: 0.014, z: 0.0072 };
      c.frame.motors = quadX(0.111);
      c.frame.contactPoints = contacts(0.111, 0.111, 0.022, 0.05);
      Object.assign(c.motor, {
        kv: 1300,
        loadFactor: 0.74,
        maxThrust: 19,
        torqueToThrust: 0.019,
        spinUpTau: 0.032,
        spinDownTau: 0.05,
        idle: 0.05,
        rotorInertia: 2.2e-5,
        efficiency: 0.75,
        propDiameter: 0.178,
        propPitch: 0.089,
        zeroThrustSpeedFactor: 1.35,
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
    pid: {
      roll: { p: 45, i: 30, d: 50, ff: 50 },
      pitch: { p: 47, i: 32, d: 53, ff: 50 },
      yaw: { p: 45, i: 80, d: 0, ff: 90 },
    },
    visual: { ducts: false, frameColor: 0x2b2f38, propColorFront: 0xff2a2a, propColorRear: 0x444444, batteryColor: 0x3aa64a, size: 0.35 },
    cameraMount: { x: 0, y: 0.03, z: -0.08 },
  },
} satisfies Record<string, QuadPreset>;

export type QuadPresetId = keyof typeof QUAD_PRESETS;
