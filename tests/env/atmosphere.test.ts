import { describe, expect, it } from 'vitest';
import { airState, saturationVaporPressure } from '../../src/env/atmosphere';

const ISA = { seaLevelPressureHpa: 1013.25, groundTemperatureC: 15, relativeHumidity: 0, groundAltitude: 0 };

describe('Atmosphäre (ISA)', () => {
  it('Meereshöhe, 15 °C, trocken: ρ = 1.225 kg/m³, p = 1013.25 hPa', () => {
    const a = airState(0, ISA);
    expect(a.density).toBeCloseTo(1.225, 3);
    expect(a.pressurePa).toBeCloseTo(101325, 0);
    expect(a.temperatureK).toBeCloseTo(288.15, 2);
  });

  it('3000 m: ρ ≈ 0.909, T ≈ −4.5 °C (ICAO-Tabelle)', () => {
    const a = airState(3000, ISA);
    expect(a.density).toBeCloseTo(0.909, 2);
    expect(a.temperatureK - 273.15).toBeCloseTo(-4.5, 1);
  });

  it('warme Luft ist dünner als kalte', () => {
    const warm = airState(0, { ...ISA, groundTemperatureC: 35 });
    const cold = airState(0, { ...ISA, groundTemperatureC: -10 });
    expect(warm.density).toBeLessThan(cold.density * 0.95);
  });

  it('feuchte Luft ist leichter als trockene', () => {
    const dry = airState(0, { ...ISA, groundTemperatureC: 30 });
    const humid = airState(0, { ...ISA, groundTemperatureC: 30, relativeHumidity: 1 });
    expect(humid.density).toBeLessThan(dry.density);
    expect(dry.density - humid.density).toBeGreaterThan(0.01);
  });

  it('Bodentemperatur gilt auf der eingestellten Geländehöhe', () => {
    const a = airState(2000, { ...ISA, groundTemperatureC: 5, groundAltitude: 2000 });
    expect(a.temperatureK - 273.15).toBeCloseTo(5, 6);
  });

  it('Sättigungsdampfdruck bei 20 °C ≈ 23.4 hPa', () => {
    expect(saturationVaporPressure(20) / 100).toBeCloseTo(23.4, 0);
  });
});
