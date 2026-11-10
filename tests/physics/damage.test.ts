import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../src/config/defaults';
import { createCalmEnvironment } from '../../src/env/environment';
import { Simulation } from '../../src/game/simulation';
import type { PlaneVehicle } from '../../src/vehicles/planeVehicle';
import type { QuadVehicle } from '../../src/vehicles/quadVehicle';
import { StaticWorld } from '../../src/world/collision';

function make(id: string, mod?: (s: Settings) => void, world = new StaticWorld(0)) {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.vehicle = id;
  mod?.(s);
  const sim = new Simulation(createCalmEnvironment(world), s);
  return { sim, s };
}

const idle = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };

describe('Schadensmodell Drohne', () => {
  it('Aufprall mit 20 m/s gegen eine Wand zerstört den 5"-Quad', () => {
    const world = new StaticWorld(-100);
    world.addBox(new Vector3(0, 10, -5), new Vector3(20, 20, 1));
    const { sim } = make('freestyle5', undefined, world);
    const v = sim.vehicle as QuadVehicle;
    sim.reset(new Vector3(0, 10, 0));
    v.body.position.set(0, 10, 0);
    v.body.velocity.set(0, 0, -20);
    for (let i = 0; i < 500; i++) sim.step(idle);
    expect(v.damage.destroyed).toBe(true);
    expect(v.armed).toBe(false);
    const events = v.damage.takeEvents().map((e) => e.text).join(' | ');
    expect(events).toMatch(/CRASH|Arm gebrochen/);
  });

  it('leichter Bodenkontakt (1 m/s) richtet keinen Schaden an', () => {
    const { sim } = make('freestyle5');
    const v = sim.vehicle as QuadVehicle;
    sim.reset(new Vector3(0, 0, 0));
    v.body.position.y += 0.05;
    v.body.velocity.set(0, -1, 0);
    for (let i = 0; i < 500; i++) sim.step(idle);
    expect(v.damage.destroyed).toBe(false);
    expect(v.quad.motors.every((m) => m.health === 1)).toBe(true);
  });

  it('Drohne liegt auf der Seite und gibt Gas -> Propeller schleifen am Boden und zerbrechen', () => {
    const { sim } = make('freestyle5');
    const v = sim.vehicle as QuadVehicle;
    sim.reset(new Vector3(0, 0, 0));
    sim.step(idle); // scharf
    v.body.orientation.setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2); // rechte Seite unten
    v.body.position.y = 0.12;
    for (let i = 0; i < 500; i++) sim.step(idle);
    for (let i = 0; i < 2000; i++) sim.step({ throttle: 0.4, roll: 0, pitch: 0, yaw: 0 });
    const healths = v.quad.motors.map((m) => m.health);
    expect(Math.min(...healths)).toBeLessThan(0.5);
    expect([...v.damage.brokenParts].some((p) => p.startsWith('prop'))).toBe(true);
  });

  it('nicht scharf geschaltet (Propeller stehen): Umkippen beschädigt keine Propeller', () => {
    const { sim } = make('freestyle5');
    const v = sim.vehicle as QuadVehicle;
    sim.reset(new Vector3(0, 0, 0));
    v.body.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
    v.body.position.y = 0.1;
    for (let i = 0; i < 800; i++) sim.step({ throttle: 0.5, roll: 0, pitch: 0, yaw: 0 }); // Gas oben -> bleibt unscharf
    expect(v.armed).toBe(false);
    expect(v.quad.motors.every((m) => m.health === 1)).toBe(true);
  });

  it('beschädigte Propeller erzeugen Vibrationen (unruhigerer Gyro)', () => {
    const { sim } = make('freestyle5');
    const v = sim.vehicle as QuadVehicle;
    sim.reset(new Vector3(0, 50, 0));
    sim.step(idle);
    for (let i = 0; i < 300; i++) sim.step({ throttle: 0.3, roll: 0, pitch: 0, yaw: 0 });
    const rateNoise = () => {
      let s = 0;
      for (let i = 0; i < 300; i++) {
        sim.step({ throttle: 0.3, roll: 0, pitch: 0, yaw: 0 });
        s += Math.abs(v.fc.filteredGyro.roll);
      }
      return s / 300;
    };
    const clean = rateNoise();
    for (const m of v.quad.motors) {
      m.health = 0.8;
      m.imbalance = 0.6;
    }
    expect(rateNoise()).toBeGreaterThan(clean * 2);
  });

  it('Schadensmodell "aus": unzerstörbar', () => {
    const world = new StaticWorld(-100);
    world.addBox(new Vector3(0, 10, -5), new Vector3(20, 20, 1));
    const { sim } = make('freestyle5', (s) => (s.damage = 'off'), world);
    const v = sim.vehicle as QuadVehicle;
    sim.reset(new Vector3(0, 10, 0));
    v.body.position.set(0, 10, 0);
    v.body.velocity.set(0, 0, -30);
    for (let i = 0; i < 500; i++) sim.step(idle);
    expect(v.damage.destroyed).toBe(false);
  });

  it('Tiny Whoop ist robust: 8 m/s Aufprall ohne Zerstörung', () => {
    const world = new StaticWorld(-100);
    world.addBox(new Vector3(0, 10, -5), new Vector3(20, 20, 1));
    const { sim } = make('whoop', undefined, world);
    const v = sim.vehicle as QuadVehicle;
    sim.reset(new Vector3(0, 10, 0));
    v.body.position.set(0, 10, 0);
    v.body.velocity.set(0, 0, -8);
    for (let i = 0; i < 500; i++) sim.step(idle);
    expect(v.damage.destroyed).toBe(false);
  });

  it('Reset repariert alles', () => {
    const { sim } = make('freestyle5');
    const v = sim.vehicle as QuadVehicle;
    v.damage.destroy('Test');
    v.quad.motors[0].health = 0;
    sim.reset(new Vector3(0, 0, 0));
    expect(v.damage.destroyed).toBe(false);
    expect(v.quad.motors[0].health).toBe(1);
  });
});

