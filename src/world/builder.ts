import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CarFleet, type CarSpec } from './cars';
import type { StaticWorld } from './collision';
import { asphaltTexture, facadeTexture, flatRoofTexture, pavementTexture, roofTileTexture } from './textures';

/** Breite und Höhe eines Fassadenmoduls (Fensterachse × Stockwerk) in Metern. */
export const MODULE_W = 3.2;
export const MODULE_H = 3.0;

type MatKey =
  | 'house'
  | 'apartment'
  | 'office'
  | 'shop'
  | 'plain'
  | 'roofTile'
  | 'roofFlat'
  | 'asphalt'
  | 'pavement'
  | 'white'
  | 'metal'
  | 'darkMetal'
  | 'glass'
  | 'rubber'
  | 'carPaint'
  | 'wood'
  | 'water'
  | 'concrete'
  | 'emissive';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Sammelt statische Geometrie je Material und fasst sie am Ende zu wenigen großen Meshes zusammen
 * (wenige Draw Calls → läuft auch auf dem iPad flüssig). Farben pro Objekt über Vertexfarben.
 * Registriert parallel die Kollisionsformen.
 */
export class CityBuilder {
  private readonly batches = new Map<MatKey, THREE.BufferGeometry[]>();
  readonly materials: Record<MatKey, THREE.Material>;
  private readonly trees: { x: number; z: number; h: number; r: number; conifer: boolean; color: THREE.Color }[] = [];
  /** Gesammelte Autos (werden in finish() zur CarFleet). */
  private readonly cars: CarSpec[] = [];
  /** Zerstörbare Autos (nach finish()). */
  fleet: CarFleet | null = null;

  constructor(
    readonly scene: THREE.Scene,
    readonly collision: StaticWorld,
    readonly shadows: boolean,
  ) {
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
    // Bodenauflagen (Straßen, Plätze, Markierungen) werden per Polygon-Offset vor das Gras gezogen
    const overlay = (p: THREE.MeshStandardMaterialParameters) =>
      std({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...p });
    this.materials = {
      house: std({ map: facadeTexture('house'), roughness: 0.9 }),
      apartment: std({ map: facadeTexture('apartment'), roughness: 0.85 }),
      office: std({ map: facadeTexture('office'), roughness: 0.3, metalness: 0.3 }),
      shop: std({ map: facadeTexture('shop'), roughness: 0.6 }),
      plain: std({ roughness: 0.9 }),
      roofTile: std({ map: roofTileTexture(), roughness: 0.8 }),
      roofFlat: std({ map: flatRoofTexture(), roughness: 1 }),
      asphalt: overlay({ map: asphaltTexture(), roughness: 0.95 }),
      pavement: overlay({ map: pavementTexture(), roughness: 0.9, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      white: overlay({ roughness: 0.6, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      metal: std({ roughness: 0.45, metalness: 0.25 }),
      darkMetal: std({ roughness: 0.5, metalness: 0.3 }),
      glass: std({ roughness: 0.1, metalness: 0.3 }),
      rubber: std({ roughness: 0.9 }),
      carPaint: std({ roughness: 0.3, metalness: 0.2 }),
      wood: std({ roughness: 0.85 }),
      water: std({ roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 }),
      concrete: std({ roughness: 0.95 }),
      emissive: new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.6 }),
    };
  }

  /** Geometrie (lokal) mit Lage, Drehung und Farbe zum Material-Stapel hinzufügen. */
  add(key: MatKey, geom: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, color = 0xffffff, scale?: THREE.Vector3): void {
    let g = geom.index ? geom.toNonIndexed() : geom;
    if (g === geom) g = geom.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    _q.setFromAxisAngle(_up, yaw);
    _m.compose(_p.set(x, y, z), _q, scale ?? _s.set(1, 1, 1));
    g.applyMatrix4(_m);
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    let list = this.batches.get(key);
    if (!list) this.batches.set(key, (list = []));
    list.push(g);
  }

  /** Quader mit Welt-skalierten UVs (Textur wiederholt sich je Modul). */
  box(key: MatKey, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0, color = 0xffffff, collide = true, uvScale = 1): void {
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUv(g, w / uvScale, h / uvScale, d / uvScale);
    this.add(key, g, x, y + h / 2, z, yaw, color);
    if (collide) this.collision.addBox(new THREE.Vector3(x, y + h / 2, z), new THREE.Vector3(w, h, d), yaw, h > 2.5);
  }

  cylinder(key: MatKey, x: number, y: number, z: number, r: number, h: number, color = 0xffffff, collide = true, segments = 12, rTop = r): void {
    this.add(key, new THREE.CylinderGeometry(rTop, r, h, segments), x, y + h / 2, z, 0, color);
    if (collide) this.collision.addCylinder(x, z, y, y + h, Math.max(r, rTop), h > 6 && r > 2);
  }

  /** Flache Bodenfläche (Straße, Platz) knapp über dem Gras. */
  ground(key: MatKey, x: number, z: number, w: number, d: number, yaw = 0, y = 0.02, uvSize = 8, color = 0xffffff): void {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / uvSize, (uv.getY(i) * d) / uvSize);
    this.add(key, g, x, y, z, yaw, color);
  }

  /** Vier Wände mit Fassadentextur (Fensterachsen passend zur Größe). */
  walls(key: MatKey, x: number, z: number, w: number, d: number, y0: number, h: number, yaw: number, color: number): void {
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    const sides: [number, number, number, number][] = [
      [0, d / 2, 0, w],
      [0, -d / 2, Math.PI, w],
      [w / 2, 0, Math.PI / 2, d],
      [-w / 2, 0, -Math.PI / 2, d],
    ];
    for (const [lx, lz, rot, width] of sides) {
      const g = new THREE.PlaneGeometry(width, h);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const nx = Math.max(1, Math.round(width / MODULE_W));
      const ny = h / MODULE_H;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * nx, uv.getY(i) * ny);
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      this.add(key, g, wx, y0 + h / 2, wz, yaw + rot, color);
    }
  }

