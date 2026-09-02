# 01 — Core Loop Spezifikation

Quelle: `fishing-game/script.js`, `mechanics.js`, `events.js`, `hype.js`, `effects.js`,
`bossfight.js`, `dive.js` (Original-Projekt, Stand 01.–02.09.). Ergänzend gelesen, um
referenzierte Globals aufzulösen: `fish.js`, `shop.js`, `locations.js`, `talents.js`,
`progress.js`, `gems.js`, `draw.js` (nur Konstanten/Header), `cutscene.js`, `ads.js`.

Ziel: exakte, zahlengenaue Nachbildung der Spiellogik mit einem anderen Renderer
(Phaser 4 / GPU statt Canvas2D). Alle Formeln sind wörtlich aus dem Original übernommen.
Variablennamen entsprechen den Originalnamen, damit sie auffindbar bleiben.

---

## 1. State Machine

### 1.1 Bildschirm-Ebenen (über der State Machine, in dieser Reihenfolge geprüft)

Es gibt VIER sich gegenseitig ausschließende Vollbild-Ebenen, geprüft in `redraw()` von
oben nach unten — die erste zutreffende gewinnt und beendet die Zeichenfunktion:

1. **Kapitel-Cutscene** (`storyActive()`) — Vollbild, kein HUD, deckt alles ab.
2. **Ladebildschirm** (`Intro.active`) — Vollbild, deckt NICHT die Welt-Ebene ab (zeichnet selbst Weltbilder).
3. **Becken-Zimmer / Hub** (`hubScreen`) — Hauptmenü/Einstieg, deckt ab.
4. **Angelplatz** — alles Übrige (die eigentliche State Machine unten).

Alle vier pausieren die "Weltzeit" `time` (siehe 1.2), außer der Boss-Auftritt
(`cutscene`, s.u.), der eine Ausnahme ist: er läuft ÜBER dem Angelplatz, während dieser
weiterläuft.

`overlay` (String | null: `"shop"|"dex"|"map"|"quests"|"daily"|"settings"|"achievements"|
"leaderboard"|"pass"|"talents"|"decor"|"inventar"|"diag"`) liegt als Panel ÜBER dem
Angelplatz und pausiert ihn ebenfalls (siehe `worldPaused()`).

`worldPaused()`:
```js
function worldPaused() {
  return hubScreen || Intro.active || storyActive() || !!overlay || !!Ads.current || !!Ads.gate;
}
```

### 1.2 Zwei Uhren

- `time` — **Weltzeit**. Treibt Wellen, Wolken, Vögel, Fische, Kaustik, Rutenzittern,
  Sonarstrahl, Wetter, Tag/Nacht. **Steht still**, wenn `worldPaused()` wahr ist.
- `uiTime` — **Oberflächenzeit**. Läuft IMMER (auch im Menü/Cutscene). Treibt
  Becken-Zimmer-Animationen, Menü-Funkeln, Level-Up-Panel.

Beide starten bei 0 und laufen synchron, bis zum ersten Mal pausiert wird.

`update(dt)`:
```js
function update(dt) {
  uiTime += dt;
  if (!worldPaused()) updateWorld(dt);
  updateAlways(dt);
}
```

`updateAlways(dt)` läuft IMMER: Musik, Becken-Ertrag (hängt an `Date.now()`, nicht dt),
Konfetti/Münzflug/Toasts/Textpartikel (UI-Antwort auf Berührung), Tap-Echo,
Druck-Feedback, Screen-Shake-Decay, Overlay-Übergänge, Cutscenes, Intro, Ads, Musik.

`updateWorld(dt)` läuft NUR wenn nicht pausiert: `time += dt`, Tageszeit, Himmelskörper,
Wetter, Fische, Möwe, Sonar, Eisloch, alle Angelplatz-Effekte, Totem-Timer, und die
eigentliche Angel-State-Machine unten.

### 1.3 Haupt-State-Machine: `gameState`

Zustände: `"ready" | "casting" | "waiting" | "biting" | "reeling" | "caught" |
"retrieving" | "bossfight" | "shooting"` (`"shooting"` nur im Tauchmodus, für die
fliegende Harpune).

```
ready ──castTo()──► casting ──(0.75s Flug)──► waiting ──(Fisch beißt)──► biting
  ▲                                              │                         │
  │                                              │ (Spieler tippt = retrieve)  │ startReeling()
  │                                              ▼                         ▼
  │                                        retrieving ◄──(Timeout/Flucht)── reeling ──(progress≥1)──► caught
  │                                              ▲                         │                            │
  │                                              │                    (tension≥1 = Riss)                │ finishCatch()
  │                                              └─────────────────────────┘                            │
  └──────────────────────(retrieveAnim 0.4s)◄────────────────────────────────────────────────────────────┘

Boss-Sonderweg: biting, wenn Fisch sp.boss === true ──► bossfight (statt reeling)
                bossfight ──(stamina≤0 = Sieg)──► caught (via catchFish())
                bossfight ──(line≤0 = Verlust)──► retrieving (via fishEscapes())

Tiefsee-Sonderweg: ready ──shootHarpoon()──► shooting ──(Treffer)──► biting (biteTimer=99, sofort startReeling())
                                            └─(Fehlschuss, Leine zurückgezogen)──► ready
```

**Transitionen im Detail:**

| Von | Nach | Auslöser | Bedingung |
|---|---|---|---|
| `ready` | `casting` | Tap/Klick ins Wasser (y > horizonY+10) oder Space | Nicht im Eisloch blockiert (`iceHoleBlocked()`), kein `snag` |
| `ready` | `casting` (ice) | Tap auf Eisloch | X wird auf `iceHoleX()±iceHoleRX()*0.55` geklemmt |
| `ready` | (bleibt `ready`, Sondereffekt) | Tap auf zugefrorenes Loch | `chopIceHole()` — kein State-Wechsel |
| `ready` | (bleibt `ready`, Sondereffekt) | Tap bei aktivem `snag` | `tapSnag()` — kein State-Wechsel |
| `ready` | `shooting` (Tiefsee) | `pointerup` nach `startCharge()` | `releaseCharge()` → `shootHarpoon()` |
| `casting` | `waiting` | `castAnim.t >= 1` (0.75s) | `landBobber()` |
| `waiting` | `biting` | Fisch erreicht Haken (`dist < 14*uiScale()`) | `startBite(f)` |
| `waiting` | `retrieving` | Erneuter Tap ins Wasser | `retrieve()` |
| `biting` | `reeling` | Tap/Space innerhalb `BITE_WINDOW` | normaler Fisch: `startReeling()` |
| `biting` | `bossfight` | Tap/Space innerhalb `BITE_WINDOW` | `bitingFish.species.boss === true`: `startBossFight()` |
| `biting` | `retrieving` | `biteTimer <= 0` (1.8s abgelaufen) | `fishEscapes("Entwischt!")` → `retrieve()` |
| `reeling` | `caught` | `reel.progress >= 1` | `catchFish()` |
| `reeling` | `retrieving` | `reel.tension >= 1` (Schnur reißt) | `fishEscapes(...)` → `retrieve()` |
| `reeling` | `retrieving` | `progress<=0 && t>2.5` ODER `idle>4s` | Abgeschüttelt: `fishEscapes("Abgeschüttelt! …")` |
| `bossfight` | `caught` | `stamina <= 0` | `winBossFight()` → `catchFish()` |
| `bossfight` | `retrieving` | `line <= 0` | `loseBossFight()` → `fishEscapes(...)` |
| `caught` | `retrieving` | Tap/Space, `catchInfo.t >= 0.4s`, keine aktive Möwen-Attacke, keine Werbe-Schranke | `finishCatch()` |
| `retrieving` | `ready` | `retrieveAnim.t >= 1` (0.4s) | automatisch |
| `shooting` | `biting`→`reeling` | Harpune trifft Fisch | `harpoonHit()`: setzt `biteTimer=99`, ruft sofort `startReeling()` |
| `shooting` | `ready` | Harpune verfehlt, kehrt zurück (`dist<=0`) | automatisch |

**Wichtige Timer/Konstanten:**

| Konstante | Wert | Bedeutung |
|---|---|---|
| `BITE_WINDOW` | `1.8` s | Zeitfenster zum Anschlagen nach dem Biss |
| `DAY_LENGTH` | `300` s | Ein voller Tag/Nacht-Zyklus |
| Cast-Flugzeit | `0.75` s | `castAnim.t += dt/0.75` |
| Retrieve-Animation | `0.4` s | `retrieveAnim.t += dt/0.4` |
| `SONAR_CD` / `SONAR_DUR` | `14` s / `3.6` s | Echolot-Cooldown/-Dauer (nur Boot) |
| `CUTSCENE_DUR` | `4.2` s | Boss-Auftritt-Cutscene |
| Ad-Rescue-Fenster | `4.5` s | Zeit, das Serie-Retten-Angebot anzunehmen |
| Eisloch-Zufrieren | `-0.018`/s | nur wenn `gameState==="ready"` |
| Eisloch-Freihacken | `+0.26` pro Tap | `ICE_MIN = 0.42` (Schwelle blockiert) |
| Riff-Verhaken | `need: 5` Taps | zum Befreien |

---

## 2. Casting

### 2.1 Input

- **Pointerdown** auf Canvas: `unlockAudio()`, dann Zustandsprüfungen in fester
  Reihenfolge (Bench-Modus → Intro → Story-Tap → Cutscene-Sperre → Möwe-Tap →
  Hub-Band-Drag → UI-Buttons → Overlay-Sperre → Hub-Tap → Spielfeld-Logik).
