import * as THREE from 'three';
import type { MilitaryGame } from '../game/missions';

/** Render-Layer: 0 = Welt (kalt im Wärmebild), 1 = warme Objekte, 2 = Effekte (Sprites, Leuchtspur). */
export const LAYER_HOT = 1;
export const LAYER_FX = 2;

export function setLayer(obj: THREE.Object3D, layer: number): void {
  obj.traverse((o) => o.layers.set(layer));
}

const OLIVE = 0x4b5320;
const mat = (color: number, rough = 0.8, metal = 0.1) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function markerTexture(color: string, symbol: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.translate(32, 32);
  g.rotate(Math.PI / 4);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(-16, -16, 32, 32);
  g.rotate(-Math.PI / 4);
  g.fillStyle = color;
  g.font = 'bold 26px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(symbol, 0, 2);
  return new THREE.CanvasTexture(c);
}

function marker(color: string, symbol: string): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(color, symbol), depthTest: false, transparent: true }));
  s.renderOrder = 10;
  setLayer(s, LAYER_FX);
  return s;
}

/** Militär-LKW mit Plane bzw. Geländewagen (vereinfacht). */
function convoyMesh(kind: 'jeep' | 'truck'): THREE.Group {
  const g = new THREE.Group();
  const olive = mat(OLIVE);
  const dark = mat(0x1d1f17);
  if (kind === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.1, 2.0), olive);
    cab.position.set(0, 1.55, -2.6);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.5, 5.2), olive);
    bed.position.set(0, 1.0, 1.2);
    const cover = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 5.1, 12, 1, false, -Math.PI / 2, Math.PI), mat(0x5a6136));
    cover.rotation.x = Math.PI / 2;
    cover.position.set(0, 1.75, 1.2);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.05), mat(0x203040, 0.2, 0.3));
    glass.position.set(0, 2.0, -3.62);
    g.add(cab, bed, cover, glass);
    for (const z of [-2.6, 0.4, 2.2]) for (const x of [-1.15, 1.15]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.5, z);
      g.add(w);
    }
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.0, 4.6), olive);
    body.position.y = 1.0;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 2.4), olive);
    top.position.set(0, 1.85, 0.3);
    g.add(body, top);
    for (const z of [-1.5, 1.5]) for (const x of [-1.0, 1.0]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.42, z);
      g.add(w);
    }
  }
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : undefined));
  return g;
}

function hazardMesh(kind: 'roadblock' | 'object' | 'vehicle'): { group: THREE.Group; light: THREE.Mesh | null } {
  const g = new THREE.Group();
  let light: THREE.Mesh | null = null;
  if (kind === 'roadblock') {
    for (const x of [-3.2, 0, 3.2]) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 0.6), mat(0x9e9e94));
      block.position.set(x, 0.45, 0);
      g.add(block);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(9, 0.18, 0.12), mat(0xd32f2f));
    bar.position.set(0, 1.25, 0);
    g.add(bar);
    for (let i = 0; i < 5; i++) {
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.14, 8, 14), mat(0x111111));
      tire.rotation.x = Math.PI / 2;
      tire.position.set(-2 + i, 0.14 + (i % 2) * 0.28, 0.9);
      g.add(tire);
    }
  } else if (kind === 'object') {
    for (let i = 0; i < 3; i++) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.6), mat(0x6d5a3a));
      crate.position.set(i * 0.5 - 0.5, 0.3 + (i === 1 ? 0.6 : 0), (i % 2) * 0.3);
      crate.rotation.y = i * 0.4;
      g.add(crate);
    }
    light = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    light.position.set(0, 1.35, 0);
    g.add(light);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.3, 1.9), mat(0x3e3a2f));
    body.position.y = 0.95;
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 1.7), mat(0x2b2822));
    top.position.set(-0.3, 1.95, 0);
    g.add(body, top);
  }
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : undefined));
  return { group: g, light };
}

function airDefenseMesh(): { group: THREE.Group; turret: THREE.Group; gun: THREE.Group } {
  const g = new THREE.Group();
  const sand = mat(0x8d7b5a, 1);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.5, 8, 20), sand);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.4;
  g.add(ring);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 1.2, 10), mat(0x3b4030, 0.6, 0.3));
  base.position.y = 0.6;
  g.add(base);
  const turret = new THREE.Group();
  turret.position.y = 1.4;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1.0), mat(OLIVE, 0.6, 0.3));
  turret.add(seat);
  const gun = new THREE.Group();
  gun.position.y = 0.4;
  for (const x of [-0.18, 0.18]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.4, 8), mat(0x202020, 0.4, 0.7));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(x, 0, 1.2);
    gun.add(barrel);
  }
  turret.add(gun);
  g.add(turret);
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : undefined));
  return { group: g, turret, gun };
}

