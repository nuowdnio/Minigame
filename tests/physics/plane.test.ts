import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type PlaneMode } from '../../src/config/defaults';
import { PLANE_PRESETS } from '../../src/config/planes';
import { createCalmEnvironment } from '../../src/env/environment';
import { attitude } from '../../src/fc/planeController';
import { Simulation } from '../../src/game/simulation';
import type { PlaneVehicle } from '../../src/vehicles/planeVehicle';

const R2D = 180 / Math.PI;

function planeSim(id: string, mode: PlaneMode = 'manual') {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.vehicle = id;
  s.planeMode = mode;
  const sim = new Simulation(createCalmEnvironment(), s);
  return { sim, v: sim.vehicle as PlaneVehicle };
}

/** In der Luft mit gegebener Geschwindigkeit geradeaus starten. */
function inFlight(id: string, mode: PlaneMode, speed: number) {
  const { sim, v } = planeSim(id, mode);
  sim.reset(new Vector3(0, 300, 0));
  v.launchPending = false;
  v.body.orientation.identity();
  v.body.velocity.set(0, 0, -speed);
  const sticks = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
  sim.step(sticks);
  return { sim, v, sticks };
}

const run = (sim: Simulation, sticks: { throttle: number; roll: number; pitch: number; yaw: number }, s: number) => {
  for (let i = 0; i < s / sim.dt; i++) sim.step(sticks);
};

const TRIM: Record<string, [number, number]> = { trainer: [9, 14], wing: [12, 19], glider: [7.5, 11], recon: [9, 15] };
const GLIDE: Record<string, number> = { trainer: 6, wing: 4.5, glider: 12, recon: 10 };

describe.each(Object.keys(PLANE_PRESETS))('Flugzeug %s', (id) => {
  it('gleitet ohne Motor stabil mit realistischer Trimmgeschwindigkeit und Gleitzahl', () => {
    const { sim, v, sticks } = inFlight(id, 'manual', (TRIM[id][0] + TRIM[id][1]) / 2);
    run(sim, sticks, 30);
    let sum = 0;
    let sink = 0;
    let hs = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      sim.step(sticks);
      sum += v.telemetry.airspeed;
      sink += v.body.velocity.y;
      hs += Math.hypot(v.body.velocity.x, v.body.velocity.z);
    }
    const speed = sum / n;
    expect(speed).toBeGreaterThan(TRIM[id][0]);
    expect(speed).toBeLessThan(TRIM[id][1]);
    expect(hs / -sink).toBeGreaterThan(GLIDE[id]);
    expect(Math.abs(attitude(v.body.orientation).bank) * R2D).toBeLessThan(10);
  });

  it('Höhenruder: Stick nach vorne -> Nase runter, nach hinten -> Nase hoch', () => {
    const a = inFlight(id, 'manual', TRIM[id][1]);
    a.sticks.pitch = 0.5;
    run(a.sim, a.sticks, 1);
    expect(attitude(a.v.body.orientation).pitch * R2D).toBeLessThan(-4);
    const b = inFlight(id, 'manual', TRIM[id][1]);
    b.sticks.pitch = -0.5;
    run(b.sim, b.sticks, 1);
    expect(attitude(b.v.body.orientation).pitch * R2D).toBeGreaterThan(4);
  });

  it('Querruder rechts -> rollt nach rechts', () => {
    const { sim, v, sticks } = inFlight(id, 'manual', TRIM[id][1]);
    sticks.roll = 0.6;
    run(sim, sticks, 0.8);
    expect(attitude(v.body.orientation).bank * R2D).toBeGreaterThan(12);
  });

  it('ist richtungsstabil (Windfahnen-Effekt) – Schiebewinkel baut sich ab', () => {
    const { sim, v, sticks } = inFlight(id, 'manual', TRIM[id][1]);
    v.body.velocity.set(4, 0, -TRIM[id][1]); // Seitenwind-Störung
    run(sim, sticks, 0.05);
    const beta0 = Math.abs(v.telemetry.betaDeg);
    run(sim, sticks, 1.5);
    expect(Math.abs(v.telemetry.betaDeg)).toBeLessThan(beta0 * 0.5);
  });

  it('Strömungsabriss bei zu wenig Fahrt (Höhenruder voll gezogen, Motor aus)', () => {
    const { sim, v, sticks } = inFlight(id, 'manual', TRIM[id][0]);
    sticks.pitch = -1;
    let maxStall = 0;
    for (let i = 0; i < 4000; i++) {
      sim.step(sticks);
      maxStall = Math.max(maxStall, v.telemetry.stall);
    }
    expect(maxStall).toBeGreaterThan(0.5);
  });

  it('Angle-Modus: hält ohne Stickeingabe die Fläche waagerecht und fliegt horizontal', () => {
    const { sim, v, sticks } = inFlight(id, 'angle', TRIM[id][1]);
    // gestörte Lage
    v.body.orientation.setFromAxisAngle(new Vector3(0, 0, 1), -0.6);
    sticks.throttle = 0.5;
    run(sim, sticks, 8);
    const att = attitude(v.body.orientation);
    expect(Math.abs(att.bank) * R2D).toBeLessThan(5);
    expect(Math.abs(att.pitch) * R2D).toBeLessThan(5);
  });

  it('Angle-Modus: Stick rechts -> Querneigung rechts, begrenzt', () => {
    const { sim, v, sticks } = inFlight(id, 'angle', TRIM[id][1]);
    sticks.throttle = 0.5;
    sticks.roll = 1;
    run(sim, sticks, 3);
    const bank = attitude(v.body.orientation).bank * R2D;
    expect(bank).toBeGreaterThan(PLANE_PRESETS[id as keyof typeof PLANE_PRESETS].control.maxBank * 0.7);
    expect(bank).toBeLessThan(PLANE_PRESETS[id as keyof typeof PLANE_PRESETS].control.maxBank + 12);
  });
});

