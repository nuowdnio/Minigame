import * as THREE from 'three';
import type { MotorLayoutEntry } from '../config/physics';

/**
 * Prozedurales 5"-Quad-Modell: Carbon-Rahmen, Motoren, Propeller (mit Blur-Scheibe bei hoher Drehzahl),
 * Akku und Kamera.
 */
export class DroneMesh {
  readonly root = new THREE.Group();
  private readonly props: THREE.Group[] = [];
  private readonly blurDiscs: THREE.Mesh[] = [];
  private readonly angles: number[];

  constructor(
    private readonly motors: MotorLayoutEntry[],
    propDiameter: number,
  ) {
    this.angles = motors.map(() => Math.random() * Math.PI * 2);
    const carbon = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.55, metalness: 0.2 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.35, metalness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.5 });

    // Mittelplatte
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.006, 0.12), carbon);
    this.root.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.004, 0.1), carbon);
    top.position.y = 0.03;
    this.root.add(top);
    // Abstandshalter
    for (const [x, z] of [
      [0.017, 0.045],
      [-0.017, 0.045],
      [0.017, -0.045],
      [-0.017, -0.045],
    ]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.03, 6), accent);
      s.position.set(x, 0.015, z);
      this.root.add(s);
    }
    // Akku
    const battery = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.03, 0.075),
      new THREE.MeshStandardMaterial({ color: 0x2a62c9, roughness: 0.6 }),
    );
    battery.position.set(0, 0.048, 0.008);
    this.root.add(battery);
    // Kamera
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), carbon);
    cam.position.set(0, 0.015, -0.055);
    this.root.add(cam);
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.007, 0.008, 12),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.9 }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.015, -0.067);
    this.root.add(lens);

    const r = propDiameter / 2;
    const bladeGeom = new THREE.BoxGeometry(r * 2, 0.002, 0.012);
    const discGeom = new THREE.CircleGeometry(r, 32);
    discGeom.rotateX(-Math.PI / 2);

    for (const m of motors) {
      const p = new THREE.Vector3(m.position.x, m.position.y, m.position.z);
      // Arm
      const len = Math.hypot(p.x, p.z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.005, len), carbon);
      arm.position.set(p.x / 2, 0, p.z / 2);
      arm.rotation.y = Math.atan2(p.x, p.z);
      this.root.add(arm);
      // Motor
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.016, 16), metal);
      bell.position.set(p.x, 0.01, p.z);
      this.root.add(bell);
      // Propeller
      const propGroup = new THREE.Group();
      propGroup.position.set(p.x, 0.021, p.z);
      const propColor = m.position.z < 0 ? 0xff7a2a : 0x22c1ff;
      const propMat = new THREE.MeshStandardMaterial({ color: propColor, roughness: 0.4, transparent: true, opacity: 0.95 });
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(bladeGeom, propMat);
        blade.scale.x = 0.5;
        blade.position.x = (r / 2) * Math.cos((b * 2 * Math.PI) / 3);
        blade.position.z = -(r / 2) * Math.sin((b * 2 * Math.PI) / 3);
        blade.rotation.y = (b * 2 * Math.PI) / 3;
        propGroup.add(blade);
      }
      this.root.add(propGroup);
      this.props.push(propGroup);
      const disc = new THREE.Mesh(
        discGeom,
        new THREE.MeshBasicMaterial({ color: propColor, transparent: true, opacity: 0, depthWrite: false }),
      );
      disc.position.copy(propGroup.position);
      this.root.add(disc);
      this.blurDiscs.push(disc);
    }

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
  }

  /**
   * Propeller-Animation aktualisieren.
   * @param omegas Drehzahlen (rad/s)
   */
  updateProps(omegas: number[], dt: number): void {
    for (let i = 0; i < this.props.length; i++) {
      const w = omegas[i] ?? 0;
      // Visuelle Drehung begrenzen (Stroboskop-Effekt vermeiden)
      const visual = Math.min(w, 60);
      this.angles[i] += -this.motors[i].spin * visual * dt;
      this.props[i].rotation.y = this.angles[i];
      const blur = Math.min(1, Math.max(0, (w - 40) / 400));
      (this.blurDiscs[i].material as THREE.MeshBasicMaterial).opacity = 0.35 * blur;
      this.props[i].visible = blur < 0.9;
    }
  }
}
