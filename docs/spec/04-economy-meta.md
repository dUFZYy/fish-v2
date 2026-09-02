# 04 — Economy & Meta Systems

Source: old game folder `C:\Users\duf73\Desktop\claude projekte\fishing-game` (read-only,
nothing modified). Files read in full: `shop.js`, `inventory.js`, `gems.js`, `gacha.js`,
`progress.js`, `quests.js`, `pass.js`, `talents.js`, `ads.js`, `share.js`, `online.js`,
`native.js`, `tools/econ-sim.js`, plus `docs/WIRTSCHAFT.md` and `docs/WERBUNG-FAIR.md`
(design rationale), and supporting reads of `locations.js`, `fish.js`, `aquarium.js`,
`events.js`, `script.js`, `perf.js` for cross-references (talent hooks, dev cheats, boss
rewards, coin formula). This document is written for a REBUILD — all numeric constants are
copied verbatim from source so the new game can reproduce the balance exactly, or deviate
deliberately.

All source is German; item names/descriptions are kept verbatim (untranslated) since they
are player-facing content to port as-is (an English variant exists in `i18n.js`/`trivia_en.js`
for some strings, noted where relevant).

---

## 1. Item catalogs & currencies

Two currencies:

- **Coins** (`coins`, mirrored into `save.coins` on save) — soft currency, earned by fishing,
  spent on gear, upgrades, locations, gacha, totems, tank slots/decor.
- **Gems** (`save.gems`, accessed via `getGems()`/`addGems()`/`spendGems()`) — hard/premium
  currency. Sources and sinks are enumerated in full in §5.

### Rods — `RODS` (`shop.js`)

`radius` = lock-on radius as a fraction of screen width, `zone` = drill "zone" size,
`shaft`/`grip`/`accent` = shop preview colors, `glow` = optional glow color.

```js
const RODS = [
  { id: "holz",     name: "Holzrute",         price: 0,    radius: 0.14, zone: 0.26, shaft: "#a9753f", grip: "#6b4423", accent: "#d9a441", desc: "Omas alte Rute. Tut's noch." },
  { id: "bambus",   name: "Bambusrute",       price: 150,  radius: 0.17, zone: 0.28, shaft: "#d8c56a", grip: "#8a6b2f", accent: "#a8c93a", desc: "Leicht, biegsam, riecht nach Urlaub." },
  { id: "carbon",   name: "Carbonrute",       price: 400,  radius: 0.20, zone: 0.30, shaft: "#3a3f47", grip: "#1c1f24", accent: "#5ac8fa", desc: "Lockt Fische aus größerer Entfernung." },
  { id: "teleskop", name: "Teleskoprute",     price: 1000, radius: 0.24, zone: 0.32, shaft: "#b9c2cc", grip: "#5a6470", accent: "#e0e6ec", segments: true, desc: "Passt in jeden Rucksack, reicht bis zur Mitte." },
  { id: "profi",    name: "Profirute",        price: 2200, radius: 0.28, zone: 0.35, shaft: "#26426b", grip: "#14243c", accent: "#ff9f43", desc: "Große Reichweite, ruhiges Drillen." },
  { id: "titan",    name: "Titanrute",        price: 5000, radius: 0.33, zone: 0.38, shaft: "#8e9aa6", grip: "#3d4750", accent: "#4fd6d2", desc: "Federt jeden Ruck weg." },
  { id: "poseidon", name: "Poseidons Rute",   price: 11000, radius: 0.40, zone: 0.42, shaft: "#1f8a8a", grip: "#0f4f52", accent: "#ffd66b", glow: "#37e0d8", desc: "Der halbe See hört auf dich." },
  { id: "kumpel",   name: "Das erste Projekt",price: 24000, radius: 0.50, zone: 0.48, shaft: "#7b5cff", grip: "#2e1c66", accent: "#ff6ec7", glow: "#b18cff", desc: "Ein Lernprojekt. Jetzt legendär." }
];
```

These are the **post-#84-rebalance** prices (see §11 note on `docs/WIRTSCHAFT.md`); the
doc records the pre-rebalance prices too (60/150/300/500/900/1500/3000) purely as history —
**use the table above**, it is what ships in the code today.

**Rod upgrades** (coin sink, `shop.js`): each rod can be upgraded up to `ROD_MAX_UPGRADE = 10`
times. `rodUpgradeLevel(id) = save.rodUpgrades[id] || 0`. Cost:
`rodUpgradeCost(rod) = round(60 * (n+1)^1.6 * tier)` where `n` = current upgrade level and
`tier` = 1-based index of the rod in `RODS` + 1. Effect per level: `+3% radius`,
`+0.01 zone` (additive). `getRod()` returns the equipped rod with upgrades applied:
`radius *= (1 + 0.03*n)`, `zone += 0.01*n`.

### Baits — `BAITS` (`shop.js`)

`rareMult` scales rare+ species weight in the catch roll (see §13 `pickSpecies`), `rate`
scales bite/attraction rate.

```js
const BAITS = [
  { id: "wurm",    name: "Regenwurm",     price: 0,   rareMult: 1,   rate: 1,   icon: "🪱", desc: "Der Klassiker. Fängt, was halt kommt." },
  { id: "brot",    name: "Brotkugel",     price: 40,  rareMult: 1.2, rate: 1.4, icon: "🍞", desc: "Die Kleinen sind sofort da." },
  { id: "mais",    name: "Mais",          price: 80,  rareMult: 1.6, rate: 1.3, icon: "🌽", desc: "Beißt schneller, etwas mehr Seltenes." },
  { id: "koeder",  name: "Köderfisch",    price: 300, rareMult: 2.6, rate: 1.5, icon: "🐟", desc: "Raubfische lieben ihn." },
  { id: "shrimp",  name: "Garnele",       price: 550, rareMult: 3.4, rate: 1.6, icon: "🦐", desc: "Delikatesse für Zander und Lachs." },
  { id: "glitzer", name: "Glitzerköder",  price: 900, rareMult: 4.5, rate: 1.8, icon: "✨", desc: "Legendäre Fische werden neugierig." }
];
```

### Bobber skins — `BOBBERS` (`shop.js`)

`shape`, `duck`, `rainbow` are draw-mode flags for the renderer (icons.js-adjacent); no
gameplay effect, cosmetic only. `gemPrice` marks gem-currency items (price is 0 in that case).

```js
const BOBBERS = [
  { id: "classic",  name: "Klassiker",     price: 0,    main: "#e63946", top: "#ffffff", desc: "Rot-weiß, wie es sich gehört." },
  { id: "neon",     name: "Neon",          price: 60,   main: "#39ff14", top: "#111111", desc: "Sieht man auch nachts." },
  { id: "herz",     name: "Herz",          price: 120,  shape: "heart",  desc: "Für die Fische, die man liebt." },
  { id: "erdbeere", name: "Erdbeere",      price: 180,  shape: "strawberry", desc: "Süß. Fische stehen nicht drauf, sieht aber gut aus." },
  { id: "gold",     name: "Goldpose",      price: 250,  main: "#ffd700", top: "#fff4c2", desc: "Reines Show-Off." },
  { id: "fussball", name: "Fußball",       price: 300,  shape: "ball",   desc: "Abseits gibt's hier nicht." },
  { id: "ente",     name: "Quietscheente", price: 400,  duck: true,      desc: "Quak." },
  { id: "schaedel", name: "Totenkopf",     price: 500,  shape: "skull",  desc: "Die Fische werden nervös." },
  { id: "rainbow",  name: "Regenbogen",    price: 600,  rainbow: true,   desc: "Wechselt permanent die Farbe." },
  { id: "disco",    name: "Discokugel",    price: 800,  shape: "disco",  desc: "Saturday Night Fishing." },
  { id: "diamant",  name: "Diamantpose",   price: 0, gemPrice: 20, main: "#7fd8ff", top: "#ffffff", desc: "Funkelt wie dein Kontostand. Hoffentlich." },
  // Pass-exclusive, appended by pass.js — see §6:
  // { id: "sonnenblume", name: "Sonnenblume", price: -1, unlock: "Angel-Pass Premium Stufe 20", main: "#ffd23a", top: "#6b4a2b" }
];
```

### Rod skins — `RODSKINS` (`shop.js`)

Includes a CS:GO-parody "knife skin" easter-egg line (`fx` field drives a special shader/paint
effect in the renderer — tiger/web/gamma/fade/case/marble/slaughter).

```js
const RODSKINS = [
  { id: "holz",     name: "Holz",          price: 0,    color: "#4a3018", accent: "#7a5a38", desc: "Natur pur." },
  { id: "bambus",   name: "Bambus",        price: 80,   color: "#c2b280", accent: "#7a6a3a", desc: "Knoten inklusive." },
  { id: "carbon",   name: "Carbon",        price: 120,  color: "#1b1b1f", accent: "#e63946", desc: "Matt-schwarz mit roten Ringen." },
  { id: "neon",     name: "Neon",          price: 200,  color: "#39ff14", accent: "#111111", desc: "Grell. Absichtlich." },
  { id: "eis",      name: "Eis",           price: 250,  color: "#bfe9ff", accent: "#ffffff", desc: "Kalt wie der See im Januar." },
  { id: "candy",    name: "Zuckerstange",  price: 300,  color: "#ff4f7b", accent: "#ffffff", desc: "Weihnachten am See." },
  { id: "lava",     name: "Lava",          price: 450,  color: "#ff4500", accent: "#ffd23a", desc: "Vorsicht, heiß." },
  { id: "gold",     name: "Gold",          price: 800,  color: "#e0b000", accent: "#fff2a8", desc: "Für den Angler mit Geschmack." },
  { id: "galaxie",  name: "Galaxie",       price: 1200, color: "#2a1b5e", accent: "#c77dff", glow: true, desc: "Sterne inklusive." },
  { id: "rainbow",  name: "Regenbogen",    price: 1500, rainbow: true,    accent: "#ffffff", desc: "Alle Farben. Gleichzeitig. Nacheinander." },
  { id: "kristall", name: "Kristall",      price: 0, gemPrice: 25, color: "#bfe9ff", accent: "#7fd8ff", glow: true, desc: "Durchsichtig. Die Fische sehen die Rute nicht kommen." },
  // Easter Egg: die Klassiker aus einem gewissen Messer-Markt
  { id: "tigertooth",   name: "Tiger Tooth",    price: 2200, fx: "tiger",   color: "#f39c12", accent: "#1a1a1a", desc: "Factory New. Float 0.003. Kein Trade-Lock." },
  { id: "crimsonweb",   name: "Crimson Web",    price: 0, gemPrice: 35, fx: "web", color: "#8a1c2b", accent: "#1a0a0e", desc: "Drei Netze auf der Vorderseite. Sammlerstück." },
  { id: "gammadoppler", name: "Gamma Doppler",  price: 0, gemPrice: 45, fx: "gamma", color: "#2ee6a6", accent: "#0b6b3a", glow: true, desc: "Phase 2. Emerald wäre zu teuer gewesen." },
  { id: "fade",         name: "Fade",           price: 3000, fx: "fade",    color: "#ff5c8a", accent: "#ffd23a", desc: "100 % Fade. Sagt jeder." },
  { id: "casehardened", name: "Case Hardened",  price: 2600, fx: "case",    color: "#2a6fd6", accent: "#c9a227", desc: "Blue Gem? Fast. 40 % Blau, Rest Gold." },
  { id: "marblefade",   name: "Marble Fade",    price: 0, gemPrice: 40, fx: "marble", color: "#ff3b30", accent: "#ffd23a", desc: "Fire & Ice. Der See ist beeindruckt." },
  { id: "slaughter",    name: "Slaughter",      price: 2400, fx: "slaughter", color: "#c0392b", accent: "#f5b7b1", desc: "Mit Herz-Muster. Angeblich." }
  // Pass-exclusive, appended by pass.js — see §6:
  // { id: "sommerbrise", name: "Sommerbrise", price: -1, unlock: "Angel-Pass Premium Stufe 30", color: "#5ad4e6", accent: "#fff3a0", glow: true }
];
```

