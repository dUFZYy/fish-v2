# Etappen

Reihenfolge nach Risiko: was den Neubau kippen könnte, kommt zuerst.

## E0 — Renderkern (fertig, 02.09.)

- [x] Vite + TS + Pixi 8 + Capacitor, Auflösungsstufen, Bildzeit-Anzeige
- [x] Atlas + Bäcker: alter Canvas-2D-Code → GPU-Textur, Neubacken/Bild messbar
- [x] Fisch-Batch: ein Draw-Call für den ganzen Schwarm, Schwanzwedeln und
      Tiefenschleier auf der GPU
- [x] Wasser: alle Effekte in EINEM Durchgang, ohne die Szene zu lesen
- [x] Nachgewiesen in Chrome, 390×844@3×: 60 Fische + Wasser = 3 Draw-Calls
      (Hintergrund, Schwarm, Wasser), **0 Render-Targets, 0 Uploads je Bild**,
      0 Neubacken/Bild. Ohne Wasser: 238 fps, p95 4,6 ms, 0 Hakler.

Offen aus E0: die Zahl vom **Gerät**. Alles hier ist auf einer RTX gemessen und
sagt nur, dass die Bauweise stimmt — nicht, wie schnell sie ist.

## E1 — Spielbare Scheibe: Steg am See

Ziel: ein Ort, ein vollständiger Angel-Durchgang, echte Grafik, auf dem iPhone
gemessen. Erst danach lohnt der Rest.

- [ ] Arten-Daten portiert (111 Arten, `docs/spec/02-fish.md`)
- [ ] Fisch- und Kreaturen-Grafik als Backfunktionen (`drawFishShape` + 14 Körperformen)
- [ ] Kulisse „Steg am See" gebacken, Tag/Nacht über 64 Lichtstufen
- [ ] Wasser: ein Shader-Durchgang über dem Wasserbereich (Brechung, Spiegelung,
      Kaustik, Trübung, Glitzern) — ohne die Bloom-Schleife über den Himmel
- [ ] Angler, Rute, Schnur, Pose
- [ ] Kernschleife: Wurf → Biss → Drill v3 → Fang (`docs/spec/01-core-loop.md`)
- [ ] HUD als DOM (Münzen, Uhr, XP, Menü-Knopf, Rute/Köder)
- [ ] Speicherstand: altes `save` lesbar
- [ ] Klang: neue Audio-Engine, hörbar besser als vorher
- [ ] **Gerätelauf.** Zahl, p95, Hakler, Wärmedrift über 3 Minuten.

## E2 — Inhalt

- [ ] Die anderen fünf Orte samt Kulissen und Artenpools
- [ ] Effekte als GPU-Partikel (Spritzer, Ringe, Blasen, Münzflug, Konfetti, Wetter)
- [ ] Bossfight, Cutscenes, Tauchgang
- [ ] Möwe, Wetter, Goldene Stunde, Serie, Erfolge

## E3 — Meta und Oberfläche

- [ ] Shop, Inventar, Fischdex, Aufträge, Pass, Talente, Gacha, Gems
- [ ] Becken/Aquarium als Hauptmenü
- [ ] Story, Kapitel, Einstieg
- [ ] i18n DE/EN

## E4 — Ausliefern

- [ ] Capacitor iOS/Android, `CADisableMinimumFrameDurationOnPhone`
- [ ] AdMob, RevenueCat, Haptics, Share
- [ ] Bestenliste
- [ ] Store-Kram

## Was NICHT gebaut wird

- Keine PC-Fassung, keine Tastatursteuerung, keine Desktop-Layouts.
- Kein `gpu.js`-Nachbau. Die Canvas-2D-Schnittstelle über GPU-Objekten war im
  alten Projekt der Umweg, der beide Kassen bezahlt hat.
- Kein Backblech für Bewegtes. Was sich stufenlos bewegt, gehört nicht auf ein
  Blech, das Unterpixel mitbackt (Merksatz 12 des alten Projekts).
