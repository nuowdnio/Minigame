/** Tiefpass 1. Ordnung (PT1), wie in Betaflight. */
export class Pt1Filter {
  state = 0;
  private k: number;

  constructor(cutoffHz: number, dt: number) {
    this.k = pt1Gain(cutoffHz, dt);
  }

  setCutoff(cutoffHz: number, dt: number): void {
    this.k = pt1Gain(cutoffHz, dt);
  }

  apply(input: number): number {
    this.state += this.k * (input - this.state);
    return this.state;
  }

  reset(value = 0): void {
    this.state = value;
  }
}

export function pt1Gain(cutoffHz: number, dt: number): number {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  return dt / (rc + dt);
}
