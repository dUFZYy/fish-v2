# Was ich am Spiel ändern würde

Ehrliche Einschätzung nach dem Lesen der vollständigen Spezifikation (8150
Zeilen) und des alten Codes. Nicht Geschmack — begründet, mit Aufwand.

Reihenfolge: nach Wirkung geteilt durch Aufwand. **Nichts davon wird
angefasst, bevor die Fassung läuft und auf dem Gerät gemessen ist.** Erst
dann ist klar, wieviel Luft noch da ist.

Kennzeichnung: **[mach ich]** = eindeutig richtig, kleiner Eingriff, ich mache
es einfach. **[deine Entscheidung]** = ändert das Spielgefühl oder die
Wirtschaft, das ist deine Regie, nicht meine.

---

## 1. Das Werbe-Gate ist das größte Problem im Spiel — [deine Entscheidung]

Aktuell (`ads.js`): alle 3 Fänge kommt ein Gate. Entweder **5 Sekunden nicht
überspringbar warten**, oder Werbung sehen, oder 0,99 € zahlen.

Das steht an der schlechtesten Stelle, die es gibt: direkt nach dem Fang, im
Moment der größten Belohnung. Die Kernschleife dauert 20 bis 40 Sekunden, das
Gate greift also etwa jede zweite Minute. Und die kostenlose Option ist
**Totzeit als Strafe** — der Spieler lernt: „Fangen führt zu Blockade."

Das ist der zuverlässigste Weg, D1-Bindung zu verlieren. Und es verdient
weniger, nicht mehr: erzwungene Unterbrechungen haben schlechte
Abschlussquoten, weil der Spieler die App wegwischt.

**Vorschlag:** Gate ganz raus. Werbung nur noch dort, wo der Spieler sie
selbst holt, weil sie ihm etwas gibt:

- Fang verdoppeln (nach einem guten Fang angeboten, nicht erzwungen)
- Serie retten (gibt es schon — das ist das gute Muster)
- Tagesbonus verdoppeln
- „Glückswurf": ein Wurf mit erhöhter Seltenheitschance
- Wundertüte gratis, einmal am Tag

Werbefrei-Kauf bleibt, wird aber vom Ärgernis-Befreier zum Unterstützer-Kauf.
Erfahrungswert: der Umsatz je Spieler steigt dabei meistens, weil die
Bindung steigt und freiwillige Werbung fast immer zu Ende gesehen wird.

## 2. Der Drill ist zu lang für gewöhnliche Fische — [deine Entscheidung]

Die Wirtschafts-Simulation sagt: Holzrute fängt Gewöhnliches in **etwa 9
Sekunden**. Für eine Schleife aus Wurf, Warten, Biss, Drill, Fang ist das
lang. Ein Spieler fängt in fünf Minuten dann vielleicht acht Fische.

**Vorschlag:** Gewöhnlich 3–4 s, Selten 6–8 s, Episch 10–12 s, Boss 15–25 s.
Lange Drills sind ein Belohnungsmittel, kein Grundzustand — Spannung muss
man sich verdienen, nicht aussitzen. Die Zahlen liegen alle in `drill.ts`
und sind eine Zeile.

## 3. Warten auf den Biss ist Totzeit — [mach ich]

Zwischen Wurf und Biss passiert nichts, was der Spieler tun kann. Das
Anknabbern ist ein gutes Vorzeichen, aber es ist passiv.

**Vorschlag:** Antippen zuckt den Köder. Kurze Abklingzeit (ca. 0,8 s), gibt
einen kleinen Bonus auf die Anlock-Rate, und ein Fisch in Reichweite dreht
sichtbar den Kopf. Aus Warten wird Spielen, und es macht die Anlock-Mechanik
zum ersten Mal sichtbar.

## 4. Der Lockradius ist unsichtbar — [mach ich]

Ruten unterscheiden sich vor allem durch **Lockradius** und **Zonengröße**.
Beides sieht der Spieler nie. Er kauft eine Zahl, die er nicht wahrnehmen
kann — und merkt darum auch nicht, dass die neue Rute besser ist.

**Vorschlag:** Während des Wartens ein weicher Ring ums Schwimmerchen auf dem
Wasser, in Lockradius-Größe. Kostet einen Partikel-Kreis. Danach ist jedes
Rutenupgrade sofort spürbar.

## 5. Der Schwarm ist Deko, obwohl er fast ein Zielspiel wäre — [mach ich]

