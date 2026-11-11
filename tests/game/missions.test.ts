import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults';
import { createCalmEnvironment } from '../../src/env/environment';
import { Convoy, Path } from '../../src/game/convoy';
import { EnemyDrone } from '../../src/game/enemyDrones';
import { MilitaryGame } from '../../src/game/missions';
import { Simulation } from '../../src/game/simulation';
import type { QuadVehicle } from '../../src/vehicles/quadVehicle';
import { StaticWorld } from '../../src/world/collision';
import { townMilitaryLayout } from '../../src/world/military';

const route = [new Vector3(0, 0, 0), new Vector3(200, 0, 0), new Vector3(200, 0, -100)];

describe('Route', () => {
  it('Bogenlänge, Abtasten und Projektion', () => {
    const p = new Path(route);
    expect(p.length).toBeCloseTo(300, 6);
    const o = new Vector3();
    p.sample(250, o);
    expect(o.x).toBeCloseTo(200, 6);
    expect(o.z).toBeCloseTo(-50, 6);
    expect(p.project(new Vector3(100, 0, 5))).toBeCloseTo(100, 6);
  });
});

describe('Konvoi', () => {
  const hazard = [{ position: new Vector3(120, 0, 0), kind: 'roadblock' as const, yaw: 0 }];

  it('nicht gemeldete Gefahr trifft das Führungsfahrzeug', () => {
    const c = new Convoy(route, hazard);
    c.started = true;
    let hit = false;
    for (let i = 0; i < 3000 && !hit; i++) hit = c.update(0.02).some((e) => e.type === 'hit');
    expect(hit).toBe(true);
    expect(c.vehicles[0].damaged).toBe(true);
  });

  it('gemeldete Gefahr: Konvoi hält davor, räumt und kommt an', () => {
    const c = new Convoy(route, hazard, 2);
    c.started = true;
    c.hazards[0].reported = true;
    const types: string[] = [];
    let minGap = Infinity;
    for (let i = 0; i < 6000 && !c.finished; i++) {
      for (const e of c.update(0.02)) types.push(e.type);
      if (!c.hazards[0].cleared) minGap = Math.min(minGap, c.hazards[0].s - c.leadS);
    }
    expect(types).toContain('stopped');
    expect(types).toContain('cleared');
    expect(types).toContain('arrived');
    expect(minGap).toBeGreaterThan(18);
  });

  it('Fahrzeuge folgen mit Abstand auf der Route', () => {
    const c = new Convoy(route, []);
    c.started = true;
    for (let i = 0; i < 1500; i++) c.update(0.02);
    expect(c.vehicles[0].position.distanceTo(c.vehicles[1].position)).toBeCloseTo(16, 0);
  });
});

describe('Gegnerische Aufklärer', () => {
  const r = { entry: new Vector3(-800, 70, 0), loiter: new Vector3(0, 80, 0), exit: new Vector3(800, 80, 0) };

  it('fliegt ein, kreist über dem Ziel und fliegt wieder ab', () => {
    const e = new EnemyDrone(r, 0, 17, 27, 0.65, 20);
    const states = new Set<string>();
    for (let i = 0; i < 20000 && e.state !== 'escaped'; i++) {
      e.update(0.05, null, 0, 0, 0);
      states.add(e.state);
    }
    expect([...states]).toEqual(expect.arrayContaining(['inbound', 'loiter', 'outbound', 'escaped']));
  });

  it('weicht aus, wenn der Abfangjäger nah und laut ist', () => {
    const e = new EnemyDrone(r, 0);
    for (let i = 0; i < 10; i++) e.update(0.05, null, 0, 0, 0);
    for (let i = 0; i < 100 && e.state !== 'evade'; i++) e.update(0.05, e.position.clone().add(new Vector3(30, 5, 0)), 40, 0.9, 0.25);
    expect(e.state).toBe('evade');
  });
});

describe('Missionen', () => {
  const hooks = { messages: [] as string[], message(t: string) { this.messages.push(t); }, effect() {} };

  it('Konvoi-Mission: Melden einer Gefahr mit der Kamera', () => {
    const layout = townMilitaryLayout();
    const g = new MilitaryGame(layout, new StaticWorld(0), hooks);
    g.mode = 'convoy';
    g.reset(layout.spawns.convoy.position);
    const h = layout.hazards[0].position;
    const cam = new Vector3(h.x - 60, 15, h.z);
    const dir = new Vector3().subVectors(new Vector3(h.x, 1, h.z), cam).normalize();
    expect(g.report(cam, dir, 1)).toMatch(/gemeldet/);
    expect(g.convoy.hazards.filter((x) => x.reported).length).toBe(1);
    // daneben zielen meldet nichts
    expect(g.report(cam, new Vector3(0, 1, 0), 1)).toMatch(/Nichts/);
  });

  it('Abfangjagd: Rammen holt den Aufklärer herunter', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.vehicle = 'interceptor';
    const sim = new Simulation(createCalmEnvironment(), s);
    const v = sim.vehicle as QuadVehicle;
    const layout = townMilitaryLayout();
    const g = new MilitaryGame(layout, new StaticWorld(0), hooks);
    g.mode = 'intercept';
    g.reset(new Vector3());
    const e = g.enemies[0];
    for (let i = 0; i < 200 && !e.active; i++) g.update(0.05, v);
    expect(e.active).toBe(true);
    v.body.position.copy(e.position);
    g.update(0.02, v);
    expect(e.state).toBe('down');
    expect(g.kills).toBe(1);
  });

  it('Versorgungskiste landet am Fallschirm und wird bewertet', () => {
    const layout = townMilitaryLayout();
    const msgs: string[] = [];
    const g = new MilitaryGame(layout, new StaticWorld(0), { message: (t) => msgs.push(t), effect: () => {} });
    const z = layout.dropZones[0];
    g.addCrate({ position: new Vector3(z.x + 3, 60, z.z), velocity: new Vector3(0, 0, 0), mass: 3, chuteArea: 1.4 });
    const s = structuredClone(DEFAULT_SETTINGS);
    const sim = new Simulation(createCalmEnvironment(), s);
    let maxV = 0;
    for (let i = 0; i < 2000 && !g.crates[0].landed; i++) {
      g.update(0.02, sim.vehicle);
      if (g.crates[0].age > 4) maxV = Math.max(maxV, g.crates[0].velocity.length());
    }
    expect(g.crates[0].landed).toBe(true);
    expect(maxV).toBeLessThan(9); // Fallschirm bremst
    expect(msgs.join(' ')).toMatch(/Volltreffer|sehr gut/);
  });
});
