import type { AxisRates } from '../config/defaults';

/** Maximale Drehrate, die Betaflight zulässt (deg/s). */
export const MAX_RATE = 1998;

/**
 * Betaflight-Rates ("Betaflight"-Rate-Typ):
 *   expo:  x' = x·|x|³·expo + x·(1 − expo)
 *   rate:  200 · rcRate · x'          (rcRate > 2 wird überproportional erhöht)
 *   super: · 1 / (1 − |x|·superRate)
 *
 * @param stick Stickausschlag −1..1
 * @returns Soll-Drehrate (deg/s)
 */
export function betaflightRate(stick: number, rates: AxisRates): number {
  let x = Math.max(-1, Math.min(1, stick));
  const absX = Math.abs(x);
  if (rates.expo > 0) {
    x = x * absX * absX * absX * rates.expo + x * (1 - rates.expo);
  }
  let rcRate = rates.rcRate;
  if (rcRate > 2) rcRate += 14.54 * (rcRate - 2);
  let angleRate = 200 * rcRate * x;
  if (rates.superRate > 0) {
    const factor = 1 / Math.max(0.01, Math.min(1, 1 - absX * rates.superRate));
    angleRate *= factor;
  }
  return Math.max(-MAX_RATE, Math.min(MAX_RATE, angleRate));
}

/** Maximale Drehrate bei vollem Stickausschlag (deg/s). */
export function maxRate(rates: AxisRates): number {
  return betaflightRate(1, rates);
}

/**
 * Betaflight-Gaskurve (thr_mid / thr_expo).
 * @param throttle 0..1
 */
export function throttleCurve(throttle: number, mid: number, expo: number): number {
  const t = Math.max(0, Math.min(1, throttle));
  const tmp = t - mid;
  let y = 1;
  if (tmp > 0) y = 1 - mid;
  else if (tmp < 0) y = mid;
  if (y === 0) return t;
  return mid + tmp * (1 - expo + (expo * tmp * tmp) / (y * y));
}
