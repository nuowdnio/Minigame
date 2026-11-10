/**
 * Brushless-Motor mit Propeller.
 *
 * - Ziel-Drehzahl ist proportional zu Ansteuerung · Akkuspannung · KV (wie bei einem ESC ohne RPM-Regelung)
 * - Drehzahl folgt dem Ziel mit Verzögerung 1. Ordnung (getrennt für Hoch-/Herunterdrehen)
 * - Schub und Drehmoment ∝ ω², skaliert mit Luftdichte
 */

export interface MotorParams {
  kv: number;
  loadFactor: number;
  maxThrust: number;
  torqueToThrust: number;
  spinUpTau: number;
  spinDownTau: number;
  idle: number;
  rotorInertia: number;
  efficiency: number;
  propDiameter: number;
  propPitch: number;
  maxInflowGain: number;
  zeroThrustSpeedFactor: number;
}

const RPM_TO_RADS = (2 * Math.PI) / 60;

/** Drehzahl (rad/s), die bei gegebener Ansteuerung und Spannung im eingeschwungenen Zustand erreicht wird. */
export function targetOmega(command: number, voltage: number, p: MotorParams): number {
  return Math.max(0, Math.min(1, command)) * p.kv * RPM_TO_RADS * voltage * p.loadFactor;
}

/**
 * Schubkoeffizient k_T (N/(rad/s)²) auf Meereshöhe, so gewählt, dass bei voller
 * Ansteuerung und Nennspannung genau maxThrust erreicht wird.
 */
export function thrustCoefficient(p: MotorParams, fullVoltage: number): number {
  const wMax = targetOmega(1, fullVoltage, p);
  return p.maxThrust / (wMax * wMax);
}

export class Motor {
  /** Aktuelle Drehzahl (rad/s). */
  omega = 0;
  /** Winkelbeschleunigung im letzten Schritt (rad/s²). */
  omegaDot = 0;
  /** Letzter statischer Schub (N), ohne Inflow/Bodeneffekt. */
  staticThrust = 0;
  /** Letzter effektiver Schub (N). */
  thrust = 0;
  /** Letztes aerodynamisches Drehmoment (N·m). */
  torque = 0;
  /** Schubfaktor für Schäden (1 = intakt, 0 = Propeller ab). */
  health = 1;
  readonly kT: number;
  readonly kQ: number;

  constructor(
    readonly params: MotorParams,
    fullVoltage: number,
  ) {
    this.kT = thrustCoefficient(params, fullVoltage);
    this.kQ = this.kT * params.torqueToThrust;
  }

  reset(): void {
    this.omega = 0;
    this.omegaDot = 0;
    this.staticThrust = 0;
    this.thrust = 0;
    this.torque = 0;
    this.health = 1;
  }

  /**
   * Drehzahl um dt weiterentwickeln.
   * @param command Ausgabe des Flight Controllers inkl. Idle (0..1), 0 = aus
   * @param voltage Akkuspannung unter Last (V)
   */
  update(command: number, voltage: number, dt: number): void {
    const p = this.params;
    const target = targetOmega(command, voltage, p);
    const tau = target > this.omega ? p.spinUpTau : p.spinDownTau;
    const a = 1 - Math.exp(-dt / tau);
    const prev = this.omega;
    this.omega += (target - this.omega) * a;
    this.omegaDot = (this.omega - prev) / dt;
  }

  /**
   * Schub und Drehmoment berechnen.
   * @param densityRatio ρ/ρ₀
   * @param thrustGain Zusätzlicher Faktor (Inflow, Bodeneffekt)
   */
  computeForces(densityRatio: number, thrustGain: number): void {
    const w2 = this.omega * this.omega;
    this.staticThrust = this.kT * w2 * densityRatio * this.health;
    this.thrust = this.staticThrust * thrustGain;
    this.torque = this.kQ * w2 * densityRatio * this.health;
  }

  /** Mechanische Leistung an der Welle (W). */
  mechanicalPower(): number {
    return this.torque * this.omega + this.params.rotorInertia * Math.max(0, this.omegaDot) * this.omega;
  }

  /** Stromaufnahme bei gegebener Spannung (A). */
  current(voltage: number): number {
    if (voltage < 1) return 0;
    return this.mechanicalPower() / (voltage * this.params.efficiency);
  }
}
