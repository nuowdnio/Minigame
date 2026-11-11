import * as THREE from 'three';
import { LAYER_FX, LAYER_HOT } from './military';

/**
 * Wärmebildkamera ("white hot"): Die Welt wird einheitlich kühl-grau gerendert (Formen über die
 * Beleuchtung erkennbar), warme Objekte – Motoren, Fahrzeuge, Stellungen, Brände – leuchten weiß.
 * Drei Durchgänge: kalte Welt, warme Objekte, Effekte (Feuer, Leuchtspur).
 */
export class ThermalRenderer {
  enabled = false;
  private readonly cold = new THREE.MeshLambertMaterial({ color: 0x4a4a4a, emissive: 0x1c1c1c });
  private readonly hot = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly bg = new THREE.Color(0x262626);

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly sky: THREE.Object3D | null,
  ) {}

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    if (!this.enabled) {
      camera.layers.enableAll();
      r.render(scene, camera);
      return;
    }
    const prevBg = scene.background;
    const fog = scene.fog as THREE.Fog | null;
    const fogColor = fog ? fog.color.clone() : null;
    const fogFar = fog ? fog.far : 0;
    // Kein farbiger Szenenhintergrund: der würde bei jedem Durchgang das Bild löschen
    scene.background = null;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(this.bg, 1);
    if (fog) {
      fog.color.set(0x303030);
      fog.far = Math.min(fogFar, 1400);
    }
    if (this.sky) this.sky.visible = false;
    const shadows = r.shadowMap.enabled;
    r.shadowMap.enabled = false;

    // Instanz-Farben (Bäume, Autos) würden das einheitliche Grau einfärben -> kurz abschalten
    const stashed: [THREE.InstancedMesh, THREE.InstancedBufferAttribute][] = [];
    scene.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh && im.instanceColor) {
        stashed.push([im, im.instanceColor]);
        im.instanceColor = null;
      }
    });
    camera.layers.set(0);
    scene.overrideMaterial = this.cold;
    r.render(scene, camera);
    for (const [im, c] of stashed) im.instanceColor = c;
    r.autoClear = false;
    camera.layers.set(LAYER_HOT);
    scene.overrideMaterial = this.hot;
    r.render(scene, camera);
    camera.layers.set(LAYER_FX);
    scene.overrideMaterial = null;
    r.render(scene, camera);

    r.autoClear = true;
    r.setClearColor(prevClear, prevAlpha);
    r.shadowMap.enabled = shadows;
    camera.layers.enableAll();
    scene.background = prevBg;
    if (fog && fogColor) {
      fog.color.copy(fogColor);
      fog.far = fogFar;
    }
    if (this.sky) this.sky.visible = true;
  }
}
