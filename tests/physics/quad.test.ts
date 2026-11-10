import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../src/config/physics';
import { createCalmEnvironment } from '../../src/env/environment';
import { Quad, propwashIntensity } from '../../src/physics/quad';
import { SimpleCollisionWorld } from '../../src/world/collision';

const dt = 1 / PHYSICS.simHz;

function run(q: Quad, cmd: number[], seconds: number, env = createCalmEnvironment()) {
  for (let i = 0; i < seconds / dt; i++) q.step(dt, cmd, env, i * dt);
}

describe('Quad', () => {
  it('fällt ohne Motoren mit g (anfangs, vor nennenswertem Luftwiderstand)', () => {
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 500, 0));
    run(q, [0, 0, 0, 0], 0.1);
    expect(q.body.velocity.y).toBeCloseTo(-PHYSICS.gravity * 0.1, 1);
  });

  it('erreicht im freien Fall eine Endgeschwindigkeit (Luftwiderstand)', () => {
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 5000, 0));
    run(q, [0, 0, 0, 0], 20);
    const v = -q.body.velocity.y;
    // analytisch: m g = c_lin v + 0.5 ρ CdA v² (ρ in der Höhe etwas geringer)
    expect(v).toBeGreaterThan(15);
    expect(v).toBeLessThan(40);
    run(q, [0, 0, 0, 0], 1);
    expect(Math.abs(-q.body.velocity.y - v)).toBeLessThan(1.5);
  });

  it('gleiche Motoransteuerung erzeugt keine Rotation', () => {
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 50, 0));
    run(q, [0.4, 0.4, 0.4, 0.4], 1);
    expect(q.body.angularVelocity.length()).toBeLessThan(1e-6);
  });

  it('mehr Schub links -> rollt nach rechts (Körper-ωz < 0)', () => {
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 50, 0));
    // Reihenfolge RR, FR, RL, FL
    run(q, [0.3, 0.3, 0.4, 0.4], 0.05);
    expect(q.body.angularVelocity.z).toBeLessThan(-0.5);
  });

  it('mehr Schub hinten -> Nase nach unten (Körper-ωx < 0)', () => {
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 50, 0));
    run(q, [0.4, 0.3, 0.4, 0.3], 0.05);
    expect(q.body.angularVelocity.x).toBeLessThan(-0.5);
  });

  it('CCW-Motoren schneller -> giert nach rechts (Körper-ωy < 0)', () => {
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 50, 0));
    run(q, [0.3, 0.4, 0.4, 0.3], 0.1);
    expect(q.body.angularVelocity.y).toBeLessThan(-0.1);
  });

  it('Schub-Gewichts-Verhältnis: statisch ≈ 8.8, unter Last durch Voltage Sag etwas weniger', () => {
    const weight = PHYSICS.frame.mass * PHYSICS.gravity;
    expect((4 * PHYSICS.motor.maxThrust) / weight).toBeCloseTo(8.78, 1);
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 50, 0));
    const env = createCalmEnvironment();
    for (let i = 0; i < 200; i++) {
      q.step(dt, [1, 1, 1, 1], env, 0);
      q.body.velocity.set(0, 0, 0);
      q.body.position.set(0, 50, 0);
    }
    const tw = q.telemetry.totalThrust / weight;
    expect(tw).toBeGreaterThan(6);
    expect(tw).toBeLessThan(8.8);
  });

  it('Vollgas lässt die Akkuspannung einbrechen und senkt dadurch den Schub', () => {
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 1000, 0));
    // Kurz Vollgas, Drohne festhalten (Geschwindigkeit nullen), um Inflow auszuschließen
    const env = createCalmEnvironment();
    let firstThrust = 0;
    for (let i = 0; i < 6000; i++) {
      q.step(dt, [1, 1, 1, 1], env, i * dt);
      q.body.velocity.set(0, 0, 0);
      q.body.position.set(0, 1000, 0);
      if (i === 200) firstThrust = q.telemetry.totalThrust;
    }
    expect(q.telemetry.current).toBeGreaterThan(60);
    expect(q.telemetry.voltage).toBeLessThan(q.battery.openCircuitVoltage() - 1.5);
    expect(q.telemetry.totalThrust).toBeLessThan(firstThrust);
  });

  it('dünne Luft (Berg) reduziert den Schub', () => {
    const q1 = new Quad(PHYSICS);
    const q2 = new Quad(PHYSICS);
    q1.reset(new Vector3(0, 100, 0));
    q2.reset(new Vector3(0, 100, 0));
    const low = createCalmEnvironment();
    const high = { ...createCalmEnvironment(), baseAltitude: 3000 };
    q1.step(dt, [0.5, 0.5, 0.5, 0.5], low, 0);
    q2.step(dt, [0.5, 0.5, 0.5, 0.5], high, 0);
    run(q1, [0.5, 0.5, 0.5, 0.5], 0.2, low);
    run(q2, [0.5, 0.5, 0.5, 0.5], 0.2, high);
    expect(q2.telemetry.totalThrust).toBeLessThan(q1.telemetry.totalThrust * 0.8);
  });

  it('Bodeneffekt erhöht den Schub direkt über dem Boden', () => {
    const qLow = new Quad(PHYSICS);
    const qHigh = new Quad(PHYSICS);
    qLow.reset(new Vector3(0, 0.04, 0));
    qHigh.reset(new Vector3(0, 10, 0));
    const env = createCalmEnvironment();
    for (let i = 0; i < 100; i++) {
      for (const q of [qLow, qHigh]) {
        q.step(dt, [0.3, 0.3, 0.3, 0.3], env, 0);
        q.body.velocity.set(0, 0, 0);
      }
      qLow.body.position.set(0, 0.04, 0);
      qHigh.body.position.set(0, 10, 0);
    }
    expect(qLow.telemetry.totalThrust).toBeGreaterThan(qHigh.telemetry.totalThrust * 1.05);
  });

  it('liegt ruhig am Boden und durchdringt ihn nicht', () => {
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 0.3, 0));
    run(q, [0, 0, 0, 0], 2);
    expect(q.body.velocity.length()).toBeLessThan(0.01);
    expect(q.body.position.y).toBeGreaterThan(0.025);
    expect(q.body.position.y).toBeLessThan(0.045);
    expect(q.telemetry.onGround).toBe(true);
  });

  it('prallt an einer Wand ab und meldet die Aufprallgeschwindigkeit', () => {
    const world = new SimpleCollisionWorld(-100);
    world.addBox(new Vector3(0, 10, -5), new Vector3(10, 10, 1));
    const env = createCalmEnvironment(world);
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 10, 0));
    q.body.velocity.set(0, 0, -10);
    let maxImpact = 0;
    for (let i = 0; i < 1000; i++) {
      q.step(dt, [0, 0, 0, 0], env, 0);
      maxImpact = Math.max(maxImpact, q.telemetry.impactSpeed);
    }
    expect(maxImpact).toBeGreaterThan(8);
    expect(q.body.position.z).toBeGreaterThan(-4.5); // nicht durch die Wand
    expect(q.body.velocity.z).toBeGreaterThanOrEqual(-0.5);
  });
});

