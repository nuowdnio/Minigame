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
- **Buttons oben:** ⚙ Einstellungen · ↺ Reset · 🎥 FPV/Third Person · 📊 Telemetrie · 🔍 Zoom · 🌡 Wärmebild ·
  📡 Melden / 📦 Abwerfen (nur wenn passend) · ? Hilfe · ⛶ Vollbild
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
| Zoom (Aufklärer, Oktokopter, 7") | Z / Y | B |
| Wärmebild an/aus | V | LB |
| Melden (Konvoi) / Kiste abwerfen | B / M / Enter | A |

Auf Touch-Geräten siehe oben „Auf dem iPad spielen“.

Scharfschalten: Gas ganz nach unten. RC-Sender (EdgeTX/OpenTX als USB-Joystick) werden mit AETR-Zuordnung erkannt.

## Welt: Kleinstadt „Flugdorf“ mit Flugplatz

Prozedural modelliert, ohne externe Dateien:

- **Zentrum:** Marktplatz mit Kirche (Turmuhr, Spitzhelm), Rathaus, Brunnen und Café; Bürohochhaus mit
  Glasfassade, Wohn- und Geschäftshäuser mit Läden im Erdgeschoss, Park mit Teich und Pavillon
- **Wohngebiete:** Einfamilienhäuser mit Satteldach, Schornstein und Garten, Autos in Einfahrten und am Straßenrand,
  Alleebäume, Straßenlaternen
- **Außen:** Sportplatz mit Toren, Flutlicht und Tribüne, Gewerbegebiet mit Wasserturm, Tankstelle, Ortsschild
- **Flugplatz:** Piste 18/36 (600 m) mit Schwellen, Kennungen und Befeuerung, Rollweg, Vorfeld,
  drei Bogenhangars, Tower, Vereinsheim, abgestellte Flugzeuge, Tankwagen, Windsäcke

Alles ist kollidierbar (gedrehte Quader, Satteldächer, Zylinder, Kugeln, Bogenhallen) und wirft Windschatten.
Die Geometrie wird pro Material zu wenigen Meshes zusammengefasst, Bäume sind instanziert – läuft auch auf dem iPad.
Das alte Testgelände ist im Menü weiterhin wählbar. Drohnen starten auf dem Marktplatz, Flugzeuge auf der Piste.

## Schäden

| Ursache | Drohne | Flugzeug |
|---|---|---|
| Aufprall | Propeller bekommt Macken → Unwucht/Vibrationen, bricht; Arm bricht ab; Rahmen zerstört | Fahrwerk reißt ab, Flügel/Leitwerk brechen, Propeller zerbricht, Rumpf zerstört |
| Propeller berührt etwas bei laufendem Motor | Blätter splittern, Rotor blockiert | Propeller zerbricht |
| Strukturlast | – | Lastvielfaches über Bruchgrenze (z. B. 6 g Trainer) → Flügel bricht |
| Überschreiten von V_NE | – | Flattern schaukelt sich auf → Ruder klemmt, später Flügelbruch |
| Elektrische Überlast | Blockierter Rotor/zu hoher Strom → Regler oder Motorwicklung brennt durch (Rauch) | ebenso |
| Akku | Überhitzung → aufgebläht (mehr Sag), > 95 °C Brand; Tiefentladung schädigt Zellen | ebenso |

Abgebrochene Teile fliegen als Trümmer weiter, durchgebrannte Motoren rauchen. Meldungen erscheinen im OSD,
der Zustand aller Bauteile steht in der Telemetrie. Schadensmodell im Menü: Realistisch / Robust / Aus.

## Fahrverhalten je Modell

Jede Drohne hat eigene Physik **und** ein eigenes Regler-Setup (Rates, PID, Feedforward, Filter, TPA,
Thrust Linearization, Spannungskompensation) – wie ein echter Pilot sie für sein Modell einstellen würde.
Gemessen in der Simulation:

| Modell | Schub/Gewicht | max. Rollrate | 360°-Flip | Steigen nach 1 s Vollgas | Spitze |
|---|---|---|---|---|---|
| Tiny Whoop | 3.8 | ~640 °/s | 0.60 s | 7 m/s | 44 km/h |
| Cinewhoop 3" | 4.2 | ~300 °/s | 1.26 s | 13 m/s | 74 km/h |
| Freestyle 5" | 8.8 | ~680 °/s | 0.56 s | 29 m/s | 150 km/h |
| **Racer 5"** | **12** | **~970 °/s** | **0.40 s** | **39 m/s** | **175 km/h** |
| Long Range 7" | 7.4 | ~430 °/s | 0.93 s | 9 m/s (Li-Ion) | 117 km/h |
| Sprengstoff-Drohne 7" | 6.2 | ~360 °/s | 1.09 s | 19 m/s | 134 km/h |

Die Rates lassen sich im Menü **je Modell** anpassen („Standard-Rates dieses Modells“ setzt zurück).

## Sprengstoff-Drohne

7"-Drohne mit Sprengladung unter dem Rahmen (schwer, träge, tiefer Schwerpunkt). Der Zünder ist am Boden
gesichert und wird nach 1.5 s Flug scharf (OSD: „ZÜNDER SCHARF“). Fliegt sie in ein **Auto** oder schlägt
hart auf, explodiert sie: Lichtblitz, Feuerball, Druckwelle, Splitter, Brandfleck, Rauchsäule. Autos im
Wirkradius (7 m) werden hochgeschleudert und bleiben als brennende Wracks liegen. Im FPV-Bild bricht das
Video ab („KEIN SIGNAL“), in der Verfolgeransicht sieht man die Explosion. Reset stellt alles wieder her.

## Fluggeräte

Auswahl im Menü (⚙ / Esc → Fluggerät). Jedes Gerät hat eigene Physikwerte und eigenes Regler-Tuning.

| Drohnen | | Flugzeuge | |
|---|---|---|---|
| Tiny Whoop 65 mm | 1S, 32 g, Ducts | Trainer (Hochdecker) | 1.4 m, Bugfahrwerk, Pistenstart |
| Cinewhoop 3" | 4S, 420 g mit Kamera, Ducts | FPV-Nurflügler | 1.0 m, Druckpropeller, Handstart |
| Freestyle 5" | 6S, 650 g | Segler 2 m | Elektrosegler, Handstart, Thermik |
| Racer 5" | 6S, 470 g | | |
| Long Range 7" | 6S Li-Ion, 1050 g | | |
| Sprengstoff-Drohne 7" | 6S, 1450 g, Sprengladung | Aufklärungsflügel | 1.1 m, 4S Li-Ion, Zoomkamera 1×/3×/8× |
| Abfangdrohne | 6S 850 mAh, 500 g, sehr schnell, kurze Flugzeit | | |
| Schwerlast-Oktokopter | 12S, 9 kg + 3 kg Kiste, Abwurf | | |

Flugmodi Flugzeug: **Manuell** (Sticks direkt auf die Ruder), **Stabilisiert** (Kreisel dämpft Böen),
**Angle** (richtet sich selbst auf – ideal für Touch). Handstart: Modell wird gehalten, bis Gas gegeben wird.

## Militär-Modus (fiktiv)

Im Menü unter **Modus** wählbar. Alles ist bewusst spielerisch und fiktiv gehalten – keine echten Taktiken
oder Waffendaten.

- **Konvoi-Begleitung:** Ein Konvoi fährt eine Route durch die Stadt. Vorausfliegen, Gefahren auf der Strecke
  (Straßensperren, verdächtige Objekte, Fahrzeuge) mit der Kamera anvisieren und **melden** (B / A / 📡).
  Gemeldete Gefahren werden umfahren bzw. abgewartet, übersehene treffen den Konvoi.
- **Abfangjagd:** Mit der Abfangdrohne gegnerische Aufklärungsdrohnen einholen und rammen, bevor sie die Stadt
  wieder verlassen. Die Gegner weichen aus, sobald sie dich bemerken.
- **Störsender:** Masten mit blinkendem Licht. In ihrer Nähe rauscht das Video, die Steuerung reagiert
  verzögert, bis die Verbindung abreißt (Failsafe, „KEIN SIGNAL“). Gebäude/Gelände zwischen Störsender und
  Drohne schirmen ab – tief und hinter Deckung fliegen hilft.
- **Flugabwehr-Stellungen:** schießen nur bei freier Sichtlinie, brauchen Zeit zum Schwenken und schießen
  in Feuerstößen mit Leuchtspur. Schnelles Queren wird schlechter getroffen als Schweben.
- **Entdeckung:** Laute, große, hohe und schnelle Fluggeräte werden früher bemerkt (OSD „ENTD“). Tief und
  langsam in Deckung schleichen lohnt sich.
- **Versorgungsabwurf:** Der Oktokopter trägt eine Kiste; beim Abwurf ändern sich Masse und Schwerpunkt
  schlagartig. Die Kiste fällt am Fallschirm, Treffer in den markierten Abwurfzonen geben Punkte.
- **Zoom & Wärmebild:** Aufklärungsflügel/Oktokopter haben eine Zoomkamera, jedes Fluggerät eine
  Wärmebild-Ansicht (Motoren, Fahrzeuge, Stellungen und Feuer leuchten weiß).
- **Gegner im Freiflug:** Im Menü einschaltbar – dann sind Flugabwehr und Störsender auch im Freiflug aktiv.

## Physikmodell

**Drohnen** – Signalweg wie bei einer echten Drohne, Takt 1 kHz:

```
Sticks → Betaflight-Rates → Raten-PID (P, I mit I-Term-Relax, D auf Messung, Feedforward)
       → Airmode-Mixer → Motoren (KV · Spannung, Spin-up-Verzögerung, Schub ∝ ρ·ω²)
       → Starrkörper (Masse, Trägheitstensor, Kreiselterm) + Aerodynamik + Kontakte
```

- **Elektromechanisches Motormodell:** Strom aus Tastgrad · Akkuspannung und Gegen-EMK (K_e aus KV),
  Wicklungswiderstand, Leerlaufstrom, Rotorträgheit → Hochlaufzeit, aktives Bremsen, Drehzahleinbruch bei Sag,
  Entlastung des Propellers bei Fahrt ergeben sich von selbst. Regler mit Strombegrenzung, Motor- und
  Reglertemperatur. Akku und Motoren sind implizit gekoppelt (kein Aufschaukeln bei schwachen Akkus).
- Reaktionsmoment aus Propeller-Drehmoment und Rotorbeschleunigung; Ducts erhöhen den Schub.
- **Translational Lift:** Vorwärtsfahrt erhöht den Luftdurchsatz der Propeller.
- **Flugmodi:** Acro, Horizon, Angle (Betaflight-artige Selbststabilisierung).
- **Flight-Controller-Funktionen wie Betaflight:** TPA (P/D-Abschwächung bei hohem Gas), Thrust Linearization,
  Spannungskompensation (gleiches Gefühl bei vollem und leerem Akku), Filter und Feedforward je Modell.
- **Kreiselmoment der Rotoren**, temperaturabhängige Motorkonstante (heiße Magnete → weniger Drehmoment),
  Rotor-Widerstand greift an den Propellernaben an (aufrichtendes Nickmoment bei schneller Vorwärtsfahrt).
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
- **Bodeneffekt der Tragfläche** (weniger induzierter Widerstand dicht über der Piste)
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
  render/   Drohnen-/Flugzeugmodelle, Kameras, Windsack, Windpartikel, Trümmer, Rauch
  world/    Kollisionswelt (Raster, Prismen, Zylinder, Kugeln), Stadt, Testgelände, Texturen
  game/     Simulation (fester Zeittakt), Speicher, Funk/Störsender, Entdeckung, Flugabwehr, Konvoi, Gegner, Missionen
  ui/       OSD, Einstellungsmenü, Telemetrie
tests/      physics/, fc/, game/
```

## Meilensteine

1. ✅ Flugphysik + Acro in leerer Welt
2. ✅ Angle/Horizon (Drohne), ✅ Propwash, ✅ Crash-/Schadensmodell, Rapier-Kollisionen, RC-Kalibrierung & Kanal-Zuordnung
3. Gates, Checkpoints, 3 Runden, Timer, Bestzeiten
4. Level 1 (Trainingshalle), Medaillen, Freischalten
5. ✅ Wind, Luftdichte, Thermik (Wetter-Optik und analoger Videolook folgen)
6. Level 2–6
7. Ghost-Replay, Freeflight, vollständiges Einstellungsmenü
