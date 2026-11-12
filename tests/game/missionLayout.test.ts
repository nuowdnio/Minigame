import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { MilitaryGame } from '../../src/game/missions';
import { lineOfSight } from '../../src/game/radio';
import type { ContactResult } from '../../src/world/collision';
import type { Arena } from '../../src/world/world';
import { townMilitaryLayout } from '../../src/world/military';
import { headlessTown } from '../helpers/headlessTown';

/** Prüft das Missions-Layout der Kleinstadt auf Fairness und Befahrbarkeit. */
describe('Missions-Layout Kleinstadt', () => {
  let town: Arena;
  let game: MilitaryGame;
  const c: ContactResult = { normal: new Vector3(), depth: 0 };
  beforeAll(() => {
    town = headlessTown();
    game = new MilitaryGame(townMilitaryLayout(), town.collision, { message: () => {}, effect: () => {} });
  });

  it('Konvoi-Route ist frei (keine Laternen, Bäume oder Häuser auf der Fahrbahn)', () => {
    const path = game.convoy.path;
    const dir = new Vector3();
    const blocked: string[] = [];
    for (let s = 0; s < path.length; s += 1) {
      const p = path.sample(s, new Vector3(), dir);
      for (const off of [-1.3, 0, 1.3]) {
        const q = p.clone().add(new Vector3(-dir.z, 0, dir.x).multiplyScalar(off)).setY(1.2);
        if (town.collision.sphereContact(q, 0.4, c) && c.depth > 0.05) blocked.push(`(${q.x.toFixed(0)},${q.z.toFixed(0)})`);
      }
    }
    expect(blocked).toEqual([]);
  });

  it('Startplätze liegen außerhalb der Sicht der Flugabwehr', () => {
    const L = game.layout;
    const spawns = [L.spawns.convoy.position, town.spawns.quad];
    for (const sp of spawns)
      for (const h of [1, 8, 20])
        for (const a of game.air) {
          const p = sp.clone().setY(h);
          const visible = a.muzzle.distanceTo(p) < a.range && lineOfSight(town.collision, a.muzzle, p, 3, 3.5);
          expect(visible, `Start (${sp.x},${sp.z}) in ${h} m von Stellung (${a.position.x},${a.position.z}) sichtbar`).toBe(false);
        }
  });

  it('jede Gefahr lässt sich aus der Deckung melden', () => {
    for (const hz of game.convoy.hazards) {
      let safe = 0;
      for (let ang = 0; ang < 360; ang += 15)
        for (const r of [40, 70, 100, 130])
          for (const h of [4, 10, 20]) {
            const p = new Vector3(hz.position.x + Math.cos((ang * Math.PI) / 180) * r, h, hz.position.z + Math.sin((ang * Math.PI) / 180) * r);
            if (town.collision.sphereContact(p, 0.5, c)) continue;
            if (!lineOfSight(town.collision, p, hz.position.clone().setY(3), 2, 1)) continue;
            if (game.air.some((a) => a.muzzle.distanceTo(p) < a.range * 1.2 && lineOfSight(town.collision, a.muzzle, p, 3, 3.5))) continue;
            safe++;
          }
      expect(safe, `Gefahr bei (${hz.position.x},${hz.position.z})`).toBeGreaterThanOrEqual(10);
    }
  });

  it('Gegnerische Aufklärer kreisen über allen Hindernissen', () => {
    for (const r of game.layout.enemyRoutes)
      for (let a = 0; a < 360; a += 5)
        for (const alt of [55, r.loiter.y]) {
          const p = new Vector3(r.loiter.x + Math.sin((a * Math.PI) / 180) * 120, alt, r.loiter.z + Math.cos((a * Math.PI) / 180) * 120);
          expect(town.collision.sphereContact(p, 2, c)).toBeNull();
        }
  });
});