- Space-Taste: identisches Verhalten wie Tap, zielt auf `mouseX/mouseY` (oder
  Default `canvas.width*0.4, horizonY+canvas.height*0.3`, wenn Maus über dem Wasser
  nicht positioniert ist).
- Nur `y > horizonY + 10` löst Wasseraktionen aus (Cast/Retrieve/Chop).

Spielfeld-Dispatch (Tap ins Wasser), Reihenfolge:
```js
if (snag) { tapSnag(); return; }
if (iceHoleBlocked() && gameState === "ready") { chopIceHole(); return; }
if (isDiveMode() && gameState === "ready" && y > horizonY + 10) startCharge(x, y);
else if (gameState === "ready" && y > horizonY + 10) castTo(x, y);
else if (gameState === "waiting" && y > horizonY + 10) retrieve();
else if (gameState === "biting") startReeling();
else if (gameState === "reeling") { isHolding = true; reelTap(x); }
else if (gameState === "bossfight") { isHolding = true; bossFightTap(x, y); }
else if (gameState === "caught") finishCatch();
```
`pointerup`/`pointercancel`/`pointerleave`: `isHolding = false; releaseCharge();`
(im Drill/Boss-Fight bedeutet `isHolding` "gedrückt halten"; die Harpune nutzt
dasselbe Flag über `releaseCharge()`.)

### 2.2 Wurf-Parabel

```js
function castTo(x, y) {
  if (gameState !== "ready") return;
  gameState = "casting";
  const tx = getLocation().mode === "ice"
    ? clamp(x, iceHoleX() - iceHoleRX() * 0.55, iceHoleX() + iceHoleRX() * 0.55)
    : clamp(x, 20, canvas.width - 20);
  castAnim = { t: 0, x0: rodTipX, y0: rodTipY, x1: tx, depth: clamp(y, horizonY + 40, canvas.height - 20) };
  bobberX = rodTipX; bobberY = rodTipY;
  hookInWater = false;
}
```
Update während `casting` (in `updateWorld`):
```js
castAnim.t += dt / 0.75;
const t = clamp(castAnim.t, 0, 1);
bobberX = lerp(castAnim.x0, castAnim.x1, easeOut(t) * 0.7 + t * 0.3);   // Mischung aus eased und linear
const ty = getWave(castAnim.x1);
bobberY = lerp(castAnim.y0, ty, t) - Math.sin(t * Math.PI) * canvas.height * 0.22;  // Bogenhöhe = 22% der Höhe
if (t >= 1) landBobber();
```
`easeOut(t) = 1 - (1-t)^3`. Der Bobber landet nach 0.75 s an `(castAnim.x1,
getWave(castAnim.x1))`, mit einem Sinusbogen von `canvas.height*0.22` Höhe.

### 2.3 Landung (`landBobber`)

```js
bobberX = castAnim.x1; bobberY = getWave(bobberX);
hookX = bobberX; hookY = bobberY + 10; hookInWater = true;
hookTargetY = castAnim.depth;   // Ziel-Tiefe, Haken sinkt später dorthin (dt*2.5 lerp)
castAnim = null; gameState = "waiting"; waitTime = 0;
```
Effekte: `spawnSplash(bobberX,bobberY,14,"rgba(220,240,255,0.9)",0.8)`,
`spawnRipple(bobberX,bobberY,45,3)`, `maybeSnag()` (Riff-Verhaken-Check, siehe 3).

**Fisch-Verscheuchung** — jeder Fisch im Zustand `"roam"`, dessen Distanz zum
Landepunkt `< 70*uiScale()` ist, ODER `|dx|<40*uiScale() && f.y<hookTargetY`, wechselt
zu `"fleeing"` (weglaufen). Direktes Landen AUF einem Fisch fängt ihn NICHT — es
verscheucht ihn.

**Onboarding-Sonderfall** (2. Wurf, `save.stats.catches===1 && !save.onboardRare`):
garantiert ein Fisch der Seltenheit `idx===2` (rare), nicht `night`, nicht `junk`,
wird direkt in Attraktions-Reichweite gesetzt (`state:"attracted"`). Nur einmal pro
Save.

### 2.4 Float/Bobber-Physik

Wellenfunktion (treibt Bobber, Wasserlinie, Regenzielpunkte etc.):
```js
function getWave(x, phase = 0) {
  const waveHeight = 10, waveLength = 25;
  return horizonY + Math.sin(x / waveLength + time * 2 + phase) * waveHeight
                   + Math.sin(x / 90 - time * 0.7 + phase) * 4;
}
```
Während `waiting`/`biting` (nicht `reeling`):
```js
bobberY = getWave(bobberX);
hookX = bobberX;
hookY = lerp(hookY, hookTargetY, dt * 2.5);   // Haken sinkt träge zur Zieltiefe
```
Während `reeling`: siehe Abschnitt 4 (Fischbewegung überschreibt Bobber/Haken).

### 2.5 Linie/Rendering

Renderer-gebunden (`drawLine`, `drawBobber`, `drawSurfaceMirror`, `drawSnapLine`),
nicht Teil der portablen Logik — siehe Abschnitt 13. Wichtig für die Neubauten:
die Schnur führt von `(rodTipX,rodTipY)` zu `(hookX,hookY)`.

### 2.6 Treffer auf einen Fisch

Es gibt **keinen direkten "Hook-hits-fish"-Treffer beim Werfen** (außer im
Tauchmodus, siehe Abschnitt 9). Am Land/Boot/Eis fängt man ausschließlich über die
Attraktions-Logik (Abschnitt 3): Der Köder liegt, Fische nähern sich, der Biss
passiert, wenn ein Fisch nah genug herankommt.

---

## 3. Beiss-Mechanik (Attraktion, Nibble, Biss-Fenster)

### 3.1 Fisch-Auswahl beim Spawnen (`pickSpecies`, `fish.js`)

```js
const bait = getBait();
const night = daylight() < 0.45;              // daylight() = getPalette(dayTime).light
const golden = isGoldenHour();
const bossOk = bossUnlocked(here);             // Dex des Orts (ohne Boss) komplett
if (bossOk && bossSp && !fishes.some(f=>f.species.boss) && Math.random() < 0.5) return bossSp;
const pool = SPECIES.filter(s => s.loc.includes(here) && (!s.night || night) && !s.boss);
// Gewicht je Art:
let w = RARITY[s.rarity].weight;                          // common 50, uncommon 24, rare 10, epic 3.5, legendary 1
if (rarityIdx >= 2) w *= bait.rareMult * (golden?2:1) * (totemActive("magnet")?2:1) * talentMult("glueck",0.08);
if (rarityIdx === 4) w = Math.sqrt(w) * 0.8;               // Legendär bleibt selten, auch mit Top-Köder
if (rarityIdx === 1) w *= 1 + (bait.rareMult - 1) * 0.4;
if (s.night) w *= 2.2;
if (s.junk) w = s.id==="stiefel"?5 : s.id==="schatzkiste"?1.2 : s.id==="pinguin"?0.8 : 3;
// gewichtete Zufallsauswahl über alle w
```

### 3.2 Lure-Radius (Lockradius)

```js
const attractRadius = Math.max(canvas.width, canvas.height * 0.85) * rod.radius * talentMult("auge", 0.08);
```
`rod.radius` (siehe Rutentabelle, Abschnitt 12) reicht von `0.14` (Holzrute) bis
`0.50` (Das erste Projekt); Ruten-Upgrades: `radius *= 1 + 0.03*upgradeLevel` (max 10
Stufen). `talentMult("auge", 0.08) = 1 + rank*0.08` (max Rang 5 → ×1.4).
Boss-Fische haben `×1.6` Bonus-Radius: `attractRadius * (sp.boss ? 1.6 : 1)`.

### 3.3 Anlock-Rate (roam → attracted)

Nur während `gameState==="waiting" && hookInWater`. Pro Fisch im Zustand `"roam"`
innerhalb `attractRadius`:
```js
const onboarding = save.stats.catches < 2 ? 5 : 1;
const waitBoost = (gameState==="waiting" ? 1 + waitTime/6 : 1)
                * (weather.type==="rain" ? 1.6 : 1)
                * (isGoldenHour() ? 1.3 : 1)
                * onboarding
                * (totemActive("lockruf") ? 2 : 1);
const rarityPenalty = sp.boss ? 1.5 : [1, 0.7, 0.45, 0.3, 0.2][RARITY[sp.rarity].idx];
const rate = 0.55 * rarityPenalty * bait.rate * waitBoost * talentMult("geduld", 0.10);
if (Math.random() < rate * dt) f.state = "attracted";
```
`bait.rate` (Köder-Biss-Rate): Wurm `1.0`, Brotkugel `1.4`, Mais `1.3`, Köderfisch
`1.5`, Garnele `1.6`, Glitzerköder `1.8`. `bait.rareMult`: `1, 1.2, 1.6, 2.6, 3.4, 4.5`.

Boss-Fische haben Vorfahrt: solange ein Boss im Wasser ist (`fishes.some(x=>x.species.boss
&& x.state!=="fleeing")`), können normale Fische nicht anbeißen (`!bossHere || sp.boss`).

### 3.4 Anschwimmen, Anknabbern ("Nibble"), Biss

