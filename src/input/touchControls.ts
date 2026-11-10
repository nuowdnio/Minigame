import type { Settings } from '../config/defaults';

/** Aktionen, die über Bildschirm-Buttons ausgelöst werden. */
export type TouchAction = 'menu' | 'reset' | 'toggleView' | 'help' | 'telemetry';

interface StickTouch {
  pointerId: number | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Gaswert beim Aufsetzen des Fingers (Gas wird relativ verstellt). */
  startThrottle: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Ist das Gerät primär ein Touch-Gerät (iPad, Tablet, Smartphone)? */
export function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 1)
  );
}

/**
 * Virtuelle Sticks für Touchscreens.
 *
 * - Bildschirm wird in zwei Hälften geteilt; jede Hälfte ist ein Stick.
 * - Der Stick-Mittelpunkt liegt dort, wo der Daumen aufsetzt (schwebender Stick).
 * - Roll/Nick/Gier federn beim Loslassen auf 0 zurück.
 * - Gas federt NICHT zurück: Daumen hoch/runter ziehen verstellt das Gas relativ,
 *   beim Loslassen bleibt der Wert stehen (wie ein echter Gasstick ohne Feder).
 * - Mode 2: links Gas/Gier, rechts Nicken/Rollen. Mode 1: links Nicken/Gier, rechts Gas/Rollen.
 */
export class TouchControls {
  readonly el: HTMLDivElement;
  throttle = 0;
  yaw = 0;
  pitch = 0;
  roll = 0;
  /** Wurde die Touch-Steuerung schon benutzt (bzw. ist sie aktiv)? */
  active = false;

  private readonly left: StickTouch = { pointerId: null, startX: 0, startY: 0, x: 0, y: 0, startThrottle: 0 };
  private readonly right: StickTouch = { pointerId: null, startX: 0, startY: 0, x: 0, y: 0, startThrottle: 0 };
  private readonly visuals: { base: HTMLDivElement; knob: HTMLDivElement; label: HTMLDivElement }[] = [];
  private readonly throttleBar: HTMLDivElement;
  private readonly throttleFill: HTMLDivElement;
  private readonly buttons: HTMLDivElement;
  private pending = new Set<TouchAction>();

