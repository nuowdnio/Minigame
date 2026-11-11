import * as THREE from 'three';

export interface CarSpec {
  x: number;
  z: number;
  yaw: number;
  color: number;
}

interface Wreck {
  group: THREE.Group;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  landed: boolean;
  burnTime: number;
  firePoint: THREE.Vector3;
}

const _m = new THREE.Matrix4();
const _car = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Lokale Bauteile eines Autos: Geometrie, Lage, Material-Index. */
const PARTS = {
  body: { geom: () => new THREE.BoxGeometry(4.2, 0.75, 1.75), pos: [0, 0.65, 0] },
  cabin: { geom: () => new THREE.BoxGeometry(2.2, 0.62, 1.6), pos: [-0.2, 1.33, 0] },
  roof: { geom: () => new THREE.BoxGeometry(2.0, 0.06, 1.55), pos: [-0.2, 1.66, 0] },
  light: { geom: () => new THREE.BoxGeometry(0.04, 0.12, 1.3), pos: [2.11, 0.75, 0] },
} as const;
const WHEELS: [number, number][] = [
  [1.35, 0.8],
  [1.35, -0.8],
  [-1.35, 0.8],
  [-1.35, -0.8],
];

/**
 * Alle geparkten Autos der Stadt als instanzierte Meshes (wenige Draw Calls).
 * Ein zerstörtes Auto wird ausgeblendet und durch ein ausgebranntes Wrack ersetzt,
 * das von der Explosion hochgeschleudert wird und danach brennt.
 */
export class CarFleet {
  private readonly meshes: { key: keyof typeof PARTS | 'wheel'; mesh: THREE.InstancedMesh; local: THREE.Matrix4[] }[] = [];
  private readonly destroyedSet = new Set<number>();
  private readonly wrecks: Wreck[] = [];
  private readonly wreckMats = {
    body: new THREE.MeshStandardMaterial({ color: 0x24201d, roughness: 1 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x5a3622, roughness: 1 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 1 }),
  };

