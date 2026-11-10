import type { MotorLayoutEntry } from '../config/physics';

/**
 * Mixer-Koeffizienten je Motor für die FC-Achsen.
 * FC-Achsen (Vorzeichen wie Stickausschlag):
 *  roll  > 0: nach rechts rollen
 *  pitch > 0: Nase nach unten (Stick nach vorne)
 *  yaw   > 0: nach rechts gieren (im Uhrzeigersinn von oben)
 */
export interface MixerRule {
  roll: number;
  pitch: number;
  yaw: number;
}

/**
 * Leitet die Mixer-Tabelle aus der Motor-Geometrie ab.
 * - Rollen rechts: linke Motoren mehr Schub
 * - Nase runter: hintere Motoren mehr Schub (Körper-z > 0 ist hinten)
 * - Gieren rechts: Motoren mit CCW-Propeller mehr (deren Reaktionsmoment dreht den Rahmen CW)
 */
export function buildMixer(motors: MotorLayoutEntry[]): MixerRule[] {
  return motors.map((m) => ({
    roll: -Math.sign(m.position.x),
    pitch: Math.sign(m.position.z),
    yaw: -m.spin,
  }));
}

/**
 * Betaflight-Mixer mit Airmode: Wenn die Regelanteile nicht zwischen 0 und 1 passen,
 * wird das Gas verschoben (bzw. die Regelanteile skaliert), damit die Lagekontrolle
 * auch bei Gas 0 und Vollgas erhalten bleibt.
 *
 * @param throttle 0..1
 * @param roll/pitch/yaw Regelausgaben (Mixer-Einheiten, ~−1..1)
 * @param out Motor-Ausgaben 0..1
 */
export function mix(
  rules: MixerRule[],
  throttle: number,
  roll: number,
  pitch: number,
  yaw: number,
  out: number[],
  airmode = true,
): number[] {
  let mixMin = Infinity;
  let mixMax = -Infinity;
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const v = roll * r.roll + pitch * r.pitch + yaw * r.yaw;
    out[i] = v;
    if (v < mixMin) mixMin = v;
    if (v > mixMax) mixMax = v;
  }
  const range = mixMax - mixMin;
  let thr = throttle;
  if (range > 1) {
    const scale = 1 / range;
    for (let i = 0; i < rules.length; i++) out[i] *= scale;
    mixMin *= scale;
    mixMax *= scale;
    thr = airmode ? -mixMin : Math.max(-mixMin, Math.min(1 - mixMax, throttle));
  } else if (airmode) {
    thr = Math.max(-mixMin, Math.min(1 - mixMax, throttle));
  }
  for (let i = 0; i < rules.length; i++) {
    out[i] = Math.max(0, Math.min(1, out[i] + thr));
  }
  return out;
}
