import { describe, expect, it } from 'vitest';
import { betaflightRate, maxRate, throttleCurve } from '../../src/fc/rates';

describe('betaflightRate', () => {
  const bf = { rcRate: 1.0, superRate: 0.7, expo: 0 };

  it('Stick-Mitte ergibt 0 °/s', () => {
    expect(betaflightRate(0, bf)).toBe(0);
  });

  it('Betaflight-Standard (1.0 / 0.7 / 0) ergibt 667 °/s Maximalrate', () => {
    expect(maxRate(bf)).toBeCloseTo(666.67, 1);
  });

  it('ohne Super Rate und Expo linear: 200 · RC Rate · Stick', () => {
    const lin = { rcRate: 1.5, superRate: 0, expo: 0 };
    expect(betaflightRate(0.5, lin)).toBeCloseTo(150, 9);
    expect(betaflightRate(1, lin)).toBeCloseTo(300, 9);
  });

  it('ist punktsymmetrisch', () => {
    for (const x of [0.1, 0.3, 0.77, 1]) {
      expect(betaflightRate(-x, bf)).toBeCloseTo(-betaflightRate(x, bf), 9);
    }
  });

  it('Expo macht die Mitte weicher, ändert aber nicht die Maximalrate', () => {
    const e = { ...bf, expo: 0.5 };
    expect(betaflightRate(0.3, e)).toBeLessThan(betaflightRate(0.3, bf));
    expect(maxRate(e)).toBeCloseTo(maxRate(bf), 9);
  });

  it('RC Rate > 2 wird überproportional erhöht', () => {
    expect(maxRate({ rcRate: 2.1, superRate: 0, expo: 0 })).toBeCloseTo(200 * (2.1 + 14.54 * 0.1), 6);
  });

  it('begrenzt auf 1998 °/s', () => {
    expect(maxRate({ rcRate: 2.55, superRate: 0.99, expo: 0 })).toBe(1998);
  });

  it('typische Freestyle-Rates (1.0/0.7/0) bei halbem Stick ≈ 154 °/s', () => {
    expect(betaflightRate(0.5, bf)).toBeCloseTo(100 / 0.65, 6);
  });
});

describe('throttleCurve', () => {
  it('ist ohne Expo linear', () => {
    for (const t of [0, 0.25, 0.5, 0.8, 1]) expect(throttleCurve(t, 0.5, 0)).toBeCloseTo(t, 9);
  });
  it('Endpunkte und Mittelpunkt bleiben fest', () => {
    expect(throttleCurve(0, 0.4, 0.6)).toBeCloseTo(0, 9);
    expect(throttleCurve(1, 0.4, 0.6)).toBeCloseTo(1, 9);
    expect(throttleCurve(0.4, 0.4, 0.6)).toBeCloseTo(0.4, 9);
  });
  it('Expo flacht um die Mitte ab', () => {
    expect(throttleCurve(0.55, 0.5, 0.8)).toBeLessThan(0.55);
    expect(throttleCurve(0.45, 0.5, 0.8)).toBeGreaterThan(0.45);
  });
});
