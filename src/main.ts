import * as THREE from 'three';
import './style.css';
import { PHYSICS } from './config/physics';
import type { Settings } from './config/defaults';
import { createCalmEnvironment } from './env/environment';
import { Simulation } from './game/simulation';
import { loadSettings, saveSettings } from './game/storage';
import { InputManager } from './input/input';
import { ChaseCameraRig, FpvCameraRig, horizontalToVerticalFov } from './render/cameras';
import { DroneMesh } from './render/droneMesh';
import { Osd } from './ui/osd';
import { SettingsMenu } from './ui/settingsMenu';
import { TelemetryPanel } from './ui/telemetryPanel';
import { buildTestArena } from './world/testArena';

let settings: Settings = loadSettings();

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
const arena = buildTestArena(scene, true);
const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.02, 3000);

const drone = new DroneMesh(PHYSICS.frame.motors, PHYSICS.motor.propDiameter);
scene.add(drone.root);

// --- Simulation -------------------------------------------------------------
const env = createCalmEnvironment(arena.collision);
const sim = new Simulation(env, settings);
sim.reset(new THREE.Vector3(0, 0.05, 0), 0);

const input = new InputManager(settings);
const fpvRig = new FpvCameraRig();
const chaseRig = new ChaseCameraRig();

// --- UI ---------------------------------------------------------------------
const ui = document.getElementById('ui')!;
const osd = new Osd(ui);
const telemetry = new TelemetryPanel(ui);
const help = document.getElementById('help')!;
let paused = false;

const menu = new SettingsMenu(
  ui,
  settings,
  (s) => {
    settings = s;
    saveSettings(settings);
    sim.applySettings(settings);
    input.setSettings(settings);
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
}

function resetDrone(): void {
  sim.reset();
  chaseRig.reset();
  input.resetKeyboardThrottle();
}

function updateCameraProjection(): void {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.fov = settings.camera.view === 'fpv' ? horizontalToVerticalFov(settings.camera.fov, aspect) : 70;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateCameraProjection();
});

// --- Hauptschleife ----------------------------------------------------------
const renderPos = new THREE.Vector3();
const renderQuat = new THREE.Quaternion();
const omegas: number[] = [0, 0, 0, 0];
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

  if (!paused) {
    accumulator += dt;
    const h = sim.dt;
    while (accumulator >= h) {
      sim.step(input.sticks);
      accumulator -= h;
    }
  }

  // Interpolation zwischen den letzten beiden Physikzuständen
  const alpha = paused ? 1 : accumulator / sim.dt;
  const body = sim.quad.body;
  renderPos.lerpVectors(sim.prevPosition, body.position, alpha);
  renderQuat.slerpQuaternions(sim.prevOrientation, body.orientation, alpha);
  drone.root.position.copy(renderPos);
  drone.root.quaternion.copy(renderQuat);
  for (let i = 0; i < omegas.length; i++) omegas[i] = sim.quad.motors[i].omega;
  drone.updateProps(omegas, paused ? 0 : dt);

  updateCameraProjection();
  if (settings.camera.view === 'fpv') {
    drone.root.visible = false;
    fpvRig.update(camera, renderPos, renderQuat, settings.camera.angle);
  } else {
    drone.root.visible = true;
    chaseRig.update(camera, renderPos, renderQuat, body.velocity, dt);
  }

  // Schatten folgt der Drohne
  arena.sun.target.position.copy(renderPos);
  arena.sun.position.copy(renderPos).addScaledVector(arena.sunDirection, 100);

  osd.update(sim, input.sticks.throttle, dt);
  const info = input.source === 'keyboard' ? 'Tastatur' : `${input.source === 'rc' ? 'RC-Sender' : 'Gamepad'}: ${input.gamepadName}`;
  telemetry.update(sim, input.sticks, info, dt);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Für Konsolen-Tuning
(window as unknown as Record<string, unknown>).sim = sim;
