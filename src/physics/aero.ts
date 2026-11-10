import type { Vec3Like } from '../config/physics';

/**
 * Luftdichte nach barometrischer Höhenformel (isotherme Näherung).
 * @param altitude Höhe über Meeresspiegel (m)
 */
export function airDensity(altitude: number, seaLevelDensity: number, scaleHeight: number): number {
  return seaLevelDensity * Math.exp(-Math.max(-500, altitude) / scaleHeight);
}

/**
 * Luftwiderstand (linear + quadratisch) im Körper-System.
 * Jede Körperachse hat eigene Koeffizienten, die Kraft wirkt gegen die Anströmung.
 * @param vAir Geschwindigkeit der Drohne relativ zur Luft, im Körper-System (m/s)
 * @param out Ergebnis-Vektor (N), im Körper-System
 */
export function dragForce(
  vAir: Vec3Like,
  linear: Vec3Like,
  dragArea: Vec3Like,
  rho: number,
  out: Vec3Like,
): Vec3Like {
  const speed = Math.hypot(vAir.x, vAir.y, vAir.z);
  const q = 0.5 * rho * speed;
  out.x = -(linear.x * vAir.x + q * dragArea.x * vAir.x);
  out.y = -(linear.y * vAir.y + q * dragArea.y * vAir.y);
  out.z = -(linear.z * vAir.z + q * dragArea.z * vAir.z);
  return out;
}

/**
 * Bodeneffekt nach Cheeseman & Bennett: T_ge / T = 1 / (1 - (R / 4z)²),
 * begrenzt auf maxGain.
 * @param height Abstand Propeller – Boden (m)
 * @param rotorRadius Propellerradius (m)
 */
export function groundEffectFactor(height: number, rotorRadius: number, maxGain: number): number {
  if (height <= 0) return maxGain;
  const r = rotorRadius / (4 * height);
  const denom = 1 - r * r;
  if (denom <= 1 / maxGain) return maxGain;
  return Math.min(maxGain, 1 / denom);
}

/**
 * Schubverlust durch axiale Anströmung (vereinfachte Propellertheorie):
 * Je näher die axiale Geschwindigkeit an der "Pitch Speed" des Propellers liegt,
 * desto weniger Schub. Anströmung von unten (Sinken) erhöht den Schub leicht.
 * @param vAxial Geschwindigkeit entlang der Schubachse relativ zur Luft (m/s, + = steigen)
 * @param omega Drehzahl (rad/s)
 * @param pitch Propeller-Steigung (m pro Umdrehung)
 */
export function inflowFactor(vAxial: number, omega: number, pitch: number, maxGain: number): number {
  const pitchSpeed = (omega * pitch) / (2 * Math.PI);
  if (pitchSpeed < 1e-3) return 1;
  const f = 1 - vAxial / pitchSpeed;
  return Math.max(0, Math.min(maxGain, f));
}
