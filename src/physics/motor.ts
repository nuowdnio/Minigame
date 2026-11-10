/**
 * Elektromechanisches Brushless-Motormodell mit Regler (ESC) und Propeller.
 *
 *   U_Motor = Ansteuerung · U_Akku                       (PWM-Tastgrad des ESC)
 *   I       = (U_Motor − K_e·ω) / R                     (Gegen-EMK, Wicklungswiderstand)
 *   J·dω/dt = K_t·(I − I_0) − Q_Luft − Q_Last          (Rotorträgheit, Leerlaufverluste)
 *   Q_Luft  = k_Q·ρ/ρ₀·ω²,   Schub T = k_T·ρ/ρ₀·ω²
 *
 * Daraus ergeben sich realistisch: Hochlaufzeit abhängig von Spannung und Propeller,
 * aktives Bremsen beim Gaswegnehmen (negativer Strom), Drehzahleinbruch bei Spannungssag,
 * Entlastung des Propellers bei Fahrt, Stromaufnahme und Erwärmung von Motor und Regler.
 * Ein blockierter Propeller (Last) führt zu sehr hohem Strom → Regler/Motor brennen durch.
 */

export interface MotorParams {
  /** Motor-KV (U/min pro Volt). */
  kv: number;
  /** Statischer Schub bei Vollgas, voll geladenem Akku (ohne Sag), Meereshöhe (N). */
  maxThrust: number;
  /** Verhältnis Propeller-Drehmoment / Schub (m). */
  torqueToThrust: number;
  /** Leerlauf-Ausgabe des ESC im scharfen Zustand (Anteil). */
  idle: number;
  /** Trägheitsmoment Glocke + Propeller (kg·m²). */
  rotorInertia: number;
  /** Wicklungswiderstand inkl. Zuleitung (Ω). */
  windingResistance: number;
  /** Leerlaufstrom (Eisen- und Lagerverluste, A). */
  noLoadCurrent: number;
  /** Dauerstromgrenze des Reglers (A). */
  escCurrentLimit: number;
  /** Wärmekapazität des Motors (J/K) und Kühlung (W/K, im Stand / pro 1000 rad/s). */
  motorHeatCapacity: number;
  motorCooling: number;
  motorCoolingPerKrads: number;
  /** Temperatur, bei der die Wicklung durchbrennt (°C). */
  motorMaxTemp: number;
  /** Wärmekapazität (J/K), Durchlasswiderstand (Ω), Kühlung (W/K) und Grenztemperatur des Reglers. */
  escHeatCapacity: number;
  escResistance: number;
  escCooling: number;
  escMaxTemp: number;
  propDiameter: number;
  /** Propeller-Steigung (m pro Umdrehung). */
  propPitch: number;
  maxInflowGain: number;
  /** Geschwindigkeit ohne Schub als Vielfaches der geometrischen Pitch-Speed. */
  zeroThrustSpeedFactor: number;
}

const RPM_TO_RADS = (2 * Math.PI) / 60;

/** Spannungskonstante K_e = Drehmomentkonstante K_t (V·s/rad bzw. N·m/A). */
export function motorConstant(kv: number): number {
  return 1 / (kv * RPM_TO_RADS);
}

/**
 * Drehzahl bei Vollgas, voller Spannung und Nennlast (statischer Maximalschub).
 * Gleichgewicht: K_t·((U − K_e·ω)/R − I_0) = r·T_max.
 */
export function fullThrottleOmega(p: MotorParams, fullVoltage: number): number {
  const k = motorConstant(p.kv);
  const current = p.noLoadCurrent + (p.torqueToThrust * p.maxThrust) / k;
  return (fullVoltage - p.windingResistance * current) / k;
}

/** Schubkoeffizient k_T (N/(rad/s)²), kalibriert auf maxThrust bei Vollgas und Nennspannung. */
export function thrustCoefficient(p: MotorParams, fullVoltage: number): number {
  const w = fullThrottleOmega(p, fullVoltage);
  return p.maxThrust / (w * w);
}

