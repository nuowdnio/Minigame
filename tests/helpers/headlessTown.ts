import * as THREE from 'three';
import { buildTown } from '../../src/world/town';

/** Minimaler Canvas-Ersatz, damit die prozeduralen Texturen ohne Browser erzeugt werden können. */
function stubDocument(): void {
  const g = globalThis as unknown as { document?: unknown };
  if (g.document) return;
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
        if (key === 'getImageData' || key === 'createImageData') return (_x: number, _y: number, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        if (key === 'measureText') return () => ({ width: 10 });
        return () => undefined;
      },
      set: () => true,
    },
  );
  g.document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }),
  };
}

/** Kleinstadt ohne Browser aufbauen (nur Geometrie + Kollisionswelt). */
export function headlessTown() {
  stubDocument();
  return buildTown(new THREE.Scene(), false);
}
