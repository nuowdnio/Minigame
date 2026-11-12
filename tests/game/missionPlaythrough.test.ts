import { Vector3 } from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults';
import { createCalmEnvironment } from '../../src/env/environment';
import { MilitaryGame } from '../../src/game/missions';
import { lineOfSight } from '../../src/game/radio';
import { Simulation } from '../../src/game/simulation';
import type { QuadVehicle } from '../../src/vehicles/quadVehicle';
import type { Arena } from '../../src/world/world';
import type { ContactResult } from '../../src/world/collision';
import { townMilitaryLayout } from '../../src/world/military';
import { headlessTown } from '../helpers/headlessTown';

/**
 * Komplette Missionen in der echten Kleinstadt durchspielen (mit Flugabwehr, Störsendern,
 * Funkverbindung). Der "Pilot" ist ein einfacher Bot, der kinematisch fliegt – geprüft wird,
 * dass die Missionen lösbar sind und die Spiellogik von Anfang bis Ende funktioniert.
 */

let town: Arena;
beforeAll(() => {
  town = headlessTown();
});
afterEach(() => vi.restoreAllMocks());

/** Reproduzierbarer Zufall (mulberry32) für Streuung, Treffer und Gegnerverhalten. */
function seedRandom(seed: number): void {
  let a = seed >>> 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

function setup(mode: 'convoy' | 'intercept', vehicle: string) {
  const layout = townMilitaryLayout();
  const messages: string[] = [];
  const game = new MilitaryGame(layout, town.collision, { message: (t) => messages.push(t), effect: () => {} });
  game.mode = mode;
  const s = structuredClone(DEFAULT_SETTINGS);
  s.vehicle = vehicle;
  const sim = new Simulation(createCalmEnvironment(), s);
  const v = sim.vehicle as QuadVehicle;
  const spawn = game.spawn()!;
  sim.reset(spawn.position, spawn.yaw);
  game.reset(spawn.position);
  return { game, v, messages, layout };
}

/**
 * A*-Wegplanung auf einem 4-m-Raster in fester Höhe durch freie Zellen; von der Flugabwehr
 * eingesehene Zellen sind erlaubt, aber teuer (kurze Sprints über offene Stellen).
 */
function astarPlanner(w: Arena['collision'], seen: (p: Vector3) => boolean, alt: number) {
  const cell = 4;
  const c: ContactResult = { normal: new Vector3(), depth: 0 };
  const cache = new Map<string, number>();
  /** 0 = Hindernis, sonst Kostenfaktor (1 gedeckt, 25 eingesehen). */
  const cost = (ix: number, iz: number) => {
    const k = `${ix},${iz}`;
    let f = cache.get(k);
    if (f === undefined) {
      const p = new Vector3(ix * cell, alt, iz * cell);
      f = w.sphereContact(p, 1.6, c) ? 0 : seen(p) ? 25 : 1;
      cache.set(k, f);
    }
    return f;
  };
  return (a: Vector3, b: Vector3): Vector3[] | null => {
    const sx = Math.round(a.x / cell), sz = Math.round(a.z / cell);
    const gx = Math.round(b.x / cell), gz = Math.round(b.z / cell);
    const key = (x: number, z: number) => `${x},${z}`;
    const open: [number, number, number][] = [[sx, sz, 0]];
    const g = new Map<string, number>([[key(sx, sz), 0]]);
    const prev = new Map<string, string>();
    const h = (x: number, z: number) => Math.hypot(x - gx, z - gz);
    let found = false;
    for (let it = 0; it < 60000 && open.length; it++) {
      open.sort((p, q) => q[2] - p[2]);
      const [x, z] = open.pop()!;
      if (x === gx && z === gz) { found = true; break; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, nz = z + dz;
        const isGoal = nx === gx && nz === gz;
        const k = isGoal ? 1 : cost(nx, nz);
        if (!k) continue;
        const ng = g.get(key(x, z))! + Math.hypot(dx, dz) * k;
        if (ng < (g.get(key(nx, nz)) ?? Infinity)) {
          g.set(key(nx, nz), ng);
          prev.set(key(nx, nz), key(x, z));
          open.push([nx, nz, ng + h(nx, nz)]);
        }
      }
    }
    if (!found) return null;
    const out: Vector3[] = [];
    let k: string | undefined = key(gx, gz);
    while (k && k !== key(sx, sz)) {
      const [x, z] = k.split(',').map(Number);
      out.push(new Vector3(x * cell, alt, z * cell));
      k = prev.get(k);
    }
    return out.reverse();
  };
}

/** Fluggerät kinematisch bewegen (Motoren laufen im Schwebeflug -> realistische Lautstärke). */
function fly(v: QuadVehicle, pos: Vector3, vel: Vector3): void {
  v.body.position.copy(pos);
  v.body.velocity.copy(vel);
  for (const m of v.quad.motors) m.omega = v.quad.omegaRef * 0.55;
}

describe('Mission Konvoi-Begleitung (echte Stadt)', () => {
  it('ohne Meldungen fährt der Konvoi in die erste Gefahr -> gescheitert', () => {
    const { game, v } = setup('convoy', 'freestyle5');
    const p = v.body.position.clone();
    for (let t = 0; t < 120 && game.status === 'running'; t += 0.05) {
      fly(v, p, new Vector3());
      game.update(0.05, v);
    }
    expect(game.status).toBe('failed');
    expect(game.resultText).toMatch(/Gefahr/);
  });

  it('Startplatz liegt außerhalb der Sicht der Flugabwehr', () => {
    const { game, v } = setup('convoy', 'freestyle5');
    const p = v.body.position.clone().setY(15);
    for (let t = 0; t < 15; t += 0.05) {
      fly(v, p, new Vector3());
      game.update(0.05, v);
    }
    expect(game.air.every((a) => !a.observer.detected)).toBe(true);
    expect(game.air.every((a) => a.fired === 0 && a.rounds.length === 0)).toBe(true);
  });

  /** Ein kompletter Durchlauf des Bots; gibt das Ergebnis zurück. */
  function convoyBotRun(seed: number) {
    seedRandom(seed);
    const { game, v, messages } = setup('convoy', 'freestyle5');
    const w = town.collision;
    const c: ContactResult = { normal: new Vector3(), depth: 0 };
    // Gibt es für jede Gefahr einen Beobachtungspunkt, den keine Flugabwehr sieht?
    const seenByAA = (p: Vector3) =>
      game.air.some((a) => a.muzzle.distanceTo(p) < a.range * 1.2 && lineOfSight(w, a.muzzle, p, 3, 3.5));
    const streetAlt = 6;
    const vantage = game.convoy.hazards.map((hz) => {
      let best: Vector3 | null = null;
      let bestScore = Infinity;
      for (let ang = 0; ang < 360; ang += 10)
        for (const r of [35, 55, 80, 110])
          for (const h of [streetAlt]) {
            const p = new Vector3(hz.position.x + Math.cos((ang * Math.PI) / 180) * r, h, hz.position.z + Math.sin((ang * Math.PI) / 180) * r);
            if (w.sphereContact(p, 1, c)) continue;
            if (!lineOfSight(w, p, hz.position.clone().setY(3), 2, 1)) continue;
            if (seenByAA(p)) continue;
            const score = r + h * 2;
            if (score < bestScore) {
              bestScore = score;
              best = p;
            }
          }
      return best;
    });
    expect(vantage.every((p) => p !== null)).toBe(true);

    // Flugplan wie ein vorsichtiger Pilot: in 6 m Höhe nur durch Bereiche, die keine Flugabwehr
    // einsehen kann (A* auf einem 4-m-Raster), am Beobachtungspunkt Kamera auf die Gefahr, melden.
    const pos = v.body.position.clone().setY(1);
    const route = astarPlanner(w, seenByAA, streetAlt);
    const waypoints: { p: Vector3; report: number }[] = [{ p: pos.clone().setY(streetAlt), report: -1 }];
    let from = pos.clone().setY(streetAlt);
    vantage.forEach((vp, i) => {
      const legs = route(from, vp!);
      expect(legs, `kein gedeckter Weg zu Gefahr ${i}`).not.toBeNull();
      for (const p of legs!) waypoints.push({ p, report: -1 });
      waypoints.push({ p: vp!.clone(), report: i });
      from = vp!.clone();
    });
    const vel = new Vector3();
    let wi = 0;
    let shotAt = 0;
    for (let t = 0; t < 400 && game.status === 'running' && wi < waypoints.length; t += 0.02) {
      const wp = waypoints[wi];
      const d = wp.p.clone().sub(pos);
      if (d.length() < 0.5) {
        if (wp.report >= 0) {
          const hz = game.convoy.hazards[wp.report];
          const dir = hz.position.clone().setY(1).sub(pos).normalize();
          expect(game.report(pos, dir, 1)).toMatch(/gemeldet/);
        }
        wi++;
        vel.set(0, 0, 0);
      } else vel.copy(d.normalize().multiplyScalar(Math.min(12, d.length() / 0.02 + 0.01)));
      pos.addScaledVector(vel, 0.02);
      fly(v, pos, vel);
      game.update(0.02, v);
      for (const a of game.air) shotAt += a.fired;
    }
    // nach allen Meldungen auf das Ende warten
    for (let t = 0; t < 300 && game.status === 'running'; t += 0.05) {
      fly(v, pos, new Vector3());
      game.update(0.05, v);
    }
    vi.restoreAllMocks();
    return { game, v, messages, shotAt };
  }

  it('Bot meldet alle Gefahren aus der Deckung: Konvoi kommt an, Drohne überlebt', () => {
    const { game, v, messages, shotAt } = convoyBotRun(1);
    expect(game.convoy.hazards.every((h) => h.reported)).toBe(true);
    expect(game.status).toBe('success');
    expect(game.resultText).toMatch(/4\/4/);
    expect(v.damage.destroyed).toBe(false);
    expect(messages.some((m) => m.includes('Konvoi hält'))).toBe(true);
    expect(messages.some((m) => m.includes('Gefahr beseitigt'))).toBe(true);
    // die Route ist nicht ungefährlich: beim Queren offener Stellen wird geschossen
    expect(shotAt).toBeGreaterThan(0);
  });

  it('Balance: vorsichtiges Fliegen gewinnt in den allermeisten Fällen', () => {
    const results = [2, 3, 4, 5, 6, 7].map((seed) => convoyBotRun(seed).game.status);
    expect(results.filter((r) => r === 'success').length).toBeGreaterThanOrEqual(5);
  });

  it('wer über der Flugabwehr schwebt, wird beschossen', () => {
    const { game, v, layout } = setup('convoy', 'freestyle5');
    const p = layout.airDefense[0].clone().add(new Vector3(30, 40, 30));
    let fired = 0;
    for (let t = 0; t < 12; t += 0.02) {
      fly(v, p, new Vector3());
      game.update(0.02, v);
      fired += game.air[0].fired;
    }
    expect(game.air[0].observer.detected).toBe(true);
    expect(fired).toBeGreaterThan(5);
  });
});

describe('Mission Abfangjagd (echte Stadt)', () => {
  it('Bot fängt die Aufklärer ab -> Mission erfüllt, keine Flugabwehr im eigenen Gebiet', () => {
    seedRandom(11);
    const { game, v, messages } = setup('intercept', 'interceptor');
    expect(game.threatsActive).toBe(false);
    const pos = v.body.position.clone().setY(1);
    const vel = new Vector3();
    const speed = 38; // Abfangdrohne im Steilflug
    for (let t = 0; t < 400 && game.status === 'running'; t += 0.02) {
      const e = game.nearestEnemy(pos);
      if (e) {
        // Verfolgung mit Vorhalt
        const tgo = e.position.distanceTo(pos) / speed;
        const aim = e.position.clone().addScaledVector(e.velocity, Math.min(tgo, 3));
        const d = aim.sub(pos);
        vel.copy(d.normalize().multiplyScalar(speed));
      } else {
        vel.multiplyScalar(0.9);
      }
      pos.addScaledVector(vel, 0.02);
      fly(v, pos, vel);
      game.update(0.02, v);
    }
    expect(game.kills).toBeGreaterThanOrEqual(3);
    expect(game.status).toBe('success');
    expect(messages.some((m) => m.includes('abgefangen'))).toBe(true);
    expect(game.air.every((a) => a.rounds.length === 0)).toBe(true);
  });

  it('schnelles Vorbeirauschen am Gegner zählt (kein Durchtunneln)', () => {
    seedRandom(12);
    const { game, v } = setup('intercept', 'interceptor');
    const e = game.enemies[0];
    for (let i = 0; i < 400 && !e.active; i++) game.update(0.05, v);
    expect(e.active).toBe(true);
    // 60 m/s Annäherung, ein Bildschritt von 0.05 s = 3 m -> würde ohne Sweep übersprungen
    const dir = e.velocity.clone().normalize();
    const start = e.position.clone().addScaledVector(dir, 30);
    const vel = dir.clone().multiplyScalar(-60);
    fly(v, start, vel);
    game.update(0.0001, v);
    const p = start.clone();
    for (let i = 0; i < 40 && e.state !== 'down'; i++) {
      p.addScaledVector(vel, 0.05);
      fly(v, p, vel);
      game.update(0.05, v);
    }
    expect(e.state).toBe('down');
  });

  it('Akkuwechsel am Startplatz', () => {
    const { game, v, messages } = setup('intercept', 'interceptor');
    v.battery.soc = 0.2;
    const p = v.body.position.clone();
    for (let t = 0; t < 4; t += 0.05) {
      fly(v, p, new Vector3());
      v.body.angularVelocity.set(0, 0, 0);
      game.update(0.05, v);
    }
    expect(v.battery.soc).toBeGreaterThan(0.9);
    expect(messages.some((m) => m.includes('Akku gewechselt'))).toBe(true);
  });
});