  /** Satteldach mit First entlang der lokalen x-Achse, inkl. Giebeldreiecken. */
  gableRoof(x: number, z: number, w: number, d: number, y0: number, pitchDeg: number, yaw: number, roofColor: number, wallColor: number, overhang = 0.4): number {
    const hr = (d / 2) * Math.tan((pitchDeg * Math.PI) / 180);
    const W = w / 2 + overhang,
      D = d / 2 + overhang;
    const ho = hr * (D / (d / 2)); // Dachfläche verlängert über den Dachüberstand
    const ry = hr;
    const pos: number[] = [];
    const uv: number[] = [];
    const slope = Math.hypot(D, ho);
    const quad = (a: number[], b: number[], c2: number[], d2: number[], ua: number[], ub: number[], uc: number[], ud: number[]) => {
      pos.push(...a, ...b, ...c2, ...a, ...c2, ...d2);
      uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
    };
    const yE = ry - ho; // Traufhöhe (unter Wandoberkante wegen Überstand)
    // Dachflächen (Ziegel), UV in Metern / 2
    quad([-W, yE, D], [W, yE, D], [W, ry, 0], [-W, ry, 0], [0, 0], [W, 0], [W, slope / 2], [0, slope / 2]);
    quad([W, yE, -D], [-W, yE, -D], [-W, ry, 0], [W, ry, 0], [0, 0], [W, 0], [W, slope / 2], [0, slope / 2]);
    const roof = new THREE.BufferGeometry();
    roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    roof.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    roof.computeVertexNormals();
    this.add('roofTile', roof, x, y0, z, yaw, roofColor);
    // Giebeldreiecke (Wandfarbe)
    const gp = [w / 2, 0, d / 2, w / 2, 0, -d / 2, w / 2, hr, 0, -w / 2, 0, -d / 2, -w / 2, 0, d / 2, -w / 2, hr, 0];
    const gable = new THREE.BufferGeometry();
    gable.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    gable.computeVertexNormals();
    this.add('plain', gable, x, y0, z, yaw, wallColor);
    this.collision.addGableRoof(x, z, y0, yaw, w + 2 * overhang, d + 2 * overhang, hr);
    return hr;
  }