Es gibt schon ein schönes Detail: wirft man **direkt auf** einen Fisch,
verscheucht man ihn („nah dran, nicht drauf"). Das ist die Hälfte einer
Mechanik.

**Vorschlag:** die andere Hälfte dazu. Ein Wurf **knapp neben** einen
sichtbaren Fisch gibt einen echten Bonus auf Anlockung und
Seltenheitschance. Damit wird der sichtbare Schwarm zum Ziel statt zur
Tapete, und die Frage „wohin werfe ich" hat plötzlich eine Antwort. Das ist
die größte ungenutzte Mechanik, die schon im Spiel liegt.

## 6. Der Boss hinter 100 % Fischdex ist zu hart — [deine Entscheidung]

Bosse erscheinen erst bei vollständigem Dex des Ortes. Damit wird ein
Höhepunkt zur Sammelpflicht, und die meisten Spieler sehen ihn nie.

**Vorschlag:** ab etwa 70 % des Ortsdex, oder nach N Fängen dort. Der Rest
des Dex bleibt für die Belohnungen, die es dafür schon gibt.

## 7. Cutscenes und Texte — [mach ich, wenn die Fassung steht]

Dustins Punkt, und er hat recht. Was ich im alten Stand sehe:

- Die Cutscenes sind Schauwerte ohne Stimme. Der Text darin ist funktional
  („Etwas Großes bewegt sich in der Tiefe"), also genau das, was jedes Spiel
  schreibt.
- Sie unterbrechen, und Überspringen ist nicht durchgängig.
- Die Kapiteltexte in `story.js` lesen sich wie Aufgabenbeschreibungen.

Das Spiel heißt **A Silly Fishing Game**. Der Ton ist damit vorgegeben, und
er wird nicht eingelöst. Vorschlag:

- **Kurz.** Jede Cutscene höchstens 3 Sekunden, ein Satz.
- **Immer überspringbar**, mit sichtbarem Hinweis beim ersten Mal.
- **Eine Stimme.** Trocken, knapp, leicht respektlos gegenüber dem eigenen
  Ernst. Nicht „Die Legende erwacht", sondern etwas, das den Fisch und die
  Lage beschreibt und dabei grinst.
- **Konkret statt pathetisch.** Ein Name, ein Detail, eine Übertreibung.
  Die Trivia-Sätze im Fischdex (105 davon, „ein frecher Satz pro Art")
  treffen den Ton schon — die Cutscenes und Kapitel müssen nur dahin
  aufholen.
- Ein durchgehender Erzähler wäre die billigste Charaktergabe, die dieses
  Spiel bekommen kann: keine Grafik, keine Technik, nur Text.

Aufwand: ein Schreibdurchgang, kein Code. Ich lege einen Vorschlag als
Textdatei daneben, dann kannst du streichen und überschreiben, statt dass ich
dir meinen Humor unterschiebe.

## 8. Ein Grund, heute wiederzukommen — [mach ich]

Tagesaufträge und Pass gibt es. Was fehlt, ist ein Grund, warum **heute**
anders ist als gestern.

**Vorschlag:** „Wasser des Tages" — eine rotierende Tageseigenschaft, aus dem
Datum gesetzt wie die Aufträge, also für alle Spieler gleich: klares Wasser
(+20 % Selten), Wind (Bisse schneller), trüb (Bisse langsamer, aber mehr
Coins), Vollmond (Nachtfische auch tagsüber). Eine Zeile im HUD, drei Zeilen
Code, und jeder Tag hat einen Charakter.

## 9. Was ich ausdrücklich NICHT ändern würde

- **Das Becken als Hauptmenü.** Ungewöhnlich, charmant, funktioniert. Die
  meisten Spiele hätten hier eine Kachelwand.
- **Alles prozedural gezeichnet, kein einziges Bild-Asset.** Das ist die
  stärkste technische Entscheidung im Projekt: winziger Download, jede
  Auflösung scharf, jede Farbe zur Laufzeit änderbar. Bleibt.
- **Die Trivia-Sätze.** Der Ton, den der Rest des Spiels erreichen sollte.
- **Der Ablauf Wurf → Biss → Drill.** Der Kern ist richtig, er ist nur an
  drei Stellen zu langsam und an einer zu unsichtbar.
- **Die Wirtschaftskurve** (6–8 h bis zur Arktis). Dahinter steht eine
  Simulation; ohne eigene Daten würde ich das nicht umwerfen.

---

## Reihenfolge, wenn du alles freigibst

1. Lockradius sichtbar machen (klein, macht Upgrades spürbar)
2. Köder zucken auf Antippen (klein, tötet die Totzeit)
3. Neben-den-Fisch-Bonus (klein, macht den Schwarm zum Ziel)
4. Wasser des Tages (klein, gibt dem Tag Charakter)
5. Drill-Zeiten kürzen (eine Zeile, aber Balancing)
6. Werbe-Gate ersetzen (größter Gewinn, größte Entscheidung)
7. Boss-Freischaltung lockern
8. Schreibdurchgang für Cutscenes, Kapitel und Erfolge
