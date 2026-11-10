import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { SimpleCollisionWorld } from './collision';

/** Deterministischer Zufallsgenerator (Mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RUNWAY_X = 70;

/** Prozedurale Bodentextur: Gras-Ton mit Rasterlinien alle 1 m und stärker alle 10 m. */
function groundTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4f6b3a';
  g.fillRect(0, 0, size, size);
  const r = rng(7);
  for (let i = 0; i < 6000; i++) {
    const v = 60 + r() * 50;
    g.fillStyle = `rgba(${v * 0.7},${v + 30},${v * 0.5},0.35)`;
    g.fillRect(r() * size, r() * size, 2, 2);
  }
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    const p = (i / 10) * size;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.moveTo(0, p);
    g.lineTo(size, p);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.lineWidth = 4;
  g.strokeRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export interface Arena {
  collision: SimpleCollisionWorld;
  /** Startpunkte: Drohnen auf dem Startplatz, Flugzeuge am Pistenanfang (Blick nach −z). */
  spawns: { quad: THREE.Vector3; plane: THREE.Vector3 };
  /** Standorte der Windsäcke. */
  windsocks: THREE.Vector3[];
  sun: THREE.DirectionalLight;
  /** Richtung zur Sonne (normiert), für mitwandernde Schattenkamera. */
  sunDirection: THREE.Vector3;
}

/**
 * Leere Testwelt für Meilenstein 1: große Wiese mit Raster, Säulen, Blöcke und
 * Torbögen als Größen- und Geschwindigkeitsreferenz.
 */
export function buildTestArena(scene: THREE.Scene, shadows: boolean): Arena {
  const collision = new SimpleCollisionWorld(0);

  // Himmel
  const sky = new Sky();
  sky.scale.setScalar(5000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.85;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(50), THREE.MathUtils.degToRad(140));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  scene.fog = new THREE.Fog(0xb8c8d8, 150, 900);

  // Licht
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.copy(sunDir).multiplyScalar(100);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -60;
  sc.right = sc.top = 60;
  sc.near = 1;
  sc.far = 300;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // Boden
  const tex = groundTexture();
  tex.repeat.set(200, 200);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Graspiste/Asphaltpiste für Flugzeuge
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 320),
    new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.95 }),
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(RUNWAY_X, 0.005, -120);
  runway.receiveShadow = true;
  scene.add(runway);
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
  for (let z = 30; z > -270; z -= 12) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 5), stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(RUNWAY_X, 0.01, z);
    scene.add(stripe);
  }

  // Startplattform
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 0.02, 32),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 }),
  );
  pad.position.y = 0.0;
  pad.receiveShadow = true;
  scene.add(pad);
  const padMark = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 0.95, 32),
    new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
  );
  padMark.rotation.x = -Math.PI / 2;
  padMark.position.y = 0.012;
  scene.add(padMark);

  const r = rng(42);
  const addBox = (x: number, z: number, w: number, h: number, d: number, color: number) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
    );
    m.position.set(x, h / 2, z);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    scene.add(m);
    collision.addBox(m.position, new THREE.Vector3(w, h, d));
  };

  // Säulen-Reihe (Slalom-Referenz)
  for (let i = 0; i < 10; i++) {
    addBox(-6 + (i % 2) * 12, -20 - i * 15, 0.6, 6, 0.6, i % 2 ? 0xd9534f : 0xf0ad4e);
  }

  // Verstreute Blöcke
  for (let i = 0; i < 60; i++) {
    const ang = r() * Math.PI * 2;
    const dist = 30 + r() * 250;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    if (Math.abs(x) < 12 && z < 0 && z > -170) continue; // Slalom-Gasse freihalten
    if (Math.abs(x - RUNWAY_X) < 45 && z < 120 && z > -420) continue; // Piste + Anflug freihalten
    const w = 2 + r() * 8;
    const h = 1 + r() * (r() < 0.2 ? 30 : 8);
    const d = 2 + r() * 8;
    const col = new THREE.Color().setHSL(0.55 + r() * 0.15, 0.2, 0.45 + r() * 0.2).getHex();
    addBox(x, z, w, h, d, col);
  }

  // Torbögen (nur Optik + Kollision der Pfosten/Balken) als Flugziele
  const archMat = new THREE.MeshStandardMaterial({ color: 0x2a7fff, emissive: 0x0a2050, roughness: 0.5 });
  const addArch = (x: number, z: number, yaw: number, width: number, height: number) => {
    const t = 0.25;
    const group = new THREE.Group();
    const left = new THREE.Mesh(new THREE.BoxGeometry(t, height, t), archMat);
    left.position.set(-width / 2, height / 2, 0);
    const right = left.clone();
    right.position.x = width / 2;
    const top = new THREE.Mesh(new THREE.BoxGeometry(width + t, t, t), archMat);
    top.position.set(0, height, 0);
    group.add(left, right, top);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    group.traverse((o) => {
      o.castShadow = shadows;
    });
    scene.add(group);
    // Kollision: nur achsenparallel sinnvoll -> yaw auf 0/90° beschränkt
    const rotated = Math.abs(Math.sin(yaw)) > 0.5;
    const pos = (lx: number, ly: number) =>
      new THREE.Vector3(x + (rotated ? 0 : lx), ly, z + (rotated ? lx : 0));
    const postSize = new THREE.Vector3(t, height, t);
    collision.addBox(pos(-width / 2, height / 2), postSize);
    collision.addBox(pos(width / 2, height / 2), postSize);
    collision.addBox(
      pos(0, height),
      rotated ? new THREE.Vector3(t, t, width + t) : new THREE.Vector3(width + t, t, t),
    );
  };
  addArch(0, -12, 0, 4, 3);
  addArch(25, -60, Math.PI / 2, 5, 4);
  addArch(0, -190, 0, 6, 5);
  addArch(-40, -100, Math.PI / 2, 4, 3);
  addArch(40, 30, 0, 3, 2.5);

  return {
    collision,
    sun,
    sunDirection: sunDir,
    spawns: { quad: new THREE.Vector3(0, 0.012, 0), plane: new THREE.Vector3(RUNWAY_X, 0, 25) },
    windsocks: [new THREE.Vector3(4, 0, 3), new THREE.Vector3(RUNWAY_X + 10, 0, 0)],
  };
}
