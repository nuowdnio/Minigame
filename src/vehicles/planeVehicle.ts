import { Vector3 } from 'three';
import type { Settings } from '../config/defaults';
import type { PlaneConfig } from '../config/planes';
import type { Environment } from '../env/environment';
import type { Sticks } from '../fc/flightController';
import { PlaneController } from '../fc/planeController';
import { Plane } from '../physics/plane';
import { noLoadOmega } from '../physics/motor';
import { DamageState, damageScale, type DamageMode } from './damage';
import { bodyRatesToFc, type Vehicle } from './vehicle';

const DEG = Math.PI / 180;
const MODE_NAMES = { manual: 'MANUAL', gyro: 'STAB', angle: 'ANGLE' } as const;
const SURFACE_NAMES: Record<string, string> = {
  wingR: 'Rechter Flügel',
  wingL: 'Linker Flügel',
  stab: 'Höhenleitwerk',
  fin: 'Seitenleitwerk',
  wingletR: 'Rechtes Winglet',
  wingletL: 'Linkes Winglet',
};

/** Starrflügler: Flugregler (Manuell/Stabilisiert/Angle) + Servos + Flugzeugphysik. */
export class PlaneVehicle implements Vehicle {
  readonly kind = 'plane' as const;
  readonly plane: Plane;
  readonly ctrl: PlaneController;
  readonly cameraMount: Vector3;
  readonly size: number;
  readonly damage = new DamageState();
  damageMode: DamageMode;
  private readonly rates = { roll: 0, pitch: 0, yaw: 0 };
  /** Aufschaukeln des Flatterns über V_NE (s). */
  private flutter = 0;
  /** Handstart: Modell wird gehalten, bis Gas gegeben wird. */
  launchPending = false;
  private readonly launchVelocity = new Vector3();

  constructor(
    readonly id: string,
    readonly config: PlaneConfig,
    settings: Settings,
  ) {
    this.plane = new Plane(config);
    this.ctrl = new PlaneController(config.control);
    this.ctrl.mode = settings.planeMode;
    this.damageMode = settings.damage;
    const m = config.cameraMount;
    this.cameraMount = new Vector3(m.x, m.y, m.z);
    this.size = config.visual.size;
  }

  get body() {
    return this.plane.body;
  }
  get battery() {
    return this.plane.battery;
  }
  get telemetry() {
    return this.plane.telemetry;
  }
  get armed() {
    return this.ctrl.armed && !this.damage.destroyed;
  }
  get modeName() {
    return MODE_NAMES[this.ctrl.mode];
  }

  reset(position: Vector3, yaw: number, ambientC: number): void {
    const s = this.config.spawn;
    const p = new Vector3(position.x, position.y + s.height, position.z);
    this.plane.reset(p, yaw, s.onGround ? 0 : s.pitchDeg, s.onGround ? 0 : s.speed, ambientC);
    this.ctrl.reset();
    this.damage.reset();
    this.flutter = 0;
    this.launchPending = !s.onGround;
    if (this.launchPending) {
      this.launchVelocity.copy(this.plane.body.velocity);
      this.plane.body.velocity.set(0, 0, 0);
    }
  }

  get statusHint(): string {
    if (this.damage.destroyed) return 'ZERSTÖRT – RESET (R / ↺)';
    return this.launchPending ? 'GAS GEBEN FÜR HANDSTART' : '';
  }

  step(dt: number, sticks: Sticks, env: Environment, time: number): void {
    const p = this.plane;
    bodyRatesToFc(p.body.angularVelocity, this.rates);
    this.ctrl.update(sticks, this.rates, p.body.orientation, p.telemetry.airspeed, dt);
    const o = this.ctrl.output;
    // Servos: begrenzte Stellgeschwindigkeit
    const maxStep = this.config.control.servoRate * DEG * dt;
    for (const s of p.surfaces) {
      const c = s.def.control;
      if (!c || s.jammed || s.health <= 0) continue;
      const cmd = Math.max(-1, Math.min(1, (c.mix.roll ?? 0) * o.roll + (c.mix.pitch ?? 0) * o.pitch + (c.mix.yaw ?? 0) * o.yaw));
      const target = cmd * c.maxDeg * DEG;
      const d = target - s.deflection;
      s.deflection += Math.max(-maxStep, Math.min(maxStep, d));
    }
    p.steerAngle = sticks.yaw * this.config.steerMaxDeg * DEG;
    if (this.launchPending) {
      // Der Pilot hält das Modell; Motor läuft schon hoch, geworfen wird bei genug Gas
      p.motor.update(o.throttle, p.battery.terminalVoltage(), dt, 1, 1, 20, 0);
      p.motor.computeForces(1, 1);
      p.body.velocity.set(0, 0, 0);
      p.body.angularVelocity.set(0, 0, 0);
      if (this.ctrl.armed && o.throttle > 0.4 && p.motor.omega > 0.6 * noLoadOmega(o.throttle, p.battery.terminalVoltage(), p.motor.params)) {
        this.launchPending = false;
        p.body.velocity.copy(this.launchVelocity);
      }
      return;
    }
    p.step(dt, this.damage.destroyed ? 0 : o.throttle, env, time);
    this.evaluateDamage(dt);
  }

