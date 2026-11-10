/**
 * Profil-/Flächen-Aerodynamik für Flugzeug-Tragflächen und Leitwerke.
 *
 * Auftrieb: linearer Bereich mit Auftriebsanstieg aus dem Seitenverhältnis (Helmbold),
 * weicher Übergang in die Plattenströmung nach dem Strömungsabriss (Beard & McLain).
 * Widerstand: Nullwiderstand + induzierter Widerstand (Oswald-Faktor), nach Abriss Plattenwiderstand.
 */

export interface AirfoilParams {
  /** Auftriebsbeiwert bei α = 0. */
  cl0: number;
  /** Auftriebsanstieg (1/rad). */
  clAlpha: number;
  /** Abrisswinkel (rad, bezogen auf effektiven Anstellwinkel). */
  alphaStall: number;
  cd0: number;
  oswald: number;
  /** Seitenverhältnis für den induzierten Widerstand. */
  aspectRatio: number;
  /** Steilheit des Übergangs in den Strömungsabriss. */
  stallSharpness: number;
}

export interface AirfoilResult {
  cl: number;
  cd: number;
  /** 0 = anliegende Strömung, 1 = voll abgerissen. */
  stall: number;
}

/** Auftriebsanstieg einer endlichen Fläche (1/rad), Helmbold-Näherung. */
export function liftSlope(aspectRatio: number): number {
  return (2 * Math.PI * aspectRatio) / (2 + Math.sqrt(aspectRatio * aspectRatio + 4));
}

/** Klappenwirksamkeit τ aus dem Ruder-Tiefenverhältnis (Dünnprofiltheorie, mit 0.85 Realfaktor). */
export function flapEffectiveness(chordFraction: number): number {
  const cf = Math.max(0.01, Math.min(0.99, chordFraction));
  const theta = Math.acos(2 * cf - 1);
  return 0.85 * (1 - (theta - Math.sin(theta)) / Math.PI);
}

/** Abriss-Mischfaktor σ(α) nach Beard & McLain. */
export function stallBlend(alpha: number, alphaStall: number, sharpness: number): number {
  const a = Math.exp(-sharpness * (alpha - alphaStall));
  const b = Math.exp(sharpness * (alpha + alphaStall));
  return (1 + a + b) / ((1 + a) * (1 + b));
}

/**
 * Beiwerte bei Anstellwinkel α (rad) und Klappenwinkel δ (rad, + = Hinterkante nach unten).
 * @param tau Klappenwirksamkeit (0 = keine Klappe)
 */
export function airfoilCoefficients(
  alpha: number,
  delta: number,
  tau: number,
  p: AirfoilParams,
  out?: AirfoilResult,
  /** Faktor für den induzierten Widerstand (Bodeneffekt < 1). */
  inducedFactor = 1,
): AirfoilResult {
  const o = out ?? { cl: 0, cd: 0, stall: 0 };
  const alphaEff = alpha + tau * delta;
  const sigma = stallBlend(alphaEff, p.alphaStall, p.stallSharpness);
  const clLin = p.cl0 + p.clAlpha * alphaEff;
  const s = Math.sin(alpha);
  const c = Math.cos(alpha);
  const clPlate = 2 * Math.sign(alpha) * s * s * c;
  o.cl = ((1 - sigma) * clLin + sigma * clPlate) * (1 + 0.1 * (1 - inducedFactor));
  const cdInduced = ((clLin * clLin) / (Math.PI * p.oswald * p.aspectRatio)) * inducedFactor;
  const cdFlap = 0.35 * tau * delta * delta;
  o.cd = p.cd0 + cdFlap + (1 - sigma) * cdInduced + sigma * 1.3 * s * s;
  o.stall = sigma;
  return o;
}
