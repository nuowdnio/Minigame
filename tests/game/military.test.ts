import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AirDefenseSite, segmentDistance } from '../../src/game/airDefense';
import { detectionRate, Observer } from '../../src/game/detection';
import { RadioLink, StickDelay, lineOfSight } from '../../src/game/radio';
import { StaticWorld } from '../../src/world/collision';

function settle(link: RadioLink, pos: Vector3, world: StaticWorld, s = 2) {
  for (let i = 0; i < s / 0.02; i++) link.update(0.02, pos, world);
}

describe('Funkverbindung und Störsender', () => {
  const station = new Vector3(0, 1.5, 0);

  it('nahe der Bodenstation ohne Störung: volles Signal, kaum Latenz', () => {
    const link = new RadioLink(station.clone());
    const w = new StaticWorld(0);
    settle(link, new Vector3(0, 20, -100), w);
    expect(link.quality).toBeGreaterThan(0.9);
    expect(link.latency).toBeLessThan(0.03);
    expect(link.lost).toBe(false);
  });

  it('Signal sinkt mit der Entfernung und hinter Gebäuden', () => {
    const w = new StaticWorld(0);
    w.addBox(new Vector3(0, 10, -300), new Vector3(60, 20, 10));
    const free = new RadioLink(station.clone());
    settle(free, new Vector3(0, 30, -320), w);
    const hidden = new RadioLink(station.clone());
    settle(hidden, new Vector3(0, 5, -320), w);
    expect(hidden.quality).toBeLessThan(free.quality * 0.85);
  });

  it('Störsender in der Nähe trennt die Verbindung (Failsafe), Latenz steigt vorher', () => {
    const w = new StaticWorld(0);
    const jammer = { position: new Vector3(0, 3, -400), radius: 200, power: 1.4 };
    const link = new RadioLink(station.clone(), [jammer]);
    settle(link, new Vector3(0, 20, -300), w);
    expect(link.latency).toBeGreaterThan(0.05);
    settle(link, new Vector3(0, 20, -390), w);
    expect(link.lost).toBe(true);
    expect(link.noise).toBe(1);
  });

  it('Gebäude zwischen Störsender und Drohne schirmen ab (tief fliegen hilft)', () => {
    const w = new StaticWorld(0);
    w.addBox(new Vector3(0, 8, -320), new Vector3(80, 16, 8));
    const jammer = { position: new Vector3(0, 3, -400), radius: 200, power: 1.4 };
    const high = new RadioLink(station.clone(), [jammer]);
    settle(high, new Vector3(0, 40, -300), w);
    const low = new RadioLink(station.clone(), [jammer]);
    settle(low, new Vector3(0, 4, -300), w);
    expect(low.jamming(new Vector3(0, 4, -300))).toBeLessThan(high.jamming(new Vector3(0, 40, -300)));
  });

  it('Steuerverzögerung und Failsafe', () => {
    const d = new StickDelay();
    d.process(0, { throttle: 0.2, roll: 0, pitch: 0, yaw: 0 }, 0.2, false);
    d.process(0.1, { throttle: 0.8, roll: 1, pitch: 0, yaw: 0 }, 0.2, false);
    expect(d.process(0.15, { throttle: 0.8, roll: 1, pitch: 0, yaw: 0 }, 0.2, false).throttle).toBe(0.2);
    expect(d.process(0.35, { throttle: 0.8, roll: 1, pitch: 0, yaw: 0 }, 0.2, false).roll).toBe(1);
    expect(d.process(0.4, { throttle: 0.8, roll: 1, pitch: 0, yaw: 0 }, 0.2, true).throttle).toBe(0);
  });

  it('Sichtlinie: Gebäude blockiert, freie Bahn nicht', () => {
    const w = new StaticWorld(0);
    w.addBox(new Vector3(0, 10, -50), new Vector3(20, 20, 4));
    expect(lineOfSight(w, new Vector3(0, 2, 0), new Vector3(0, 2, -100))).toBe(false);
    expect(lineOfSight(w, new Vector3(0, 30, 0), new Vector3(0, 30, -100))).toBe(true);
  });
});

