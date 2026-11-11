import { Vector3 } from 'three';
import type { ContactResult, StaticWorld } from '../world/collision';
import type { MilitaryLayout } from '../world/military';
import { PlaneVehicle } from '../vehicles/planeVehicle';
import { QuadVehicle } from '../vehicles/quadVehicle';
import type { CargoDrop, Vehicle } from '../vehicles/vehicle';
import { AirDefenseSite, type DroneState } from './airDefense';
import { Convoy, type Hazard } from './convoy';
import { EnemyDrone } from './enemyDrones';
import { RadioLink, lineOfSight } from './radio';

export type GameMode = 'free' | 'convoy' | 'intercept';
export type MissionStatus = 'running' | 'success' | 'failed';

export interface MissionHooks {
  message(text: string, severity: 'info' | 'warn' | 'critical'): void;
  /** Visueller Effekt (Explosion, Absturz). */
  effect(kind: 'convoyHit' | 'enemyDown' | 'crateLanded', position: Vector3): void;
}

export interface Crate {
  position: Vector3;
  velocity: Vector3;
  mass: number;
  chuteArea: number;
  age: number;
  landed: boolean;
  chuteOpen: boolean;
  spin: number;
}

export const MISSIONS: { id: GameMode; name: string; briefing: string; vehicle: string | null }[] = [
  { id: 'free', name: 'Freiflug', briefing: '', vehicle: null },
  {
    id: 'convoy',
    name: 'Konvoi-Begleitung',
    briefing:
      'Ein Konvoi fährt durch die Stadt zur Flugplatzeinfahrt. Fliege voraus, finde Gefahren auf der Route und melde sie (M / 📡), bevor der Konvoi sie erreicht. Achtung: Störsender und Flugabwehr im Gebiet.',
    vehicle: null,
  },
  {
    id: 'intercept',
    name: 'Abfangjagd',
    briefing:
      'Vier gegnerische Aufklärungsdrohnen fliegen nacheinander ein. Finde sie (Wärmebild V / 🌡 hilft), verfolge sie und ramme sie mit der Abfangdrohne. Mindestens drei müssen abgefangen werden.',
    vehicle: 'interceptor',
  },
];

const _c: ContactResult = { normal: new Vector3(), depth: 0 };
const _dir = new Vector3();

/** Lautstärke eines Fluggeräts 0..1 (Motorleistung). */
export function vehicleNoise(v: Vehicle): number {
  if (v instanceof QuadVehicle) {
    const q = v.quad;
    let s = 0;
    for (const m of q.motors) s += (m.omega / q.omegaRef) ** 2;
    return Math.min(1, (s / q.motors.length) * 1.3 + 0.05);
  }
  if (v instanceof PlaneVehicle) {
    return Math.min(1, 0.08 + v.ctrl.output.throttle ** 2 * 0.7);
  }
  return 0.3;
}

/**
 * Militärischer Spielteil: Funkverbindung, Störsender, Flugabwehr, Konvoi, Aufklärer, Abwurfkisten
 * und die beiden Missionen.
 */
export class MilitaryGame {
  mode: GameMode = 'free';
  /** Gegner (Störsender, Flugabwehr) auch im Freiflug. */
  threatsInFree = false;
  status: MissionStatus = 'running';
  resultText = '';
  time = 0;
  readonly radio: RadioLink;
  readonly air: AirDefenseSite[];
  readonly convoy: Convoy;
  enemies: EnemyDrone[] = [];
  readonly crates: Crate[] = [];
  kills = 0;
  escaped = 0;
  private convoyStartTimer = 0;
  private announced = new Set<string>();
  private readonly convoyShapes: number[] = [];
  private readonly hazardShapes: number[] = [];

