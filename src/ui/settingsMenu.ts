import { DEFAULT_SETTINGS, type AxisRates, type Settings } from '../config/defaults';
import { betaflightRate, maxRate } from '../fc/rates';
import { VEHICLES, vehicleInfo } from '../vehicles/registry';
import { airState } from '../env/atmosphere';

type Axis = 'roll' | 'pitch' | 'yaw';
const AXES: Axis[] = ['roll', 'pitch', 'yaw'];
const AXIS_LABEL: Record<Axis, string> = { roll: 'Roll', pitch: 'Pitch', yaw: 'Yaw' };
const AXIS_COLOR: Record<Axis, string> = { roll: '#ff6b6b', pitch: '#51cf66', yaw: '#4dabf7' };

/**
 * Einstellungsmenü (Pause): Rates mit Kurvenvorschau, Gaskurve, Kamera, Steuerung, Grafik.
 */
export class SettingsMenu {
  readonly el: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private settings: Settings;

  constructor(
    parent: HTMLElement,
    initial: Settings,
    private readonly onChange: (s: Settings) => void,
    private readonly onClose: () => void,
  ) {
    this.settings = structuredClone(initial);
    this.el = document.createElement('div');
    this.el.className = 'menu hidden';
    parent.appendChild(this.el);
    this.render();
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  show(settings: Settings): void {
    this.settings = structuredClone(settings);
    this.render();
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  private emit(): void {
    this.onChange(structuredClone(this.settings));
    this.drawCurves();
    this.showAir();
    for (const a of AXES) {
      const e = this.el.querySelector<HTMLElement>(`[data-max="${a}"]`);
      if (e) e.textContent = `${Math.round(maxRate(this.settings.rates[a]))}°/s`;
    }
  }

  private render(): void {
    const s = this.settings;
    const rateRow = (a: Axis) => {
      const r = s.rates[a];
      const num = (k: keyof AxisRates, min: number, max: number, step: number) =>
        `<input type="number" data-rate="${a}.${k}" min="${min}" max="${max}" step="${step}" value="${r[k]}">`;
      return `<tr><td style="color:${AXIS_COLOR[a]}">${AXIS_LABEL[a]}</td>
        <td>${num('rcRate', 0.01, 2.55, 0.01)}</td><td>${num('superRate', 0, 0.99, 0.01)}</td>
        <td>${num('expo', 0, 1, 0.01)}</td><td data-max="${a}">${Math.round(maxRate(r))}°/s</td></tr>`;
    };
    this.el.innerHTML = `
      <div class="menu-panel">
        <h1>Einstellungen</h1>
        <section>
          <h2>Fluggerät</h2>
          <label>Modell <select data-k="vehicle">
            <optgroup label="Drohnen">
              ${VEHICLES.filter((v) => v.kind === 'quad').map((v) => `<option value="${v.id}" ${s.vehicle === v.id ? 'selected' : ''}>${v.name}</option>`).join('')}
            </optgroup>
            <optgroup label="Flugzeuge">
              ${VEHICLES.filter((v) => v.kind === 'plane').map((v) => `<option value="${v.id}" ${s.vehicle === v.id ? 'selected' : ''}>${v.name}</option>`).join('')}
            </optgroup>
          </select></label>
          <p class="hint" data-desc>${vehicleInfo(s.vehicle).description}</p>
          <label>Flugmodus Drohne <select data-k="flightMode">
            <option value="acro" ${s.flightMode === 'acro' ? 'selected' : ''}>Acro (keine Selbststabilisierung)</option>
            <option value="horizon" ${s.flightMode === 'horizon' ? 'selected' : ''}>Horizon (stabilisiert, Flips möglich)</option>
            <option value="angle" ${s.flightMode === 'angle' ? 'selected' : ''}>Angle (richtet sich selbst auf)</option>
          </select></label>
          <label>Flugmodus Flugzeug <select data-k="planeMode">
            <option value="manual" ${s.planeMode === 'manual' ? 'selected' : ''}>Manuell (direkt auf die Ruder)</option>
            <option value="gyro" ${s.planeMode === 'gyro' ? 'selected' : ''}>Stabilisiert (Kreisel dämpft)</option>
            <option value="angle" ${s.planeMode === 'angle' ? 'selected' : ''}>Angle (richtet sich selbst auf)</option>
          </select></label>
        </section>
        <section>
          <h2>Welt & Schäden</h2>
          <label>Welt <select data-k="world">
            <option value="town" ${s.world === 'town' ? 'selected' : ''}>Kleinstadt mit Flugplatz</option>
            <option value="testfield" ${s.world === 'testfield' ? 'selected' : ''}>Testgelände</option>
          </select></label>
          <label>Schadensmodell <select data-k="damage">
            <option value="realistic" ${s.damage === 'realistic' ? 'selected' : ''}>Realistisch</option>
            <option value="robust" ${s.damage === 'robust' ? 'selected' : ''}>Robust (hält mehr aus)</option>
            <option value="off" ${s.damage === 'off' ? 'selected' : ''}>Aus (unzerstörbar)</option>
          </select></label>
        </section>
        <section>
          <h2>Umwelt</h2>
          <label>Wind (m/s in 10 m) <input type="range" data-k="environment.windSpeed" min="0" max="15" step="0.5" value="${s.environment.windSpeed}"><output></output></label>
          <label>Windrichtung (°, aus) <input type="range" data-k="environment.windDirection" min="0" max="359" step="1" value="${s.environment.windDirection}"><output></output></label>
          <label>Böigkeit <input type="range" data-k="environment.turbulence" min="0" max="2" step="0.1" value="${s.environment.turbulence}"><output></output></label>
          <label>Thermik (m/s) <input type="range" data-k="environment.thermalStrength" min="0" max="4" step="0.1" value="${s.environment.thermalStrength}"><output></output></label>
          <label>Temperatur (°C) <input type="range" data-k="environment.temperature" min="-15" max="40" step="1" value="${s.environment.temperature}"><output></output></label>
          <label>Luftfeuchte <input type="range" data-k="environment.humidity" min="0" max="1" step="0.05" value="${s.environment.humidity}"><output></output></label>
          <label>Höhe über NN (m) <input type="range" data-k="environment.altitude" min="0" max="4500" step="50" value="${s.environment.altitude}"><output></output></label>
          <label>Luftdruck QNH (hPa) <input type="range" data-k="environment.pressure" min="950" max="1050" step="1" value="${s.environment.pressure}"><output></output></label>
          <p class="hint" data-air></p>
        </section>
        <section>
          <h2>Rates (Betaflight, Drohnen)</h2>
          <div class="rates-wrap">
            <table class="rates">
              <tr><th></th><th>RC Rate</th><th>Super Rate</th><th>Expo</th><th>Max</th></tr>
              ${AXES.map(rateRow).join('')}
            </table>
            <canvas width="220" height="160" class="rate-canvas"></canvas>
          </div>
          <label>Gas-Mitte <input type="range" data-k="rates.throttleMid" min="0" max="1" step="0.01" value="${s.rates.throttleMid}"><output></output></label>
          <label>Gas-Expo <input type="range" data-k="rates.throttleExpo" min="0" max="1" step="0.01" value="${s.rates.throttleExpo}"><output></output></label>
        </section>
        <section>
          <h2>Kamera</h2>
          <label>Kamerawinkel <input type="range" data-k="camera.angle" min="0" max="50" step="1" value="${s.camera.angle}"><output></output></label>
          <label>Sichtfeld (FOV) <input type="range" data-k="camera.fov" min="60" max="150" step="1" value="${s.camera.fov}"><output></output></label>
          <label>Ansicht <select data-k="camera.view">
            <option value="fpv" ${s.camera.view === 'fpv' ? 'selected' : ''}>FPV</option>
            <option value="chase" ${s.camera.view === 'chase' ? 'selected' : ''}>Third Person</option>
          </select></label>
        </section>
        <section>
          <h2>Steuerung</h2>
          <label>Stick-Mode <select data-k="input.stickMode" data-num>
            <option value="2" ${s.input.stickMode === 2 ? 'selected' : ''}>Mode 2 (Gas links)</option>
            <option value="1" ${s.input.stickMode === 1 ? 'selected' : ''}>Mode 1 (Gas rechts)</option>
          </select></label>
          <label>Totzone Gamepad <input type="range" data-k="input.deadband" min="0" max="0.2" step="0.01" value="${s.input.deadband}"><output></output></label>
          <label>Touch-Sticks <select data-k="input.touchControls">
            <option value="auto" ${s.input.touchControls === 'auto' ? 'selected' : ''}>Automatisch (Tablet)</option>
            <option value="on" ${s.input.touchControls === 'on' ? 'selected' : ''}>Immer an</option>
            <option value="off" ${s.input.touchControls === 'off' ? 'selected' : ''}>Aus</option>
          </select></label>
          <label>Touch-Stickgröße <input type="range" data-k="input.touchStickSize" min="45" max="130" step="1" value="${s.input.touchStickSize}"><output></output></label>
        </section>
        <section>
          <h2>Grafik</h2>
          <label>Qualität <select data-k="graphics.quality">
            ${['low', 'medium', 'high'].map((q) => `<option value="${q}" ${s.graphics.quality === q ? 'selected' : ''}>${{ low: 'Niedrig', medium: 'Mittel', high: 'Hoch' }[q]}</option>`).join('')}
          </select></label>
        </section>
        <div class="menu-buttons">
          <button data-act="defaults">Standardwerte</button>
          <button data-act="close" class="primary">Weiter fliegen</button>
        </div>
      </div>`;

    this.canvas = this.el.querySelector('canvas')!;

    this.el.querySelectorAll<HTMLInputElement>('input[data-rate]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const [a, k] = inp.dataset.rate!.split('.') as [Axis, keyof AxisRates];
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;
        this.settings.rates[a][k] = Math.max(parseFloat(inp.min), Math.min(parseFloat(inp.max), v));
        this.emit();
      });
    });

