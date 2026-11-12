import * as THREE from 'three';
import './style.css';
import type { Settings } from './config/defaults';
import { WorldEnvironment } from './env/environment';
import { Simulation } from './game/simulation';
import { hasSavedSettings, loadSettings, saveSettings } from './game/storage';
import { InputManager } from './input/input';
import { TouchControls, isTouchDevice } from './input/touchControls';
import { ChaseCameraRig, FpvCameraRig, horizontalToVerticalFov } from './render/cameras';
import { createVehicleView, type VehicleView } from './render/vehicleView';
import { WindParticles, Windsock } from './render/windVisuals';
import { Osd } from './ui/osd';
import { SettingsMenu } from './ui/settingsMenu';
import { TelemetryPanel } from './ui/telemetryPanel';
import { buildTestArena } from './world/testArena';
import { buildTown } from './world/town';
import { DebrisSystem, SmokeSystem } from './render/effects';
import { ExplosionFx, FireSystem } from './render/explosion';
import { SignalLostOverlay } from './ui/signalLost';
import { MISSIONS, MilitaryGame } from './game/missions';
import { StickDelay } from './game/radio';
import { LAYER_HOT, MilitaryView, setLayer } from './render/military';
import { ThermalRenderer } from './render/thermal';
import { MissionHud } from './ui/missionHud';
import { townMilitaryLayout } from './world/military';

let settings: Settings = loadSettings();
// Tablets: beim ersten Start mittlere Grafikqualität (Akku/Wärme)
if (!hasSavedSettings() && isTouchDevice()) settings.graphics.quality = 'medium';

// --- Renderer / Szene -------------------------------------------------------
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

function applyGraphics(): void {
  const q = settings.graphics.quality;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.25 : 0.75));
  renderer.shadowMap.enabled = q !== 'low';
  renderer.setSize(window.innerWidth, window.innerHeight);
}
applyGraphics();

const scene = new THREE.Scene();
const arena = settings.world === 'testfield' ? buildTestArena(scene, true) : buildTown(scene, true);
const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.08, 5000);

// --- Simulation -------------------------------------------------------------
// Mission mit vorgegebenem Fluggerät (z. B. Abfangjagd) auch direkt beim Start berücksichtigen
const missionVehicle = settings.world === 'town' ? MISSIONS.find((m) => m.id === settings.mode)?.vehicle : null;
if (missionVehicle && settings.vehicle !== missionVehicle) {
  settings.vehicle = missionVehicle;
  saveSettings(settings);
}
const env = new WorldEnvironment(arena.collision, settings.environment, arena.collision.windObstacles());
const sim = new Simulation(env, settings);
let view: VehicleView = createVehicleView(sim.vehicle);
setLayer(view.root, LAYER_HOT);
scene.add(view.root);

// Militärischer Spielteil (nur in der Kleinstadt): Missionen, Störsender, Flugabwehr
const game =
  settings.world === 'town'
    ? new MilitaryGame(townMilitaryLayout(), arena.collision, {
        message: (t, sev) => osd.message(t, sev),
        effect: (kind, pos) => {
          if (kind === 'convoyHit') fx.explode(pos.clone().setY(1.5), 5, camera.position);
          if (kind === 'enemyDown') {
            fire.burst(pos, 18, 6, 1.4);
            smoke.burst(pos, 10, 1.5);
          }
          if (kind === 'crateLanded') smoke.burst(pos.clone(), 4, 0.8);
        },
      })
    : null;
const militaryView = game ? new MilitaryView(scene, game) : null;
const stickDelay = new StickDelay();
let zoomIdx = 0;

function spawnPoint(): THREE.Vector3 {
  const m = game?.spawn();
  if (m) return m.position;
  return sim.vehicle.kind === 'plane' ? arena.spawns.plane : arena.spawns.quad;
}
function spawnYaw(): number {
  const m = game?.spawn();
  if (m) return m.yaw;
  return sim.vehicle.kind === 'plane' ? arena.spawns.planeYaw : arena.spawns.quadYaw;
}
if (game) {
  game.mode = settings.mode;
  game.threatsInFree = settings.threats === 'on';
}
sim.reset(spawnPoint(), spawnYaw());

