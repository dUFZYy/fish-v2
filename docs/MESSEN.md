# Auf dem Gerät messen

Der ganze Neubau steht und fällt mit einer Zahl, die dieser Rechner nicht
liefern kann. Eine RTX 4090 macht jeden Unterschied unsichtbar, auf den es
ankommt — das alte Projekt hat vier Runden lang auf dem falschen Gerät
gemessen und jedes Mal das Falsche daraus gelernt.

## Der schnelle Weg: im Browser des Telefons

```bash
npm run dev
```

Dann auf dem iPhone im selben WLAN öffnen:

```
http://<IP-dieses-Rechners>:8766/?perf=1
```

Die IP steht beim Start von Vite unter „Network". Safari genügt — es ist
dieselbe Engine wie in der Capacitor-App, nur ohne Build und ohne TestFlight.

## Was oben links steht

```
118.3 fps  med 8.5  p95 11.2  hak/s 0
sharp 3.00x 390x844
```

| | |
|---|---|
| `fps` | Median. Läuft es? |
| `med` | Millisekunden je Bild |
| `p95` | **Ruckelt es?** Nah am Median ist gut, mehr als 1,6× ist sichtbar |
| `hak/s` | Bilder je Sekunde über 1,5× Median UND ≥ 20 ms. Soll ≈ 0 sein |
| Zeile 2 | Auflösungsstufe, Gerätepixel je CSS-Pixel, Ausgabegröße |

**Ein Median von 100 mit p95 46 ruckelt sichtbar.** Immer alle drei lesen.

## Reihenfolge der Messung

1. **Zuerst die Obergrenze.** `?fish=0&water=0` — fast nichts wird gezeichnet.
   Ohne diese Zahl ist keine andere einzuordnen: 60 fps auf einem gewöhnlichen
   Telefon sind das Maximum, 60 fps auf einem iPhone mit ProMotion sind die
   halbe Rate.
2. **Der Normalfall.** `?perf=1` allein. So spielt es sich.
3. **Last.** `?fish=40&far=20` — deutlich mehr als das Spiel je zeigt.
4. **Was das Wasser kostet.** `?water=0` gegen `?water=1`, sonst gleich.
5. **Auflösungsstufen.** `?q=sharp`, `?q=balanced`, `?q=perf`.
6. **Nach drei Minuten noch einmal.** Der wichtigste Lauf: das alte Spiel
   wurde beim Warmwerden messbar langsamer, der neue Weg sollte das nicht.

## Alle Schalter

```
?perf=1              Bildzeit-Anzeige
?fish=N              Fische im Wasser (1..120)
?far=N               ferne Silhouetten (0..40)
?water=0             Wasser-Durchgang aus (Gegenprobe)
?day=0.5             Tageszeit festhalten (0 Mitternacht, 0.5 Mittag)
?q=sharp|balanced|perf   Auflösungsstufe festnageln
```

## Als App

```bash
npm run sync     # baut und schiebt es in ios/ und android/
npm run ios      # öffnet Xcode  (nur auf einem Mac)
npm run android  # öffnet Android Studio
```

In `ios/App/App/Info.plist` steht der Schlüssel, ohne den jede Messung gegen
einen Deckel läuft:

```xml
<key>CADisableMinimumFrameDurationOnPhone</key><true/>
```

Ohne ihn deckelt WKWebView auf 60 Hz. Das alte Projekt hat daran einmal eine
ganze Runde verloren: „58,8 fps, alles gut" war in Wahrheit die Hälfte
dessen, was das Gerät kann.

## Was die Zahlen bedeuten sollten

Der Aufbau ist so gewählt, dass die drei Posten wegfallen, die im alten Spiel
60 bis 75 % des Bildbudgets gekostet haben:

| | alt | neu |
|---|---|---|
| Szene je Bild neu rastern | ja | nein, gebacken |
| Textur-Upload je Bild | 1170×2532, 14–23 ms | **0** |
| bildschirmfüllende Ebenen im Compositor | 2 | 1 |
| Draw-Calls für den Schwarm | einer je Fisch | 1 |

Wenn die Zahl auf dem Gerät trotzdem nicht stimmt, sagt `?water=0`, ob es der
Wasser-Durchgang ist, und `?q=perf`, ob es die Pixelzahl ist. Beides sind
einzelne Posten und einzeln zu beheben — anders als im alten Aufbau, wo alle
drei an derselben Pixelzahl hingen.
