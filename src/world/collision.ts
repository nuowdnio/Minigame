import { Vector3 } from 'three';

/** Ergebnis einer Kontaktabfrage für eine Kugel. */
export interface ContactResult {
  /** Kontaktnormale (Welt), zeigt vom Hindernis weg. */
  normal: Vector3;
  /** Eindringtiefe (m), > 0 bei Kontakt. */
  depth: number;
}

/**
 * Abstraktion der statischen Welt-Geometrie für die Drohnenphysik.
 * Meilenstein 1: Ebene + Quader. Später: Rapier-basierte Implementierung.
 */
export interface CollisionWorld {
  /** Kontakt einer Kugel (Mittelpunkt, Radius) mit der Welt, oder null. */
  sphereContact(center: Vector3, radius: number, out: ContactResult): ContactResult | null;
  /** Höhe des Bodens bzw. nächsten Hindernisses senkrecht unter dem Punkt (für Bodeneffekt). */
  heightAbove(point: Vector3, maxDistance: number): number;
}

export interface Box {
  min: Vector3;
  max: Vector3;
}

/** Einfache Kollisionswelt: unendliche Bodenebene bei y = groundY plus achsenparallele Quader. */
export class SimpleCollisionWorld implements CollisionWorld {
  readonly boxes: Box[] = [];

  constructor(public groundY = 0) {}

  addBox(center: Vector3, size: Vector3): void {
    const half = size.clone().multiplyScalar(0.5);
    this.boxes.push({ min: center.clone().sub(half), max: center.clone().add(half) });
  }

  sphereContact(c: Vector3, r: number, out: ContactResult): ContactResult | null {
    let best: ContactResult | null = null;
    let bestDepth = 0;

    const dGround = this.groundY + r - c.y;
    if (dGround > 0) {
      out.normal.set(0, 1, 0);
      out.depth = dGround;
      best = out;
      bestDepth = dGround;
    }

    for (const b of this.boxes) {
      // Nächster Punkt auf dem Quader
      const px = Math.max(b.min.x, Math.min(c.x, b.max.x));
      const py = Math.max(b.min.y, Math.min(c.y, b.max.y));
      const pz = Math.max(b.min.z, Math.min(c.z, b.max.z));
      const dx = c.x - px,
        dy = c.y - py,
        dz = c.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      let depth: number;
      let nx: number, ny: number, nz: number;
      if (d2 > 1e-12) {
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        depth = r - d;
        nx = dx / d;
        ny = dy / d;
        nz = dz / d;
      } else {
        // Mittelpunkt im Quader: kürzester Weg nach außen
        const cand = [
          [c.x - b.min.x, -1, 0, 0],
          [b.max.x - c.x, 1, 0, 0],
          [c.y - b.min.y, 0, -1, 0],
          [b.max.y - c.y, 0, 1, 0],
          [c.z - b.min.z, 0, 0, -1],
          [b.max.z - c.z, 0, 0, 1],
        ];
        cand.sort((a, b2) => a[0] - b2[0]);
        const [dist, x, y, z] = cand[0];
        depth = dist + r;
        nx = x;
        ny = y;
        nz = z;
      }
      if (depth > bestDepth) {
        bestDepth = depth;
        out.normal.set(nx, ny, nz);
        out.depth = depth;
        best = out;
      }
    }
    return best;
  }

  heightAbove(p: Vector3, maxDistance: number): number {
    let h = p.y - this.groundY;
    for (const b of this.boxes) {
      if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z && p.y >= b.max.y) {
        h = Math.min(h, p.y - b.max.y);
      }
    }
    return Math.min(h, maxDistance);
  }
}