// Trümmer und Rauch
const debris = new DebrisSystem(scene, arena.collision);
const smoke = new SmokeSystem(scene);
const smokeSources: THREE.Vector3[] = [];
// Explosionen, Feuer und brennende Autowracks
const fire = new FireSystem(scene);
const fx = new ExplosionFx(scene, fire, smoke, debris);
const wreckSmoke = new SmokeSystem(scene);
const carFires: THREE.Vector3[] = [];
const wreckSmokeSources: THREE.Vector3[] = [];
const windHere = new THREE.Vector3();

/** Modell neu aufbauen (nach Reset sind abgebrochene Teile wieder dran). */
function rebuildView(): void {
  scene.remove(view.root);
  view = createVehicleView(sim.vehicle);
  setLayer(view.root, LAYER_HOT);
  scene.add(view.root);
  debris.clear();
  smoke.clear();
  fx.clear();
  fire.clear();
  wreckSmoke.clear();
  arena.cars?.restore();
}

/** Fluggerät wechseln: Physik und Modell neu aufbauen. */
function switchVehicle(id: string): void {
  sim.setVehicle(id, settings);
  // komplett zurücksetzen – auch eine laufende Mission startet mit dem neuen Fluggerät neu
  resetDrone();
}

// Wind sichtbar machen
const particles = new WindParticles();
scene.add(particles.points);
const socks = arena.windsocks.map((p) => {
  const w = new Windsock(p);
  scene.add(w.root);
  return w;
});

const input = new InputManager(settings);
const fpvRig = new FpvCameraRig();
const chaseRig = new ChaseCameraRig();
chaseRig.world = arena.collision;

// --- UI ---------------------------------------------------------------------
const ui = document.getElementById('ui')!;
const osd = new Osd(ui);
const telemetry = new TelemetryPanel(ui);
const signalLost = new SignalLostOverlay(ui);
const missionHud = new MissionHud(ui);
const thermal = new ThermalRenderer(renderer, arena.sky ?? null);
const help = document.getElementById('help')!;
help.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  help.classList.add('hidden');
});
if (isTouchDevice()) document.body.classList.add('is-touch');
const touch = new TouchControls(ui, settings);
input.touch = touch;
let paused = false;
let modeDirty = false;

/** Modus/Mission anwenden: ggf. vorgegebenes Fluggerät, Startpunkt, Missionszustand. */
function applyMode(): void {
  if (!game) return;
  game.mode = settings.mode;
  game.threatsInFree = settings.threats === 'on';
  const req = game.requiredVehicle();
  if (req && sim.vehicle.id !== req) {
    settings.vehicle = req;
    saveSettings(settings);
    sim.setVehicle(req, settings);
  }
  resetDrone();
}

const menu = new SettingsMenu(
  ui,
  settings,
  (s) => {
    const vehicleChanged = s.vehicle !== settings.vehicle;
    // Missionen gibt es nur in der Kleinstadt
    if (s.mode !== 'free' && s.world !== 'town') s.world = 'town';
    const worldChanged = s.world !== settings.world;
    if (s.mode !== settings.mode || s.threats !== settings.threats) modeDirty = true;
    settings = s;
    saveSettings(settings);
    if (worldChanged) {
      location.reload();
      return;
    }
    env.update(settings.environment);
    if (vehicleChanged) switchVehicle(settings.vehicle);
    sim.applySettings(settings);
    input.setSettings(settings);
    touch.applySettings(settings);
    applyGraphics();
  },
  () => closeMenu(),
);

function openMenu(): void {
  paused = true;
  menu.show(settings);
}
function closeMenu(): void {
  paused = false;
  menu.hide();
  if (modeDirty) {
    modeDirty = false;
    applyMode();
  }
}