describe('Trainer am Boden', () => {
  it('Startlauf: rollt auf den Rädern, hebt nach realistischer Strecke ab und steigt', () => {
    const { sim, v } = planeSim('trainer', 'manual');
    sim.reset(new Vector3(0, 0, 0));
    const sticks = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
    run(sim, sticks, 1);
    expect(v.telemetry.wheelsOnGround).toBe(3);
    const z0 = v.body.position.z;
    sticks.throttle = 1;
    let liftoffDist = -1;
    let maxAlt = 0;
    for (let i = 0; i < 8000; i++) {
      const t = i * sim.dt;
      // Pilot: ab 2.5 s leicht ziehen, nach dem Abheben loslassen
      sticks.pitch = t > 2.5 && liftoffDist < 0 ? -0.4 : 0;
      sim.step(sticks);
      if (liftoffDist < 0 && v.body.position.y > 0.6) liftoffDist = Math.abs(v.body.position.z - z0);
      maxAlt = Math.max(maxAlt, v.body.position.y);
    }
    expect(liftoffDist).toBeGreaterThan(8);
    expect(liftoffDist).toBeLessThan(45);
    expect(maxAlt).toBeGreaterThan(8);
  });

  it('Räder: rollt längs leicht, rutscht seitlich kaum', () => {
    const { sim, v } = planeSim('trainer', 'manual');
    sim.reset(new Vector3(0, 0, 0));
    const sticks = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
    run(sim, sticks, 0.5);
    v.body.velocity.set(0, 0, -5);
    run(sim, sticks, 1);
    const along = -v.body.velocity.z;
    expect(along).toBeGreaterThan(3); // kaum gebremst
    v.body.velocity.set(3, 0, 0);
    run(sim, sticks, 0.8);
    expect(Math.abs(v.body.velocity.x)).toBeLessThan(0.3); // seitlich blockiert
  });

  it('Bugradlenkung: Seitenruder rechts -> Kurve nach rechts beim Rollen', () => {
    const { sim, v } = planeSim('trainer', 'manual');
    sim.reset(new Vector3(0, 0, 0));
    const sticks = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
    run(sim, sticks, 0.5);
    sticks.throttle = 0.35;
    sticks.yaw = 1;
    run(sim, sticks, 3);
    expect(v.body.position.x).toBeGreaterThan(1);
  });
});

describe('Handstart', () => {
  it('Nurflügler wird gehalten, bis Gas gegeben wird, und dann geworfen', () => {
    const { sim, v } = planeSim('wing', 'gyro');
    sim.reset(new Vector3(0, 0, 0));
    const sticks = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
    run(sim, sticks, 1);
    expect(v.launchPending).toBe(true);
    expect(v.body.velocity.length()).toBe(0);
    sticks.throttle = 0.8;
    run(sim, sticks, 0.5);
    expect(v.launchPending).toBe(false);
    run(sim, sticks, 4);
    expect(v.body.position.y).toBeGreaterThan(3); // steigt nach dem Wurf
  });
});

describe('Propeller-Drehmoment', () => {
  it('Motorleistung ohne Trimmung rollt den Trainer nach links', () => {
    const { sim, v, sticks } = inFlight('trainer', 'manual', 12);
    const trim = v.config.control.rollTrim;
    v.config.control.rollTrim = 0;
    sticks.throttle = 1;
    run(sim, sticks, 2);
    v.config.control.rollTrim = trim;
    expect(attitude(v.body.orientation).bank).toBeLessThan(0);
  });
});
