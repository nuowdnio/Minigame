/**
 * Zentrale Physik-Konfiguration der Drohne.
 *
 * Alle Werte in SI-Einheiten (m, kg, s, N, A, V), sofern nicht anders angegeben.
 * Die Standardwerte entsprechen einem typischen 5"-Freestyle/Race-Quad auf 6S.
 *
 * Koordinatensystem (wie Three.js): Y = oben, -Z = vorne, +X = rechts.
 * Körper-Achsen der Drohne: x = rechts, y = oben, z = hinten.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface MotorLayoutEntry {
  /** Position der Motorachse im Körper-System (m). */
  position: Vec3Like;
  /** Drehrichtung von oben gesehen: +1 = im Uhrzeigersinn (CW), -1 = gegen den Uhrzeigersinn (CCW). */
  spin: 1 | -1;
  name: string;
}

export interface ContactPointDef {
  position: Vec3Like;
  radius: number;
  /** Rad (rollt längs, blockiert seitlich). */
  wheel?: boolean;
  /** Gelenktes Rad (Bugrad). */
  steerable?: boolean;
  /** Bauteil für das Schadensmodell (z. B. 'motor0', 'wingR', 'gear', 'prop', 'tail', 'body'). */
  part?: string;
}

export const PHYSICS = {
  /** Physik- und Flight-Controller-Takt (Hz). */
  simHz: 1000,
  gravity: 9.81,

  air: {
    /** Bezugs-Luftdichte (kg/m³), bei der maxThrust gilt (ISA, Meereshöhe, 15 °C). */
    seaLevelDensity: 1.225,
  },

  frame: {
    /** Abfluggewicht inkl. Akku und Kamera (kg). */
    mass: 0.65,
    /** Hauptträgheitsmomente um die Körperachsen (kg·m²): x = Nick, y = Gier, z = Roll. */
    inertia: { x: 0.0022, y: 0.004, z: 0.0019 },
    /**
     * Motor-Layout (Quad X, "Props in", Betaflight-Standard).
     * 220 mm Diagonal-Achsabstand -> ±0.078 m in x und z.
     */
    motors: [
      { name: 'RR', position: { x: 0.078, y: 0.0, z: 0.078 }, spin: 1 },
      { name: 'FR', position: { x: 0.078, y: 0.0, z: -0.078 }, spin: -1 },
      { name: 'RL', position: { x: -0.078, y: 0.0, z: 0.078 }, spin: -1 },
      { name: 'FL', position: { x: -0.078, y: 0.0, z: -0.078 }, spin: 1 },
    ] as MotorLayoutEntry[],
    /** Kollisionspunkte (Kugeln) im Körper-System, für Boden-/Hinderniskontakt. */
    contactPoints: [
      { position: { x: 0.078, y: -0.012, z: 0.078 }, radius: 0.018 },
      { position: { x: 0.078, y: -0.012, z: -0.078 }, radius: 0.018 },
      { position: { x: -0.078, y: -0.012, z: 0.078 }, radius: 0.018 },
      { position: { x: -0.078, y: -0.012, z: -0.078 }, radius: 0.018 },
      { position: { x: 0.0, y: -0.02, z: 0.0 }, radius: 0.02 },
      { position: { x: 0.0, y: 0.045, z: 0.01 }, radius: 0.025 }, // Akku oben
      { position: { x: 0.0, y: 0.015, z: -0.06 }, radius: 0.02 }, // Kamera vorne
    ] as ContactPointDef[],
  },

  motor: {
    /** Motor-KV (U/min pro Volt), z. B. 2306-Motor mit 1850 KV. */
    kv: 1850,
    /** Statischer Maximalschub pro Motor bei voll geladenem Akku (ohne Sag), Meereshöhe (N). */
    maxThrust: 14.0,
    /** Verhältnis Propeller-Drehmoment / Schub (m). Bestimmt die Gier-Autorität. */
    torqueToThrust: 0.015,
    /** Leerlauf-Ausgabe im scharfen Zustand (Anteil, wie Betaflight "dshot_idle_value"). */
    idle: 0.055,
    /** Trägheitsmoment von Glocke + Propeller (kg·m²). Bestimmt mit R und KV die Hochlaufzeit. */
    rotorInertia: 5e-6,
    /** Wicklungswiderstand inkl. Zuleitung (Ω). */
    windingResistance: 0.07,
    /** Leerlaufstrom (A). */
    noLoadCurrent: 1.2,
    /** Dauerstromgrenze des Reglers (A). */
    escCurrentLimit: 55,
    /** Motor-Wärmekapazität (J/K), Kühlung im Stand (W/K) und pro 1000 rad/s bzw. 15 m/s Fahrtwind (W/K). */
    motorHeatCapacity: 25,
    motorCooling: 0.3,
    motorCoolingPerKrads: 0.35,
    /** Wicklung brennt durch (°C). */
    motorMaxTemp: 180,
    /** Regler: Wärmekapazität (J/K), Durchlasswiderstand (Ω), Kühlung (W/K), Grenztemperatur (°C). */
    escHeatCapacity: 3,
    escResistance: 0.005,
    escCooling: 0.4,
    escMaxTemp: 130,
    /** Propeller-Durchmesser (m), 5". */
    propDiameter: 0.127,
    /** Propeller-Steigung (m pro Umdrehung), 4.3". */
    propPitch: 0.109,
    /** Max. Schubfaktor bei Anströmung von unten (Sinkflug), Begrenzung des Inflow-Modells. */
    maxInflowGain: 1.15,
    /**
     * Geschwindigkeit ohne Schub als Vielfaches der geometrischen Pitch-Speed.
     * Real meist 1.1–1.4, da der Propeller auch bei v = Pitch-Speed noch Schub erzeugt.
     */
    zeroThrustSpeedFactor: 1.3,
    /** Schubgewinn durch Ducts (Cinewhoop/Whoop), 1 = offene Propeller. */
    ductGain: 1.0,
    /** Maximaler Schubgewinn durch Vorwärtsfahrt (Translational Lift). */
    translationalLift: 0.12,
  },

  battery: {
    cells: 6,
    capacityMah: 1300,
    /** Ohmscher Innenwiderstand des gesamten Packs inkl. Kabel (Ω). */
    internalResistance: 0.028,
    /** Polarisationswiderstand (Ω) – langsamer Anteil des Spannungseinbruchs. */
    polarizationResistance: 0.012,
    /** Zeitkonstante der Polarisation (s). */
    polarizationTau: 3.0,
    /** Grundverbrauch von FC, VTX, Kamera (A). */
    idleCurrent: 0.6,
    /** Start-Ladezustand (0..1). */
    startSoc: 1.0,
    /**
     * Leerlaufspannung pro Zelle über dem Ladezustand (LiPo-Kennlinie).
     * Paare [SoC, Volt], aufsteigend sortiert.
     */
    ocvCurve: [
      [0.0, 3.27],
      [0.05, 3.45],
      [0.1, 3.6],
      [0.2, 3.7],
      [0.3, 3.75],
      [0.4, 3.79],
      [0.5, 3.82],
      [0.6, 3.87],
      [0.7, 3.93],
      [0.8, 4.0],
      [0.9, 4.1],
      [1.0, 4.2],
    ] as [number, number][],
    /** Wärmekapazität des Packs (J/K), ca. 1 J/(g·K). */
    heatCapacity: 200,
    /** Wärmeabgabe im Stand (W/K). */
    coolingStill: 0.25,
    /** Zusätzliche Wärmeabgabe pro m/s Fahrtwind (W/K). */
    coolingPerSpeed: 0.04,
  },

  aero: {
    /** Linearer Luftwiderstand pro Körperachse (N pro m/s). */
    linearDrag: { x: 0.015, y: 0.02, z: 0.015 },
    /**
     * Quadratischer Widerstand: Cd·A pro Körperachse (m²).
     * Kraft = 0.5 · ρ · CdA · v². Die Oberseite (y) ist deutlich größer als die Front.
     */
    dragArea: { x: 0.01, y: 0.022, z: 0.008 },
    /**
     * Rotor-Widerstand ("H-Force"/Blade Flapping): seitliche Anströmung der drehenden
     * Propeller erzeugt eine Kraft proportional zu Geschwindigkeit und Drehzahl.
     * N pro (m/s) pro Motor bei voller Drehzahl.
     */
    rotorDrag: 0.025,
    /** Aerodynamische Rotationsdämpfung (N·m pro rad/s). */
    angularDrag: 0.0004,
    /** Propwash/Wirbelringstadium beim Sinken in die eigene Abströmung. */
    propwash: {
      /** Mittlerer Schubverlust bei voller Ausprägung (Anteil). */
      thrustLoss: 0.25,
      /** Stärke der zufälligen Schubschwankung je Motor (Anteil). */
      noise: 0.35,
    },
    groundEffect: {
      enabled: true,
      /** Maximaler Schubgewinn direkt über dem Boden. */
      maxGain: 1.25,
    },
  },

  contact: {
    /** Stoßzahl beim Aufprall (0 = plastisch, 1 = voll elastisch). */
    restitution: 0.25,
    /** Gleitreibungskoeffizient. */
    friction: 0.6,
    /** Anteil der Eindringtiefe, der pro Schritt korrigiert wird. */
    positionCorrection: 0.6,
    iterations: 3,
    rollingResistance: 0.04,
  },

  gyro: {
    /** Gyro-Rauschen (Standardabweichung, deg/s). */
    noise: 0.15,
  },
};

export type PhysicsConfig = typeof PHYSICS;
/** Physik-Konfiguration einer Multicopter-Drohne. */
export type QuadConfig = PhysicsConfig;
