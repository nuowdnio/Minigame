import type { Simulation } from '../game/simulation';

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Betaflight-ähnliches On-Screen-Display als HTML-Overlay.
 */
export class Osd {
  readonly el: HTMLDivElement;
  private readonly f: Record<string, HTMLElement> = {};
  private acc = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'osd';
    this.el.innerHTML = `
      <div class="osd-tl"><span data-f="volt"></span> <span data-f="cell" class="dim"></span><br><span data-f="amp"></span> <span data-f="mah" class="dim"></span></div>
      <div class="osd-tr"><span data-f="mode"></span><br><span data-f="time"></span></div>
      <div class="osd-bl"><span data-f="speed"></span><br><span data-f="alt"></span></div>
      <div class="osd-br"><span data-f="thr"></span></div>
      <div class="osd-tc"><span data-f="lap"></span></div>
      <div class="osd-center"><span data-f="warn" class="warn"></span></div>
      <div class="osd-cross">-+-</div>
    `;
    this.el.querySelectorAll<HTMLElement>('[data-f]').forEach((e) => (this.f[e.dataset.f!] = e));
    parent.appendChild(this.el);
  }

  set visible(v: boolean) {
    this.el.style.display = v ? '' : 'none';
  }

  update(sim: Simulation, throttle: number, dt: number): void {
    this.acc += dt;
    if (this.acc < 1 / 20) return; // OSD mit ~20 Hz aktualisieren, wie echtes Analog-OSD
    this.acc = 0;
    const q = sim.quad;
    const bat = q.battery;
    const v = q.telemetry.voltage;
    const cell = v / bat.params.cells;
    const f = this.f;
    f.volt.textContent = `⚡${v.toFixed(1)}V`;
    f.cell.textContent = `${cell.toFixed(2)}`;
    f.amp.textContent = `${q.telemetry.current.toFixed(1)}A`;
    f.mah.textContent = `${Math.round(bat.usedMah)}mAh`;
    f.mode.textContent = sim.fc.armed ? sim.fc.mode.toUpperCase() : 'DISARMED';
    f.time.textContent = `⏱ ${fmtTime(sim.flightTime)}`;
    const speed = q.body.velocity.length() * 3.6;
    f.speed.textContent = `${Math.round(speed)} KM/H`;
    f.alt.textContent = `ALT ${q.body.position.y.toFixed(1)}M`;
    f.thr.textContent = `THR ${Math.round(throttle * 100)}%`;

    let warn = '';
    if (!sim.fc.armed) warn = 'GAS RUNTER ZUM SCHARFSCHALTEN';
    else if (cell < 3.3) warn = 'LAND NOW';
    else if (cell < 3.5) warn = 'LOW BATTERY';
    f.warn.textContent = warn;
    f.volt.classList.toggle('blink', cell < 3.5);
  }

  setLap(text: string): void {
    this.f.lap.textContent = text;
  }
}
