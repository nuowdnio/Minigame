import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { StaticWorld, type ContactResult } from '../../src/world/collision';

const out = (): ContactResult => ({ normal: new Vector3(), depth: 0 });

describe('StaticWorld', () => {
  it('Boden: Kontakt mit Normale nach oben', () => {
    const w = new StaticWorld(0);
    const c = w.sphereContact(new Vector3(0, 0.05, 0), 0.1, out())!;
    expect(c.depth).toBeCloseTo(0.05, 9);
    expect(c.normal.y).toBe(1);
    expect(w.sphereContact(new Vector3(0, 1, 0), 0.1, out())).toBeNull();
  });

  it('Quader: Kontakt von der Seite und von oben', () => {
    const w = new StaticWorld(-100);
    w.addBox(new Vector3(0, 5, 0), new Vector3(4, 10, 2));
    const side = w.sphereContact(new Vector3(2.05, 5, 0), 0.1, out())!;
    expect(side.normal.x).toBeCloseTo(1, 6);
    expect(side.depth).toBeCloseTo(0.05, 6);
    const top = w.sphereContact(new Vector3(0, 10.05, 0.5), 0.1, out())!;
    expect(top.normal.y).toBeCloseTo(1, 6);
    expect(w.sphereContact(new Vector3(3, 5, 0), 0.1, out())).toBeNull();
  });

  it('gedrehter Quader (45°): Normale zeigt diagonal', () => {
    const w = new StaticWorld(-100);
    w.addBox(new Vector3(0, 5, 0), new Vector3(2, 10, 2), Math.PI / 4);
    // lokale +x-Achse zeigt in Welt nach (cos45, 0, −sin45)
    const p = new Vector3(Math.SQRT1_2, 5, -Math.SQRT1_2).multiplyScalar(1.05);
    p.y = 5;
    const c = w.sphereContact(p, 0.1, out())!;
    expect(c).not.toBeNull();
    expect(c.normal.x).toBeCloseTo(Math.SQRT1_2, 3);
    expect(c.normal.z).toBeCloseTo(-Math.SQRT1_2, 3);
  });

  it('Kugel im Inneren eines Quaders wird zur nächsten Seite herausgedrückt', () => {
    const w = new StaticWorld(-100);
    w.addBox(new Vector3(0, 5, 0), new Vector3(10, 10, 10));
    const c = w.sphereContact(new Vector3(4.5, 5, 0), 0.1, out())!;
    expect(c.normal.x).toBeCloseTo(1, 6);
    expect(c.depth).toBeCloseTo(0.6, 6);
  });

  it('Satteldach: Normale steht senkrecht auf der Dachschräge', () => {
    const w = new StaticWorld(-100);
    // First entlang x, Breite 8 (z), Höhe 4 -> Neigung 45°
    w.addGableRoof(0, 0, 10, 0, 10, 8, 4);
    const p = new Vector3(0, 12 + 0.05, 2 + 0.05); // knapp über der Schräge auf der +z-Seite
    const c = w.sphereContact(p, 0.2, out())!;
    expect(c).not.toBeNull();
    expect(c.normal.y).toBeCloseTo(Math.SQRT1_2, 2);
    expect(c.normal.z).toBeCloseTo(Math.SQRT1_2, 2);
    expect(w.heightAbove(new Vector3(0, 20, 0), 100)).toBeCloseTo(6, 6); // First bei 14
    expect(w.heightAbove(new Vector3(0, 20, 2), 100)).toBeCloseTo(8, 6); // halbe Höhe
  });

  it('Zylinder (Mast) und Kugel (Baumkrone)', () => {
    const w = new StaticWorld(-100);
    w.addCylinder(0, 0, 0, 8, 0.2);
    w.addSphere(new Vector3(10, 5, 0), 2);
    const cyl = w.sphereContact(new Vector3(0.25, 4, 0), 0.1, out())!;
    expect(cyl.normal.x).toBeCloseTo(1, 6);
    const sph = w.sphereContact(new Vector3(10, 7.05, 0), 0.1, out())!;
    expect(sph.normal.y).toBeCloseTo(1, 6);
    expect(sph.depth).toBeCloseTo(0.05, 6);
  });

  it('Raster: findet Objekte auch bei vielen Einträgen und schnell', () => {
    const w = new StaticWorld(0);
    for (let i = 0; i < 2000; i++) w.addBox(new Vector3((i % 50) * 20, 5, Math.floor(i / 50) * 20), new Vector3(8, 10, 8));
    const c = w.sphereContact(new Vector3(20 * 7 + 4.05, 5, 20 * 13), 0.1, out())!;
    expect(c.normal.x).toBeCloseTo(1, 6);
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) w.sphereContact(new Vector3(i % 1000, 3, (i * 7) % 800), 0.05, out());
    expect(performance.now() - t0).toBeLessThan(150);
  });

  it('Windhindernisse: nur Gebäude, keine Masten', () => {
    const w = new StaticWorld(0);
    w.addBox(new Vector3(0, 5, 0), new Vector3(4, 10, 4));
    w.addCylinder(10, 0, 0, 8, 0.2);
    expect(w.windObstacles().length).toBe(1);
  });
});
