import { describe, expect, it } from 'vitest';
import { airfoilCoefficients, flapEffectiveness, liftSlope, stallBlend } from '../../src/physics/airfoil';

const DEG = Math.PI / 180;
const p = { cl0: 0.2, clAlpha: liftSlope(7), alphaStall: 14 * DEG, cd0: 0.012, oswald: 0.8, aspectRatio: 7, stallSharpness: 40 };

describe('Tragflächen-Aerodynamik', () => {
  it('Auftriebsanstieg: unendliche Streckung → 2π, AR 6 ≈ 4.5/rad', () => {
    expect(liftSlope(1e6)).toBeCloseTo(2 * Math.PI, 3);
    expect(liftSlope(6)).toBeGreaterThan(4.1);
    expect(liftSlope(6)).toBeLessThan(4.7);
  });

  it('Klappenwirksamkeit wächst mit der Rudertiefe', () => {
    expect(flapEffectiveness(0.25)).toBeGreaterThan(0.45);
    expect(flapEffectiveness(0.25)).toBeLessThan(0.6);
    expect(flapEffectiveness(0.4)).toBeGreaterThan(flapEffectiveness(0.2));
  });

  it('linearer Bereich: CL = CL0 + a·α', () => {
    const r = airfoilCoefficients(4 * DEG, 0, 0, p);
    expect(r.cl).toBeCloseTo(0.2 + p.clAlpha * 4 * DEG, 2);
    expect(r.stall).toBeLessThan(0.01);
  });

  it('Strömungsabriss: über dem Abrisswinkel bricht der Auftrieb ein, Widerstand steigt stark', () => {
    const pre = airfoilCoefficients(13 * DEG, 0, 0, p);
    const post = airfoilCoefficients(25 * DEG, 0, 0, p);
    expect(post.cl).toBeLessThan(pre.cl);
    expect(post.cd).toBeGreaterThan(pre.cd * 2);
    expect(post.stall).toBeGreaterThan(0.9);
    expect(stallBlend(0, 14 * DEG, 40)).toBeLessThan(0.01);
  });

  it('Ruder nach unten erhöht den Auftrieb', () => {
    const tau = flapEffectiveness(0.3);
    expect(airfoilCoefficients(2 * DEG, 10 * DEG, tau, p).cl).toBeGreaterThan(airfoilCoefficients(2 * DEG, 0, tau, p).cl + 0.2);
  });

  it('induzierter Widerstand ∝ CL²', () => {
    const a = airfoilCoefficients(2 * DEG, 0, 0, { ...p, cl0: 0 });
    const b = airfoilCoefficients(4 * DEG, 0, 0, { ...p, cl0: 0 });
    expect((b.cd - p.cd0) / (a.cd - p.cd0)).toBeCloseTo(4, 1);
  });
});