describe('Schadensmodell Flugzeug', () => {
  function flying(id: string, speed: number) {
    const { sim } = make(id, (s) => (s.planeMode = 'manual'));
    const v = sim.vehicle as PlaneVehicle;
    sim.reset(new Vector3(0, 400, 0));
    v.launchPending = false;
    v.body.orientation.identity();
    v.body.velocity.set(0, 0, -speed);
    sim.step(idle);
    return { sim, v };
  }

  it('Abfangen mit vollem Höhenruder bei hoher Fahrt -> Überlast, Flügel bricht', () => {
    const { sim, v } = flying('glider', 29);
    for (let i = 0; i < 1500; i++) sim.step({ throttle: 0, roll: 0, pitch: -1, yaw: 0 });
    expect([...v.damage.brokenParts].some((p) => p.startsWith('wing'))).toBe(true);
    const broken = v.plane.surfaces.filter((s) => s.health <= 0).map((s) => s.def.name);
    expect(broken.length).toBeGreaterThan(0);
  });

  it('normales Kurven mit wenig Last bleibt heil', () => {
    const { sim, v } = flying('trainer', 13);
    for (let i = 0; i < 3000; i++) sim.step({ throttle: 0.5, roll: 0.3, pitch: -0.15, yaw: 0 });
    expect(v.damage.brokenParts.size).toBe(0);
  });

  it('über V_NE: Flattern schaukelt sich auf und lässt ein Ruder klemmen', () => {
    const { sim, v } = flying('trainer', 38);
    const saved = v.config.damage;
    v.config.damage = { ...saved, maxG: 99 }; // nur Flattern prüfen, nicht die Strukturlast
    try {
      sim.step(idle);
      expect(v.plane.surfaces.some((s) => s.jammed)).toBe(false); // nicht sofort
      for (let i = 0; i < 600; i++) sim.step({ throttle: 0, roll: 0, pitch: 0.3, yaw: 0 });
      const events = v.damage.takeEvents().map((e) => e.text).join(' ');
      expect(events).toMatch(/FLATTERN/);
      expect(v.plane.surfaces.some((s) => s.jammed)).toBe(true);
    } finally {
      v.config.damage = saved;
    }
  });

  it('harte Landung reißt das Fahrwerk ab', () => {
    const { sim } = make('trainer', (s) => (s.planeMode = 'manual'));
    const v = sim.vehicle as PlaneVehicle;
    sim.reset(new Vector3(0, 1, 0));
    v.body.velocity.set(0, -5, -10);
    for (let i = 0; i < 600; i++) sim.step(idle);
    expect([...v.damage.brokenParts].some((p) => p.startsWith('gear'))).toBe(true);
    expect(v.telemetry.wheelsOnGround).toBeLessThan(3);
  });

  it('Absturz mit 25 m/s zerstört das Modell', () => {
    const { sim } = make('wing', (s) => (s.planeMode = 'manual'));
    const v = sim.vehicle as PlaneVehicle;
    sim.reset(new Vector3(0, -1.2, 0)); // Handstarthöhe 1.8 m -> 0.6 m über Grund
    v.launchPending = false;
    v.body.velocity.set(0, -25, 0);
    for (let i = 0; i < 600; i++) sim.step(idle);
    expect(v.damage.destroyed).toBe(true);
  });
});