/** Drehzahl ohne Last bei gegebener Ansteuerung und Spannung (rad/s) – obere Grenze. */
export function noLoadOmega(command: number, voltage: number, p: MotorParams): number {
  return (Math.max(0, Math.min(1, command)) * voltage) / motorConstant(p.kv);
}

export type MotorFailure = '' | 'motor' | 'esc' | 'prop';

export class Motor {
  /** Drehzahl (rad/s). */
  omega = 0;
  /** Winkelbeschleunigung im letzten Schritt (rad/s²). */
  omegaDot = 0;
  /** Motorstrom (A, negativ = Bremsen/Rückspeisen). */
  motorCurrent = 0;
  /** Vom Akku gezogener Strom (A). */
  batteryCurrent = 0;
  /** Letzter statischer Schub (N), ohne Inflow/Bodeneffekt. */
  staticThrust = 0;
  /** Letzter effektiver Schub (N). */
  thrust = 0;
  /** Letztes aerodynamisches Drehmoment (N·m). */
  torque = 0;
  /** Propeller-Zustand (1 = intakt, 0 = Propeller ab). */
  health = 1;
  /** Unwucht durch beschädigten Propeller (0..1). */
  imbalance = 0;
  /** Ausfall des Antriebs. */
  failure: MotorFailure = '';
  /** Zusätzliches Lastmoment, z. B. Propeller schleift am Boden (N·m pro rad/s). */
  obstruction = 0;
  motorTemp = 25;
  escTemp = 25;
  readonly kT: number;
  readonly kQ: number;
  readonly k: number;

  constructor(
    readonly params: MotorParams,
    fullVoltage: number,
  ) {
    this.kT = thrustCoefficient(params, fullVoltage);
    this.kQ = this.kT * params.torqueToThrust;
    this.k = motorConstant(params.kv);
  }

  reset(ambientC = 25): void {
    this.omega = 0;
    this.omegaDot = 0;
    this.motorCurrent = 0;
    this.batteryCurrent = 0;
    this.staticThrust = 0;
    this.thrust = 0;
    this.torque = 0;
    this.health = 1;
    this.imbalance = 0;
    this.failure = '';
    this.obstruction = 0;
    this.motorTemp = ambientC;
    this.escTemp = ambientC;
  }

  get working(): boolean {
    return this.failure !== 'motor' && this.failure !== 'esc';
  }

  /**
   * Drehzahl, Strom und Temperaturen um dt weiterentwickeln.
   * @param command Ausgabe des Flight Controllers inkl. Idle (0..1), 0 = aus
   * @param voltage Akkuspannung unter Last (V)
   * @param densityRatio ρ/ρ₀ (Propellerlast)
   * @param torqueGain Lastfaktor durch Anströmung (Propeller entlastet sich bei Fahrt)
   * @param cooling zusätzliche Kühlung durch Fahrtwind (m/s)
   */
  update(command: number, voltage: number, dt: number, densityRatio = 1, torqueGain = 1, ambientC = 25, airspeed = 0): void {
    const p = this.params;
    const k = this.k;
    const cmd = this.working ? Math.max(0, Math.min(1, command)) : 0;

    // Strom aus Klemmenspannung und Gegen-EMK; ein ausgeschalteter ESC (cmd 0) lässt den Motor frei drehen.
    // Der Regler begrenzt den Tastgrad so, dass der Motorstrom die Schutzgrenze (1.5 × Dauerstrom) nicht
    // überschreitet (Anlauf-/Stromschutz wie BLHeli "rampup power" bzw. Strombegrenzung).
    let current = 0;
    let duty = 0;
    if (cmd > 0 && voltage > 0.5) {
      const iLim = 1.5 * p.escCurrentLimit;
      const emf = k * this.omega;
      const dutyMax = (emf + p.windingResistance * iLim) / voltage;
      const dutyMin = (emf - p.windingResistance * iLim) / voltage;
      duty = Math.max(0, Math.max(dutyMin, Math.min(dutyMax, cmd)));
      current = (duty * voltage - emf) / p.windingResistance;
    }
    this.motorCurrent = current;
    this.batteryCurrent = Math.max(-0.2 * p.escCurrentLimit, duty * current);

    const friction = p.noLoadCurrent * Math.tanh(this.omega / 50);
    const drive = k * (current - friction);
    const aero = this.kQ * this.omega * this.omega * densityRatio * this.health * torqueGain;
    const load = this.obstruction * this.omega;
    const prev = this.omega;
    this.omegaDot = (drive - aero - load) / p.rotorInertia;
    this.omega = Math.max(0, this.omega + this.omegaDot * dt);
    // Bremsstrom darf die Drehrichtung nicht umkehren
    if (prev > 0 && this.omega === 0) this.omegaDot = -prev / dt;

    // --- Erwärmung -------------------------------------------------------
    const copper = current * current * p.windingResistance;
    const iron = p.noLoadCurrent * k * this.omega * 0.6;
    const flow = this.omega / 1000 + airspeed / 15;
    const motorCool = (p.motorCooling + p.motorCoolingPerKrads * flow) * (this.motorTemp - ambientC);
    this.motorTemp += ((copper + iron - motorCool) / p.motorHeatCapacity) * dt;
    const escLoss = current * current * p.escResistance + Math.abs(current) * 0.05;
    const escCool = (p.escCooling * (1 + flow)) * (this.escTemp - ambientC);
    this.escTemp += ((escLoss - escCool) / p.escHeatCapacity) * dt;

    if (this.failure === '' || this.failure === 'prop') {
      if (this.escTemp > p.escMaxTemp) this.failure = 'esc';
      else if (this.motorTemp > p.motorMaxTemp) this.failure = 'motor';
    }
  }

