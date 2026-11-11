import * as THREE from 'three';
import type { DebrisSystem, SmokeSystem } from './effects';

function fireTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,220,1)');
  grad.addColorStop(0.25, 'rgba(255,200,80,0.9)');
  grad.addColorStop(0.6, 'rgba(255,90,20,0.45)');
  grad.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Flame {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

/** Flammen (additiv geblendete Sprites) für Explosionen und brennende Wracks. */
export class FireSystem {
  private readonly pool: Flame[] = [];
  private readonly active: Flame[] = [];
  private readonly material: THREE.SpriteMaterial;
  private timer = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.material = new THREE.SpriteMaterial({
      map: fireTexture(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
  }

  burst(pos: THREE.Vector3, count: number, speed: number, size: number): void {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      this.spawn(pos, dir.multiplyScalar(speed * (0.3 + Math.random() * 0.7)), size * (0.6 + Math.random() * 0.8), 0.5 + Math.random() * 0.6);
    }
  }

  /** Dauerfeuer an den Quellen (z. B. brennende Autos). */
  update(dt: number, sources: THREE.Vector3[], wind: THREE.Vector3): void {
    this.timer += dt;
    while (this.timer > 0.05) {
      this.timer -= 0.05;
      for (const s of sources) {
        const p = s.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 0.8));
        this.spawn(p, new THREE.Vector3(0, 1.5 + Math.random(), 0), 1 + Math.random() * 0.8, 0.6 + Math.random() * 0.5);
      }
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) {
        this.scene.remove(f.sprite);
        this.active.splice(i, 1);
        this.pool.push(f);
        continue;
      }
      f.vel.multiplyScalar(1 - 2.5 * dt);
      f.vel.y += 2.5 * dt;
      f.vel.addScaledVector(wind, dt * 0.8);
      f.sprite.position.addScaledVector(f.vel, dt);
      const s = f.size * (0.6 + 0.8 * k);
      f.sprite.scale.set(s, s, s);
      (f.sprite.material as THREE.SpriteMaterial).opacity = 1 - k;
    }
  }

  private spawn(pos: THREE.Vector3, vel: THREE.Vector3, size: number, life: number): void {
    if (this.active.length > 400) return;
    const f =
      this.pool.pop() ?? { sprite: new THREE.Sprite(this.material.clone()), vel: new THREE.Vector3(), age: 0, life: 1, size: 1 };
    f.sprite.position.copy(pos);
    f.vel.copy(vel);
    f.age = 0;
    f.life = life;
    f.size = size;
    this.scene.add(f.sprite);
    this.active.push(f);
  }

  clear(): void {
    for (const f of this.active) {
      this.scene.remove(f.sprite);
      this.pool.push(f);
    }
    this.active.length = 0;
  }
}

interface Blast {
  fireball: THREE.Mesh;
  ring: THREE.Mesh;
  light: THREE.PointLight;
  age: number;
  radius: number;
}

/**
 * Explosion: Lichtblitz, Feuerball, Druckwelle am Boden, Brandfleck, Funken/Splitter,
 * Rauchsäule. Liefert eine Kamera-Erschütterung abhängig von der Entfernung.
 */
export class ExplosionFx {
  private readonly blasts: Blast[] = [];
  private readonly scorches: THREE.Mesh[] = [];
  private readonly fireballMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, depthWrite: false });
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  private readonly scorchMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 1,
    transparent: true,
    opacity: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    polygonOffsetUnits: -5,
  });
  private readonly chunkMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
  /** Aktuelle Erschütterung (0..1). */
  shake = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly fire: FireSystem,
    private readonly smoke: SmokeSystem,
    private readonly debris: DebrisSystem,
  ) {}

  explode(pos: THREE.Vector3, radius: number, camera: THREE.Vector3): void {
    const fireball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.fireballMat.clone());
    fireball.position.copy(pos);
    this.scene.add(fireball);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), this.ringMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.08, pos.z);
    this.scene.add(ring);
    const light = new THREE.PointLight(0xffa040, 4000, radius * 8, 2);
    light.position.copy(pos).add(new THREE.Vector3(0, 1, 0));
    this.scene.add(light);
    this.blasts.push({ fireball, ring, light, age: 0, radius });

    // Brandfleck
    if (pos.y < 3) {
      const scorch = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.45, 24), this.scorchMat);
      scorch.rotation.x = -Math.PI / 2;
      scorch.position.set(pos.x, 0.06, pos.z);
      this.scene.add(scorch);
      this.scorches.push(scorch);
    }
    this.fire.burst(pos, 70, 14, 2.2);
    this.smoke.burst(pos, 40, 3);
    // Splitter
    for (let i = 0; i < 16; i++) {
      const chunk = new THREE.Mesh(new THREE.BoxGeometry(0.08 + Math.random() * 0.2, 0.05 + Math.random() * 0.1, 0.08 + Math.random() * 0.2), this.chunkMat);
      chunk.position.copy(pos);
      chunk.castShadow = true;
      this.scene.add(chunk);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(8 + Math.random() * 14);
      this.debris.add(chunk, v, 0);
    }
    const dist = camera.distanceTo(pos);
    this.shake = Math.max(this.shake, Math.min(1, (radius * 4) / Math.max(1, dist)));
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 1.2);
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.age += dt;
      const t = b.age;
      // Feuerball wächst schnell, wird dunkler und verblasst
      const fs = b.radius * 0.55 * Math.min(1, t / 0.18) * (1 + 0.3 * t);
      b.fireball.scale.setScalar(Math.max(0.01, fs));
      const fm = b.fireball.material as THREE.MeshBasicMaterial;
      fm.opacity = Math.max(0, 1 - t / 0.9);
      fm.color.setHSL(0.09 - Math.min(0.08, t * 0.08), 1, Math.max(0.15, 0.65 - t * 0.5));
      b.fireball.position.y += dt * 2;
      // Druckwelle am Boden
      const rs = b.radius * 2.2 * Math.min(1, t / 0.35);
      b.ring.scale.setScalar(Math.max(0.01, rs));
      (b.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - t * 2.2);
      b.light.intensity = 4000 * Math.max(0, 1 - t / 0.35) ** 2;
      if (t > 1.2) {
        this.scene.remove(b.fireball, b.ring, b.light);
        b.fireball.geometry.dispose();
        this.blasts.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const b of this.blasts) this.scene.remove(b.fireball, b.ring, b.light);
    this.blasts.length = 0;
    for (const s of this.scorches) this.scene.remove(s);
    this.scorches.length = 0;
    this.shake = 0;
  }
}
