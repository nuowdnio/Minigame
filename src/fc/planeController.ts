import type { Quaternion } from 'three';
import { Vector3 } from 'three';
import type { PlaneControlConfig } from '../config/planes';
import type { Sticks } from './flightController';

import type { PlaneMode } from '../config/defaults';
export type { PlaneMode };

const DEG = Math.PI / 180;
const _f = new Vector3();
const _r = new Vector3();
const _up = new Vector3();

function expo(x: number, e: number): number {
  return x * (1 - e) + x * x * x * e;
}

function clamp(v: number, lo = -1, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Lagewinkel aus der Orientierung: Querneigung (+ = rechts), Längsneigung (+ = Nase hoch), in rad. */
export function attitude(q: Quaternion): { bank: number; pitch: number } {
  _f.set(0, 0, -1).applyQuaternion(q);
  _r.set(1, 0, 0).applyQuaternion(q);
  _up.set(0, 1, 0).applyQuaternion(q);
  return {
    pitch: Math.asin(clamp(_f.y)),
    bank: Math.atan2(-_r.y, _up.y),
  };
}

/**
 * Flugsteuerung für Starrflügler (wie ein einfacher Flugregler, z. B. INAV/AS3X):
 *  - manual: Sticks direkt auf die Ruder (mit Expo)
 *  - gyro:   Stabilisiert – Ratenregler dämpft Böen, Stick gibt Drehrate vor
 *  - angle:  Lagestabilisiert – Stick gibt Querneigung/Längsneigung vor, loslassen = geradeaus
 * Verstärkungen werden mit dem Staudruck angepasst (schnell = kleinere Ausschläge).
 * Ausgaben: normierte Achsbefehle roll/pitch/yaw (−1..1) und Gas.
 */
export class PlaneController {
  armed = false;
  mode: PlaneMode = 'gyro';
  readonly output = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  /** Integratoren des Angle-Modus (Trimmung wird automatisch gefunden). */
  private iRoll = 0;
  private iPitch = 0;

  constructor(public cfg: PlaneControlConfig) {}

  reset(): void {
    this.armed = false;
    this.output.roll = this.output.pitch = this.output.yaw = this.output.throttle = 0;
    this.iRoll = this.iPitch = 0;
  }

  /**
   * @param rates Drehraten in FC-Achsen (deg/s, roll + = rechts, pitch + = Nase runter, yaw + = rechts)
   */
  update(
    sticks: Sticks,
    rates: { roll: number; pitch: number; yaw: number },
    q: Quaternion,
    airspeed: number,
    dt: number,
  ): void {
    const c = this.cfg;
    if (!this.armed && sticks.throttle < 0.05) this.armed = true;
    const o = this.output;
    o.throttle = this.armed ? sticks.throttle : 0;

    // Querrudertrimmung gegen das Propeller-Drehmoment (∝ Schub ∝ Gas², kalibriert bei 50 % Gas)
    const torqueTrim = c.rollTrim * Math.min(4, (o.throttle / 0.5) ** 2);
    const sr = expo(sticks.roll, c.expo);
    const sp = expo(sticks.pitch, c.expo);
    const sy = expo(sticks.yaw, c.expo);

    if (this.mode === 'manual') {
      o.roll = sr + torqueTrim;
      o.pitch = sp + c.pitchTrim;
      o.yaw = sy;
      return;
    }

    // Verstärkungsanpassung über den Staudruck (∝ V²)
    const v = Math.max(airspeed, c.refSpeed * 0.4);
    const sched = Math.min(3, (c.refSpeed * c.refSpeed) / (v * v));

    let wantRoll: number;
    let wantPitch: number;
    let ffRoll = sr;
    let ffPitch = sp;
    if (this.mode === 'angle') {
      const att = attitude(q);
      const targetBank = sticks.roll * c.maxBank * DEG;
      const targetPitch = -sticks.pitch * c.maxPitch * DEG;
      wantRoll = clamp(4 * (targetBank - att.bank) / DEG, -c.maxRate.roll, c.maxRate.roll);
      // Kurvenkoordination: im Kurvenflug braucht es eine Nickrate nach oben (g/V · sinφ · tanφ)
      const bank = clamp(att.bank, -1.3, 1.3);
      const turnRate = (9.81 / v) * Math.sin(bank) * Math.tan(bank) / DEG;
      const wantNoseUp = 3 * (targetPitch - att.pitch) / DEG + turnRate;
      wantPitch = clamp(-wantNoseUp, -c.maxRate.pitch, c.maxRate.pitch);
      ffRoll = 0;
      ffPitch = 0;
    } else {
      wantRoll = sticks.roll * c.maxRate.roll;
      wantPitch = sticks.pitch * c.maxRate.pitch;
    }
    const wantYaw = sticks.yaw * c.maxRate.yaw;

    // Stabilisiert: nur Dämpfung (schwächer), Angle: volle Regelung mit Integrator
    const k = this.mode === 'angle' ? 1 : 0.4;
    const eRoll = wantRoll - rates.roll;
    const ePitch = wantPitch - rates.pitch;
    let iR = 0;
    let iP = 0;
    if (this.mode === 'angle') {
      const ki = 0.5 * sched;
      this.iRoll = clamp(this.iRoll + c.rateGain.roll * eRoll * ki * dt, -0.3, 0.3);
      this.iPitch = clamp(this.iPitch + c.rateGain.pitch * ePitch * ki * dt, -0.4, 0.4);
      iR = this.iRoll;
      iP = this.iPitch;
    }
    o.roll = clamp(ffRoll * 0.6 + k * c.rateGain.roll * eRoll * sched + iR + (this.mode === 'angle' ? 0 : torqueTrim));
    o.pitch = clamp(ffPitch * 0.6 + k * c.rateGain.pitch * ePitch * sched + iP + c.pitchTrim);
    o.yaw = clamp(sy * 0.7 + k * c.rateGain.yaw * (wantYaw - rates.yaw) * sched);
  }
}
