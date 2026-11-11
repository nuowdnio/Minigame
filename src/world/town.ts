import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { PLANE_PRESETS } from '../config/planes';
import { PlaneMesh } from '../render/planeMesh';
import { CityBuilder, MODULE_H } from './builder';
import { StaticWorld } from './collision';
import { rng } from './random';
import { grassTexture, pitchTexture, runwayNumberTexture, signTexture } from './textures';
import type { Arena } from './world';

/*
 * Kleinstadt "Flugdorf" mit Flugplatz.
 *
 * Koordinaten: −z = Norden. Hauptstraße entlang x = 0, Querstraßen alle 90 m.
 *  - Zentrum: Marktplatz mit Kirche, Rathaus und Brunnen; Bürohochhaus; Wohn-/Geschäftshäuser; Park mit Teich
 *  - Außen: Einfamilienhäuser mit Gärten, Sportplatz mit Flutlicht, Gewerbe mit Wasserturm, Tankstelle
 *  - Osten: Flugplatz mit Piste 18/36 (600 m), Rollweg, Vorfeld, Hangars, Tower, abgestellten Flugzeugen
 */

const STREETS_X = [-270, -180, -90, 0, 90, 180];
const STREETS_Z = [-270, -180, -90, 0, 90, 180, 270];
const ROAD_W = 9;
const WALK_W = 3;

const RUNWAY_X = 560;
const RUNWAY_Z0 = -320; // Nordende
const RUNWAY_Z1 = 280; // Südende
const RUNWAY_W = 25;

const WALL_COLORS = [0xf3ead8, 0xf6e7b8, 0xeed3c0, 0xe8e8e2, 0xdfe7ee, 0xf0d9c8, 0xe6e0c8, 0xd9c7b0];
const ROOF_COLORS = [0xb5523b, 0xa0452f, 0x6b4b3e, 0x4a4f57, 0xc06a45];
const CAR_COLORS = [0xc0392b, 0x2c3e50, 0xecf0f1, 0x7f8c8d, 0x2980b9, 0x16a085, 0xf1c40f, 0x111111, 0x8e44ad, 0xd35400];

