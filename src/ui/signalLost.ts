/**
 * Analoges FPV-Video: stufenloses Rauschen ("Schnee") und Bildstörungen bei schwachem Signal,
 * bei Verlust "KEIN SIGNAL".
 */
export class SignalLostOverlay {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly label: HTMLDivElement;
  private level = 0;
  private lost = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'signal-lost hidden';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 160;
    this.canvas.height = 90;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(160, 90);
    this.label = document.createElement('div');
    this.label.className = 'signal-lost-text';
    this.label.innerHTML = 'KEIN SIGNAL';
    this.el.append(this.canvas, this.label);
    parent.appendChild(this.el);
  }

  /**
   * @param level Rauschstärke 0..1
   * @param lost Verbindung weg (Vollbild-Rauschen mit Hinweis)
   * @param hint Zusatztext unter "KEIN SIGNAL"
   */
  set(level: number, lost: boolean, hint = ''): void {
    this.level = lost ? 1 : level;
    if (lost !== this.lost || hint) {
      this.label.innerHTML = `KEIN SIGNAL${hint ? `<br><small>${hint}</small>` : ''}`;
    }
    this.lost = lost;
    const show = this.level > 0.03;
    this.el.classList.toggle('hidden', !show);
    this.label.style.display = lost ? '' : 'none';
    this.canvas.style.opacity = String(lost ? 0.92 : Math.min(0.85, this.level ** 1.3 * 0.9));
  }

  /** Rauschbild neu zeichnen (nur wenn sichtbar). */
  update(): void {
    if (this.level <= 0.03) return;
    const d = this.img.data;
    const bright = 120 + 120 * this.level;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * bright;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    const bands = 1 + Math.floor(this.level * 4);
    for (let b = 0; b < bands; b++) {
      const y = Math.floor(Math.random() * 90);
      for (let x = 0; x < 160; x++) {
        const k = (y * 160 + x) * 4;
        d[k] = d[k + 1] = d[k + 2] = 235;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}