  /** Strukturlasten, Flattern, Aufprall und Überlast auswerten. */
  private evaluateDamage(dt: number): void {
    const d = this.damage;
    const p = this.plane;
    const t = p.telemetry;
    const lim = this.config.damage;
    const scale = damageScale(this.damageMode);
    d.checkMotor(p.motor, 'Motor', 'motor0');
    d.checkBattery(p.battery);
    if (!Number.isFinite(scale)) return;

    const breakSurface = (name: string, why: string) => {
      const s = p.surfaces.find((x) => x.def.name === name);
      if (!s || s.health <= 0) return;
      s.health = 0;
      // Kontaktpunkte an diesem Teil (z. B. Flügelspitze) fallen mit ab
      for (const cp of p.contactPoints) if (cp.part === name) cp.removed = true;
      d.break(name, `${SURFACE_NAMES[name] ?? name} abgebrochen (${why})`, 'critical');
    };

    // Strukturlast: Lastvielfaches über Bruchgrenze -> höher belasteter Flügel bricht
    const n = t.loadFactor;
    if (n > lim.maxG * scale || n < -0.6 * lim.maxG * scale) {
      const wr = p.surfaces.find((x) => x.def.name === 'wingR');
      const wl = p.surfaces.find((x) => x.def.name === 'wingL');
      const which = wr && wl && Math.abs(wr.load) >= Math.abs(wl.load) ? 'wingR' : 'wingL';
      breakSurface(which, `Überlast ${n.toFixed(1)} g`);
    } else if (n > lim.maxG * scale * 0.8) {
      d.emit(`Hohe Last: ${n.toFixed(1)} g`, 'warn', 'gwarn');
    }

    // Flattern über V_NE: ein Ruder klemmt, deutlich darüber bricht der Flügel
    const v = t.airspeed;
    const over = v / (lim.vne * scale);
    this.flutter = over > 1 ? this.flutter + dt * over * over : Math.max(0, this.flutter - dt);
    if (over > 1 && this.flutter > 0.35) {
      this.flutter = 0;
      const controlled = p.surfaces.filter((x) => x.def.control && !x.jammed && x.health > 0);
      if (controlled.length) {
        const s = controlled[Math.floor(Math.random() * controlled.length)];
        s.jammed = true;
        s.deflection = (Math.random() - 0.5) * 0.3;
        s.health = Math.min(s.health, 0.7);
        d.emit(`FLATTERN bei ${(v * 3.6).toFixed(0)} km/h – ${SURFACE_NAMES[s.def.name] ?? s.def.name}: Ruder klemmt`, 'critical', `flutter:${s.def.name}`);
      }
      if (v > lim.vne * scale * 1.2) breakSurface(Math.random() < 0.5 ? 'wingR' : 'wingL', 'Flattern');
    }

    // Aufprall je Bauteil
    const impacts = t.pointImpact ?? [];
    const touching = t.pointTouching ?? [];
    p.contactPoints.forEach((cp, i) => {
      const vi = impacts[i] ?? 0;
      if (cp.part === 'gear' && vi > lim.gearBreak * scale && !cp.broken) {
        cp.broken = true;
        d.break(`gear${i}`, `Fahrwerk abgerissen (${vi.toFixed(1)} m/s)`);
      }
      if ((cp.part === 'wingR' || cp.part === 'wingL') && vi > lim.wingBreak * scale) breakSurface(cp.part, 'Aufprall');
      if ((cp.part === 'stab' || cp.part === 'fin') && vi > lim.wingBreak * scale) breakSurface(cp.part, 'Aufprall');
      if (cp.part === 'prop' && touching[i] && p.motor.omega > 150 && p.motor.health > 0) {
        p.motor.health = 0;
        d.break('prop', 'Propeller zerbrochen (Bodenberührung)');
      }
      if (vi > lim.bodyBreak * scale) d.destroy(`CRASH mit ${(vi * 3.6).toFixed(0)} km/h – Modell zerstört`);
    });
    if (p.surfaces.filter((x) => x.def.name.startsWith('wing') && x.def.orientation === 'horizontal').every((x) => x.health <= 0)) {
      d.destroy('Beide Flügel verloren');
    }
    for (const s of p.surfaces) d.parts.set(SURFACE_NAMES[s.def.name] ?? s.def.name, s.health);
    d.parts.set('Propeller', p.motor.working ? p.motor.health : 0);
  }

  applySettings(settings: Settings): void {
    this.ctrl.mode = settings.planeMode;
    this.damageMode = settings.damage;
  }

  cameraTilt(): number {
    return this.config.cameraTiltDeg;
  }
}