export function buildTown(scene: THREE.Scene, shadows: boolean): Arena {
  const r = rng(2024);
  const pick = <T>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const collision = new StaticWorld(0, 16);
  const b = new CityBuilder(scene, collision, shadows);

  // ------------------------------------------------------------------ Himmel, Licht, Boden
  const sky = new Sky();
  sky.scale.setScalar(8000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.5;
  u.rayleigh.value = 1.1;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.85;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(48), THREE.MathUtils.degToRad(150));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  scene.fog = new THREE.Fog(0xc4d3e0, 400, 2600);

  scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x55623f, 1.15));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.copy(sunDir).multiplyScalar(150);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -70;
  sc.right = sc.top = 70;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  const grass = grassTexture();
  grass.repeat.set(400, 400);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = shadows;
  scene.add(ground);

  // ------------------------------------------------------------------ Straßen
  const zMin = STREETS_Z[0],
    zMax = STREETS_Z[STREETS_Z.length - 1];
  const xMin = STREETS_X[0],
    xMax = STREETS_X[STREETS_X.length - 1];
  for (const x of STREETS_X) {
    road(b, x, (zMin + zMax) / 2, zMax - zMin + ROAD_W, true);
  }
  for (const z of STREETS_Z) {
    road(b, (xMin + xMax) / 2, z, xMax - xMin + ROAD_W, false);
  }
  // Zufahrt Flugplatz (Verlängerung der Querstraße z = 0)
  road(b, (xMax + 470) / 2, 0, 470 - xMax, false);
  // Bürgersteige an der Hauptstraße und um den Marktplatz
  for (const z of [-90, 0, 90]) {
    for (const side of [-1, 1]) {
      b.ground('pavement', side * (ROAD_W / 2 + WALK_W / 2), z + 45, WALK_W, 90 - ROAD_W, 0, 0.04, 2);
    }
  }

  // Ortsschild
  signPost(b, scene, 196, 8, 'FLUGDORF');

  // Laternen und Alleebäume entlang Hauptstraße und Querstraße z = 0
  for (let z = zMin + 15; z < zMax; z += 30) {
    if (STREETS_Z.some((sz) => Math.abs(sz - z) < 10)) continue;
    b.lamp(-ROAD_W / 2 - 0.6, z, Math.PI);
    b.lamp(ROAD_W / 2 + 0.6, z + 15, 0);
  }
  for (let x = xMin + 15; x < 460; x += 32) {
    if (STREETS_X.some((sx) => Math.abs(sx - x) < 10)) continue;
    b.lamp(x, -ROAD_W / 2 - 0.6, Math.PI / 2);
  }
  for (let z = -255; z < 260; z += 22) {
    if (STREETS_Z.some((sz) => Math.abs(sz - z) < 12) || (z > -90 && z < 0)) continue;
    b.tree(-ROAD_W / 2 - WALK_W - 1.5, z, 8 + r() * 3, false, treeColor(r));
    b.tree(ROAD_W / 2 + WALK_W + 1.5, z + 11, 8 + r() * 3, false, treeColor(r));
  }

  // ------------------------------------------------------------------ Blöcke
  for (let ix = 0; ix < STREETS_X.length - 1; ix++) {
    for (let iz = 0; iz < STREETS_Z.length - 1; iz++) {
      const x0 = STREETS_X[ix] + ROAD_W / 2 + WALK_W;
      const x1 = STREETS_X[ix + 1] - ROAD_W / 2 - WALK_W;
      const z0 = STREETS_Z[iz] + ROAD_W / 2 + WALK_W;
      const z1 = STREETS_Z[iz + 1] - ROAD_W / 2 - WALK_W;
      const cx = (x0 + x1) / 2,
        cz = (z0 + z1) / 2;
      const key = `${STREETS_X[ix]},${STREETS_Z[iz]}`;
      switch (key) {
        case '0,-90':
          marketSquare(b, scene, x0, x1, z0, z1, r);
          break;
        case '-90,-90':
          downtown(b, x0, x1, z0, z1, r);
          break;
        case '0,0':
        case '-90,-180':
        case '0,-180':
          apartmentBlock(b, x0, x1, z0, z1, r, key === '0,0');
          break;
        case '-90,0':
          park(b, cx, cz, x1 - x0, z1 - z0, r);
          break;
        case '-270,90':
        case '-270,180':
          if (key === '-270,90') sportsPark(b, scene, x0, x1, z0, STREETS_Z[iz + 2] - ROAD_W / 2 - WALK_W, r);
          break;
        case '90,180':
          industry(b, x0, x1, z0, z1, r);
          break;
        case '90,-90':
          gasStationBlock(b, x0, x1, z0, z1, r);
          break;
        default:
          if (Math.abs(cx) < 140 && Math.abs(cz) < 140) apartmentBlock(b, x0, x1, z0, z1, r, false);
          else houses(b, x0, x1, z0, z1, r, pick);
      }
    }
  }

  // Parkende Autos an den Straßenrändern
  for (const x of STREETS_X) {
    for (let z = zMin + 10; z < zMax - 10; z += 7) {
      if (STREETS_Z.some((sz) => Math.abs(sz - z) < 9) || r() > 0.28) continue;
      b.car(x + ROAD_W / 2 - 1.2, z, Math.PI / 2, pick(CAR_COLORS));
    }
  }

  // ------------------------------------------------------------------ Flugplatz
  airfield(b, scene, r, pick);

  // Hügel am Horizont (ohne Kollision)
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x6f8160, roughness: 1, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r() * 0.2;
    const dist = 1500 + r() * 500;
    const h = 80 + r() * 220;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(250 + r() * 300, h, 7), hillMat);
    hill.position.set(Math.cos(a) * dist, h / 2 - 5, Math.sin(a) * dist);
    scene.add(hill);
  }

  b.finish();

  return {
    name: 'Kleinstadt mit Flugplatz',
    cars: b.fleet,
    collision,
    sun,
    sunDirection: sunDir,
    sky,
    spawns: {
      quad: new THREE.Vector3(45, 0.03, -28),
      quadYaw: 0,
      plane: new THREE.Vector3(RUNWAY_X, 0, RUNWAY_Z1 - 25),
      planeYaw: 0,
    },
    windsocks: [new THREE.Vector3(70, 0, -20), new THREE.Vector3(RUNWAY_X + 30, 0, RUNWAY_Z1 - 40), new THREE.Vector3(RUNWAY_X + 30, 0, RUNWAY_Z0 + 40)],
  };
}

// ====================================================================== Bausteine

function treeColor(r: () => number): THREE.Color {
  return new THREE.Color().setHSL(0.24 + r() * 0.08, 0.45 + r() * 0.2, 0.26 + r() * 0.1);
}

function road(b: CityBuilder, x: number, z: number, length: number, alongZ: boolean): void {
  const w = alongZ ? ROAD_W : length;
  const d = alongZ ? length : ROAD_W;
  b.ground('asphalt', x, z, w, d, 0, 0.02, 8);
  // Mittellinie (gestrichelt)
  const n = Math.floor(length / 12);
  for (let i = 0; i < n; i++) {
    const t = -length / 2 + 6 + i * 12;
    if (alongZ) b.ground('white', x, z + t, 0.15, 5, 0, 0.03, 1, 0xf0f0f0);
    else b.ground('white', x + t, z, 5, 0.15, 0, 0.03, 1, 0xf0f0f0);
  }
}

