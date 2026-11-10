import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../src/config/physics';
import { Motor, fullThrottleOmega, motorConstant, noLoadOmega } from '../../src/physics/motor';

const FULL = 25.2;
const P = PHYSICS.motor;

function spinUp(m: Motor, cmd: number, v: number, seconds: number, dt = 0.0001) {
  for (let i = 0; i < seconds / dt; i++) {
    m.update(cmd, v, dt);
    m.computeForces(1, 1);
  }
}

describe('Motor (elektromechanisch)', () => {
  it('K_e aus KV: 1850 KV -> 5.16 mV·s/rad', () => {
    expect(motorConstant(1850)).toBeCloseTo(0.00516, 5);
  });

  it('erreicht bei Vollgas und voller Spannung genau den Maximalschub', () => {
    const m = new Motor(P, FULL);
    spinUp(m, 1, FULL, 0.5);
    expect(m.thrust).toBeCloseTo(P.maxThrust, 1);
    expect(m.omega).toBeCloseTo(fullThrottleOmega(P, FULL), -1);
  });

  it('Volllastdrehzahl liegt realistisch bei 80–95 % der Leerlaufdrehzahl', () => {
    const r = fullThrottleOmega(P, FULL) / noLoadOmega(1, FULL, P);
    expect(r).toBeGreaterThan(0.8);
    expect(r).toBeLessThan(0.95);
  });

  it('Stromaufnahme bei Vollgas ~ 35–50 A (5"-Motor auf 6S)', () => {
    const m = new Motor(P, FULL);
    spinUp(m, 1, FULL, 0.5);
    expect(m.motorCurrent).toBeGreaterThan(35);
    expect(m.motorCurrent).toBeLessThan(50);
  });

  it('Hochlaufzeit (10→90 %) im realistischen Bereich 20–80 ms', () => {
    const m = new Motor(P, FULL);
    spinUp(m, 0.1, FULL, 0.3);
    const w0 = m.omega;
    const target = (() => {
      const t = new Motor(P, FULL);
      spinUp(t, 0.9, FULL, 0.5);
      return t.omega;
    })();
    let t = 0;
    while (m.omega < w0 + 0.9 * (target - w0) && t < 1) {
      m.update(0.9, FULL, 0.0001);
      m.computeForces(1, 1);
      t += 0.0001;
    }
    expect(t).toBeGreaterThan(0.015);
    expect(t).toBeLessThan(0.08);
  });

  it('aktives Bremsen: beim Gaswegnehmen fließt Strom zurück', () => {
    const m = new Motor(P, FULL);
    spinUp(m, 0.8, FULL, 0.3);
    m.update(0.1, FULL, 0.0001);
    expect(m.motorCurrent).toBeLessThan(0);
  });

  it('weniger Spannung -> weniger Drehzahl -> weniger Schub', () => {
    const a = new Motor(P, FULL);
    const b = new Motor(P, FULL);
    spinUp(a, 1, FULL, 0.5);
    spinUp(b, 1, FULL * 0.85, 0.5);
    expect(b.thrust / a.thrust).toBeGreaterThan(0.6);
    expect(b.thrust / a.thrust).toBeLessThan(0.8);
  });

  it('entlasteter Propeller (Fahrt) dreht höher', () => {
    const a = new Motor(P, FULL);
    const b = new Motor(P, FULL);
    for (let i = 0; i < 5000; i++) {
      a.update(0.7, FULL, 0.0001, 1, 1);
      b.update(0.7, FULL, 0.0001, 1, 0.6);
    }
    expect(b.omega).toBeGreaterThan(a.omega * 1.02);
  });

  it('dünne Luft: weniger Last -> höhere Drehzahl, aber weniger Schub', () => {
    const a = new Motor(P, FULL);
    const b = new Motor(P, FULL);
    for (let i = 0; i < 5000; i++) {
      a.update(1, FULL, 0.0001, 1);
      b.update(1, FULL, 0.0001, 0.7);
    }
    a.computeForces(1, 1);
    b.computeForces(0.7, 1);
    expect(b.omega).toBeGreaterThan(a.omega);
    expect(b.thrust).toBeLessThan(a.thrust);
  });

  it('Drehmoment = torqueToThrust · Schub', () => {
    const m = new Motor(P, FULL);
    m.omega = 2500;
    m.computeForces(1, 1);
    expect(m.torque).toBeCloseTo(m.thrust * P.torqueToThrust, 9);
  });

  it('Vollgas-Dauerbetrieb: Motor wird warm (50–110 °C), brennt aber nicht durch', () => {
    const m = new Motor(P, FULL);
    for (let i = 0; i < 60000; i++) m.update(1, FULL, 0.001, 1, 1, 20, 20);
    expect(m.motorTemp).toBeGreaterThan(50);
    expect(m.motorTemp).toBeLessThan(110);
    expect(m.failure).toBe('');
  });

  it('blockierter Propeller bei Gas: Regler oder Motor brennen nach einigen Sekunden durch', () => {
    const m = new Motor(P, FULL);
    m.obstruction = 1; // Propeller steckt fest
    let t = 0;
    while (m.failure === '' && t < 20) {
      m.update(0.6, FULL, 0.001, 1, 1, 20, 0);
      t += 0.001;
    }
    expect(['esc', 'motor']).toContain(m.failure);
    expect(t).toBeLessThan(25);
    // danach liefert der Antrieb nichts mehr
    m.obstruction = 0;
    for (let i = 0; i < 2000; i++) m.update(1, FULL, 0.001);
    expect(m.omega).toBeLessThan(10);
  });

  it('Regler begrenzt den Anlaufstrom (kein Spannungszusammenbruch)', () => {
    const m = new Motor(P, FULL);
    m.update(1, FULL, 0.0001);
    expect(m.motorCurrent).toBeLessThanOrEqual(1.5 * P.escCurrentLimit + 1e-6);
    expect(m.batteryCurrent).toBeLessThan(20);
  });

  it('beschädigter Propeller liefert weniger Schub', () => {
    const m = new Motor(P, FULL);
    m.omega = 2500;
    m.health = 0.5;
    m.computeForces(1, 1);
    const damaged = m.thrust;
    m.health = 1;
    m.computeForces(1, 1);
    expect(damaged / m.thrust).toBeCloseTo(0.5, 9);
  });
});
