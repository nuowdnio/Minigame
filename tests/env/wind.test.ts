import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PerlinNoise } from '../../src/env/noise';
import { WindField, logWindProfile, type WindParams } from '../../src/env/wind';

const base: WindParams = { speed: 6, directionDeg: 0, turbulence: 1, roughness: 0.03, thermalStrength: 0, seed: 3 };

function stats(field: WindField, p: Vector3, n = 4000, dt = 0.05) {
  const w = new Vector3();
  let sx = 0, sz = 0, sy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    field.sample(p, i * dt, w);
    sx += w.x; sy += w.y; sz += w.z; sxx += w.z * w.z;
  }
  const mz = sz / n;
  return { mx: sx / n, my: sy / n, mz, sdz: Math.sqrt(sxx / n - mz * mz) };
}

describe('Perlin-Rauschen', () => {
  it('fBm hat Mittelwert ≈ 0 und Standardabweichung ≈ 1', () => {
    const n = new PerlinNoise(5);
    let s = 0, ss = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const v = n.fbm3(i * 0.137, i * 0.071 + 3.3, i * 0.053 - 1.1);
      s += v; ss += v * v;
    }
    const m = s / N;
    expect(Math.abs(m)).toBeLessThan(0.1);
    expect(Math.sqrt(ss / N - m * m)).toBeGreaterThan(0.6);
    expect(Math.sqrt(ss / N - m * m)).toBeLessThan(1.4);
  });
  it('ist deterministisch je Seed', () => {
    expect(new PerlinNoise(9).noise3(1.3, 2.7, 0.4)).toBe(new PerlinNoise(9).noise3(1.3, 2.7, 0.4));
    expect(new PerlinNoise(9).noise3(1.3, 2.7, 0.4)).not.toBe(new PerlinNoise(10).noise3(1.3, 2.7, 0.4));
  });
});

describe('Windfeld', () => {
  it('logarithmisches Profil: 10 m = Nennwert, Boden langsamer, Höhe schneller', () => {
    expect(logWindProfile(10, 6, 0.03)).toBeCloseTo(6, 9);
    expect(logWindProfile(1, 6, 0.03)).toBeLessThan(4);
    expect(logWindProfile(50, 6, 0.03)).toBeGreaterThan(7);
    expect(logWindProfile(0.01, 6, 0.03)).toBe(0);
  });

  it('Wind "aus Norden" weht nach Süden (+z)', () => {
    const f = new WindField({ ...base, turbulence: 0 });
    const w = f.sample(new Vector3(0, 10, 0), 0, new Vector3());
    expect(w.z).toBeCloseTo(6, 6);
    expect(Math.abs(w.x)).toBeLessThan(1e-9);
  });

  it('Mittelwert der Turbulenz ≈ mittlerer Wind, Böen mit realistischer Intensität (10–35 %)', () => {
    const f = new WindField(base);
    const s = stats(f, new Vector3(5, 10, 5));
    expect(s.mz).toBeGreaterThan(4.5);
    expect(s.mz).toBeLessThan(7.5);
    const intensity = s.sdz / 6;
    expect(intensity).toBeGreaterThan(0.1);
    expect(intensity).toBeLessThan(0.35);
  });

  it('ohne Turbulenz kein Böen-Anteil', () => {
    const f = new WindField({ ...base, turbulence: 0 });
    const s = stats(f, new Vector3(5, 10, 5), 500);
    expect(s.sdz).toBeLessThan(1e-9);
  });

  it('Vertikalwind verschwindet am Boden', () => {
    const f = new WindField(base);
    const w = new Vector3();
    let max = 0;
    for (let i = 0; i < 500; i++) max = Math.max(max, Math.abs(f.sample(new Vector3(i, 0.06, 0), i * 0.1, w).y));
    expect(max).toBeLessThan(0.05);
  });

  it('Windschatten hinter einem Gebäude (Lee) reduziert den Wind', () => {
    const obstacle = { min: new Vector3(-5, 0, -5), max: new Vector3(5, 10, 5) };
    const f = new WindField({ ...base, turbulence: 0 }, [obstacle]);
    const free = new WindField({ ...base, turbulence: 0 });
    const lee = new Vector3(0, 4, 15); // Wind weht nach +z -> hinter dem Gebäude
    const luv = new Vector3(0, 4, -15);
    const w = new Vector3();
    const wLee = f.sample(lee, 0, w).length();
    const wFree = free.sample(lee, 0, w).length();
    expect(wLee).toBeLessThan(wFree * 0.6);
    expect(f.sample(luv, 0, w).length()).toBeCloseTo(free.sample(luv, 0, new Vector3()).length(), 6);
    expect(f.shelter(new Vector3(0, 4, 200))).toBe(0);
  });

  it('Thermik: Aufwind im Kern, schwächer/abwärts außerhalb', () => {
    const f = new WindField({ ...base, speed: 0, turbulence: 0, thermalStrength: 3 });
    // stärksten Aufwind auf einem Raster suchen
    let best = -Infinity;
    const w = new Vector3();
    for (let x = -450; x <= 450; x += 15)
      for (let z = -450; z <= 450; z += 15) best = Math.max(best, f.sample(new Vector3(x, 80, z), 60, w).y);
    expect(best).toBeGreaterThan(1);
    // in Bodennähe noch kaum entwickelt
    let nearGround = -Infinity;
    for (let x = -450; x <= 450; x += 15)
      for (let z = -450; z <= 450; z += 15) nearGround = Math.max(nearGround, f.sample(new Vector3(x, 2, z), 60, w).y);
    expect(nearGround).toBeLessThan(best * 0.2);
  });
});
