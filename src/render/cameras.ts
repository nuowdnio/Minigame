import * as THREE from 'three';
import type { CollisionWorld, ContactResult } from '../world/collision';

const _contact: ContactResult = { normal: new THREE.Vector3(), depth: 0 };

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _x = new THREE.Vector3(1, 0, 0);

/** Horizontales Sichtfeld (Grad) in vertikales Sichtfeld für Three.js umrechnen. */
export function horizontalToVerticalFov(hFovDeg: number, aspect: number): number {
  const h = THREE.MathUtils.degToRad(hFovDeg);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect));
}

/**
 * FPV-Kamera: fest am Rahmen montiert, um den Kamerawinkel (Uptilt) nach oben geneigt.
 */
export class FpvCameraRig {
  /** Montageposition im Körper-System (m). */
  readonly mount = new THREE.Vector3(0, 0.02, -0.06);

  update(camera: THREE.PerspectiveCamera, pos: THREE.Vector3, q: THREE.Quaternion, uptiltDeg: number): void {
    camera.position.copy(this.mount).applyQuaternion(q).add(pos);
    _q.setFromAxisAngle(_x, THREE.MathUtils.degToRad(uptiltDeg));
    camera.quaternion.copy(q).multiply(_q);
  }
}

/**
 * Verfolger-Kamera für Einsteiger: folgt der Drohne gedämpft von hinten oben,
 * orientiert sich an der Flugrichtung bzw. dem Gierwinkel.
 */
export class ChaseCameraRig {
  private readonly pos = new THREE.Vector3();
  private initialized = false;
  distance = 1.6;
  /** Optional: Welt-Geometrie, damit die Kamera nicht in Wände taucht. */
  world: CollisionWorld | null = null;
  height = 0.55;

  reset(): void {
    this.initialized = false;
  }

  update(
    camera: THREE.PerspectiveCamera,
    dronePos: THREE.Vector3,
    q: THREE.Quaternion,
    velocity: THREE.Vector3,
    dt: number,
  ): void {
    // Blickrichtung: horizontale Nase der Drohne, bei hoher Geschwindigkeit die Flugrichtung
    const fwd = _v.set(0, 0, -1).applyQuaternion(q);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const hv = new THREE.Vector3(velocity.x, 0, velocity.z);
    const speed = hv.length();
    if (speed > 3) {
      hv.normalize();
      fwd.lerp(hv, Math.min(1, (speed - 3) / 10)).normalize();
    }
    const target = new THREE.Vector3()
      .copy(dronePos)
      .addScaledVector(fwd, -this.distance)
      .add(new THREE.Vector3(0, this.height, 0));
    if (!this.initialized) {
      this.pos.copy(target);
      this.initialized = true;
    }
    const k = 1 - Math.exp(-dt * 8);
    this.pos.lerp(target, k);
    // nicht unter den Boden
    this.pos.y = Math.max(this.pos.y, 0.15);
    camera.position.copy(this.pos);
    // nicht in Gebäude/Bäume eintauchen: entlang der Sichtlinie zur Drohne heranziehen
    if (this.world) {
      const look = new THREE.Vector3(dronePos.x, dronePos.y + 0.15, dronePos.z);
      for (let i = 0; i < 12 && this.world.sphereContact(camera.position, 0.25, _contact); i++) {
        camera.position.lerp(look, 0.25);
      }
    }
    camera.lookAt(dronePos.x, dronePos.y + 0.15, dronePos.z);
  }
}