  /**
   * Schub und Drehmoment für die Kraftberechnung.
   * @param densityRatio ρ/ρ₀
   * @param thrustGain Zusätzlicher Faktor (Inflow, Bodeneffekt, Ducts)
   */
  computeForces(densityRatio: number, thrustGain: number, torqueGain = 1): void {
    const w2 = this.omega * this.omega;
    this.staticThrust = this.kT * w2 * densityRatio * this.health;
    this.thrust = this.staticThrust * thrustGain;
    this.torque = this.kQ * w2 * densityRatio * this.health * torqueGain;
  }

  /** Mechanische Leistung an der Welle (W). */
  mechanicalPower(): number {
    return this.torque * this.omega;
  }
}

/**
 * Lastfaktor des Propeller-Drehmoments bei axialer Anströmung: der Propeller entlastet sich
 * mit zunehmender Fahrt (weniger Anstellwinkel am Blatt), aber weniger stark als der Schub.
 */
export function torqueInflowGain(thrustInflowGain: number): number {
  return 0.3 + 0.7 * thrustInflowGain;
}

/**
 * Klemmenspannung des Akkus unter der Last der Motoren, implizit gelöst:
 * Akkustrom I_b = Σ d_i·(d_i·U − K_e·ω_i)/R  und  U = U_0 − R_i·(I_b + I_idle)
 *  ⇒  U = (U_0 − R_i·I_idle + R_i·Σ d_i·K_e·ω_i/R) / (1 + R_i·Σ d_i²/R)
 * Verhindert das Aufschaukeln zwischen Spannungseinbruch und Motorstrom bei schwachen Akkus.
 * @param sourceVoltage Leerlaufspannung minus Polarisation (V)
 * @param internalResistance ohmscher Innenwiderstand (Ω)
 */
export function solveBusVoltage(
  sourceVoltage: number,
  internalResistance: number,
  idleCurrent: number,
  motors: Motor[],
  commands: ArrayLike<number>,
): number {
  let a = 0;
  let b = 0;
  for (let i = 0; i < motors.length; i++) {
    const m = motors[i];
    if (!m.working) continue;
    const d = Math.max(0, Math.min(1, commands[i] ?? 0));
    if (d <= 0) continue;
    const r = m.params.windingResistance;
    a += (d * d) / r;
    b += (d * m.k * m.omega) / r;
  }
  const v = (sourceVoltage - internalResistance * idleCurrent + internalResistance * b) / (1 + internalResistance * a);
  return Math.max(0, Math.min(sourceVoltage, v));
}