function signPost(b: CityBuilder, scene: THREE.Scene, x: number, z: number, text: string): void {
  b.cylinder('darkMetal', x, 0, z, 0.05, 2.6, 0x555555, true, 6);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.55),
    new THREE.MeshStandardMaterial({ map: signTexture(text, '#f2c511', '#111111'), side: THREE.DoubleSide }),
  );
  sign.position.set(x, 2.3, z);
  sign.rotation.y = Math.PI / 2;
  scene.add(sign);
}

/** Einfamilienhäuser mit Gärten entlang des Blockrands. */
function houses(b: CityBuilder, x0: number, x1: number, z0: number, z1: number, r: () => number, pick: <T>(a: T[]) => T): void {
  const lot = 17;
  const sides: { along: 'x' | 'z'; fixed: number; from: number; to: number; yaw: number; inward: number }[] = [
    { along: 'x', fixed: z0, from: x0, to: x1, yaw: Math.PI, inward: 1 },
    { along: 'x', fixed: z1, from: x0, to: x1, yaw: 0, inward: -1 },
    { along: 'z', fixed: x0, from: z0 + lot, to: z1 - lot, yaw: -Math.PI / 2, inward: 1 },
    { along: 'z', fixed: x1, from: z0 + lot, to: z1 - lot, yaw: Math.PI / 2, inward: -1 },
  ];
  for (const s of sides) {
    for (let t = s.from + lot / 2; t <= s.to - lot / 2 + 0.1; t += lot) {
      if (r() < 0.12) continue; // Baulücke / Garten
      const w = 9 + r() * 3;
      const d = 8 + r() * 2;
      const set = 7 + d / 2;
      const x = s.along === 'x' ? t : s.fixed + s.inward * set;
      const z = s.along === 'x' ? s.fixed + s.inward * set : t;
      // Hausfront zeigt zur Straße; Häuser entlang z sind um 90° gedreht
      const yaw = s.along === 'x' ? 0 : Math.PI / 2;
      b.house(x, z, w, d, r() < 0.7 ? 2 : 1, yaw, pick(WALL_COLORS), pick(ROOF_COLORS));
      // Garten: Bäume hinter dem Haus
      const back = s.inward * (set + d / 2 + 5 + r() * 6);
      const tx = s.along === 'x' ? t + (r() - 0.5) * 8 : s.fixed + back;
      const tz = s.along === 'x' ? s.fixed + back : t + (r() - 0.5) * 8;
      b.tree(tx, tz, 6 + r() * 6, r() < 0.3, treeColor(r));
      // Auto in der Einfahrt
      if (r() < 0.45) {
        const off = w / 2 + 2.2;
        const cx = s.along === 'x' ? t + off : s.fixed + s.inward * 4;
        const cz = s.along === 'x' ? s.fixed + s.inward * 4 : t + off;
        b.car(cx, cz, s.along === 'x' ? Math.PI / 2 : 0, pick(CAR_COLORS));
      }
    }
  }
  // Ein paar Bäume im Blockinneren
  for (let i = 0; i < 4; i++) {
    b.tree(x0 + 25 + r() * (x1 - x0 - 50), z0 + 25 + r() * (z1 - z0 - 50), 7 + r() * 8, r() < 0.4, treeColor(r));
  }
}

/** Wohn- und Geschäftshäuser (3–5 Geschosse) rund um einen Innenhof. */
function apartmentBlock(b: CityBuilder, x0: number, x1: number, z0: number, z1: number, r: () => number, shops: boolean): void {
  const w = x1 - x0,
    d = z1 - z0;
  const depth = 12;
  const colors = [0xe9e2d0, 0xd9c9a8, 0xe0d2c0, 0xc9d3d9, 0xe8d0b0, 0xd7d0c4];
  const pickC = () => colors[Math.floor(r() * colors.length)];
  // Nord- und Südzeile, je zwei Häuser
  for (const [zz, yaw] of [
    [z0 + depth / 2 + 1, 0],
    [z1 - depth / 2 - 1, 0],
  ] as [number, number][]) {
    const half = (w - 6) / 2;
    b.block(x0 + 1 + half / 2, zz, half - 1, depth, 3 + Math.floor(r() * 3), yaw, 'apartment', pickC(), shops);
    b.block(x1 - 1 - half / 2, zz, half - 1, depth, 3 + Math.floor(r() * 3), yaw, 'apartment', pickC(), shops);
  }
  // Ost- und Westzeile
  const innerD = d - 2 * depth - 6;
  b.block(x0 + depth / 2 + 1, (z0 + z1) / 2, depth, innerD, 4, 0, 'apartment', pickC(), false);
  b.block(x1 - depth / 2 - 1, (z0 + z1) / 2, depth, innerD, 4, 0, 'apartment', pickC(), false);
  // Innenhof mit Bäumen
  for (let i = 0; i < 5; i++) {
    b.tree((x0 + x1) / 2 + (r() - 0.5) * (w - 40), (z0 + z1) / 2 + (r() - 0.5) * (d - 40), 7 + r() * 5, false, treeColor(r));
  }
}