  constructor(
    readonly layout: MilitaryLayout,
    readonly world: StaticWorld,
    readonly hooks: MissionHooks,
  ) {
    this.radio = new RadioLink(new Vector3(), []);
    this.air = layout.airDefense.map((p) => new AirDefenseSite(p.clone()));
    this.convoy = new Convoy(layout.convoyRoute, layout.hazards);
    // Kollisionsformen: Stellungen, Störsender, Konvoi (beweglich), Gefahren
    for (const p of layout.airDefense) world.addCylinder(p.x, p.z, 0, 1.2, 2.6); // nur Sockel – Waffe selbst blockiert keine eigene Sichtlinie
    for (const j of layout.jammers) {
      world.addCylinder(j.position.x, j.position.z, 0, 14.5, 0.35);
      world.addBox(new Vector3(j.position.x + 2.5, 1.2, j.position.z), new Vector3(3, 2.4, 2.2), 0, false);
    }
    this.convoy.vehicles.forEach((v, i) => {
      const len = v.kind === 'truck' ? 7.4 : 4.6;
      const h = v.kind === 'truck' ? 3 : 2.2;
      this.convoyShapes.push(world.addBox(new Vector3(v.position.x, h / 2, v.position.z), new Vector3(2.5, h, len), v.yaw, false, { kind: 'convoy', id: i }));
    });
    for (const h of this.convoy.hazards) {
      const size = h.kind === 'roadblock' ? new Vector3(9.2, 1.3, 1.2) : h.kind === 'vehicle' ? new Vector3(4.4, 2.3, 1.9) : new Vector3(1.6, 1.2, 1);
      this.hazardShapes.push(world.addBox(new Vector3(h.position.x, size.y / 2, h.position.z), size, h.yaw, false));
    }
    this.syncShapes();
  }

  /** Konvoi- und Gefahren-Kollisionsformen an Missionszustand anpassen. */
  private syncShapes(): void {
    const on = this.mode === 'convoy';
    this.convoy.vehicles.forEach((v, i) => {
      this.world.setEnabled(this.convoyShapes[i], on);
      if (on) this.world.move(this.convoyShapes[i], v.position.x, v.position.z, v.yaw);
    });
    this.convoy.hazards.forEach((h, i) => this.world.setEnabled(this.hazardShapes[i], on && !h.cleared));
  }

  get threatsActive(): boolean {
    return this.mode !== 'free' || this.threatsInFree;
  }

  /** Startpunkt für die aktuelle Mission (null = Standard der Welt). */
  spawn(): { position: Vector3; yaw: number } | null {
    if (this.mode === 'convoy') return this.layout.spawns.convoy;
    if (this.mode === 'intercept') return this.layout.spawns.intercept;
    return null;
  }

  requiredVehicle(): string | null {
    return MISSIONS.find((m) => m.id === this.mode)?.vehicle ?? null;
  }

  /** Mission (neu) starten; station = Standort der Bodenstation. */
  reset(station: Vector3): void {
    this.status = 'running';
    this.resultText = '';
    this.time = 0;
    this.kills = 0;
    this.escaped = 0;
    this.announced.clear();
    this.radio.reset(station.clone().setY(station.y + 1.5));
    this.radio.jammers = this.threatsActive ? this.layout.jammers : [];
    for (const a of this.air) a.reset();
    this.convoy.reset();
    this.convoyStartTimer = 8;
    this.crates.length = 0;
    this.enemies =
      this.mode === 'intercept' ? this.layout.enemyRoutes.map((r, i) => new EnemyDrone(r, 4 + i * 22)) : [];
    this.syncShapes();
    const m = MISSIONS.find((x) => x.id === this.mode);
    if (m && m.briefing) this.hooks.message(`${m.name.toUpperCase()}: ${m.briefing}`, 'info');
  }

  update(dt: number, vehicle: Vehicle): void {
    this.time += dt;
    const pos = vehicle.body.position;
    this.radio.update(dt, pos, this.world);

    const drone: DroneState | null = vehicle.damage.destroyed
      ? null
      : { position: pos, velocity: vehicle.body.velocity, radius: Math.max(0.15, vehicle.size * 0.45), noise: vehicleNoise(vehicle), size: vehicle.size };

    if (this.threatsActive) {
      for (const a of this.air) {
        a.update(dt, drone, this.world, () => vehicle.applyHit());
        if (a.observer.detected && !this.announced.has(`aa${this.air.indexOf(a)}`) && a.fired > 0) {
          this.announced.add(`aa${this.air.indexOf(a)}`);
          this.hooks.message('Flugabwehr eröffnet das Feuer – in Deckung gehen!', 'critical');
        }
      }
      if (this.radio.noise > 0.5 && !this.announced.has('jam')) {
        this.announced.add('jam');
        this.hooks.message('Starke Störung – tiefer fliegen oder Störsender umfliegen', 'warn');
      }
      if (this.radio.lost && !this.announced.has('lost')) {
        this.announced.add('lost');
        this.hooks.message('Verbindung verloren – Failsafe', 'critical');
      }
      if (!this.radio.lost) this.announced.delete('lost');
    }

    this.updateCrates(dt);
    if (this.mode === 'convoy') this.updateConvoy(dt, vehicle);
    if (this.mode === 'intercept') this.updateIntercept(dt, vehicle);
  }

