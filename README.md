# FPV Racer

Browserbasiertes FPV-Drohnenrennspiel mit eigener Flugphysik (TypeScript + Vite + Three.js).

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Unit-Tests der Physik und des Flight Controllers
```

## Auf dem iPad spielen

Das Spiel läuft komplett per Touch – ohne Tastatur, Controller oder Fernsteuerung.

- **Touch-Sticks:** linker Daumen = Gas (hoch/runter ziehen, bleibt stehen) + Gieren,
  rechter Daumen = Nicken/Rollen (federn zurück). Der Stick-Mittelpunkt ist dort, wo der Daumen aufsetzt.
  Bei Mode 1 sind Gas und Nicken getauscht. Stickgröße (= Empfindlichkeit) im Menü einstellbar.
- **Buttons oben:** ⚙ Einstellungen · ↺ Reset · 🎥 FPV/Third Person · 📊 Telemetrie · ? Hilfe · ⛶ Vollbild
- Erscheint automatisch auf Touch-Geräten (Einstellungen → „Touch-Sticks“: Automatisch / Immer an / Aus).
- In Safari „Teilen → Zum Home-Bildschirm“ wählen: Dann startet das Spiel im Vollbild im Querformat.

**So kommt das Spiel auf das iPad:**

1. *Ohne Rechner (empfohlen):* GitHub Pages. Einmalig im Repository unter
   **Settings → Pages → Source: „GitHub Actions“** einstellen. Danach baut der Workflow
   `.github/workflows/pages.yml` das Spiel bei jedem Push auf `main` (oder manuell über „Actions → Run workflow“)
   und veröffentlicht es unter `https://<benutzer>.github.io/<repo>/`.
2. *Im Heimnetz:* `npm run dev` auf einem Rechner starten und auf dem iPad die angezeigte
   „Network“-Adresse öffnen (z. B. `http://192.168.1.20:5173`).
3. *Beliebiger Webspace:* `npm run build` und den Ordner `dist/` hochladen (relative Pfade).

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

Auf Touch-Geräten siehe oben „Auf dem iPad spielen“.

Scharfschalten: Gas ganz nach unten. RC-Sender (EdgeTX/OpenTX als USB-Joystick) werden mit AETR-Zuordnung erkannt.

## Fluggeräte

Auswahl im Menü (⚙ / Esc → Fluggerät). Jedes Gerät hat eigene Physikwerte und eigenes Regler-Tuning.

| Drohnen | | Flugzeuge | |
|---|---|---|---|
| Tiny Whoop 65 mm | 1S, 32 g, Ducts | Trainer (Hochdecker) | 1.4 m, Bugfahrwerk, Pistenstart |
| Cinewhoop 3" | 4S, 300 g, Ducts | FPV-Nurflügler | 1.0 m, Druckpropeller, Handstart |
| Freestyle 5" | 6S, 650 g | Segler 2 m | Elektrosegler, Handstart, Thermik |
| Racer 5" | 6S, 540 g | | |
| Long Range 7" | 6S Li-Ion, 1050 g | | |

Flugmodi Flugzeug: **Manuell** (Sticks direkt auf die Ruder), **Stabilisiert** (Kreisel dämpft Böen),
**Angle** (richtet sich selbst auf – ideal für Touch). Handstart: Modell wird gehalten, bis Gas gegeben wird.

## Physikmodell

**Drohnen** – Signalweg wie bei einer echten Drohne, Takt 1 kHz:

```
Sticks → Betaflight-Rates → Raten-PID (P, I mit I-Term-Relax, D auf Messung, Feedforward)
       → Airmode-Mixer → Motoren (KV · Spannung, Spin-up-Verzögerung, Schub ∝ ρ·ω²)
       → Starrkörper (Masse, Trägheitstensor, Kreiselterm) + Aerodynamik + Kontakte
```

- Motoren: Drehzahl folgt Ansteuerung × Akkuspannung × KV mit Zeitkonstante; Reaktionsmoment aus
  Propeller-Drehmoment und Rotorträgheit; Ducts erhöhen den Schub.
- Propeller: Schubverlust bei axialer Anströmung, Rotationsanteil ω × r, Rotor-Widerstand ("H-Force").
- **Propwash/Wirbelringstadium:** Sinken in die eigene Abströmung → Schubverlust + unruhiger Schub je Motor.
- Bodeneffekt (Cheeseman–Bennett), Luftwiderstand linear + quadratisch je Körperachse.

**Flugzeuge** – jede Fläche (Flügelhälften, Höhen-/Seitenleitwerk, Winglets) wird einzeln berechnet:

