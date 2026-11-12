import type { Vector3 } from 'three';
import type { MilitaryGame } from '../game/missions';

/**
 * Missions-HUD im OSD-Stil: Auftrag, Funkqualität (LQ), Entdeckung, Zoom/Wärmebild,
 * Ergebnisanzeige.
 */
export class MissionHud {
  private readonly el: HTMLDivElement;
  private readonly obj: HTMLDivElement;
  private readonly link: HTMLDivElement;
  private readonly result: HTMLDivElement;
  private acc = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'mission-hud';
    this.el.innerHTML = '<div class="mh-obj"></div><div class="mh-link"></div><div class="mh-result hidden"></div>';
    this.obj = this.el.querySelector('.mh-obj')!;
    this.link = this.el.querySelector('.mh-link')!;
    this.result = this.el.querySelector('.mh-result')!;
    parent.appendChild(this.el);
  }

  update(dt: number, g: MilitaryGame, pos: Vector3, heading: number, zoom: number, thermal: boolean): void {
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    // Funk / Entdeckung / Kamera
    const lq = Math.round(g.radio.quality * 100);
    const bar = (v: number) => '▮'.repeat(Math.round(v * 5)).padEnd(5, '▯');
    const lines = [`LQ ${String(lq).padStart(3)}% ${g.radio.lost ? 'FAILSAFE' : ''}`];
    if (g.threatsActive) {
      const a = g.alertLevel();
      lines.push(`ENTD ${bar(a)}${g.air.some((s) => s.observer.detected) ? ' !' : ''}`);
    }
    if (zoom > 1) lines.push(`ZOOM ${zoom}×`);
    if (g.swapProgress > 0) lines.push(`AKKUWECHSEL ${bar(g.swapProgress)}`);
    if (thermal) lines.push('WÄRMEBILD');
    this.link.textContent = lines.join('\n');
    this.link.classList.toggle('warn', g.radio.quality < 0.4);

    // Auftrag
    let o = '';
    if (g.mode === 'convoy') {
      const c = g.convoy;
      const pct = Math.round((c.leadS / c.path.length) * 100);
      const rep = c.hazards.filter((h) => h.reported).length;
      const next = c.nextHazard();
      o = `KONVOI ${pct}% · GEMELDET ${rep}/${c.hazards.length}`;
      if (!c.started) o += ` · ABFAHRT IN ${Math.max(0, Math.ceil(g.convoyStartTimer))} S`;
      else if (c.vehicles[0].damaged) o += ' · KONVOI GETROFFEN';
      else if (next && !next.reported) o += ` · GEFAHR VORAUS ${Math.round(next.s - c.leadS)} M`;
    } else if (g.mode === 'intercept') {
      o = `AUFKLÄRER ${g.kills}/${g.enemies.length} · ${Math.max(0, Math.round(330 - g.time))} S`;
      const e = g.nearestEnemy(pos);
      if (e) {
        const dx = e.position.x - pos.x,
          dz = e.position.z - pos.z;
        const d = Math.hypot(dx, dz);
        let rel = Math.atan2(-dx, -dz) - heading;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        const deg = Math.round((-rel * 180) / Math.PI);
        const dir = Math.abs(deg) < 8 ? 'VORAUS' : deg > 0 ? `${deg}° RECHTS` : `${-deg}° LINKS`;
        const dy = Math.round(e.position.y - pos.y);
        o += ` · ZIEL ${Math.round(Math.hypot(d, dy))} M ${dir} ${dy >= 0 ? '+' : ''}${dy} M`;
      }
    }
    this.obj.textContent = o;
    this.obj.style.display = o ? '' : 'none';

    if (g.status !== 'running' && g.mode !== 'free') {
      this.result.classList.remove('hidden');
      this.result.className = `mh-result ${g.status}`;
      this.result.innerHTML = `${g.resultText}<br><small>Neustart: R / ↺ · Menü: Esc / ⚙</small>`;
    } else {
      this.result.className = 'mh-result hidden';
    }
  }
}