function jammerMesh(): { group: THREE.Group; light: THREE.Mesh } {
  const g = new THREE.Group();
  const steel = mat(0x777b80, 0.5, 0.5);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 14, 6), steel);
  mast.position.y = 7;
  g.add(mast);
  for (let h = 2; h < 14; h += 2) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.05), steel);
    brace.position.y = h;
    brace.rotation.y = h;
    g.add(brace);
  }
  for (let i = 0; i < 3; i++) {
    const dish = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.5), mat(0xdddddd));
    const a = (i / 3) * Math.PI * 2;
    dish.position.set(Math.sin(a) * 0.4, 12.5, Math.cos(a) * 0.4);
    dish.rotation.y = a;
    g.add(dish);
  }
  const shelter = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 2.2), mat(OLIVE));
  shelter.position.set(2.5, 1.2, 0);
  g.add(shelter);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  light.position.y = 14.3;
  g.add(light);
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : undefined));
  return { group: g, light };
}

function enemyMesh(): THREE.Group {
  const g = new THREE.Group();
  const grey = mat(0x9ea3a8, 0.6, 0.2);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.32), grey);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.05, 1.3, 8), grey);
  body.rotation.x = Math.PI / 2;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.18), grey);
  tail.position.z = 0.6;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.25, 0.18), grey);
  fin.position.set(0, 0.12, 0.6);
  g.add(wing, body, tail, fin);
  return g;
}

/**
 * Darstellung des militärischen Spielteils. Warme Objekte (Fahrzeuge, Stellungen, Aufklärer)
 * liegen auf dem Wärmebild-Layer.
 */