```js
// wenn state === "attracted":
const sp2 = sp.speed * 70 * uiScale();
f.vx = lerp(f.vx, dx/dist * sp2, dt*3);   f.vy = lerp(f.vy, dy/dist * sp2, dt*3);
if (dist < 70*uiScale() && Math.random() < dt*2.5) {
  nibble = 0.35;   // Pose zuckt kurz (Vorfreude-Animation)
  Sound.tick(); haptic(8); spawnRipple(bobberX, bobberY, 14, 1);
}
if (dist < 14*uiScale()) startBite(f);
```
`startBite(f)`:
```js
function startBite(f) {
  bitingFish = f; f.state = "biting"; biteTimer = BITE_WINDOW; gameState = "biting";
  spawnRipple(bobberX,bobberY,35,2); spawnSplash(bobberX,bobberY,6,"rgba(220,240,255,0.9)",0.5);
}
```
Ein Fisch, der nicht angebissen wird, kehrt zu `"roam"` zurück, sobald `waiting`
endet.

### 3.5 Biss-Fenster & Timer-Ring

`biteTimer` zählt ab `BITE_WINDOW=1.8` s herunter. UI: `drawBiteAlert()` zeigt ein
"!" über dem Bobber (Bounce-Animation `|sin(time*10)|*10`) und einen Ring:
```js
const frac = clamp(biteTimer / BITE_WINDOW, 0, 1);
// Ringfarbe: gelb (#ffd23a) wenn frac>0.35, sonst rot (#ff5a3a)
// Bogen von -PI/2 im Uhrzeigersinn über frac*2*PI
```
Bei `biteTimer<=0`: `fishEscapes("Entwischt!")`.

### 3.6 Alle Multiplikatoren im Überblick

| Multiplikator | Wo wirkt er | Formel/Wert |
|---|---|---|
| Onboarding (erste 2 Fänge) | Anlock-Rate | `×5` |
| Onboarding (erste 10 Fänge) | Drill: `reelRate`, Burst-Timing | `+0.04` reelRate, `burstEvery×1.3`, `nextBurst×1.4` |
| Regen | Anlock-Rate | `×1.6` |
| Goldene Stunde | Anlock-Rate | `×1.3` |
| Goldene Stunde | Seltenheits-Gewicht (`idx>=2`) | `×2` |
| Wartezeit | Anlock-Rate | `1 + waitTime/6` |
| Totem `lockruf` | Anlock-Rate | `×2` (180s) |
| Totem `magnet` | Seltenheits-Gewicht | `×2` (300s) |
| Totem `glueck` | Shiny-Chance | `×4` (300s) |
| Talent `geduld` (max Rang 5) | Anlock-Rate | `1+rank*0.10` (bis ×1.5) |
| Talent `auge` (max Rang 5) | Lockradius | `1+rank*0.08` (bis ×1.4) |
| Talent `glueck` (max Rang 5) | Shiny-Chance, Seltenheits-Gewicht | `1+rank*0.25` bzw. `1+rank*0.08` |
| Nachtfische | Gewicht, wenn `daylight()<0.45` | `×2.2`, sonst ausgeschlossen |
| Köder `rareMult`/`rate` | Seltenheits-Gewicht/Anlock-Rate | siehe Tabelle 3.3 |

---

## 4. Drill-Minigame v3 „Halten & Loslassen"