  /** Haus mit Satteldach. */
  house(x: number, z: number, w: number, d: number, floors: number, yaw: number, wallColor: number, roofColor: number): void {
    const h = floors * MODULE_H + 0.4;
    this.walls('house', x, z, w, d, 0, h, yaw, wallColor);
    this.collision.addBox(new THREE.Vector3(x, h / 2, z), new THREE.Vector3(w, h, d), yaw);
    this.gableRoof(x, z, w, d, h, 38, yaw, roofColor, wallColor);
    // Sockel
    this.box('concrete', x, 0, z, w + 0.1, 0.4, d + 0.1, yaw, 0x9a958c, false);
    // Schornstein
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    const lx = w * 0.25,
      lz = -d * 0.15;
    this.box('plain', x + lx * c + lz * s, h + 0.5, z - lx * s + lz * c, 0.6, d * 0.45, 0.6, yaw, 0x8b4a3a, true);
  }

  /** Mehrgeschossiges Gebäude mit Flachdach (optional Läden im Erdgeschoss). */
  block(x: number, z: number, w: number, d: number, floors: number, yaw: number, kind: 'apartment' | 'office', color: number, shops: boolean): void {
    const h = floors * MODULE_H;
    if (shops && floors >= 2) {
      this.walls('shop', x, z, w, d, 0, MODULE_H + 0.5, yaw, 0xf0ece4);
      this.walls(kind, x, z, w, d, MODULE_H + 0.5, h - MODULE_H - 0.5, yaw, color);
    } else {
      this.walls(kind, x, z, w, d, 0, h, yaw, color);
    }
    this.collision.addBox(new THREE.Vector3(x, h / 2, z), new THREE.Vector3(w, h, d), yaw);
    // Dach mit Attika
    this.ground('roofFlat', x, z, w, d, yaw, h + 0.01, 4);
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    for (const [lx, lz, ww, dd] of [
      [0, d / 2, w, 0.3],
      [0, -d / 2, w, 0.3],
      [w / 2, 0, 0.3, d],
      [-w / 2, 0, 0.3, d],
    ]) {
      this.box('plain', x + lx * c + lz * s, h, z - lx * s + lz * c, ww, 0.6, dd, yaw, 0xbdb8ae, false);
    }
    // Dachaufbau (Treppenhaus/Technik)
    this.box('plain', x + 0.2 * w * c, h, z - 0.2 * w * s, Math.min(5, w * 0.3), 2.6, Math.min(4, d * 0.3), yaw, 0xc8c3b9);
    if (kind === 'office') {
      this.cylinder('metal', x - 0.25 * w * c, h + 0.6, z + 0.25 * w * s, 0.08, 6, 0xcccccc, true, 6);
    }
  }

  tree(x: number, z: number, h: number, conifer: boolean, color: THREE.Color): void {
    const r = conifer ? h * 0.22 : h * 0.33;
    this.trees.push({ x, z, h, r, conifer, color });
    this.collision.addCylinder(x, z, 0, h * 0.45, Math.max(0.12, h * 0.025));
    if (conifer) {
      this.collision.addCylinder(x, z, h * 0.25, h * 0.75, r * 0.65);
    } else {
      this.collision.addSphere(new THREE.Vector3(x, h * 0.62, z), r * 0.85);
    }
  }

  /** PKW: wird als instanziertes, zerstörbares Auto angelegt (siehe CarFleet). */
  car(x: number, z: number, yaw: number, color: number): void {
    const id = this.cars.length;
    this.cars.push({ x, z, yaw, color });
    this.collision.addBox(new THREE.Vector3(x, 0.85, z), new THREE.Vector3(4.2, 1.7, 1.8), yaw, false, { kind: 'car', id });
  }

