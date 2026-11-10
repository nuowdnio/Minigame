/**
 * LiPo-Akkumodell: Leerlaufspannung abhängig vom Ladezustand, ohmscher Innenwiderstand
 * (sofortiger Spannungseinbruch unter Last) und ein RC-Glied für die Polarisation
 * (langsamer Einbruch, der sich nach Entlastung wieder erholt).
 */

export interface BatteryParams {
  cells: number;
  capacityMah: number;
  internalResistance: number;
  polarizationResistance: number;
  polarizationTau: number;
  idleCurrent: number;
  startSoc: number;
  ocvCurve: [number, number][];
}

/** Leerlaufspannung einer Zelle bei gegebenem Ladezustand (lineare Interpolation). */
export function cellOpenCircuitVoltage(soc: number, curve: [number, number][]): number {
  if (soc <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [s1, v1] = curve[i];
    if (soc <= s1) {
      const [s0, v0] = curve[i - 1];
      const t = (soc - s0) / (s1 - s0);
      return v0 + (v1 - v0) * t;
    }
  }
  return curve[curve.length - 1][1];
}

export class Battery {
  /** Ladezustand 0..1. */
  soc: number;
  /** Spannung über dem Polarisations-RC-Glied (V). */
  polarizationVoltage = 0;
  /** Zuletzt gezogener Strom (A). */
  current = 0;
  /** Verbrauchte Ladung (mAh). */
  usedMah = 0;

  constructor(readonly params: BatteryParams) {
    this.soc = params.startSoc;
  }

  reset(): void {
    this.soc = this.params.startSoc;
    this.polarizationVoltage = 0;
    this.current = 0;
    this.usedMah = 0;
  }

  /** Leerlaufspannung des gesamten Packs (V). */
  openCircuitVoltage(): number {
    return cellOpenCircuitVoltage(this.soc, this.params.ocvCurve) * this.params.cells;
  }

  /** Klemmenspannung bei gegebenem Laststrom (V). */
  terminalVoltage(current = this.current): number {
    const v = this.openCircuitVoltage() - current * this.params.internalResistance - this.polarizationVoltage;
    return Math.max(0, v);
  }

  /** Spannung pro Zelle unter aktueller Last. */
  cellVoltage(): number {
    return this.terminalVoltage() / this.params.cells;
  }

  /**
   * Akku um dt Sekunden mit dem angegebenen Laststrom (ohne Grundverbrauch) entladen.
   */
  step(loadCurrent: number, dt: number): void {
    const p = this.params;
    const current = Math.max(0, loadCurrent) + p.idleCurrent;
    this.current = current;
    const dMah = (current * dt * 1000) / 3600;
    this.usedMah += dMah;
    this.soc = Math.max(0, this.soc - dMah / p.capacityMah);
    // RC-Glied: dVp/dt = (I·Rp − Vp) / τ, exakt diskretisiert
    const target = current * p.polarizationResistance;
    const a = 1 - Math.exp(-dt / p.polarizationTau);
    this.polarizationVoltage += (target - this.polarizationVoltage) * a;
  }
}