### Hats — `HATS` (`shop.js`)

Six items are **not purchasable** (`price: -1`) — unlocked only by reaching 100% Fischdex
(fish-dex/species-log completion) for the matching location (see `DEX_HATS` in §2).

```js
const HATS = [
  { id: "angler",   name: "Anglerhut",       price: 0,    desc: "Grün, praktisch, unauffällig." },
  { id: "cap",      name: "Basecap",         price: 50,   desc: "Schirm nach vorne. Oder hinten." },
  { id: "stroh",    name: "Strohhut",        price: 120,  desc: "Sommer, Sonne, Sonnenbrand vermieden." },
  { id: "muetze",   name: "Weihnachtsmütze", price: 200,  desc: "Ho ho ho, ein Karpfen." },
  { id: "kapitaen", name: "Kapitänsmütze",   price: 350,  desc: "Aye aye." },
  { id: "pirat",    name: "Piratenhut",      price: 600,  desc: "Arrr. Wo ist die Schatzkiste?" },
  { id: "zylinder", name: "Zylinder",        price: 900,  desc: "Angeln, aber elegant." },
  { id: "krone",    name: "Krone",           price: 2000, desc: "König des Sees." },
  { id: "perlenkrone", name: "Perlenkrone",  price: 0, gemPrice: 30, desc: "Aus dem Riff. Für Königinnen und Könige." },
  // Exklusiv: nur über Fischdex 100 % des jeweiligen Orts
  { id: "kranz",        name: "Blätterkranz",  price: -1, unlock: "Fischdex Steg am See 100 %",  desc: "Für den, der den See kennt." },
  { id: "nessiemuetze", name: "Nessie-Mütze",  price: -1, unlock: "Fischdex Seemitte 100 %",     desc: "Sie existiert. Du weißt es." },
  { id: "moewenhut",    name: "Möwenhut",      price: -1, unlock: "Fischdex Küste 100 %",        desc: "Die Möwe sitzt jetzt auf deiner Seite." },
  { id: "blumenkranz",  name: "Blumenkranz",   price: -1, unlock: "Fischdex Korallenriff 100 %", desc: "Aloha." },
  { id: "leuchthelm",   name: "Leuchthelm",    price: -1, unlock: "Fischdex Tiefsee 100 %",      desc: "Selbst leuchten, statt zu suchen." },
  { id: "eiskrone",     name: "Eiskrone",      price: -1, unlock: "Fischdex Arktis 100 %",       desc: "Kalt. Königlich. Kalt." }
  // Pass-exclusive, appended by pass.js — see §6:
  // { id: "sommerhut", name: "Sommerhut", price: -1, unlock: "Angel-Pass Premium Stufe 10", desc: "Nur im Angel-Pass." }
];
```

### Outfits — `OUTFITS` (`shop.js`)

Full-character skins (body/pants/skin tone + accents), separate from hats.

```js
const OUTFITS = [
  { id: "klassisch", name: "Klassisch",     price: 0,    body: "#2b2f3a", pants: "#2b2f3a", skin: "#e9c3a0", desc: "Dunkler Pulli, Jeans. Zeitlos." },
  { id: "regen",     name: "Regenjacke",    price: 200,  body: "#f4c542", pants: "#2b3a55", skin: "#e9c3a0", desc: "Gelb wie ein Warnschild. Hält trocken." },
  { id: "hawaii",    name: "Hawaiihemd",    price: 350,  body: "#ff6b6b", pants: "#f0e6c8", skin: "#d9a878", pattern: "flowers", desc: "Urlaub am See. Immer." },
  { id: "taucher",   name: "Taucheranzug",  price: 600,  body: "#1b1b1f", pants: "#1b1b1f", skin: "#e9c3a0", stripe: "#39ff14", desc: "Neopren mit Neonstreifen. Tiefsee-tauglich." },
  { id: "pirat",     name: "Piratenmantel", price: 800,  body: "#8a1c2b", pants: "#2b2f3a", skin: "#e9c3a0", stripe: "#ffd700", desc: "Passt zum Hut. Und zum Kraken." },
  { id: "eskimo",    name: "Polarparka",    price: 900,  body: "#dfefff", pants: "#4a5a6a", skin: "#e9c3a0", fur: true, desc: "Mit Fellkragen. Eisloch-Pflicht." },
  { id: "kapitaen",  name: "Kapitänsjacke", price: 1200, body: "#1d3557", pants: "#f2f2f2", skin: "#e9c3a0", stripe: "#ffd700", desc: "Navy mit Goldknöpfen." },
  { id: "gold",      name: "Goldanzug",     price: 0, gemPrice: 40, body: "#e0b000", pants: "#c99a00", skin: "#e9c3a0", stripe: "#fff2a8", desc: "Für den Angler, der alles hat. Außer Bescheidenheit." }
];
```

### Harpoon skins — `HARPOONS` (`shop.js`)

Only relevant in the deep-sea "dive" mode (`mode: "dive"` location — Tiefsee), where the
player shoots a harpoon instead of casting a rod. `getHarpoonSkin()` reads
`save.equipped.harpoon`.

```js
const HARPOONS = [
  { id: "standard",  name: "Standard",        price: 0,    shaft: "#8a929b", accent: "#e6edf5", desc: "Tut, was sie soll." },
  { id: "stahl",     name: "Gehärteter Stahl",price: 300,  shaft: "#5f6b78", accent: "#cfd8e2", desc: "Schwerer Schaft, ruhigerer Flug." },
  { id: "knochen",   name: "Walknochen",      price: 600,  shaft: "#e6dcc4", accent: "#b8a888", desc: "Aus der Tiefe, für die Tiefe." },
  { id: "obsidian",  name: "Obsidian",        price: 900,  shaft: "#1a1a22", accent: "#6a5acd", desc: "Vulkanglas. Schneidet Wasser." },
  { id: "biolum",    name: "Biolumineszenz",  price: 1400, shaft: "#0f3b3a", accent: "#37e0d8", glow: "#37e0d8", desc: "Leuchtet wie die Korallen. Fische kommen näher." },
  { id: "abyss",     name: "Abyss",           price: 2000, shaft: "#101a2e", accent: "#7b6bff", glow: "#7b6bff", desc: "Aus dem, was da unten leuchtet." },
  { id: "goldharp",  name: "Goldene Harpune", price: 0, gemPrice: 30, shaft: "#c9a227", accent: "#fff2a8", glow: "#ffd66b", desc: "Poseidon hätte Fragen." },
  // Easter Egg – die Messer-Markt-Linie geht auch unter Wasser weiter
  { id: "harptiger",   name: "Tiger Tooth", price: 2200, fx: "tiger",  shaft: "#f39c12", accent: "#1a1a1a", desc: "Auch unter Wasser Factory New." },
  { id: "harpdoppler", name: "Doppler",     price: 0, gemPrice: 40, fx: "gamma", shaft: "#2ee6a6", accent: "#0b6b3a", glow: "#2ee6a6", desc: "Phase 4. Diesmal wirklich." },
  { id: "harpfade",    name: "Fade",        price: 3000, fx: "fade", shaft: "#ff5c8a", accent: "#ffd23a", desc: "Der Farbverlauf allein ist den Tauchgang wert." }
];
```

### Totems — `TOTEMS` (`gems.js`)

Timed-effect consumables. Purchased into an inventory bag (§ inventory below), then
*activated* separately (two-step: buy ≠ use). `dur` = seconds of effect (`0` = instant,
one-shot). `tint` colors the ring-timer UI.

```js
const TOTEMS = [
  { id: "regen",   name: "Regentotem",  icon: "🌧️", ico: "rain",   tint: "#7fc7ff", price: 800, desc: "90 s Regen – Fische beißen 1,6× schneller.", dur: 90 },
  { id: "nacht",   name: "Nachttotem",  icon: "🌙",  ico: "moon",   tint: "#b9a8ff", price: 900, desc: "Sofort Nacht – Nachtfische kommen raus.",     dur: 0 },
  { id: "sonne",   name: "Sonnentotem", icon: "☀️",  ico: "sun",    tint: "#ffd23a", price: 500, desc: "Sofort Mittag – für die Tagfische.",           dur: 0 },
  { id: "lockruf", name: "Lockruf",     icon: "📣",  ico: "horn",   tint: "#ff9a5c", price: 650, desc: "3 min doppelte Lock-Rate.",                    dur: 180 },
  { id: "glueck",  name: "Glückstotem", icon: "🍀",  ico: "clover", tint: "#7fe08a", gems: 2,    desc: "5 min vierfache Shiny-Chance.",                dur: 300 },
  { id: "magnet",  name: "Seltenheits-Magnet", icon: "🧲", ico: "magnet", tint: "#ff8a80", gems: 3, desc: "5 min doppelt so viele seltene Fische.",     dur: 300 }
];
```

Effect wiring: `regen` forces `weather.type = "rain"` and keeps rain going while the totem
timer is alive (`updateTotems` re-asserts rain each tick if `totemTime.regen > 0`); `nacht`
sets `dayTime = 0.97`; `sonne` sets `dayTime = 0.5`; `lockruf` doubles `waitBoost` in
`updateFishes` (fish.js) — see `totemActive("lockruf") ? 2 : 1`; `glueck` multiplies shiny
roll ×4 (`fish.js` createFish: `totemActive("glueck") ? 4 : 1`); `magnet` doubles rare+
weight in `pickSpecies` (`totemActive("magnet") ? 2 : 1`).

### Gacha — `GACHA` (`gacha.js`)

```js
const GACHA = [
  { id: "tuete", name: "Wundertüte",         price: 400,  icon: "🎁", desc: "Coins, Köder, Skins – oder Seetang.", gold: false },
  { id: "gold",  name: "Goldene Wundertüte", price: 1600, icon: "✨", desc: "Bessere Chancen auf Skins und den Jackpot.", gold: true }
];
```

### Aquarium (tank) decorations — `TANK_GROUNDS`, `TANK_BACKS`, `TANK_DECOR` (`aquarium.js`)

Pure cosmetics for the home-tank hub, no gameplay effect — "the sink that has nothing to do
with power, shown off to friends."

