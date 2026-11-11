import * as THREE from 'three';
import type { CollisionWorld, ContactResult } from '../world/collision';

const _contact: ContactResult = { normal: new THREE.Vector3(), depth: 0 };
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

interface Debris {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  radius: number;
  life: number;
}

/**
 * Trümmerteile (abgebrochene Propeller, Arme, Flügel …): einfache Starrkörper mit
 * Schwerkraft, Luftwiderstand und Abprallen an der Welt-Geometrie.
 */
export class DebrisSystem {
  private readonly items: Debris[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: CollisionWorld,
  ) {}

  /**
   * Teil aus dem Fahrzeugmodell lösen und als Trümmer weiterfliegen lassen.
   * @param velocity Geschwindigkeit des Fahrzeugs (Welt)
   */
  add(obj: THREE.Object3D, velocity: THREE.Vector3, spread = 2): void {
    obj.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    obj.matrixWorld.decompose(pos, quat, scl);
    obj.removeFromParent();
    obj.position.copy(pos);
    obj.quaternion.copy(quat);
    obj.scale.copy(scl);
    this.scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const radius = Math.max(0.01, box.getSize(new THREE.Vector3()).length() * 0.35);
    this.items.push({
      obj,
      vel: velocity
        .clone()
        .add(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * spread, (Math.random() - 0.5) * spread)),
      angVel: new THREE.Vector3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20),
      radius,
      life: 40,
    });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.obj);
        this.items.splice(i, 1);
        continue;
      }
      d.vel.y -= 9.81 * dt;
      d.vel.multiplyScalar(1 - 0.3 * dt);
      d.obj.position.addScaledVector(d.vel, dt);
      const w = d.angVel.length();
      if (w > 1e-4) {
        _q.setFromAxisAngle(_v.copy(d.angVel).divideScalar(w), w * dt);
        d.obj.quaternion.premultiply(_q);
      }
      const c = this.world.sphereContact(d.obj.position, d.radius, _contact);
      if (c) {
        d.obj.position.addScaledVector(c.normal, c.depth);
        const vn = d.vel.dot(c.normal);
        if (vn < 0) {
          d.vel.addScaledVector(c.normal, -1.35 * vn);
          d.vel.multiplyScalar(0.7);
          d.angVel.multiplyScalar(0.6);
        }
      }
    }
  }

  clear(): void {
    for (const d of this.items) this.scene.remove(d.obj);
    this.items.length = 0;
  }
}

function smokeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(90,90,90,0.9)');
  grad.addColorStop(0.5, 'rgba(70,70,70,0.45)');
  grad.addColorStop(1, 'rgba(60,60,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Puff {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

/** Rauchwolken an durchgebrannten Motoren, Reglern oder einem brennenden Akku. */
export class SmokeSystem {
  private readonly pool: Puff[] = [];
  private readonly active: Puff[] = [];
  private readonly material: THREE.SpriteMaterial;
  private timer = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.material = new THREE.SpriteMaterial({ map: smokeTexture(), transparent: true, depthWrite: false });
  }

  /** Quellen (Weltpositionen) für diesen Frame; der Wind trägt den Rauch weg. */
  update(dt: number, sources: THREE.Vector3[], wind: THREE.Vector3, scale = 1): void {
    this.timer += dt;
    while (this.timer > 0.04 && sources.length) {
      this.timer -= 0.04;
      for (const s of sources) this.spawn(s, scale);
    }
    if (!sources.length) this.timer = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        this.scene.remove(p.sprite);
        this.active.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      p.vel.lerp(wind, Math.min(1, dt * 1.5));
      p.vel.y += 0.8 * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const size = p.size * (0.4 + 2.2 * k);
      p.sprite.scale.set(size, size, size);
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.75 * (1 - k);
    }
  }

  /** Rauchwolke auf einmal (z. B. Explosion). */
  burst(pos: THREE.Vector3, count: number, scale: number): void {
    for (let i = 0; i < count; i++) {
      this.spawn(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)), scale);
      const p = this.active[this.active.length - 1];
      if (p) {
        p.vel.set((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6);
        p.life = 3 + Math.random() * 3;
      }
    }
  }

  private spawn(pos: THREE.Vector3, scale: number): void {
    if (this.active.length > 300) return;
    const p =
      this.pool.pop() ??
      ({
        sprite: new THREE.Sprite(this.material.clone()),
        vel: new THREE.Vector3(),
        age: 0,
        life: 2.5,
        size: 0.3,
      } as Puff);
    p.age = 0;
    p.life = 2 + Math.random() * 1.5;
    p.size = 0.25 * scale * (0.7 + Math.random() * 0.6);
    p.sprite.position.copy(pos);
    p.vel.set((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4);
    this.scene.add(p.sprite);
    this.active.push(p);
  }

  clear(): void {
    for (const p of this.active) {
      this.scene.remove(p.sprite);
      this.pool.push(p);
    }
    this.active.length = 0;
  }
}
