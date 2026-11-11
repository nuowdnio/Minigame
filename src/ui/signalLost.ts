/**
 * Analoges FPV-Video ohne Signal: Rauschen ("Schnee") mit Hinweis, z. B. nachdem die Drohne explodiert ist.
 */
export class SignalLostOverlay {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'signal-lost hidden';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 160;
    this.canvas.height = 90;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(160, 90);
    const label = document.createElement('div');
    label.className = 'signal-lost-text';
    label.innerHTML = 'KEIN SIGNAL<br><small>Reset: R / ↺</small>';
    this.el.append(this.canvas, label);
    parent.appendChild(this.el);
  }

  set(show: boolean): void {
    if (show === this.visible) return;
    this.visible = show;
    this.el.classList.toggle('hidden', !show);
  }

  /** Rauschbild neu zeichnen (nur wenn sichtbar). */
  update(): void {
    if (!this.visible) return;
    const d = this.img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    // horizontale Störstreifen
    const band = Math.floor(Math.random() * 90);
    for (let x = 0; x < 160; x++) {
      const k = (band * 160 + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = 230;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}