/** Innenstadt: Bürohochhaus und Geschäftshäuser. */
function downtown(b: CityBuilder, x0: number, x1: number, z0: number, z1: number, r: () => number): void {
  const cx = (x0 + x1) / 2,
    cz = (z0 + z1) / 2;
  // Hochhaus (13 Geschosse ≈ 39 m) mit Glasfassade
  b.block(cx - 12, cz - 10, 22, 22, 13, 0, 'office', 0xdfe6ee, false);
  // Sockelbau mit Läden
  b.block(cx + 18, cz + 14, 26, 18, 4, 0, 'apartment', 0xe7dcc7, true);
  b.block(cx - 12, z1 - 8, 30, 14, 3, 0, 'apartment', 0xd9cdb6, true);
  b.block(x1 - 8, z0 + 14, 14, 26, 5, 0, 'office', 0xcfd8df, false);
  // Vorplatz
  b.ground('pavement', cx + 6, z0 + 12, 30, 22, 0, 0.03, 2);
  for (let i = 0; i < 4; i++) b.tree(cx - 4 + i * 8, z0 + 6, 7 + r() * 2, false, treeColor(r));
}

/** Marktplatz mit Kirche, Rathaus, Brunnen und Café. */
function marketSquare(b: CityBuilder, scene: THREE.Scene, x0: number, x1: number, z0: number, z1: number, r: () => number): void {
  const cx = (x0 + x1) / 2,
    cz = (z0 + z1) / 2;
  b.ground('pavement', cx, cz, x1 - x0, z1 - z0, 0, 0.03, 2.5);

  // Kirche: Schiff (Längsachse Nord–Süd), Turm mit Spitzhelm an der Südseite
  const churchX = cx,
    churchZ = z0 + 16;
  const stone = 0xe8e1d1;
  b.walls('plain', churchX, churchZ, 14, 26, 0, 12, 0, stone);
  b.collision.addBox(new THREE.Vector3(churchX, 6, churchZ), new THREE.Vector3(14, 12, 26));
  b.gableRoof(churchX, churchZ, 26, 14, 12, 50, Math.PI / 2, 0x4c5a63, stone, 0.6);
  // hohe Fenster
  for (let i = -2; i <= 2; i++) {
    for (const side of [-1, 1]) {
      b.add('glass', new THREE.BoxGeometry(0.1, 5, 1.6), churchX + side * 7.02, 6, churchZ + i * 4.5, 0, 0x3b5f8a);
    }
  }
  const towerZ = churchZ + 13 + 3.5;
  b.box('plain', churchX, 0, towerZ, 7, 30, 7, 0, stone);
  // Spitzhelm (vierseitig)
  const spire = new THREE.ConeGeometry(5.2, 16, 4);
  spire.rotateY(Math.PI / 4);
  b.add('roofFlat', spire, churchX, 30 + 8, towerZ, 0, 0x3f6f5a);
  b.collision.addCylinder(churchX, towerZ, 30, 38, 2.6);
  b.collision.addCylinder(churchX, towerZ, 38, 46, 1.0);
  b.cylinder('metal', churchX, 46, towerZ, 0.05, 2.5, 0xd4af37, true, 6);
  // Turmuhren
  const clockMat = new THREE.MeshStandardMaterial({ map: clockTexture() });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const clock = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), clockMat);
    clock.position.set(churchX + Math.sin(a) * 3.53, 25, towerZ + Math.cos(a) * 3.53);
    clock.rotation.y = a;
    scene.add(clock);
  }
  // Portal
  b.add('wood', new THREE.BoxGeometry(2.4, 3.6, 0.2), churchX, 1.8, towerZ + 3.55, 0, 0x5a3a22);

  // Rathaus an der Ostseite
  const hallX = x1 - 10,
    hallZ = cz + 4;
  const h = 3 * MODULE_H + 0.6;
  b.walls('house', hallX, hallZ, 16, 30, 0, h, 0, 0xf2d99a);
  b.collision.addBox(new THREE.Vector3(hallX, h / 2, hallZ), new THREE.Vector3(16, h, 30));
  b.gableRoof(hallX, hallZ, 30, 16, h, 45, Math.PI / 2, 0xa0452f, 0xf2d99a);
  b.box('plain', hallX - 8.5, 0, hallZ, 1, 4, 6, 0, 0xffffff);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardMaterial({ map: signTexture('RATHAUS', '#7a1f1f', '#f5e6c8') }));
  sign.position.set(hallX - 8.06, 7.6, hallZ);
  sign.rotation.y = -Math.PI / 2;
  scene.add(sign);

  // Brunnen
  const fx = cx - 6,
    fz = cz + 6;
  b.cylinder('concrete', fx, 0, fz, 4.5, 0.7, 0xb8b0a0, true, 24);
  b.add('water', new THREE.CylinderGeometry(4.1, 4.1, 0.05, 24), fx, 0.66, fz, 0, 0x4f8fb8);
  b.cylinder('concrete', fx, 0.7, fz, 0.6, 2.2, 0xb8b0a0, true, 12);
  b.cylinder('concrete', fx, 2.9, fz, 1.5, 0.3, 0xb8b0a0, true, 16);

  // Café mit Sonnenschirmen
  for (let i = 0; i < 5; i++) {
    const x = x0 + 8 + (i % 3) * 6,
      z = z1 - 12 + Math.floor(i / 3) * 6;
    b.cylinder('metal', x, 0, z, 0.04, 2.4, 0xcccccc, true, 6);
    b.add('white', new THREE.ConeGeometry(1.6, 0.6, 8), x, 2.5, z, 0, i % 2 ? 0xd94b3c : 0xf2f2f2);
    b.cylinder('white', x, 0, z, 0.45, 0.75, 0xeeeeee, false, 10);
  }
  // Bäume und Bänke am Platzrand
  for (let i = 0; i < 6; i++) {
    b.tree(x0 + 4, z0 + 30 + i * 8, 7 + r() * 2, false, treeColor(r));
    b.bench(x0 + 6.5, z0 + 34 + i * 8, Math.PI / 2);
  }
}

function clockTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f5f0e0';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#222';
  g.lineWidth = 4;
  g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillStyle = '#222';
    g.fillRect(64 + Math.sin(a) * 50 - 2, 64 - Math.cos(a) * 50 - 2, 4, 4);
  }
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(64, 64);
  g.lineTo(64, 24);
  g.moveTo(64, 64);
  g.lineTo(92, 74);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

/** Park mit Teich, Wegen, Bäumen und Bänken. */
function park(b: CityBuilder, cx: number, cz: number, w: number, d: number, r: () => number): void {
  b.ground('pavement', cx, cz, 3, d, 0, 0.03, 2);
  b.ground('pavement', cx, cz, w, 3, 0, 0.03, 2);
  const px = cx - 14,
    pz = cz + 14;
  b.add('concrete', new THREE.CylinderGeometry(14.6, 14.6, 0.15, 40), px, 0.05, pz, 0, 0x8d8478);
  b.add('water', new THREE.CylinderGeometry(14, 14, 0.12, 40), px, 0.12, pz, 0, 0x3f7fa8);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const rad = 12 + r() * (w / 2 - 14);
    const x = cx + Math.cos(a) * rad,
      z = cz + Math.sin(a) * rad;
    if (Math.hypot(x - px, z - pz) < 18 || Math.abs(x - cx) < 4 || Math.abs(z - cz) < 4) continue;
    b.tree(x, z, 8 + r() * 9, r() < 0.35, treeColor(r));
  }
  for (let i = 0; i < 4; i++) b.bench(cx + 3, cz - 30 + i * 9, Math.PI / 2);
  // Pavillon
  b.cylinder('wood', cx + 18, 0, cz - 18, 4, 0.3, 0x9a7b5a, true, 8);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.cylinder('wood', cx + 18 + Math.cos(a) * 3.5, 0.3, cz - 18 + Math.sin(a) * 3.5, 0.12, 2.6, 0xf2f2f2, true, 6);
  }
  b.add('roofTile', new THREE.ConeGeometry(4.6, 2, 6), cx + 18, 3.9, cz - 18, 0, 0x6b4b3e);
  b.collision.addCylinder(cx + 18, cz - 18, 2.9, 4.4, 3.8);
}

