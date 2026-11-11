import { Vector3 } from 'three';

/** Kennzeichnung einer Form (z. B. welches Auto getroffen wurde). */
export interface ShapeTag {
  kind: 'car' | 'convoy';
  id: number;
}

/** Ergebnis einer Kontaktabfrage für eine Kugel. */
export interface ContactResult {
  /** Kontaktnormale (Welt), zeigt vom Hindernis weg. */
  normal: Vector3;
  /** Eindringtiefe (m), > 0 bei Kontakt. */
  depth: number;
  /** Getroffene Form (null = Boden oder ohne Kennzeichnung). */
  tag?: ShapeTag | null;
}

/** Statische Welt-Geometrie für die Fluggeräte-Physik. */
export interface CollisionWorld {
  /** Kontakt einer Kugel (Mittelpunkt, Radius) mit der Welt, oder null. */
  sphereContact(center: Vector3, radius: number, out: ContactResult): ContactResult | null;
  /** Abstand zum Boden bzw. zum nächsten Hindernis senkrecht unter dem Punkt (für Bodeneffekt). */
  heightAbove(point: Vector3, maxDistance: number): number;
}

/** Achsenparalleler Hüllquader (z. B. für Windschatten). */
export interface Box {
  min: Vector3;
  max: Vector3;
}

/**
 * Gerades Prisma: konvexes 2D-Profil (Querschnitt in der lokalen z/y-Ebene, gegen den
 * Uhrzeigersinn), entlang der lokalen x-Achse extrudiert, um die Hochachse gedreht.
 * Quader = Rechteck-Profil, Satteldach = Dreieck-Profil.
 */
export interface PrismShape {
  kind: 'prism';
  cx: number;
  cz: number;
  /** Unterkante (y) des Profils. */
  y0: number;
  /** Drehung um die Hochachse (rad), wie Object3D.rotation.y. */
  yaw: number;
  /** Halbe Länge entlang der lokalen x-Achse. */
  halfLength: number;
  /** Profilpunkte [z, y] relativ zu (cz, y0), konvex, gegen den Uhrzeigersinn. */
  profile: [number, number][];
}

/** Senkrechter Zylinder (Masten, Baumstämme, Türme, Tanks). */
export interface CylinderShape {
  kind: 'cylinder';
  cx: number;
  cz: number;
  y0: number;
  y1: number;
  radius: number;
}

/** Kugel (Baumkronen, Kuppeln). */
export interface SphereShape {
  kind: 'sphere';
  center: Vector3;
  radius: number;
}

export type Shape = PrismShape | CylinderShape | SphereShape;

interface Entry {
  cells: number[];
  shape: Shape;
  aabb: Box;
  /** Zählt als Windhindernis (Gebäude). */
  windBlocking: boolean;
  tag: ShapeTag | null;
  enabled: boolean;
}

const _local = { x: 0, y: 0, z: 0 };

/**
 * Kollisionswelt aus Bodenebene und statischen Formen, mit räumlichem Raster
 * für schnelle Abfragen auch bei vielen Objekten (Stadt).
 */
export class StaticWorld implements CollisionWorld {
  private readonly entries: Entry[] = [];
  private readonly grid = new Map<number, number[]>();
  private readonly cell: number;
  private queryId = 0;
  private readonly stamp: number[] = [];

  constructor(
    public groundY = 0,
    cellSize = 16,
  ) {
    this.cell = cellSize;
  }

  get shapeCount(): number {
    return this.entries.length;
  }

  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  /** Form hinzufügen; gibt eine Kennung zurück (für setEnabled). */
  add(shape: Shape, windBlocking = false, tag: ShapeTag | null = null): number {
    const aabb = shapeAabb(shape);
    const idx = this.entries.length;
    this.entries.push({ shape, aabb, windBlocking, tag, enabled: true, cells: [] });
    this.stamp.push(-1);
    this.insert(idx);
    return idx;
  }

