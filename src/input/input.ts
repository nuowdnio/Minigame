import type { Settings } from '../config/defaults';
import type { Sticks } from '../fc/flightController';
import type { TouchControls } from './touchControls';

/** Einmal-Aktionen (flankengesteuert). */
export interface InputActions {
  reset: boolean;
  toggleView: boolean;
  menu: boolean;
  help: boolean;
  telemetry: boolean;
}

export type InputSource = 'keyboard' | 'gamepad' | 'rc' | 'touch';

/**
 * Achsen-Zuordnung eines Joysticks. axis = Index in gamepad.axes.
 * Für Meilenstein 1 fest vorgegeben; Kalibrierung und freie Zuordnung folgen.
 */
interface AxisMap {
  throttle: { axis: number; invert: boolean };
  yaw: { axis: number; invert: boolean };
  pitch: { axis: number; invert: boolean };
  roll: { axis: number; invert: boolean };
}

/** Standard-Gamepad (Xbox/PS): Achsen 0/1 = linker Stick, 2/3 = rechter Stick (Y nach unten positiv). */
function gamepadMap(mode: 1 | 2): AxisMap {
  return mode === 2
    ? {
        throttle: { axis: 1, invert: true },
        yaw: { axis: 0, invert: false },
        pitch: { axis: 3, invert: true },
        roll: { axis: 2, invert: false },
      }
    : {
        throttle: { axis: 3, invert: true },
        yaw: { axis: 0, invert: false },
        pitch: { axis: 1, invert: true },
        roll: { axis: 2, invert: false },
      };
}

/** RC-Sender als USB-Joystick (EdgeTX/OpenTX Standard AETR). */
const RC_MAP: AxisMap = {
  roll: { axis: 0, invert: false },
  pitch: { axis: 1, invert: false },
  throttle: { axis: 2, invert: false },
  yaw: { axis: 3, invert: false },
};

function applyDeadband(v: number, db: number): number {
  const a = Math.abs(v);
  if (a <= db) return 0;
  return (Math.sign(v) * (a - db)) / (1 - db);
}

export class InputManager {
  readonly sticks: Sticks = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
  readonly actions: InputActions = { reset: false, toggleView: false, menu: false, help: false, telemetry: false };
  source: InputSource = 'keyboard';
  gamepadName = '';

  private keys = new Set<string>();
  private pressedOnce = new Set<string>();
  private kbThrottle = 0;
  private kb = { roll: 0, pitch: 0, yaw: 0 };
  private prevButtons: boolean[] = [];
  /** Optionale Bildschirm-Sticks (iPad/Tablet). */
  touch: TouchControls | null = null;

  constructor(private settings: Settings) {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((tag === 'INPUT' || tag === 'SELECT') && e.code !== 'Escape') return;
      if (!this.keys.has(e.code)) this.pressedOnce.add(e.code);
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
  }

  /** Eingaben einmal pro Frame abfragen. */
  poll(dt: number): void {
    const a = this.actions;
    a.reset = this.consume('KeyR');
    a.toggleView = this.consume('KeyC');
    a.menu = this.consume('Escape');
    a.help = this.consume('KeyH');
    a.telemetry = this.consume('KeyT');

    if (this.touch) {
      for (const act of this.touch.takeActions()) a[act] = true;
    }

    const pad = this.findGamepad();
    if (pad) {
      this.readGamepad(pad);
    } else if (this.touch?.active && this.settings.input.touchControls !== 'off') {
      this.readTouch(this.touch);
    } else {
      this.readKeyboard(dt);
    }
    this.pressedOnce.clear();
  }

  private consume(code: string): boolean {
    return this.pressedOnce.has(code);
  }

  private findGamepad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) {
      if (p && p.connected && p.axes.length >= 4) return p;
    }
    return null;
  }

  private readGamepad(pad: Gamepad): void {
    const isStandard = pad.mapping === 'standard';
    this.source = isStandard ? 'gamepad' : 'rc';
    this.gamepadName = pad.id;
    const map = isStandard ? gamepadMap(this.settings.input.stickMode) : RC_MAP;
    const db = isStandard ? this.settings.input.deadband : 0;
    const read = (m: { axis: number; invert: boolean }) => {
      const v = pad.axes[m.axis] ?? 0;
      return m.invert ? -v : v;
    };
    // Gas: Stick unten (−1) = 0, oben (+1) = 1
    this.sticks.throttle = Math.max(0, Math.min(1, (read(map.throttle) + 1) / 2));
    this.sticks.yaw = applyDeadband(read(map.yaw), db);
    this.sticks.pitch = applyDeadband(read(map.pitch), db);
    this.sticks.roll = applyDeadband(read(map.roll), db);

    const btn = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => !!btn[i] && !this.prevButtons[i];
    if (isStandard) {
      if (edge(9) || edge(3)) this.actions.reset = true; // Start / Y
      if (edge(8) || edge(2)) this.actions.toggleView = true; // Select / X
    } else {
      if (edge(0)) this.actions.reset = true;
      if (edge(1)) this.actions.toggleView = true;
    }
    this.prevButtons = btn;
  }

  private readTouch(t: TouchControls): void {
    this.source = 'touch';
    this.sticks.throttle = t.throttle;
    this.sticks.roll = t.roll;
    this.sticks.pitch = t.pitch;
    this.sticks.yaw = t.yaw;
  }

  private readKeyboard(dt: number): void {
    this.source = 'keyboard';
    const k = this.keys;
    // Gas wird mit W/S verstellt und gehalten
    if (k.has('KeyW')) this.kbThrottle += 0.7 * dt;
    if (k.has('KeyS')) this.kbThrottle -= 0.7 * dt;
    if (k.has('Space')) this.kbThrottle = 0;
    this.kbThrottle = Math.max(0, Math.min(1, this.kbThrottle));

    const ramp = (cur: number, target: number) => {
      const rate = target === 0 ? 8 : 4;
      const d = target - cur;
      const step = rate * dt;
      return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
    };
    const amp = k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0.6;
    const axis = (neg: string, pos: string) => ((k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0)) * amp;
    this.kb.roll = ramp(this.kb.roll, axis('ArrowLeft', 'ArrowRight'));
    this.kb.pitch = ramp(this.kb.pitch, axis('ArrowDown', 'ArrowUp'));
    this.kb.yaw = ramp(this.kb.yaw, axis('KeyA', 'KeyD'));

    this.sticks.throttle = this.kbThrottle;
    this.sticks.roll = this.kb.roll;
    this.sticks.pitch = this.kb.pitch;
    this.sticks.yaw = this.kb.yaw;
  }

  /** Tastatur-Gas zurücksetzen (z. B. nach Reset). */
  resetKeyboardThrottle(): void {
    this.kbThrottle = 0;
    this.touch?.resetThrottle();
  }
}