export class MilitaryView {
  private readonly root = new THREE.Group();
  private readonly air: { turret: THREE.Group; gun: THREE.Group; flash: THREE.Sprite }[] = [];
  private readonly jammerLights: THREE.Mesh[] = [];
  private readonly convoy: THREE.Group[] = [];
  private readonly hazards: { group: THREE.Group; light: THREE.Mesh | null; mark: THREE.Sprite }[] = [];
  private readonly enemies: { group: THREE.Group; mark: THREE.Sprite }[] = [];
  private readonly crates: THREE.Group[] = [];
  private readonly tracer: THREE.LineSegments;
  private readonly tracerPos: Float32Array;
  private readonly zones = new THREE.Group();
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private readonly game: MilitaryGame,
  ) {
    scene.add(this.root);
    const L = game.layout;
    for (const p of L.airDefense) {
      const m = airDefenseMesh();
      m.group.position.copy(p);
      setLayer(m.group, LAYER_HOT);
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd27f, blending: THREE.AdditiveBlending, transparent: true }));
      flash.scale.setScalar(1.6);
      flash.visible = false;
      setLayer(flash, LAYER_FX);
      this.root.add(m.group, flash);
      this.air.push({ turret: m.turret, gun: m.gun, flash });
    }
    for (const j of L.jammers) {
      const m = jammerMesh();
      m.group.position.set(j.position.x, 0, j.position.z);
      setLayer(m.group, LAYER_HOT);
      this.root.add(m.group);
      this.jammerLights.push(m.light);
    }
    for (const v of game.convoy.vehicles) {
      const g = convoyMesh(v.kind);
      setLayer(g, LAYER_HOT);
      this.root.add(g);
      this.convoy.push(g);
    }
    for (const h of game.convoy.hazards) {
      const m = hazardMesh(h.kind);
      m.group.position.copy(h.position);
      m.group.rotation.y = h.yaw;
      if (h.kind === 'vehicle') setLayer(m.group, LAYER_HOT);
      const mark = marker('#ffd600', '!');
      mark.position.copy(h.position).setY(6);
      mark.scale.setScalar(4);
      this.root.add(m.group, mark);
      this.hazards.push({ group: m.group, light: m.light, mark });
    }
    // Abwurfzonen: Ring mit Kreuz
    const zoneMat = new THREE.MeshBasicMaterial({ color: 0xff6f00, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    for (const z of L.dropZones) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(9, 10, 40), zoneMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(z.x, 0.07, z.z);
      const c1 = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.8), zoneMat);
      c1.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      c1.position.set(z.x, 0.07, z.z);
      const c2 = c1.clone();
      c2.rotation.z = -Math.PI / 4;
      this.zones.add(ring, c1, c2);
    }
    this.root.add(this.zones);
    // Leuchtspur (bis 300 Geschosse gleichzeitig)
    this.tracerPos = new Float32Array(300 * 6);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracer = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: 0xffb340, transparent: true, blending: THREE.AdditiveBlending }));
    this.tracer.frustumCulled = false;
    setLayer(this.tracer, LAYER_FX);
    this.root.add(this.tracer);
  }

  /** Neue Gegner-Liste (Missionsstart). */
  syncEnemies(): void {
    for (const e of this.enemies) this.root.remove(e.group, e.mark);
    this.enemies.length = 0;
    for (let i = 0; i < this.game.enemies.length; i++) {
      const g = enemyMesh();
      setLayer(g, LAYER_HOT);
      const mark = marker('#ff1744', '◆');
      mark.scale.setScalar(3);
      this.root.add(g, mark);
      this.enemies.push({ group: g, mark });
    }
    for (const c of this.crates) this.root.remove(c);
    this.crates.length = 0;
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    const g = this.game;
    const threats = g.threatsActive;
    // Flugabwehr: Turm und Rohr folgen der Zielrichtung, Mündungsfeuer
    g.air.forEach((site, i) => {
      const a = this.air[i];
      const b = site.barrel;
      a.turret.rotation.y = Math.atan2(b.x, b.z);
      a.gun.rotation.x = -Math.asin(Math.max(-1, Math.min(1, b.y)));
      a.flash.visible = threats && site.fired > 0;
      a.flash.position.copy(site.muzzle).addScaledVector(b, 2.6);
      a.turret.parent!.visible = true;
    });
    // Störsender blinken (nur wenn aktiv)
    for (const l of this.jammerLights) l.visible = threats && Math.sin(this.time * 6) > 0;
    // Leuchtspur
    let n = 0;
    if (threats) {
      for (const site of g.air) {
        for (const r of site.rounds) {
          if (n >= 300) break;
          const k = n * 6;
          this.tracerPos[k] = r.pos.x - r.vel.x * 0.02;
          this.tracerPos[k + 1] = r.pos.y - r.vel.y * 0.02;
          this.tracerPos[k + 2] = r.pos.z - r.vel.z * 0.02;
          this.tracerPos[k + 3] = r.pos.x;
          this.tracerPos[k + 4] = r.pos.y;
          this.tracerPos[k + 5] = r.pos.z;
          n++;
        }
      }
    }
    this.tracer.geometry.setDrawRange(0, n * 2);
    (this.tracer.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    // Konvoi (nur in der Konvoi-Mission sichtbar)
    const convoyOn = g.mode === 'convoy';
    g.convoy.vehicles.forEach((v, i) => {
      const m = this.convoy[i];
      m.visible = convoyOn;
      m.position.copy(v.position);
      m.rotation.y = v.yaw;
    });
    g.convoy.hazards.forEach((h, i) => {
      const m = this.hazards[i];
      m.group.visible = convoyOn && !h.cleared;
      m.mark.visible = convoyOn && h.reported && !h.cleared;
      if (m.light) m.light.visible = Math.sin(this.time * 4) > 0;
      const d = camera.distanceTo(m.mark.position);
      m.mark.scale.setScalar(Math.max(2, d * 0.03));
    });
    this.zones.visible = g.mode === 'free';
    // Gegnerische Aufklärer
    g.enemies.forEach((e, i) => {
      const m = this.enemies[i];
      if (!m) return;
      const vis = e.state !== 'waiting' && e.state !== 'escaped';
      m.group.visible = vis;
      m.mark.visible = e.active;
      m.group.position.copy(e.position);
      m.group.rotation.set(0, e.heading + Math.PI, 0);
      m.group.rotateZ(e.state === 'down' ? e.fallSpin : -e.bank);
      m.mark.position.copy(e.position).setY(e.position.y + 3);
      m.mark.scale.setScalar(Math.max(3, camera.distanceTo(e.position) * 0.025));
    });
    // Versorgungskisten mit Fallschirm
    while (this.crates.length < g.crates.length) {
      const grp = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.45), mat(OLIVE));
      box.castShadow = true;
      const chute = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xe0e0d0, side: THREE.DoubleSide }),
      );
      chute.position.y = 3;
      chute.name = 'chute';
      const lines = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.8, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x999999, wireframe: true }));
      lines.position.y = 1.6;
      lines.rotation.x = Math.PI;
      lines.name = 'lines';
      grp.add(box, chute, lines);
      this.root.add(grp);
      this.crates.push(grp);
    }
    g.crates.forEach((c, i) => {
      const grp = this.crates[i];
      grp.position.copy(c.position);
      grp.rotation.y = c.spin * 0.5;
      const open = c.chuteOpen && !c.landed;
      grp.getObjectByName('chute')!.visible = open;
      grp.getObjectByName('lines')!.visible = open;
    });
  }

  /** Brennende Konvoi-Fahrzeuge (für Feuer/Rauch). */
  fireSources(out: THREE.Vector3[]): THREE.Vector3[] {
    for (const v of this.game.convoy.vehicles) if (v.damaged && this.game.mode === 'convoy') out.push(v.position.clone().setY(2));
    return out;
  }
}