function resetDrone(): void {
  sim.reset(spawnPoint(), spawnYaw());
  rebuildView();
  chaseRig.reset();
  input.resetKeyboardThrottle();
  stickDelay.reset();
  zoomIdx = 0;
  if (game) {
    game.reset(spawnPoint());
    militaryView?.syncEnemies();
  }
}

function updateCameraProjection(): void {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  const zoom = sim.vehicle.zoomLevels[zoomIdx] ?? 1;
  const base = settings.camera.view === 'fpv' ? horizontalToVerticalFov(settings.camera.fov, aspect) : 70;
  // Zoom verkleinert das Sichtfeld (Brennweite ×zoom)
  camera.fov = (2 * Math.atan(Math.tan((base * Math.PI) / 360) / zoom) * 180) / Math.PI;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateCameraProjection();
  touch.layout();
});

// iOS Safari: Pinch-Zoom und Doppeltipp-Zoom unterbinden
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener(
  'touchmove',
  (e) => {
    if (!(e.target as HTMLElement).closest('.menu-panel')) e.preventDefault();
  },
  { passive: false },
);
// Beim Wechsel in den Hintergrund pausieren, damit die Drohne nicht unkontrolliert weiterfliegt
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !menu.open) openMenu();
});

// --- Hauptschleife ----------------------------------------------------------
const renderPos = new THREE.Vector3();
const renderQuat = new THREE.Quaternion();
let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  input.poll(dt);
  const a = input.actions;
  if (a.menu) {
    if (menu.open) closeMenu();
    else openMenu();
  }
  if (a.help) help.classList.toggle('hidden');
  if (a.telemetry) telemetry.toggle();
  if (a.reset) resetDrone();
  if (a.toggleView) {
    settings.camera.view = settings.camera.view === 'fpv' ? 'chase' : 'fpv';
    saveSettings(settings);
    chaseRig.reset();
  }
  if (a.zoom) zoomIdx = (zoomIdx + 1) % sim.vehicle.zoomLevels.length;
  if (a.thermal) {
    thermal.enabled = !thermal.enabled;
    renderer.domElement.classList.toggle('thermal', thermal.enabled);
  }
  const canDrop = !!sim.vehicle.cargoAttached;
  if (a.action && !paused) {
    const drop = canDrop ? sim.vehicle.dropCargo?.() : null;
    if (drop) game?.addCrate(drop);
    else if (game && game.mode === 'convoy') {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const msg = game.report(camera.position, dir, sim.vehicle.zoomLevels[zoomIdx] ?? 1);
      if (msg) osd.message(msg, msg.includes('gemeldet') ? 'info' : 'warn');
    }
  }
  touch.setActionButton(canDrop ? '📦' : game?.mode === 'convoy' ? '📡' : null);

  if (!paused) {
    accumulator += dt;
    const h = sim.dt;
    // Funkverbindung: Steuerbefehle kommen verzögert an, bei Verbindungsverlust Failsafe
    const sticks = game ? stickDelay.process(now / 1000, input.sticks, game.radio.latency, game.radio.lost) : input.sticks;
    while (accumulator >= h) {
      sim.step(sticks);
      accumulator -= h;
    }
    if (game) {
      game.update(dt, sim.vehicle);
      militaryView!.update(dt, camera.position);
    }
  }

  // Interpolation zwischen den letzten beiden Physikzuständen
  const alpha = paused ? 1 : accumulator / sim.dt;
  const vehicle = sim.vehicle;
  const body = vehicle.body;
  renderPos.lerpVectors(sim.prevPosition, body.position, alpha);
  renderQuat.slerpQuaternions(sim.prevOrientation, body.orientation, alpha);
  view.root.position.copy(renderPos);
  view.root.quaternion.copy(renderQuat);
  view.update(vehicle, paused ? 0 : dt);
  view.root.updateMatrixWorld(true);

  // Schäden: abgebrochene Teile werden zu Trümmern, Meldungen ins OSD
  for (const part of view.takeDetached(vehicle)) debris.add(part, vehicle.body.velocity, 2.5);
  for (const ev of vehicle.damage.takeEvents()) osd.message(ev.text, ev.severity);
  // Explosion der Nutzlast: Effekte, Autos im Wirkradius zerstören, Drohne zerrissen
  for (const ex of vehicle.damage.takeExplosions()) {
    fx.explode(ex.position, ex.radius, camera.position);
    for (const part of view.takeDetached(vehicle)) debris.add(part, new THREE.Vector3(), 12);
    const cars = arena.cars?.destroyNear(ex.position, ex.radius, ex.carId) ?? [];
    if (cars.length) osd.message(cars.length === 1 ? 'Auto zerstört' : `${cars.length} Autos zerstört`, 'critical');
  }
  if (!paused) {
    debris.update(dt);
    env.wind(renderPos, sim.time, windHere);
    smoke.update(dt, view.smokeSources(vehicle, smokeSources), windHere, Math.max(0.6, vehicle.size * 2));
    arena.cars?.update(dt, carFires);
    militaryView?.fireSources(carFires);
    fire.update(dt, carFires, windHere);
    wreckSmokeSources.length = 0;
    for (const f of carFires) wreckSmokeSources.push(f.clone().setY(f.y + 1.2));
    wreckSmoke.update(dt, wreckSmokeSources, windHere, 4);
    fx.update(dt);
  }

  updateCameraProjection();
  if (settings.camera.view === 'fpv') {
    view.root.visible = false;
    fpvRig.mount.copy(vehicle.cameraMount);
    fpvRig.update(camera, renderPos, renderQuat, vehicle.cameraTilt(settings));
  } else {
    view.root.visible = !vehicle.damage.vaporized;
    chaseRig.distance = Math.max(1.2, vehicle.size * 2.4);
    chaseRig.height = 0.3 + vehicle.size * 0.6;
    chaseRig.update(camera, renderPos, renderQuat, body.velocity, dt);
  }
  // Erschütterung durch Explosionen
  if (fx.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * fx.shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * fx.shake * 0.5;
    camera.position.z += (Math.random() - 0.5) * fx.shake * 0.5;
  }
  // FPV-Video: Rauschen bei schwachem Signal, Abbruch bei Verbindungsverlust oder Zerstörung
  const fpv = settings.camera.view === 'fpv';
  const radioNoise = game ? game.radio.noise : 0;
  const lostVideo = vehicle.damage.vaporized || (game?.radio.lost ?? false);
  signalLost.set(fpv ? radioNoise : 0, fpv && lostVideo, vehicle.damage.vaporized ? 'Reset: R / ↺' : 'Failsafe – Verbindung wird gesucht …');
  signalLost.update();
  renderer.domElement.style.transform = fpv && radioNoise > 0.4 && !lostVideo ? `translateX(${((Math.random() - 0.5) * radioNoise * 10).toFixed(1)}px)` : '';

  if (!paused) {
    particles.update(env, sim.time, camera.position, dt);
    for (const w of socks) w.update(env, sim.time, dt);
  }

  // Schatten folgt der Drohne
  arena.sun.target.position.copy(renderPos);
  arena.sun.position.copy(renderPos).addScaledVector(arena.sunDirection, 100);

  osd.update(sim, input.sticks.throttle, dt);
  const info = input.source === 'keyboard' ? 'Tastatur' : `${input.source === 'rc' ? 'RC-Sender' : 'Gamepad'}: ${input.gamepadName}`;
  telemetry.update(sim, input.sticks, info, dt);
  if (game) {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(renderQuat);
    missionHud.update(dt, game, renderPos, Math.atan2(-f.x, -f.z), sim.vehicle.zoomLevels[zoomIdx] ?? 1, thermal.enabled);
  }

  thermal.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Für Konsolen-Tuning
(window as unknown as Record<string, unknown>).sim = sim;
(window as unknown as Record<string, unknown>).arena = arena;
(window as unknown as Record<string, unknown>).game = game;
if (game) {
  game.reset(spawnPoint());
  militaryView?.syncEnemies();
}
