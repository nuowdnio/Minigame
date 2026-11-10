import { Vector3 } from 'three';
import type { PhysicsConfig } from '../config/physics';
import type { Environment } from '../env/environment';
import type { AirState } from '../env/atmosphere';
import { dragForce, groundEffectFactor, inflowFactor } from './aero';
import { Battery } from './battery';
import { buildContactPoints, solveContacts, type ContactPoint } from './contacts';
import { Motor, targetOmega } from './motor';
import { RigidBody } from './rigidbody';

const _v = new Vector3();
const _v2 = new Vector3();
const _vAirBody = new Vector3();
const _wind = new Vector3();
const _rWorld = new Vector3();
const _fBody = new Vector3();
const _fWorld = new Vector3();
const _drag = new Vector3();

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
    this.contactPoints = buildContactPoints(f.contactPoints);
    this.omegaRef = targetOmega(1, fullVoltage, config.motor);
    this.washNoise = f.motors.map(() => 0);
    this.telemetry.voltage = this.battery.terminalVoltage();
  }

  reset(position: Vector3, yaw = 0, ambientC = 25): void {
    const b = this.body;
    b.position.copy(position);
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.orientation.setFromAxisAngle(_v.set(0, 1, 0), yaw);
    for (const m of this.motors) m.reset();
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

    // --- Motoren ---------------------------------------------------------
    const voltage = bat.terminalVoltage();
    for (let i = 0; i < this.motors.length; i++) {
      this.motors[i].update(commands[i] ?? 0, voltage, dt);
    }

    // --- Luft ------------------------------------------------------------
    const air = env.air(b.position.y, this.air);
    const rho = air.density;
    const densityRatio = rho / cfg.air.seaLevelDensity;
    env.wind(b.position, time, _wind);
    _v.copy(b.velocity).sub(_wind);
    b.worldToBody(_v, _vAirBody);

    // Lage: Anteil der Körper-Hochachse, der nach oben zeigt (für Bodeneffekt)
    const upY = _v2.set(0, 1, 0).applyQuaternion(b.orientation).y;

    const rotorRadius = cfg.motor.propDiameter / 2;
    const discArea = Math.PI * rotorRadius * rotorRadius;
    const w = b.angularVelocity;
    const duct = cfg.motor.ductGain;
    let totalThrust = 0;
    let rotorSpeedSum = 0;
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
      let gain = inflowFactor(
        vAxial,
        m.omega,
        cfg.motor.propPitch * cfg.motor.zeroThrustSpeedFactor,
        cfg.motor.maxInflowGain,
      );

      // Propwash: Sinken in die eigene Abströmung -> Schubverlust + unruhiger Schub
      const tHover = Math.max(0.02, m.staticThrust);
      const vInduced = Math.sqrt(tHover / (2 * rho * discArea));
      const descentRatio = -vAxial / vInduced;
      const wash = propwashIntensity(descentRatio) * Math.min(1, m.omega / (0.15 * this.omegaRef));
      this.washNoise[i] += (gaussian() - this.washNoise[i]) * washK;
      gain *= 1 - cfg.aero.propwash.thrustLoss * wash + cfg.aero.propwash.noise * wash * this.washNoise[i];
      if (wash > washMax) washMax = wash;

      if (cfg.aero.groundEffect.enabled && upY > 0.3) {
        _rWorld.copy(r).applyQuaternion(b.orientation).add(b.position);
        const h = env.collision.heightAbove(_rWorld, 2) / upY;
        const ge = groundEffectFactor(h, rotorRadius, cfg.aero.groundEffect.maxGain);
        gain *= 1 + (ge - 1) * upY;
      }

      m.computeForces(densityRatio, gain * duct);
      totalThrust += m.thrust;
      rotorSpeedSum += m.omega / this.omegaRef;

      // Schub entlang Körper-Hochachse am Motorort: τ = r × (0, T, 0)
      b.torque.x += -r.z * m.thrust;
      b.torque.z += r.x * m.thrust;
      // Reaktionsmoment von Propeller-Luftwiderstand und Rotor-Beschleunigung
      yawTorque += spin * (m.torque + cfg.motor.rotorInertia * m.omegaDot);

      loadCurrent += m.current(voltage);
    }
    b.torque.y += yawTorque;

    // Schub als Kraft (Welt)
    _fBody.set(0, totalThrust, 0);
    b.bodyToWorld(_fBody, _fWorld);
    b.force.add(_fWorld);

    // --- Luftwiderstand --------------------------------------------------
    dragForce(_vAirBody, cfg.aero.linearDrag, cfg.aero.dragArea, rho, _drag);
    // Rotor-Widerstand (seitliche Anströmung der Propellerebene)
    const kRotor = cfg.aero.rotorDrag * rotorSpeedSum * densityRatio;
    _drag.x -= kRotor * _vAirBody.x;
    _drag.z -= kRotor * _vAirBody.z;
    b.bodyToWorld(_drag as Vector3, _fWorld);
    b.force.add(_fWorld);

    // Rotationsdämpfung
    b.torque.addScaledVector(w, -cfg.aero.angularDrag * densityRatio);

    // --- Schwerkraft -----------------------------------------------------
    b.force.y -= b.mass * cfg.gravity;

    // --- Akku ------------------------------------------------------------
    const airspeed = _vAirBody.length();
    bat.step(loadCurrent, dt, air.temperatureK - 273.15, airspeed);

    // --- Integration + Kontakte -----------------------------------------
    b.integrateVelocity(dt);
    const t = this.telemetry;
    solveContacts(b, this.contactPoints, env.collision, cfg.contact, t);
    b.integratePosition(dt);

    t.airDensity = rho;
    t.airTemperatureC = air.temperatureK - 273.15;
    t.totalThrust = totalThrust;
    t.current = bat.current;
    t.voltage = bat.terminalVoltage();
    t.airspeed = airspeed;
    t.windSpeed = _wind.length();
    t.propwash = washMax;
  }
}