describe('Propwash', () => {
  it('Intensität maximal beim Sinken mit ≈ induzierter Geschwindigkeit, null beim Schweben/Steigen', () => {
    expect(propwashIntensity(0)).toBe(0);
    expect(propwashIntensity(-1)).toBe(0);
    expect(propwashIntensity(0.95)).toBeCloseTo(1, 6);
    expect(propwashIntensity(3)).toBe(0);
  });

  it('senkrechter Sinkflug in die eigene Abströmung erzeugt unruhigen, schwächeren Schub', () => {
    const env = createCalmEnvironment();
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 100, 0));
    const thrusts: number[] = [];
    for (let i = 0; i < 600; i++) {
      q.step(dt, [0.32, 0.32, 0.32, 0.32], env, 0);
      q.body.velocity.set(0, -4, 0); // Sinkflug ≈ v_h
      q.body.angularVelocity.set(0, 0, 0);
      q.body.orientation.identity();
      if (i > 300) thrusts.push(q.telemetry.totalThrust);
    }
    expect(q.telemetry.propwash).toBeGreaterThan(0.3);
    const m = thrusts.reduce((a, b) => a + b) / thrusts.length;
    const sd = Math.sqrt(thrusts.reduce((a, b) => a + (b - m) ** 2, 0) / thrusts.length);
    expect(sd / m).toBeGreaterThan(0.02);
  });
});

describe('Umwelteinfluss', () => {
  it('Seitenwind: Drohne mit Lage 0 wird vom Wind mitgenommen', () => {
    const env = { ...createCalmEnvironment(), wind: (_p: Vector3, _t: number, out: Vector3) => out.set(8, 0, 0) };
    const q = new Quad(PHYSICS);
    q.reset(new Vector3(0, 100, 0));
    for (let i = 0; i < 3000; i++) {
      q.step(dt, [0.3, 0.3, 0.3, 0.3], env, 0);
      q.body.orientation.identity();
      q.body.angularVelocity.set(0, 0, 0);
    }
    expect(q.body.velocity.x).toBeGreaterThan(2);
  });
});
