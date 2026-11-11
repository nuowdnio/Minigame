import { Vector3 } from 'three';
import type { PhysicsConfig } from '../config/physics';
import type { Environment } from '../env/environment';
import type { AirState } from '../env/atmosphere';
import { dragForce, groundEffectFactor, inflowFactor } from './aero';
import { Battery } from './battery';
import { buildContactPoints, solveContacts, type ContactPoint } from './contacts';
import { Motor, fullThrottleOmega, solveBusVoltage, torqueInflowGain } from './motor';
import { RigidBody } from './rigidbody';

const _v = new Vector3();
const _v2 = new Vector3();
const _vAirBody = new Vector3();
const _wind = new Vector3();
const _rWorld = new Vector3();
const _fBody = new Vector3();
const _fWorld = new Vector3();
const _drag = new Vector3();
const _propContact = { normal: new Vector3(), depth: 0 };

/** Telemetrie eines Physik-Schritts (für OSD/Debug). */
export interface QuadTelemetry {
  airDensity: number;
  airTemperatureC: number;
  totalThrust: number;
  current: number;
  voltage: number;
  /** Stärkster Aufprall im letzten Schritt (Normalgeschwindigkeit, m/s). */
  impactSpeed: number;
  onGround: boolean;
  wheelsOnGround: number;
  /** Geschwindigkeit relativ zur Luft (m/s). */
  airspeed: number;
  /** Windgeschwindigkeit am Ort (m/s). */
  windSpeed: number;
  /** Propwash-Intensität 0..1 (Sinkflug in die eigene Abströmung). */
  propwash: number;
  /** Propellerscheibe berührt ein Hindernis (je Motor). */
  propStrike?: boolean[];
  /** Kontaktinformationen je Kontaktpunkt (vom Kontaktlöser). */
  pointImpact?: number[];
  pointSlide?: number[];
  pointTouching?: boolean[];
  pointTag?: ({ kind: 'car'; id: number } | null)[];
}

export function createTelemetry(): QuadTelemetry {
  return {
    airDensity: 1.225,
    airTemperatureC: 15,
    totalThrust: 0,
    current: 0,
    voltage: 0,
    impactSpeed: 0,
    onGround: false,
    wheelsOnGround: 0,
    airspeed: 0,
    windSpeed: 0,
    propwash: 0,
  };
}

/** Normalverteiltes Rauschen (Box-Muller). */
export function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Propwash / Wirbelringstadium: Intensität 0..1 abhängig vom Verhältnis
 * Sinkgeschwindigkeit (entlang der Schubachse) zu induzierter Geschwindigkeit im Schwebeflug.
 * Maximal bei Sinkrate ≈ 1 · v_h, verschwindet unter 0.3 und über 2.2 · v_h.
 */
export function propwashIntensity(descentRatio: number): number {
  if (descentRatio <= 0.25 || descentRatio >= 2.2) return 0;
  const x = (descentRatio - 0.95) / 0.55;
  return Math.exp(-x * x);
}

/**
 * Physikmodell des Quadcopters: Starrkörper + 4 Motoren + Akku + Aerodynamik + Kontakte.
 * Eingabe sind die vier Motor-Ansteuerungen (0..1, inkl. Idle) vom Flight Controller.
 */
export class Quad {
  readonly body: RigidBody;
  readonly motors: Motor[];
  readonly battery: Battery;
  readonly motorPositions: Vector3[];
  readonly contactPoints: ContactPoint[];
  /** Drehzahl bei Vollgas und Nennlast (rad/s), Bezug für Anzeigen. */
  readonly omegaRef: number;
  readonly telemetry: QuadTelemetry = createTelemetry();
  private readonly air: AirState = { temperatureK: 288, pressurePa: 101325, density: 1.225 };
  /** Zustand des gefilterten Propwash-Rauschens je Motor. */
  private readonly washNoise: number[];

  constructor(readonly config: PhysicsConfig) {
    const f = config.frame;
    this.body = new RigidBody(f.mass, f.inertia);
    this.battery = new Battery(config.battery);
    const fullVoltage = config.battery.ocvCurve[config.battery.ocvCurve.length - 1][1] * config.battery.cells;
    this.motors = f.motors.map(() => new Motor(config.motor, fullVoltage));
    this.motorPositions = f.motors.map((m) => new Vector3(m.position.x, m.position.y, m.position.z));
    // Die ersten Kontaktpunkte liegen an den Motoren (gleiche Reihenfolge) -> Propellerschläge
    this.contactPoints = buildContactPoints(
      f.contactPoints.map((c, i) => ({ ...c, part: c.part ?? (i < f.motors.length ? `motor${i}` : 'body') })),
    );
    this.omegaRef = fullThrottleOmega(config.motor, fullVoltage);
    this.washNoise = f.motors.map(() => 0);
    this.telemetry.voltage = this.battery.terminalVoltage();
  }

