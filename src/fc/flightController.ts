import type { FlightControllerConfig } from '../config/flightController';
import type { FlightMode, RatesSettings } from '../config/defaults';
import type { MotorLayoutEntry } from '../config/physics';
import { Pt1Filter } from './filters';
import { buildMixer, mix, type MixerRule } from './mixer';
import { RatePid } from './pid';
import { betaflightRate, throttleCurve } from './rates';

/** Normierte Steuereingaben. */
export interface Sticks {
  /** 0..1 */
  throttle: number;
  /** −1..1, + = rechts */
  roll: number;
  /** −1..1, + = Stick nach vorne (Nase runter) */
  pitch: number;
  /** −1..1, + = rechts */
  yaw: number;
}

/** Gyro-Messung in FC-Achsen (deg/s), Vorzeichen wie Sticks. */
export interface GyroRates {
  roll: number;
  pitch: number;
  yaw: number;
}

/**
 * Simulierter Flight Controller: Rates -> Raten-PID -> Airmode-Mixer -> Motor-Ausgaben.
 */
export class FlightController {
  armed = false;
  mode: FlightMode = 'acro';
  readonly setpoint: GyroRates = { roll: 0, pitch: 0, yaw: 0 };
  readonly motorOutputs: number[];
  readonly pids: { roll: RatePid; pitch: RatePid; yaw: RatePid };
  private readonly mixer: MixerRule[];
  private readonly mixBuffer: number[];
  private readonly gyroFilters: Pt1Filter[];
  /** Verhältnis Referenz-Zellspannung / aktuelle Zellspannung (für die Spannungskompensation). */
  vbatRatio = 1;
  readonly filteredGyro: GyroRates = { roll: 0, pitch: 0, yaw: 0 };

  constructor(
    readonly cfg: FlightControllerConfig,
    public rates: RatesSettings,
    motors: MotorLayoutEntry[],
    readonly dt: number,
  ) {
    this.mixer = buildMixer(motors);
    this.mixBuffer = new Array(motors.length).fill(0);
    this.motorOutputs = new Array(motors.length).fill(0);
    this.pids = {
      roll: new RatePid(cfg.pid.roll, cfg, dt, cfg.pidSumLimit),
      pitch: new RatePid(cfg.pid.pitch, cfg, dt, cfg.pidSumLimit),
      yaw: new RatePid(cfg.pid.yaw, cfg, dt, cfg.pidSumLimitYaw),
    };
    this.gyroFilters = [0, 1, 2].map(() => new Pt1Filter(cfg.gyroLowpassHz, dt));
  }

  reset(): void {
    this.armed = false;
    this.pids.roll.reset();
    this.pids.pitch.reset();
    this.pids.yaw.reset();
    this.gyroFilters.forEach((f) => f.reset());
    this.motorOutputs.fill(0);
  }

