import { Quaternion, Vector3 } from 'three';
import type { PlaneConfig, SurfaceDef } from '../config/planes';
import type { AirState } from '../env/atmosphere';
import type { Environment } from '../env/environment';
import { dragForce, inflowFactor } from './aero';
import { airfoilCoefficients, flapEffectiveness, liftSlope, type AirfoilParams, type AirfoilResult } from './airfoil';
import { Battery } from './battery';
import { buildContactPoints, solveContacts, type ContactPoint } from './contacts';
import { Motor } from './motor';
import { createTelemetry, type QuadTelemetry } from './quad';
import { RigidBody } from './rigidbody';

const DEG = Math.PI / 180;

/** Vorberechnete Daten einer Fläche. */
interface Surface {
  def: SurfaceDef;
  position: Vector3;
  /** Flächennormale (Körper). */
  normal: Vector3;
  /** Spannweitenrichtung (Körper). */
  spanDir: Vector3;
  area: number;
  airfoil: AirfoilParams;
  incidence: number;
  tau: number;
  downwashIdx: number[];
  /** Letzte Ergebnisse (Telemetrie, Abwind). */
  alpha: number;
  cl: number;
  stall: number;
  /** Aktueller Ruderausschlag (rad). */
  deflection: number;
}

export interface PlaneTelemetry extends QuadTelemetry {
  /** Anstellwinkel des Flügels (Grad). */
  alphaDeg: number;
  /** Schiebewinkel (Grad). */
  betaDeg: number;
  /** Abriss-Anteil des Flügels 0..1. */
  stall: number;
  /** Auftrieb gesamt (N). */
  lift: number;
}

const FWD = new Vector3(0, 0, -1);
const _u = new Vector3();
const _vBody = new Vector3();
const _w = new Vector3();
const _wb = new Vector3();
const _wCg = new Vector3();
const _pw = new Vector3();
const _cross = new Vector3();
const _lift = new Vector3();
const _drag = new Vector3();
const _f = new Vector3();
const _fw = new Vector3();
const _tq = new Vector3();
const _coef: AirfoilResult = { cl: 0, cd: 0, stall: 0 };

/**
 * Starrflügler-Physik: Flächenmodell (Blade-Element-artig je Fläche),
 * Motor mit Propeller (Inflow, Propellerstrahl, Drehmoment, Kreiselmoment),
 * Rumpfwiderstand, Fahrwerk/Kufen, Akku.
 */
export class Plane {
  readonly body: RigidBody;
  readonly motor: Motor;
  readonly battery: Battery;
  readonly surfaces: Surface[];
  readonly contactPoints: ContactPoint[];
  readonly motorPosition: Vector3;
  readonly telemetry: PlaneTelemetry = {
    ...createTelemetry(),
    alphaDeg: 0,
    betaDeg: 0,
    stall: 0,
    lift: 0,
  };
  private readonly air: AirState = { temperatureK: 288, pressurePa: 101325, density: 1.225 };
  /** Lenkwinkel Bugrad (rad, + = rechts). */
  steerAngle = 0;

  constructor(readonly config: PlaneConfig) {
    this.body = new RigidBody(config.mass, config.inertia);
    this.battery = new Battery(config.battery);
    const fullV = config.battery.ocvCurve[config.battery.ocvCurve.length - 1][1] * config.battery.cells;
    this.motor = new Motor(config.motor, fullV);
    this.motorPosition = new Vector3(config.motor.position.x, config.motor.position.y, config.motor.position.z);
    this.contactPoints = buildContactPoints(config.contactPoints);
    const names = config.surfaces.map((s) => s.name);
    this.surfaces = config.surfaces.map((def) => {
      const side = Math.sign(def.position.x) || 1;
      const g = (def.dihedralDeg ?? 0) * DEG;
      const normal =
        def.orientation === 'horizontal' ? new Vector3(-side * Math.sin(g), Math.cos(g), 0) : new Vector3(1, 0, 0);
      const spanDir = new Vector3().crossVectors(FWD, normal).normalize();
      return {
        def,
        position: new Vector3(def.position.x, def.position.y, def.position.z),
        normal,
        spanDir,
        area: def.span * def.chord,
        airfoil: {
          cl0: def.cl0 ?? 0,
          clAlpha: liftSlope(def.aspectRatio),
          alphaStall: def.stallDeg * DEG,
          cd0: def.cd0,
          oswald: def.oswald ?? 0.8,
          aspectRatio: def.aspectRatio,
          stallSharpness: 40,
        },
        incidence: (def.incidenceDeg ?? 0) * DEG,
        tau: def.control ? flapEffectiveness(def.control.chordFraction) * def.control.spanFraction : 0,
        downwashIdx: (def.downwashFrom ?? []).map((n) => names.indexOf(n)).filter((i) => i >= 0),
        alpha: 0,
        cl: 0,
        stall: 0,
        deflection: 0,
      };
    });
    this.telemetry.voltage = this.battery.terminalVoltage();
  }

