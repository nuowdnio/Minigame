import * as THREE from 'three';
import type { Environment } from '../env/environment';

const _w = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Schwebeteilchen (Pollen/Staub), die vom Windfeld mitgetragen werden –
 * macht Böen, Windschatten und Thermik sichtbar.
 */
export class WindParticles {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly count: number;
  private readonly range = 30;

  constructor(count = 700) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.respawn(i, new THREE.Vector3(), true);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geom,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  private respawn(i: number, center: THREE.Vector3, anywhere: boolean): void {
    const r = this.range;
    const k = i * 3;
    this.positions[k] = center.x + (Math.random() - 0.5) * 2 * r;
    this.positions[k + 1] = Math.max(0.2, center.y + (Math.random() - 0.5) * (anywhere ? 2 * r : r));
    this.positions[k + 2] = center.z + (Math.random() - 0.5) * 2 * r;
  }

  update(env: Environment, time: number, camera: THREE.Vector3, dt: number): void {
    const r = this.range;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      _p.set(this.positions[k], this.positions[k + 1], this.positions[k + 2]);
      env.wind(_p, time, _w);
      _p.addScaledVector(_w, dt);
      _p.y -= 0.05 * dt; // leichte Sinkgeschwindigkeit
      this.positions[k] = _p.x;
      this.positions[k + 1] = _p.y;
      this.positions[k + 2] = _p.z;
      if (
        Math.abs(_p.x - camera.x) > r ||
        Math.abs(_p.z - camera.z) > r ||
        Math.abs(_p.y - camera.y) > r ||
        _p.y < 0.05
      ) {
        this.respawn(i, camera, false);
      }
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/**
 * Windsack: richtet sich nach dem lokalen Wind aus, hebt sich mit zunehmender
 * Windgeschwindigkeit (voll gestreckt bei ~7 m/s) und flattert in Böen.
 */
export class Windsock {
  readonly root = new THREE.Group();
  private readonly sock = new THREE.Group();
  private readonly segments: THREE.Mesh[] = [];
  private readonly top: THREE.Vector3;
  private yaw = 0;
  private lift = 0;

  constructor(position: THREE.Vector3, height = 4) {
    this.root.position.copy(position);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, height, 8),
      new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.6, roughness: 0.4 }),
    );
    pole.position.y = height / 2;
    pole.castShadow = true;
    this.root.add(pole);
    this.sock.position.y = height;
    this.root.add(this.sock);
    this.top = new THREE.Vector3(position.x, position.y + height, position.z);
    const n = 5;
    let parent: THREE.Object3D = this.sock;
    for (let i = 0; i < n; i++) {
      const r0 = 0.22 - i * 0.025;
      const r1 = r0 - 0.025;
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(r1, r0, 0.3, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffffff : 0xff5a1f, side: THREE.DoubleSide, roughness: 0.8 }),
      );
      seg.geometry.rotateX(Math.PI / 2);
      seg.geometry.translate(0, 0, 0.15);
      seg.castShadow = true;
      const holder = new THREE.Group();
      holder.position.z = i === 0 ? 0 : 0.3;
      holder.add(seg);
      parent.add(holder);
      this.segments.push(seg);
      parent = holder;
    }
  }

  update(env: Environment, time: number, dt: number): void {
    env.wind(this.top, time, _w);
    const speed = Math.hypot(_w.x, _w.z);
    const targetYaw = Math.atan2(_w.x, _w.z);
    let d = targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 3);
    const targetLift = Math.min(1, speed / 7);
    this.lift += (targetLift - this.lift) * Math.min(1, dt * 2);
    this.sock.rotation.set(0, 0, 0);
    this.sock.rotateY(this.yaw);
    // Herabhängen bei Flaute: um die x-Achse nach unten kippen
    this.sock.rotateX((1 - this.lift) * 1.35);
    for (let i = 0; i < this.segments.length; i++) {
      const holder = this.segments[i].parent!;
      holder.rotation.x = (1 - this.lift) * 0.15;
      holder.rotation.y = Math.sin(time * (6 + i) + i) * 0.06 * this.lift;
    }
  }
}