```js
const TANK_GROUNDS = [
  { id: "kies",    name: "Heller Kies",   price: 0,    top: "#c9b58c", bot: "#8a7a5a", dots: ["#b9a27a", "#d8c8a3", "#8f7f60", "#e2d4b1"] },
  { id: "sand",    name: "Feiner Sand",   price: 250,  top: "#efe0b8", bot: "#c4ae7e", dots: ["#e6d4a6", "#f6ecd0", "#d2bd8c", "#fff6e0"] },
  { id: "vulkan",  name: "Vulkangestein", price: 600,  top: "#4a4148", bot: "#241f26", dots: ["#5c525a", "#3a333c", "#6b5f68", "#2c262e"] },
  { id: "koralle", name: "Korallensplit", price: 900,  top: "#f0c9c2", bot: "#c08a86", dots: ["#ffdcd6", "#e0aaa4", "#ffeae6", "#cf9a95"] },
  { id: "gold",    name: "Goldsand",      price: 0, gemPrice: 15, top: "#f3d98a", bot: "#c9a227", dots: ["#ffeaa8", "#e0c060", "#fff6cf", "#d4ae3a"] }
];
const TANK_BACKS = [
  { id: "schlicht", name: "Schlicht",     price: 0,    a: "#3a9ec4", b: "#1f6f95", c: "#123f5c" },
  { id: "tief",     name: "Tiefes Blau",  price: 300,  a: "#2a6f96", b: "#134863", c: "#0a2536" },
  { id: "riff",     name: "Riffgrün",     price: 700,  a: "#3fd0c9", b: "#1f8f8a", c: "#0e5a5a" },
  { id: "daemmer",  name: "Dämmerung",    price: 1100, a: "#7a6fb0", b: "#4a3f7a", c: "#241f45" },
  { id: "abyss",    name: "Abyss",        price: 0, gemPrice: 20, a: "#16324a", b: "#0a1c2c", c: "#03080f" }
];
const TANK_DECOR = [
  { id: "pflanzen", name: "Wasserpflanzen", price: 0,   desc: "Grün, wiegt sich." },
  { id: "stein",    name: "Findling",       price: 200, desc: "Ein Stein. Ehrliche Arbeit." },
  { id: "amphore",  name: "Amphore",        price: 450, desc: "Antik. Angeblich." },
  { id: "wrack",    name: "Schiffswrack",   price: 800, desc: "Kleines Wrack, große Geschichte." },
  { id: "helm",     name: "Taucherhelm",    price: 1000, desc: "Der Vorbesitzer fehlt." },
  { id: "burg",     name: "Aquarienburg",   price: 1400, desc: "Der Klassiker aus dem Zoohandel." },
  { id: "vulkan",   name: "Blubbervulkan",  price: 1800, desc: "Speit Blasen statt Lava." },
  { id: "schaedel", name: "Schädel",        price: 0, gemPrice: 12, desc: "Rein dekorativ. Hoffentlich." },
  { id: "kristall", name: "Leuchtkristall", price: 0, gemPrice: 18, desc: "Leuchtet im Dunkeln." }
];
const DECOR_SLOTS = 4; // free-standing decor items visible at once (ground + back are single-slot, always visible)
```

Tank has `TANK_BASE_SLOTS = 6` fish display slots, upgradable to `TANK_MAX_SLOTS = 12`.
`tankSlotCost() = round(1000 * 1.7^extra)` (coins), where `extra` = slots bought beyond
base (0..6). Slot expansion is a pure coin sink, unrelated to `TANK_DECOR`.

### Locations — `LOCATIONS` (`locations.js`)

Not a "shop tab" item but the other big coin sink / level gate. `mode` selects the
renderer/input scheme (`dock`, `boat`, `pier`, `dive`, `ice`).

```js
const LOCATIONS = [
  { id: "see",     name: "Steg am See",         price: 0,     level: 1,  mode: "dock", icon: "🌲", water: ["#5fa8c9", "#1c4f6b"], dark: 0,    desc: "Wo alles anfing. Karpfen, Hecht, Barsch – und ein Stiefel." },
  { id: "boot",    name: "Ruderboot · Seemitte", price: 1200,  level: 3,  mode: "boat", icon: "🚣", water: ["#4b8fb5", "#0f3448"], dark: 0.05, desc: "Tiefes Wasser, große Räuber. Und Gerüchte über etwas Großes." },
  { id: "kueste",  name: "Küste",               price: 3000,  level: 7,  mode: "pier", icon: "🌊", water: ["#3f7fb0", "#0c2b48"], dark: 0,    desc: "Salzwasser: Makrele, Krabbe, Oktopus. Die Möwen sind frecher." },
  { id: "riff",    name: "Korallenriff",        price: 6000,  level: 12, mode: "boat", icon: "🐠", water: ["#3fd0c9", "#0e6b7a"], dark: 0,    desc: "Türkis, bunt, warm. Clownfische, Schildkröten, Mantas." },
  { id: "tiefsee", name: "Tiefsee",             price: 12000, level: 18, mode: "dive", icon: "🦑", water: ["#0d2038", "#010409"], dark: 0.6,  desc: "Kein Licht außer dem, was die Fische selbst machen." },
  { id: "arktis",  name: "Eisloch · Arktis",    price: 20000, level: 25, mode: "ice",  icon: "🧊", water: ["#3a7f96", "#0a2a3a"], dark: 0.1,  desc: "Ein Loch im Eis, ein Hocker, minus 20 Grad. Heilbutt wartet." }
];
```

A location must be unlocked by **both** level *and* coins: `getLevel() >= loc.level` **and**
`coins >= loc.price` (see §13 `selectLocation`). Each location also has one boss fish
(defined in `S(locId, [...])` species rows with `{ boss: true }`) that, when defeated,
grants **+5 gems** and — if the next location isn't owned yet — unlocks it **for free**
(`onBossCaught`, `locations.js`).

Fish species themselves (`SPECIES`, `RARITY`) are cataloged in the creatures/fishdex spec,
not here — only the pieces needed for the economy formulas are reproduced in §13.

### Shop tab registry — `SHOP_TABS` (`shop.js`)

```js
const SHOP_TABS = [
  { id: "rods",     label: "Ruten",    icon: "rod",       items: RODS,     equipKey: "rod" },
  { id: "baits",    label: "Köder",    icon: "worm",      items: BAITS,    equipKey: "bait" },
  { id: "bobbers",  label: "Posen",    icon: "bobber",    items: BOBBERS,  equipKey: "bobber" },
  { id: "rodskins", label: "Skins",    icon: "palette",   items: RODSKINS, equipKey: "rodskin" },
  { id: "hats",     label: "Hüte",     icon: "hat",       items: HATS,     equipKey: "hat" },
  { id: "outfits",  label: "Outfits",  icon: "coat",      items: OUTFITS,  equipKey: "outfit" },
  { id: "harpoons", label: "Harpunen", icon: "trident",   items: HARPOONS, equipKey: "harpoon" },
  { id: "totems",   label: "Totems",   icon: "orb",       items: [],       equipKey: null },
  { id: "gems",     label: "Gems",     icon: "gem",       items: [],       equipKey: null },
  { id: "gacha",    label: "Glück",    icon: "gift",      items: [],       equipKey: null }
];
```

`totems`, `gems`, `gacha` tabs draw custom panels (`drawTotemShop`, `drawGemShop`,
`drawGacha`) instead of a generic item grid.

### Buy/equip logic (`shop.js`)

```js
function isOwned(tab, item) { return save.owned[tab.id].includes(item.id); }
function isEquipped(tab, item) { return save.equipped[tab.equipKey] === item.id; }

function buyOrEquip(tab, item) {
  if (isOwned(tab, item)) { save.equipped[tab.equipKey] = item.id; saveGame(); return; }
  if (item.gemPrice) { // fails softly, redirects to gem shop tab
    if (!spendGems(item.gemPrice)) { shopTab = "gems"; shopPage = 0; return; }
    save.owned[tab.id].push(item.id); save.equipped[tab.equipKey] = item.id; saveGame(); return;
  }
  if (coins >= item.price) {
    coins -= item.price;
    save.owned[tab.id].push(item.id);
    save.equipped[tab.equipKey] = item.id;
    saveGame();
  } // else: fail feedback, no purchase
}
```

Items with `price: -1` (dex-unlock hats, pass-exclusive skins) are **never buyable through
this path** — they're pushed into `save.owned[...]` directly by the unlock code
(`checkDexRewards`, `claimPass`).

---

## 2. Progression (level, titles, unlocks, daily bonus, dex rewards)

All in `progress.js` unless noted.

### XP

```js
const XP_BY_RARITY = [12, 30, 70, 160, 420]; // indexed by RARITY[rarity].idx: common..legendary
function xpToNext(level) { return Math.round(90 + level * 55 + Math.pow(level, 1.7) * 6); }
```

XP per catch (`xpForCatch`, also `progress.js`):
```js
function xpForCatch(sp, perfect, shiny) {
  let xp = XP_BY_RARITY[RARITY[sp.rarity].idx];
  if (sp.junk) xp = 5;
  if (perfect) xp = Math.round(xp * 1.25);
  if (shiny) xp *= 3;
  return xp;
}
```
Applied XP is further multiplied by the "Gelehrter" talent (`talentMult("lehre", 0.06)`,
+6%/rank, see §7) — done at the call site in `script.js`, not inside `xpForCatch`.

### Level-up (`addXP`)

```
save.xp += amount
addPassPoints(amount, fromXP=true)   // pass.js — only a fraction becomes pass points, see §6
while (save.xp >= xpToNext(save.level)):
  save.xp -= xpToNext(save.level)
  save.level++
  reward = round(save.level * LEVEL_COIN_F * tierMult())   // LEVEL_COIN_F = 25
  coins += reward
  if (save.level % 5 === 0) save.gems += 1
  // shows a level-up popup (levelUpInfo), unlocks the next location card if
  // LOCATIONS has an entry with l.level === save.level
```

`tierMult()`:
```js
function progressTier() { // 1..6 — highest UNLOCKED location's 1-based index
  let tier = 1;
  LOCATIONS.forEach((l, i) => { if (isLocationOwned(l)) tier = Math.max(tier, i + 1); });
  return tier;
}
function tierMult() { return 1 + (progressTier() - 1) * 0.8; } // 1.0 .. 5.0
```
`tierMult()` scales level-up coins, daily-bonus coins, the location-travel ad reward, and
the pass's free/premium coin rewards — it is the single "game got bigger, rewards scale
with it" knob.

### Titles

```js
function anglerTitle() {
  const l = getLevel();
  return l >= 40 ? "Legende des Sees" : l >= 30 ? "Meisterangler" : l >= 20 ? "Kapitän" :
         l >= 12 ? "Profi" : l >= 6 ? "Angler" : "Anfänger";
}
```

### Location unlocks

A location becomes purchasable once `getLevel() >= loc.level`; it's actually unlocked (added
to `save.owned.locations`) either by paying `loc.price` in coins (`selectLocation`, §13) or
for free by defeating that tier's boss fish (`onBossCaught`, §1/Locations).

### Daily bonus

```js
const DAILY_STREAK = [60, 90, 130, 190, 260, 380, 650]; // coins, day 1..7 (day 8+ repeats day 7's 650)
const DAILY_ADS = 2; // rewarded-ad bonus claims per day, separate from the streak claim

function dailyState() { // save.daily = { last, streak, claimed, adsDay, adsUsed }; adsUsed resets when adsDay != today
  ...
}
function dailyReward() {
  // streak = (last login was yesterday) ? streak+1 : (already claimed today ? streak : 1)
  return { streak, coins: Math.round(DAILY_STREAK[Math.min(streak,7)-1] * tierMult()) };
}
function claimDaily() {
  // sets d.streak/d.last/d.claimed = today, coins += reward.coins
  // streak >= 7 → unlockAchievement("woche") + addGems(2, "7 Tage Serie")
}
function adBonusAmount() { return Math.round(120 * tierMult()); }
function watchAdForBonus() {
  if (dailyAdsLeft() <= 0) return;
  Ads.reward(() => { // #15: reward is granted+saved BEFORE the ad plays, see §8
    dailyState().adsUsed++;
    coins += adBonusAmount(); save.stats.adsWatched++;
  });
}
```
`todayKey()` (shared with quests) = `"{year}-{month}-{day}"` in **local time**, no timezone
normalization. `dailyClaimable() = dailyState().claimed !== todayKey()`.

