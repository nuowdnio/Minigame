import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults';
import { createCalmEnvironment } from '../../src/env/environment';
import { Simulation } from '../../src/game/simulation';
import type { QuadVehicle } from '../../src/vehicles/quadVehicle';
import { StaticWorld } from '../../src/world/collision';

/** Welt mit einem geparkten Auto (gekennzeichnete Kollisionsform) bei z = −20. */
function carWorld() {
  const w = new StaticWorld(0);
  w.addBox(new Vector3(0, 0.85, -20), new Vector3(4.2, 1.7, 1.8), Math.PI / 2, false, { kind: 'car', id: 7 });
  return w;
}

function bomber(world = carWorld()) {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.vehicle = 'bomber7';
  const sim = new Simulation(createCalmEnvironment(world), s);
  return { sim, v: sim.vehicle as QuadVehicle };
}

const st = (throttle: number, pitch = 0) => ({ throttle, roll: 0, pitch, yaw: 0 });

describe('Sprengstoff-Drohne', () => {
  it('Zünder ist am Boden gesichert und wird erst nach einigen Sekunden Flug scharf', () => {
    const { sim, v } = bomber(new StaticWorld(0));
    sim.reset(new Vector3(0, 0, 0));
    sim.step(st(0));
    expect(v.fuseArmed).toBe(false);
    for (let i = 0; i < 2500; i++) sim.step(st(0.4));
    expect(v.fuseArmed).toBe(true);
    expect(v.statusHint).toBe('ZÜNDER SCHARF');
  });

  it('fliegt sie in ein Auto, explodiert sie und meldet das getroffene Auto', () => {
    const { sim, v } = bomber();
    sim.reset(new Vector3(0, 0, 0));
    sim.step(st(0));
    for (let i = 0; i < 2000; i++) sim.step(st(0.45)); // steigen, Zünder scharf
    expect(v.fuseArmed).toBe(true);
    // auf Autohöhe bringen und auf das Auto zufliegen
    v.body.position.set(0, 1.0, -10);
    v.body.velocity.set(0, 0, -8);
    v.body.orientation.identity();
    let boom = null;
    for (let i = 0; i < 3000 && !boom; i++) {
      sim.step(st(0.33));
      const ex = v.damage.takeExplosions();
      if (ex.length) boom = ex[0];
    }
    expect(boom).not.toBeNull();
    expect(boom!.carId).toBe(7);
    expect(boom!.radius).toBeGreaterThan(3);
    expect(v.damage.vaporized).toBe(true);
    expect(v.armed).toBe(false);
  });

  it('vor dem Scharfschalten des Zünders gibt es keine Explosion', () => {
    const { sim, v } = bomber();
    sim.reset(new Vector3(0, 0, 0));
    sim.step(st(0));
    for (let i = 0; i < 200; i++) sim.step(st(0.45)); // nur 0.2 s geflogen
    v.body.position.set(0, 1.0, -17.5);
    v.body.velocity.set(0, 0, -6);
    for (let i = 0; i < 600; i++) sim.step(st(0.33));
    expect(v.damage.takeExplosions().length).toBe(0);
    expect(v.damage.vaporized).toBe(false);
  });

  it('harter Einschlag in den Boden zündet ebenfalls', () => {
    const { sim, v } = bomber(new StaticWorld(0));
    sim.reset(new Vector3(0, 0, 0));
    sim.step(st(0));
    for (let i = 0; i < 2000; i++) sim.step(st(0.45));
    v.body.velocity.set(0, -15, 0);
    for (let i = 0; i < 4000 && !v.damage.vaporized; i++) sim.step(st(0));
    expect(v.damage.vaporized).toBe(true);
  });

  it('Reset stellt die Drohne wieder her, Zünder gesichert', () => {
    const { sim, v } = bomber();
    v.damage.explode({ position: new Vector3(), radius: 7, carId: null });
    sim.reset(new Vector3(0, 0, 0));
    expect(v.damage.vaporized).toBe(false);
    expect(v.fuseArmed).toBe(false);
  });
});