describe('Entdeckung', () => {
  const obs = new Vector3(0, 1.6, 0);
  it('hoch, schnell und laut wird viel schneller entdeckt als tief, langsam und leise', () => {
    const loud = detectionRate({ observer: obs, target: new Vector3(0, 60, -150), targetSpeed: 30, noise: 0.8, size: 0.25, lineOfSight: true, range: 400 });
    const sneaky = detectionRate({ observer: obs, target: new Vector3(0, 2, -150), targetSpeed: 4, noise: 0.15, size: 0.25, lineOfSight: false, range: 400 });
    expect(loud).toBeGreaterThan(0.5);
    expect(sneaky).toBeLessThan(0);
  });
  it('sehr nah hört man auch eine leise Drohne', () => {
    expect(detectionRate({ observer: obs, target: new Vector3(0, 2, -15), targetSpeed: 2, noise: 0.3, size: 0.25, lineOfSight: false, range: 400 })).toBeGreaterThan(0);
  });
  it('Meter füllt sich, Entdeckung bleibt kurz im Gedächtnis', () => {
    const o = new Observer(obs, 400);
    for (let i = 0; i < 200; i++) o.update(0.02, { target: new Vector3(0, 50, -80), targetSpeed: 20, noise: 0.7, size: 0.25, lineOfSight: true });
    expect(o.detected).toBe(true);
    for (let i = 0; i < 50; i++) o.update(0.02, { target: new Vector3(0, 2, -390), targetSpeed: 1, noise: 0.1, size: 0.25, lineOfSight: false });
    expect(o.detected).toBe(true); // noch im Gedächtnis
  });
});

describe('Flugabwehr', () => {
  it('Abstand Punkt–Strecke', () => {
    expect(segmentDistance(new Vector3(0, 0, 0), new Vector3(10, 0, 0), new Vector3(5, 3, 0))).toBeCloseTo(3, 9);
  });

  it('trifft eine schwebende, gut sichtbare Drohne', () => {
    const w = new StaticWorld(0);
    const site = new AirDefenseSite(new Vector3(0, 0, 0));
    const drone = { position: new Vector3(20, 40, -120), velocity: new Vector3(0, 0, 0), radius: 0.3, noise: 0.6, size: 0.25 };
    let hits = 0;
    for (let i = 0; i < 600; i++) site.update(0.02, drone, w, () => hits++);
    expect(hits).toBeGreaterThan(0);
  });

  it('feuert nicht ohne Sichtlinie (Drohne hinter Gebäude)', () => {
    const w = new StaticWorld(0);
    w.addBox(new Vector3(0, 10, -60), new Vector3(60, 20, 6));
    const site = new AirDefenseSite(new Vector3(0, 0, 0));
    const drone = { position: new Vector3(0, 5, -100), velocity: new Vector3(0, 0, 0), radius: 0.3, noise: 0.9, size: 0.25 };
    let shots = 0;
    for (let i = 0; i < 400; i++) {
      site.update(0.02, drone, w, () => undefined);
      shots += site.fired;
    }
    expect(shots).toBe(0);
  });

  it('schnell querende Drohne wird seltener getroffen als eine stehende', () => {
    const run = (vx: number) => {
      const w = new StaticWorld(0);
      const site = new AirDefenseSite(new Vector3(0, 0, 0));
      let hits = 0;
      const drone = { position: new Vector3(-200, 30, -120), velocity: new Vector3(vx, 0, 0), radius: 0.3, noise: 0.8, size: 0.25 };
      site.observer.level = 1;
      for (let i = 0; i < 1500; i++) {
        drone.position.x = vx === 0 ? 0 : -150 + ((i * 0.02 * vx) % 300);
        site.update(0.02, drone, w, () => hits++);
      }
      return hits;
    };
    expect(run(45)).toBeLessThan(run(0));
  });
});
