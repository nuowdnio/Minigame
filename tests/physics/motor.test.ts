import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../src/config/physics';
import { Motor, targetOmega } from '../../src/physics/motor';

const FULL = 25.2;

describe('Motor', () => {
  it('erreicht bei Vollgas und voller Spannung genau den Maximalschub', () => {
    const m = new Motor(PHYSICS.motor, FULL);
    for (let i = 0; i < 1000; i++) m.update(1, FULL, 0.001);
    m.computeForces(1, 1);
    expect(m.thrust).toBeCloseTo(PHYSICS.motor.maxThrust, 2);
  });

  it('dreht mit Verzögerung 1. Ordnung hoch (63 % nach τ)', () => {
    const m = new Motor(PHYSICS.motor, FULL);
    const target = targetOmega(1, FULL, PHYSICS.motor);
    const tau = PHYSICS.motor.spinUpTau;
    const steps = Math.round(tau / 0.0001);
    for (let i = 0; i < steps; i++) m.update(1, FULL, 0.0001);
    expect(m.omega / target).toBeCloseTo(1 - Math.exp(-1), 2);
  });

  it('dreht langsamer herunter als hoch (spinDownTau)', () => {
    const m = new Motor(PHYSICS.motor, FULL);
    const target = targetOmega(1, FULL, PHYSICS.motor);
    m.omega = target;
    const steps = Math.round(PHYSICS.motor.spinDownTau / 0.0001);
    for (let i = 0; i < steps; i++) m.update(0, FULL, 0.0001);
    expect(m.omega / target).toBeCloseTo(Math.exp(-1), 2);
  });

  it('Schub skaliert mit ω² und damit mit dem Quadrat der Spannung', () => {
    const m = new Motor(PHYSICS.motor, FULL);
    m.omega = targetOmega(1, FULL, PHYSICS.motor);
    m.computeForces(1, 1);
    const full = m.thrust;
    m.omega = targetOmega(1, FULL * 0.8, PHYSICS.motor);
    m.computeForces(1, 1);
    expect(m.thrust / full).toBeCloseTo(0.64, 6);
  });

  it('Schub skaliert linear mit der Luftdichte', () => {
    const m = new Motor(PHYSICS.motor, FULL);
    m.omega = 2000;
    m.computeForces(1, 1);
    const a = m.thrust;
    m.computeForces(0.7, 1);
    expect(m.thrust / a).toBeCloseTo(0.7, 9);
  });

  it('Drehmoment = torqueToThrust · Schub', () => {
    const m = new Motor(PHYSICS.motor, FULL);
    m.omega = 2500;
    m.computeForces(1, 1);
    expect(m.torque).toBeCloseTo(m.thrust * PHYSICS.motor.torqueToThrust, 9);
  });

  it('beschädigter Propeller liefert weniger Schub', () => {
    const m = new Motor(PHYSICS.motor, FULL);
    m.omega = 2500;
    m.health = 0.5;
    m.computeForces(1, 1);
    const damaged = m.thrust;
    m.health = 1;
    m.computeForces(1, 1);
    expect(damaged / m.thrust).toBeCloseTo(0.5, 9);
  });

  it('Strom steigt stark mit der Drehzahl (∝ ω³)', () => {
    const m = new Motor(PHYSICS.motor, FULL);
    m.omega = 1000;
    m.omegaDot = 0;
    m.computeForces(1, 1);
    const i1 = m.current(FULL);
    m.omega = 2000;
    m.computeForces(1, 1);
    expect(m.current(FULL) / i1).toBeCloseTo(8, 6);
  });
});