  /** Straßenlaterne. */
  lamp(x: number, z: number, yaw: number): void {
    this.cylinder('darkMetal', x, 0, z, 0.09, 6.5, 0x3a3f45, true, 8, 0.06);
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    this.add('darkMetal', new THREE.BoxGeometry(1.4, 0.08, 0.08), x + 0.7 * c, 6.4, z - 0.7 * s, yaw, 0x3a3f45);
    this.add('emissive', new THREE.BoxGeometry(0.5, 0.12, 0.25), x + 1.3 * c, 6.32, z - 1.3 * s, yaw, 0xfff2cc);
  }

  /** Bank im Park. */
  bench(x: number, z: number, yaw: number): void {
    this.add('wood', new THREE.BoxGeometry(1.8, 0.06, 0.45), x, 0.45, z, yaw, 0x8a5a33);
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    this.add('wood', new THREE.BoxGeometry(1.8, 0.4, 0.05), x - 0.22 * s, 0.7, z - 0.22 * c, yaw, 0x8a5a33);
    for (const lx of [-0.8, 0.8]) this.add('darkMetal', new THREE.BoxGeometry(0.06, 0.45, 0.45), x + lx * c, 0.22, z - lx * s, yaw, 0x333333);
  }

  /** Alle gesammelten Geometrien zu Meshes zusammenfassen und in die Szene einfügen. */
  finish(): void {
    for (const [key, list] of this.batches) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, this.materials[key]);
      mesh.castShadow = this.shadows && key !== 'asphalt' && key !== 'pavement' && key !== 'water';
      mesh.receiveShadow = this.shadows;
      this.scene.add(mesh);
      for (const g of list) g.dispose();
    }
    this.batches.clear();
    this.buildTrees();
    this.fleet = new CarFleet(this.scene, this.cars, this.shadows);
  }

  private buildTrees(): void {
    const decid = this.trees.filter((t) => !t.conifer);
    const con = this.trees.filter((t) => t.conifer);
    const trunkGeom = new THREE.CylinderGeometry(0.6, 1, 1, 7);
    trunkGeom.translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4231, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, this.trees.length);
    const m = new THREE.Matrix4();
    this.trees.forEach((t, i) => {
      const r = Math.max(0.12, t.h * 0.025);
      m.compose(new THREE.Vector3(t.x, 0, t.z), new THREE.Quaternion(), new THREE.Vector3(r, t.h * (t.conifer ? 0.3 : 0.5), r));
      trunks.setMatrixAt(i, m);
    });
    trunks.castShadow = this.shadows;
    this.scene.add(trunks);

    const crownGeom = new THREE.IcosahedronGeometry(1, 1);
    const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
    const crowns = new THREE.InstancedMesh(crownGeom, crownMat, decid.length);
    decid.forEach((t, i) => {
      const q = new THREE.Quaternion().setFromAxisAngle(_up, t.x * 0.37 + t.z);
      m.compose(new THREE.Vector3(t.x, t.h * 0.62, t.z), q, new THREE.Vector3(t.r, t.r * 1.05, t.r));
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, t.color);
    });
    crowns.castShadow = this.shadows;
    this.scene.add(crowns);

    const coneGeom = new THREE.ConeGeometry(1, 1, 8);
    coneGeom.translate(0, 0.5, 0);
    const cones = new THREE.InstancedMesh(coneGeom, crownMat, con.length);
    con.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.x, t.h * 0.2, t.z), new THREE.Quaternion(), new THREE.Vector3(t.r, t.h * 0.82, t.r));
      cones.setMatrixAt(i, m);
      cones.setColorAt(i, t.color);
    });
    cones.castShadow = this.shadows;
    this.scene.add(cones);
  }
}

/** UVs eines BoxGeometry je Seite auf Weltmaße skalieren. */
function scaleBoxUv(g: THREE.BoxGeometry, w: number, h: number, d: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // Reihenfolge der Seiten: +x, −x, +y, −y, +z, −z (je 4 Vertices)
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  }
}