### Fischdex (species-log) rewards — `checkDexRewards` (`progress.js`)

Per location, checked every catch: once **≥50%** of that location's non-boss species are in
`save.dex`, and once **100%** are:

```js
const DEX_HATS = { see: "kranz", boot: "nessiemuetze", kueste: "moewenhut", riff: "blumenkranz", tiefsee: "leuchthelm", arktis: "eiskrone" };

// 50%: reward = round(300 * (locationIndex + 1)) coins, one-time (save.dexRewards[locId+":50"])
// 100%: reward = round(1000 * (locationIndex + 1)) coins + 3 gems + the location's DEX_HATS entry
//       pushed into save.owned.hats, one-time (save.dexRewards[locId+":100"])
```
`locationIndex` = 0-based index into `LOCATIONS` (see, boot, kueste, riff, tiefsee, arktis
→ 1..6 multiplier). So: See 50% = 300, 100% = 1000+hat; Arktis 50% = 1800, 100% = 6000+hat.

### Talent points

Every level-up grants exactly 1 unspent talent point implicitly — `skillPoints()` is derived,
not stored (see §7).

---

## 3. Quests (`quests.js`)

Three daily quests, deterministically generated from the date string, refreshed at local
midnight.

### Generation

```js
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }
function seeded(seedStr) { /* xorshift-ish string-seeded PRNG, deterministic per day */ }

function ensureQuests() {
  if (save.quests && save.quests.day === todayKey()) return; // already generated today
  const rnd = seeded(todayKey() + "-fishing");
  const owned = LOCATIONS.filter(isLocationOwned);
  const pool = QUEST_TEMPLATES.filter(t => t.id !== "location" || owned.length > 1);
  // draw 3 distinct templates without replacement (rnd-shuffled splice),
  // each instantiated with a random `n` from its `n` array (if any) and a
  // random owned location (for the "location" template)
  save.quests = { day: todayKey(), list: [3 instantiated quest objects] };
}
```
Each instantiated quest object: `{ tid, n, progress: 0, done: false, claimed: false, seen: [], text, target, reward, locId? }`.
`claimed` is set in the initializer but **never read anywhere else** — dead field, reward is
auto-granted the instant `progress >= target` (no manual claim step, unlike the season pass).

### Reward scaling

```js
const QUEST_SCALE = 0.45;
const questReward = n => Math.max(10, Math.round(n * QUEST_SCALE / 10) * 10); // rounds to a multiple of 10
```

### All 11 templates

```js
const QUEST_TEMPLATES = [
  { id: "catch",    make: n => ({ text: `Fange ${n} Fische`, target: n, reward: questReward(40 * n) }), n: [3, 5, 8], test: (q, ev) => ev.type === "catch" && !ev.junk },
  { id: "rare",     make: () => ({ text: "Fange einen seltenen (oder besseren) Fisch", target: 1, reward: questReward(250) }), test: (q, ev) => ev.type === "catch" && ev.rarityIdx >= 2 },
  { id: "heavy",    make: n => ({ text: `Fange etwas über ${n} kg`, target: 1, reward: questReward(120 + n * 10) }), n: [3, 5, 10], test: (q, ev) => ev.type === "catch" && ev.kg >= q.n },
  { id: "perfect",  make: n => ({ text: `${n}× perfekter Drill`, target: n, reward: questReward(100 * n) }), n: [1, 2, 3], test: (q, ev) => ev.type === "catch" && ev.perfect },
  { id: "night",    make: () => ({ text: "Fange einen Nachtfisch", target: 1, reward: questReward(200) }), test: (q, ev) => ev.type === "catch" && ev.night },
  { id: "streak",   make: n => ({ text: `Serie von ${n} Fängen`, target: 1, reward: questReward(80 * n) }), n: [3, 4, 5], test: (q, ev) => ev.type === "catch" && ev.streak >= q.n },
  { id: "species",  make: n => ({ text: `Fange ${n} verschiedene Arten`, target: n, reward: questReward(60 * n) }), n: [3, 4, 5], test: (q, ev) => ev.type === "catch" && !ev.junk, unique: "species" },
  { id: "junk",     make: () => ({ text: "Fische etwas Müll aus dem Wasser", target: 1, reward: questReward(90) }), test: (q, ev) => ev.type === "catch" && ev.junk },
  { id: "rain",     make: () => ({ text: "Fange einen Fisch im Regen", target: 1, reward: questReward(150) }), test: (q, ev) => ev.type === "catch" && ev.rain },
  { id: "seagull",  make: () => ({ text: "Verjage eine Möwe", target: 1, reward: questReward(120) }), test: (q, ev) => ev.type === "seagull" },
  { id: "location", make: (n, loc) => ({ text: `Fange 3 Fische: ${loc.name}`, target: 3, reward: questReward(220), locId: loc.id }), test: (q, ev) => ev.type === "catch" && ev.loc === q.locId && !ev.junk }
];
```
Computed rewards (at `QUEST_SCALE = 0.45`): catch(3)=60, catch(5)=90, catch(8)=140, rare=110,
heavy(3)=70, heavy(5)=80, heavy(10)=100, perfect(1)=50, perfect(2)=90, perfect(3)=140,
night=90, streak(3)=110, streak(4)=140, streak(5)=180, species(3)=80, species(4)=110,
species(5)=140, junk=40, rain=70, seagull=50, location=100.

`unique: "species"` templates track seen values in `q.seen[]` to avoid counting the same
species twice toward `species` quests.

### Event dispatch (`questEvent`)

Called from `catchFish()` with `{ type: "catch", junk, rarityIdx, kg, perfect, night, streak, loc, rain, species }`,
and from the seagull-shoo interaction with `{ type: "seagull" }`, and from `harvestAquarium()`
with `{ type: "harvest", n }` (no template currently listens for `"harvest"`). On completion:
coins granted immediately, `save.stats.quests++`, `addPassPoints(50)` (flat, **not** scaled by
`PASS_POINT_F` — quest points bypass the XP-derived pass-point throttle), `checkAchievements()`.

### Countdown

`"Neue Aufträge in {hh}h {mm}min"` computed as `new Date().setHours(24,0,0,0) - now`, i.e.
time to local midnight — quests regenerate lazily on next `ensureQuests()` call (typically
next overlay open), not via a background timer.

---

## 4. Gacha (`gacha.js`)

Two tiers: `tuete` (400 coins) and `gold` (1600 coins, `gold: true`).

### Drop table

```js
function rollGacha(item) {
  const r = Math.random();
  const skins = notOwnedPool();       // all not-yet-owned items with price>0 across bobbers/rodskins/hats/outfits/harpoons (excludes rods, baits, and the gacha/totems/gems tabs themselves)
  const baits = BAITS not-yet-owned with price > 0;
  const jackpotP = item.gold ? 0.03  : 0.012;
  const skinP    = item.gold ? 0.35  : 0.12;
  const baitP    = item.gold ? 0.12  : 0.12;
  const nothingP = item.gold ? 0.06  : 0.14;
  // remainder (coins outcome) = 1 - jackpotP - skinP - baitP - nothingP,
  // but only reachable if a skins/baits pool is non-empty for its branch —
  // an empty pool falls through to the coins branch instead.

  if (r < jackpotP)                                  → jackpot: coins = gold ? 11000 : 4000
  else if (r < jackpotP+skinP && skins.length)        → skin: random not-owned cosmetic, granted free
  else if (r < jackpotP+skinP+baitP && baits.length)  → bait: random not-owned bait, granted free
  else if (r < jackpotP+skinP+baitP+nothingP)         → nothing ("Nur Seetang. 🌿")
  else                                                 → coins: round(item.price * rand(gold?0.25..1.4 : 0.15..1.2))
}
```

Standard bag (`tuete`, 400 coins): 1.2% jackpot(4000) / 12% skin / 12% bait / 14% nothing /
60.8% coins(≈60–480). Golden bag (`gold`, 1600 coins): 3% jackpot(11000) / 35% skin / 12%
bait / 6% nothing / 44% coins(≈400–2240). Expected value is deliberately below the price
(house edge) — the appeal is skins and the rare jackpot, per the source comment.

Jackpot additionally: `unlockAchievement("jackpot")`, screen shake 12, 4-tier catch jingle.

### Animation

`openGacha(item)`: deduct price immediately, roll result, set `gacha = { item, t: 0, result, revealed: false }`.
`updateGacha(dt)`: bag wobbles/shakes with increasing amplitude for **1.6s**, then
`revealed = true` and rewards are actually granted (coins added, skin/bait pushed to
`save.owned`, achievements checked) — i.e. **the roll happens at open-time but the payout
is deferred to the reveal frame** at t≥1.6s. `drawGacha()` renders the wobbling bag emoji,
then a wood-panel reveal card scaled in with an ease-out over 0.35s, colored by result kind
(gold/purple/green/gray/orange). Tap-anywhere-to-close once revealed.

---

## 5. Gems (`gems.js`, cross-referenced)

`getGems() = save.gems || 0`. `addGems(n, reason)` (adds + floating text + saves, no cap).
`spendGems(n)` (fails silently, returns false, if insufficient).

### Sources (repeatable)

| Source | Amount | Where |
|---|---:|---|
| Shiny catch | +1 | `script.js catchFish()` |
| Level-up, every 5th level | +1 | `progress.js addXP()` |
| Any achievement unlock (36 total) | +1 each | `events.js unlockAchievement()` |
| 7-day login streak reached | +2 | `progress.js claimDaily()` |
| Boss fish defeated | +5 | `locations.js onBossCaught()` |
| Season pass free-track, every 10th tier | +3 | `pass.js passReward()` |
| Season pass premium-track, tier%3===0 | `2 + floor(tier/10)` | `pass.js passReward()` |
| IAP gem packs | 50 / 200 / 600 | `gems.js GEM_PACKS`, real purchase via `native.js` |

Per `docs/WIRTSCHAFT.md` §4, a simulated 10h play session nets **≈3.5 gems/hour** in steady
state after an early spike (13 of the first 35 gems land in hour 1 from level/dex/pass
milestones).

### Sinks (one-time cosmetic unlocks, `gemPrice` field across catalogs)

| Item | Gems |
|---|---:|
| Diamantpose (bobber) | 20 |
| Kristall (rodskin) | 25 |
| Crimson Web (rodskin) | 35 |
| Gamma Doppler (rodskin) | 45 |
| Marble Fade (rodskin) | 40 |
| Perlenkrone (hat) | 30 |
| Goldanzug (outfit) | 40 |
| Goldene Harpune | 30 |
| Doppler (harpoon) | 40 |
| Goldsand (tank ground) | 15 |
| Abyss (tank back) | 20 |
| Schädel (tank decor) | 12 |
| Leuchtkristall (tank decor) | 18 |

Total one-time catalog per `docs/WIRTSCHAFT.md`: **370 gems across 13 items** (the doc's
own count — verify against the tables above if items are added/removed in the rebuild).

### Sinks (repeatable)