  private finish(status: MissionStatus, text: string): void {
    if (this.status !== 'running') return;
    this.status = status;
    this.resultText = text;
    this.hooks.message(text, status === 'success' ? 'info' : 'critical');
  }

  // ------------------------------------------------------------------ Konvoi
  private updateConvoy(dt: number, vehicle: Vehicle): void {
    const c = this.convoy;
    if (!c.started) {
      this.convoyStartTimer -= dt;
      if (this.convoyStartTimer <= 0) {
        c.started = true;
        this.hooks.message('Konvoi setzt sich in Bewegung', 'info');
      }
    }
    const events = c.update(dt);
    this.syncShapes();
    for (const ev of events) {
      if (ev.type === 'stopped') this.hooks.message('Konvoi hält – Gefahr wird geräumt', 'info');
      if (ev.type === 'cleared') this.hooks.message('Gefahr beseitigt – Konvoi fährt weiter', 'info');
      if (ev.type === 'hit') {
        this.hooks.effect('convoyHit', ev.vehicle.position);
        this.finish('failed', 'MISSION GESCHEITERT – der Konvoi ist in eine nicht gemeldete Gefahr geraten');
      }
      if (ev.type === 'arrived') {
        const rep = c.hazards.filter((h) => h.reported).length;
        this.finish('success', `MISSION ERFÜLLT – Konvoi angekommen (${rep}/${c.hazards.length} Gefahren gemeldet, ${Math.round(this.time)} s)`);
      }
    }
    if (vehicle.damage.destroyed && this.status === 'running') {
      this.finish('failed', 'MISSION GESCHEITERT – Aufklärungsdrohne verloren');
    }
  }

  /**
   * Gefahr melden: die Kamera muss auf die Gefahr zeigen, Sichtlinie haben und nah genug sein
   * (mit Zoom weiter).
   */
  report(camPos: Vector3, camDir: Vector3, zoom: number): string {
    if (this.mode !== 'convoy') return '';
    if (this.radio.lost) return 'Keine Verbindung – Meldung nicht möglich';
    const maxDist = 130 * Math.sqrt(zoom);
    const maxAngle = (16 / zoom + 2) * (Math.PI / 180);
    let best: Hazard | null = null;
    let bestAngle = Infinity;
    for (const h of this.convoy.hazards) {
      if (h.reported || h.cleared || h.triggered) continue;
      const target = h.position.clone().setY(1);
      const d = target.distanceTo(camPos);
      if (d > maxDist) continue;
      _dir.subVectors(target, camPos).normalize();
      const ang = _dir.angleTo(camDir);
      if (ang > maxAngle || ang > bestAngle) continue;
      // Sichtlinie zur Oberkante (die Gefahr selbst verdeckt ihren Mittelpunkt nicht)
      if (!lineOfSight(this.world, camPos, h.position.clone().setY(3), 2, 1)) continue;
      best = h;
      bestAngle = ang;
    }
    if (!best) return 'Nichts Verdächtiges im Bildzentrum';
    best.reported = true;
    const names = { roadblock: 'Straßensperre', object: 'Verdächtiges Objekt', vehicle: 'Verdächtiges Fahrzeug' };
    return `${names[best.kind]} gemeldet (${Math.round(best.position.distanceTo(camPos))} m)`;
  }

