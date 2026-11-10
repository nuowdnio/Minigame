import type { Sticks } from '../fc/flightController';
import type { Simulation } from '../game/simulation';

/** Debug-Anzeige für das Tuning der Physik (Taste T). */
export class TelemetryPanel {
  readonly el: HTMLPreElement;
  private acc = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.className = 'telemetry hidden';
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.el.classList.toggle('hidden');
  }

  update(sim: Simulation, sticks: Sticks, inputInfo: string, dt: number): void {
    if (this.el.classList.contains('hidden')) return;
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const q = sim.quad;
    const fc = sim.fc;
    const g = fc.filteredGyro;
    const sp = fc.setpoint;
    const m = q.motors.map((mo) => ((mo.omega / q.omegaRef) * 100).toFixed(0).padStart(3)).join(' ');
    const rpm = q.motors.map((mo) => Math.round((mo.omega * 60) / (2 * Math.PI) / 100) * 100).join(' ');
    const pid = (k: 'roll' | 'pitch' | 'yaw') => {
      const l = fc.pids[k].last;
      return `${k.padEnd(5)} sp ${sp[k].toFixed(0).padStart(5)} gyro ${g[k].toFixed(0).padStart(5)}  P ${l.p.toFixed(0).padStart(4)} I ${l.i.toFixed(0).padStart(4)} D ${l.d.toFixed(0).padStart(4)} FF ${l.ff.toFixed(0).padStart(4)}`;
    };
    const v = q.body.velocity;
    this.el.textContent = [
      `Eingabe: ${inputInfo}`,
      `Sticks  T ${sticks.throttle.toFixed(2)} R ${sticks.roll.toFixed(2)} P ${sticks.pitch.toFixed(2)} Y ${sticks.yaw.toFixed(2)}`,
      pid('roll'),
      pid('pitch'),
      pid('yaw'),
      `Motoren %  ${m}`,
      `Motoren rpm ${rpm}`,
      `Schub ${q.telemetry.totalThrust.toFixed(1)} N  (T/W ${(q.telemetry.totalThrust / (q.body.mass * 9.81)).toFixed(2)})`,
      `Akku ${q.telemetry.voltage.toFixed(2)} V  OCV ${q.battery.openCircuitVoltage().toFixed(2)} V  ${q.telemetry.current.toFixed(1)} A  SoC ${(q.battery.soc * 100).toFixed(0)}%`,
      `v ${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.z.toFixed(1)} m/s   ρ ${q.telemetry.airDensity.toFixed(3)}  Boden ${q.telemetry.onGround ? 'ja' : 'nein'}`,
    ].join('\n');
  }
}