  private insert(idx: number): void {
    const e = this.entries[idx];
    const c = this.cell;
    const aabb = e.aabb;
    for (let ix = Math.floor(aabb.min.x / c); ix <= Math.floor(aabb.max.x / c); ix++) {
      for (let iz = Math.floor(aabb.min.z / c); iz <= Math.floor(aabb.max.z / c); iz++) {
        const k = this.key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(idx);
        e.cells.push(k);
      }
    }
  }

  /** Bewegliches Prisma (z. B. Konvoi-Fahrzeug) versetzen und im Raster neu einsortieren. */
  move(id: number, cx: number, cz: number, yaw: number): void {
    const e = this.entries[id];
    if (!e || e.shape.kind !== 'prism') return;
    for (const k of e.cells) {
      const list = this.grid.get(k);
      if (list) {
        const i = list.indexOf(id);
        if (i >= 0) list.splice(i, 1);
      }
    }
    e.cells.length = 0;
    e.shape.cx = cx;
    e.shape.cz = cz;
    e.shape.yaw = yaw;
    e.aabb = shapeAabb(e.shape);
    this.insert(id);
  }

  /** Form ein-/ausschalten (z. B. zerstörte Objekte). */
  setEnabled(id: number, enabled: boolean): void {
    if (this.entries[id]) this.entries[id].enabled = enabled;
  }

  /** Quader (Mittelpunkt, Größe, Drehung um die Hochachse). */
  addBox(center: Vector3, size: Vector3, yaw = 0, windBlocking = true, tag: ShapeTag | null = null): number {
    const hz = size.z / 2;
    return this.add(
      {
        kind: 'prism',
        cx: center.x,
        cz: center.z,
        y0: center.y - size.y / 2,
        yaw,
        halfLength: size.x / 2,
        profile: [
          [-hz, 0],
          [hz, 0],
          [hz, size.y],
          [-hz, size.y],
        ],
      },
      windBlocking,
      tag,
    );
  }

  /** Satteldach: First entlang der lokalen x-Achse. */
  addGableRoof(cx: number, cz: number, y0: number, yaw: number, length: number, width: number, height: number): void {
    this.add(
      {
        kind: 'prism',
        cx,
        cz,
        y0,
        yaw,
        halfLength: length / 2,
        profile: [
          [-width / 2, 0],
          [width / 2, 0],
          [0, height],
        ],
      },
      true,
    );
  }

  addCylinder(cx: number, cz: number, y0: number, y1: number, radius: number, windBlocking = false): void {
    this.add({ kind: 'cylinder', cx, cz, y0, y1, radius }, windBlocking);
  }

  addSphere(center: Vector3, radius: number): void {
    this.add({ kind: 'sphere', center: center.clone(), radius });
  }

  /** Hüllquader der Gebäude (für den Windschatten). */
  windObstacles(): Box[] {
    return this.entries.filter((e) => e.windBlocking).map((e) => e.aabb);
  }

  /** Alle Hüllquader (Rückwärtskompatibilität). */
  get boxes(): Box[] {
    return this.windObstacles();
  }

  /** Kandidaten im Raster um einen Punkt (Radius r) aufrufen. */
  private forCandidates(p: Vector3, r: number, fn: (e: Entry) => void): void {
    const c = this.cell;
    const id = ++this.queryId;
    const x0 = Math.floor((p.x - r) / c),
      x1 = Math.floor((p.x + r) / c);
    const z0 = Math.floor((p.z - r) / c),
      z1 = Math.floor((p.z + r) / c);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const i of list) {
          if (this.stamp[i] === id) continue;
          this.stamp[i] = id;
          const e = this.entries[i];
          if (!e.enabled) continue;
          const b = e.aabb;
          if (
            p.x + r < b.min.x ||
            p.x - r > b.max.x ||
            p.z + r < b.min.z ||
            p.z - r > b.max.z ||
            p.y + r < b.min.y ||
            p.y - r > b.max.y
          )
            continue;
          fn(e);
        }
      }
    }
  }

  sphereContact(c: Vector3, r: number, out: ContactResult): ContactResult | null {
    let best: ContactResult | null = null;
    let bestDepth = 0;
    const dGround = this.groundY + r - c.y;
    out.tag = null;
    if (dGround > 0) {
      out.normal.set(0, 1, 0);
      out.depth = dGround;
      best = out;
      bestDepth = dGround;
    }
    this.forCandidates(c, r, (e) => {
      const res = shapeContact(e.shape, c, r);
      if (res && res.depth > bestDepth) {
        bestDepth = res.depth;
        out.normal.set(res.nx, res.ny, res.nz);
        out.depth = res.depth;
        out.tag = e.tag;
        best = out;
      }
    });
    return best;
  }

  heightAbove(p: Vector3, maxDistance: number): number {
    let h = p.y - this.groundY;
    const c = this.cell;
    const list = this.grid.get(this.key(Math.floor(p.x / c), Math.floor(p.z / c)));
    if (list) {
      for (const i of list) {
        if (!this.entries[i].enabled) continue;
        const top = shapeTopAt(this.entries[i].shape, p.x, p.z);
        if (top !== null && p.y >= top) h = Math.min(h, p.y - top);
      }
    }
    return Math.min(h, maxDistance);
  }
}