    this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => {
      const out = inp.nextElementSibling as HTMLOutputElement | null;
      const showValue = () => {
        if (out && out.tagName === 'OUTPUT') out.textContent = inp.value;
      };
      showValue();
      inp.addEventListener('input', () => {
        const path = inp.dataset.k!.split('.');
        let obj: Record<string, unknown> = this.settings as unknown as Record<string, unknown>;
        for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]] as Record<string, unknown>;
        const key = path[path.length - 1];
        const isNum = inp.type === 'range' || inp.hasAttribute('data-num');
        obj[key] = isNum ? parseFloat(inp.value) : inp.value;
        showValue();
        if (key === 'vehicle') {
          const d = this.el.querySelector<HTMLElement>('[data-desc]');
          if (d) d.textContent = vehicleInfo(inp.value).description;
        }
        this.emit();
      });
    });

    this.el.querySelector('[data-act="defaults"]')!.addEventListener('click', () => {
      this.settings = structuredClone(DEFAULT_SETTINGS);
      this.render();
      this.emit();
    });
    this.el.querySelector('[data-act="close"]')!.addEventListener('click', () => this.onClose());
    this.drawCurves();
    this.showAir();
  }

  /** Luftdichte-Vorschau für die eingestellte Umwelt. */
  private showAir(): void {
    const e = this.el.querySelector<HTMLElement>('[data-air]');
    if (!e) return;
    const env = this.settings.environment;
    const a = airState(env.altitude, {
      seaLevelPressureHpa: env.pressure,
      groundTemperatureC: env.temperature,
      relativeHumidity: env.humidity,
      groundAltitude: env.altitude,
    });
    e.textContent = `Luftdichte ${a.density.toFixed(3)} kg/m³ (${((a.density / 1.225) * 100).toFixed(0)} % von Normal) · Druck ${(a.pressurePa / 100).toFixed(0)} hPa`;
  }

  private drawCurves(): void {
    const c = this.canvas;
    const g = c.getContext('2d');
    if (!g) return;
    const w = c.width,
      h = c.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, w, h);
    const top = Math.max(200, ...AXES.map((a) => maxRate(this.settings.rates[a])));
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.font = '10px monospace';
    for (let d = 0; d <= top; d += 200) {
      const y = h - (d / top) * (h - 10);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.fillText(`${d}`, 2, y - 2);
    }
    for (const a of AXES) {
      g.strokeStyle = AXIS_COLOR[a];
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i <= 100; i++) {
        const x = i / 100;
        const r = betaflightRate(x, this.settings.rates[a]);
        const px = x * w;
        const py = h - (r / top) * (h - 10);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
  }
}