- lokale Anströmung inkl. Drehbewegung und Wind *am Ort der Fläche* (Turbulenz über die Spannweite)
- Auftrieb mit Helmbold-Anstieg, weicher Übergang in den **Strömungsabriss**, induzierter Widerstand
- Ruder über Klappenwirksamkeit und Nickmoment, Servos mit begrenzter Stellgeschwindigkeit
- Flügel-Abwind am Leitwerk, **Propellerstrahl** über dem Leitwerk, V-Form, Pfeilung, Reflex
- Propeller: Inflow, Reaktionsmoment (Rollen nach links), Kreiselmoment
- Fahrwerk mit Roll-/Seitenreibung und Bugradlenkung, Kufen bei Handstart-Modellen
- Daraus ergeben sich Stabilität, Phugoide, Trudeln, Startstrecke und Gleitzahl ohne Sonderregeln.

**Umwelt**

- **Atmosphäre** nach ICAO: Temperatur, Luftdruck (QNH), Luftfeuchte und Geländehöhe → Luftdichte
  (z. B. 3000 m: −26 % Schub, 35 °C: dünnere Luft, feuchte Luft leichter als trockene)
- **Wind:** logarithmisches Höhenprofil der Grenzschicht, Turbulenz als mitgeführtes fraktales Rauschfeld
  mit realistischer Intensität (σ ≈ 2.5·u*) und höhenabhängiger Wirbelgröße, Böen-Hüllkurve
- **Windschatten** hinter Gebäuden (Lee-Zone ≈ 10 Gebäudehöhen) mit zusätzlicher Verwirbelung
- **Thermik:** Aufwindschläuche mit Abwindring, driften mit dem Wind, entstehen und vergehen
- Sichtbar über Windsäcke und mitgetragene Schwebeteilchen
- **Akku:** LiPo/Li-Ion-Kennlinie, Innenwiderstand + Polarisation (Voltage Sag), **temperaturabhängig**
  (kalter Akku = mehr Sag), Erwärmung durch I²R, Kühlung im Fahrtwind

Umwelt im Menü einstellbar: Wind, Richtung, Böigkeit, Thermik, Temperatur, Luftfeuchte, Höhe über NN, Luftdruck.

## Tuning

- Drohne 5" (Basis): [`src/config/physics.ts`](src/config/physics.ts), weitere Drohnen + PIDs: [`src/config/quads.ts`](src/config/quads.ts)
- Flugzeuge (Flächen, Ruder, Motor, Trimmung, Regler): [`src/config/planes.ts`](src/config/planes.ts)
- Umwelt-Standardwerte: [`src/config/environment.ts`](src/config/environment.ts)
- PID-Grundeinstellungen (Betaflight-Skalierung): [`src/config/flightController.ts`](src/config/flightController.ts)

Die Telemetrie (T / 📊) zeigt je nach Gerät PID-Anteile und Motordrehzahlen bzw. Anstellwinkel,
Schiebewinkel, Abriss, Ruderausschläge – dazu Akku (inkl. Temperatur), Luftdichte und Wind.

## Ordnerstruktur

```
src/
  config/   physics.ts, flightController.ts, defaults.ts
  config/   + quads.ts, planes.ts, environment.ts
  physics/  rigidbody, motor, battery, aero, airfoil, contacts, quad, plane
  fc/       rates, pid, mixer, filters, flightController, planeController
  env/      atmosphere, wind, noise, environment
  vehicles/ Vehicle-Schnittstelle, QuadVehicle, PlaneVehicle, Registry
  input/    Gamepad, RC-Sender, Tastatur
  render/   Drohnen-/Flugzeugmodelle, Kameras, Windsack, Windpartikel
  world/    Kollision, Testwelt
  game/     Simulation (fester Zeittakt), Speicher
  ui/       OSD, Einstellungsmenü, Telemetrie
tests/      physics/, fc/
```

## Meilensteine

1. ✅ Flugphysik + Acro in leerer Welt
2. Angle/Horizon (Drohne), ✅ Propwash, Crash-/Schadensmodell, Rapier-Kollisionen, RC-Kalibrierung & Kanal-Zuordnung
3. Gates, Checkpoints, 3 Runden, Timer, Bestzeiten
4. Level 1 (Trainingshalle), Medaillen, Freischalten
5. ✅ Wind, Luftdichte, Thermik (Wetter-Optik und analoger Videolook folgen)
6. Level 2–6
7. Ghost-Replay, Freeflight, vollständiges Einstellungsmenü
