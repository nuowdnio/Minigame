import { Quaternion, Vector3 } from 'three';
import type { Vec3Like } from '../config/physics';

const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _dq = new Quaternion();

/**
 * Starrkörper mit diagonalem Trägheitstensor (Hauptachsen = Körperachsen).
 * Kräfte werden im Welt-System akkumuliert, Drehmomente im Körper-System.
 * Winkelgeschwindigkeit wird im Körper-System geführt (wie ein Gyro sie misst).
 */
export class RigidBody {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly orientation = new Quaternion();
  /** Winkelgeschwindigkeit im Körper-System (rad/s). */
  readonly angularVelocity = new Vector3();

  /** Akkumulierte Kraft (Welt, N). */
  readonly force = new Vector3();
  /** Akkumuliertes Drehmoment (Körper, N·m). */
  readonly torque = new Vector3();

  readonly inertia: Vector3;
  readonly invInertia: Vector3;

  constructor(
    public mass: number,
    inertia: Vec3Like,
  ) {
    this.inertia = new Vector3(inertia.x, inertia.y, inertia.z);
    this.invInertia = new Vector3(1 / inertia.x, 1 / inertia.y, 1 / inertia.z);
  }

  clearAccumulators(): void {
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }

  /** Kraft (Welt) an einem Punkt (Welt-Offset vom Schwerpunkt) angreifen lassen. */
  applyForceAtWorldOffset(forceWorld: Vector3, offsetWorld: Vector3): void {
    this.force.add(forceWorld);
    _tmp.crossVectors(offsetWorld, forceWorld); // Drehmoment in Welt
    this.worldToBody(_tmp, _tmp);
    this.torque.add(_tmp);
  }

  /** Vektor vom Körper- ins Welt-System drehen. */
  bodyToWorld(v: Vector3, out: Vector3): Vector3 {
    return out.copy(v).applyQuaternion(this.orientation);
  }

  /** Vektor vom Welt- ins Körper-System drehen. */
  worldToBody(v: Vector3, out: Vector3): Vector3 {
    _dq.copy(this.orientation).invert();
    return out.copy(v).applyQuaternion(_dq);
  }

  /** Winkelgeschwindigkeit im Welt-System. */
  angularVelocityWorld(out: Vector3): Vector3 {
    return this.bodyToWorld(this.angularVelocity, out);
  }

  /** Geschwindigkeit eines Punktes (Welt-Offset vom Schwerpunkt), Welt-System. */
  pointVelocity(offsetWorld: Vector3, out: Vector3): Vector3 {
    this.angularVelocityWorld(_tmp2);
    return out.crossVectors(_tmp2, offsetWorld).add(this.velocity);
  }

  /**
   * Impuls (Welt) an einem Punkt anwenden – ändert Geschwindigkeiten sofort.
   */
  applyImpulseAtWorldOffset(impulseWorld: Vector3, offsetWorld: Vector3): void {
    this.velocity.addScaledVector(impulseWorld, 1 / this.mass);
    _tmp.crossVectors(offsetWorld, impulseWorld);
    this.worldToBody(_tmp, _tmp);
    this.angularVelocity.x += _tmp.x * this.invInertia.x;
    this.angularVelocity.y += _tmp.y * this.invInertia.y;
    this.angularVelocity.z += _tmp.z * this.invInertia.z;
  }

  /**
   * Effektive inverse Masse in Richtung n für einen Punkt mit Welt-Offset r:
   * 1/m + n · ((I⁻¹ (r × n)) × r)
   */
  effectiveInverseMass(offsetWorld: Vector3, nWorld: Vector3): number {
    _tmp.crossVectors(offsetWorld, nWorld);
    this.worldToBody(_tmp, _tmp);
    _tmp.x *= this.invInertia.x;
    _tmp.y *= this.invInertia.y;
    _tmp.z *= this.invInertia.z;
    this.bodyToWorld(_tmp, _tmp);
    _tmp2.crossVectors(_tmp, offsetWorld);
    return 1 / this.mass + nWorld.dot(_tmp2);
  }

  /**
   * Semi-implizite Euler-Integration mit Euler-Kreiselgleichungen:
   *   I·dω/dt = τ − ω × (I·ω)
   * Die Orientierung wird über die exakte Quaternion-Exponentialabbildung fortgeschrieben.
   */
  integrate(dt: number): void {
    this.integrateVelocity(dt);
    this.integratePosition(dt);
  }

  /** Geschwindigkeiten aus den akkumulierten Kräften/Momenten fortschreiben. */
  integrateVelocity(dt: number): void {
    this.velocity.addScaledVector(this.force, dt / this.mass);

    // Rotation (Körper-System)
    const w = this.angularVelocity;
    const I = this.inertia;
    // Kreiselterm ω × (Iω)
    const gx = w.y * (I.z * w.z) - w.z * (I.y * w.y);
    const gy = w.z * (I.x * w.x) - w.x * (I.z * w.z);
    const gz = w.x * (I.y * w.y) - w.y * (I.x * w.x);
    w.x += (this.torque.x - gx) * this.invInertia.x * dt;
    w.y += (this.torque.y - gy) * this.invInertia.y * dt;
    w.z += (this.torque.z - gz) * this.invInertia.z * dt;
  }

  /** Position und Orientierung mit den aktuellen Geschwindigkeiten fortschreiben. */
  integratePosition(dt: number): void {
    this.position.addScaledVector(this.velocity, dt);
    integrateOrientation(this.orientation, this.angularVelocity, dt);
  }
}

/** q ← q ⊗ exp(ω·dt/2), ω im Körper-System. */
export function integrateOrientation(q: Quaternion, omegaBody: Vector3, dt: number): void {
  const wx = omegaBody.x,
    wy = omegaBody.y,
    wz = omegaBody.z;
  const mag = Math.hypot(wx, wy, wz);
  const angle = mag * dt;
  if (angle < 1e-12) return;
  const half = angle * 0.5;
  const s = Math.sin(half) / mag;
  _dq.set(wx * s, wy * s, wz * s, Math.cos(half));
  q.multiply(_dq).normalize();
}
