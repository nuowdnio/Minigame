/**
 * Schadensmodell: Ereignisse, Zustand und gemeinsame Hilfen für Drohnen und Flugzeuge.
 *
 * Ursachen:
 *  - Aufprall (Normalgeschwindigkeit am Kontaktpunkt) → Propeller, Arm, Flügel, Fahrwerk, Rahmen
 *  - Propeller schleift bei laufendem Motor → Propeller nutzt sich ab, Unwucht
 *  - Überlast: Motor/Regler überhitzen (Strom), Akku überhitzt/tiefentladen
 *  - Flugzeug: Lastvielfaches über der Bruchgrenze, Überschreiten von V_NE (Flattern)
 */
import type { Battery } from '../physics/battery';
import type { Motor } from '../physics/motor';

export type DamageMode = 'off' | 'realistic' | 'robust';

export interface DamageEvent {
  text: string;
  severity: 'info' | 'warn' | 'critical';
}

/** Schwellen-Multiplikator je Schadensmodus. */
export function damageScale(mode: DamageMode): number {
  return mode === 'robust' ? 1.7 : mode === 'off' ? Infinity : 1;
}

export class DamageState {
  destroyed = false;
  /** Abgebrochene / zerstörte Teile (für Darstellung und Trümmer). */
  readonly brokenParts = new Set<string>();
  /** Teile, die rauchen (durchgebrannte Motoren, Akku). */
  readonly smoking = new Set<string>();
  /** Neue Ereignisse seit dem letzten Abholen. */
  private pending: DamageEvent[] = [];
  private readonly once = new Set<string>();
  /** Bauteilzustände für die Anzeige (0..1). */
  readonly parts = new Map<string, number>();

  reset(): void {
    this.destroyed = false;
    this.brokenParts.clear();
    this.smoking.clear();
    this.pending = [];
    this.once.clear();
    this.parts.clear();
  }

  emit(text: string, severity: DamageEvent['severity'] = 'warn', key = text): void {
    if (this.once.has(key)) return;
    this.once.add(key);
    this.pending.push({ text, severity });
  }

  break(part: string, text: string, severity: DamageEvent['severity'] = 'warn'): void {
    if (this.brokenParts.has(part)) return;
    this.brokenParts.add(part);
    this.emit(text, severity, `break:${part}`);
  }

  destroy(text: string): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit(text, 'critical', 'destroyed');
  }

  takeEvents(): DamageEvent[] {
    const e = this.pending;
    this.pending = [];
    return e;
  }

  /** Thermische Ausfälle von Motoren/Reglern melden. */
  checkMotor(m: Motor, name: string, partKey: string): void {
    if (m.failure === 'motor') {
      this.smoking.add(partKey);
      this.emit(`${name}: Wicklung durchgebrannt (${Math.round(m.motorTemp)} °C)`, 'critical', `motor:${partKey}`);
    } else if (m.failure === 'esc') {
      this.smoking.add(partKey);
      this.emit(`${name}: Regler durchgebrannt (Überstrom)`, 'critical', `esc:${partKey}`);
    } else if (m.motorTemp > m.params.motorMaxTemp - 40) {
      this.emit(`${name}: Motor sehr heiß (${Math.round(m.motorTemp)} °C)`, 'warn', `hot:${partKey}`);
    }
  }

  /** Akku: Überhitzung (aufgebläht, Brand) und Tiefentladung. */
  checkBattery(b: Battery): void {
    const cell = b.openCircuitVoltage() / b.params.cells;
    const empty = b.params.ocvCurve[0][1];
    if (b.temperatureC > 95) {
      this.smoking.add('battery');
      this.destroy(`Akku brennt (${Math.round(b.temperatureC)} °C)!`);
    } else if (b.temperatureC > 70 && b.damageFactor < 1.8) {
      b.damageFactor = 1.8;
      this.emit(`Akku überhitzt und aufgebläht (${Math.round(b.temperatureC)} °C) – mehr Spannungseinbruch`, 'warn');
    }
    if (cell < empty + 0.05 && b.damageFactor < 1.5) {
      b.damageFactor = Math.max(b.damageFactor, 1.5);
      this.emit('Akku tiefentladen – Zellen geschädigt', 'warn');
    }
  }
}
