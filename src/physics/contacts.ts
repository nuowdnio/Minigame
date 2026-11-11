import { Vector3 } from 'three';
import type { ContactPointDef } from '../config/physics';
import type { CollisionWorld, ContactResult, ShapeTag } from '../world/collision';
import type { RigidBody } from './rigidbody';

export type { ContactPointDef };

export interface ContactParams {
  restitution: number;
  friction: number;
  positionCorrection: number;
  iterations: number;
  /** Rollwiderstandsbeiwert für Räder. */
  rollingResistance?: number;
}

export interface ContactPoint {
  position: Vector3;
  radius: number;
  wheel: boolean;
  steerable: boolean;
  /** Bauteil, zu dem der Kontaktpunkt gehört (für das Schadensmodell). */
  part: string;
  /** Rad ist abgebrochen -> verhält sich wie eine Kufe. */
  broken: boolean;
  /** Bauteil ist abgefallen -> Kontaktpunkt existiert nicht mehr. */
  removed: boolean;
}

export interface ContactOutput {
  /** Stärkster Aufprall (Normalgeschwindigkeit, m/s). */
  impactSpeed: number;
  onGround: boolean;
  /** Anzahl Räder mit Bodenkontakt. */
  wheelsOnGround: number;
  /** Aufprallgeschwindigkeit (Normalanteil, m/s) je Kontaktpunkt im letzten Schritt. */
  pointImpact?: number[];
  /** Tangentialgeschwindigkeit beim Aufprall je Kontaktpunkt (m/s). */
  pointSlide?: number[];
  /** Kontaktpunkt berührt gerade etwas. */
  pointTouching?: boolean[];
  /** Was berührt wird (z. B. ein Auto), je Kontaktpunkt. */
  pointTag?: (ShapeTag | null)[];
}

export function buildContactPoints(defs: ContactPointDef[]): ContactPoint[] {
  return defs.map((c, i) => ({
    position: new Vector3(c.position.x, c.position.y, c.position.z),
    radius: c.radius,
    wheel: !!c.wheel,
    steerable: !!c.steerable,
    part: c.part ?? `p${i}`,
    broken: false,
    removed: false,
  }));
}

const _r = new Vector3();
const _p = new Vector3();
const _vp = new Vector3();
const _vt = new Vector3();
const _j = new Vector3();
const _roll = new Vector3();
const _side = new Vector3();
/** Toleranz für ruhende Kontakte (m). */
const CONTACT_SLOP = 0.002;
const _contact: ContactResult = { normal: new Vector3(), depth: 0 };

/**
 * Kontakte per Impulsverfahren auflösen: Stoß mit Stoßzahl, Coulomb-Reibung,
 * Räder mit getrennter Roll-/Seitenreibung. Danach Positionskorrektur.
 * Muss zwischen Geschwindigkeits- und Positionsintegration aufgerufen werden.
 */
export function solveContacts(
  body: RigidBody,
  points: ContactPoint[],
  world: CollisionWorld,
  params: ContactParams,
  out: ContactOutput,
  steerAngle = 0,
): void {
  let maxImpact = 0;
  let onGround = false;
  let wheels = 0;
  const rollRes = params.rollingResistance ?? 0.04;
  const n = points.length;
  if (!out.pointImpact || out.pointImpact.length !== n) {
    out.pointImpact = new Array(n).fill(0);
    out.pointSlide = new Array(n).fill(0);
    out.pointTouching = new Array(n).fill(false);
    out.pointTag = new Array(n).fill(null);
  }
  out.pointTag!.fill(null);
  out.pointImpact.fill(0);
  out.pointSlide!.fill(0);
  out.pointTouching!.fill(false);

  for (let iter = 0; iter < params.iterations; iter++) {
    for (let pi = 0; pi < n; pi++) {
      const cp = points[pi];
      if (cp.removed) continue;
      _r.copy(cp.position).applyQuaternion(body.orientation);
      _p.copy(_r).add(body.position);
      // kleiner Toleranzbereich: ruhende Kontakte werden stabil erkannt (kein Flackern)
      const c = world.sphereContact(_p, cp.radius + CONTACT_SLOP, _contact);
      if (!c) continue;
      onGround = true;
      const nrm = c.normal;
      const depth = c.depth - CONTACT_SLOP;
      if (iter === 0) {
        if (depth > 0) body.position.addScaledVector(nrm, depth * params.positionCorrection);
        if (cp.wheel && !cp.broken) wheels++;
        out.pointTouching![pi] = true;
        out.pointTag![pi] = c.tag ?? null;
      }

      body.pointVelocity(_r, _vp);
      const vn = _vp.dot(nrm);
      if (vn >= 0) continue;
      if (iter === 0) {
        maxImpact = Math.max(maxImpact, -vn);
        out.pointImpact[pi] = -vn;
        out.pointSlide![pi] = Math.sqrt(Math.max(0, _vp.lengthSq() - vn * vn));
      }

      const e = -vn > 1.0 ? params.restitution : 0;
      const kn = body.effectiveInverseMass(_r, nrm);
      const jn = (-(1 + e) * vn) / kn;
      _j.copy(nrm).multiplyScalar(jn);
      body.applyImpulseAtWorldOffset(_j, _r);

      body.pointVelocity(_r, _vp);
      _vt.copy(_vp).addScaledVector(nrm, -_vp.dot(nrm));

      if (cp.wheel && !cp.broken) {
        // Rollrichtung = Körper-Längsachse (ggf. gelenkt), projiziert auf die Kontaktebene
        _roll.set(0, 0, -1);
        if (cp.steerable && steerAngle !== 0) {
          _roll.set(-Math.sin(-steerAngle), 0, -Math.cos(steerAngle));
        }
        _roll.applyQuaternion(body.orientation);
        _roll.addScaledVector(nrm, -_roll.dot(nrm));
        if (_roll.lengthSq() < 1e-6) continue;
        _roll.normalize();
        _side.crossVectors(nrm, _roll);
        frictionImpulse(body, _r, _roll, _vt.dot(_roll), rollRes * jn);
        body.pointVelocity(_r, _vp);
        frictionImpulse(body, _r, _side, _vp.dot(_side), params.friction * jn);
      } else {
        const vtLen = _vt.length();
        if (vtLen > 1e-6) {
          _vt.multiplyScalar(1 / vtLen);
          frictionImpulse(body, _r, _vt, vtLen, params.friction * jn);
        }
      }
    }
  }
  out.impactSpeed = maxImpact;
  out.onGround = onGround;
  out.wheelsOnGround = wheels;
}

function frictionImpulse(body: RigidBody, r: Vector3, dir: Vector3, v: number, maxImpulse: number): void {
  if (Math.abs(v) < 1e-7) return;
  const k = body.effectiveInverseMass(r, dir);
  const j = Math.sign(v) * Math.min(Math.abs(v) / k, maxImpulse);
  _j.copy(dir).multiplyScalar(-j);
  body.applyImpulseAtWorldOffset(_j, r);
}