/** Sportplatz: Fußballfeld mit Toren, Flutlicht und Tribüne. */
function sportsPark(b: CityBuilder, scene: THREE.Scene, x0: number, x1: number, z0: number, z1: number, r: () => number): void {
  const cx = (x0 + x1) / 2,
    cz = (z0 + z1) / 2;
  const pitchTex = pitchTexture();
  pitchTex.center.set(0.5, 0.5);
  pitchTex.rotation = Math.PI / 2;
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(68, 105),
    new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(cx, 0.025, cz);
  pitch.receiveShadow = true;
  scene.add(pitch);
  // Tore
  for (const side of [-1, 1]) {
    const gz = cz + side * 52.5;
    for (const gx of [-3.66, 3.66]) b.cylinder('white', cx + gx, 0, gz, 0.06, 2.44, 0xffffff, true, 8);
    b.box('white', cx, 2.38, gz, 7.44, 0.12, 0.12, 0, 0xffffff, true);
    b.box('white', cx, 0, gz + side * 1.5, 7.3, 0.05, 0.05, 0, 0xffffff, false);
  }
  // Flutlichtmasten
  for (const [dx, dz] of [
    [-40, -45],
    [40, -45],
    [-40, 45],
    [40, 45],
  ]) {
    b.cylinder('darkMetal', cx + dx, 0, cz + dz, 0.35, 24, 0x6b7076, true, 8, 0.2);
    b.box('darkMetal', cx + dx, 23, cz + dz, 4, 2.4, 0.6, dx < 0 ? Math.PI / 2 : -Math.PI / 2, 0x5a5f66, true);
    b.add('emissive', new THREE.BoxGeometry(3.6, 2, 0.1), cx + dx - Math.sign(dx) * 0.35, 24.2, cz + dz, Math.PI / 2, 0xf8f8ff);
  }
  // Tribüne (Stufen)
  for (let i = 0; i < 5; i++) {
    b.box('concrete', x1 - 6 + i * 1.2, 0, cz, 1.2, 0.5 + i * 0.5, 40, 0, 0xa8a49a, true);
  }
  b.box('metal', x1 - 2, 4, cz, 7, 0.2, 42, 0, 0xc4ccd4, true);
  // Vereinsheim
  b.house(x0 + 10, z0 + 10, 14, 9, 1, 0, 0xe8e1d1, 0x6b4b3e);
  for (let i = 0; i < 10; i++) b.tree(x0 + 3, z0 + 25 + i * 12, 9 + r() * 6, r() < 0.5, treeColor(r));
}

