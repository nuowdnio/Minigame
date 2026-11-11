/**
 * Flight-Controller-Tuning (Betaflight-ähnliche Skalierung).
 * Die Zahlenwerte entsprechen in der Größenordnung den Betaflight-Werten,
 * d. h. P/I/D/FF können wie in der Betaflight-Konfiguration getunt werden.
 */

export interface AxisPid {
  p: number;
  i: number;
  d: number;
  ff: number;
}

export const FLIGHT_CONTROLLER = {
  pid: {
    roll: { p: 45, i: 80, d: 30, ff: 120 } as AxisPid,
    pitch: { p: 47, i: 84, d: 34, ff: 125 } as AxisPid,
    yaw: { p: 45, i: 80, d: 0, ff: 120 } as AxisPid,
  },
  /** Betaflight-interne Skalierungsfaktoren. */
  scale: {
    p: 0.032029,
    i: 0.244381,
    d: 0.000529,
    ff: 0.013754,
    /** PID-Summe wird durch diesen Wert geteilt, um in den Mixer-Bereich zu kommen. */
    mixer: 1000,
  },
  /** Begrenzung der PID-Summe (Betaflight pidsum_limit). */
  pidSumLimit: 500,
  pidSumLimitYaw: 400,
  /** Begrenzung des I-Anteils. */
  itermLimit: 400,
  /** Tiefpass für den D-Term (Hz). */
  dtermLowpassHz: 90,
  /** Tiefpass für den Gyro (Hz). */
  gyroLowpassHz: 250,
  /** Glättung des Feedforward-Signals (Hz). */
  feedforwardLowpassHz: 40,
  /** I-Term-Relax: Setpoint-Änderungsrate (deg/s²), ab der der I-Term nicht mehr aufintegriert. */
  itermRelaxCutoff: 15,
  /** Gier-Begrenzung im Mixer (Anteil, wie yaw_motors_limit). */
  yawMotorsLimit: 1.0,
  /** Angle-Modus: maximaler Neigungswinkel (Grad), Rückstellstärke (deg/s pro Grad), max. Drehrate. */
  angleLimit: 55,
  angleStrength: 5,
  angleMaxRate: 400,
  /**
   * TPA (Throttle PID Attenuation): oberhalb des Breakpoints werden P und D linear bis auf
   * (1 − tpaRate) bei Vollgas reduziert – verhindert Schwingen bei hoher Drehzahl.
   */
  tpaRate: 0,
  tpaBreakpoint: 0.5,
  /** Thrust Linearization (0..0.5): hebt kleine Motorausgaben an (Schub ∝ ω²). */
  thrustLinear: 0,
  /** Spannungskompensation (0..1): gleicht den Schubverlust durch Spannungssag aus. */
  vbatSagComp: 0,
  /** Gas unterhalb dessen nach einem Reset automatisch scharf geschaltet wird. */
  armThrottleThreshold: 0.05,
};

export type FlightControllerConfig = typeof FLIGHT_CONTROLLER;
