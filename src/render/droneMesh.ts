import * as THREE from 'three';
import type { QuadPreset } from '../config/quads';

/**
 * Prozedurales Multicopter-Modell, skaliert nach Motorabstand und Propellergröße:
 * Carbon-Rahmen, Motoren, Propeller (mit Blur-Scheibe bei hoher Drehzahl),
 * optional Ducts (Whoop/Cinewhoop), Akku und Kamera.
 */
export class DroneMesh {
  readonly root = new THREE.Group();
  private readonly props: THREE.Group[] = [];
  private readonly blurDiscs: THREE.Mesh[] = [];
  private readonly angles: number[];
  private readonly spins: number[];
  /** Gruppe je Motor (Arm, Motor, Propeller, Duct) – kann abbrechen. */
  private readonly motorGroups: THREE.Group[] = [];
  private battery!: THREE.Mesh;
  private camBlock!: THREE.Mesh;
  /** Motorpositionen (Körper) für Rauch. */
  readonly motorPositions: THREE.Vector3[] = [];

  constructor(preset: QuadPreset) {
    const motors = preset.physics.frame.motors;
    const vis = preset.visual;
    this.spins = motors.map((m) => m.spin);
    this.angles = motors.map(() => Math.random() * Math.PI * 2);
    const arm = Math.max(...motors.map((m) => Math.hypot(m.position.x, m.position.z)));
    const s = arm / 0.11; // Skalierung relativ zum 5"-Rahmen (Diagonale 0.11 m)
    const carbon = new THREE.MeshStandardMaterial({ color: vis.frameColor, roughness: 0.55, metalness: 0.2 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.35, metalness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.5 });

    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, d * s), mat);
      m.position.set(x * s, y * s, z * s);
      this.root.add(m);
      return m;
    };
    box(0.045, 0.006, 0.12, carbon, 0, 0, 0);
    box(0.04, 0.004, 0.1, carbon, 0, 0.03, 0);
    for (const [x, z] of [
      [0.017, 0.045],
      [-0.017, 0.045],
      [0.017, -0.045],
      [-0.017, -0.045],
    ]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.0025 * s, 0.0025 * s, 0.03 * s, 6), accent);
      st.position.set(x * s, 0.015 * s, z * s);
      this.root.add(st);
    }
    this.battery = box(0.035, 0.03, 0.075, new THREE.MeshStandardMaterial({ color: vis.batteryColor, roughness: 0.6 }), 0, 0.048, 0.008);
    this.camBlock = box(0.02, 0.02, 0.02, carbon, 0, 0.015, -0.055);
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006 * s, 0.007 * s, 0.008 * s, 12),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.9 }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.015 * s, -0.067 * s);
    this.root.add(lens);

    // Nutzlast (Sprengladung) unter dem Rahmen
    if (vis.payload) {
      const can = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.16, 16),
        new THREE.MeshStandardMaterial({ color: 0xb71c1c, roughness: 0.6 }),
      );
      can.rotation.x = Math.PI / 2;
      can.position.set(0, -0.06, -0.03);
      this.root.add(can);
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.036, 0.036, 0.03, 16),
        new THREE.MeshStandardMaterial({ color: 0xffd600, roughness: 0.6 }),
      );
      stripe.rotation.x = Math.PI / 2;
      stripe.position.set(0, -0.06, -0.03);
      this.root.add(stripe);
      for (const x of [-0.03, 0.03]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.012), carbon);
        strap.position.set(x, -0.03, -0.03);
        this.root.add(strap);
      }
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
      led.position.set(0, -0.06, -0.115);
      this.root.add(led);
    }

    const r = preset.physics.motor.propDiameter / 2;
    const bladeGeom = new THREE.BoxGeometry(r * 2, Math.max(0.0008, 0.002 * s), Math.max(0.004, 0.012 * (r / 0.0635)));
    const discGeom = new THREE.CircleGeometry(r, 32);
    discGeom.rotateX(-Math.PI / 2);
    const ductMat = new THREE.MeshStandardMaterial({ color: vis.frameColor, roughness: 0.6, side: THREE.DoubleSide });

    for (const m of motors) {
      const p = new THREE.Vector3(m.position.x, m.position.y, m.position.z);
      this.motorPositions.push(p.clone().setY(0.01 * s));
      const mg = new THREE.Group();
      this.root.add(mg);
      this.motorGroups.push(mg);
      const len = Math.hypot(p.x, p.z);
      const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.014 * s, 0.005 * s, len), carbon);
      armMesh.position.set(p.x / 2, 0, p.z / 2);
      armMesh.rotation.y = Math.atan2(p.x, p.z);
      mg.add(armMesh);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.016 * s, 16), metal);
      bell.position.set(p.x, 0.01 * s, p.z);
      mg.add(bell);

      const propGroup = new THREE.Group();
      propGroup.position.set(p.x, 0.021 * s, p.z);
      const propColor = m.position.z < 0 ? vis.propColorFront : vis.propColorRear;
      const propMat = new THREE.MeshStandardMaterial({ color: propColor, roughness: 0.4 });
      const blades = vis.ducts ? 4 : 3;
      for (let b = 0; b < blades; b++) {
        const a = (b * 2 * Math.PI) / blades;
        const blade = new THREE.Mesh(bladeGeom, propMat);
        blade.scale.x = 0.5;
        blade.position.set((r / 2) * Math.cos(a), 0, -(r / 2) * Math.sin(a));
        blade.rotation.y = a;
        propGroup.add(blade);
      }
      mg.add(propGroup);
      this.props.push(propGroup);
      const disc = new THREE.Mesh(
        discGeom,
        new THREE.MeshBasicMaterial({ color: propColor, transparent: true, opacity: 0, depthWrite: false }),
      );
      disc.position.copy(propGroup.position);
      mg.add(disc);
      this.blurDiscs.push(disc);

      if (vis.ducts) {
        const duct = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.08, r * 1.08, r * 0.55, 32, 1, true), ductMat);
        duct.position.set(p.x, 0.021 * s, p.z);
        mg.add(duct);
      }
    }

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
  }

  /**
   * Teil abtrennen (für Trümmer): 'prop0'..'prop3', 'arm0'..'arm3', 'frame'.
   * Gibt die abgetrennten Objekte zurück (noch im Modell eingehängt, Weltlage gültig).
   */
  detach(part: string): THREE.Object3D[] {
    const idx = Number(part.slice(-1));
    if (part.startsWith('prop') && this.props[idx]) {
      this.blurDiscs[idx].visible = false;
      const prop = this.props[idx];
      this.props[idx] = new THREE.Group(); // Platzhalter, dreht ins Leere
      return [prop];
    }
    if (part.startsWith('arm') && this.motorGroups[idx]) return [this.motorGroups[idx]];
    if (part === 'frame') return [this.battery, this.camBlock];
    return [];
  }

  /** Propeller-Animation aktualisieren (Drehzahlen in rad/s). */
  updateProps(omegas: number[], dt: number): void {
    for (let i = 0; i < this.props.length; i++) {
      const w = omegas[i] ?? 0;
      const visual = Math.min(w, 60);
      this.angles[i] += -this.spins[i] * visual * dt;
      this.props[i].rotation.y = this.angles[i];
      const blur = Math.min(1, Math.max(0, (w - 40) / 400));
      (this.blurDiscs[i].material as THREE.MeshBasicMaterial).opacity = 0.35 * blur;
      this.props[i].visible = blur < 0.9;
    }
  }
}
