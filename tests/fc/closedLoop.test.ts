import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults';
import { createCalmEnvironment } from '../../src/env/environment';
import { Simulation } from '../../src/game/simulation';

const RAD2DEG = 180 / Math.PI;

function airborneSim() {
  const sim = new Simulation(createCalmEnvironment(), structuredClone(DEFAULT_SETTINGS));
  sim.reset(new Vector3(0, 50, 0));
  const sticks = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
  sim.step(sticks); // scharf schalten
  sticks.throttle = 0.3;
  for (let i = 0; i < 500; i++) sim.step(sticks);
  return { sim, sticks };
}

describe('Flight Controller + Physik (geschlossener Regelkreis)', () => {
  it('schaltet erst bei Gas unten scharf', () => {
    const sim = new Simulation(createCalmEnvironment(), structuredClone(DEFAULT_SETTINGS));
    sim.step({ throttle: 0.5, roll: 0, pitch: 0, yaw: 0 });
    expect(sim.fc.armed).toBe(false);
    sim.step({ throttle: 0, roll: 0, pitch: 0, yaw: 0 });
    expect(sim.fc.armed).toBe(true);
  });

  it('schwebt bei ca. 30 % Gas', () => {
    const { sim } = airborneSim();
    const vy0 = sim.quad.body.velocity.y;
    for (let i = 0; i < 300; i++) sim.step({ throttle: 0.3, roll: 0, pitch: 0, yaw: 0 });
    const acc = (sim.quad.body.velocity.y - vy0) / 0.3;
    expect(Math.abs(acc)).toBeLessThan(1.0);
  });

  for (const axis of ['roll', 'pitch'] as const) {
    it(`${axis}: Sprungantwort erreicht Sollrate schnell und ohne starkes Überschwingen`, () => {
      const { sim, sticks } = airborneSim();
      sticks[axis] = 0.5;
      const body = sim.quad.body;
      const rate = () => (axis === 'roll' ? -body.angularVelocity.z : -body.angularVelocity.x) * RAD2DEG;
      let t90 = -1;
      let peak = 0;
      for (let i = 0; i < 400; i++) {
        sim.step(sticks);
        const r = rate();
        const sp = sim.fc.setpoint[axis];
        peak = Math.max(peak, r);
        if (t90 < 0 && r >= 0.9 * sp) t90 = i * sim.dt;
      }
      const sp = sim.fc.setpoint[axis];
      expect(t90).toBeGreaterThan(0);
      expect(t90).toBeLessThan(0.05); // < 50 ms bis 90 %
      expect(peak).toBeLessThan(sp * 1.2); // < 20 % Überschwingen
      expect(Math.abs(rate() - sp)).toBeLessThan(sp * 0.03); // eingeschwungen
    });
  }

  it('yaw: folgt der Sollrate innerhalb von 200 ms', () => {
    const { sim, sticks } = airborneSim();
    sticks.yaw = 0.5;
    for (let i = 0; i < 200; i++) sim.step(sticks);
    const r = -sim.quad.body.angularVelocity.y * RAD2DEG;
    expect(r).toBeGreaterThan(sim.fc.setpoint.yaw * 0.85);
  });

  it('Acro: hält die Lage nach dem Loslassen der Sticks (keine Selbststabilisierung)', () => {
    const { sim, sticks } = airborneSim();
    sticks.roll = 0.5;
    for (let i = 0; i < 200; i++) sim.step(sticks);
    sticks.roll = 0;
    for (let i = 0; i < 300; i++) sim.step(sticks);
    const up = new Vector3(0, 1, 0).applyQuaternion(sim.quad.body.orientation);
    const tilt = Math.acos(up.y) * RAD2DEG;
    expect(tilt).toBeGreaterThan(15); // bleibt geneigt
    expect(sim.quad.body.angularVelocity.length() * RAD2DEG).toBeLessThan(5);
  });

  it('Flip: 360°-Rolle bei Vollausschlag dauert < 1 s', () => {
    const { sim, sticks } = airborneSim();
    sticks.roll = 1;
    let angle = 0;
    let t = 0;
    while (angle < 2 * Math.PI && t < 2) {
      sim.step(sticks);
      angle += -sim.quad.body.angularVelocity.z * sim.dt;
      t += sim.dt;
    }
    expect(t).toBeLessThan(1);
  });
});
