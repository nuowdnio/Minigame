import { describe, expect, it } from 'vitest';
import { airDensity, dragForce, groundEffectFactor, inflowFactor } from '../../src/physics/aero';

describe('airDensity', () => {
  it('liefert Meereshöhen-Dichte bei 0 m', () => {
    expect(airDensity(0, 1.225, 8500)).toBeCloseTo(1.225, 6);
  });
  it('nimmt mit der Höhe ab (3000 m ≈ 70 %)', () => {
    const r = airDensity(3000, 1.225, 8500) / 1.225;
    expect(r).toBeLessThan(0.75);
    expect(r).toBeGreaterThan(0.65);
  });
});

describe('dragForce', () => {
  const lin = { x: 0.1, y: 0.2, z: 0.1 };
  const area = { x: 0.01, y: 0.02, z: 0.01 };
  it('wirkt entgegen der Anströmung', () => {
    const f = dragForce({ x: 0, y: 0, z: -10 }, lin, area, 1.225, { x: 0, y: 0, z: 0 });
    expect(f.z).toBeGreaterThan(0);
    expect(f.x).toBeCloseTo(0, 12);
    expect(f.y).toBeCloseTo(0, 12);
  });
  it('setzt sich aus linearem und quadratischem Anteil zusammen', () => {
    const v = 20;
    const f = dragForce({ x: v, y: 0, z: 0 }, lin, area, 1.225, { x: 0, y: 0, z: 0 });
    expect(-f.x).toBeCloseTo(0.1 * v + 0.5 * 1.225 * 0.01 * v * v, 9);
  });
  it('ist null ohne Anströmung', () => {
    const f = dragForce({ x: 0, y: 0, z: 0 }, lin, area, 1.225, { x: 1, y: 1, z: 1 });
    expect([f.x, f.y, f.z]).toEqual([-0, -0, -0]);
  });
});

describe('groundEffectFactor', () => {
  const R = 0.0635;
  it('ist > 1 in Bodennähe und begrenzt', () => {
    expect(groundEffectFactor(0.03, R, 1.25)).toBeGreaterThan(1.05);
    expect(groundEffectFactor(0.0, R, 1.25)).toBe(1.25);
  });
  it('verschwindet mit zunehmender Höhe', () => {
    expect(groundEffectFactor(1.0, R, 1.25)).toBeCloseTo(1, 3);
  });
  it('ist monoton fallend mit der Höhe', () => {
    let prev = Infinity;
    for (let h = 0.02; h < 1; h += 0.02) {
      const f = groundEffectFactor(h, R, 1.25);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });
});

describe('inflowFactor', () => {
  it('ist 1 im Stand', () => {
    expect(inflowFactor(0, 3000, 0.109, 1.15)).toBe(1);
  });
  it('reduziert Schub beim Steigen und erreicht 0 bei Pitch-Speed', () => {
    const omega = 3000;
    const pitchSpeed = (omega * 0.109) / (2 * Math.PI);
    expect(inflowFactor(pitchSpeed / 2, omega, 0.109, 1.15)).toBeCloseTo(0.5, 6);
    expect(inflowFactor(pitchSpeed * 1.2, omega, 0.109, 1.15)).toBe(0);
  });
  it('erhöht Schub begrenzt beim Sinken', () => {
    expect(inflowFactor(-100, 3000, 0.109, 1.15)).toBe(1.15);
  });
});
