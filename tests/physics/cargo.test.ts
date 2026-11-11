import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults';
import { createCalmEnvironment } from '../../src/env/environment';
import { Simulation } from '../../src/game/simulation';
import type { QuadVehicle } from '../../src/vehicles/quadVehicle';

function octo() {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.vehicle = 'octo';
  const sim = new Simulation(createCalmEnvironment(), s);
  return { sim, v: sim.vehicle as QuadVehicle };
}

describe('Schwerlast-Oktokopter', () => {
  it('trägt die Last im Schwebeflug (Schwebegas < 60 %)', () => {
    const { sim, v } = octo();
    sim.reset(new Vector3(0, 50, 0));
    sim.step({ throttle: 0, roll: 0, pitch: 0, yaw: 0 });
    for (let i = 0; i < 1500; i++) sim.step({ throttle: 0.5, roll: 0, pitch: 0, yaw: 0 });
    expect(v.body.velocity.y).toBeGreaterThan(0); // steigt bei 50 % mit Last
  });

  it('Lastabwurf: Masse sinkt schlagartig, die Drohne schießt bei gleichem Gas nach oben', () => {
    const { sim, v } = octo();
    sim.reset(new Vector3(0, 50, 0));
    sim.step({ throttle: 0, roll: 0, pitch: 0, yaw: 0 });
    // Schwebegas suchen (grob)
    let thr = 0.4;
    for (let i = 0; i < 4000; i++) {
      thr -= 0.0004 * v.body.velocity.y + 0.00002 * (v.body.position.y - 50);
      sim.step({ throttle: thr, roll: 0, pitch: 0, yaw: 0 });
    }
    const m0 = v.body.mass;
    const drop = v.dropCargo()!;
    expect(drop).not.toBeNull();
    expect(drop.mass).toBe(3);
    expect(v.body.mass).toBeCloseTo(m0 - 3, 6);
    expect(v.dropCargo()).toBeNull(); // nur einmal
    const vy0 = v.body.velocity.y;
    for (let i = 0; i < 500; i++) sim.step({ throttle: thr, roll: 0, pitch: 0, yaw: 0 });
    expect(v.body.velocity.y - vy0).toBeGreaterThan(1.5);
  });

  it('Reset hängt die Kiste wieder an', () => {
    const { sim, v } = octo();
    v.dropCargo();
    sim.reset(new Vector3(0, 0, 0));
    expect(v.cargoAttached).toBe(true);
    expect(v.body.mass).toBe(9);
  });
});

describe('Abfangdrohne', () => {
  it('ist schneller als der Racer', () => {
    const top = (id: string) => {
      const s = structuredClone(DEFAULT_SETTINGS);
      s.vehicle = id;
      const sim = new Simulation(createCalmEnvironment(), s);
      const v = sim.vehicle as QuadVehicle;
      sim.reset(new Vector3(0, 300, 0));
      sim.step({ throttle: 0, roll: 0, pitch: 0, yaw: 0 });
      v.body.orientation.setFromAxisAngle(new Vector3(1, 0, 0), (-70 * Math.PI) / 180);
      for (let i = 0; i < 7000; i++) sim.step({ throttle: 1, roll: 0, pitch: 0, yaw: 0 });
      return v.body.velocity.length() * 3.6;
    };
    const i = top('interceptor');
    expect(i).toBeGreaterThan(top('race5'));
    expect(i).toBeGreaterThan(190);
  });
});