**Prinzip:** Halten = Einholen (Fortschritt↑, Spannung↑). Der Fisch flieht in Schüben
(„ZIEHT!"): dann loslassen, sonst schießt die Spannung hoch → Schnur reißt. Alles
dt-basiert, framerate-unabhängig.

### 4.1 Initialisierung (`startReeling`)

```js
const sp = bitingFish.species;
if (sp.boss) { startBossFight(bitingFish); return; }   // Bosse NIE im normalen Drill
hookedFish = bitingFish; hookedFish.state = "hooked";
const fight = sp.fight, onboarding = save.stats.catches < 10;
const rodF = clamp((rod.zone - 0.26) / 0.22, 0, 1);   // 0 = Holzrute … 1 = beste Rute
reel = {
  boss: !!sp.boss, t: 0, progress: 0, tension: 0.15, maxProgress: 0, perfect: true, maxTension: 0,
  reelRate: (sp.junk ? 0.6 : clamp(0.25 - fight*0.035 + rodF*0.14 + (onboarding?0.04:0), 0.08, 0.45)) * talentMult("arme", 0.06),
  tensionHold: 0.10 + fight*0.04 - rodF*0.03,
  tensionBurst: 1.0 + fight*0.3,
  tensionRelease: (0.45 + rodF*0.45) * talentMult("hand", 0.08),
  drainRelease: 0.05 + fight*0.02,
  burst: null,
  nextBurst: rand(1.0, 1.8) * (onboarding ? 1.4 : 1),
  burstEvery: [rand(1.3,2.2), rand(0.9,1.5), rand(0.65,1.1)][fight<1.5?0:fight<2.6?1:2] * (onboarding?1.3:1),
  warnDur: fight >= 2 ? 0.25 : 0.4,
  fakeChance: fight >= 1.8 && !onboarding ? 0.3 : 0,
  warn: 0, feedbackT: 0, lastResult: null,
  anchorX: bobberX, depthY: hookY, fightPhase: 0, jump: null, jumpTimer: rand(1.5,3), dash: 0
};
gameState = "reeling"; isHolding = false;
```
`rod.zone` reicht von `0.26` (Holz) bis `0.48` (Kumpel-Rute), +`0.01`/Upgrade-Stufe.
`sp.fight` ist die Kampfstärke der Art (Tabelle in `fish.js`/`locations.js`, Bereich
ca. `0.4`–`5.0`).

### 4.2 Fluchten, Vorwarnung, Finten (`updateReel`, Teil 1)

```js
if (!r.burst) {
  r.nextBurst -= dt;
  r.warn = clamp(1 - r.nextBurst / r.warnDur, 0, 1);   // 0..1 Vorwarnung, letzte warnDur Sekunden vor Flucht
  if (r.nextBurst <= 0) {
    if (r.fake == null) r.fake = Math.random() < r.fakeChance;
    if (r.fake) {   // FINTE: nur zucken, keine echte Flucht
      r.fake = null; r.nextBurst = r.burstEvery * rand(0.5, 0.9);
      r.anchorX = clamp(r.anchorX + (±1)*rand(30,60)*uiScale(), 40, canvas.width-40);
      r.dash = 0.4; return;
    }
    r.fake = null;
    r.burst = { t: 0, dur: rand(0.5, 0.85) + (r.boss ? 0.3 : 0), dir: ±1, countered: false };
    r.anchorX = clamp(r.anchorX + r.burst.dir * rand(90, 170) * uiScale(), 40, canvas.width-40);
    r.dash = 1;
  }
} else {
  r.burst.t += dt; r.warn = 0;
  if (r.burst.t >= r.burst.dur) { r.burst = null; r.nextBurst = r.burstEvery * rand(0.8, 1.25); }
}
```

### 4.3 Spannung & Fortschritt

```js
if (isHolding) {
  r.tension += (r.burst && !r.burst.countered ? r.tensionBurst : r.tensionHold) * dt;
  r.progress += r.reelRate * dt * (r.burst && !r.burst.countered ? 0.4 : 1);   // während Flucht nur 40% Tempo
} else {
  r.tension -= r.tensionRelease * dt;
  r.progress -= r.drainRelease * dt;
}
r.tension = clamp(r.tension, 0, 1); r.progress = clamp(r.progress, 0, 1);
```

### 4.4 Fail-Bedingungen

```js
r.idle = isHolding ? 0 : (r.idle||0) + dt;
if ((r.progress <= 0 && r.t > 2.5) || r.idle > 4) fishEscapes("Abgeschüttelt! Halten nicht vergessen.");
// ...
if (r.tension >= 1) {
  const nearMiss = r.maxProgress >= 0.8;
  snapAnim = { t: 0, x: bobberX, y: bobberY };
  if (nearMiss) addFloatingText("So knapp!", canvas.width/2, canvas.height*0.3, "#ff8a80", 30);
  fishEscapes(nearMiss ? `Schnur gerissen – bei ${Math.round(r.maxProgress*100)} %!` : "Schnur gerissen!");
}
```

### 4.5 Perfekter Drill

`perfect` startet `true` und wird `false`, sobald `tension > 0.75` — d.h. **perfekt =
Spannung nie über 75 % während des gesamten Drills**. Ausgewertet in `catchFish()` als
`reel.perfect && !sp.junk` (Ausschuss zählt nie als perfekt).

### 4.6 Rutenzittern & Feedback

```js
rodBend = lerp(rodBend, 0.3 + r.tension * 0.9, dt * 8);
if (r.tension > 0.85 && Math.random() < dt*8) Sound.reelClick();
if (isHolding && Math.random() < dt*4) spawnSplash(hookX, bobberY, 2, "rgba(220,240,255,0.7)", 0.5);
```

### 4.7 Boss-Variante: Richtungs-Taps (`reelTap`)

```js
function reelTap(x) {
  if (reel.boss && reel.burst && !reel.burst.countered && x != null) {
    const side = x < canvas.width/2 ? -1 : 1;
    if (side === -reel.burst.dir) {   // Gegenseite tippen = korrekt gekontert
      reel.burst.countered = true; reel.tension = Math.max(0, reel.tension - 0.3);
      reel.progress = Math.min(1, reel.progress + 0.06);
    } else {
      reel.tension = Math.min(1, reel.tension + 0.18); reel.perfect = false;
    }
  }
}
```
**Wichtig:** Dieser Zweig ist im normalen Spielfluss **unerreichbar** — Bosse werden
bereits in `startReeling()` VOR der `reel`-Erzeugung abgefangen und laufen komplett
über `bossfight.js` (Abschnitt 8). `reel.boss` ist im echten Spiel immer `false`.
Für den Rebuild: entweder als totes Feature weglassen, oder bewusst reaktivieren,
falls gewünscht — es ist vollständig implementiert, aber nie aufrufbar.

### 4.8 Fisch-Bewegung während des Drills (in `updateWorld`)

```js
reel.fightPhase += dt * (1.1 + hookedFish.species.fight * 0.5);
const amp = (50 + hookedFish.species.fight * 20) * uiScale() * (1 + reel.dash * 1.5);
const pull = Math.sin(reel.fightPhase) * amp + Math.sin(reel.fightPhase * 2.7) * amp * 0.25;
const targetX = clamp(reel.anchorX + pull, 20, canvas.width - 20);
bobberX = lerp(bobberX, targetX, min(1, dt*6));
// Fisch steigt zum sichtbaren Bereich, abhängig vom Fortschritt:
const riseY = min(panelTop, lerp(reel.depthY, horizonY + 30*uiScale(), 0.4 + 0.6*clamp(reel.progress,0,1)));
// Sprung: zufällig (jumpTimer rand(1.5,3)/rand(2,4)), nur wenn progress>0.4, hookY oberflächennah, nicht auf Eis
```

---

## 5. Catch-Berechnung

### 5.1 Gewicht

```js
const kg = +(sp.kg[0] + Math.pow(Math.random(), 1.6) * (sp.kg[1] - sp.kg[0]) * (f.scale / 1.3)).toFixed(2);
```
`f.scale = rand(0.8, 1.3)` (bei Fisch-Erzeugung festgelegt). `Math.pow(random(),1.6)`
verzerrt die Verteilung Richtung kleinerer Gewichte (mehr kleine als große Fische).

### 5.2 Streak & Multiplikator

```js
streak = sp.junk ? streak : streak + 1;                    // Ausschuss unterbricht/erhöht die Serie nicht
const mult = streakMultiplier() * (perfect ? 1.5 : 1);
function streakMultiplier() { return 1 + 0.25 * Math.min(Math.max(streak - 1, 0), 4); }
// streak 1 → ×1.00, 2 → ×1.25, 3 → ×1.50, 4 → ×1.75, 5+ → ×2.00 (Cap)
```
`perfect = reel.perfect && !sp.junk`.

### 5.3 Coins

```js
const COIN_SCALE = 0.85;   // Ökonomie-Sim-Konstante (tools/econ-sim.js)
const base = Math.max(1, Math.round(sp.value * COIN_SCALE * (0.75 + 0.5 * (kg - sp.kg[0]) / (sp.kg[1] - sp.kg[0]))));
// Gewichtsfaktor: 0.75× bis 1.25× des Basiswerts, linear nach Gewichts-Perzentil
const gained = sp.junk
  ? base
  : Math.round(base * mult * (f.shiny ? 5 : 1) * talentMult("feilsch", 0.05));
coins += gained; save.stats.totalCoins += gained;
```
`talentMult("feilsch", 0.05) = 1 + rank*0.05` (max Rang 5 → ×1.25).

### 5.4 XP

```js
function xpForCatch(sp, perfect, shiny) {
  let xp = XP_BY_RARITY[RARITY[sp.rarity].idx];   // [12, 30, 70, 160, 420]
  if (sp.junk) xp = 5;
  if (perfect) xp = Math.round(xp * 1.25);
  if (shiny) xp *= 3;
  return xp;
}
addXP(Math.round(xpForCatch(sp, perfect, f.shiny) * talentMult("lehre", 0.06)));
```
Levelaufstieg: `xpToNext(level) = Math.round(90 + level*55 + Math.pow(level,1.7)*6)`.
Beim Level-Up: `reward = Math.round(save.level * 25 * tierMult())` Coins,
`tierMult() = 1 + (progressTier()-1)*0.8`, plus 1 Gem alle 5 Level.

### 5.5 Shiny

```js
f.shiny = !species.junk && !species.boss
  && Math.random() < (totemActive("glueck") ? 4 : 1) * talentMult("glueck", 0.25) / 80;
```
Basis-Chance `1/80` (1.25 %). Mit Talent `glueck` Rang 5: `×2.25`. Mit Totem
`glueck` aktiv (5 min): `×4` zusätzlich. Effekt: `×5` Coins, `×3` XP, `+1` Gem,
`catchJingle(4)`, `shake=10`, Hype "SHINY!".

### 5.6 Perfect

`perfect` = Spannung im Drill nie über 75 % (Abschnitt 4.5). Effekt: `×1.5` Coins,
`×1.25` XP (gerundet), Badge "Perfekter Drill ×1.5", `save.stats.perfects++`.

### 5.7 "So knapp!"

Ausgelöst, wenn die Schnur reißt (`tension>=1`) UND `reel.maxProgress >= 0.8` war
(Fisch war zu 80 %+ eingeholt). Zentraler Bildschirmtext "So knapp!" (30px, rot),
Fehlermeldung nennt den erreichten Prozentsatz.

### 5.8 Fisch-im-Fisch (Bonusfang)

```js
const PREDATORS = ["hecht","zander","wels","urhecht","riesenwels","barrakuda","thunfisch","seeteufel","hai","riffhai","muraene","seewolf","rapfen","wolfsbarsch","piranha"];
if (PREDATORS.includes(sp.id) && Math.random() < 0.18) {
  // Beutefisch: gleicher Ort, !junk, !boss, rarityIdx<=1, len < sp.len*0.7
  const pkg = +(p.kg[0] + Math.random() * (p.kg[1]-p.kg[0]) * 0.4).toFixed(2);
  const bonus = Math.max(1, Math.round(p.value * COIN_SCALE * 0.8));
  // + coins, + recordCatch(p), verzögerte Meldung nach 900ms
  unlockAchievement("fischinfisch");
}
```

### 5.9 Möwen-Diebstahl

```js
function maybeSpawnSeagull() {
  if (Math.random() > 0.22) return;   // 22% Chance, aufgerufen 500ms nach !junk-Fang
  // fliegt von links/rechts ein, Attacke dauert dur=3.2s
}
```
Angriffsverlauf (`state:"attack"`): Bahnkurve `k=clamp(t/3.2,0,1); e = k*0.7+k*k*0.3`
(Mischung linear/quadratisch), kreist mit abklingender Amplitude ein. Bei `t>=dur`
und keinem Antippen: klaut die Hälfte des Fangs.
```js
const loss = Math.floor((catchInfo ? catchInfo.coins : 0) / 2);
coins -= loss; catchInfo.coins -= loss; catchInfo.stolen = true; catchInfo.stolenAmount = loss;
```
Antippen während `"attack"` (Trefferradius `55*uiScale()`) verjagt die Möwe:
`state="flee"`, `+10 Coins`, `unlockAchievement("moewe")`.

### 5.10 Streak-Rescue-Angebot

Bei jedem `fishEscapes()` (verlorener Fisch) wird `Ads.offerRescue(streak)` aufgerufen,
BEVOR `streak = 0` gesetzt wird:
```js
offerRescue(streakValue) {
  if (streakValue < this.rescueMinStreak /* = 5 */ || this.current || this.gate) return;
  if (!this.contactAllowed()) return;
  this.rescue = { t: 0, dur: 4.5, streak: streakValue };
}
acceptRescue() {   // Rewarded Ad → stellt die Serie wieder her
  this.reward(() => { streak = r.streak; addFloatingText(`Serie ${r.streak} gerettet! 🔥`, ...); });
}
```
Nur ab Serie ≥ 5, nur wenn keine andere Werbe-Aktion aktiv ist.

---

## 6. Events

### 6.1 Wetter

```js
const weather = { type: "clear", timer: 40, drops: [], gloom: 0 };
```
Zustandswechsel: `clear→rain` nach `rand(70,140)`s (Start-Timer initial `40`),
`rain→clear` nach `rand(30,50)`s. `weatherGloom` (0..1) blendet sanft über
`lerp(gloom, type==="rain"?1:0, min(1,dt*0.45))` — rein visuell (Palette),
beeinflusst NICHT die Tag/Nacht-Uhr.

Regen-Effekte: Blitz `random<dt*0.05` → `weather.flash=1`, verzögerter Donner
(400–1000ms später). Tropfen: `6/Frame`, `v=rand(600,900)`, Querdrift `60*dt`.
Wasserringe: `random<dt*25` pro Frame.

Regen-Gameplay-Effekt: Anlock-Rate `×1.6` (siehe 3.3), Achievement "Regenangler".

### 6.2 Goldene Stunde

```js
function isGoldenHour() { const l = getPalette(dayTime).light; return l > 0.4 && l < 0.85; }
```
Effekt: Anlock-Rate `×1.3`, Seltenheits-Gewicht (`idx>=2`) `×2`.

### 6.3 Tag/Nacht-Zyklus

`DAY_LENGTH = 300`s pro voller Zyklus. `dayTime` (0..1) treibt `getPalette(dayTime)`
über 7 Keyframes (`SKY_KEYS` in `draw.js`):

| t | Himmel oben→unten | `light` |
|---|---|---|
| 0.00 | `#070b1e`→`#141c3a` | 0.12 (Nacht) |
| 0.16 | `#1a2350`→`#d07a6a` | 0.45 (Morgendämmerung) |
| 0.30 | `#4a90d9`→`#bfe3f5` | 1.00 (Tag) |
| 0.66 | `#4a90d9`→`#bfe3f5` | 1.00 (Tag, Plateau) |
| 0.80 | `#3d4f8a`→`#ff9a5c` | 0.70 (Abenddämmerung) |
| 0.90 | `#141a3d`→`#5a3a6a` | 0.28 |
| 1.00 | `#070b1e`→`#141c3a` | 0.12 (Nacht, schließt Kreis) |

`daylight() = getPalette(dayTime).light`. Nacht-Schwelle: `daylight() < 0.45` →
Nachtfische spawnen. Orte können zusätzlich abdunkeln (`loc.dark`, z. B. Tiefsee
`0.6`).

### 6.4 Möwe

Siehe Abschnitt 5.9 (vollständig).

### 6.5 Achievements (33 Einträge, `id — Name — Bedingung`)

| id | Name | Bedingung |
|---|---|---|
| erster | Petri Heil! | `catches >= 1` |
| zehn | Warmgeangelt | `catches >= 10` |
| fuenfzig | Seebär | `catches >= 50` |
| stiefel | Schuhgröße 44 | Stiefel im Dex |
| post | Briefträger | Flaschenpost im Dex |
| schatz | Yo-ho-ho | Schatzkiste im Dex |
| nacht | Nachtangler | Aal oder Mondfisch im Dex |
| legendaer | Legende | Mondfisch im Dex |
| schwer | Schwergewicht | `biggestKg >= 20` |
| sammler | Sammler | ≥6 Arten im Dex |
| komplett | Fischdex komplett | Dex.length >= SPECIES.length |
| serie5 | Heiße Serie | `streak >= 5` |
| perfekt | Wie am Schnürchen | `perfects >= 1` |
| regen | Regenangler | `rainCatches >= 1` |
| moewe | Möwenschreck | (nur programmatisch via `unlockAchievement`) |
| reich | Goldesel | `totalCoins >= 1000` |
| reisender | Reisender | ≥1 Ort freigeschaltet |
| weltenbummler | Weltenbummler | alle Orte bis auf 1 freigeschaltet |
| biologe | Meeresbiologe | ≥50 Arten im Dex |
| hundert | Hundert! | ≥100 Arten im Dex |
| nessie | Sie existiert | Nessie im Dex |
| pinguin | Falscher Kontinent | Pinguin im Dex |
| acht-arme | Acht Arme | Oktopus/Blauring im Dex |
| fischinfisch | Doppelt gefangen | (programmatisch, siehe 5.8) |
| boss | Bosskämpfer | (programmatisch, siehe 8) |
| allebosse | Herr der Gewässer | alle 6 Bosse im Dex |
| level10 | Kein Anfänger mehr | `level >= 10` |
| level25 | Kapitän | `level >= 25` |
| woche | Stammgast | (programmatisch, 7-Tage-Login) |
| dexort | Ortskundig | Dex-Reward-Key endet auf `:100` |
| teiler | Angeberfoto | (programmatisch, Fang geteilt) |
| fleissig | Fleißig | `quests >= 10` erledigt |
| jackpot | Glückspilz | (programmatisch, Wundertüte) |
| zocker | Zocker | `gachas >= 20` |
| shiny | Es glitzert! | `shinies >= 1` |
| shiny10 | Shiny-Jäger | `shinies >= 10` |
| tiefsee | Da unten leuchtet was | Tiefsee-exklusive Art im Dex |

Belohnung pro Achievement: **+1 Gem**, Sound, Toast-Warteschlange (nacheinander
angezeigt, `life=3.2s`).

### 6.6 Toasts

`toasts[]`-Warteschlange, immer nur `toasts[0]` sichtbar, `age` läuft bis `life`.
Fade-in über erste `0.3s`, Fade-out über letzte `0.4s`. Achievement-Toasts sind
antippbar (öffnet `achievements`-Overlay).

---

## 7. Effekte (`effects.js`) — für GPU-Partikel-Portierung

Alle Partikel-Arrays sind global: `particles[]`, `ripples[]`, `floatingTexts[]`,
`bubbles[]`, `clouds[]`, `birds[]`. Physik-Update (`updateWorldFx`/`updateUIFx`) ist
**portabel** (reine Zahlen), nur das Zeichnen ist Canvas-gebunden.

### 7.1 Splash (Tropfen)
```js
spawnSplash(x, y, count=16, color="rgba(220,240,255,0.9)", power=1)
// je Tropfen: vx=rand(-90,90)*power, vy=rand(-260,-90)*power, r=rand(1.5,3.5), life=rand(0.5,0.9)
// Physik: vy += 700*dt (Schwerkraft); stirbt bei age>life ODER beim Auftreffen auf die Wellenlinie
//         (spawnt dabei einen Mini-Ripple: maxR=10, life=0.5)
```

### 7.2 Ripple (Wellenring)
```js
spawnRipple(x, y, maxR=40, count=2)
// je Ring: age=-i*0.18 (gestaffelter Start), life=1.1s, r wächst via easeOut(age/life) von 4 auf maxR*(1+i*0.4)
// gezeichnet als Ellipse (ry = rx*0.35, Wasserperspektive), Alpha = (1-age/life)*0.7
```

### 7.3 Coin-Flug
```js
spawnCoins(x, y, n, targetX, targetY)
// je Münze: age=-i*0.06 (gestaffelt), life=1.1s, Phase 1 (t<0.35): Wurfparabel vy+=500*dt
//           Phase 2 (t>=0.35): easeInOut-Lerp von Absprungpunkt (sx,sy) zu (targetX,targetY)
// bei Ankunft: Sound.coin()
```

### 7.4 Konfetti
```js
spawnConfetti(x, y, n=40)
// Farben: ["#ffd23a","#ff6b6b","#5ad46a","#4fc3f7","#c072ff","#ffffff"]
// vx=rand(-260,260), vy=rand(-420,-120), rot=rand(0,6.28), vr=rand(-8,8), life=rand(1.2,2)
// Physik: vy+=520*dt, vx*=0.99 (Luftwiderstand), rot+=vr*dt
// Form: Rechteck w=rand(4,8) × h=rand(3,5), um Mittelpunkt rotiert
```

### 7.5 Blasen (Wasser-Ambiente)
```js
spawnBubbles(x, y, n=6)
// r=rand(1.5,3.5), vy=rand(-25,-45) (steigt), horizontale Wobble sin(age*5+wob)*12*dt
// stirbt bei Erreichen der Wasserlinie (y < getWave(x))
// Ambient-Spawn: random < dt*0.8 pro Frame, Position zufällig unterhalb horizonY+60
```

### 7.6 Fliegender Text
```js
addFloatingText(text, x, y, color="#ffffff", size=26)
// steigt mit 40*dt px/s, life=1.4s, Alpha = 1 - (age/life)^2 (quadratisches Fade-out)
// Renderer: Font schrumpft automatisch bis min 12px, wenn Text breiter als canvas.width-24;
//           horizontale Position wird geklemmt, damit der Text im Bild bleibt
```

### 7.7 Wolken & Vögel (Deko)
```js
initDecor(): 6 Wolken { x: 0..1 normalisiert, y: rand(0.04,0.22), s: rand(0.6,1.4), v: rand(0.006,0.014) }
             3 Vögel  { x: rand(-0.2,1.2), y: rand(0.06,0.2), v: rand(0.03,0.06), phase, dir: ±1 }
// Wolken: x += v*dt, wrap bei x>1.25 → x=-0.25, neue y
// Vögel: x += v*dir*dt, phase += dt*7 (Flügelschlag), Richtungswechsel an Bildrändern (-0.3/1.3), neue y
```

### 7.8 Screen Shake
Globale Variable `shake`, zerfällt `shake = max(0, shake - dt*20)` pro Frame
(`updateAlways`). Gesetzt von Ereignissen (siehe jeweilige Abschnitte, z. B. Fang:
`shake = 4 + rarityIdx*2`; Schnurriss: `6`; Levelaufstieg: `6`; Boss-Sieg: `12`).
Angewendet als zufällige Translation `±shake` px im Canvas2D-Renderer bzw. als
Shader-Uniform im Hybrid-Renderer.

### 7.9 Hype-Effekte
Siehe Abschnitt 10 — Weißblitz, Strahlenkranz, Zoom, Zeitlupe.

---

## 8. Boss-Kampf (`bossfight.js`)

### 8.1 Prinzip

Eigenes Minispiel statt normaler Drill. Der Boss kündigt ein Manöver an ("Tell"),
der Spieler antwortet mit einer von vier Basis-Eingaben plus ortsspezifischen
Spezialmanövern. Ausdauer (`stamina`) auf 0 = Sieg; Schnur-Leben (`line`) auf 0 =
Fisch entkommt.

### 8.2 Basis-Manöver

| key | Label | Eingabe | Timing |
|---|---|---|---|
| `pull` | ZIEHT! | Finger weg (NICHT tippen/halten) | `rand(1.3,1.9)/speed` |
| `crank` | KURBELN! | schnell antippen (5+ Taps) | `rand(1.9,2.4)` |
| `jump` | SPRUNG! | einmal tippen im Ring-Fenster | `1.35/speed` |
| `dive` | ER TAUCHT! | gedrückt halten bis Balken voll | `rand(1.3,1.8)` |

### 8.3 Spezialmanöver (je Boss genau eins)

| key | Boss | Label | Eingabe |
|---|---|---|---|
| `mud` | Der alte Karl | SCHLAMM! | warten, NICHT antippen/halten |
| `side` | Nessie | SIE TAUCHT WEG! | auf die Blasenseite tippen (Richtungs-Tap!) |
| `grab` | Der Kraken | TENTAKEL! | alle 4 Tentakel einzeln wegtippen |
| `ram` | Megalodon | ER RAMMT! | rechtzeitig loslassen (NICHT halten bei Aufprall) |
| `lights` | Leviathan | LICHTMUSTER | 3er-Sequenz nachtippen (Zonen 0–2) |
| `freeze` | Der Eiskönig | SCHNUR FRIERT! | freihämmern (wiederholt tippen) |

### 8.4 Boss-Profile

```js
const BOSS_PROFILE = {
  alterkarl: { moves: ["pull","crank","dive"],         special: "mud",    every: 3, speed: 0.95 },
  nessie:    { moves: ["pull","jump","dive"],          special: "side",   every: 3, speed: 1.05 },
  kraken:    { moves: ["pull","crank","dive"],         special: "grab",   every: 2, speed: 1.0  },
  megalodon: { moves: ["crank","jump","pull"],         special: "ram",    every: 3, speed: 1.15 },
  leviathan: { moves: ["dive","pull","crank"],         special: "lights", every: 3, speed: 0.9  },
  eiskoenig: { moves: ["pull","crank","jump","dive"],  special: "freeze", every: 3, speed: 1.1  }
};
```
`every`: alle N Manöver kommt garantiert das Spezialmanöver (statt Zufallsauswahl
aus `moves`, nie zweimal derselbe Move hintereinander).

### 8.5 Phasen & Tell-Timing

```js
function bossPhase(f) { return f.stamina > 0.66 ? 1 : f.stamina > 0.33 ? 2 : 3; }
const speed = (phase===1?1 : phase===2?1.15 : phase===3?1.35) * prof.speed;
f.move.tell = (phase===3 ? 0.5 : phase===2 ? 0.62 : 0.8);   // Vorwarnzeit sinkt mit Phase
```
Phasenwechsel löst Ansage aus ("Er wird wütend!"/"Letzte Kraft!"), `shake=8`.

### 8.6 Initialisierung (`startBossFight`)

```js
const rodF = clamp((rod.zone-0.26)/0.22, 0, 1);
const maxLine = 4 + (rodF>0.5?1:0) + (talentRank("hand")>=4?1:0);   // 4-6 Schnur-Segmente
bossFight = { fish, sp, stamina: 1, line: maxLine, maxLine, phase: 1, ..., state: "intro", t: 0, stateT: 0 };
gameState = "bossfight";
```
`state`-Zyklus je Manöver: `intro`(1×, 1.1s) → `tell`(Vorwarnung) → `act`(Eingabe
zählt) → `rest`(0.35–0.55s Pause) → nächstes `nextBoxMove`.

### 8.7 Schadensfunktionen

```js
function bossDamage(f, amount, text, color) { f.stamina = clamp(f.stamina - amount, 0, 1); ... }
function bossLineDamage(f, amount, text)    { f.line = Math.max(0, f.line - amount); f.flawless = false; ... }
```

**Schadenswerte je Manöver (Erfolg → `bossDamage`, Fehler → `bossLineDamage(1)`,
außer wo vermerkt):**

| Manöver | Erfolg-Schaden | Bedingung | Fehler |
|---|---|---|---|
| `pull` | `0.05` | Nicht getippt bis `dur` um | Tippen während `pull` |
| `crank` | 0 (kein Extra-Schaden) | `cranks>=5` erreicht | `cranks<5`: `stamina += 0.03` (Regeneration!) |
| `jump` | `0.17*talentMult("arme",0.06)` perfekt (`ring>=0.92`), sonst `0.11` | Tap bei `ring>=0.8` | zu früh (`ring<0.8`) oder verpasst (`ring>=1`) |
| `dive` | `0.12*talentMult("arme",0.06)` | `holdFill>=1` | nicht bis `dur+1.4s` gehalten: `stamina += 0.05` |
| `mud` | `0.07` | nichts getan bis `dur` | Tippen/Halten während Manöver |
| `side` | `0.13*talentMult("auge",0.05)` | richtige Seite getippt | falsche Seite ODER nichts getan |
| `grab` | `0.14*talentMult("arme",0.06)` | alle 4 Arme weggetippt | `bossLineDamage(min(2,verbleibend))` |
| `ram` | `0.15*talentMult("hand",0.05)` | NICHT gehalten bei `p>=0.72` | gehalten bei `p>=0.72` |
| `lights` | `0.16*talentMult("lehre",0.05)` | Sequenz korrekt nachgetippt | falsches Feld oder zu langsam |
| `freeze` | `0.11*talentMult("hand",0.06)` | `thaw>=1` erreicht (9 Taps à `+0.09`, Zerfall `-0.45/s`) | nicht geschafft bis `dur` |

`f.flawless` (für `winBossFight`) wird `false` bei JEDER `bossLineDamage`-Anwendung
oder verpasstem `crank`/`dive`-Fenster.

### 8.8 Sieg/Niederlage

```js
function winBossFight() { reel = { perfect: f.flawless }; catchFish(); }   // nutzt catchFish() normal!
function loseBossFight() {
  const left = Math.round((1 - f.stamina) * 100);
  f.fish.x=f.x; f.fish.y=f.y; fishes.push(f.fish);   // Fisch zurück in den Schwarm
  fishEscapes(left>=70 ? `Schnur gerissen – er war bei ${left} %!` : "Er war zu stark. Nächstes Mal.");
}
```
Boss-Fang läuft danach durch die NORMALE `catchFish()`-Berechnung (Abschnitt 5),
inkl. `startHype("boss",...)` und `onBossCaught(sp)`.

### 8.9 `onBossCaught` — Ortsfreischaltung

```js
function onBossCaught(sp) {
  const next = LOCATIONS[locIdx+1];
  addGems(5, "Boss besiegt");
  if (next && !isLocationOwned(next)) save.owned.locations.push(next.id);   // GRATIS freigeschaltet
  unlockAchievement("boss");
}
```

### 8.10 Boss-Liste pro Ort

| Ort (`LOCATIONS.id`) | Boss (`SPECIES.id`) | Name | Wert |
|---|---|---|---|
| `see` | `alterkarl` | Der alte Karl | 3000 |
| `boot` | `nessie` | Nessie | 5000 |
| `kueste` | `kraken` | Der Kraken | 8000 |
| `riff` | `megalodon` | Megalodon | 12000 |
| `tiefsee` | `leviathan` | Leviathan | 20000 |
| `arktis` | `eiskoenig` | Der Eiskönig | 30000 |

Boss-Freischaltung: `bossUnlocked(locId)` = alle Nicht-Boss-Arten des Orts im Dex.
Spawn-Chance dann `50%` pro Fisch-Nachspawn-Zyklus (`pickSpecies`), max. 1 Boss
gleichzeitig im Wasser.

### 8.11 Cutscene-Trigger

`bossArrives(f)` (in `fish.js`, beim Spawn eines Boss-Fisches) ruft
`startCutscene(f.species)`. `CUTSCENE_DUR=4.2`s, läuft WÄHREND die Welt weiterläuft
(einzige Ausnahme von `worldPaused()`). Jeder Boss hat eine eigene visuelle
Inszenierung (Riesenwelle, Tentakel, Rückenflosse, Leuchten aus der Tiefe,
Eisrisse) — rein renderer-seitig, siehe `cutscene.js`. Nach der Cutscene erscheint
ein Toast: "⚠️ [Bossname] — Der Boss ist da – Köder in seine Nähe werfen!".

---

## 9. Tauchmodus (`dive.js`)

### 9.1 Prinzip

Statt Auswerfen+Warten wird gezielt: Tap auf einen Fisch = Harpune fliegt dorthin.
Bei Treffer geht es NAHTLOS in den normalen Drill über (die Harpunenleine wird zur
Angelschnur) — Rute/Talente bleiben wirksam.

**Es gibt KEINEN Sauerstoff-/Zeitlimit-Mechanismus.** Die Sauerstoffflasche ist rein
kosmetisch (Rückenteil des Tauchers), Atemblasen sind reine Ambient-Partikel ohne
Gameplay-Wirkung.

### 9.2 Aufladen & Zielen

```js
function startCharge(tx, ty) {   // pointerdown im Wasser
  if (gameState !== "ready" || harpoon) return;
  harpoonCharge = { t: 0, x: tx, y: ty };
}
function aimCharge(tx, ty) { harpoonCharge.x = tx; harpoonCharge.y = ty; }   // pointermove: nachzielen erlaubt
function releaseCharge() {   // pointerup
  const c = harpoonCharge; harpoonCharge = null;
  shootHarpoon(c.x, c.y, clamp(c.t / 0.85, 0.25, 1));   // Ladezeit 0.85s bis volle Kraft, min 25%
}
```
Bei Ladung `>0.85s`: spawnt Blasen an der Taucherhand (`random<dt*8`).

### 9.3 Reichweite

```js
function harpoonRange(charge) {
  const reach = Math.hypot(canvas.width, bottomBarY() - horizonY);
  return reach * (0.55 + rod.radius * 0.5) * (0.6 + 0.4 * clamp(charge, 0, 1));
}
```
Bessere Rute (`rod.radius`) = mehr Reichweite. Volle Ladung (`charge=1`) = `1.0×`
Reichweitenfaktor, minimale Ladung (`charge=0.25`) = `0.7×`.

### 9.4 Schuss & Flug

```js
function shootHarpoon(tx, ty, charge=1) {
  const dx=tx-hx, dy=ty-hy; normalisieren;
  harpoon = { dx, dy, dist: 0, max: harpoonRange(charge), charge, state: "fly", x: hx, y: hy, angle, t: 0 };
  gameState = "shooting";
  save.stats.shots++;
}
function updateHarpoon(dt) {
  const speed = Math.max(canvas.width, canvas.height) * (0.85 + 0.95 * charge);
  h.dist += speed * dt; h.x = hx + dx*h.dist; h.y = hy + dy*h.dist;
  // Treffertest: erster Fisch auf der Bahn (nicht fleeing/caught)
  for (const f of fishes) if (hypot(f.x-h.x, f.y-h.y) < fishUnit(f)*0.55 + 6) { harpoonHit(f); return; }
  if (h.dist >= h.max || h.y > canvas.height || h.y < horizonY) h.state = "back";   // Fehlschuss
  // Rückzug: h.dist -= speed*1.6*dt; bei dist<=0 → harpoon=null, gameState="ready"
}
```

### 9.5 Treffer

```js
function harpoonHit(f) {
  bobberX = f.x; bobberY = getWave(bobberX); hookX = f.x; hookY = f.y;
  bitingFish = f; gameState = "biting"; biteTimer = 99;   // praktisch unbegrenzt
  harpoon = null;
  startReeling();   // sofort in den Drill (oder Boss-Fight, wenn sp.boss)
}
```

### 9.6 Zielhilfe (Render, aber Zahlen wichtig)

Beim Spannen: Ziellinie + Kraftbalken (`c=clamp(t/0.85,0.25,1)`), Zielkreis mit
Radius `harpoonRange(c)`. Ohne Ladung, in Ruhe: gestrichelter Reichweitenkreis nur
solange `save.stats.shots <= 6` sichtbar (Einstiegshilfe).

---

## 10. Hype (`hype.js`)

Kurze Inszenierung für seltene Fänge (Shiny, Rekord, Legendär, Boss): Zeitlupe +
Zoom + Blitz + Strahlenkranz + Schriftzug.

```js
const HYPE_KINDS = {
  shiny:  { label: "SHINY!",       color: "#fff3a0", dur: 2.0, zoom: 1.55 },
  record: { label: "NEUER REKORD", color: "#ffd23a", dur: 1.6, zoom: 1.35 },
  legend: { label: "LEGENDÄR",     color: "#c792ff", dur: 1.7, zoom: 1.4 },
  boss:   { label: "BESIEGT!",     color: "#ff8a4d", dur: 2.1, zoom: 1.3 }
};
```
Priorität: ein laufender Hype wird nur von einem mit **längerer** `dur` überschrieben.
Auswahl-Reihenfolge beim Fang: shiny > boss > legend (`rarityIdx>=3`) > record
(`isRecord && !isNew && kg>0`).

**Zeitlupe** (`updateHype`, gibt den `dt`-Multiplikator für den GESAMTEN Frame
zurück, angewendet in `gameLoop`):
```js
const p = hype.t / hype.dur;
if (p < 0.55) return 0.3;                          // 30% Spielgeschwindigkeit
return 0.3 + (p - 0.55) / 0.45 * 0.7;               // beschleunigt zurück auf 100%
```

**Zoom** (`hypeZoom`, Kamera-Transform um `(hype.x, hype.y)`):
```js
const e = p<0.25 ? easeOut(p/0.25) : p>0.7 ? 1-easeOut((p-0.7)/0.3) : 1;   // ein/halten/aus
return { k: 1 + (kindZoom-1)*e, x: hype.x, y: hype.y };
```

**Visuals** (`drawHype`): Weißblitz `hype.flash` zerfällt `-realDt*3.5`/s, initial `1`.
Strahlenkranz: 14 Strahlen, rotierend `hype.t*0.6` rad/s, Länge `(110+(i%3)*45)*s`,
Alpha-Fenster `1-|p-0.35|/0.5` (Peak bei 35% der Dauer). Schriftzug: fährt hoch,
skaliert `0.6+easeOut(tp)*0.55`, Farbverlauf weiß→Kindfarbe→abgedunkelt.

Auslösung: `shake = max(shake,8)`, `haptic([30,40,60,40,90])`.

---

## 11. Layout-Konstanten

### 11.1 Grundmaße (`resizeCanvas`, pro Frame stabil bis Resize)

```js
horizonY = canvas.height * (mode === "dive" ? 0.05 : 0.35);
dockHeight = Math.max(14, canvas.height * 0.03);
```

| Modus | dockWidth | dockX | dockY | rodBaseX |
|---|---|---|---|---|
| `boat` | `max(120, W*0.22)` | `boatX - dockWidth/2` | `boatY - dockHeight*1.25` | `boatX - dockWidth*0.22` |
| `ice` | `W*0.42` | `W - dockWidth` | `horizonY - dockHeight*0.9` | `dockX + dockWidth*0.2` |
| `dive` | `W*0.22` | `W*0.60` | `horizonY + (H-horizonY)*0.16` | `dockX` |
| `dock`/`pier` (default) | `W*0.3` | `W - dockWidth` | `horizonY - dockHeight - H*0.025` | `dockX + dockWidth*0.2` |

`boatX = W*0.72`, `boatY = horizonY` (schaukelt später mit `getWave`).

Rutenspitze:
```js
rodBaseY = dockY;
rodTipX = rodBaseX - W*0.15;
rodTipY = rodBaseY - H*0.12;
// Tiefsee-Ausnahme (Taucher hält die Harpune waagerecht):
if (mode==="dive") { rodTipX = rodBaseX - W*0.13; rodTipY = rodBaseY + H*0.005; }
```

### 11.2 Wasserlinie & Wellen

`getWave(x, phase=0)`: siehe Abschnitt 2.4. `waveHeight=10px`, `waveLength=25px`,
Sekundärwelle Amplitude `4px`, Wellenlänge `90px`.

### 11.3 Fisch-Tiefenbänder

```js
function depthToY(d) {   // d = 0..1, aus SPECIES[i].depth = [d0,d1]
  const top = horizonY + canvas.height * 0.07;
  const bottom = isNarrow() ? bottomBarY() - 60 : canvas.height * 0.94;
  return lerp(top, bottom, d);
}
function seaFloorY() { return isNarrow() ? bottomBarY() - 58 : canvas.height - 10; }
```
Jede Art hat `depth: [d0, d1]` (0 = Oberfläche, 1 = Grund), z. B. Rotauge `[0.05,
0.5]`, Wels `[0.7, 1.0]`, Goldfisch `[0.02, 0.35]`.

### 11.4 HUD-Zonen

```js
function hudTop() { return 16 + safeTop; }                              // oberer Rand unter Safe-Area
const HUD_CARD_H = 64;                                                  // Level-Chip + XP-Streifen Höhe
function bottomBarY() { return canvas.height - safeBottom - 12 - 44; }  // untere HUD-Leiste (mobil)
const GEAR_CHIP_W = () => isNarrow() ? 122 : 140;                       // Breite Ausrüstungs-Chip
```
`safeTop`/`safeBottom` aus CSS-Variablen `--sat`/`--sab` (iOS Safe Area) + native
Werbebanner-Reserve (`Ads.bannerReserve()`).

### 11.5 Skalierung

```js
function isNarrow() { return canvas.width < 700; }
function uiScale() { return isNarrow() ? 1.0 : clamp(Math.min(canvas.width/1100, canvas.height/650), 0.85, 1.3); }
```
Mobile-first: feste Größe `1.0` unter 700px Breite. Desktop skaliert `0.85`–`1.3`×
mit der Fenstergröße (Referenz `1100×650`).

DPR: `min(devicePixelRatio, width<700 ? 3 : 2)`, ggf. von `World.uiDpr()` auf `2×`
gedeckelt bei niedriger Performance-Stufe.

### 11.6 Parallax-Ebenen

```js
const PARA_SKY = 0.75, PARA_FAR = 0.45, PARA_NEAR = 0.16;
```
Relative Kamerabewegung je Ebene (Himmel bewegt sich am stärksten mit, nahe
Unterwasserstruktur am wenigsten — 2.5D-Tiefenwirkung via `withParallax(k, fn)`).

### 11.7 Cast-Button

```js
castButtonWidth = min(W*0.4, 320); castButtonHeight = max(44, H*0.06);
castButtonX = (W - castButtonWidth)/2;
castButtonY = min(H*0.85, H - castButtonHeight - 40 - safeBottom);
```

---

## 12. Externe Globals/Funktionen — Herkunft (eine Zeile je Symbol)

**shop.js:**
- `RODS[]` — 8 Ruten (`id,radius,zone,price,...`), Holz→Kumpel-Rute.
- `BAITS[]` — 6 Köder (`rareMult, rate, price`).
- `getRod()` / `getBait()` / `getBobber()` / `getRodSkin()` — aktuell ausgerüstetes Gear inkl. Upgrade-Boni.
- `rodUpgradeLevel(id)` / `rodUpgradeCost(rod)` / `ROD_MAX_UPGRADE=10` — Ruten-Grind.
- `recordCatch(species, kg, shiny)` — schreibt in `save.dex`, liefert `{isNew,isRecord}`.
- `loadSave()` / `saveGame()` — Persistenz (`localStorage`, `SAVE_KEY`).
- `dexDiscovered()` — Anzahl entdeckter Arten.

**fish.js:**
- `SPECIES[]` — alle Fischarten (`id,rarity,value,kg[],depth[],fight,speed,len,h,pattern,night?,junk?,boss?,loc[]`).
- `RARITY{}` — 5 Seltenheitsstufen (`idx,weight,color`).
- `pickSpecies()` — gewichtete Zufallsauswahl (Abschnitt 3.1).
- `createFish(species, fromEdge)` / `fishUnit(f)` / `targetFishCount()` / `spawnInitialFish()`.
- `updateFishes(dt)` — Attraktions-/Beiss-Logik (Abschnitt 3).
- `daylight()` / `depthToY(d)` / `isGlowing(sp)` / `uiScale()`.
- `BOTTLE_MESSAGES[]` — Flaschenpost-Texte.

**locations.js:**
- `LOCATIONS[]` — 6 Orte (`id,mode,price,level,water[],dark`).
- `getLocation()` / `isLocationOwned(loc)` / `selectLocation(loc)` / `enterLocation(loc)`.
- `bossFor(locId)` / `bossUnlocked(locId)` / `onBossCaught(sp)`.
- `speciesForLocation(locId)` / `iceHoleX()` / `iceHoleRX()`.

**talents.js:**
- `TALENTS[]` — 7 Talente × 5 Ränge.
- `talentRank(id)` / `talentMult(id, per)` / `skillPoints()` / `learnTalent(t)`.

**progress.js:**
- `getLevel()` / `getXP()` / `xpToNext(level)` / `addXP(amount,x,y)` / `xpForCatch(sp,perfect,shiny)`.
- `XP_BY_RARITY[]` / `LEVEL_COIN_F=25` / `tierMult()` / `progressTier()` / `anglerTitle()`.
- `checkDexRewards()` / `dailyClaimable()`.

**gems.js / inventory.js:**
- `TOTEMS[]` — 6 Totems (`dur, price/gems, tint, ico`).
- `addGems(n)` / `spendGems(n)` / `getGems()` / `buyTotem(t)` / `useTotem(t)` / `totemActive(id)` / `totemRemaining(id)` / `updateTotems(dt)`.
- `invAdd/invTake/invTotal(kind,id,n)` / `runningTotems()` / `totemTimeLabel(sec)`.

**quests.js:** `questEvent(payload)` — meldet Catch/Seagull-Events an das Auftragssystem.

**draw.js:** `getPalette(dayTime)` / `SKY_KEYS[]` / `updateCelestials()` / `hudTop()` /
`HUD_CARD_H` / `bottomBarY()` / `GEAR_CHIP_W()` / `hexToRgb()` / `lerpColor()` /
`shadeColor()` / `fitText()` / `wrapText()` / `uiButton()` / `hitButtons[]` /
`isPointInRect()` / alle `drawXxx()`-Render-Funktionen.

**backdrop.js:** `seaFloorY()` / `isDeepSea()` / `drawBackdropFar/Near()`.

**world.js:** `World` (Phaser/WebGL-Hybrid-Layer: `active,zeigen,begin,commit,faellig,
resize,uiDpr,load`), `PARA_SKY/FAR/NEAR`, `withParallax(k,fn)`, `updateCamera(dt)`.

**cutscene.js:** `cutscene` (Var), `startCutscene(sp)` / `updateCutscene(dt)` /
`drawCutscene()` / `CUTSCENE_DUR=4.2`.

**story.js:** `storyActive()` / `drawStory()` / `updateStory(dt)` / `storyTap()` /
`storyLocationId()`.

**intro.js:** `Intro` (Objekt: `active, skip(), draw(), update(dt)`).

**aquarium.js:** `hubScreen` (Var) / `drawHub()` / `openHub()` / `closeHub()` /
`drawHubVeil()` / `updateHubVeil(dt)` / `locBandHit/Down/Move/Up()` /
`updateTankFish(dt)` / `updateAquarium()`.

**ads.js:** `Ads` (Objekt: `current, gate, bannerReserve(), offerRescue(streak),
acceptRescue(), afterCatch, beforeTrip, draw(), update(dt), rescueMinStreak=5`).

**audio.js / music.js:** `Sound` (`ensure,click,whoosh,plop,bite,fail,snap,reelClick,
tone,catchJingle,splash,buy,coin,tick,noise,muted`), `Music` (`start,enabled,update,
mood,filter,ctx,started`).

**i18n.js:** `I18N` (`init,translate,num,set,lang`).

**perf.js / bench.js:** `Perf` (`beginFrame,endFrame,add,stoer,draw,hud`), `Bench`
(`an,klick,tick,draw`), `Dev` (`an,merke`).

**glass.js / wood.js:** `Glass` (`panel,takeSnapshot,snap,clear,watchPerformance`),
`Wood` (`panel,inset,paper,INK`).

**gacha.js / online.js:** `gacha` (Var) / `drawGacha()` / `updateGacha(dt)`;
`Online.addScore(n)`.

**Globale Spielzustände (`script.js`, zentral):** `save` (persistentes Save-Objekt:
`stats{},dex{},achievements[],talents{},rodUpgrades{},equipped{},gems,level,xp,
owned{locations[]},location,onboardRare,seenSonar,seenAch{},dexRewards{}`), `coins`,
`displayCoins`, `gameState`, `overlay`, `hitButtons[]`, `shake`, `time`, `uiTime`,
`dayTime`.

---

## 13. Portable Logik vs. Renderer-gebunden

### 13.1 Portabel (Zahlenlogik, 1:1 übernehmbar, unabhängig vom Renderer)

- **Komplette Haupt-State-Machine** (Abschnitt 1.3) inkl. aller Übergangsbedingungen.
- **Cast-Parabel & Wellenfunktion** (`getWave`, `castTo`/`landBobber`-Mathematik).
- **Attraktions-/Beiss-Logik** (`pickSpecies`, `updateFishes`-Bissrate, alle
  Multiplikatoren aus Abschnitt 3.6).
- **Drill-Formeln** (`startReeling`, `updateReel`, `reelTap` — Abschnitt 4, komplett).
- **Fang-Ökonomie** (Gewicht, Coins, XP, Streak, Shiny, Perfect, Fisch-im-Fisch,
  Möwen-Diebstahl-Berechnung — Abschnitt 5).
- **Boss-Fight-State-Machine & Schadensformeln** (Abschnitt 8, ohne die
  `drawBossFight`-Visualisierung).
- **Harpunen-Physik & Treffertest** (Abschnitt 9, ohne `drawDiver`/`drawHarpoon`).
- **Wetter-/Tageszeit-Timer, goldene Stunde, Totem-Timer, Talent-/Rutentabellen.**
- **Achievement-Bedingungen, XP/Level-Formeln, Ökonomie-Konstanten** (`COIN_SCALE`,
  `LEVEL_COIN_F` etc.).
- **Save-Datenmodell und Persistenz-Schema** (`save.*`-Struktur).
- **Partikel-Physik-Integratoren** (`updateWorldFx`/`updateUIFx` — Positions-/
  Geschwindigkeits-Integration; NICHT das `ctx.*`-Zeichnen selbst).
- **Hype-Zeitlupen-/Zoom-Kurven** (Zahlenformeln in Abschnitt 10, ohne die
  Canvas-Strahlenkranz-Zeichnung).

### 13.2 Renderer-gebunden (Canvas2D-spezifisch, muss für Phaser/GPU neu gebaut werden)

- Alle `drawXxx()`-Funktionen (`drawWorldScene`, `drawBossFight`-Visuals,
  `drawReelMinigame`-UI, `drawBiteAlert`, `drawHype`-Strahlenkranz/Blitz,
  `drawSeagull`, `drawDiver`, `drawHarpoon`, `drawFishShape`, gesamtes `draw.js`).
- **Partikel-Darstellung** selbst (`ctx.arc`/`fillRect`-Aufrufe in
  `drawWorldEffects`/`drawUIEffects`/`drawBubbles`) — die zugrundeliegende Physik
  ist portabel (13.1), nur das Rendering nicht. Für GPU-Partikel: Positions-/
  Lebenszeit-Daten aus den bestehenden Spawn-Funktionen übernehmen, Darstellung neu
  in Shader/Partikelsystem des Zielrenderers bauen.
- **`World`-Hybrid-Layer** (Phaser-WebGL-Ebene über Canvas2D, `world.js`/
  `world-frag.js`-Shader) — komplett Canvas2D-Ära-spezifisch, entfällt beim
  Phaser-4-Rebuild vollständig (Phaser übernimmt diese Rolle nativ).
- **Layout-Berechnung selbst** (`resizeCanvas`) ist an `ctx`/`canvas.width/height`
  gebunden — die **Verhältniswerte** (0.35, 0.22 etc.) sind jedoch als
  Design-Vorgaben portabel und sollten im neuen Renderer als Prozent-Layout
  reproduziert werden (Abschnitt 11).
- **UI-Trefferflächen** (`hitButtons[]`, `isPointInRect`) — das Konzept
  (Klick-Rechtecke mit Callback) ist portabel, die Implementierung
  Canvas-spezifisch; Phaser hat eigene Input-/Hit-Test-Systeme.
- **Sound-Synthese** (`Sound.tone()` — Web-Audio-Oszillatoren) — plattformspezifisch,
  ggf. durch Sample-basiertes Audio im neuen Renderer ersetzen.
- **Haptik** (`navigator.vibrate`) — Web-API, auf Mobile-Wrapper (Capacitor) ggf.
  durch natives Haptik-Plugin ersetzen.
- **Cutscene-Visuals** (`drawCutscene` pro Boss) — die Trigger-Logik (Abschnitt 8.11)
  ist portabel, die konkrete Bildsprache (Welle, Tentakel, Flosse, Leuchten, Risse)
  ist Canvas2D-Zeichencode und muss neu interpretiert werden.
