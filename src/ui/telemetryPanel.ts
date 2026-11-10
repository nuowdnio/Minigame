import type { Sticks } from '../fc/flightController';
import type { Simulation } from '../game/simulation';
import { attitude } from '../fc/planeController';
import { PlaneVehicle } from '../vehicles/planeVehicle';
import { QuadVehicle } from '../vehicles/quadVehicle';

const R2D = 180 / Math.PI;

/** Debug-Anzeige für das Tuning der Physik (Taste T / 📊). */
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
    const v = sim.vehicle;
    const t = v.telemetry;
    const bat = v.battery;
    const vel = v.body.velocity;
    const lines = [
      `Eingabe: ${inputInfo}`,
      `Sticks  T ${sticks.throttle.toFixed(2)} R ${sticks.roll.toFixed(2)} P ${sticks.pitch.toFixed(2)} Y ${sticks.yaw.toFixed(2)}`,
    ];

    if (v instanceof QuadVehicle) {
      const q = v.quad;
      const fc = v.fc;
      const g = fc.filteredGyro;
      const sp = fc.setpoint;
      const pid = (k: 'roll' | 'pitch' | 'yaw') => {
        const l = fc.pids[k].last;
        return `${k.padEnd(5)} sp ${sp[k].toFixed(0).padStart(5)} gyro ${g[k].toFixed(0).padStart(5)}  P ${l.p.toFixed(0).padStart(4)} I ${l.i.toFixed(0).padStart(4)} D ${l.d.toFixed(0).padStart(4)} FF ${l.ff.toFixed(0).padStart(4)}`;
      };
      lines.push(
        pid('roll'),
        pid('pitch'),
        pid('yaw'),
        `Motoren %  ${q.motors.map((m) => ((m.omega / q.omegaRef) * 100).toFixed(0).padStart(3)).join(' ')}`,
        `Motoren rpm ${q.motors.map((m) => Math.round((m.omega * 60) / (2 * Math.PI) / 100) * 100).join(' ')}`,
        `Schub ${t.totalThrust.toFixed(2)} N  (T/W ${(t.totalThrust / (q.body.mass * 9.81)).toFixed(2)})  Propwash ${(t.propwash * 100).toFixed(0)}%`,
      );
    } else if (v instanceof PlaneVehicle) {
      const p = v.plane;
      const pt = p.telemetry;
      const att = attitude(p.body.orientation);
      lines.push(
        `Lage: Quer ${(att.bank * R2D).toFixed(0)}°  Längs ${(att.pitch * R2D).toFixed(0)}°`,
        `Fahrt ${pt.airspeed.toFixed(1)} m/s  α ${pt.alphaDeg.toFixed(1)}°  β ${pt.betaDeg.toFixed(1)}°  Abriss ${(pt.stall * 100).toFixed(0)}%`,
        `Auftrieb ${pt.lift.toFixed(1)} N  Gewicht ${(p.body.mass * 9.81).toFixed(1)} N  Schub ${pt.totalThrust.toFixed(1)} N`,
        `Ruder: ${p.surfaces
          .filter((s) => s.def.control)
          .map((s) => `${s.def.name} ${(s.deflection * R2D).toFixed(0)}°`)
          .join('  ')}`,
        `Motor ${Math.round((p.motor.omega * 60) / (2 * Math.PI))} rpm  Steigen ${vel.y.toFixed(1)} m/s`,
      );
    }
    lines.push(
      `Akku ${t.voltage.toFixed(2)} V  OCV ${bat.openCircuitVoltage().toFixed(2)} V  ${t.current.toFixed(1)} A  SoC ${(bat.soc * 100).toFixed(0)}%  ${bat.temperatureC.toFixed(1)} °C`,
      `Luft ρ ${t.airDensity.toFixed(3)} kg/m³  ${t.airTemperatureC.toFixed(1)} °C  Wind ${t.windSpeed.toFixed(1)} m/s`,
      `v ${vel.x.toFixed(1)} ${vel.y.toFixed(1)} ${vel.z.toFixed(1)} m/s  Boden ${t.onGround ? 'ja' : 'nein'}`,
    );
    this.el.textContent = lines.join('\n');
  }
}