/** Gewerbe: Hallen und Wasserturm. */
function industry(b: CityBuilder, x0: number, x1: number, z0: number, z1: number, r: () => number): void {
  b.ground('asphalt', (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0, 0.025, 8, 0xd0d0d0);
  b.box('metal', x0 + 22, 0, z0 + 20, 34, 9, 26, 0, 0xb8c0c8, true, 4);
  b.box('metal', x0 + 22, 0, z1 - 20, 34, 7, 22, 0, 0x8fa3b5, true, 4);
  // Wasserturm
  const wx = x1 - 18,
    wz = (z0 + z1) / 2;
  b.cylinder('concrete', wx, 0, wz, 2.2, 26, 0xc9c2b5, true, 16);
  b.cylinder('concrete', wx, 26, wz, 8, 7, 0xd8d0c0, true, 24, 7);
  b.add('roofFlat', new THREE.ConeGeometry(7.5, 3, 24), wx, 34.5, wz, 0, 0x6b7a85);
  b.collision.addCylinder(wx, wz, 33, 36, 6);
  for (let i = 0; i < 6; i++) b.car(x0 + 48 + (i % 3) * 3, z0 + 40 + Math.floor(i / 3) * 7, 0, [0xffffff, 0xd35400, 0x2c3e50][i % 3]);
  void r;
}

/** Tankstelle an der Ausfallstraße. */
function gasStationBlock(b: CityBuilder, x0: number, x1: number, z0: number, z1: number, r: () => number): void {
  const cx = x1 - 25,
    cz = z1 - 18;
  b.ground('asphalt', cx, cz, 40, 28, 0, 0.025, 8, 0xdddddd);
  // Dach über den Zapfsäulen
  b.box('white', cx, 5, cz, 22, 0.8, 12, 0, 0xf5f5f5, true);
  b.box('emissive', cx, 5.5, cz + 6.02, 22, 0.3, 0.04, 0, 0x1e88e5, false);
  for (const dx of [-6, 0, 6]) {
    b.cylinder('white', cx + dx, 0, cz, 0.35, 5, 0xeeeeee, true, 10);
    b.box('plain', cx + dx, 0, cz + 2.5, 1, 1.8, 0.6, 0, 0xd32f2f, true);
  }
  b.block(cx - 2, cz - 12, 16, 7, 1, 0, 'apartment', 0xf0f0f0, true);
  b.car(cx - 6, cz + 2.6, 0, 0x2980b9);
  // Rest des Blocks: Häuser
  houses(b, x0, x1 - 52, z0, z1, r, (a) => a[Math.floor(r() * a.length)]);
}

/** Flugplatz mit Piste, Rollweg, Vorfeld, Hangars, Tower und abgestellten Flugzeugen. */
function airfield(b: CityBuilder, scene: THREE.Scene, r: () => number, pick: <T>(a: T[]) => T): void {
  const len = RUNWAY_Z1 - RUNWAY_Z0;
  const rz = (RUNWAY_Z0 + RUNWAY_Z1) / 2;
  // Piste
  b.ground('asphalt', RUNWAY_X, rz, RUNWAY_W, len, 0, 0.03, 10, 0x9a9a9a);
  // Randlinien, Mittellinie, Schwellen, Aufsetzzonen
  for (const side of [-1, 1]) b.ground('white', RUNWAY_X + side * (RUNWAY_W / 2 - 0.6), rz, 0.9, len, 0, 0.04, 1, 0xf2f2f2);
  for (let z = RUNWAY_Z0 + 60; z < RUNWAY_Z1 - 60; z += 50) b.ground('white', RUNWAY_X, z, 0.9, 30, 0, 0.04, 1, 0xf2f2f2);
  for (const [zEnd, dir] of [
    [RUNWAY_Z0, 1],
    [RUNWAY_Z1, -1],
  ] as [number, number][]) {
    for (let i = 0; i < 8; i++) {
      const x = RUNWAY_X - RUNWAY_W / 2 + 2.2 + i * 3 + (i >= 4 ? 2.6 : 0);
      b.ground('white', x, zEnd + dir * 18, 1.8, 30, 0, 0.04, 1, 0xf2f2f2);
    }
    for (const side of [-1, 1]) b.ground('white', RUNWAY_X + side * 5, zEnd + dir * 150, 3, 45, 0, 0.04, 1, 0xf2f2f2);
  }
  const numberMesh = (text: string, z: number, rot: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 18),
      new THREE.MeshStandardMaterial({
        map: runwayNumberTexture(text),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
      }),
    );
    m.rotation.set(-Math.PI / 2, 0, rot);
    m.position.set(RUNWAY_X, 0.05, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  numberMesh('36', RUNWAY_Z1 - 50, 0);
  numberMesh('18', RUNWAY_Z0 + 50, Math.PI);
  // Pistenbefeuerung
  for (let z = RUNWAY_Z0; z <= RUNWAY_Z1; z += 40) {
    for (const side of [-1, 1]) b.box('emissive', RUNWAY_X + side * (RUNWAY_W / 2 + 1.5), 0, z, 0.25, 0.35, 0.25, 0, 0xfff7d6, false);
  }

  // Rollweg und Verbindungen
  const twx = RUNWAY_X - 60;
  b.ground('asphalt', twx, rz, 14, len - 80, 0, 0.03, 8, 0xa8a8a8);
  for (let z = RUNWAY_Z0 + 60; z < RUNWAY_Z1 - 40; z += 6) b.ground('white', twx, z, 0.3, 3, 0, 0.04, 1, 0xf2d33a);
  for (const z of [RUNWAY_Z0 + 50, 0, RUNWAY_Z1 - 50]) {
    b.ground('asphalt', (twx + RUNWAY_X) / 2, z, 60 - RUNWAY_W / 2 - 7 + 14, 14, 0, 0.032, 8, 0xa8a8a8);
  }
  // Vorfeld
  const apronX = twx - 45;
  b.ground('asphalt', apronX, 0, 70, 150, 0, 0.032, 8, 0xb5b5b5);
  for (let z = -60; z <= 60; z += 30) b.ground('white', apronX + 12, z, 18, 0.3, 0, 0.04, 1, 0xf2d33a);

  // Hangars (Bogenhallen), Tore zum Vorfeld
  const hangarX = apronX - 48;
  for (const hz of [-55, 0, 55]) hangar(b, scene, hangarX, hz, 30, 26, 11);
  // Tower
  const tx = apronX + 10,
    tz = 100;
  b.box('plain', tx, 0, tz, 9, 4, 9, 0, 0xe8e8e8);
  b.box('plain', tx, 4, tz, 4, 11, 4, 0, 0xf0f0f0);
  b.add('glass', new THREE.CylinderGeometry(3.8, 3.2, 3.2, 8), tx, 16.6, tz, 0, 0x5d7c99);
  b.collision.addCylinder(tx, tz, 15, 18.2, 3.8);
  b.cylinder('darkMetal', tx, 18.2, tz, 4.3, 0.6, 0x3c4248, true, 8);
  b.cylinder('metal', tx, 18.8, tz, 0.06, 4, 0xdddddd, true, 6);
  b.add('emissive', new THREE.SphereGeometry(0.25, 8, 6), tx, 22.9, tz, 0, 0xff3333);
  // Vereinsheim / Abfertigung mit Schild
  const cx = apronX + 5,
    cz = -100;
  b.block(cx, cz, 26, 11, 2, 0, 'apartment', 0xf5f5f0, false);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.2), new THREE.MeshStandardMaterial({ map: signTexture('FLUGPLATZ', '#0d47a1', '#ffffff') }));
  sign.position.set(cx, 7.2, cz + 5.56);
  scene.add(sign);
  // Tankstelle für Flugzeuge
  b.box('plain', apronX + 20, 0, 75, 4, 2.4, 3, 0, 0xd32f2f);
  b.box('metal', apronX + 25, 0, 75, 2.5, 2.2, 6, 0, 0xcfd8dc);
  // Abgestellte Flugzeuge (großer Hochdecker, Maßstab ≈ 1:8)
  const colors = [
    [0xffffff, 0xd62828],
    [0xf5f5f5, 0x1565c0],
    [0xfff8e1, 0x2e7d32],
  ];
  [-35, -5, 28].forEach((z, i) => {
    const cfg = structuredClone(PLANE_PRESETS.trainer);
    cfg.visual.color = colors[i][0];
    cfg.visual.accent = colors[i][1];
    const mesh = new PlaneMesh(cfg);
    const s = 7.5;
    mesh.root.scale.setScalar(s);
    mesh.root.position.set(apronX + 18, 0.21 * s, z);
    mesh.root.rotation.y = Math.PI / 2 + (r() - 0.5) * 0.3;
    scene.add(mesh.root);
    // Kollision: Rumpf, Flügel, Leitwerk
    const yaw = mesh.root.rotation.y;
    const c = Math.cos(yaw),
      sn = Math.sin(yaw);
    const at = (lz: number) => new THREE.Vector3(apronX + 18 + lz * sn, 0, z + lz * c);
    b.collision.addBox(at(0).setY(1.2), new THREE.Vector3(1.2, 2.2, 8), yaw, false);
    b.collision.addBox(at(-0.1 * s).setY(0.09 * s + 1.6), new THREE.Vector3(1.4 * s, 0.3, 0.22 * s), yaw, false);
    b.collision.addBox(at(0.78 * s).setY(1.3), new THREE.Vector3(0.5 * s, 1.8, 0.4 * s), yaw, false);
  });
  // Tankwagen
  b.box('plain', apronX + 30, 0, 50, 7, 2.6, 2.5, 0, 0xe53935);
  b.box('metal', apronX + 31, 1, 50, 5, 2.2, 2.4, 0, 0xeceff1);
  // Zaun entlang der Straße (Pfosten)
  for (let z = -140; z <= 140; z += 6) {
    if (Math.abs(z) < 10) continue;
    b.cylinder('darkMetal', hangarX - 25, 0, z, 0.04, 1.8, 0x555555, true, 4);
  }
  b.box('white', hangarX - 25, 1.6, 0, 0.03, 0.05, 280, 0, 0xcccccc, false);
  // Bäume am Platzrand
  for (let i = 0; i < 18; i++) b.tree(RUNWAY_X + 70 + r() * 40, RUNWAY_Z0 + 40 + i * 32, 10 + r() * 8, r() < 0.5, treeColor(r));
  void pick;
}