| Item | Gems |
|---|---:|
| Glückstotem | 2 |
| Seltenheits-Magnet totem | 3 |

### Gem packages (IAP, `GEM_PACKS`)

```js
const GEM_PACKS = [
  { id: "gems_50",  gems: 50,  price: "1,99 €",  icon: "💎",     desc: "Ein Sack voll." },
  { id: "gems_200", gems: 200, price: "5,99 €",  icon: "💎💎",   desc: "Beliebteste Wahl.", tag: "+25 %" },
  { id: "gems_600", gems: 600, price: "12,99 €", icon: "💎💎💎", desc: "Für Sammler.", tag: "+50 %" },
  { id: "adfree",   gems: 0,   price: "0,99 €",  icon: "🚫📺",   desc: "Werbefrei für immer. Keine Pausen, keine Anzeigen." }
];
```
`docs/WIRTSCHAFT.md` flags the 600-gem pack (1.6× the entire cosmetic catalog) as an
unresolved trust problem and recommends `50 / 150 / 400` instead of `50 / 200 / 600` — **not
yet implemented** in the source; worth deciding explicitly for the rebuild.

Purchase routes through `Native.buy(productId)` (real IAP in-app) or, in browser/no-SDK
context, is display-only ("Käufe sind nur in der App möglich").

---

## 6. Season pass — "Angel-Pass" (`pass.js`)

30 tiers, free + premium track, monthly season, XP- and quest-derived points.

```js
const PASS_TIERS = 30;
function passSeasonId() { return `${year}-${MM}`; }               // e.g. "2026-09" — resets automatically each calendar month
function passPointsForTier(t) { return Math.round(t * (60 + t * 6)); } // CUMULATIVE points needed to reach tier t
```
Tier thresholds (cumulative points): tier 1 = 66, tier 5 = 750, tier 10 = 1600, tier 15 =
2475, tier 20 = 3400, tier 25 = 4375, tier 30 = 5400... — computed via the formula above,
not stored as a table (`Math.round(30*(60+30*6)) = 7200`, matching the code comment
"Stufe 30 ≈ 7200 Punkte").

### Points

```js
const PASS_POINT_F = 0.45; // fraction of XP that becomes pass points
function addPassPoints(n, fromXP) {
  p.points += fromXP ? Math.max(1, Math.round(n * PASS_POINT_F)) : n; // quests call addPassPoints(50) directly (fromXP=false) — full 50, unscaled
}
```
So: every XP gain also adds `round(xp * 0.45)` (min 1) pass points; every completed quest
adds a flat 50 pass points on top.

### Rewards

```js
const PASS_COIN_FREE = 22;
const PASS_COIN_PREMIUM = 55;

function passReward(tier, premium) {
  if (!premium) {
    if (tier % 10 === 0) return gems: 3;
    if (tier % 5 === 0)  return totem: "regen" (Regentotem);
    return coins: round(PASS_COIN_FREE * tier * tierMult());
  }
  if (tier === 10) return hat: "sommerhut";
  if (tier === 20) return bobber: "sonnenblume";
  if (tier === 30) return rodskin: "sommerbrise";
  if (tier % 3 === 0) return gems: 2 + floor(tier/10);
  if (tier % 4 === 0) return totem: ["glueck","magnet","lockruf","nacht"][(tier/4) % 4];
  return coins: round(PASS_COIN_PREMIUM * tier * tierMult());
}
```
Pass-exclusive cosmetics are pushed into their respective catalogs at load time with
`price: -1` (see the commented-out entries in §1):
```js
HATS.push({ id: "sommerhut", name: "Sommerhut", price: -1, unlock: "Angel-Pass Premium Stufe 10", desc: "Nur im Angel-Pass." });
BOBBERS.push({ id: "sonnenblume", name: "Sonnenblume", price: -1, unlock: "Angel-Pass Premium Stufe 20", desc: "Nur im Angel-Pass.", main: "#ffd23a", top: "#6b4a2b" });
RODSKINS.push({ id: "sommerbrise", name: "Sommerbrise", price: -1, unlock: "Angel-Pass Premium Stufe 30", desc: "Nur im Angel-Pass.", color: "#5ad4e6", accent: "#fff3a0", glow: true });
```
Totem pass-rewards go into the totem inventory (`invAdd`), **not** activated immediately
(historical bug fix, see §1 Totems / §"inventory").

### Claiming

Manual, per tier per track (`claimPass(tier, premium)`): requires `passTier() >= tier`,
not already in `claimedFree`/`claimedPremium`, and (for premium) `p.premium === true`.
`passClaimable()` counts unclaimed-but-reached rewards across both tracks for a badge count.

### Price

Premium unlock: **5,99 €**, IAP product id `"seasonpass"`, purchased via `Native.buy("seasonpass")`
(`buyPass()`); in browser (no native bridge) shows "Kauf nur in der App möglich".

### UI

Vertical track, tier 1 at the bottom scrolling up to tier 30, free rewards on the left,
premium on the right, a glowing progress column in the middle; reward icons are drawn
programmatically (chest = cosmetics, coin-stack, gem, totem-orb) rather than text.

---

## 7. Talents (`talents.js`)

7 talents × 5 ranks each, 1 point per player level (uncapped growth — level 40 gives 39
spendable points total).

```js
const TALENTS = [
  { id: "hand",    name: "Ruhige Hand",   desc: "+8 % Spannungsabbau je Rang",              max: 5 },
  { id: "arme",    name: "Kräftige Arme", desc: "+6 % Einholtempo je Rang",                 max: 5 },
  { id: "auge",    name: "Adlerauge",     desc: "+8 % Lockradius je Rang",                  max: 5 },
  { id: "geduld",  name: "Geduld",        desc: "+10 % Biss-Rate je Rang",                  max: 5 },
  { id: "glueck",  name: "Glückspilz",    desc: "+25 % Shiny-Chance, +8 % Seltene je Rang", max: 5 },
  { id: "feilsch", name: "Feilscher",     desc: "+5 % Coins je Rang",                       max: 5 },
  { id: "lehre",   name: "Gelehrter",     desc: "+6 % XP je Rang",                          max: 5 }
];
function talentRank(id) { return (save.talents && save.talents[id]) || 0; }
function talentMult(id, per) { return 1 + talentRank(id) * per; }
function skillPoints() { return Math.max(0, (getLevel()-1) - sum(all talentRanks)); }
function learnTalent(t) { if (skillPoints()<=0 || talentRank(t.id)>=t.max) return fail; save.talents[t.id]++; }
```

### Every place a talent multiplier is actually applied (call sites, `talentMult(id, per)`)

| Talent | per-rank | Applied to | File:line |
|---|---:|---|---|
| `auge` (Adlerauge) | 0.08 | fish attraction radius (`attractRadius`) | `fish.js:140` |
| `auge` | 0.05 | boss-fight tap damage | `bossfight.js:145` |
| `geduld` (Geduld) | 0.10 | bite/attraction rate | `fish.js:164` |
| `glueck` (Glückspilz) | 0.08 | rare+ species weight in catch roll | `fish.js:93` |
| `glueck` | 0.25 | shiny roll chance | `fish.js:114` |
| `arme` (Kräftige Arme) | 0.06 | reel rate | `script.js:676` |
| `arme` | 0.06 | boss-fight stamina drain, hit damage (×3 sites) | `bossfight.js:160,203,211,338` |
| `hand` (Ruhige Hand) | 0.08 | tension release rate while not holding | `script.js:679` |
| `hand` | 0.05/0.06 | boss-fight damage (×2 sites) | `bossfight.js:195,294` |
| `lehre` (Gelehrter) | 0.06 | XP gained per catch | `script.js:820` |
| `lehre` | 0.05 | boss-fight damage | `bossfight.js:180` |
| `feilsch` (Feilscher) | 0.05 | coins gained per catch | `script.js:780` |
| `feilsch` | 0.05 | aquarium passive coin rate | `aquarium.js:52` |

No talent affects gem gain, gacha odds, or pass points directly.

---

## 8. Ads (`ads.js`), native integration (`native.js`)

Design doctrine (from `docs/WERBUNG-FAIR.md`): **no forced ad between casts**; the catch
moment and the tank-harvest moment are permanently off-limits for ads. Ads are only ever
*offered*, at moments the player already initiated (travel, opening the hub menu), never
gate progress, and the free path is always the louder, faster, default button.

### Gate logic — constants

```js
const Ads = {
  freeCatches: 12,        // first 12 catches of a save: zero ad contact, ever
  contactGapMin: 10,      // minutes — shared cooldown across ALL offer kinds (trip, hub, rescue)
  offerChance: 0.25,      // even when cooldown has elapsed, only 25% chance to actually offer
  rescueMinStreak: 5,     // "save my streak" banner only offered at streak >= 5
  rewardedSeconds: 5,     // placeholder-ad duration in browser (real SDK owns its own timer)
  ...
};
Ads.contactAllowed = () => !premium && save.stats.catches >= freeCatches && (Date.now() - (save.lastAdOffer||0)) >= contactGapMin*60000;
Ads.offerDue = () => contactAllowed() && Math.random() < offerChance;
```

### Two offer triggers (never the catch moment, never the tank harvest)

1. **`Ads.beforeTrip(loc, wechsel, onDone)`** — called from `enterLocation()` (aquarium.js)
   right before switching to a *different* location (`wechsel` = true only on a genuine
   location change, not resuming the same spot via "WEITER ANGELN", and not the first cast
   of a session). Offer: `{ onDone, loc, kind: "reise" }`.
2. **`Ads.onHubOpen()`** — called from `openHub()`. Skips the first hub-open of a session
   (`hubOpens < 2`), otherwise same `offerDue()` roll.

`markContact()` stamps `save.lastAdOffer = Date.now()` and increments `save.adOffersSeen`
(used to gate when the "buy ad-free" line first appears on the gate — not shown on the very
first offer).

### Rewarded placements

| Placement | Reward | Function |
|---|---|---|
| Gate "watch ad" button (travel/hub offer) | `round(80 * tierMult())` coins | `Ads.watchGateAd()` → `Ads.tripCoins()` |
| Daily-bonus ad (max `DAILY_ADS=2`/day) | `round(120 * tierMult())` coins | `progress.js watchAdForBonus()` |
| Streak-rescue banner | restores lost `streak` value | `Ads.acceptRescue()` |

**#15 rule, load-bearing**: `Ads.reward(grant)` calls `grant()` and `saveGame()` **before**
`showRewarded()` runs. If the SDK fails to load, crashes, or drops its callback, the player
still keeps what was promised — the only loss case is an early abandon, which is considered
cheaper than "watched an ad and got nothing."

### Streak rescue

`Ads.offerRescue(streakValue)`: only if `streakValue >= rescueMinStreak`, no gate/current ad
already showing, and `contactAllowed()`. Shows a small non-blocking banner (`rescue = { t, dur: 4.5, streak }`)
that self-dismisses after 4.5s if ignored. Shares the same `contactGapMin` cooldown pool as
the other two triggers.

### Fair-rules UI ordering (drawGate)

1. **Free path** — big filled primary-color button, immediate, no countdown: "Losangeln" /
   "Weiter zum Becken".
2. **Ad offer** — smaller, unfilled, below a "Oder nimm Proviant mit:" label.
3. **Ad-free purchase (0,99 €)** — plain text line, no button chrome, and **only shown from
   the 2nd offer onward** (`save.adOffersSeen >= 2`).