  // ------------------------------------------------------------------ Abfangjagd
  private updateIntercept(dt: number, vehicle: Vehicle): void {
    const pos = vehicle.body.position;
    const alive = !vehicle.damage.destroyed;
    for (const e of this.enemies) {
      const wasActive = e.active;
      e.update(dt, alive ? pos : null, vehicle.body.velocity.length(), vehicleNoise(vehicle), vehicle.size);
      if (!wasActive && e.active) this.hooks.message('Neuer Aufklärer im Anflug', 'warn');
      if (e.state === 'escaped' && !this.announced.has(`esc${this.enemies.indexOf(e)}`)) {
        this.announced.add(`esc${this.enemies.indexOf(e)}`);
        this.escaped++;
        this.hooks.message('Aufklärer entkommen', 'critical');
      }
      // Rammen
      if (alive && e.active && e.position.distanceTo(pos) < vehicle.size * 0.5 + 0.7) {
        const rel = vehicle.body.velocity.clone().sub(e.velocity);
        e.shootDown(rel);
        this.kills++;
        this.hooks.effect('enemyDown', e.position);
        this.hooks.message(`Aufklärer abgefangen! (${this.kills}/${this.enemies.length})`, 'info');
        // der Abfangjäger bekommt beim Rammen etwas ab
        if (vehicle instanceof QuadVehicle && vehicle.damageMode !== 'off') {
          const m = vehicle.quad.motors[Math.floor(Math.random() * vehicle.quad.motors.length)];
          m.health = Math.max(0.35, m.health - 0.35);
          m.imbalance = Math.min(1, m.imbalance + 0.35);
        }
      }
    }
    const remaining = this.enemies.filter((e) => e.state === 'waiting' || e.active).length;
    if (this.kills >= 3 && remaining === 0) this.finish('success', `MISSION ERFÜLLT – ${this.kills}/${this.enemies.length} Aufklärer abgefangen`);
    else if (this.escaped >= 2) this.finish('failed', 'MISSION GESCHEITERT – zu viele Aufklärer entkommen');
    else if (remaining === 0) this.finish(this.kills >= 3 ? 'success' : 'failed', `Einsatz beendet – ${this.kills}/${this.enemies.length} abgefangen`);
    else if (vehicle.damage.destroyed) this.finish('failed', 'MISSION GESCHEITERT – Abfangdrohne verloren');
    else if (this.time > 330) this.finish('failed', 'MISSION GESCHEITERT – Zeit abgelaufen');
  }

  /** Nächster aktiver Gegner (für die HUD-Anzeige). */
  nearestEnemy(pos: Vector3): EnemyDrone | null {
    let best: EnemyDrone | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (!e.active) continue;
      const d = e.position.distanceTo(pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ Versorgungskisten
  addCrate(drop: CargoDrop): void {
    this.crates.push({ ...drop, position: drop.position.clone(), velocity: drop.velocity.clone(), age: 0, landed: false, chuteOpen: false, spin: 0 });
  }

  private updateCrates(dt: number): void {
    for (const c of this.crates) {
      if (c.landed) continue;
      c.age += dt;
      if (!c.chuteOpen && c.age > 0.8) c.chuteOpen = true;
      const cda = c.chuteOpen ? c.chuteArea : 0.06;
      const sp = c.velocity.length();
      const drag = (0.5 * 1.2 * cda * sp) / c.mass;
      c.velocity.multiplyScalar(Math.max(0, 1 - drag * dt));
      c.velocity.y -= 9.81 * dt;
      c.position.addScaledVector(c.velocity, dt);
      c.spin += dt;
      if (c.position.y <= 0.3 || this.world.sphereContact(c.position, 0.3, _c)) {
        const impact = sp;
        c.landed = true;
        c.position.y = Math.max(c.position.y, 0.3);
        let best = Infinity;
        for (const z of this.layout.dropZones) best = Math.min(best, Math.hypot(z.x - c.position.x, z.z - c.position.z));
        const grade = best < 5 ? 'Volltreffer!' : best < 15 ? 'sehr gut' : best < 40 ? 'ok' : 'daneben';
        this.hooks.effect('crateLanded', c.position);
        this.hooks.message(
          `Kiste gelandet – ${best < 1000 ? Math.round(best) + ' m vom Abwurfpunkt (' + grade + ')' : ''}${impact > 9 ? ', beschädigt (zu hart)' : ''}`,
          best < 15 ? 'info' : 'warn',
        );
      }
    }
  }

  /** Höchste Entdeckungsstufe aller Flugabwehrstellungen (0..1). */
  alertLevel(): number {
    return this.threatsActive ? Math.max(0, ...this.air.map((a) => a.alert)) : 0;
  }
}
