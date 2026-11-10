import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../src/config/physics';
import { buildMixer, mix } from '../../src/fc/mixer';

// Reihenfolge: RR, FR, RL, FL
const rules = buildMixer(PHYSICS.frame.motors);

describe('Mixer', () => {
  it('entspricht der Betaflight-QuadX-Tabelle', () => {
    expect(rules.map((r) => [r.roll, r.pitch, r.yaw])).toEqual([
      [-1, 1, -1],
      [-1, -1, 1],
      [1, 1, 1],
      [1, -1, -1],
    ]);
  });

  it('ohne Regelanteil: alle Motoren = Gas', () => {
    const out = mix(rules, 0.4, 0, 0, 0, [0, 0, 0, 0]);
    expect(out).toEqual([0.4, 0.4, 0.4, 0.4]);
  });

  it('Rollen rechts: linke Motoren mehr, rechte weniger, Summe bleibt', () => {
    const out = mix(rules, 0.5, 0.1, 0, 0, [0, 0, 0, 0]);
    expect(out[2]).toBeGreaterThan(out[0]);
    expect(out[3]).toBeGreaterThan(out[1]);
    expect(out.reduce((a, b) => a + b)).toBeCloseTo(2, 9);
  });

  it('Airmode: bei Gas 0 bleibt volle Regelwirkung erhalten', () => {
    const out = mix(rules, 0, 0.2, 0, 0, [0, 0, 0, 0]);
    expect(Math.max(...out) - Math.min(...out)).toBeCloseTo(0.4, 9);
    expect(Math.min(...out)).toBeCloseTo(0, 9);
  });

  it('Airmode: bei Vollgas wird Gas reduziert statt die Regelung zu kappen', () => {
    const out = mix(rules, 1, 0, 0.2, 0, [0, 0, 0, 0]);
    expect(Math.max(...out)).toBeCloseTo(1, 9);
    expect(Math.max(...out) - Math.min(...out)).toBeCloseTo(0.4, 9);
  });

  it('zu große Regelanteile werden auf den Bereich 0..1 skaliert', () => {
    const out = mix(rules, 0.5, 1, 1, 0, [0, 0, 0, 0]);
    for (const o of out) {
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...out) - Math.min(...out)).toBeCloseTo(1, 9);
  });
});
