import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { RigidBody, integrateOrientation } from '../../src/physics/rigidbody';

describe('RigidBody', () => {
  it('beschleunigt mit F/m', () => {
    const b = new RigidBody(2, { x: 1, y: 1, z: 1 });
    for (let i = 0; i < 1000; i++) {
      b.clearAccumulators();
      b.force.set(4, 0, 0);
      b.integrate(0.001);
    }
    expect(b.velocity.x).toBeCloseTo(2, 6);
    expect(b.position.x).toBeCloseTo(1, 2);
  });

  it('Winkelbeschleunigung = τ / I pro Achse', () => {
    const b = new RigidBody(1, { x: 0.002, y: 0.004, z: 0.001 });
    b.torque.set(0.002, 0.004, 0.001);
    b.integrate(0.01);
    expect(b.angularVelocity.x).toBeCloseTo(0.01, 9);
    expect(b.angularVelocity.y).toBeCloseTo(0.01, 9);
    expect(b.angularVelocity.z).toBeCloseTo(0.01, 9);
  });

  it('erhält ohne Drehmoment Drehimpuls und Rotationsenergie (Kreiselterm)', () => {
    const I = { x: 0.002, y: 0.004, z: 0.0015 };
    const b = new RigidBody(1, I);
    b.angularVelocity.set(3, 0.2, 5);
    const L = () => {
      const w = b.angularVelocity;
      return new Vector3(I.x * w.x, I.y * w.y, I.z * w.z).applyQuaternion(b.orientation);
    };
    const E = () => {
      const w = b.angularVelocity;
      return 0.5 * (I.x * w.x * w.x + I.y * w.y * w.y + I.z * w.z * w.z);
    };
    const L0 = L();
    const E0 = E();
    for (let i = 0; i < 20000; i++) {
      b.clearAccumulators();
      b.integrate(0.0001);
    }
    expect(L().distanceTo(L0) / L0.length()).toBeLessThan(0.01);
    expect(Math.abs(E() - E0) / E0).toBeLessThan(0.01);
  });

  it('Kraft am Hebelarm erzeugt Drehmoment r × F (im Körper-System)', () => {
    const b = new RigidBody(1, { x: 1, y: 1, z: 1 });
    b.applyForceAtWorldOffset(new Vector3(0, 1, 0), new Vector3(1, 0, 0));
    expect(b.torque.z).toBeCloseTo(1, 9);
    expect(b.force.y).toBeCloseTo(1, 9);
  });

  it('Impuls ändert Geschwindigkeit um J/m', () => {
    const b = new RigidBody(0.5, { x: 1, y: 1, z: 1 });
    b.applyImpulseAtWorldOffset(new Vector3(0, 1, 0), new Vector3(0, 0, 0));
    expect(b.velocity.y).toBeCloseTo(2, 9);
    expect(b.angularVelocity.length()).toBe(0);
  });
});

describe('integrateOrientation', () => {
  it('dreht um exakt ω·t', () => {
    const q = new Quaternion();
    const w = new Vector3(0, Math.PI, 0);
    for (let i = 0; i < 100; i++) integrateOrientation(q, w, 0.005);
    // 0.5 s · π rad/s = 90°
    const fwd = new Vector3(0, 0, -1).applyQuaternion(q);
    expect(fwd.x).toBeCloseTo(-1, 6);
    expect(q.length()).toBeCloseTo(1, 9);
  });
});