  reset(position: Vector3, yaw: number, pitchDeg: number, speed: number, ambientC = 25): void {
    const b = this.body;
    b.position.copy(position);
    b.orientation.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    b.orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitchDeg * DEG));
    b.velocity.copy(FWD).applyQuaternion(b.orientation).multiplyScalar(speed);
    b.angularVelocity.set(0, 0, 0);
    this.motor.reset();
    this.battery.reset(ambientC);
    for (const s of this.surfaces) {
      s.deflection = 0;
      s.alpha = s.cl = s.stall = 0;
    }
    this.steerAngle = 0;
    this.telemetry.voltage = this.battery.terminalVoltage();
  }

  /**
   * Einen Physik-Schritt ausführen.
   * @param throttle Motor-Ansteuerung 0..1
   * Die Ruderausschläge werden vorher über surfaces[i].deflection gesetzt.
   */
  step(dt: number, throttle: number, env: Environment, time: number): void {
    const cfg = this.config;
    const b = this.body;
    const bat = this.battery;
    const t = this.telemetry;
    b.clearAccumulators();

    // --- Motor -----------------------------------------------------------
    const voltage = bat.terminalVoltage();
    const m = this.motor;
    m.update(throttle, voltage, dt);

    const air = env.air(b.position.y, this.air);
    const rho = air.density;
    const densityRatio = rho / cfg.air.seaLevelDensity;

    env.wind(b.position, time, _w);
    const windSpeed = _w.length();
    b.worldToBody(_w, _wCg);
    b.worldToBody(b.velocity, _vBody);
    // Anströmung am Schwerpunkt (Körper): Geschwindigkeit relativ zur Luft
    const uCgX = _vBody.x - _wCg.x;
    const uCgY = _vBody.y - _wCg.y;
    const uCgZ = _vBody.z - _wCg.z;
    const airspeed = Math.hypot(uCgX, uCgY, uCgZ);

    // Propeller: Inflow entlang der Schubachse (vorwärts = −z)
    const vAxial = -uCgZ;
    const gain = inflowFactor(vAxial, m.omega, cfg.motor.propPitch * cfg.motor.zeroThrustSpeedFactor, cfg.motor.maxInflowGain);
    m.computeForces(densityRatio, gain);
    const thrust = m.thrust;
    // Propellerstrahl (Strahltheorie): Zusatzgeschwindigkeit hinter dem Propeller
    const discArea = Math.PI * (cfg.motor.propDiameter / 2) ** 2;
    const va = Math.max(0, vAxial);
    const vi = -va / 2 + Math.sqrt((va * va) / 4 + thrust / (2 * rho * discArea));
    const slip = 2 * vi * cfg.motor.slipstreamFactor;

    // Schubkraft und Momente
    _f.set(0, 0, -thrust);
    _tq.crossVectors(this.motorPosition, _f);
    b.torque.add(_tq);
    const fx = _f.x,
      fy = _f.y,
      fz = _f.z;
    // Reaktionsmoment um die Propellerachse (+z = Rollen nach links bei CW-Propeller von hinten gesehen)
    b.torque.z += cfg.motor.spin * (m.torque + cfg.motor.rotorInertia * m.omegaDot);
    // Kreiselmoment des Propellers: τ = −ω × H, H = J·ω_prop entlang −z·spin
    const H = cfg.motor.rotorInertia * m.omega * cfg.motor.spin;
    const wv = b.angularVelocity;
    // H-Vektor = (0, 0, −H)
    b.torque.x -= wv.y * -H;
    b.torque.y -= -(wv.x * -H);

    let forceX = fx,
      forceY = fy,
      forceZ = fz;
    let liftSum = 0;
    let wingAlpha = 0;
    let wingStall = 0;
    let wingCount = 0;

    // --- Flächen ---------------------------------------------------------
    for (let i = 0; i < this.surfaces.length; i++) {
      const s = this.surfaces[i];
      const def = s.def;
      // Wind am Ort der Fläche (Turbulenz-Gradienten über die Spannweite)
      if (Math.abs(s.position.x) > 0.2 || Math.abs(s.position.z) > 0.4) {
        _pw.copy(s.position).applyQuaternion(b.orientation).add(b.position);
        env.wind(_pw, time, _w);
        b.worldToBody(_w, _wb);
      } else {
        _wb.copy(_wCg);
      }
      // u = v_körper − wind + ω × r
      _cross.crossVectors(wv, s.position);
      _u.set(_vBody.x - _wb.x + _cross.x, _vBody.y - _wb.y + _cross.y, _vBody.z - _wb.z + _cross.z);
      // Propellerstrahl: Luft strömt zusätzlich nach hinten -> wie schnellere Vorwärtsbewegung
      if (def.slipstream) _u.z -= slip * def.slipstream;
      // Spannweitenkomponente entfernen
      _u.addScaledVector(s.spanDir, -_u.dot(s.spanDir));
      const V2 = _u.lengthSq();
      if (V2 < 1e-6) continue;
      const V = Math.sqrt(V2);
      let alpha = Math.atan2(-_u.dot(s.normal), -_u.z) + s.incidence;
      if (s.downwashIdx.length) {
        let clw = 0;
        let ar = 0;
        for (const j of s.downwashIdx) {
          clw += this.surfaces[j].cl;
          ar += this.surfaces[j].def.aspectRatio;
        }
        clw /= s.downwashIdx.length;
        ar /= s.downwashIdx.length;
        alpha -= (2 * clw) / (Math.PI * ar);
      }
      airfoilCoefficients(alpha, s.deflection, s.tau, s.airfoil, _coef);
      s.alpha = alpha;
      s.cl = _coef.cl;
      s.stall = _coef.stall;

      const q = 0.5 * rho * V2 * s.area;
      // Widerstand entgegen der Anströmung, Auftrieb senkrecht dazu
      _drag.copy(_u).multiplyScalar(-(q * _coef.cd) / V);
      _lift.crossVectors(s.spanDir, _u).multiplyScalar((q * _coef.cl) / V);
      _f.copy(_lift).add(_drag);
      forceX += _f.x;
      forceY += _f.y;
      forceZ += _f.z;
      _tq.crossVectors(s.position, _f);
      b.torque.add(_tq);
      // Profil-Nickmoment um die Spannweitenachse (+ = Nase hoch für horizontale Flächen)
      const cm = (def.cm0 ?? 0) - 0.5 * s.tau * s.deflection;
      b.torque.addScaledVector(s.spanDir, q * def.chord * cm);

      if (def.name.startsWith('wing') && def.orientation === 'horizontal') {
        liftSum += q * _coef.cl;
        wingAlpha += alpha;
        wingStall += _coef.stall;
        wingCount++;
      }
    }

    // --- Rumpf -----------------------------------------------------------
    _u.set(uCgX, uCgY, uCgZ);
    dragForce(_u, cfg.fuselage.linearDrag, cfg.fuselage.dragArea, rho, _drag);
    forceX += _drag.x;
    forceY += _drag.y;
    forceZ += _drag.z;

    _f.set(forceX, forceY, forceZ);
    b.bodyToWorld(_f, _fw);
    b.force.add(_fw);
    b.force.y -= b.mass * cfg.gravity;

    // --- Akku ------------------------------------------------------------
    bat.step(m.current(voltage), dt, air.temperatureK - 273.15, airspeed);

    // --- Integration + Kontakte -----------------------------------------
    b.integrateVelocity(dt);
    solveContacts(b, this.contactPoints, env.collision, cfg.contact, t, this.steerAngle);
    b.integratePosition(dt);

    t.airDensity = rho;
    t.airTemperatureC = air.temperatureK - 273.15;
    t.totalThrust = thrust;
    t.current = bat.current;
    t.voltage = bat.terminalVoltage();
    t.airspeed = airspeed;
    t.windSpeed = windSpeed;
    t.propwash = 0;
    t.alphaDeg = wingCount ? (wingAlpha / wingCount) / DEG : 0;
    t.betaDeg = airspeed > 0.5 ? Math.asin(Math.max(-1, Math.min(1, uCgX / airspeed))) / DEG : 0;
    t.stall = wingCount ? wingStall / wingCount : 0;
    t.lift = liftSum;
  }
}
