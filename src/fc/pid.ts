import type { AxisPid, FlightControllerConfig } from '../config/flightController';
import { Pt1Filter } from './filters';

/**
 * Raten-PID-Regler einer Achse (Betaflight-Struktur):
 *  - P auf den Regelfehler (Soll − Ist, deg/s)
 *  - I mit I-Term-Relax (kein Aufintegrieren bei schnellen Stickbewegungen)
 *  - D auf die gefilterte Messung (nicht auf den Fehler) -> kein D-Kick bei Stickbewegung
 *  - Feedforward auf die Änderungsrate des Sollwerts
 * Ausgabe in Betaflight-Einheiten (vor Division durch 1000).
 */
export class RatePid {
  iterm = 0;
  private prevGyro = 0;
  private prevSetpoint = 0;
  private readonly dFilter: Pt1Filter;
  private readonly ffFilter: Pt1Filter;
  private readonly relaxFilter: Pt1Filter;

  /** Letzte Einzelanteile (Debug). */
  readonly last = { p: 0, i: 0, d: 0, ff: 0, sum: 0 };

  constructor(
    public gains: AxisPid,
    private readonly cfg: FlightControllerConfig,
    private readonly dt: number,
    private readonly sumLimit: number,
  ) {
    this.dFilter = new Pt1Filter(cfg.dtermLowpassHz, dt);
    this.ffFilter = new Pt1Filter(cfg.feedforwardLowpassHz, dt);
    this.relaxFilter = new Pt1Filter(cfg.itermRelaxCutoff, dt);
  }

  reset(): void {
    this.iterm = 0;
    this.prevGyro = 0;
    this.prevSetpoint = 0;
    this.dFilter.reset();
    this.ffFilter.reset();
    this.relaxFilter.reset();
  }

  /**
   * @param setpoint Soll-Drehrate (deg/s)
   * @param gyro gemessene Drehrate (deg/s)
   * @param allowIterm false hält den I-Term fest (z. B. am Boden)
   */
  /**
   * @param pdScale Faktor auf P und D (TPA)
   */
  update(setpoint: number, gyro: number, allowIterm = true, pdScale = 1): number {
    const s = this.cfg.scale;
    const g = this.gains;
    const dt = this.dt;
    const error = setpoint - gyro;

    const p = s.p * g.p * error * pdScale;

    // I-Term-Relax: Hochpass des Sollwerts, ab ~40 deg/s Abweichung kein Aufintegrieren
    const setpointLp = this.relaxFilter.apply(setpoint);
    const setpointHp = Math.abs(setpoint - setpointLp);
    const relax = Math.max(0, 1 - setpointHp / 40);
    if (allowIterm) {
      this.iterm += s.i * g.i * error * relax * dt;
      this.iterm = Math.max(-this.cfg.itermLimit, Math.min(this.cfg.itermLimit, this.iterm));
    }

    const gyroRate = (gyro - this.prevGyro) / dt;
    this.prevGyro = gyro;
    const d = -s.d * g.d * this.dFilter.apply(gyroRate) * pdScale;

    const setpointRate = (setpoint - this.prevSetpoint) / dt;
    this.prevSetpoint = setpoint;
    const ff = s.ff * g.ff * this.ffFilter.apply(setpointRate) / 100;

    const sum = Math.max(-this.sumLimit, Math.min(this.sumLimit, p + this.iterm + d + ff));
    const l = this.last;
    l.p = p;
    l.i = this.iterm;
    l.d = d;
    l.ff = ff;
    l.sum = sum;
    return sum;
  }
}