  reset(position: Vector3, yaw = 0, ambientC = 25): void {
    const b = this.body;
    b.position.copy(position);
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.orientation.setFromAxisAngle(_v.set(0, 1, 0), yaw);
    for (const m of this.motors) m.reset(ambientC);
    for (const c of this.contactPoints) c.broken = c.removed = false;
    this.battery.reset(ambientC);
    this.washNoise.fill(0);
    this.telemetry.impactSpeed = 0;
    this.telemetry.voltage = this.battery.terminalVoltage();
  }

  /**
   * Einen Physik-Schritt ausführen.
   * @param commands Motor-Ansteuerung 0..1 (0 = Motor aus)
   */
  step(dt: number, commands: ArrayLike<number>, env: Environment, time: number): void {
    const cfg = this.config;
    const b = this.body;
    const bat = this.battery;
    b.clearAccumulators();

    // --- Akkuspannung unter Last (implizit gekoppelt) -----------------------
    const voltage = solveBusVoltage(bat.sourceVoltage(), bat.resistance(), bat.params.idleCurrent, this.motors, commands);

    // --- Luft ------------------------------------------------------------
    const air = env.air(b.position.y, this.air);
    const rho = air.density;
    const ambientC = air.temperatureK - 273.15;
    const densityRatio = rho / cfg.air.seaLevelDensity;
    env.wind(b.position, time, _wind);
    _v.copy(b.velocity).sub(_wind);
    b.worldToBody(_v, _vAirBody);
    const airspeed = _vAirBody.length();
    const edgeSpeed2 = _vAirBody.x * _vAirBody.x + _vAirBody.z * _vAirBody.z;

    // Lage: Anteil der Körper-Hochachse, der nach oben zeigt (für Bodeneffekt)
    const upY = _v2.set(0, 1, 0).applyQuaternion(b.orientation).y;

    const rotorRadius = cfg.motor.propDiameter / 2;
    const discArea = Math.PI * rotorRadius * rotorRadius;
    const w = b.angularVelocity;
    const duct = cfg.motor.ductGain;
    let totalThrust = 0;
    let loadCurrent = 0;
    let yawTorque = 0;
    let washMax = 0;
    const washK = 1 - Math.exp(-dt / 0.012); // Bandbreite des Propwash-Rauschens (~13 Hz)

    for (let i = 0; i < this.motors.length; i++) {
      const m = this.motors[i];
      const r = this.motorPositions[i];
      const spin = cfg.frame.motors[i].spin;

      // Axiale Anströmung am Propeller inkl. Rotationsanteil (ω × r).y
      const vAxial = _vAirBody.y + (w.z * r.x - w.x * r.z);
      const inflow = inflowFactor(
        vAxial,
        m.omega,
        cfg.motor.propPitch * cfg.motor.zeroThrustSpeedFactor,
        cfg.motor.maxInflowGain,
      );
      const tqGain = torqueInflowGain(inflow);
      let gain = inflow;

      // Induzierte Geschwindigkeit (Strahltheorie) für Propwash und Translational Lift
      const tRef = Math.max(0.02 * cfg.motor.maxThrust, m.staticThrust);
      const vInduced = Math.sqrt(tRef / (2 * rho * discArea));

      // Propwash: Sinken in die eigene Abströmung -> Schubverlust + unruhiger Schub
      const wash = propwashIntensity(-vAxial / vInduced) * Math.min(1, m.omega / (0.15 * this.omegaRef));
      this.washNoise[i] += (gaussian() - this.washNoise[i]) * washK;
      gain *= 1 - cfg.aero.propwash.thrustLoss * wash + cfg.aero.propwash.noise * wash * this.washNoise[i];
      if (wash > washMax) washMax = wash;

      // Translational Lift: seitliche Anströmung erhöht den Luftdurchsatz der Propellerscheibe
      gain *= 1 + cfg.motor.translationalLift * (edgeSpeed2 / (edgeSpeed2 + 4 * vInduced * vInduced));

      // Unwucht eines beschädigten Propellers: unruhiger Schub
      if (m.imbalance > 0) gain *= 1 + m.imbalance * 0.3 * gaussian() * Math.min(1, m.omega / this.omegaRef);

      if (cfg.aero.groundEffect.enabled && upY > 0.3) {
        _rWorld.copy(r).applyQuaternion(b.orientation).add(b.position);
        const h = env.collision.heightAbove(_rWorld, 2) / upY;
        const ge = groundEffectFactor(h, rotorRadius, cfg.aero.groundEffect.maxGain);
        gain *= 1 + (ge - 1) * upY;
      }

      m.update(commands[i] ?? 0, voltage, dt, densityRatio, tqGain, ambientC, airspeed);
      m.computeForces(densityRatio, gain * duct, tqGain);
      totalThrust += m.thrust;

      // Schub entlang Körper-Hochachse am Motorort: τ = r × (0, T, 0)
      b.torque.x += -r.z * m.thrust;
      b.torque.z += r.x * m.thrust;
      // Reaktionsmoment = Antriebsmoment (Luftmoment + Beschleunigung des Rotors)
      yawTorque += spin * (m.torque + cfg.motor.rotorInertia * m.omegaDot);

      loadCurrent += m.batteryCurrent;
    }
    b.torque.y += yawTorque;

    // Schub als Kraft (Welt)
    _fBody.set(0, totalThrust, 0);
    b.bodyToWorld(_fBody, _fWorld);
    b.force.add(_fWorld);

    // --- Luftwiderstand --------------------------------------------------
    dragForce(_vAirBody, cfg.aero.linearDrag, cfg.aero.dragArea, rho, _drag);
    // Rotor-Widerstand ("H-Force"/Blattschlagen): greift an den Propellernaben an, also über dem
    // Schwerpunkt -> bei Vorwärtsfahrt entsteht ein aufrichtendes Nickmoment wie bei echten Multicoptern.
    const hubH = 0.02 * (cfg.motor.propDiameter / 0.127);
    for (let i = 0; i < this.motors.length; i++) {
      const m = this.motors[i];
      const r = this.motorPositions[i];
      const k = cfg.aero.rotorDrag * (m.omega / this.omegaRef) * densityRatio * m.health;
      // lokale Anströmung an der Nabe: v + ω × r_hub (nur Anteile in der Rotorebene)
      const ry = r.y + hubH;
      const vx = _vAirBody.x + (w.y * r.z - w.z * ry);
      const vz = _vAirBody.z + (w.x * ry - w.y * r.x);
      const fx = -k * vx;
      const fz = -k * vz;
      _drag.x += fx;
      _drag.z += fz;
      // Moment r × F mit F = (fx, 0, fz)
      b.torque.x += ry * fz;
      b.torque.y += r.z * fx - r.x * fz;
      b.torque.z += -ry * fx;
    }
    b.bodyToWorld(_drag as Vector3, _fWorld);
    b.force.add(_fWorld);

    // Kreiselmoment der Rotoren: Drehimpuls H = Σ J·ω_i (Richtung je Drehsinn) entlang der Hochachse.
    // Bei Roll-/Nickbewegungen während eines Gier-Manövers entsteht ein Präzessionsmoment τ = −ω × H.
    let hy = 0;
    for (let i = 0; i < this.motors.length; i++) {
      hy += -cfg.frame.motors[i].spin * cfg.motor.rotorInertia * this.motors[i].omega;
    }
    b.torque.x -= w.y * 0 - w.z * hy;
    b.torque.z -= w.x * hy - w.y * 0;

    // Rotationsdämpfung
    b.torque.addScaledVector(w, -cfg.aero.angularDrag * densityRatio);

    // --- Schwerkraft -----------------------------------------------------
    b.force.y -= b.mass * cfg.gravity;

    // --- Akku ------------------------------------------------------------
    bat.step(loadCurrent, dt, ambientC, airspeed);

    // --- Integration + Kontakte -----------------------------------------
    b.integrateVelocity(dt);
    const t = this.telemetry;
    solveContacts(b, this.contactPoints, env.collision, cfg.contact, t);
    b.integratePosition(dt);

    // Propellerscheiben: Randpunkte gegen die Welt prüfen. Berührt ein Blatt etwas, wird der
    // Rotor stark abgebremst (blockiert) und der Propeller nutzt sich ab (Schadensmodell).
    if (!t.propStrike) t.propStrike = this.motors.map(() => false);
    const R = cfg.motor.propDiameter / 2;
    const hubY = 0.02 * (cfg.motor.propDiameter / 0.127);
    for (let i = 0; i < this.motors.length; i++) {
      const mp = this.motorPositions[i];
      let strike = false;
      for (let k = 0; k < 4 && !strike; k++) {
        const ox = k === 0 ? R : k === 1 ? -R : 0;
        const oz = k === 2 ? R : k === 3 ? -R : 0;
        _rWorld.set(mp.x + ox, mp.y + hubY, mp.z + oz).applyQuaternion(b.orientation).add(b.position);
        if (env.collision.sphereContact(_rWorld, 0.004, _propContact)) strike = true;
      }
      t.propStrike[i] = strike;
      this.motors[i].obstruction = strike ? 40 * cfg.motor.rotorInertia : 0;
    }

    t.airDensity = rho;
    t.airTemperatureC = ambientC;
    t.totalThrust = totalThrust;
    t.current = bat.current;
    t.voltage = bat.terminalVoltage();
    t.airspeed = airspeed;
    t.windSpeed = _wind.length();
    t.propwash = washMax;
  }
}
