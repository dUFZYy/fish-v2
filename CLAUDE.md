# A Silly Fishing Game — v2

Neubau des Spiels aus `..\fishing-game` (Vanilla JS + Canvas 2D + Phaser-Wasserebene),
weil es auf einem iPhone 15 Pro Max nur 45 von 120 möglichen Bildern schafft.

**Nur Mobile. Nur Portrait. Keine PC-Fassung.**

Stack: Vite + TypeScript + PixiJS 8 (WebGL) + Capacitor 8.

## Der Grund für den Neubau, in einem Satz

Das alte Spiel zeichnet jedes Bild die ganze Szene neu mit Canvas-2D-Befehlen,
lädt sie als Textur hoch und mischt darüber eine zweite bildschirmfüllende
WebGL-Ebene mit einem Vollbild-Shader. Das sind drei Posten, die alle an der
Pixelzahl hängen, und zusammen 60–75 % des Bildbudgets kosten — unabhängig
davon, wie viel Inhalt im Bild ist.

## Die Architektur, und warum genau so

```
[ ein WebGL-Canvas, deckend ]   Pixi 8. Alles Bewegte.
   Szene:   gebackene Sprites aus Atlanten, ein Draw-Call je Batch
   Wasser:  ein Shader-Durchgang NUR über dem Wasserbereich
[ #ui, DOM ]                    Menüs, Panels, Schrift. Kleine Elemente,
                                nie eine zweite bildschirmfüllende Ebene.
```

Vier Regeln, jede aus einer Messung des alten Projekts (`..\fishing-game\docs\LEISTUNG-BASIS.md`):

1. **Nie eine Leinwand im selben Bild beschreiben und lesen.** Der Tiefenschleier
   über jedem Fisch lief im alten Spiel über eine Hilfsleinwand und kostete
   11 von 16,7 ms. Hier ist er ein Vertex-Attribut.
2. **Kein zweites Vollbild im Compositor.** Eine Ebene, die nichts zeigt,
   kostet trotzdem. Die Oberfläche besteht aus kleinen DOM-Elementen.
3. **Was einmal gerastert ist, wird nur noch kopiert.** Kein Einfärben, kein
   Maskieren, kein Umrechnen je Benutzung.
4. **Schlüssel und Signatur rastern auf DASSELBE.** Licht auf 64 Stufen,
   Größen auf eine Leiter. Sonst wirft der Cache sich selbst hinaus.

Messbar: `Baker.rebakesPerFrame` muss ~0 sein. Das ist die Zahl, die im alten
Projekt niemand gemessen hat und die dort bei 3–6 lag.

## Wo was liegt

```
src/engine/     Boot, Auflösungsstufen, Layout, Bildzeit-Messung
src/bake/       Atlas + Bäcker: alter Canvas-2D-Zeichencode -> GPU-Texturen
src/world/      Szene: Fisch-Batch, Kulissen, Wasser-Shader
src/game/       Spiellogik (portiert, renderer-frei)
src/data/       Arten, Shop, Fortschritt, Texte
src/ui/         DOM-Oberfläche
src/audio/      Klang und Musik
docs/spec/      Vollständige Spezifikation des ALTEN Spiels (8150 Zeilen).
                Vor jeder Portierung dort nachsehen, nicht im alten Code raten.
```

## Bauen und messen

```bash
npm run dev            # Vite auf 8766, im Netz erreichbar (Handy!)
npm run build
npm run sync           # build + cap sync
```

```
?perf=1                Bildzeit-Anzeige auf dem Gerät (fps, med, p95, hak/s, Stufe)
?fish=N                Last stellen
?q=sharp|balanced|perf Auflösungsstufe festnageln
```

**Gemessen wird auf dem Gerät, nicht hier.** Dieser Rechner hat eine RTX 4090
und macht jeden Unterschied unsichtbar, auf den es ankommt. Der Dev-Server ist
im WLAN erreichbar; die Anzeige ist groß genug zum Abfotografieren.

Die einzige Zahl, die nicht lügt, ist der Abstand zwischen zwei Bildern.
`p95` und `hak/s` immer mitlesen — ein Median von 100 fps mit p95 46 ruckelt
sichtbar.

## Fallen, die schon einmal Zeit gekostet haben

- **`CanvasSource`, nicht `TextureSource`.** Nur die erste hat einen Upload-Weg
  für ein Canvas. Mit der generischen bleibt die Textur leer, jedes Fragment
  wird verworfen, und es gibt **keine** GL-Meldung.
- **Ein Mesh mit eigenem Shader braucht `boundsArea`.** Sonst hält Pixi es für
  leer und zeichnet es nicht.
- **iOS deckelt die WebView auf 60 Hz**, wenn `CADisableMinimumFrameDurationOnPhone`
  in der `Info.plist` fehlt. Jede Messung liefe dann gegen den Deckel.

## Vorgehen

`docs/PLAN.md` hat die Etappen. Kurz: erst eine spielbare Scheibe (Steg am See,
Wurf bis Fang, echte Fischgrafik, Wasser-Shader) und auf dem Gerät gemessen —
danach der Rest. Das alte Spiel bleibt unangetastet als Vorlage und Vergleich.

Abnahmebedingung von Dustin für das alte Projekt gilt weiter:
**„Wichtig ist nur, dass das Spiel nicht schlechter aussieht, maximal besser."**