Tapping the backdrop = same as the free path (never swallowed). No blocking countdown
anywhere (the old `gateEvery: 3` / 5s-forced-wait mechanic was removed entirely; comments in
`ads.js` document it as the thing being fixed, not the current behavior).

### Banner ad

Reserved strip at the bottom (`bannerH = 50` CSS px), included in `safeBottom` layout so all
bottom UI (cast button, tab bar, workbench) already accounts for it. `bannerAllowed()` is
false during: premium, intro, story/cutscene, boss fight, dive mode. Native-only — the
browser build reserves no space unless `Ads.bannerDebug = true` (dev visualization).

### No-ads IAP

`save.premium` (bool). Set true by: `Ads.buyPremium()` (web-demo stub), or a real
RevenueCat purchase with product id `"adfree"` resolving to entitlement `"adfree"`
(`Native.buy`/`refreshEntitlements`). When true: `Ads.contactAllowed()` is false,
`Ads.bannerAllowed()` is false, `Ads.showRewarded` auto-succeeds without showing anything.

### `native.js` — Capacitor integration surface (for verbatim port)

Plugin access is via `window.Capacitor.registerPlugin(name)` — no bundler required. Guarded
entirely behind `Native.isNative()`.

```js
const Native = {
  isNative() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); },
  config: {
    admobAppIdIos: "ca-app-pub-3940256099942544~1458002511",   // Google TEST app id — replace before release
    rewardedIos: "ca-app-pub-3940256099942544/1712485313",
    rewardedAndroid: "ca-app-pub-3940256099942544/5224354917",
    interstitialIos: "ca-app-pub-3940256099942544/4411468910",       // defined but unused — no interstitial ad flow in code
    interstitialAndroid: "ca-app-pub-3940256099942544/1033173712",
    bannerIos: "ca-app-pub-3940256099942544/2934735716",
    bannerAndroid: "ca-app-pub-3940256099942544/6300978111",
    revenueCatIos: "appl_XXXXXXXX", revenueCatAndroid: "goog_XXXXXXXX",   // placeholders, must be filled before release
    entitlementAdFree: "adfree",
    productGems: { small: "gems_50", medium: "gems_200", large: "gems_600" }
  }
};
```

**Plugins registered**: `"Haptics"`, `"AdMob"`, `"Purchases"` (RevenueCat).

**Init sequence** (`Native.init()`, called `setTimeout(() => Native.init(), 0)` at load):
1. `Haptics` — rebinds global `window.haptic(pattern)` to `Haptics.impact({ style: strong ? "HEAVY" : "MEDIUM" })` (iOS has no `navigator.vibrate`).
2. `AdMob.initialize({ initializeForTesting: false })`.
3. **Consent, in order, before any ad request:**
   - `AdMob.requestTrackingAuthorization()` (iOS ATT prompt).
   - `AdMob.requestConsentInfo()` → if `isConsentFormAvailable && status === "REQUIRED"`, call `AdMob.showConsentForm()` (UMP/GDPR). Result's `canRequestAds` (default true on error) gates all subsequent ad calls.
4. Listeners: `onRewardVideoAdRewarded` (sets a flag), `onRewardVideoAdDismissed` (fires the pending callback with reward-flag, resets, immediately preloads the next one), `onRewardVideoAdFailedToLoad`, `onRewardVideoAdLoaded` (sets `rewardedReady`).
5. `preloadRewarded()` — `AdMob.prepareRewardVideoAd({ adId })`.
6. **Monkey-patches `Ads.showRewarded`** to route through real AdMob instead of the placeholder timer: if not ready, shows "Anzeige lädt noch" and aborts (no fallback ad); if ready, shows it and forwards success/failure to the original callback.
7. `Purchases.configure({ apiKey: platform==="ios" ? revenueCatIos : revenueCatAndroid })`, then `refreshEntitlements()`, then rebinds `Ads.buyPremium = () => Native.buy("adfree")`.

**Banner**: `Native.setBanner(on)` calls `AdMob.showBanner({ adId, adSize: "ADAPTIVE_BANNER", position: "BOTTOM_CENTER", margin: 0, isTesting: false })` or `hideBanner()`. Driven by `Ads.syncBanner()` whenever the "banner-allowed" scene state changes.

**Purchases** (`Native.buy(productId)`): fetches `Purchases.getOfferings()`, finds the
package matching `productId`, calls `purchasePackage`. On success: `productId === "adfree"`
→ `save.premium = true`; `gems_50/200/600` → `addGems(50/200/600, "Kauf")`; `"seasonpass"`
→ `passState().premium = true`. Web fallback (`!this.Purchases`, i.e. not in the native app):
only `"adfree"` is granted for free as a demo stub, everything else is a no-op.

**Restore**: `Native.restorePurchases()` → `Purchases.restorePurchases()` then
`refreshEntitlements()`.

**Entitlement sync** (`refreshEntitlements`): reads `Purchases.getCustomerInfo()`,
`entitlements.active[entitlementAdFree]` → syncs into `save.premium`.

---

## 9. Share (`share.js`)

### Card layout

Rendered off-screen onto a fresh `900×600` canvas (`renderCatchImage`), independent of the
live game canvas:

1. Background: sky gradient (top 40% height) + water gradient (bottom 60%), colors from
   `getPalette(dayTime)` (time-of-day palette) matching the current location's look, with a
   sine-wave horizon line.
2. Rounded card panel `(90,60)` to `(W-90,H-60)`, dark navy fill `rgba(12,22,40,0.92)`,
   border colored by the catch's rarity (`RARITY[sp.rarity].color`), 5px.
3. Headline (40px bold): "✨ Shiny gefangen! ✨" / "Beifang!" (junk) / "Fisch gefangen!".
4. The fish itself, drawn with the shared `drawFishShape()` renderer at `unit = 95 * min(1, 1.2/sp.len)`, centered at `(W/2, 245)`, with glow/shiny flags passed through.
5. Species name (44px bold, rarity-colored) at y=365.
6. Subtitle (24px): `"{rarity} · {kg} kg · {location name}"` at y=410.
7. Coins earned (38px bold gold): `"+{coins} Coins"` at y=452.
8. Italic silly one-liner in quotes (21px) at y=500 — see texts below.
9. Footer (18px, translucent): `"🎣 A Silly Fishing Game · Fang selbst einen: {SHARE_URL host}"` at H-82.

### Share flow

`shareCatch(info)`: renders the card, converts to a PNG `Blob`, wraps in a `File`. If
`navigator.canShare({ files })` is supported, uses the native Web Share API
(`navigator.share({ files, title, text, url })`) — text combines the one-liner + species +
weight + catch-URL. Otherwise falls back to opening the PNG blob in a new tab (desktop).
Both paths unlock the `"teiler"` achievement. `SHARE_URL = "https://silly-fishing-game.netlify.app"`
(placeholder — "später: Store-Smart-Link").

### Texts (verbatim, DE)

```js
const SHARE_LINES = [
  "Mein Fisch ist größer als deiner. Beweis das Gegenteil.",
  "Während du das liest, beißt bei mir schon der nächste.",
  "Ich angle. Du scrollst. Einer von uns hat Coins.",
  "Petri Heil – oder wie ihr Landratten sagt: wow.",
  "Der See ruft. Du hörst ihn nur nicht, weil du nicht spielst.",
  "Kein Filter. Nur Fisch.",
  "Ich sag nicht, dass ich der beste Angler bin. Der Fisch sagt es.",
  "Dieser Fisch hat eine Familie. Hatte.",
  "10 Minuten Pause, 1 Fisch. Effizienz.",
  "Frag mich, wie. Oder fang selbst einen.",
  "Nicht schlecht für jemanden ohne Boot.",
  "Meine Rute war bereit. Deine liegt noch im Shop."
];
const SHARE_SHINY = [
  "✨ SHINY. Ja, wirklich. Nein, du bekommst ihn nicht.",
  "✨ 1 zu 80. Ich hab’s beim ersten Mal geschafft (Lüge).",
  "✨ Glitzert mehr als deine Zukunft."
];
const SHARE_JUNK = [
  "Manchmal fängt man Fische. Manchmal das hier.",
  "Der See gibt, der See nimmt. Heute gab er Müll.",
  "Umweltschutz zählt auch als Fang."
];
```
An English variant (`SHARE_LINES_EN`, `SHARE_SHINY_EN`, `SHARE_JUNK_EN`) lives in
`trivia_en.js`, selected by `I18N.lang === "en"` inside `shareLine(info)`.

---

## 10. Online leaderboard (`online.js`)

**Offline-first by construction**: `Online.enabled() = !!(this.url && this.key)`. In the
shipped source both are empty strings — the entire online layer is a documented TODO
("Supabase-Projekt anlegen → URL + Publishable Key eintragen"), and every function checks
`enabled()`/`ready` before touching the network. With no config, the overlay shows a static
"coming soon" parchment note and the player's own **local** score.

### Local, always-tracked (no network needed)

```js
function todayScore() { // save.dayScore = { day: todayKey(), coins: 0 }, resets when day rolls over
  if (!save.dayScore || save.dayScore.day !== todayKey()) save.dayScore = { day: todayKey(), coins: 0 };
  return save.dayScore;
}
Online.addScore(n) { todayScore().coins += n; this._dirty = true; } // called from catchFish() with the coins gained
```

### Backend (Supabase, when configured)

- **Auth**: anonymous sign-in (`client.auth.signInAnonymously()`), session persisted by
  Supabase's own client.
- **Push** (`pushScore`, every 30s via `setInterval`, and once right after init, only if
  `_dirty`): RPC `upsert_daily_score(p_day, p_name, p_score, p_level, p_species)` where
  `p_name = save.playerName || "Angler-" + userId.slice(0,4)`, `p_score = today's coins`,
  `p_level = getLevel()`, `p_species = Object.keys(save.dex).length`.
- **Fetch** (`fetchBoard`, called on-demand when the overlay is open, cached 60s): `select
  name,score,level,species from daily_scores where day = today order by score desc limit 20`.

### SQL schema (verbatim, for the rebuild's backend)

```sql
create table public.daily_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  day text not null, name text not null, score integer not null default 0,
  level integer not null default 1, species integer not null default 0, updated_at timestamptz default now(),
  primary key (user_id, day)
);
alter table public.daily_scores enable row level security;
create policy "read all" on public.daily_scores for select to authenticated, anon using (true);
create or replace function public.upsert_daily_score(p_day text, p_name text, p_score int, p_level int, p_species int)
returns void language sql security definer as $$
  insert into public.daily_scores (user_id, day, name, score, level, species)
  values (auth.uid(), p_day, left(p_name, 20), p_score, p_level, p_species)
  on conflict (user_id, day) do update set name = excluded.name, score = greatest(daily_scores.score, excluded.score),
    level = excluded.level, species = excluded.species, updated_at = now();
$$;
```

Board is scoped to **today only** (daily leaderboard, resets every day at the row level via
the `(user_id, day)` primary key — old rows simply age out of the `where day = today` filter,
nothing deletes them).

Client library: `@supabase/supabase-js@2` loaded from `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm` via dynamic `import()` — only fetched when `Online.enabled()`.

---

## 11. Save schema (`shop.js` primarily, fields set across nearly every file)

### Storage

