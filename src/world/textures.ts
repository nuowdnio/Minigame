import * as THREE from 'three';
import { rng } from './random';

/** Prozedurale Canvas-Texturen für die Stadt (keine externen Dateien). */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, seed: number, dark = true): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const v = dark ? Math.floor(r() * 60) : 200 + Math.floor(r() * 55);
    g.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

/**
 * Fassadenmodul: eine Fensterachse × ein Stockwerk (Wandfarbe weiß, wird per Vertexfarbe eingefärbt).
 * Ein Modul entspricht in der Welt 3.2 m × 3 m.
 */
export function facadeTexture(kind: 'house' | 'apartment' | 'office' | 'shop'): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, 128, 128);
  noise(g, 128, 128, 400, 0.15, 3);
  if (kind === 'office') {
    // Glasfassade mit Pfosten und Riegeln
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#5d7a96');
    grad.addColorStop(1, '#2c3e52');
    g.fillStyle = grad;
    g.fillRect(4, 10, 120, 108);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(8, 14, 30, 100);
    g.fillStyle = '#c8ccd0';
    g.fillRect(62, 10, 4, 108);
    g.fillRect(0, 0, 128, 10);
  } else if (kind === 'shop') {
    // Schaufenster mit Tür
    g.fillStyle = '#2f3b46';
    g.fillRect(10, 30, 108, 98);
    g.fillStyle = 'rgba(255,240,200,0.35)';
    g.fillRect(14, 34, 64, 90);
    g.fillStyle = '#5a4030';
    g.fillRect(84, 40, 30, 88);
    g.fillStyle = '#d9d9d9';
    g.fillRect(0, 22, 128, 8);
  } else {
    // Fenster mit Rahmen, Sprossen und Fensterbank
    const big = kind === 'apartment';
    const x0 = big ? 22 : 34,
      x1 = big ? 106 : 94,
      y0 = 30,
      y1 = 100;
    g.fillStyle = '#ffffff';
    g.fillRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, '#7f97ad');
    grad.addColorStop(1, '#3a4b5c');
    g.fillStyle = grad;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(x0 + 4, y0 + 4, (x1 - x0) * 0.3, (y1 - y0) * 0.8);
    g.fillStyle = '#ffffff';
    g.fillRect((x0 + x1) / 2 - 2, y0, 4, y1 - y0);
    if (!big) g.fillRect(x0, (y0 + y1) / 2 - 2, x1 - x0, 4);
    g.fillStyle = '#bdbdbd';
    g.fillRect(x0 - 8, y1 + 4, x1 - x0 + 16, 6);
    if (big) {
      // Balkongeländer
      g.fillStyle = 'rgba(80,80,80,0.85)';
      g.fillRect(x0 - 10, y1 - 22, x1 - x0 + 20, 4);
      for (let x = x0 - 10; x <= x1 + 10; x += 8) g.fillRect(x, y1 - 22, 2, 30);
    }
  }
  return finish(c);
}

export function roofTileTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const x = col * 16 + (row % 2) * 8;
      const y = row * 16;
      const shade = 200 + ((row * 7 + col * 13) % 40);
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.beginPath();
      g.roundRect(x + 1, y + 1, 14, 15, 5);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + 1, y + 13, 14, 3);
    }
  }
  return finish(c);
}

export function flatRoofTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#8a8a86';
  g.fillRect(0, 0, 128, 128);
  noise(g, 128, 128, 2500, 0.35, 11);
  noise(g, 128, 128, 800, 0.2, 12, false);
  return finish(c);
}

export function grassTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#5a7a3c';
  g.fillRect(0, 0, 512, 512);
  const r = rng(21);
  for (let i = 0; i < 9000; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(70,100,40,${0.3 * r()})` : `rgba(120,150,70,${0.3 * r()})`;
    g.fillRect(r() * 512, r() * 512, 2 + r() * 3, 2 + r() * 3);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${90 + r() * 40},${110 + r() * 30},50,0.12)`;
    g.beginPath();
    g.arc(r() * 512, r() * 512, 20 + r() * 60, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c);
}

export function asphaltTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#4b4e52';
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 6000, 0.4, 31);
  noise(g, 256, 256, 1500, 0.25, 32, false);
  return finish(c);
}

export function pavementTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#b9b3a8';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(80,70,60,0.45)';
  g.lineWidth = 2;
  for (let y = 0; y <= 128; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(128, y);
    g.stroke();
    for (let x = (y / 32) % 2 ? 16 : 0; x <= 128; x += 32) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 32);
      g.stroke();
    }
  }
  noise(g, 128, 128, 600, 0.2, 41);
  return finish(c);
}

/** Fußballfeld 105 × 68 m mit Linien. */
export function pitchTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 664);
  const sx = 1024 / 105,
    sy = 664 / 68;
  for (let i = 0; i < 12; i++) {
    g.fillStyle = i % 2 ? '#3f8a3a' : '#479a41';
    g.fillRect((i * 1024) / 12, 0, 1024 / 12 + 1, 664);
  }
  g.strokeStyle = '#ffffff';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 1020, 660);
  g.beginPath();
  g.moveTo(512, 0);
  g.lineTo(512, 664);
  g.stroke();
  g.beginPath();
  g.arc(512, 332, 9.15 * sx, 0, Math.PI * 2);
  g.stroke();
  for (const side of [0, 1]) {
    const x = side ? 1024 - 16.5 * sx : 0;
    g.strokeRect(x, 332 - 20.16 * sy, 16.5 * sx, 40.32 * sy);
    const x2 = side ? 1024 - 5.5 * sx : 0;
    g.strokeRect(x2, 332 - 9.16 * sy, 5.5 * sx, 18.32 * sy);
  }
  return finish(c);
}

/** Pistenkennung (z. B. "36") als Textur. */
export function runwayNumberTexture(text: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 512);
  g.clearRect(0, 0, 256, 512);
  g.fillStyle = '#f4f4f4';
  g.font = 'bold 300px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  g.translate(128, 256);
  g.scale(0.55, 1.4);
  g.fillText(text, 0, 0);
  g.restore();
  const t = finish(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Schild mit Text (z. B. Ortsschild, Hangar-Beschriftung). */
export function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const [c, g] = canvas(512, 128);
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = fg;
  g.font = 'bold 72px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = finish(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