/** Bogenhalle (Hangar) mit offenem Tor nach Osten (+x). */
function hangar(b: CityBuilder, scene: THREE.Scene, x: number, z: number, width: number, depth: number, height: number): void {
  const radius = width / 2;
  const scaleY = height / radius;
  // Halbschale: Zylinderachse entlang x, Schale über dem Boden (Permutation x←y, y←z, z←x)
  const shell = new THREE.CylinderGeometry(radius, radius, depth, 24, 1, true, -Math.PI / 2, Math.PI);
  shell.applyMatrix4(new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  b.add('metal', shell, x, 0, z, 0, 0xb0bec5, new THREE.Vector3(1, scaleY, 1));
  // Rückwand außen und dunkles Inneres
  const back = new THREE.CircleGeometry(radius, 24, 0, Math.PI);
  back.rotateY(-Math.PI / 2);
  b.add('metal', back, x - depth / 2, 0, z, 0, 0x90a4ae, new THREE.Vector3(1, scaleY, 1));
  const inner = new THREE.CircleGeometry(radius * 0.97, 24, 0, Math.PI);
  inner.rotateY(Math.PI / 2);
  b.add('darkMetal', inner, x - depth / 2 + 0.1, 0, z, 0, 0x263238, new THREE.Vector3(1, scaleY * 0.97, 1));
  // Kollision: Halbkreis-Profil (gegen den Uhrzeigersinn in z/y) als Prisma entlang x
  const prof: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    prof.push([Math.cos(a) * radius, Math.sin(a) * height]);
  }
  b.collision.add({ kind: 'prism', cx: x, cz: z, y0: 0, yaw: 0, halfLength: depth / 2, profile: prof }, true);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.6), new THREE.MeshStandardMaterial({ map: signTexture('HANGAR', '#263238', '#ffeb3b') }));
  sign.position.set(x + depth / 2 + 0.05, height * 0.82, z);
  sign.rotation.y = Math.PI / 2;
  scene.add(sign);
}