/** Rückwärtskompatibler Name. */
export { StaticWorld as SimpleCollisionWorld };

// --------------------------------------------------------------------------
// Geometrie der Formen
// --------------------------------------------------------------------------

function toLocal(s: PrismShape, x: number, y: number, z: number): void {
  const dx = x - s.cx;
  const dz = z - s.cz;
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  _local.x = dx * c - dz * sn;
  _local.z = dx * sn + dz * c;
  _local.y = y - s.y0;
}

export function shapeAabb(s: Shape): Box {
  if (s.kind === 'sphere') {
    const r = new Vector3(s.radius, s.radius, s.radius);
    return { min: s.center.clone().sub(r), max: s.center.clone().add(r) };
  }
  if (s.kind === 'cylinder') {
    return {
      min: new Vector3(s.cx - s.radius, s.y0, s.cz - s.radius),
      max: new Vector3(s.cx + s.radius, s.y1, s.cz + s.radius),
    };
  }
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const lx of [-s.halfLength, s.halfLength]) {
    for (const [lz, ly] of s.profile) {
      const wx = s.cx + lx * c + lz * sn;
      const wz = s.cz - lx * sn + lz * c;
      const wy = s.y0 + ly;
      min.set(Math.min(min.x, wx), Math.min(min.y, wy), Math.min(min.z, wz));
      max.set(Math.max(max.x, wx), Math.max(max.y, wy), Math.max(max.z, wz));
    }
  }
  return { min, max };
}

interface Hit {
  nx: number;
  ny: number;
  nz: number;
  depth: number;
}
const _hit: Hit = { nx: 0, ny: 0, nz: 0, depth: 0 };