  /**
   * Einen Regelzyklus ausführen.
   * @param onGround true, solange die Drohne aufliegt (I-Term wird dann nicht aufgebaut)
   * @returns Motor-Ansteuerung 0..1 inkl. Idle (0 = aus)
   */
  /**
   * @param attitude Lage aus dem Beschleunigungssensor/Gyro (rad): bank + = rechts, pitch + = Nase hoch.
   *                 Wird für Angle/Horizon benötigt.
   */
  update(sticks: Sticks, gyro: GyroRates, onGround = false, attitude?: { bank: number; pitch: number }): number[] {
    const cfg = this.cfg;
    if (!this.armed && sticks.throttle < cfg.armThrottleThreshold) {
      this.armed = true;
    }

    const fg = this.filteredGyro;
    fg.roll = this.gyroFilters[0].apply(gyro.roll);
    fg.pitch = this.gyroFilters[1].apply(gyro.pitch);
    fg.yaw = this.gyroFilters[2].apply(gyro.yaw);

    if (!this.armed) {
      this.motorOutputs.fill(0);
      return this.motorOutputs;
    }

    const sp = this.setpoint;
    sp.roll = betaflightRate(sticks.roll, this.rates.roll);
    sp.pitch = betaflightRate(sticks.pitch, this.rates.pitch);
    sp.yaw = betaflightRate(sticks.yaw, this.rates.yaw);

    // Angle/Horizon: Selbststabilisierung (Betaflight: Winkelfehler · level strength)
    if (attitude && this.mode !== 'acro') {
      const R2D = 180 / Math.PI;
      const rollAngle = attitude.bank * R2D; // + = rechts geneigt
      const pitchAngle = -attitude.pitch * R2D; // + = Nase unten
      const lim = cfg.angleLimit;
      if (this.mode === 'angle') {
        sp.roll = (sticks.roll * lim - rollAngle) * cfg.angleStrength;
        sp.pitch = (sticks.pitch * lim - pitchAngle) * cfg.angleStrength;
        sp.roll = Math.max(-cfg.angleMaxRate, Math.min(cfg.angleMaxRate, sp.roll));
        sp.pitch = Math.max(-cfg.angleMaxRate, Math.min(cfg.angleMaxRate, sp.pitch));
      } else {
        // Horizon: nahe der Stickmitte wie Angle, bei Vollausschlag reines Acro (Flips möglich)
        const k = Math.max(0, 1 - Math.max(Math.abs(sticks.roll), Math.abs(sticks.pitch)) / 0.75);
        const level = k * k;
        // nur aufrichten, wenn die Drohne nicht über Kopf ist
        if (Math.abs(rollAngle) < 100) {
          sp.roll += -rollAngle * cfg.angleStrength * level;
          sp.pitch += -pitchAngle * cfg.angleStrength * level;
        }
      }
    }

    const throttle = throttleCurve(sticks.throttle, this.rates.throttleMid, this.rates.throttleExpo);
    // Am Boden mit wenig Gas: I-Term nicht aufbauen (wie Betaflight bei Gas unterhalb Airmode-Schwelle)
    const allowI = !(onGround && throttle < 0.25);
    if (!allowI) {
      this.pids.roll.iterm *= 0.9;
      this.pids.pitch.iterm *= 0.9;
      this.pids.yaw.iterm *= 0.9;
    }

    // TPA: P und D oberhalb des Breakpoints abschwächen
    const tpa =
      1 - cfg.tpaRate * Math.max(0, Math.min(1, (throttle - cfg.tpaBreakpoint) / Math.max(0.01, 1 - cfg.tpaBreakpoint)));
    // Spannungskompensation: gleiche Stickausschläge -> gleicher Schub, auch bei leerem Akku
    const comp = Math.min(1.4, 1 + cfg.vbatSagComp * (this.vbatRatio - 1));

    const scale = cfg.scale.mixer;
    const r = (this.pids.roll.update(sp.roll, fg.roll, allowI, tpa) / scale) * comp;
    const p = (this.pids.pitch.update(sp.pitch, fg.pitch, allowI, tpa) / scale) * comp;
    const y = (this.pids.yaw.update(sp.yaw, fg.yaw, allowI) / scale) * cfg.yawMotorsLimit * comp;

    mix(this.mixer, Math.min(1, throttle * comp), r, p, y, this.mixBuffer, true);

    const idle = this.cfgIdle;
    const tl = cfg.thrustLinear;
    for (let i = 0; i < this.mixBuffer.length; i++) {
      // Thrust Linearization: out' = out·(1+tl) − tl·out²
      const m = this.mixBuffer[i];
      const lin = tl > 0 ? m * (1 + tl) - tl * m * m : m;
      this.motorOutputs[i] = idle + lin * (1 - idle);
    }
    return this.motorOutputs;
  }

  /** Motor-Leerlauf (wird von der Simulation gesetzt). */
  cfgIdle = 0.055;
}
