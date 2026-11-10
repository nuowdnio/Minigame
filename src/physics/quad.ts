import { Vector3 } from 'three';
import type { PhysicsConfig } from '../config/physics';
import type { Environment } from '../env/environment';
import type { ContactResult } from '../world/collision';
import { airDensity, dragForce, groundEffectFactor, inflowFactor } from './aero';
import { Battery } from './battery';
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
const _vp = new Vector3();
const _vt = new Vector3();
const _corr = new Vector3();
const _contact: ContactResult = { normal: new Vector3(), depth: 0 };

/** Telemetrie eines Physik-Schritts (für OSD/Debug). */
export interface QuadTelemetry {
  airDensity: number;
  totalThrust: number;
  current: number;
  voltage: number;
  /** Stärkster Aufprall im letzten Schritt (Normalgeschwindigkeit, m/s). */
  impactSpeed: number;
  onGround: boolean;
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
  readonly contactPoints: { position: Vector3; radius: number }[];
  readonly omegaRef: number;
  readonly telemetry: QuadTelemetry = {
    airDensity: 1.225,
    totalThrust: 0,
    current: 0,
    voltage: 0,
    impactSpeed: 0,
    onGround: false,
  };

  constructor(readonly config: PhysicsConfig) {
    const f = config.frame;
    this.body = new RigidBody(f.mass, f.inertia);
    this.battery = new Battery(config.battery);
    const fullVoltage = config.battery.ocvCurve[config.battery.ocvCurve.length - 1][1] * config.battery.cells;
    this.motors = f.motors.map(() => new Motor(config.motor, fullVoltage));
    this.motorPositions = f.motors.map((m) => new Vector3(m.position.x, m.position.y, m.position.z));
    this.contactPoints = f.contactPoints.map((c) => ({
      position: new Vector3(c.position.x, c.position.y, c.position.z),
      radius: c.radius,
    }));
    this.omegaRef = targetOmega(1, fullVoltage, config.motor);
    this.telemetry.voltage = this.battery.terminalVoltage();
  }

  reset(position: Vector3, yaw = 0): void {
    const b = this.body;
    b.position.copy(position);
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.orientation.setFromAxisAngle(_v.set(0, 1, 0), yaw);
    for (const m of this.motors) m.reset();
    this.battery.reset();
    this.telemetry.impactSpeed = 0;
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
    const rho = airDensity(env.baseAltitude + b.position.y, cfg.air.seaLevelDensity, cfg.air.scaleHeight);
    const densityRatio = rho / cfg.air.seaLevelDensity;
    env.wind(b.position, time, _wind);
    _v.copy(b.velocity).sub(_wind);
    b.worldToBody(_v, _vAirBody);

    // Lage: Anteil der Körper-Hochachse, der nach oben zeigt (für Bodeneffekt)
    const upY = _v2.set(0, 1, 0).applyQuaternion(b.orientation).y;

    const rotorRadius = cfg.motor.propDiameter / 2;
    const w = b.angularVelocity;
    let totalThrust = 0;
    let rotorSpeedSum = 0;
    let loadCurrent = 0;
    let yawTorque = 0;

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

      if (cfg.aero.groundEffect.enabled && upY > 0.3) {
        _rWorld.copy(r).applyQuaternion(b.orientation).add(b.position);
        const h = env.collision.heightAbove(_rWorld, 2) / upY;
        const ge = groundEffectFactor(h, rotorRadius, cfg.aero.groundEffect.maxGain);
        gain *= 1 + (ge - 1) * upY;
      }

      m.computeForces(densityRatio, gain);
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
    b.torque.addScaledVector(w, -cfg.aero.angularDrag);

    // --- Schwerkraft -----------------------------------------------------
    b.force.y -= b.mass * cfg.gravity;

    // --- Akku ------------------------------------------------------------
    bat.step(loadCurrent, dt);

    // --- Integration + Kontakte -----------------------------------------
    b.integrateVelocity(dt);
    this.solveContacts(env);
    b.integratePosition(dt);

    const t = this.telemetry;
    t.airDensity = rho;
    t.totalThrust = totalThrust;
    t.current = bat.current;
    t.voltage = bat.terminalVoltage();
  }

  /** Kontakte per Impulsverfahren (Stoß + Coulomb-Reibung) und Positionskorrektur auflösen. */
  private solveContacts(env: Environment): void {
    const b = this.body;
    const cc = this.config.contact;
    let maxImpact = 0;
    let onGround = false;

    for (let iter = 0; iter < cc.iterations; iter++) {
      for (const cp of this.contactPoints) {
        _rWorld.copy(cp.position).applyQuaternion(b.orientation);
        _v.copy(_rWorld).add(b.position);
        const c = env.collision.sphereContact(_v, cp.radius, _contact);
        if (!c) continue;
        onGround = true;
        const n = c.normal;

        // Positionskorrektur nur einmal pro Schritt
        if (iter === 0) {
          _corr.copy(n).multiplyScalar(c.depth * cc.positionCorrection);
          b.position.add(_corr);
        }

        b.pointVelocity(_rWorld, _vp);
        const vn = _vp.dot(n);
        if (vn >= 0) continue;
        if (iter === 0) maxImpact = Math.max(maxImpact, -vn);

        const e = -vn > 1.0 ? cc.restitution : 0;
        const kn = b.effectiveInverseMass(_rWorld, n);
        const jn = (-(1 + e) * vn) / kn;
        _v2.copy(n).multiplyScalar(jn);
        b.applyImpulseAtWorldOffset(_v2, _rWorld);

        // Reibung
        b.pointVelocity(_rWorld, _vp);
        _vt.copy(_vp).addScaledVector(n, -_vp.dot(n));
        const vtLen = _vt.length();
        if (vtLen > 1e-6) {
          _vt.multiplyScalar(1 / vtLen);
          const kt = b.effectiveInverseMass(_rWorld, _vt);
          const jt = Math.min(vtLen / kt, cc.friction * jn);
          _v2.copy(_vt).multiplyScalar(-jt);
          b.applyImpulseAtWorldOffset(_v2, _rWorld);
        }
      }
    }
    this.telemetry.impactSpeed = maxImpact;
    this.telemetry.onGround = onGround;
  }
}
