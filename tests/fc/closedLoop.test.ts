import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults';
import { QUAD_PRESETS } from '../../src/config/quads';
import { createCalmEnvironment } from '../../src/env/environment';
import { Simulation } from '../../src/game/simulation';
import type { QuadVehicle } from '../../src/vehicles/quadVehicle';

const RAD2DEG = 180 / Math.PI;

function quadSim(id = 'freestyle5') {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.vehicle = id;
  const sim = new Simulation(createCalmEnvironment(), s);
  return { sim, v: sim.vehicle as QuadVehicle };
}

/** Schwebegas per Bisektion bestimmen. */
function hoverThrottle(id: string): number {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    const { sim, v } = quadSim(id);
    sim.reset(new Vector3(0, 50, 0));
    sim.step({ throttle: 0, roll: 0, pitch: 0, yaw: 0 });
    for (let i = 0; i < 400; i++) sim.step({ throttle: mid, roll: 0, pitch: 0, yaw: 0 });
    const v0 = v.body.velocity.y;
    for (let i = 0; i < 100; i++) sim.step({ throttle: mid, roll: 0, pitch: 0, yaw: 0 });
    if (v.body.velocity.y > v0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function airborne(id: string, throttle: number) {
  const { sim, v } = quadSim(id);
  sim.reset(new Vector3(0, 50, 0));
  const sticks = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
  sim.step(sticks);
  sticks.throttle = throttle;
  for (let i = 0; i < 400; i++) sim.step(sticks);
  return { sim, v, sticks };
}

describe('Flight Controller + Physik (geschlossener Regelkreis)', () => {
  it('schaltet erst bei Gas unten scharf', () => {
    const { sim, v } = quadSim();
    sim.step({ throttle: 0.5, roll: 0, pitch: 0, yaw: 0 });
    expect(v.armed).toBe(false);
    sim.step({ throttle: 0, roll: 0, pitch: 0, yaw: 0 });
    expect(v.armed).toBe(true);
  });

  it('5"-Freestyle schwebt bei ca. 30 % Gas', () => {
    expect(hoverThrottle('freestyle5')).toBeCloseTo(0.3, 1);
  });

  it('Acro: hält die Lage nach dem Loslassen der Sticks (keine Selbststabilisierung)', () => {
    const { sim, v, sticks } = airborne('freestyle5', 0.3);
    sticks.roll = 0.5;
    for (let i = 0; i < 200; i++) sim.step(sticks);
    sticks.roll = 0;
    for (let i = 0; i < 300; i++) sim.step(sticks);
    const up = new Vector3(0, 1, 0).applyQuaternion(v.body.orientation);
    expect(Math.acos(up.y) * RAD2DEG).toBeGreaterThan(15);
    expect(v.body.angularVelocity.length() * RAD2DEG).toBeLessThan(5);
  });

  it('Flip: 360°-Rolle bei Vollausschlag dauert < 1 s', () => {
    const { sim, v, sticks } = airborne('freestyle5', 0.3);
    sticks.roll = 1;
    let angle = 0;
    let t = 0;
    while (angle < 2 * Math.PI && t < 2) {
      sim.step(sticks);
      angle += -v.body.angularVelocity.z * sim.dt;
      t += sim.dt;
    }
    expect(t).toBeLessThan(1);
  });
});

describe.each(Object.keys(QUAD_PRESETS))('Drohne %s', (id) => {
  const hover = hoverThrottle(id);

  it('schwebt mit vernünftigem Gas (15–60 %)', () => {
    expect(hover).toBeGreaterThan(0.15);
    expect(hover).toBeLessThan(0.6);
  });

  for (const axis of ['roll', 'pitch'] as const) {
    it(`${axis}: Sprungantwort schnell, ohne starkes Überschwingen, eingeschwungen`, () => {
      const { sim, v, sticks } = airborne(id, hover);
      sticks[axis] = 0.5;
      const rate = () => (axis === 'roll' ? -v.body.angularVelocity.z : -v.body.angularVelocity.x) * RAD2DEG;
      let t90 = -1;
      let peak = 0;
      for (let i = 0; i < 400; i++) {
        sim.step(sticks);
        const r = rate();
        peak = Math.max(peak, r);
        if (t90 < 0 && r >= 0.9 * v.fc.setpoint[axis]) t90 = i * sim.dt;
      }
      const sp = v.fc.setpoint[axis];
      expect(t90).toBeGreaterThan(0);
      expect(t90).toBeLessThan(0.08);
      expect(peak).toBeLessThan(sp * 1.15);
      expect(Math.abs(rate() - sp)).toBeLessThan(sp * 0.04);
    });
  }

  it('yaw: folgt der Sollrate innerhalb von 200 ms', () => {
    const { sim, v, sticks } = airborne(id, hover);
    sticks.yaw = 0.5;
    for (let i = 0; i < 200; i++) sim.step(sticks);
    expect(-v.body.angularVelocity.y * RAD2DEG).toBeGreaterThan(v.fc.setpoint.yaw * 0.85);
  });
});