  constructor(
    parent: HTMLElement,
    private settings: Settings,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'touch-layer';
    parent.appendChild(this.el);

    for (let i = 0; i < 2; i++) {
      const base = document.createElement('div');
      base.className = 'touch-base';
      const knob = document.createElement('div');
      knob.className = 'touch-knob';
      const label = document.createElement('div');
      label.className = 'touch-label';
      this.el.append(base, knob, label);
      this.visuals.push({ base, knob, label });
    }

    this.throttleBar = document.createElement('div');
    this.throttleBar.className = 'touch-throttle';
    this.throttleFill = document.createElement('div');
    this.throttleBar.appendChild(this.throttleFill);
    this.el.appendChild(this.throttleBar);

    this.buttons = document.createElement('div');
    this.buttons.className = 'touch-buttons';
    const btn = (action: TouchAction, text: string, title: string) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.pending.add(action);
      });
      this.buttons.appendChild(b);
    };
    btn('menu', '⚙', 'Einstellungen');
    btn('reset', '↺', 'Reset');
    btn('toggleView', '🎥', 'Kamera wechseln');
    btn('telemetry', '📊', 'Telemetrie');
    btn('help', '?', 'Hilfe');
    if (document.fullscreenEnabled || (document as unknown as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled) {
      const b = document.createElement('button');
      b.textContent = '⛶';
      b.title = 'Vollbild';
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleFullscreen();
      });
      this.buttons.appendChild(b);
    }
    parent.appendChild(this.buttons);

    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    this.el.addEventListener('pointermove', (e) => this.onMove(e));
    this.el.addEventListener('pointerup', (e) => this.onUp(e));
    this.el.addEventListener('pointercancel', (e) => this.onUp(e));
    this.el.addEventListener('lostpointercapture', (e) => this.onUp(e));

    this.applySettings(settings);
  }

  /** Sichtbarkeit nach Einstellung (auto: nur auf Touch-Geräten bzw. nach erster Berührung). */
  applySettings(settings: Settings): void {
    this.settings = settings;
    const mode = settings.input.touchControls;
    const show = mode === 'on' || (mode === 'auto' && (isTouchDevice() || this.active));
    this.el.classList.toggle('hidden', !show);
    this.buttons.classList.toggle('hidden', !show);
    if (mode === 'on') this.active = true;
    if (mode === 'off') this.active = false;
    this.render();
  }

  /** Ausgelöste Button-Aktionen abholen (einmalig). */
  takeActions(): Set<TouchAction> {
    const p = this.pending;
    this.pending = new Set();
    return p;
  }

  resetThrottle(): void {
    this.throttle = 0;
    this.render();
  }

  private get radius(): number {
    return this.settings.input.touchStickSize;
  }

  /** Welcher Stick (links/rechts) steuert das Gas? */
  private get throttleIsLeft(): boolean {
    return this.settings.input.stickMode === 2;
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && this.settings.input.touchControls !== 'on') return;
    e.preventDefault();
    const isLeft = e.clientX < window.innerWidth / 2;
    const s = isLeft ? this.left : this.right;
    if (s.pointerId !== null) return;
    this.active = true;
    s.pointerId = e.pointerId;
    s.startX = s.x = e.clientX;
    s.startY = s.y = e.clientY;
    s.startThrottle = this.throttle;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignorieren */
    }
    this.update();
  }

  private onMove(e: PointerEvent): void {
    const s = this.left.pointerId === e.pointerId ? this.left : this.right.pointerId === e.pointerId ? this.right : null;
    if (!s) return;
    e.preventDefault();
    s.x = e.clientX;
    s.y = e.clientY;
    this.update();
  }

  private onUp(e: PointerEvent): void {
    for (const s of [this.left, this.right]) {
      if (s.pointerId === e.pointerId) {
        s.pointerId = null;
      }
    }
    this.update();
  }

  /** Stickwerte aus den Fingerpositionen berechnen. */
  private update(): void {
    const R = this.radius;
    const thrStick = this.throttleIsLeft ? this.left : this.right;
    const pitchStick = this.throttleIsLeft ? this.right : this.left;
    const rollStick = this.right;
    const yawStick = this.left;

    // Gas: relativ, Gesamtweg 0..1 = 4 Radien, bleibt beim Loslassen stehen
    if (thrStick.pointerId !== null) {
      this.throttle = clamp(thrStick.startThrottle - (thrStick.y - thrStick.startY) / (4 * R), 0, 1);
    }
    const axis = (s: StickTouch, d: 'x' | 'y') => {
      if (s.pointerId === null) return 0;
      const v = d === 'x' ? (s.x - s.startX) / R : -(s.y - s.startY) / R;
      return clamp(v, -1, 1);
    };
    this.pitch = axis(pitchStick, 'y');
    this.roll = axis(rollStick, 'x');
    this.yaw = axis(yawStick, 'x');
    this.render();
  }

  private render(): void {
    const R = this.radius;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sticks = [this.left, this.right];
    for (let i = 0; i < 2; i++) {
      const s = sticks[i];
      const v = this.visuals[i];
      const isThrottle = (i === 0) === this.throttleIsLeft;
      let bx: number, by: number, kx: number, ky: number;
      if (s.pointerId !== null) {
        bx = s.startX;
        by = s.startY;
        const dx = s.x - s.startX;
        const dy = s.y - s.startY;
        const len = Math.hypot(dx, dy);
        const k = len > R ? R / len : 1;
        kx = bx + dx * k;
        ky = by + dy * k;
      } else {
        // Ruheposition in den unteren Ecken
        bx = i === 0 ? Math.max(R + 40, w * 0.16) : w - Math.max(R + 40, w * 0.16);
        by = h - Math.max(R + 50, h * 0.25);
        kx = bx;
        ky = by;
      }
      const size = 2 * R;
      v.base.style.width = v.base.style.height = `${size}px`;
      v.base.style.transform = `translate(${bx - R}px, ${by - R}px)`;
      const ks = R * 0.8;
      v.knob.style.width = v.knob.style.height = `${ks}px`;
      v.knob.style.transform = `translate(${kx - ks / 2}px, ${ky - ks / 2}px)`;
      v.base.classList.toggle('active', s.pointerId !== null);
      v.knob.classList.toggle('active', s.pointerId !== null);
      const labels = this.throttleIsLeft ? ['GAS · GIER', 'NICK · ROLL'] : ['NICK · GIER', 'GAS · ROLL'];
      v.label.textContent = labels[i];
      v.label.style.transform = `translate(${bx - 60}px, ${by + R + 8}px)`;
      v.label.style.display = s.pointerId !== null ? 'none' : '';

      if (isThrottle) {
        const barH = Math.min(4 * R, h * 0.5);
        const bxBar = i === 0 ? 12 : w - 12 - 14;
        this.throttleBar.style.height = `${barH}px`;
        this.throttleBar.style.transform = `translate(${bxBar}px, ${h / 2 - barH / 2}px)`;
        this.throttleFill.style.height = `${this.throttle * 100}%`;
      }
    }
  }

  /** Bei Größenänderung des Fensters neu zeichnen. */
  layout(): void {
    this.render();
  }
}

function toggleFullscreen(): void {
  const d = document as Document & {
    webkitFullscreenElement?: Element;
    webkitExitFullscreen?: () => void;
  };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement || d.webkitFullscreenElement) {
    if (document.exitFullscreen) void document.exitFullscreen();
    else d.webkitExitFullscreen?.();
  } else if (el.requestFullscreen) {
    void el.requestFullscreen().catch(() => undefined);
  } else {
    el.webkitRequestFullscreen?.();
  }
}
