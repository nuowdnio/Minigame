import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../src/config/physics';
import { Battery, cellOpenCircuitVoltage } from '../../src/physics/battery';

const curve = PHYSICS.battery.ocvCurve;

describe('cellOpenCircuitVoltage', () => {
  it('liefert 4.2 V bei voll und 3.27 V bei leer', () => {
    expect(cellOpenCircuitVoltage(1, curve)).toBeCloseTo(4.2);
    expect(cellOpenCircuitVoltage(0, curve)).toBeCloseTo(3.27);
  });
  it('interpoliert linear zwischen Stützstellen', () => {
    expect(cellOpenCircuitVoltage(0.95, curve)).toBeCloseTo(4.15, 6);
  });
  it('ist monoton steigend', () => {
    let prev = 0;
    for (let s = 0; s <= 1; s += 0.01) {
      const v = cellOpenCircuitVoltage(s, curve);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('Battery', () => {
  it('startet mit voller Spannung (6S = 25.2 V)', () => {
    const b = new Battery(PHYSICS.battery);
    expect(b.openCircuitVoltage()).toBeCloseTo(25.2);
    expect(b.terminalVoltage(0)).toBeCloseTo(25.2);
  });

  it('bricht unter Last sofort um I·R ein (Voltage Sag)', () => {
    const b = new Battery(PHYSICS.battery);
    const sag = b.terminalVoltage(0) - b.terminalVoltage(100);
    expect(sag).toBeCloseTo(100 * PHYSICS.battery.internalResistance, 6);
  });

  it('Polarisation baut sich unter Dauerlast auf und erholt sich wieder', () => {
    const b = new Battery(PHYSICS.battery);
    for (let i = 0; i < 5000; i++) b.step(80, 0.001);
    const underLoad = b.polarizationVoltage;
    expect(underLoad).toBeGreaterThan(0.3);
    for (let i = 0; i < 20000; i++) b.step(0, 0.001);
    expect(b.polarizationVoltage).toBeLessThan(underLoad * 0.1);
  });

  it('verbraucht Ladung gemäß ∫I dt', () => {
    const b = new Battery({ ...PHYSICS.battery, idleCurrent: 0 });
    // 36 A für 10 s = 100 mAh
    for (let i = 0; i < 10000; i++) b.step(36, 0.001);
    expect(b.usedMah).toBeCloseTo(100, 3);
    expect(b.soc).toBeCloseTo(1 - 100 / PHYSICS.battery.capacityMah, 5);
  });

  it('Spannung sinkt mit der Entladung', () => {
    const b = new Battery(PHYSICS.battery);
    const v0 = b.openCircuitVoltage();
    for (let i = 0; i < 60000; i++) b.step(30, 0.001);
    expect(b.openCircuitVoltage()).toBeLessThan(v0 - 1);
  });
});