  constructor(
    private readonly scene: THREE.Scene,
    readonly specs: CarSpec[],
    shadows: boolean,
  ) {
    const n = specs.length;
    const paint = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.2 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x22303a, roughness: 0.1, metalness: 0.3 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const light = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff6d8, emissiveIntensity: 0.6 });
    const add = (key: keyof typeof PARTS | 'wheel', geom: THREE.BufferGeometry, mat: THREE.Material, locals: THREE.Matrix4[], colored: boolean) => {
      const mesh = new THREE.InstancedMesh(geom, mat, n * locals.length);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      specs.forEach((c, i) => {
        carMatrix(c, _car);
        locals.forEach((l, k) => {
          mesh.setMatrixAt(i * locals.length + k, _m.multiplyMatrices(_car, l));
          if (colored) mesh.setColorAt(i * locals.length + k, new THREE.Color(c.color));
        });
      });
      this.scene.add(mesh);
      this.meshes.push({ key, mesh, local: locals });
    };
    const at = (p: readonly number[]) => [new THREE.Matrix4().makeTranslation(p[0], p[1], p[2])];
    add('body', PARTS.body.geom(), paint, at(PARTS.body.pos), true);
    add('cabin', PARTS.cabin.geom(), glass, at(PARTS.cabin.pos), false);
    add('roof', PARTS.roof.geom(), paint, at(PARTS.roof.pos), true);
    add('light', PARTS.light.geom(), light, at(PARTS.light.pos), false);
    const wheelGeom = new THREE.CylinderGeometry(0.33, 0.33, 0.25, 12);
    wheelGeom.rotateX(Math.PI / 2);
    add(
      'wheel',
      wheelGeom,
      tire,
      WHEELS.map(([x, z]) => new THREE.Matrix4().makeTranslation(x, 0.33, z)),
      false,
    );
  }

  get count(): number {
    return this.specs.length;
  }

  isDestroyed(id: number): boolean {
    return this.destroyedSet.has(id);
  }

  center(id: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = this.specs[id];
    return out.set(c.x, 0.85, c.z);
  }

  /**
   * Alle Autos im Wirkradius zerstören.
   * @returns Kennungen der neu zerstörten Autos
   */
  destroyNear(center: THREE.Vector3, radius: number, directId: number | null): number[] {
    const hit: number[] = [];
    const tmp = new THREE.Vector3();
    this.specs.forEach((_, id) => {
      if (this.destroyedSet.has(id)) return;
      const d = this.center(id, tmp).distanceTo(center);
      if (id === directId || d < radius) {
        this.destroy(id, center, Math.max(0, 1 - d / radius));
        hit.push(id);
      }
    });
    return hit;
  }

  /** Einzelnes Auto zerstören: ausblenden, Wrack erzeugen, hochschleudern. */
  destroy(id: number, blast: THREE.Vector3, strength: number): void {
    this.destroyedSet.add(id);
    for (const m of this.meshes) {
      for (let k = 0; k < m.local.length; k++) m.mesh.setMatrixAt(id * m.local.length + k, ZERO);
      m.mesh.instanceMatrix.needsUpdate = true;
    }
    const c = this.specs[id];
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.65, 1.75), this.wreckMats.body);
    body.position.set(0, 0.6, 0);
    body.rotation.z = (Math.random() - 0.5) * 0.15;
    g.add(body);
    // Kabine ohne Scheiben: nur Rahmen, Dach eingedrückt
    for (const [x, z] of [
      [0.85, 0.75],
      [0.85, -0.75],
      [-1.25, 0.75],
      [-1.25, -0.75],
    ]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), this.wreckMats.frame);
      post.position.set(x, 1.2, z);
      g.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 1.5), this.wreckMats.rust);
    roof.position.set(-0.2, 1.42, 0);
    roof.rotation.set((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3);
    g.add(roof);
    // nur noch zwei bis drei Räder
    WHEELS.forEach(([x, z]) => {
      if (Math.random() < 0.35) return;
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 10), this.wreckMats.tire);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.3, z);
      g.add(w);
    });
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    g.position.set(c.x, 0, c.z);
    g.rotation.y = c.yaw;
    this.scene.add(g);
    // Explosionsimpuls: vom Zentrum weg und nach oben
    const away = new THREE.Vector3(c.x - blast.x, 0, c.z - blast.z);
    if (away.lengthSq() < 1e-4) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    away.normalize().multiplyScalar(1.5 + 3 * strength);
    this.wrecks.push({
      group: g,
      vel: new THREE.Vector3(away.x, 3 + 7 * strength, away.z),
      spin: new THREE.Vector3((Math.random() - 0.5) * 3 * strength, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3 * strength),
      landed: false,
      burnTime: 40 + Math.random() * 20,
      firePoint: new THREE.Vector3(),
    });
  }

  /** Wracks bewegen (Wurfparabel, Aufsetzen) und Brandherde liefern. */
  update(dt: number, fireOut: THREE.Vector3[]): THREE.Vector3[] {
    fireOut.length = 0;
    for (const w of this.wrecks) {
      if (!w.landed) {
        w.vel.y -= 9.81 * dt;
        w.group.position.addScaledVector(w.vel, dt);
        const s = w.spin.length();
        if (s > 1e-4) {
          _q.setFromAxisAngle(w.spin.clone().divideScalar(s), s * dt);
          w.group.quaternion.premultiply(_q);
        }
        if (w.group.position.y <= 0 && w.vel.y < 0) {
          w.group.position.y = 0;
          // aufsetzen: Lage auf leichte Schräglage zurücksetzen, Gierwinkel behalten
          const e = new THREE.Euler().setFromQuaternion(w.group.quaternion, 'YXZ');
          w.group.quaternion.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.12, e.y, (Math.random() - 0.5) * 0.12, 'YXZ'));
          if (Math.abs(e.x) > 1.6 || Math.abs(e.z) > 1.6) {
            // auf dem Dach gelandet
            w.group.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
            w.group.position.y = 1.6;
          }
          w.landed = true;
        }
      }
      if (w.burnTime > 0) {
        w.burnTime -= dt;
        w.firePoint.set(0.6, 1.0, 0).applyQuaternion(w.group.quaternion).add(w.group.position);
        fireOut.push(w.firePoint);
      }
    }
    return fireOut;
  }

  /** Wracks entfernen und alle Autos wiederherstellen. */
  restore(): void {
    for (const w of this.wrecks) this.scene.remove(w.group);
    this.wrecks.length = 0;
    for (const id of this.destroyedSet) {
      carMatrix(this.specs[id], _car);
      for (const m of this.meshes) {
        m.local.forEach((l, k) => m.mesh.setMatrixAt(id * m.local.length + k, _m.multiplyMatrices(_car, l)));
        m.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.destroyedSet.clear();
  }
}

function carMatrix(c: CarSpec, out: THREE.Matrix4): THREE.Matrix4 {
  _q.setFromAxisAngle(_up, c.yaw);
  return out.compose(new THREE.Vector3(c.x, 0, c.z), _q, new THREE.Vector3(1, 1, 1));
}
