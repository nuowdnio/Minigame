import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults';
import { createCalmEnvironment } from '../../src/env/environment';
import { Simulation } from '../../src/game/simulation';
import type { QuadVehicle } from '../../src/vehicles/quadVehicle';

/** Fahrverhalten: die Drohnen sollen sich deutlich unterschiedlich anfühlen. */
const R2D = 180 / Math.PI;
const idle = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };

function mk(id: string) {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.vehicle = id;
  const sim = new Simulation(createCalmEnvironment(), s);
  return { sim, v: sim.vehicle as QuadVehicle };
}

function measure(id: string) {
  const { sim, v } = mk(id);
  // Flip mit vollem Rollausschlag bei ~Schwebegas
  sim.reset(new Vector3(0, 80, 0));
  sim.step(idle);
  for (let i = 0; i < 300; i++) sim.step({ ...idle, throttle: 0.3 });
  let ang = 0;
  let t = 0;
  while (ang < 2 * Math.PI && t < 3) {
    sim.step({ ...idle, throttle: 0.3, roll: 1 });
    ang += -v.body.angularVelocity.z * sim.dt;
    t += sim.dt;
  }
  // Punch: 1 s Vollgas aus dem Schwebeflug
  sim.reset(new Vector3(0, 80, 0));
  sim.step(idle);
  for (let i = 0; i < 300; i++) sim.step({ ...idle, throttle: 0.3 });
  for (let i = 0; i < 1000; i++) sim.step({ ...idle, throttle: 1 });
  const punch = v.body.velocity.y;
  // Höchstgeschwindigkeit bei 65° Neigung
  sim.reset(new Vector3(0, 300, 0));
  sim.step(idle);
  v.body.orientation.setFromAxisAngle(new Vector3(1, 0, 0), (-65 * Math.PI) / 180);
  for (let i = 0; i < 7000; i++) sim.step({ ...idle, throttle: 1 });
  return { flip: t, punch, top: v.body.velocity.length() * 3.6, maxRate: v.fc.rates.roll.rcRate };
}

describe('Fahrverhalten unterscheidet sich je Modell', () => {
  const race = measure('race5');
  const free = measure('freestyle5');
  const cine = measure('cinewhoop');
  const lr = measure('longrange7');

  it('Racer flippt deutlich schneller als Cinewhoop und Long Range', () => {
    expect(race.flip).toBeLessThan(free.flip);
    expect(race.flip).toBeLessThan(cine.flip * 0.5);
    expect(race.flip).toBeLessThan(lr.flip * 0.6);
  });

  it('Racer hat den stärksten Punch und die höchste Spitze', () => {
    expect(race.punch).toBeGreaterThan(free.punch);
    expect(race.punch).toBeGreaterThan(cine.punch * 2);
    expect(race.top).toBeGreaterThan(free.top);
    expect(race.top).toBeGreaterThan(160);
  });

  it('Cinewhoop ist langsam und sanft', () => {
    expect(cine.top).toBeLessThan(90);
    expect(cine.flip).toBeGreaterThan(1);
  });

  it('Long Range (Li-Ion) hat wenig Punch', () => {
    expect(lr.punch).toBeLessThan(free.punch * 0.5);
  });

  it('Rates je Modell: Racer schneller eingestellt als Cinewhoop', () => {
    const r = mk('race5').v.fc.rates.roll;
    const c = mk('cinewhoop').v.fc.rates.roll;
    expect(r.rcRate).toBeGreaterThan(c.rcRate);
    expect(r.superRate).toBeGreaterThan(c.superRate);
  });

  it('eigene Rates aus den Einstellungen haben Vorrang', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.vehicle = 'race5';
    s.rateProfiles = { race5: { ...structuredClone(mk('race5').v.fc.rates), roll: { rcRate: 0.5, superRate: 0, expo: 0 } } };
    const sim = new Simulation(createCalmEnvironment(), s);
    expect((sim.vehicle as QuadVehicle).fc.rates.roll.rcRate).toBe(0.5);
    void R2D;
  });
});
