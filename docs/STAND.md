# Stand 02.09.2026 — Sitzung 1

Pause bei 85 % des Nutzungsfensters. Alles ist eingecheckt und übersetzt
fehlerfrei (`npx tsc --noEmit` = 0 Fehler, `npm run build` läuft).

## Was steht

**Der Renderkern ist bewiesen.** Das ist die Frage, an der der Neubau
gescheitert wäre, und sie ist beantwortet.

Gemessen in Chrome, 390×844 bei 3×, 60 Fische plus Wasser, je Bild:

| | |
|---|---|
| Draw-Calls | 3 (Hintergrund, ganzer Schwarm, Wasser) |
| Render-Targets | 0 |
| Texture-Uploads | 0 |
| Neubacken je Bild | 0 |

Ohne die Wasserebene: 238 fps, p95 4,6 ms, keine Hakler. Das alte Spiel lud
in derselben Auflösung **jedes Bild** ein volles 1170×2532-Bild hoch, was
allein 14 bis 23 ms kostete, und mischte zwei bildschirmfüllende Ebenen.

Drei Bauteile tragen das:

- `src/bake/` — der alte Canvas-2D-Zeichencode läuft einmal in einen Atlas,
  danach ist jedes Motiv ein Viereck im Batch. Senkrechte Verläufe werden als
  8-px-Streifen gebacken und gestreckt, statt bildschirmfüllend (145× weniger
  Speicher, pixelgleich).
- `src/world/fishBatch.ts` — alle Fische in einem instanzierten Draw-Call.
  Schwanzwedeln als laufende Welle im Vertex-Shader, Tiefenschleier als
  Instanz-Attribut. Genau dieser Schleier lief im alten Spiel über eine
  Hilfsleinwand und kostete 11 von 16,7 ms.
- `src/world/water.ts` — alle Wassereffekte in einem Durchgang, **ohne die
  Szene zu lesen**. Neun der elf Effekte sind reine Formeln, und „zu einer
  Farbe hin mischen plus Licht addieren" ist genau das, was Alpha-Blending
  ohnehin tut. Brechung wandert in den Fisch-Shader, Spiegelung wird ein
  gespiegeltes Sprite, Leuchten ein gebackener Halo.

## Was portiert ist

`docs/spec/` — 8150 Zeilen vollständige Spezifikation des alten Spiels.
**Vor jeder Portierung dort nachsehen, nicht im alten Code raten.**

| Datei | Zeilen | Stand |
|---|---:|---|
| `src/data/species.ts` | 1246 | alle 111 Arten, vollständig |
| `src/data/items.ts` | 418 | Kataloge (Ruten, Köder, Skins, Totems …) |
| `src/data/locations.ts` | 133 | die sechs Orte |
| `src/game/save.ts` | 652 | Speicherstand samt Lesen alter Stände |
| `src/game/state.ts` | 422 | Zustandsmaschine |
| `src/game/cast.ts` | 285 | Wurf, Schwimmer, Harpune |
| `src/game/bite.ts` | 335 | Biss und alle Multiplikatoren |
| `src/game/progress.ts` | 375 | XP, Stufen, Freischaltungen |
| `src/game/quests.ts` | 269 | Tagesaufträge |
| `src/audio/engine.ts` | 337 | Busse, Limiter, zwei Hallräume, Unterwasser |

## Was als Nächstes ansteht

1. **`src/game/drill.ts`** — angefangen und abgebrochen. Die Form steht in
   `src/game/drillTypes.ts`, die Formeln in `docs/spec/01-core-loop.md`
   Abschnitt 4. Ohne diese Datei gibt es keinen vollständigen Angel-Durchgang.
2. **`src/game/catch.ts`** und **`src/game/events.ts`** — noch nicht portiert.
3. **`src/bake/fishArt.ts`** — die Fischgrafik. Bis dahin laufen im Rauchtest
   Platzhalter-Fische. Vorlage: `docs/spec/02-fish.md` Abschnitt 2, ein
   Grundriss plus 14 eigene Körperformen.
4. **Kulisse „Steg am See"**, Angler, Rute, Schnur.
5. **Audio**: `engine.ts` steht, es fehlen `sfx.ts` (geschichtete Klänge mit
   Variation, Panorama, Hall-Anteil) und `music.ts` (die musikalische Substanz
   des alten `music.js` ist gut und wird übernommen, aber in die Busse gehängt,
   mit Übergang bei Ortswechsel und Intensität nach Spielsituation).
6. **Gerätelauf.** Alles bisher Gemessene ist auf einer RTX 4090 entstanden
   und sagt nur, dass die Bauweise stimmt. `npm run dev` ist im WLAN
   erreichbar, `?perf=1` zeigt die Zahlen groß genug zum Abfotografieren.

## Zwei Fallen, die je eine halbe Stunde gekostet haben

- **`CanvasSource`, nicht `TextureSource`.** Nur die erste hat einen
  Upload-Weg für ein Canvas. Mit der generischen bleibt die Textur leer,
  jedes Fragment wird verworfen, und es gibt **keine** GL-Meldung. Der Atlas
  meldete brav 12 Einträge und 7 % Belegung, das Bild blieb leer.
- **Ein Mesh mit eigenem Shader braucht `boundsArea`.** Pixi leitet die
  Ausmaße aus der Geometrie ab; ein Shader, der seine Instanzen selbst
  positioniert, hat keine brauchbaren — Pixi hält das Mesh dann für leer und
  zeichnet es nicht.

## Arbeitsweise, die sich bewährt hat

Analyse und mechanische Portierung laufen über Unteragenten auf **Sonnet**.
Der Hauptfaden bleibt für Architektur und Entscheidungen. Sechs Agenten auf
dem großen Modell haben zu Beginn dieser Sitzung 40 % des Fensters in zwei
Minuten verbraucht — das war der Fehler des Tages.
