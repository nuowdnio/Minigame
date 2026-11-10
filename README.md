# FPV Racer

Browserbasiertes FPV-Drohnenrennspiel mit eigener Flugphysik (TypeScript + Vite + Three.js).

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Unit-Tests der Physik und des Flight Controllers
```

## Stand: Meilenstein 1 – Flugphysik & Acro

Leere Testwelt (Wiese mit 1-m-Raster, Säulen-Slalom, Blöcke, Torbögen) zum Einfliegen.

**Steuerung**

| | Tastatur (Notlösung) | Gamepad Mode 2 |
|---|---|---|
| Gas | W / S (Wert bleibt stehen), Leertaste = 0 | linker Stick hoch/runter |
| Gieren | A / D | linker Stick links/rechts |
| Nicken / Rollen | Pfeiltasten (Shift = voller Ausschlag) | rechter Stick |
| Reset | R | Start / Y |
| FPV ↔ Third Person | C | Select / X |
| Einstellungen | Esc | |
| Telemetrie / Hilfe | T / H | |

Scharfschalten: Gas ganz nach unten. RC-Sender (EdgeTX/OpenTX als USB-Joystick) werden mit AETR-Zuordnung erkannt.

## Physikmodell

Signalweg wie bei einer echten Drohne, Takt 1 kHz:

```
Sticks → Betaflight-Rates → Raten-PID (P, I mit I-Term-Relax, D auf Messung, Feedforward)
       → Airmode-Mixer → Motoren (KV · Spannung, Spin-up-Verzögerung, Schub ∝ ρ·ω²)
       → Starrkörper (Masse, Trägheitstensor, Kreiselterm) + Aerodynamik + Kontakte
```

- **Motoren:** Drehzahl folgt Ansteuerung × Akkuspannung × KV mit Zeitkonstante (hoch/runter getrennt);
  Reaktionsmoment aus Propeller-Drehmoment und Rotorträgheit (Gier).
- **Propeller:** Schubverlust bei axialer Anströmung (Pitch-Speed-Modell), inkl. Rotationsanteil ω × r
  (natürliche Dämpfung); Rotor-Widerstand ("H-Force") bei seitlicher Anströmung.
- **Akku:** LiPo-Kennlinie (SoC → Leerlaufspannung), Innenwiderstand (sofortiger Sag) und
  RC-Polarisationsglied (langsamer Sag + Erholung). Weniger Spannung → weniger Drehzahl → weniger Schub.
- **Aerodynamik:** linearer + quadratischer Widerstand je Körperachse, Luftdichte nach Höhe,
  Bodeneffekt (Cheeseman–Bennett).
- **Kontakte:** Impulsverfahren mit Stoßzahl und Coulomb-Reibung an mehreren Kontaktkugeln.

## Tuning

Alle Physikwerte stehen zentral in [`src/config/physics.ts`](src/config/physics.ts)
(Masse, Trägheit, Motor-KV, Maximalschub, Zeitkonstanten, Drag, Akku …),
PID-Werte in [`src/config/flightController.ts`](src/config/flightController.ts) (Betaflight-Skalierung).
Rates, Kamerawinkel, FOV und Stick-Mode lassen sich im Spiel (Esc) einstellen und werden im localStorage gespeichert.
Die Telemetrie (T) zeigt PID-Anteile, Motordrehzahlen, Schub, Strom und Spannung.

Referenzwerte der Standardkonfiguration (5" / 6S / 650 g): Schwebegas ≈ 30 % bei ≈ 7 A,
statisches Schub-Gewichts-Verhältnis ≈ 8.8, Spitzenstrom > 100 A, Höchstgeschwindigkeit ≈ 135 km/h.

## Ordnerstruktur

```
src/
  config/   physics.ts, flightController.ts, defaults.ts
  physics/  rigidbody, motor, battery, aero, quad
  fc/       rates, pid, mixer, filters, flightController
  env/      environment (Wind/Wetter folgen)
  input/    Gamepad, RC-Sender, Tastatur
  render/   Drohnenmodell, FPV-/Verfolgerkamera
  world/    Kollision, Testwelt
  game/     Simulation (fester Zeittakt), Speicher
  ui/       OSD, Einstellungsmenü, Telemetrie
tests/      physics/, fc/
```

## Meilensteine

1. ✅ Flugphysik + Acro in leerer Welt
2. Angle/Horizon, Propwash, Crash-/Schadensmodell, Rapier-Kollisionen, RC-Kalibrierung & Kanal-Zuordnung
3. Gates, Checkpoints, 3 Runden, Timer, Bestzeiten
4. Level 1 (Trainingshalle), Medaillen, Freischalten
5. Wind, Wetter, Luftdichte, analoger Videolook
6. Level 2–6
7. Ghost-Replay, Freeflight, vollständiges Einstellungsmenü
