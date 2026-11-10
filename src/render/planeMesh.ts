import * as THREE from 'three';
import type { PlaneConfig } from '../config/planes';

const DEG = Math.PI / 180;

/**
 * Prozedurales Flugzeugmodell aus der Flächendefinition der Physik:
 * Rumpf, Flügel mit V-Form, Leitwerke, bewegliche Ruder, Propeller, Fahrwerk.
 */
export class PlaneMesh {
  readonly root = new THREE.Group();
  /** Scharnier-Gruppen der Ruder, Index = Flächenindex (oder null). */
  private readonly hinges: (THREE.Group | null)[] = [];
  private readonly hingeVertical: boolean[] = [];
  private readonly prop = new THREE.Group();
  private readonly disc: THREE.Mesh;
  private propAngle = 0;

  constructor(cfg: PlaneConfig) {
    const v = cfg.visual;
    const body = new THREE.MeshStandardMaterial({ color: v.color, roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: v.accent, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });

    // Rumpf (spitz zulaufend nach hinten)
    const len = v.fuselageLength;
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(v.fuselageWidth * 0.25, v.fuselageWidth * 0.55, len, 12), body);
    fus.rotation.x = Math.PI / 2;
    fus.position.z = v.fuselageNose + len / 2;
    this.root.add(fus);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(v.fuselageWidth * 0.55, 16, 10), body);
    nose.position.z = v.fuselageNose;
    this.root.add(nose);
    // Kamera/Kabine
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.05), dark);
    cam.position.set(cfg.cameraMount.x, cfg.cameraMount.y - 0.01, cfg.cameraMount.z);
    this.root.add(cam);

    cfg.surfaces.forEach((s) => {
      const thick = Math.max(0.006, s.chord * 0.09);
      const group = new THREE.Group();
      group.position.set(s.position.x, s.position.y, s.position.z + 0.25 * s.chord);
      const side = Math.sign(s.position.x) || 1;
      const mat = s.name.startsWith('wing') ? body : accent;
      if (s.orientation === 'horizontal') {
        group.rotation.z = side * (s.dihedralDeg ?? 0) * DEG;
        group.rotation.x = (s.incidenceDeg ?? 0) * DEG;
        const main = new THREE.Mesh(new THREE.BoxGeometry(s.span, thick, s.chord), mat);
        group.add(main);
        if (s.control) {
          const cf = s.control.chordFraction * s.chord;
          const spanLen = s.span * s.control.spanFraction;
          // Ruder: bei Flügeln außen, sonst mittig
          const outer = s.name.startsWith('wing') && Math.abs(s.position.x) > 0.01;
          const cx = outer ? side * (s.span / 2 - spanLen / 2) : 0;
          // Ruderbereich aus der Hauptfläche "ausschneiden": Hauptfläche kürzen ist aufwendig,
          // daher dunkles Ruder leicht dicker darüberlegen.
          const hinge = new THREE.Group();
          hinge.position.set(cx, 0, s.chord / 2 - cf);
          const flap = new THREE.Mesh(new THREE.BoxGeometry(spanLen, thick * 1.15, cf), accent);
          flap.position.z = cf / 2;
          hinge.add(flap);
          group.add(hinge);
          this.hinges.push(hinge);
        } else {
          this.hinges.push(null);
        }
        this.hingeVertical.push(false);
      } else {
        const main = new THREE.Mesh(new THREE.BoxGeometry(thick, s.span, s.chord), mat);
        group.add(main);
        if (s.control) {
          const cf = s.control.chordFraction * s.chord;
          const hinge = new THREE.Group();
          hinge.position.set(0, 0, s.chord / 2 - cf);
          const flap = new THREE.Mesh(new THREE.BoxGeometry(thick * 1.15, s.span * s.control.spanFraction, cf), body);
          flap.position.z = cf / 2;
          hinge.add(flap);
          group.add(hinge);
          this.hinges.push(hinge);
        } else {
          this.hinges.push(null);
        }
        this.hingeVertical.push(true);
      }
      this.root.add(group);
    });

    // Propeller
    const m = cfg.motor;
    const r = m.propDiameter / 2;
    this.prop.position.set(m.position.x, m.position.y, m.position.z);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
    for (let b = 0; b < 2; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(r * 2 * 0.98, r * 0.12, 0.006), bladeMat);
      blade.rotation.z = b * Math.PI;
      blade.scale.x = 0.5;
      blade.position.x = (b === 0 ? 1 : -1) * r * 0.49;
      this.prop.add(blade);
    }
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 12), accent);
    spinner.rotation.x = m.position.z < 0 ? -Math.PI / 2 : Math.PI / 2;
    this.prop.add(spinner);
    this.root.add(this.prop);
    const discGeom = new THREE.CircleGeometry(r, 32);
    this.disc = new THREE.Mesh(
      discGeom,
      new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.disc.position.copy(this.prop.position);
    this.root.add(this.disc);

    // Fahrwerk
    for (const c of cfg.contactPoints) {
      if (!c.wheel) continue;
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(c.radius, c.radius, 0.015, 16), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(c.position.x, c.position.y, c.position.z);
      this.root.add(wheel);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, Math.abs(c.position.y), 6), dark);
      strut.position.set(c.position.x, c.position.y / 2, c.position.z);
      this.root.add(strut);
    }

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
  }

  /**
   * @param deflections Ruderausschläge (rad) je Fläche
   * @param omega Propellerdrehzahl (rad/s)
   */
  update(deflections: number[], omega: number, spin: number, dt: number): void {
    for (let i = 0; i < this.hinges.length; i++) {
      const h = this.hinges[i];
      if (!h) continue;
      const d = deflections[i] ?? 0;
      if (this.hingeVertical[i]) h.rotation.y = -d;
      else h.rotation.x = d;
    }
    this.propAngle += spin * Math.min(omega, 50) * dt;
    this.prop.rotation.z = this.propAngle;
    const blur = Math.min(1, Math.max(0, (omega - 40) / 300));
    (this.disc.material as THREE.MeshBasicMaterial).opacity = 0.3 * blur;
    this.prop.children.forEach((c, i) => {
      if (i < 2) c.visible = blur < 0.9;
    });
  }
}