/** Kontakt Kugel ↔ Form (Normale zeigt von der Form weg). */
export function shapeContact(s: Shape, p: Vector3, r: number): Hit | null {
  if (s.kind === 'sphere') {
    const dx = p.x - s.center.x,
      dy = p.y - s.center.y,
      dz = p.z - s.center.z;
    const d = Math.hypot(dx, dy, dz);
    if (d >= s.radius + r) return null;
    if (d < 1e-9) return set(0, 1, 0, s.radius + r);
    return set(dx / d, dy / d, dz / d, s.radius + r - d);
  }
  if (s.kind === 'cylinder') {
    const dx = p.x - s.cx,
      dz = p.z - s.cz;
    const rd = Math.hypot(dx, dz);
    const inR = rd <= s.radius;
    const inY = p.y >= s.y0 && p.y <= s.y1;
    if (inR && inY) {
      // innen: kürzester Weg nach außen
      const side = s.radius - rd;
      const top = s.y1 - p.y;
      const bottom = p.y - s.y0;
      if (top <= side && top <= bottom) return set(0, 1, 0, top + r);
      if (bottom <= side) return set(0, -1, 0, bottom + r);
      return rd > 1e-9 ? set(dx / rd, 0, dz / rd, side + r) : set(1, 0, 0, side + r);
    }
    const qx = inR ? p.x : s.cx + (dx / rd) * s.radius;
    const qz = inR ? p.z : s.cz + (dz / rd) * s.radius;
    const qy = Math.max(s.y0, Math.min(s.y1, p.y));
    const ex = p.x - qx,
      ey = p.y - qy,
      ez = p.z - qz;
    const d = Math.hypot(ex, ey, ez);
    if (d >= r || d < 1e-12) return null;
    return set(ex / d, ey / d, ez / d, r - d);
  }

  // Prisma
  toLocal(s, p.x, p.y, p.z);
  const lx = _local.x,
    ly = _local.y,
    lz = _local.z;
  const prof = s.profile;
  const n = prof.length;
  // 2D: Inside-Test und nächster Randpunkt
  let inside = true;
  let bestD2 = Infinity;
  let qz = 0,
    qy = 0,
    enz = 0,
    eny = 0;
  for (let i = 0; i < n; i++) {
    const [az, ay] = prof[i];
    const [bz, by] = prof[(i + 1) % n];
    const ez = bz - az,
      ey = by - ay;
    // Außennormale (Profil gegen den Uhrzeigersinn in (z, y))
    const len = Math.hypot(ez, ey);
    const onz = ey / len,
      ony = -ez / len;
    const side = (lz - az) * onz + (ly - ay) * ony;
    if (side > 0) inside = false;
    let t = ((lz - az) * ez + (ly - ay) * ey) / (len * len);
    t = Math.max(0, Math.min(1, t));
    const cz = az + ez * t,
      cy = ay + ey * t;
    const d2 = (lz - cz) ** 2 + (ly - cy) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      qz = cz;
      qy = cy;
      enz = onz;
      eny = ony;
    }
  }
  const hl = s.halfLength;
  const inX = Math.abs(lx) <= hl;
  let nlx: number, nly: number, nlz: number, depth: number;
  if (inside && inX) {
    const dEdge = Math.sqrt(bestD2);
    const dCap = hl - Math.abs(lx);
    if (dEdge <= dCap) {
      nlx = 0;
      nly = eny;
      nlz = enz;
      depth = dEdge + r;
    } else {
      nlx = Math.sign(lx) || 1;
      nly = 0;
      nlz = 0;
      depth = dCap + r;
    }
  } else {
    const cx = inX ? lx : Math.sign(lx) * hl;
    const cy = inside ? ly : qy;
    const cz = inside ? lz : qz;
    const ex = lx - cx,
      ey = ly - cy,
      ez = lz - cz;
    const d = Math.hypot(ex, ey, ez);
    if (d >= r || d < 1e-12) return null;
    nlx = ex / d;
    nly = ey / d;
    nlz = ez / d;
    depth = r - d;
  }
  // zurück in Weltkoordinaten
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  return set(nlx * c + nlz * sn, nly, -nlx * sn + nlz * c, depth);
}

function set(nx: number, ny: number, nz: number, depth: number): Hit {
  _hit.nx = nx;
  _hit.ny = ny;
  _hit.nz = nz;
  _hit.depth = depth;
  return _hit;
}

/** Oberkante einer Form an der Stelle (x, z), oder null wenn außerhalb. */
export function shapeTopAt(s: Shape, x: number, z: number): number | null {
  if (s.kind === 'sphere') {
    const d2 = (x - s.center.x) ** 2 + (z - s.center.z) ** 2;
    if (d2 > s.radius * s.radius) return null;
    return s.center.y + Math.sqrt(s.radius * s.radius - d2);
  }
  if (s.kind === 'cylinder') {
    return Math.hypot(x - s.cx, z - s.cz) <= s.radius ? s.y1 : null;
  }
  toLocal(s, x, 0, z);
  if (Math.abs(_local.x) > s.halfLength) return null;
  const lz = _local.z;
  let top: number | null = null;
  const prof = s.profile;
  for (let i = 0; i < prof.length; i++) {
    const [az, ay] = prof[i];
    const [bz, by] = prof[(i + 1) % prof.length];
    if ((lz < Math.min(az, bz)) || (lz > Math.max(az, bz)) || az === bz) continue;
    const y = ay + ((lz - az) / (bz - az)) * (by - ay);
    if (top === null || y > top) top = y;
  }
  return top === null ? null : s.y0 + top;
}