```js
const SAVE_KEY = "fishing-adventure-save-v1";
localStorage.getItem/setItem(SAVE_KEY, JSON.stringify(save));
```
Single `localStorage` key, whole-object JSON blob, no chunking, no schema/version field
anywhere in the payload (`save.version` does not exist). `GAME_VERSION = "0.9.0"`
(`script.js`) is a **display-only** string (shown in settings), never written into or
compared against the save.

### Load/merge strategy — **this is the entire "migration" mechanism**

```js
function defaultSave() {
  return {
    coins: 0,
    owned: { rods: ["holz"], baits: ["wurm"], bobbers: ["classic"], rodskins: ["holz"], hats: ["angler"], outfits: ["klassisch"], harpoons: ["standard"], locations: [] },
    equipped: { rod: "holz", bait: "wurm", bobber: "classic", rodskin: "holz", hat: "angler", outfit: "klassisch", harpoon: "standard" },
    location: "see",
    dex: {},
    inv: {},
    totemTime: {},
    stats: { catches: 0, totalCoins: 0, biggestKg: 0, perfects: 0, rainCatches: 0 },
    achievements: []
  };
}
function loadSave() {
  const data = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
  if (data) {
    save = Object.assign(defaultSave(), data);                          // shallow: any top-level key present in `data` wins outright
    save.owned = Object.assign(defaultSave().owned, data.owned || {});   // owned/equipped/stats get an EXTRA shallow merge one level deeper
    save.equipped = Object.assign(defaultSave().equipped, data.equipped || {});
    save.stats = Object.assign(defaultSave().stats, data.stats || {});
  }
  coins = save.coins;
}
```
**Critically**: only `owned`, `equipped`, `stats` get the second-level merge that backfills
newly-added sub-keys (e.g. a new `owned.newcategory: []` added later would appear even in an
old save missing it entirely). Every *other* top-level object (`dex`, `inv`, `totemTime`,
`quests`, `pass`, `aquarium`, `daily`, `talents`, `rodUpgrades`, `dexRewards`, `seenAch`,
`seenSpecies`, `seenItems`, `storySeen`, `achievements`) is taken **as-is** from the old save
if present, or defaults to nothing at all if absent — **and every accessor function across
the codebase defensively lazy-initializes its own field on first touch**, e.g.:
```js
function invBag(kind) { if (!save.inv || typeof save.inv !== "object") save.inv = {}; if (!save.inv[kind]) save.inv[kind] = {}; return save.inv[kind]; }
function passState() { const id = passSeasonId(); if (!save.pass || save.pass.season !== id) save.pass = { season: id, points: 0, claimedFree: [], claimedPremium: [], premium: false }; return save.pass; }
function aquariumState() { if (!save.aquarium) save.aquarium = { slots: [], extra: 0, stored: 0, lastTick: Date.now(), harvested: 0 }; ... }
function dailyState() { if (!save.daily) save.daily = { last: "", streak: 0, claimed: "", adsDay: "", adsUsed: 0 }; ... }
function totemTimes() { if (!save.totemTime || typeof save.totemTime !== "object") save.totemTime = {}; return save.totemTime; }
```
**This lazy-field-init pattern *is* the versioning strategy** — there is no numbered
migration list to run once; every module is individually responsible for tolerating its own
field being `undefined` on an old save and filling in a sane empty default the first time it
is touched. **For the rebuild: reproduce this pattern (or replace it with an explicit
migration pipeline that produces equivalent results), and the new game must be able to
`JSON.parse` a `fishing-adventure-save-v1` blob shaped exactly as below and continue without
data loss** (per the task's hard requirement). `saveGame()` is called extremely often
(after nearly every state-mutating action) rather than batched/debounced (one exception:
totem countdown ticks write to storage at most once per 3 real seconds, plus immediately on
`visibilitychange` → hidden, to survive app-switch on mobile).

### Full field table

| Field | Type | Default | Meaning | Mutated in |
|---|---|---|---|---|
| `coins` | number | `0` | soft currency; mirror of the global `coins` var, synced in `saveGame()`/`loadSave()` | everywhere (spend/earn sites) |
| `gems` | number | `undefined`→treated as 0 | hard currency | `gems.js`, `events.js`, `pass.js`, `native.js` |
| `owned.rods` | string[] | `["holz"]` | owned rod ids | `shop.js buyOrEquip`, `gacha.js` |
| `owned.baits` | string[] | `["wurm"]` | owned bait ids | same, + `gacha.js` bait roll |
| `owned.bobbers` | string[] | `["classic"]` | owned bobber ids | same |
| `owned.rodskins` | string[] | `["holz"]` | owned rod-skin ids | same, + `pass.js` |
| `owned.hats` | string[] | `["angler"]` | owned hat ids | same, + `progress.js checkDexRewards`, `pass.js` |
| `owned.outfits` | string[] | `["klassisch"]` | owned outfit ids | same |
| `owned.harpoons` | string[] | `["standard"]` | owned harpoon skin ids | same |
| `owned.locations` | string[] | `[]` | unlocked location ids beyond the free starting one | `locations.js selectLocation`, `onBossCaught` |
| `equipped.rod/bait/bobber/rodskin/hat/outfit/harpoon` | string | matches `owned` defaults | currently-worn item id per category | `shop.js buyOrEquip` |
| `location` | string | `"see"` | current/last location id | `locations.js selectLocation` |
| `dex` | `{ [speciesId]: { count, record, shiny? } }` | `{}` | fishdex/species log: catch count, best (max) kg, shiny catch count | `shop.js recordCatch` |
| `stats.catches` | number | `0` | total successful catches (incl. junk) | `shop.js recordCatch` |
| `stats.totalCoins` | number | `0` | lifetime coins earned (all sources) | everywhere coins are granted |
| `stats.biggestKg` | number | `0` | heaviest single catch | `shop.js recordCatch` |
| `stats.perfects` | number | `0` | perfect-drill catch count | `script.js catchFish` |
| `stats.rainCatches` | number | `0` | catches made while raining | `script.js catchFish` |
| `stats.shinies` | number | `undefined`→0 | shiny catch count | `shop.js recordCatch` |
| `stats.gachas` | number | `undefined`→0 | gacha bags opened | `gacha.js updateGacha` |
| `stats.totems` | number | `undefined`→0 | totems activated | `gems.js useTotem` |
| `stats.upgrades` | number | `undefined`→0 | rod upgrades purchased | `shop.js upgradeRod` |
| `stats.quests` | number | `undefined`→0 | daily quests completed (lifetime) | `quests.js questEvent` |
| `stats.adsWatched` | number | `undefined`→0 | rewarded ads completed | `progress.js`, `ads.js` |
| `stats.shots` | number | — | (appears only in grep; likely dive/harpoon shot counter — verify against `dive.js`/`bossfight.js` at rebuild time) | — |
| `achievements` | string[] | `[]` | unlocked achievement ids | `events.js unlockAchievement` |
| `seenAch` | `{ [id]: true }` | lazy `{}` | which unlocked achievements the player has *seen* (badge/"NEU" tracking) | `draw.js`, `events.js` |
| `seenSpecies` | `{ [id]: true }` | lazy `{}` | which dex entries have been *viewed* (badge tracking) | `draw.js` |
| `seenItems` | `{ "tabId:itemId": true }` | lazy `{}` | which owned cosmetics have been *viewed* (badge tracking) | `draw.js` |
| `level` | number | `1` (via `getLevel()` fallback) | player level | `progress.js addXP` |
| `xp` | number | `0` (via `getXP()` fallback) | XP progress toward next level | `progress.js addXP` |
| `talents` | `{ [talentId]: rank(0-5) }` | lazy `{}` | talent ranks | `talents.js learnTalent` |
| `rodUpgrades` | `{ [rodId]: level(0-10) }` | lazy `{}` | per-rod upgrade level | `shop.js upgradeRod` |
| `dexRewards` | `{ "[locId]:50"/"[locId]:100": true }` | lazy `{}` | claimed dex-completion rewards per location | `progress.js checkDexRewards` |
| `inv.totem` | `{ [totemId]: count }` | lazy `{}` | totem inventory (bought, not yet used) | `inventory.js invAdd/invTake`, `gems.js buyTotem` |
| `totemTime` | `{ [totemId]: secondsRemaining }` | lazy `{}` | active totem countdowns (game-time seconds) | `gems.js useTotem/updateTotems` |
| `daily.last` | string (`Y-M-D`) | `""` | date of last claim-eligible login | `progress.js` |
| `daily.streak` | number | `0` | consecutive daily-login streak | `progress.js claimDaily` |
| `daily.claimed` | string (`Y-M-D`) | `""` | date the streak reward was last claimed | `progress.js claimDaily` |
| `daily.adsDay` | string (`Y-M-D`) | `""` | date `adsUsed` applies to (resets on day change) | `progress.js dailyState` |
| `daily.adsUsed` | number | `0` | rewarded-ad daily-bonus claims used today (max `DAILY_ADS=2`) | `progress.js watchAdForBonus` |
| `quests.day` | string (`Y-M-D`) | — | date the current 3 quests were generated for | `quests.js ensureQuests` |
| `quests.list` | array of quest objects (see §3) | — | today's 3 quests + progress | `quests.js` |
| `pass.season` | string (`YYYY-MM`) | — | season id the pass state belongs to (auto-resets monthly) | `pass.js passState` |
| `pass.points` | number | `0` | accumulated season-pass points | `pass.js addPassPoints` |
| `pass.claimedFree` | number[] | `[]` | claimed free-track tiers | `pass.js claimPass` |
| `pass.claimedPremium` | number[] | `[]` | claimed premium-track tiers | `pass.js claimPass` |
| `pass.premium` | bool | `false` | premium track purchased | `pass.js buyPass`/`native.js buy("seasonpass")` |
| `aquarium.slots` | string[] (species ids) | `[]` | fish currently on display in the tank (auto-filled with highest-value known species up to capacity) | `aquarium.js aquariumState` |
| `aquarium.extra` | number | `0` | extra tank slots purchased (0..6, base 6 + extra, capped at 12) | `aquarium.js buyTankSlot` |
| `aquarium.stored` | number | `0` | accumulated un-harvested passive coins | `aquarium.js updateAquarium/harvestAquarium` |
| `aquarium.lastTick` | number (ms epoch) | `Date.now()` | last time passive income was accrued (real-world time, works offline) | `aquarium.js updateAquarium` |
| `aquarium.harvested` | number | `0` | lifetime coins harvested from the tank | `aquarium.js harvestAquarium` |
| `aquarium.decor.ground` | string | `"kies"` | equipped `TANK_GROUNDS` id | `aquarium.js buyDecorItem` |
| `aquarium.decor.back` | string | `"schlicht"` | equipped `TANK_BACKS` id | same |
| `aquarium.decor.owned` | string[] | `["pflanzen"]` | owned `TANK_DECOR` ids | same |
| `aquarium.decor.slots` | (string\|null)[4] | `["pflanzen",null,null,null]` | which decor item occupies each of the 4 display slots | same |
| `aquarium.decor.ownedSets` | string[] | — | ownership for ground/back purchases (reuses `buyDecorItem` with `list !== TANK_DECOR`) | same |
| `dayScore.day` | string (`Y-M-D`) | — | date the local leaderboard score applies to | `online.js todayScore` |
| `dayScore.coins` | number | `0` | coins earned today (for the daily leaderboard) | `online.js addScore` |
| `storySeen` | `{ [chapterId]: true }` | lazy `{}` | which story cutscenes have played | `story.js` |
| `premium` | bool | `undefined`→falsy | ad-free purchased | `ads.js buyPremium`, `native.js buy("adfree")`/entitlement sync |
| `lastAdOffer` | number (ms epoch) | `0` | timestamp of the last ad offer shown (any kind) — drives the 10-min cooldown | `ads.js markContact` |
| `adOffersSeen` | number | `0` | lifetime count of ad offers shown — gates when the ad-free purchase line first appears | `ads.js markContact` |
| `playerName` | string | `undefined`→auto `"Angler-XXXX"` | display name for the online leaderboard | (no in-game editor found in read files — likely set elsewhere or left to the fallback) |
| `lang` | `"de"` \| `"en"` | `undefined`→browser/i18n default | UI language | `progress.js drawSettings`, `i18n.js` |
| `music` | bool | `undefined`→treated as `true` (`save.music !== false`) | music toggle | `music.js Music.toggle` |
| `muted` | bool | `undefined`→falsy | sound-effects mute | `progress.js drawSettings` |
| `seenSonar` | bool | `undefined`→falsy | one-time sonar-tutorial-seen flag (dive mode) | `mechanics.js` |
| `onboardRare` | bool | `undefined`→falsy | one-time "first rare fish" onboarding toast seen flag | `script.js` |
| `shopOpened` | bool | `undefined`→falsy | one-time "shop discovered" onboarding flag | `script.js openOverlay`, `draw.js` |
| `gfx` | number (0-3) or absent | absent = AUTO | manually-pinned render-quality tier (dev/diagnostic; absent = automatic) | `progress.js drawDiag` |
| `gfxDpr` | number (0/1.5/2) or absent | absent = device default ("Scharf") | player-facing display-sharpness setting | `progress.js drawSettings` |
| `gfxDiag`, `gfxPfadAB`, `gfxAutoNull`, `gfxAuto` | various | — | internal render-pipeline diagnostic/benchmark state (`world.js`), not gameplay | `world.js` |
| `wache` | object, keyed by screen-size bucket | lazy `{}` | perf-benchmark ("Wache") reference measurements, dev-only tooling | `bench.js` |

**Not economy-relevant but present**: `gfx*`/`wache` fields are rendering/perf diagnostics
tied to the old Phaser/canvas renderer internals (tier auto-switching, upload-path A/B
testing). They should **not** be ported 1:1** into a new renderer's save format — they exist
only because the old game self-benchmarks on-device; a rebuild should design its own
performance-settings persistence if needed, but must still tolerate these keys being present
in an imported old save (ignore unknown fields rather than reject the whole blob).

---

## 12. Dev cheats

Two independent mechanisms, both **desktop/keyboard only** (unreachable on a phone by
design):

### Diagnostic mode toggle (`perf.js`, `Dev` object)

- URL param `?dev=1` → `Dev.an = true`, persisted to `sessionStorage["devAn"]` (session-only,
  not part of `save`).
- Or: **tap the version-number line 5 times within 2 seconds each** (in Settings) → toggles
  `Dev.an`.
- `Dev.an = true` reveals extra rows in Settings ("Bildzeit"/frame-time toggle, "Diagnose"
  menu) and unlocks the `Diagnose` overlay: per-effect render toggles (bloom, caustics,
  refraction, reflections, sparkle, turbidity), render-path switches (direct/copy/refresh
  compositing, MSAA, world/UI DPR overrides), fixed frame-rate divisor, and three built-in
  benchmark runners ("Wache" ~25s baseline, "Duell" ~60s A/B, "Schreiber" ~50s per-frame
  logger). **None of this affects gameplay economy** — it's a performance-measurement panel,
  reproduced here only because the task asked for "dev cheats" exhaustively.

### Keyboard cheats (`script.js`, inside the global `keydown` handler, Shift held)

```js
if (e.code === "KeyG" && e.shiftKey) { coins += 1000; saveGame(); }                    // +1000 coins
if (e.code === "KeyL" && e.shiftKey) { addXP(xpToNext(getLevel()) - getXP(), ...); }    // instant level-up (tops off XP to the next threshold)
if (e.code === "KeyJ" && e.shiftKey) { save.gems = (save.gems||0) + 10; saveGame(); }   // +10 gems
if (e.code === "KeyI" && e.shiftKey) { showRenderInfo = !showRenderInfo; Perf.hud = showRenderInfo; if (showRenderInfo) Dev.an = true; } // toggle frame-time HUD + dev mode
if (e.code === "KeyD" && e.shiftKey) { // complete the fishdex for the CURRENT location only
  for (const sp of speciesForLocation(getLocation().id)) if (!sp.boss)
    save.dex[sp.id] = save.dex[sp.id] || { count: 1, record: sp.kg[0] };
  checkDexRewards(); saveGame();
}
```
No cheat exists for instantly unlocking a location, granting a specific cosmetic, or
resetting the save — those would need to be done by editing `localStorage` directly.

---

## 13. Pure logic (portable) vs. renderer-bound (UI-only)

### Pure logic — portable as-is to a new engine (data in, data/save mutation out, no canvas)

| Function | File | Purpose |
|---|---|---|
| `xpToNext(level)`, `xpForCatch(sp,perfect,shiny)`, `addXP(amount,x,y)` (minus the popup/FX calls) | `progress.js` | level curve, XP gain, level-up loop |
| `progressTier()`, `tierMult()` | `progress.js` | location-count-based reward scaling |
| `anglerTitle()` | `progress.js` | title lookup |
| `dailyState()`, `dailyReward()`, `claimDaily()` (minus FX), `adBonusAmount()` | `progress.js` | daily bonus math |
| `checkDexRewards()` (minus toast) | `progress.js` | 50%/100% dex reward payout |
| `todayKey()`, `seeded(str)`, `ensureQuests()`, `questEvent(ev)` (minus FX) | `quests.js` | quest generation + progress + payout |
| `passSeasonId()`, `passPointsForTier(t)`, `passTier()`, `addPassPoints(n,fromXP)`, `passReward(tier,premium)`, `claimPass(tier,premium)` (minus FX) | `pass.js` | season pass state machine |
| `talentRank(id)`, `talentMult(id,per)`, `skillPoints()`, `learnTalent(t)` (minus FX) | `talents.js` | talent tree |
| `getGems()`, `addGems(n)` (minus FX), `spendGems(n)` | `gems.js` | gem currency |
| `rollGacha(item)` (the RNG/branch logic; payout-application is one line each) | `gacha.js` | gacha drop table |
| `buyOrEquip(tab,item)` (minus sound/FX), `isOwned`, `isEquipped`, `rodUpgradeLevel`, `rodUpgradeCost`, `getRod/getBait/getBobber/getRodSkin/getHat/getOutfit/getHarpoonSkin` | `shop.js` | shop purchase/equip state |
| `recordCatch(species,kg,shiny)`, `dexDiscovered()` | `shop.js` | dex bookkeeping |
| `pickSpecies()` (RNG weighting only — depends on `getBait()`, `daylight()`, totem/talent state, but no drawing) | `fish.js` | catch species roll |
| `catchFish()`'s **reward math** (`base`, `gained`, `mult` calc, XP/quest/dex/pass dispatch) — separable from the FX calls interleaved in the same function | `script.js` | core coin/XP payout on catch |
| `streakMultiplier()` | `events.js` | streak coin multiplier |
| `isLocationOwned(loc)`, `selectLocation(loc)` (minus transition FX) | `locations.js` | location purchase/travel gate |
| `bossFor(locId)`, `bossUnlocked(locId)`, `onBossCaught(sp)` (minus FX) | `locations.js` | boss unlock/reward |
| `aquariumState()`, `tankCapacity()`, `tankSlotCost()`, `tankRatePerHour()`, `tankCap()`, `updateAquarium()`, `harvestAquarium()` (minus FX), `buyTankSlot()` (minus FX) | `aquarium.js` | passive tank income |
| `invBag/invCount/invTotal/invAdd/invTake/invList` | `inventory.js` | generic owned-item bag |
| `totemTimes/totemRemaining/runningTotems/totemFraction/useTotem(minus FX)/updateTotems` | `inventory.js`/`gems.js` | totem countdown state machine |
| `unlockAchievement(id)` (minus toast/sound), `checkAchievements()`, `ACHIEVEMENTS[].check` predicates | `events.js` | achievement evaluation |
| `Ads.contactAllowed/markContact/offerDue/tripCoins/reward(grant)` (the grant-then-show ordering) | `ads.js` | ad-gate cooldown & reward-first guarantee |
| `Online.todayScore/addScore/pushScore/fetchBoard` (network calls, but no rendering) | `online.js` | leaderboard sync |
| `loadSave()/saveGame()/defaultSave()` | `shop.js` | persistence |

### Renderer-bound — UI-only, name + what data they show (re-implement in the new engine's UI toolkit; do not port pixel-for-pixel)

| Function | File | Shows |
|---|---|---|
| `drawGacha()` | `gacha.js` | wobbling-bag-then-reveal-card gacha animation; result kind, icon, reward text |
| `drawTotemShop(x,y,w,h,s,narrow)`, `drawGemShop(...)` | `gems.js` | totem/gem-package shop rows: icon, name, price/gem-cost, active-ring timer, buy button |
| `drawLevelUp()` | `progress.js` | level-up modal: new level, title, coin/gem/talent-point reward, newly-unlocked location teaser |
| `drawDaily()` | `progress.js` | 7-day streak strip, claim button, ad-bonus button with remaining count |
| `drawSettings()`, `drawDiag()` | `progress.js` | sound/music/language/sharpness toggles; dev-only render diagnostics grid |
| `drawXPBar()` | `progress.js` | (legacy/unused fallback) small XP bar overlay |
| `drawQuests()` | `quests.js` | 3 quest rows: icon, text, progress bar, reward, countdown-to-reset header |
| `drawChestIcon/drawCoinStack/drawTotemIcon/drawPassRewardIcon` | `pass.js` | hand-drawn reward icons (chest/coins/totem-orb) for the pass track |
| `drawPass()` | `pass.js` | vertical scrolling free/premium tier track, progress column, claim buttons |
| `drawTalents()` | `talents.js` | 7 talent rows: icon, name, description, rank pips, learn button, points-available banner |
| `Ads.drawRescue/drawGate/drawRewarded/drawBannerArea` | `ads.js` | streak-rescue banner; travel/hub ad-offer modal; placeholder rewarded-ad screen with countdown ring; debug banner-area outline |
| `renderCatchImage(info,line)`, `shareCatch(info)` | `share.js` | off-screen share-card composition and OS share-sheet invocation |
| `drawLeaderboard()` | `online.js` | daily leaderboard rows / "coming soon" parchment note / "connecting…" state |
| `drawCaseFrame/drawInventory/drawCaseClutter/drawCaseBait/drawCaseHook/drawCaseSpool/caseBrass/caseWell/caseButton` | `inventory.js` | the "tackle case" inventory overlay: metal case chrome, owned-bait clutter texture, totem "drawer" rows with ring-timers and Einsetzen/"Am Wasser" buttons |
| `drawTotemRing(t,cx,cy,r)`, `totemTimeLabel(sec)` | `inventory.js` | per-totem countdown ring + `"1:42"`/`"42s"` label formatting |

Everything in the right column reads state that the left column already owns (`save`, the
`TOTEMS`/`TALENTS`/`QUEST_TEMPLATES`/`GACHA` catalogs, etc.) and can be redrawn with any UI
framework without touching the underlying rules.
