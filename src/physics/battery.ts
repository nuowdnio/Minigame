/**
 * Akkumodell (LiPo/Li-Ion): Leerlaufspannung abhängig vom Ladezustand, ohmscher Innenwiderstand
 * (sofortiger Spannungseinbruch unter Last) und ein RC-Glied für die Polarisation
 * (langsamer Einbruch, der sich nach Entlastung wieder erholt).
 *
 * Temperatur: Der Innenwiderstand verdoppelt sich etwa alle 20 K Abkühlung (kalter Akku = mehr Sag).
 * Der Akku erwärmt sich durch I²·R und kühlt über den Fahrtwind ab.
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
  /** Wärmekapazität des Packs (J/K). */
  heatCapacity: number;
  /** Wärmeabgabe im Stand (W/K). */
  coolingStill: number;
  /** Zusätzliche Wärmeabgabe pro m/s Fahrtwind (W/K pro m/s). */
  coolingPerSpeed: number;
}

/** Faktor des Innenwiderstands bei gegebener Zelltemperatur (1 bei 25 °C). */
export function resistanceTemperatureFactor(tempC: number): number {
  return Math.min(6, Math.max(0.5, Math.pow(2, (25 - tempC) / 20)));
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
  /** Zelltemperatur (°C). */
  temperatureC = 25;

  constructor(readonly params: BatteryParams) {
    this.soc = params.startSoc;
  }

  reset(ambientC = 25): void {
    this.soc = this.params.startSoc;
    this.polarizationVoltage = 0;
    this.current = 0;
    this.usedMah = 0;
    this.temperatureC = ambientC;
  }

  /** Aktueller ohmscher Innenwiderstand (Ω), temperaturabhängig. */
  resistance(): number {
    return this.params.internalResistance * resistanceTemperatureFactor(this.temperatureC);
  }

  /** Leerlaufspannung des gesamten Packs (V). */
  openCircuitVoltage(): number {
    return cellOpenCircuitVoltage(this.soc, this.params.ocvCurve) * this.params.cells;
  }

  /** Klemmenspannung bei gegebenem Laststrom (V). */
  terminalVoltage(current = this.current): number {
    const v = this.openCircuitVoltage() - current * this.resistance() - this.polarizationVoltage;
    return Math.max(0, v);
  }

  /** Spannung pro Zelle unter aktueller Last. */
  cellVoltage(): number {
    return this.terminalVoltage() / this.params.cells;
  }

  /**
   * Akku um dt Sekunden mit dem angegebenen Laststrom (ohne Grundverbrauch) entladen.
   */
  step(loadCurrent: number, dt: number, ambientC = 25, airspeed = 0): void {
    const p = this.params;
    const current = Math.max(0, loadCurrent) + p.idleCurrent;
    this.current = current;
    const dMah = (current * dt * 1000) / 3600;
    this.usedMah += dMah;
    this.soc = Math.max(0, this.soc - dMah / p.capacityMah);
    // RC-Glied: dVp/dt = (I·Rp − Vp) / τ, exakt diskretisiert
    const tf = resistanceTemperatureFactor(this.temperatureC);
    const target = current * p.polarizationResistance * tf;
    const a = 1 - Math.exp(-dt / p.polarizationTau);
    this.polarizationVoltage += (target - this.polarizationVoltage) * a;

    // Wärmebilanz: Verlustleistung I²R + Polarisation, Kühlung über Fahrtwind
    const heat = current * current * this.resistance() + current * this.polarizationVoltage;
    const cooling = (p.coolingStill + p.coolingPerSpeed * airspeed) * (this.temperatureC - ambientC);
    this.temperatureC += ((heat - cooling) / p.heatCapacity) * dt;
  }
}
