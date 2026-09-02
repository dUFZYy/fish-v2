# 05 — UI, Hub/Aquarium & Story: Rebuild Specification

Source: `C:\Users\duf73\Desktop\claude projekte\fishing-game` (old Canvas2D/HTML5 game).
Canvas reference frame throughout: **W×H = 390×844** (portrait phone), unless noted.
This document is exhaustive by intent — it documents an existing implementation for a
1:1 rebuild on a different UI layer (e.g. DOM/CSS, or Phaser). Quoted code, colors,
numbers and German/English texts are copied verbatim from the source.

> Note on i18n: translation in the old game is **not** per-sentence. It monkey-patches
> `fillText`/`strokeText`/`measureText` and does longest-key-first **substring**
> replacement against a flat dictionary (§6). Short UI labels translate cleanly;
> long narrative sentences (story subtitles, §8) mostly do **not** have dictionary
> entries and therefore stay in German even when the language is set to English,
> except for isolated words that happen to be dictionary keys with matching word
> boundaries. This is a real, observable quirk of the old build — decide deliberately
> whether the rebuild should reproduce it or actually translate those sentences.

---

## 1. Screen inventory

*(Populated from `draw.js`/`inventory.js` analysis — see per-screen subsections below.
Canvas is 390×844 unless stated. "Overlay" = the wood bottom-sheet/hanging-tablet system
described fully in §2; screens built on `drawOverlayFrame` inherit its open/close motion,
handle bar, tabs-on-a-rail, and dismiss-by-tapping-outside behavior unless noted otherwise.)*

### 1.0 Shared overlay chrome (`drawOverlayFrame`, `overlayRect`, `overlayContentNeed`)

All eleven "overlay" screens (Shop, Fishdex, Map, Daily Bonus, Quests, Achievements,
Leaderboard, Pass, Talents, Settings, Decorate) share one presentation system:

- **Container**: a wood tablet (`Wood.panel` + battens for large panels), full width minus
  margins, height **content-driven**: `overlayTargetH()` sums header + angler-status block
  (where present) + tab rail, clamped between **240px** and the old fixed max (804px on
  a 390×844 screen — 804 = 844 − 40 top margin). `overlaySheetH` eases toward that target:
  instantly on open, over **~8 frames (≈130ms)** on a tab switch within the same overlay.
- **Anchor / motion** ("a piece of furniture moves out of the edge it's mounted on"):
  - **Mobile**: the tablet is a bottom sheet, bottom-aligned (`y = canvas.height - h`).
    It slides **up from the bottom edge**. Open: `overlayAnim += 0.08/frame` → ~12.5
    frames ≈ **200ms**; travel formula `Δy = (h + 24) · (1 − (1 − t)³)` (cubic ease-out)
    **plus a 5px overshoot** in the second half via a half sine wave, so the panel
    audibly/visually "sets down" once instead of sliding to a stop. Close: `+0.15/frame`
    → 7 frames ≈ **110ms**, quadratic ease-in, **no** overshoot.
  - **Desktop**: the tablet hangs from two ropes (`Wood.rope`, drawn in
    `drawOverlayFrame`) at the top and **rolls down** from the top edge (a "roller
    blind" with a wood roller at the leading edge) instead of sliding up.
  - Hit-testing follows the animation: `drawOverlayLayer` snapshots `hitButtons.length`
    before drawing overlay content and shifts every button pushed afterward by the same
    offset the panel moved — so a tap mid-animation always hits what's visually there.
  - Leading-edge material varies by content and casts a soft shadow **upward** onto the
    dimmed scene behind it (readable as "this is sliding in front of"): Fishdex = three
    stacked page-edges, Shop = a brass clasp, everything else = a plain light edge.
- **Header row**: menu icon (from `icons.js`) pinned to a parchment note (`Wood.paper`,
  slightly tilted), title in chalk-style lettering (`Wood`'s ink-on-coat styling, ~0.5°
  rotation), a hand-drawn accent divider line with gaps, currencies (coins/gems) on the
  right, a "✕" wood close-sign top-right.
- **Tab rail**: two placements depending on what the tabs do (a rule, not a per-menu
  choice):
  - **Page-switching tabs** (Daily-Bonus-group, Angler-group, Decorate) live on a
    **grip rail fixed to the bottom edge of the screen** — a nailed wooden batten with a
    dark seam and light edge that never moves, regardless of sheet height, so switching
    tabs never relocates the tab row itself. This is what lets the sheet height be
    content-driven without the tab row jumping around.
  - **List-filtering tabs** (Shop's 10 categories, Fishdex's 6 location tabs) stay **at
    the top of the content**, inside the sheet, because they filter a list that already
    fills the tablet (96–100%) — moving them would gain nothing.
- **Dismiss**: tapping outside the panel (on the dimmed background) closes it, active
  from about the halfway point of the open animation onward.
- **Background visibility**: the world (hub room or fishing spot, whichever was open)
  stays rendered underneath at reduced brightness — a dark overlay wash, not full-screen
  replace; the world is paused (`worldPaused()`, §7) while any overlay is open.
- **Content-height table** (390×844, one specific measured game state — heights vary
  with player progress and language, see below):

| Menu / tab | Sheet height | Screen fraction | Content fill |
|---|---:|---:|---:|
| Rewards → Bonus | 490 px | 58% | 99% |
| Rewards → Quests | 486 px | 58% | 99% |
| Rewards → Pass | 804 px | 95% | 100% |
| Angler → Talents | 774 px | 92% | 99% |
| Angler → Achievements | 804 px | 95% | 100% |
| Angler → Leaderboard | 406 px | 48% | 99% |
| Settings | 430 px | 51% | 95% |
| Map | 712 px | 84% | 96% |
| Shop | 804 px | 95% | 98% |
| Fishdex | 804 px | 95% | 100% |
| Decorate → Decor | 732 px | 87% | 99% |
| Decorate → Fish (1 species known) | 240 px | 28% | — |
| Decorate → Fish (empty) | 248 px | 29% | — |

  Fresh-save (level 1, 0 coins, empty dex, empty tank, pass tier 0, no achievements)
  heights: Decorate/Fish **248**, Leaderboard **406**, Settings **430**, Bonus **490**,
  Pass **804** (Pass and Achievements/Shop/Fishdex/Talents always claim "take everything"
  — they compute their row count from available height instead of a fixed content size).
  Minimum sheet height anywhere: **240px**.

### 1.1 HUD (drawn over the fishing-spot scene, not an overlay)

Canvas sizing note: `canvas.width/height` are the live viewport in px; `isNarrow() =
canvas.width < 700` selects the phone layout (this doc's 390×844 reference); `uiScale()`
(desktop only) = `clamp(min(w/1100, h/650), 0.85, 1.3)`, fixed `1.0` on phone.

**Status card** (top-left, `drawCoinDisplay`, `hudTop()=16+safeTop`): position `x=16,
y=hudTop()`, size `HUD_CARD_W() × 64`. `HUD_CARD_W()` = in hub `min(196, canvas.width-130)`;
in-game `min(isNarrow()?250:280, canvas.width-32-GEAR_CHIP_W()-10)`. Whole card is one
button → `openOverlay("talents")` (fx `"hud:karte"`). Wood-backed panel, 12px radius.
- Row 1 (y=top+19): hand-drawn coin icon (r=10, see below) + coin count (`#ffd700` bold
  19px) at `x+36`; gem icon (r=8) + gem count (`#9fe3ff` bold 16px) immediately after
  (width measured dynamically); outside the hub, a clock glyph on the right — sun w/ 8
  rays (`#ffd23a`, day), half-sun (`#ff9a5c`, dusk), or moon w/ dark crescent bite
  (`#e9edff`, night) — plus `HH:MM` (rounded to nearest 10 min), white 90%, bold 13px.
- Divider: 1px dark (`rgba(20,10,4,0.5)`) + 1px light (`rgba(255,225,180,0.09)`) line at
  `top+34/35` ("a carved notch in the wood").
- Row 2: level chip (circle r=10, gradient `#a9e0ff→#4aa3ff`, dark-navy number) + angler
  title (`anglerTitle()`, bold 12px, 92% white) + right-aligned `"{xp} / {xpToNext} XP"`
  (10px, 50% white). A 3px XP bar sits on the card's bottom edge (fill gradient
  `#8fd3ff→#4aa3ff`).
- Skill-point badge: green circle (`#3ad46a` r=9) top-right corner of the card, shown only
  when `skillPoints()>0`.
- Hand-drawn coin icon (`drawCoinIcon`, used everywhere, deliberately **not** an emoji —
  emoji coin color/shape differs by OS): base `#a8720a` circle, radial-gradient face
  `#fff3b6→#ffd23a→#dc9d05`, dark outline, inner ring `rgba(150,92,0,0.55)`, a "¢" glyph,
  soft highlight ellipse.

**Gear chips** (top-right, `drawGearChips`, hidden while `overlay`/`Intro.active`/
`hubScreen`): two stacked `Wood.sign` boards, `w=GEAR_CHIP_W()` (122 phone / 140 desktop)
× `h=44`, right-aligned `x=canvas.width-16-w`. See §7.11's HUD-column rework rationale
(same width/height/left-edge as the "Menü" board — a fixed, deliberate group of exactly
two boards, "one path, one display," so nothing else is ever added here).
1. **"Menü" board** (top, `y=hudTop()`): 2-nail sign, `tank` icon, label "Menü"/"Menu"
   (bold 16px `#f5ecd8`) → `openHub()`. Dims to 45% alpha while `hubBlocked()` (see §9.1
   fishing-state exceptions). Carries a `map`-kind marker if a new location is reachable.
2. **Gear board** (below, `y+8`): current **rod** name (+`"+N"` upgrade suffix, a small
   pulsing gold up-arrow if an affordable upgrade exists) on one line, current **bait** on
   the next — or, in dive mode, just the current **harpoon** on a single centered line.
   Tap → opens Shop on that item's tab. Icon at `x+16`, text from `x+29`, kerned against
   the *actual* remaining width (a fixed truncation bug — old code clipped against the
   wrong constant and produced "Poseidons Ru⬆").

**Status chips row** (`drawStatusChips`, events.js — fishing-spot only, below the status
card, see §7's cross-reference): one row of pill chips, `CHIP_H=28`, showing (in order)
running totems (icon-in-ring + countdown text), rain/golden-hour weather flags (only
outside deep sea), the catch streak (`flame` icon + `"Serie {n} · ×{mult}"`), and a dimmed
`"Vorrat ×{n}"` stock chip if totems are owned but none running. First row ends before the
gear-chip column (`colLeft = canvas.width-16-GEAR_CHIP_W()-10`); further rows use the full
width. Every chip with totem/stock content is tappable (44px hit height) → opens the
tackle box (§1.5).

**In-play, world-anchored overlays** (not persistent chrome, shown only during specific
game states):
- `drawAimHelper`: dashed trajectory arc + translucent lure-radius circle + crosshair
  while aiming a cast.
- `drawBiteAlert`: a bouncing "!" (bold 40px gold `#ffd23a`, dark stroke) above the
  bobber, a countdown ring `#ffd23a→#ff5a3a`, and "KLICK!"/"TAP!" text.
- `drawReelMinigame` (the drill panel): `w=min(canvas.width-32,560s)`, `h=168s`, centered,
  bottom-anchored. Wood/glass panel, border color state-dependent (`#ff4040` fleeing,
  `#ff8c00` high tension, `#5ad46a` holding); a full-screen red pulse flash during a
  "burst" (fish makes a run). Header label cycles through **"HALTEN zum Einholen"/"Halten"**,
  **"Achtung…"**, **"Einholen…"**, **"ZIEHT! LOSLASSEN!"**, and boss-only directional
  strings **"◀ ZIEHT LINKS – rechts tippen!"** / **"ZIEHT RECHTS – links tippen! ▶"**.
  Progress bar (green gradient, labeled "Einholen"/"Reel", small net icon riding the
  fill, glow near completion); tension bar below (`#5ad46a→#ffb347→#ff3b30`, labeled
  "Spannung"/"Tension", red danger zone in the last 20%, pulsing outline above 80%). Boss
  mode adds a giant pulsing directional emoji (👉/👈) at the screen edge + "hier tippen".

### 1.2 Bottom action bar (fishing spot)

**Phone**: 3 equal buttons at `y=bottomBarY() = canvas.height-safeBottom-12-44`, each
`w=(canvas.width-32-16)/3, h=44`: **Fischdex** (`book` icon) → `openOverlay("dex")`;
**Shop** (`tacklebox` icon) → `openOverlay("shop")`; **Bonus** (`gift` icon) →
`openOverlay("daily")`. Dark fill `rgba(0,0,0,0.55)`, bold 13px labels, badge marks.
**Desktop**: same 3 buttons in a row beside the status card, width clamped 88–132px. (This
supersedes an even older 4-button bar with a "Becken" entry — see §7's rework notes; the
Hub is no longer reached from this bar at all, only via the "Menü" gear-chip board.)

**Cast button** (`drawCastButton`): near-full-width nailed `Wood.sign`,
`w=min(canvas.width*0.4,320), h=max(44, canvas.height*0.06)`, centered horizontally,
`y=min(canvas.height*0.85, canvas.height-h-40-safeBottom)`. Label **"Auswerfen"**/"Cast"
(rod icon), gold `#ffd23a` bold 20px with a dark drop shadow, 4 nails.

### 1.3 Shop (overlay `"shop"`, accent `#ff8c00`, icon `tacklebox`)

Tabs (top of content, not the bottom rail — filters a list rather than switching pages,
same exception as Fishdex, see §1.0): 10 categories — rods, baits, bobbers, hats, outfits,
rod-skins, harpoons, gacha, totems, gems — a segmented control at `(x+24s, y+62s)`,
`w-48s × 34s`; phone shows icon-only, desktop shows icon+label; badge = unseen-item count
per tab. The `harpoons` tab shows a locked banner (`Wood.inset`, tinted `#4aa3ff`) —
**"🔒 Nur in der Tiefsee – ab Level {N}"** — until the deep-sea location is owned; items
stay browsable but not purchasable.

Item rows: height `(narrow?84:78)s`, `Wood.inset` cell, tinted orange
(`#ff8c00`/`rgba(255,140,0,0.55)`) when currently equipped. Preview graphic
(`drawItemPreview`, per-category renderer — rod skins as a diagonal patterned line, hats
on a small head circle, outfits as a mini figure, harpoons as an angled barbed shaft,
rods via `drawRodPreview`: tapered shaft, teleskope segment lines if applicable, 3
accent rings, cork grip, reel disc, and a range bar showing base+upgrade radius). Name
bold `(narrow?15:17)s`; description wrapped to 2 lines, 65%-white, `(narrow?11:13)s`. Red
"NEU" pill badge on unseen owned items.

Action button (`bw=(narrow?84:130)s, bh=38s`), 6 states: locked-category (🔒, disabled);
equipped rod with an upgrade available (**"⬆ +{n+1} · {cost}"**, `#ffb347` fill); equipped
otherwise (**"✔ Aktiv"/"✔ Ausgerüstet"**, green `rgba(90,220,110,0.25)`); owned-not-equipped
(**"Nutzen"/"Ausrüsten"**, translucent white); gem-priced (cyan `#4fc3f7`, gem icon+price);
`price<0` exclusive/unlock-gated (**"Exklusiv"**, 🔒, taps show the unlock condition as a
toast); normal price (orange `#ff8c00` if affordable, else disabled grey, coin icon+price).

Pagination: `‹`/`›` 44×36 + **"Seite N / M"**/"Page N / M" bold 13px, shown only when
content overflows one page (page-count math deliberately avoids a spurious empty 2nd page).

**Gacha sub-shop** ("Wundertüte"): intro line **"Was drin ist, weiß nur der See. Jackpot
inklusive."**, a legally-required odds-disclosure line (App Store guideline 3.1.1),
verbatim: **"Chancen: Coins ~60 % · Köder 12 % · Skin 12 % · nichts 14 % · Jackpot 1,2 %
(Gold: Skin 35 %, Jackpot 3 %). Nur mit Coins, nie mit Echtgeld."** Rows: 36px icon, name,
desc, orange price button. Footer: **"Bisher geöffnet: {n}"**.

### 1.4 Fischdex (overlay `"dex"`, accent `#4aa3ff`, icon `book`)

Title (narrow) **"Fischdex {n}/{total}"**; (wide) **"Fischdex – {n} / {total} entdeckt"**.
Location tabs at the top of content (same top-of-content exception as Shop): one per
location, icon-only (phone) or `"{icon} {n}/{total in that location}"` (desktop); badge =
unseen species per location.

Grid: `cols=narrow?2:4, rows=narrow?4:3` → 8/page phone, 12/page desktop. Cell:
`cw=(w-48s-gap*(cols-1))/cols, ch=min(150s, remaining/rows), gap=(narrow?8:12)s`. Each
cell is a `Wood.inset` tinted with the species' rarity color once discovered; the fish is
rendered centered-upper via the shared `drawFishShape` (silhouette + 50% alpha if
undiscovered); name below (species name if discovered, else **"???"** at 40% white);
sparkle icon top-right if a shiny variant was caught; "NEU" badge top-right if
discovered-but-unseen; info line beneath the name — discovered: `"{n}× · {record}kg"`
(narrow) / `"{RarityName} · {n}× · Rekord {record} kg"` (wide); undiscovered:
**"Nur nachts…"** for night-only species, else the (dim) rarity name. Cells are
individually tappable (fx `"dex:"+id`) → detail modal.

Footer: `‹`/`›` nav + "Seite N/M" and a stats line **"{catches} Fänge · Größter Fang
{kg} kg"**.

**Detail modal**: full dark scrim `rgba(0,0,0,0.45)` (tap-outside closes), a parchment
"book page" panel (`Wood.panel`+`Wood.paper`) centered, `min(pw-24s,460s) ×
min(ph-24s, narrow?400s:350s)`. Large fish render (silhouette if undiscovered); species
name (rarity-colored with an ink outline, or dim **"???"**); rarity+location line;
size/depth line — **"nahe der Oberfläche"** / **"am Grund"** / **"mittlere Tiefe"**, plus
**"🌙 nur nachts"** if applicable; body text = species trivia if caught, else a discovery
hint: **"Noch nicht gefangen. Suche {depth}{, nachts}. – {locations}. {Besserer Köder
erhöht die Chance if rare+}"**. Stats footer if caught: **"{n}× gefangen · Rekord {kg} kg
{· N× Shiny}"**. Close via a 34×30 "✕" or tap-outside.

### 1.5 Inventory / "Angelkoffer" (tackle box) — overlay `"inventar"`, title "Vorrat"

**Not a grid inventory** — a single-column vertical list of **totem** rows (the only
possessable "kind" implemented today; `save.inv.<kind>.<id>=count` is a generic bag
pattern with `fisch`/`zutat` stubbed for future use, per code comments). No equip system,
no drag-and-drop, no per-item rarity border colors (totems use a per-item `tint`,
default `#ffd23a`, only for the ring-timer color).

**Case chrome** (`drawCaseFrame`) — deliberately **brushed metal, not wood**, so material
alone signals "somewhere" (wood room) vs. "carrying something" (metal case): shell
gradient `#3a4a59→#26323d→#18212a` with a brushed horizontal-line texture; rim/lid band
(`#5d7284→#3c4c5b`); an arched carrying-handle stroke `#1b232b` with two brass mounts; two
brass latches at 20%/80% of the lid-edge width; triangular brass corner protectors; rivets
every 74px down both sides (`#8e9caa` + white highlight dot); a brass 40×40 nameplate
(`orb` icon) with engraved-look title text (`ink #dbe6ef`); the same coin/gem currency
readout style as wood overlays; a brass "✕" close button. Full color table:
```
shellTop #3a4a59  shellBot #18212a  rim #5d7284  rimLight #a7bccd  seam #0d1319
well #161e26  wellDeep #090d12  brass #c9a24a  brassLight #f2dc9c  brassDark #7a5f22
ink #dbe6ef  inkDim rgba(219,230,239,0.62)
```

**Row layout**: `invRowH = (narrow?80:72)s`. Each owned/running totem type gets one row —
a routed-edge compartment (`caseWell`, `ww=w-56s, wh=rowH-16s` at `wx=x+28s`) containing:
the totem icon with a drop-shadow ellipse ("sits *in* the compartment"); a ring-timer
overlay if running (`drawTotemRing`); name (bold 15px) + `"×N"` if count>1; a status line
(running: green **"Läuft – noch {mm:ss}"**; idle: the item's flavor description, 11.5px);
an action button (`bw=(narrow?92:124)s, bh=38s`).

Button, 3 mutually exclusive states: **running** → disabled, shows remaining time
(`"1:42"`/`"42s"`), color `#8ee89a`; **idle, in the Hub** → **"Am Wasser"**/"At the water"
(off-styled), tap shows toast **"Totems wirken am Wasser"** (totems only *activate* at
the water, nothing consumed by tapping here); **idle, at the water, owned** →
**"Einsetzen"**/"Use" (brass button) → consumes one, starts the timer.

**Entrance animation ("case fan-out")**: `invOpen += 0.05/frame` (reset to 0 whenever the
overlay's own generic reveal is ≤0.09, i.e. every fresh open). Per-row reveal:
`invFanStep(i) = easeOut(clamp((invOpen - i*0.13)/0.42, 0, 1))` — rows swing open
sequentially, staggered **0.13** apart, each row's own swing spanning a **0.42**-wide
window (own dedicated clock — the generic overlay rise finishes in 12 frames/200ms, too
fast for a multi-row fan-out; total settle ≈**0.35s** per the design docs). Rows
alternate hinge side (`i%2`), rotating from `±0.16` rad down to `0`, `alpha =
0.15+0.85*k`. A button inside a still-swinging row is drawn but **not hit-testable**
(`noHit`, since hit-rects are screen-space and don't rotate with the drawing) — only
settled rows respond to taps.

**Case-bottom clutter** (`drawCaseClutter`, purely decorative, drawn once beneath the
rows): the player's actually-owned baits (`save.owned.baits`) plus a fixed set of 7 loose
hooks, 2 line spools, 9 split-shot weights — deterministic `prnd`-seeded positions and
rotation, 80% alpha, **no gloss, no outline, no press-feedback, no hit box** at all
(explicit contrast rule so it reads as "lies there," not "tap me" — see §1.5's
compartment-vs-clutter table below). Baits render via `icons.js` (`worm`, `fish`,
`sparkle`) or hand-drawn shapes (bread/corn/shrimp).

Compartment vs. loose-clutter visual language (both visible, only one tappable):

| | Compartment (totem row) | Loose clutter |
|---|---|---|
| Edge | routed edge, light top / dark bottom bevel | none |
| Shadow | casts a visible shadow onto the floor | flat contact shadow only |
| Shine | brass stud / ring / green frame if running | no highlight, 80% opacity |
| Press feedback | `pressApply`/`pressGlow` | none |
| Hit target | ≥44px | **none** |
| Draw order | drawn over, cuts into the clutter | drawn under |

**Empty state**: centered parchment-style message **"Noch nichts im Vorrat." / "Totems
gibt es im Shop."** plus a brass **"Zum Shop"** button that jumps to the Shop's totems tab.

Opened from: a totem/stock chip in the status-chip row (§1.1) at the water, or from the
Hub's shelf/wall (context-dependent entry points, see §7).

### 1.6 Overlays: Daily Bonus / Quests / Pass — group "Belohnungen" (Rewards)

One tablet, tab rail on the **bottom grip** (page-switching tabs, per the §1.0 rule),
accent `#3fc7a8`, icon `gift`. Tabs: `daily` ("Bonus"), `quests` ("Aufträge"), `pass`
("Pass"). Content heights measured 390×844: Bonus 490px (58%, 99% fill), Quests 486px
(58%, 99% fill), Pass 804px (95%, 100% fill — Pass always claims max height and computes
its own row count from available space).

- **Daily bonus**: login-streak strip (**"Login-Serie: Tag {n}"**, capped **"(max)"**),
  a 7-cell day track, a **"Tagesbonus abholen:"** claim button (or **"Heute schon
  abgeholt – bis morgen!"** once claimed), a **"Werbung ansehen: +{n} Coins extra"**
  ad-bonus row, footer note about the 7-day streak bonus (**"7 Tage in Folge: +2 Gems und
  ein Erfolg"**).
- **Quests** ("Tagesaufträge"): per-quest rows (icon, description text, a progress bar,
  a coin reward, `"{done}/{n}"` fraction), footer **"Neue Aufträge in {time}"** /
  **"Insgesamt erledigt: {n}"**. See §6.4 for the quest-text dictionary entries (e.g.
  "Fange 3 Fische", "Serie von {n} Fängen", "Verjage eine Möwe").
- **Pass** ("Angel-Pass"): tier ladder with free/premium tracks, **"Stufe {n}"** columns,
  a **"Premium-Pfad freischalten · 5,99 €"** unlock button (or **"Premium-Pfad aktiv"**),
  season footer (**"Saison … endet am Monatsende"**), points-earning note
  (**"Punkte: 1 pro XP · 50 pro Auftrag · Stufe antippen = abholen"**).

Shared `drawAnglerStrip`-style header is **not** used here (that's the Angler group only);
instead each tab draws its own summary row.

### 1.7 Overlays: Talents / Achievements / Leaderboard — group "Angler"

One tablet, bottom-grip tab rail, accent `#8fd3ff`, icon `rod`. Tabs: `talents`
("Talente"), `achievements` ("Erfolge"), `leaderboard` ("Bestenliste"). Above the tab
content, every screen in this group shows `drawAnglerStrip()`: level chip (r=13s,
`#8fd3ff` fill, dark-navy number), angler title (bold 15px), right-aligned XP fraction, a
`Wood.inset` XP bar (`#8fd3ff` fill), and a next-location hint line (or **"Alle Orte
offen · {n} Arten entdeckt"** once everything is unlocked).

- **Talents**: a fixed list (`TALENTS`) of passive perks, each a row with name (e.g.
  "Ruhige Hand"/"Steady hand"), effect text (e.g. **"+8 % Spannungsabbau je Rang"**), a
  rank indicator, and a **"+"** learn button when a talent point is available (dictionary:
  **"Talentpunkte verfügbar – antippen zum Lernen"**, **"Nächster Punkt beim nächsten
  Level-Up"**). Content height 774px (92%, 99% fill) at the measured state.
- **Achievements** ("Erfolge"): a paginated list of achievement rows (icon, name,
  description, claimed/unclaimed state) — see the full achievement-text list in §6.4
  ("Warmgeangelt", "Seebär", "Nachtangler", "Bosskämpfer", "Herr der Gewässer", …).
  Always claims max height (804px, 100% fill).
- **Leaderboard** ("Bestenliste heute"): a daily-only, currently-local ranking (dictionary:
  **"Die Online-Bestenliste kommt mit dem Release."**, **"Bis dahin zählt dein Tages-Score
  lokal."**), rows of rank/name/coins-earned, **"Du heute:"** own-score line, and an empty
  state **"Noch keine Einträge heute – sei der Erste."** Smallest content of the group
  (406px, 48%, 99% fill).

### 1.8 Settings (overlay `"settings"`, accent `#d8b25a`, icon `gear`)

Standalone (no tab group). Rows (`settingsRows()`, ~56px each): Sound on/off toggle
(dictionary "Ton an/aus"), Music on/off toggle ("Musik an/aus"), Language switch
("Sprache" — toggles `I18N.set("de"|"en")`), a "Rechtliches & Käufe" (Legal & purchases)
section with **"Datenschutz & Impressum"** and **"Käufe wiederherstellen"** (Restore
purchases) links, and a version-number footer line (`v${GAME_VERSION}`) — **this exact
line is the 5-tap dev-mode unlock gesture, §9.7**. Measured content height 430px (51%,
95% fill). A sibling standalone overlay `"diag"` ("Diagnose") holds developer-only render
diagnostics rows, only reachable once `Dev.an` is true (via the 5-tap gesture or
`?dev=1`).

### 1.9 Map (overlay `"map"`, accent `#5ad46a`, icon `map`)

Standalone. Title **"Angelplätze"**/"Fishing spots" (long form: **"Angelplätze – wohin
geht's?"**/"where to?"). A list/grid of the 6 locations (`cols=narrow?1:2`), each row/card
`(narrow?92:120)s` tall: location artwork thumbnail, name, species-discovered fraction,
and a state-dependent action — **"Hier"**/"Here" (current location, no action),
**"Hinfahren"**/"Travel" (owned, elsewhere), or a lock state showing either
**"ab Level {n}"** (orange) or the coin price (gold, coin icon) — mirrors the location
carousel's own locked-card language (§7.12), since both read the same `LOCATIONS` data.
Measured content height 712px (84%, 96% fill).

### 1.10 Decorate (overlay-equivalent `"decor"`, tab rail on bottom grip)

Drawn from `aquarium.js` (`drawDecorMenu`/`drawDecorPager`/`drawTankFishPicker`) but uses
the same shared overlay chrome (§1.0) and rail placement rule as the Rewards/Angler
groups. Tabs: **Fische** (tank fish picker — add/remove known species, §7.5; empty state
= pinned note **"Fang deinen ersten Fisch, dann zieht er hier ein."**), **Deko** (the 9
decoration items, §7.6, a grid of purchasable/placeable props with a 4-slot picker),
**Boden** (5 ground textures, §7.6), **Wand** (5 backdrops, §7.6) — each ground/backdrop
tile is a color-swatch card (`cw × 82s`) with **"✓ aktiv"**/"active" or **"Auswählen"**
/"Select" plus price. Measured content heights: Decor tab 732px (87%, 99% fill); Fish tab
with 1 known species 240px (28%, the overlay's absolute minimum height); Fish tab empty
248px (29%).

### 1.11 Popups / dialogs / toasts / level-up / catch card / gacha / diagnostics / start

**Catch card** ("Fisch gefangen!", `drawCatchCard`) — not an `overlay`-state screen; a
standalone full-screen modal driven by the global `catchInfo` object, world dimmed but
visible behind it. **Animation**: `k = easeOut(clamp(t/0.35,0,1))` — **350ms** cubic
scale-in from 0→1, with a small fixed random rotation (`(prnd(500,2)-0.5)*0.03` rad,
≈±0.86°) so "the certificate never hangs perfectly straight." Size `360s×310s`, centered
at `(canvas.width/2, canvas.height*0.45)`. Frame: `Wood.panel` outer (accent = rarity
color, `plankH 84s`) + `Wood.paper` parchment inset pinned top-right with a rarity-colored
pin. Radial rarity-color glow behind the fish (alpha pulsing `0.2+0.06*sin(t*3)`); rare+
non-junk catches get 8 rotating rarity-colored light rays (9% alpha) sweeping behind the
fish. Header: **"Fisch gefangen!"** normally, **"Na toll…"**/"Oh great…" for junk,
**"BOSS BESIEGT!"**/"BOSS DEFEATED!" for a boss kill (bold 24px). Fish render with
shiny sparkles if applicable. Name: bold 22px, rarity-colored fill + dark ink outline
stroke (needed for legibility on parchment). Subtitle: a custom flavor line in quotes
("„…"", italic 12px) or the default **"{RarityName} · {kg} kg [· ×{multiplier}]"** (14px).
Coins line: **"+{coins}"** bold 24px (`#8a5a00` normal, `#b03a2e` if a seagull stole part
of it, with an extra red line **"Die Möwe hat {n} geklaut!"**). Bycatch (a smaller fish
inside the main catch's mouth) rendered small on the right: **"+ {name} ({kg} kg)"**.
Badge row (stamped metal plaques, left-aligned, conditional): **"NEU im Fischdex!"**
(`#5ad46a`), **"Neuer Rekord!"** (`#ffd23a`), **"Perfekter Drill ×1.5"** (`#7fd8ff`),
**"SHINY ×5"** (`#fff3a0` + sparkle icon). Footer: **"Klicken zum Weiterangeln"**/"Tap to
keep fishing" (dim 11px). A **"📸 Fang teilen"**/"Share catch" button (170×38) appears
below the card once `t≥1` and no ad is gating, calling into `share.js` (out of this doc's
scope).

**Level-up screen** (`drawLevelUp`, progress.js): full-screen dark scrim
`rgba(16,8,3,0.55)`, tap-anywhere dismisses once `t>0.4s`. Panel `w=min(canvas.width-32,
380s), h=(hasUnlockedLocation?300:250)s`, centered, **350ms** `easeOut` scale-in, gold
border `#ffd23a`. Content: **"LEVEL AUFSTIEG"**/"LEVEL UP" label (gold 14px), a huge level
number (white bold 56px), angler title (bold 16px), rewards line **"+{coins} Coins
{+{gems} 💎 if any} +1 ⭐"** (gold `#ffd700` bold 20px), an optional green unlock line
(**"🏝 Ort freigeschaltet!"**) with a next-location teaser (dictionary: **"Nächster
Ort:"**, **"ab Level"**, **"hinfahren"**), footer **"Tippen zum Weiterspielen"**/"Tap to
continue" (dim 11px). FX: screen shake, coin-fly particles to the HUD coin target, a
50-piece confetti burst, and a sparkle burst centered on the level number.

**Toasts / floating text** (`addFloatingText`, effects.js): not a dedicated widget — a
shared lightweight particle system (`floatingTexts` array). Signature
`addFloatingText(text, x, y, color="#ffffff", size=26)`. **1.4s** lifetime, quadratic
ease-out fade (`alpha = 1-(age/life)²`), a 5px black stroke behind the colored fill, font
auto-shrinks down to 12px, x-position clamped to stay on-screen. Used throughout for XP
gains (**"+N XP"**, cyan `#8fd3ff`), blocked-action explanations (e.g. **"Totems wirken am
Wasser"**, **"Erst ab Level {n}"**), unlock confirmations, and error messages
(**"Zu wenig Coins!"**, **"Zu wenig Gems!"**).

**Gacha result** ("Wundertüte" pull reveal, `drawGacha`, script.js-orchestrated — full
draw body outside this doc's read scope but its trigger/theme is documented in §1.3 and
§6.4): a wood-framed reveal card, **"Du hast gewonnen:"** header, **"JACKPOT!"** special
case, item render, **"Tippen zum Schließen"**/"Tap to close" footer.

**Ad-gate popups** ("Werbevorschau" / ad placeholder panels, `Ads.draw()`): a wood panel
labeled **"ANZEIGE"**/"AD" with placeholder text **"Platzhalter – hier läuft später das
Ad-SDK"** (Placeholder – the ad SDK goes here), a reward line (**"Belohnung: doppelte
Coins"**), **"Belohnung holen"**/"Collect reward" and **"Abbrechen"**/"Cancel" buttons —
shown at specific gates (travel offers: **"Ab ans Wasser"**/"Off to the water", **"Der
Fisch wartet."**; return offers: **"Kurz durchatmen"**/"Take a breath", **"Dein Becken
wartet."**).

**Diagnostics** (overlay `"diag"`, "Diagnose"): developer-only render-info rows (frame
time, entity counts, cache-hit stats for the `Blech` bake system), reachable only once
`Dev.an` is true (§9.7's 5-tap gesture, or `?dev=1`). Content height formula:
`58s + diagRows()*38s + 38s + 20s`.

**Start / intro screen**: there is **no** classic title screen or pause menu in the
current build — see §8.9 for the full `intro.js` "cast" sequence that replaces it, and
§7.9 for how overlays substitute for a pause state (world keeps rendering, dimmed, behind
whatever sheet is open, rather than a dedicated pause screen).

### 1.12 Marker/badge discipline (applies to every screen above)

At most **two** notification markers are ever shown at once on any single icon/tab/button
(`badgeMarks()`), ranked: a filled green circle with a number = "ready to claim" (daily
bonus, quest count, capped display "9+"); a plain red dot (no number) = "something new/
unseen" (shop item, dex entry, achievement). "You can afford this" is deliberately **not**
a marker category — affordability is shown inline on the action button itself, never as a
badge.

---

## 2. Wood UI style system (`wood.js`)

Global object `Wood`. Purely a Canvas2D drawing library — every shape is procedurally
generated per call from a **deterministic seed** (`prnd(seed, salt)`), so repeated calls
with the same geometry always look identical (no per-frame flicker) but no two planks/
panels are pixel-identical to each other. Depends on external helpers `prnd`, `clamp`,
`shadeColor`, and an optional bake-to-bitmap cache (`Blech`, `blech.js`) for panels that
don't change frame to frame — a 2026 performance pass, not part of the visual recipe.

### 2.1 Color constants

```js
TONES: ["#7a5230","#6d4726","#82593a","#5e3f22","#7c4a2e","#6e5a42","#755130"] // 7 plank tones
DARK:  "#2a180b"   // seams / backing (shows through short planks & panel edges)
INK:   "#3a2a14"   // ink text on parchment
PAPER: "#efe2bd"   // parchment base
ROPE:  "#a5814e"   // rope/cord
RAW:   "#6d4726"   // raw wood under worn paint
```

### 2.2 "Anstrich" — the paint-coat palette (6 buckets, everything else snaps to one)

```js
PAINT.buy    "#e0791c"  // purchase / primary action — orange
PAINT.reward "#3f9d52"  // reward / confirmed / on   — green
PAINT.gold   "#d9a92b"  // premium / pass / gems      — gold
PAINT.info   "#3c86b4"  // hint / gem price / neutral — blue
PAINT.danger "#c34432"  // danger / cancel            — red
PAINT.worn   "#6b6154"  // locked / off, flaked grey
```

This replaced ~40 distinct translucent fill colors (534 call sites) that used to be a
"Lasur" (glaze) laid over wood at partial opacity — a design smell explicitly identified
and fixed: every UI color request now snaps to the nearest of these 6 and is painted
**opaquely**, never translucent-over-wood. `_nearestPaint(r,g,b)` classifies by hue after
a saturation gate (`sat<26` → `worn`): hue `<16°` or `≥342°` → danger, `<44°` → buy,
`<68°` → gold, `<170°` → reward, else → info (blue/teal/violet all collapse to info).
`paintIntent(fill)` is the legacy-compatibility bridge: given an old CSS-color string it
classifies it as `{kind:"ghost"}` (alpha<0.05, fully transparent), `{kind:"paint",
color,worn}` (saturated, or faint→worn), or `{kind:"wood"}` (plain/neutral → bare wood,
no paint at all). There is no "wash"/"dim" kind anymore — everything is either opaque
paint or bare wood.

`coatColor(col, worn) = worn ? mix(col, "#3d2c1a", 0.52) : col` — "worn" means mixed 52%
toward dark brown, not made transparent.

### 2.3 `plank(x, y, w, h, seed, o={})` — one board

- Base tone: `o.tone` or a random pick from `TONES`.
- Edge jitter `j = clamp(h*0.08, 1, 3.2)`px; tilt/`skew = (p(2)-0.5) * clamp(h*0.14,1.5,4.5)`
  (visual tilt up to roughly ±1.2°). All four quad corners are jittered independently
  (±j/2 combined with skew) → a non-rectangular quadrilateral, not a rectangle.
- Fill: vertical gradient `shadeColor(tone, 0.05+p(9)*0.05)` (top) → `tone` (55%) →
  `shadeColor(tone, -0.13)` (bottom).
- Clipped to the plank shape, then:
  - **Grain**: `clamp(round(h/10), 2, 6)` bezier wave lines, amplitude `1+p()*2.2`,
    75% dark (`rgba(30,16,6,0.16)`) / 25% light (`rgba(255,225,180,0.10)`), width `0.8+p()*0.8`.
  - **Knot hole**: 34% chance if `w>46 && h>14`. Radius `kr=clamp(h*0.16,2,4.5)`; outer
    stroked ellipse `rgba(34,18,7,0.5)` w1.2, inner filled ellipse `rgba(28,14,5,0.55)`.
  - **Crack**: 20% chance if `w>70`. 3-segment jagged line from a random edge, stroke
    `rgba(20,10,4,0.5)` w1.
  - **Chipped corner**: 22% chance if `h>20`. Triangular dark notch, `rgba(22,12,5,0.65)`,
    ~4–10px wide, ~3–7px tall.
- Un-clipped edge strokes: dark outline `rgba(26,13,5,0.55)` w1.4 (full outline), plus a
  light top-edge highlight `rgba(255,228,186,0.16)` w1 (top edge only).

### 2.4 `nail(x, y, seed, r=2.6)`

Position jitters ±1px. Shadow ellipse `rgba(15,8,3,0.5)` offset (+0.9,+1.2), radii
`r*1.05 × r*0.85`, rotated 0.4 rad. 9% chance of a crooked shaft (a short angled stroke,
`#6d6156`, width `r*0.5`, before the head is drawn). 30% chance "rusty." Radial-gradient
head: rusty stops `#c99a6a → #8a5a34 (60%) → #5c3a20`; normal (steel) stops
`#e8e2d6 → #a8a094 (60%) → #6d6156`. A screwdriver-slot line crosses the head at a random
angle, `rgba(30,20,10,0.55)` w0.9.

### 2.5 `panel(x, y, w, h, r, o={})` — the main panel primitive

- No-op if `w<=0||h<=0`. **Corner radius hard-capped at 8px** (`r=min(r,8,w*0.4,h*0.4)`)
  regardless of the requested radius.
- Default seed: `seedOf(x,w,h, round(y/64))`, where
  `seedOf(x,w,h,salt=0) = ((round(x)*31+round(w)*7+round(h)*13+salt*101) % 8191 + 8191) % 8191`.
- **Baking**: if a `Blech` bake-cache is active and the panel isn't mid scale-animation,
  drawing is memoized to a bitmap keyed by `"holz:"+seed+":"+w+"x"+h` plus a signature
  array of every visual input (w,h,r,seed,accent,paint,battens,plankH,border) — a pure
  performance optimization (avoids re-running `shadowBlur:14` + N-plank generation every
  frame); irrelevant to the visual recipe itself. `SCHATTEN_RAND = 24`px is the shadow
  margin reserved around the baked bitmap.
- **Drawing** (`_panelRoh`):
  1. Drop shadow (`shadowColor rgba(0,0,0,0.45)`, `shadowBlur 14`, `shadowOffsetY 5`) +
     `DARK` (`#2a180b`) fill of the rounded rect — this is the backing that shows through
     gaps/short planks.
  2. Clip to rounded rect. Planks: `n = max(1, round(h / (o.plankH||62)))` rows (default
     plank height 62px), each row height `h/n * (0.82+p()*0.36)` (last row takes the
     remainder). **"Short plank" effect**: if `n>2`, 22% chance per row a plank is cut
     `8+p()*22`px short from a random side, letting the dark backing show through.
     **Nails at plank ends** if `w>92 && ph>18`: two per row at `x+9` / `x+w-9`
     (y-jittered), radius `clamp(ph*0.11,1.8,2.8)`.
  3. **Battens** ("Leisten" — side trim strips): only `if (o.battens && h>200)`. Two
     vertical 12px-wide planks overlaid at the left (5px inset) and right (17px inset)
     edges, full height−8, each with 2 extra nails near top and bottom. This — and only
     this — is what "Leisten" means in the codebase: vertical strips laid over a large
     panel's edges to visually "hold the boards together," only on tall (>200px) panels
     when explicitly requested.
  4. Water stains: up to 2 ellipses, 70% chance each — dark `rgba(18,9,3,0.10)` or light
     bleach `rgba(255,235,200,0.05)`.
  5. Vignette: vertical gradient `rgba(255,235,200,0.07)`→transparent(20%)→transparent(80%)
     →`rgba(0,0,0,0.18)` (light top, dark bottom).
  6. **Paint coat** (`o.paint`, panel-level simple version — see §2.7 `coat()` for the
     fuller recipe used on signs): flat fill at `globalAlpha 0.62`, plus a second fill of
     just the top half at `globalAlpha 0.28` ("richer on top, rubbed off below"). Then up
     to 3 chipped-edge ellipses (60% chance each), `rgba(42,24,11,0.5)`, near top/bottom.
  7. Un-clip. **Accent border** ("Zierlinie", only `if (o.accent)`): hand-painted dashed
     rounded-rect stroke, inset 4.5px, radius `max(3,r-4)`, color `o.accent`,
     `globalAlpha 0.6`, `lineWidth 2`, per-seed randomized dash pattern
     (`[26..56, 3..8, 44..84, 2..6]`) + `lineDashOffset` — reads as hand-painted trim with
     gaps where the paint chipped, not a neon outline (see §2.10 self-critique — the doc
     itself flags this sometimes reads too much like a rendered border).

### 2.6 `inset(x, y, w, h, r, o={})` — recessed area (list rows, tiles)

**Radius hard-capped at 5px** (smaller than panel's 8px — the comment is explicit: a
"carved-out hollow in a board" should have chipped edges, not rounded corners). Fill
`rgba(20,10,4,0.34)` over the whole rect; optional tint (`o.tint`) at `globalAlpha 0.16`;
inner-shadow strip at top (gradient `rgba(0,0,0,0.32)`→transparent, 7px tall); light edge
strip at bottom (`rgba(255,225,180,0.09)`, 1.5px, inset 2px each side); optional solid
(non-dashed) accent stroke, `globalAlpha 0.8`, `lineWidth 2`, inset 1px.

### 2.7 `sign(x, y, w, h, o={})` — plaque/header board (e.g. the "ANGELN" button)

Seed default `seedOf(x,w,h,9)`; `tilt` default `(p(1)-0.5)*0.02` rad. Shadow
`rgba(0,0,0,0.4)` blur 10 offsetY 4. `DARK` backing, **fixed 6px** corner radius (not
parameterized). Clipped: **two stacked planks** if `h>52` (split at 44–58% down,
randomized), else **one plank**. If `o.paint`, calls the fuller `coat()` recipe (below)
instead of the simple panel overlay. Vignette `rgba(255,235,200,0.09)`→`rgba(0,0,0,0.16)`.
**Nails**: `o.nails ?? (w>150 && h>40 ? 4 : 2)`, radius `clamp(h*0.09,2,3.2)`; 4-nail
layout = corners (10px inset); 2-nail layout = mid-left/mid-right (9px inset,
y-jittered ±2.5).

### 2.8 `coat(x, y, w, h, col, seed, worn)` — the full opaque-paint recipe

Used by `sign()` (not by plain `panel()`, which uses the simpler §2.5-step-6 overlay).
Base color = `coatColor(col, worn)`. **Chip-outs ("Fehlstellen")** are computed first as
polygon point lists (3–8 per board, more if `worn`) along random edges, then cut as holes
via an `evenodd` clip so raw wood shows exactly through them (bare-wood chips, not painted
divots). Inside the clip: vertical base gradient (lighter 15% top → base 52% → darker 18%
bottom); `clamp(round(h/9),3,7)` in-paint grain wave lines (58% dark/42% light, alpha
0.35–0.7); 3 long faint brush-stroke beziers (alpha 0.12–0.22, lighter shade); a paint
drip/blob near the bottom edge (55% chance if `h>26`); a thin uneven-edge stroke inset
1.5px (`globalAlpha 0.16`). After un-clipping, every chip gets a hard dark outline stroke
so it reads as a paint edge, not dirt.

### 2.9 `paper(x, y, w, h, o={})` — parchment note

Seed `seedOf(x,w,h,5)`, rotation `(p(1)-0.5)*0.05` rad (self-rotated). Shadow
`rgba(0,0,0,0.35)` blur 8 offsetY 3. **Irregular outline**: polygon walked in ~48px edge
steps, each vertex jittered ±1.1px. Fill: diagonal gradient (top-left → 30%,100%)
`#f7edcf`(if `o.light`)/`#efe2bd` → `#ddc99c`. Stroke `rgba(120,90,50,0.4)` w1. Up to 2 age
spots (75% chance each, `rgba(150,110,60,0.07)`). Yellowed border `rgba(140,100,55,0.14)`
w5 inset 2px. Optional pin (`o.pin`, "Reißzwecke"): shadow ellipse + radial-gradient head
(default red `#d84343`, or `o.pinColor`), head radius 4.2. Returns the rotation used.

### 2.10 `rope(x1,y1,x2,y2,o={})`

Sag `o.sag||10`px (quadratic curve through the sagging midpoint). Stroke `o.color||ROPE`,
width `o.w||3`, round cap. "Twist" ticks: short diagonal marks every ~7px along the curve,
`rgba(60,40,18,0.55)` w1.

### 2.11 Text-on-wood helpers

- `inkOn(coat, worn, wanted)` — chooses `DARK_INK "#2c1a05"` or `CHALK "#f8efdb"` by
  contrast against the actual coat luminance; if the caller supplied a `wanted` color that
  isn't faded (alpha≥0.7) and has contrast ratio ≥4 against the coat, uses that instead.
  Explicitly fixes a historical bug: gold-on-gold / green-on-green text that went unnoticed
  under the old translucent-glass look.
- `isLight(col)` — luminance>140 test, used to decide chalk-shadow placement under
  light-colored text.
- `_lumOf(col)` — standard luminance `0.299r+0.587g+0.114b`.

### 2.12 What is genuinely NOT in `wood.js`

Per direct code inspection, `wood.js` contains **no** function named badge/tab/segment/
sheet/tile. Red notification badges, segment/tab bars, the bottom-sheet container itself,
and icon tiles are all built in `draw.js` (`uiButton`, `drawTabs`, `drawOverlayFrame`,
`badgeMarks()`) **on top of** the `Wood` primitives above (mostly `panel`/`inset`/`sign`).
See §1.0 and the draw.js findings folded into §1 for those.

### 2.13 What is deliberately NOT wood (per `docs/UI-HOLZ-UMBAU.md`)

- **The aquarium tank itself stays glass** — "it's an aquarium, the glass is diegetic
  content, not UI chrome" (see §3).
- **Progress/tension bars** (reel-in tension, XP, pass-track fill, boss stamina): plain
  flat color bars — legibility in a tenth of a second beats style here.
- **Status markers** (red=new, green=claimable) and the level chip: kept as flat signal
  colors, not wood-painted.
- Location-band postcards: were already "cardboard on wood" before this pass — only a
  slight rotation-per-card was added.
- `icons.js`'s 26+ icons: left as-is, matches the fish art style.
- Title screen, story.js/cutscene.js/music.js, save format: out of scope for the wood pass.

### 2.14 Self-assessed weaknesses (from the source docs — useful rebuild guidance)

1. List rows (`Wood.inset`) are "too tidy" — perfectly rounded, exactly gridded — while
   the planks behind them are deliberately crooked; a future pass would make each row its
   own tilted nailed board instead of a carved recess.
2. Accent dashed borders can read as "game-UI-with-a-shader-outline" rather than
   hand-painted trim, especially wrapping a whole catch-card border in rarity color.
3. Typography (Baloo 2, soft shadow, 0.5° rotation) is "immaculate," not chalk — no stroke
   irregularity, no fraying; combined with glossy emoji tab icons this stands out more on
   wood than it did on the old glass look.

---

## 3. Glass UI (`glass.js`) — still used? where?

**Answer: only as a thin compatibility shim, and only for the aquarium tank glass is any
genuine "glass" look still diegetically present.** Full current file (17 lines):

```js
// --- Ehemals "Liquid Glass", jetzt Brücke zum Holz-Look (wood.js) ---
const Glass = {
  snap: null,
  supported: typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype,
  liveBlur: false,
  watchPerformance() {},
  takeSnapshot() {},
  clear() {},
  panel(x, y, w, h, r, opts = {}) {
    Wood.panel(x, y, w, h, r, { accent: opts.border });
  }
};
```

History: the entire UI used to be a "Liquid Glass" blur-panel look (translucent, backdrop
blur, tint/light options). The 2026-08-28 wood pass ("UI-Umbau: Liquid Glass → rustikales
Holz") chose **not** to touch every `Glass.panel(...)` call site (there are many, e.g.
`events.js`'s status-chip row still literally calls `Glass.panel(...)`); instead
`Glass.panel` itself was rewritten to forward straight into `Wood.panel`, translating only
the old `border` option into Wood's `accent` option. `tint`/`light`/`useSnap` are now
meaningless and ignored. `watchPerformance`/`takeSnapshot`/`clear` are no-op stubs — the
actual blur/snapshot machinery (previously the most expensive render path in the game) is
gone entirely, which was a net performance win on weak devices.

**What is still visually "glass" is the aquarium tank itself** (drawn directly in
`aquarium.js`, not through the `Glass` object) — explicitly called out as intentional:
*"the aquarium tank stays glass — it's an aquarium, the glass is diegetic, not UI."* See
§7 for its exact recipe (two diagonal `globalCompositeOperation:"lighter"` reflection
bands, a dark 7px outer frame stroke, a 2px light inner-edge stroke).

**Rebuild implication**: do not build a general "glass panel" component for menus — every
menu is wood (§2). Only the fish tank needs a translucent/reflective glass treatment, and
even that is a bespoke reflection-band recipe, not a blur filter.

---

## 4. Icons (`icons.js`)

`ICON_OUTLINE = "rgba(12,22,34,0.55)"` — shared soft dark outline color. Helpers:
`_icoGrad(a,b,y0=-1,y1=1)` (vertical gradient), `_icoLine(w=0.14)` (strokes current path
with `ICON_OUTLINE`), `_icoGloss(x,y,rx,ry,rot=-0.5,a=0.45)` (white highlight ellipse).
Every icon is drawn in a normalized **−1..1** coordinate box; `drawIcon(id,x,y,r)` does
`translate(x,y); scale(r,r)` so `r` = half-edge-length (an icon with `r=10` occupies 20×20
screen px). `drawIconLabel(id,label,cx,cy,w,r,gap)` draws icon+text as one centered unit
(gap defaults to `r*0.6`, label shrunk via `fitText` to fit `w`).

**38 icons total, one line each:**

| id | description |
|---|---|
| `tank` | Aquarium: rounded blue-gradient glass body, clipped wavy water fill, small orange fish with dark eye, white gloss highlight, brown pedestal base. |
| `book` | Fishdex: brown cover, two cream gradient page panels with 3 faint ruled lines each, dark center spine line. |
| `tacklebox` | Tackle box: dark arc handle, reddish-brown gradient box, darker lid-seam band, yellow snap latch, gloss highlight. |
| `calendar` | Daily bonus: white/gray gradient body, red header band across top, two ring stems, 3×2 grid of dark date dots. |
| `rod` | Fishing rod: brown curved double-stroke shaft, gray reel circle, white line curve, light-gray hook arc. |
| `tv` | Small CRT TV: two antenna strokes, dark blue-gray gradient body, light-blue gradient screen with gloss, yellow/red control knobs. |
| `lock` | Padlock: gray double-stroke shackle arc, gold gradient body, dark keyhole (circle+teardrop), gloss highlight. |
| `trophy` | Trophy: two gold handle arcs, gold gradient cup body, dark-gold stem/base, gloss highlight. |
| `gift` | Gift box: red gradient box, red-pink gradient lid, yellow vertical ribbon, yellow bow (two stroked ellipses). |
| `clipboard` | Quest clipboard: brown board, white/gray gradient paper, tan clip clamp, two teal checkmarks, two faint text-line strokes. |
| `map` | Folded map: tan/khaki gradient zigzag-folded polygon, fold-line strokes, red map pin (teardrop+circle head). |
| `sparkle` | Shiny star: one large 4-point curved star plus one smaller white 4-point star, shared `star()` helper. |
| `fish` | Simple fish: blue gradient ellipse body, solid triangular tail fin, white eye with dark pupil. |
| `star` | 5-point rating star: gold gradient, 10-vertex alternating-radius path (outer 0.95 / inner 0.42). |
| `chart` | Leaderboard bars: silver/bronze/gold bars (gold tallest, centered) plus a small cream crown above the winner bar. |
| `ticket` | Angler pass ticket: pink/red gradient rounded-notch ticket-stub shape, white dashed perforation line, two white rounded text-bar placeholders. |
| `coral` | Coral decoration: red-orange and pink curved branch strokes, tan sand base ellipse+rect. |
| `worm` | Bait worm: pink curved bezier body (thick stroke + thin highlight), small dark eye dot. |
| `bobber` | Fishing bobber: outline stem line, red top half, white bottom half, full outline stroke, gloss highlight. |
| `palette` | Rod-design palette: tan gradient ellipse board, destination-out thumb-hole cut, 4 paint-dab circles (red/yellow/green/blue) around the rim. |
| `hat` | Cosmetic hat: dark-green gradient crown, darker band, green gradient brim ellipse, gloss highlight. |
| `coat` | Cosmetic outfit: blue gradient coat-shape polygon, dark lapel triangle overlay, two yellow buttons. |
| `trident` | Harpoon: rotated −45°, gray double-stroke shaft, tan grip-wrap rect, light-gray gradient barbed spearhead polygon. |
| `orb` | Totem/luck orb: purple trapezoid pedestal, radial-gradient sphere (pale pink→purple→dark purple), gloss highlight, two spark dots. |
| `gem` | Diamond currency icon: cyan gradient diamond quad, lighter inner-facet triangle overlay, white top-edge highlight stroke. |
| `net` | Landing net: brown gradient handle stroke, light gray-blue gradient net-bag shape, 3 mesh strokes + 1 cross-mesh curve, gold/brass gradient hoop outline, gloss highlight. |
| `globe` | Language/settings globe: blue gradient sphere, 3 green landmass ellipses clipped to the circle, lat/long grid strokes, gloss highlight. |
| `speaker` | Sound-on: light gray gradient speaker-cone polygon, two green sound-wave arcs. |
| `speakerOff` | Sound-off: same gray speaker shape (dimmer), red X strikethrough instead of waves. |
| `note` | Music note: two purple stem strokes, a connecting flag fill, two purple gradient note-head ellipses. |
| `gear` | Settings gear: gray gradient 8-tooth gear body (alternating arcs at two radii), destination-out center hole, stroke ring outline. |
| `rain` | Rain totem: light blue-gray gradient cloud (3 overlapping arcs), 3 blue teardrop raindrops below. |
| `moon` | Night totem: cream/gold gradient circle with a destination-out crescent bite, plus one small yellow star beside it. |
| `sun` | Sun totem: 8 orange sunburst ray strokes radiating from center, radial-gradient core disc, gloss highlight. |
| `horn` | Lure-call totem: orange gradient horn-body trapezoid, brown handle rounded-rect, two tan sound-wave arcs. |
| `clover` | Four-leaf luck totem: green stem stroke, 4 leaves (shared rotated/translated `leaf()` helper, green gradient), one white gloss dot. |
| `flame` | Streak flame: radial-gradient bezier flame silhouette (pale yellow→orange→red), lighter inner-flame ellipse. |
| `magnet` | Rarity magnet: gray gradient horseshoe shape, red pole tip on one leg, blue pole tip on the other, dark outline strokes. |

---

## 5. Font (`font.js`, `fontdata.js`)

- **House font: "Baloo 2"**, a Google-Fonts variable font (weight axis **100–900** in one
  file), latin subset, SIL Open Font License 1.1. Fallback chain declared as
  `UI_FONT = "'Baloo 2', 'Segoe UI', system-ui, sans-serif"`.
- **Loading**: `fontdata.js` (auto-generated, "do not hand-edit") holds one giant base64
  constant `FONT_BALOO2_B64` (a woff2 blob, inline — no network request, no waiting on a
  CDN). `font.js` loads it via the `FontFace` API (not a CSS `@font-face` rule):
  ```js
  new FontFace("Baloo 2", "url(data:font/woff2;base64," + FONT_BALOO2_B64 + ") format('woff2')", { weight: "100 900" });
  ```
  On success: `document.fonts.add(f)`, then `window.uiFontReady = true`. On failure
  (throw, or the `.load()` promise rejecting): `window.uiFontReady = false` — the game
  keeps running on the fallback stack, nothing blocks.
- **Global family substitution**: rather than rewriting all font strings at their call
  sites, `font.js` monkeypatches the `font` property setter on **both**
  `CanvasRenderingContext2D.prototype` and `OffscreenCanvasRenderingContext2D.prototype`
  (needed because the world scene renders into its own OffscreenCanvas with an independent
  prototype — same reasoning as i18n.js's canvas-prototype patch, §6). Regex:
  ```js
  const FAMILY = /'Segoe UI',\s*system-ui,\s*sans-serif|system-ui,\s*sans-serif|sans-serif|serif|monospace/;
  ```
  Any `ctx.font = "...px 'Segoe UI', system-ui, sans-serif"` assignment (181 call sites in
  the codebase, per the file's own comment) that doesn't already mention "Baloo" gets its
  family fragment swapped for the full `UI_FONT` string before being handed to the real
  setter — so every existing and future `ctx.font=...` line automatically renders in Baloo 2
  with zero per-call-site changes. Idempotent (`proto.__uiFont` guard).
- **Sizes/weights**: no presets or constants live in `font.js` — every `ctx.font = "bold
  22px ..."`-style string with its literal size/weight is written at each call site
  elsewhere in the codebase (see per-screen sections above for concrete examples, e.g. the
  ANGELN sign uses `bold 22px`, story chapter titles use `700 40px`, subtitle box text
  `700 17px`). The font-family swap is the only thing this file touches.
- **Outline/shadow text styling**: font.js itself defines **no** stroke/shadow constants
  or text-drawing helpers — those are ad hoc per call site (e.g. story.js's title-card
  stroke `#0b0e16` width 9 + `shadowBlur 22`, catch-card ink, etc.) Only one small helper
  lives here:
  ```js
  function fontMidNudge(px) { return -px * 0.045; }
  ```
  Baloo 2 sits slightly lower in its line-box than Segoe UI; with `textBaseline:"middle"`,
  short text (numbers, button labels) sits about 1% of the font size too low. Callers
  needing exact vertical centering add this (small negative) offset to their draw Y.

---

## 6. i18n (`i18n.js`)

### 6.1 Mechanism

**Not** a `t("key")` call-site system. Instead, `I18N.patch()` monkeypatches `fillText`,
`strokeText`, and `measureText` on **both** `CanvasRenderingContext2D.prototype` and (if
present) `OffscreenCanvasRenderingContext2D.prototype` — needed because the world scene
renders into its own OffscreenCanvas with an independent prototype (the code comment notes
this was a real bug: without patching both, the world stayed German while the rest of the
UI turned English, "and nobody would know why *there*"). Every string passed to any of
those three calls is routed through `I18N.translate(str)` first.

`I18N.translate(str)`:
1. If `lang === "de"`, return the string unchanged (source language, no lookup needed).
2. Check a per-string cache (`this.cache`).
3. Exact-match the whole string against `dict` first.
4. If no exact match: sort all dictionary keys **longest-first**
   (`keysSorted = Object.keys(dict).sort((a,b) => b.length - a.length)`), then for each key
   present as a *substring* of the input, replace it via a **word-boundary regex**:
   ```js
   new RegExp("(?<![\\p{L}])" + escapedKey + "(?![\\p{L}])", "gu")
   ```
   (negative lookbehind/lookahead on any Unicode letter — so `"See"` won't match inside
   `"Seemitte"`). Longest-key-first ordering means multi-word phrases translate as a unit
   before their component words would.
5. Cache and return.

**Consequence** (documented at top of the doc): this is why short UI labels, compound
strings ("Page 2/5"), and known nouns/phrases translate correctly with **zero** call-site
changes anywhere in the ~9800-line codebase, but **long narrative sentences** (story
subtitles, §8) that have no dictionary entry stay mostly German even in English mode —
verified directly: `"Abend am Steg.\nWie jeden Abend."` (a story.js subtitle) has **no**
dictionary entry, and even `"Wasser"` alone is not a standalone dictionary key.

### 6.2 Language detection / switch

```js
init() {
  const saved = JSON.parse(localStorage.getItem("fishing-adventure-save-v1")||"{}").lang;
  this.lang = saved || ((navigator.language||"de").toLowerCase().startsWith("de") ? "de" : "en");
  this.patch();
}
set(lang) { this.lang = lang; this.cache = {}; }   // clears cache on switch
```
Persisted as `save.lang`; falls back to browser `navigator.language` (German-locale
prefixes → `"de"`, everything else → `"en"`) on first run.

### 6.3 Number formatting (`I18N.num`)

```js
num(n, dec) {
  const s = dec != null ? Number(n).toFixed(dec) : String(n);
  return this.lang === "de" ? s.replace(".", ",") : s;
}
```
German uses comma as decimal separator (e.g. weights like "634,48 kg"); English keeps the
period. This is the only numeric-format rule in the game (no thousands separators).

### 6.4 Full dictionary, verbatim (German → English)

```js
{
  "Chancen: Coins ~60 % · Köder 12 % · Skin 12 % · nichts 14 % · Jackpot 1,2 % (Gold: Skin 35 %, Jackpot 3 %). Nur mit Coins, nie mit Echtgeld.": "Odds: coins ~60 % · bait 12 % · skin 12 % · nothing 14 % · jackpot 1.2 % (gold: skin 35 %, jackpot 3 %). Coins only, never real money.",
  "Gems gibt es für Shinies, Erfolge, Level-Ups, Bosse – oder hier.": "Gems come from shinies, achievements, level-ups, bosses – or here.", "Ein Sack voll.": "A bag full.", "Beliebteste Wahl.": "Most popular.", "Für Sammler.": "For collectors.", "Werbefrei für immer. Keine Pausen, keine Anzeigen.": "Ad-free forever. No breaks, no ads.", "Werbefrei": "Ad-free",
  "Käufe sind nur in der App möglich (App Store / Google Play).": "Purchases are only available in the app (App Store / Google Play).", "Nur in der App verfügbar": "Only available in the app", "Anzeige lädt noch – gleich nochmal": "Ad still loading – try again in a moment", "Kauf": "Purchase",
  "Diamantpose": "Diamond bobber", "Funkelt wie dein Kontostand. Hoffentlich.": "Sparkles like your bank account. Hopefully.", "Kristall": "Crystal", "Durchsichtig. Die Fische sehen die Rute nicht kommen.": "Transparent. The fish never see the rod coming.", "Perlenkrone": "Pearl crown", "Aus dem Riff. Für Königinnen und Könige.": "From the reef. For queens and kings.", "Fehlen": "Missing",
  "Der Boss ist da – Köder in seine Nähe werfen!": "The boss is here – cast near it!", "BOSS": "BOSS", "BOSS BESIEGT!": "BOSS DEFEATED!",
  "Da war noch ein": "There was a", "drin!": "inside!", "Doppelt gefangen": "Two for one", "Ein Fisch im Fisch": "A fish inside a fish",
  "Angel-Pass": "Angler Pass", "Stufen": "Tiers", "endet am Monatsende": "ends at month's end", "Saison": "Season", "Stufe": "Tier", "Punkte": "points", "Maximum erreicht": "Max reached", "Premium-Pfad freischalten · 5,99 €": "Unlock premium track · €5.99", "Premium-Pfad aktiv": "Premium track active", "Premium-Pfad aktiv!": "Premium track active!", "Gratis": "Free", "Premium": "Premium",
  "Punkte: 1 pro XP · 50 pro Auftrag · Stufe antippen = abholen": "Points: 1 per XP · 50 per quest · tap a tier to claim", "Belohnung wartet im Pass": "Reward waiting in the pass", "Nur im Angel-Pass.": "Angler Pass only.", "Sommerhut": "Summer hat", "Sonnenblume": "Sunflower", "Sommerbrise": "Summer breeze", "Kauf nur in der App möglich": "Purchase only in the app",
  "Januar": "January", "Februar": "February", "März": "March", "April": "April", "Mai": "May", "Juni": "June", "Juli": "July", "August": "August", "September": "September", "Oktober": "October", "November": "November", "Dezember": "December",
  "Bestenliste heute": "Today's leaderboard", "Bestenliste": "Leaderboard", "Du heute:": "You today:", "Coins verdient": "coins earned", "Die Online-Bestenliste kommt mit dem Release.": "The online leaderboard arrives with the release.", "Bis dahin zählt dein Tages-Score lokal.": "Until then your daily score counts locally.",
  "Wer am Tag die meisten Coins erangelt, steht oben –": "Whoever earns the most coins in a day is on top –", "Bosse, Shinies und Serien zahlen sich aus.": "bosses, shinies and streaks pay off.", "Verbinde…": "Connecting…", "Noch keine Einträge heute – sei der Erste.": "No entries yet today – be the first.",
  "tippen zum Überspringen": "tap to skip", "Arten · 6 Angelplätze · ein Steg": "species · 6 fishing spots · one pier", "Willkommen zurück": "Welcome back", "Arten": "species",
  "NEU": "NEW", "Datenschutz & Impressum": "Privacy & Legal", "Käufe wiederherstellen": "Restore purchases", "entdeckt": "discovered", "Fänge": "catches", "Größter Fang": "biggest catch", "gefangen ·": "caught ·", "Fang": "Catch", "Fisch": "fish",
  "heute übrig": "left today", "Neue Aufträge": "New quests", "Tage": "days", "Std": "h", "min": "min",
  "Tipp ins Wasser zum Auswerfen": "Tap the water to cast", "Ins Wasser klicken zum Auswerfen": "Click the water to cast",
  "GRATIS": "FREE", "Antippen zum Abholen": "Tap to collect", "Ton an": "Sound on", "Ton aus": "Sound off",
  "Musik an": "Music on", "Musik aus": "Music off", "Fische": "Fish", "Ausrüstung": "Gear",
  "Einrichten": "Decorate", "Belohnungen": "Rewards", "ANGELN": "FISH", "Ort": "Spot",
  "WEITER ANGELN": "BACK TO FISHING", "Menü": "Menu",
  "Becken Stufe": "Tank level", "Platz": "Slot", "herausnehmen": "remove", "Becken voll": "Tank full",
  "Noch keine Bewohner": "Nobody lives here yet", "Dein erster Fang zieht hier ein": "Your first catch moves in here",
  "Werbevorschau": "Ad preview", "Deko": "Decor", "Boden": "Floor", "Wand": "Wall",
  "Dein Aquarium": "Your Aquarium", "Wohin geht's?": "Where to?", "Becken": "Tank", "Eintritt": "Admission",
  "Coins/h": "coins/h", "leer": "empty", "VOLL – ABHOLEN": "FULL – COLLECT", "Arten": "species",
  "Einsetzen": "Add", "im Becken": "in tank", "Platz": "Slot", "Eintritt pro Stunde in Klammern": "Admission per hour in brackets",
  "Rekord": "Record", "Noch nichts zu holen": "Nothing to collect yet", "Becken erweitert!": "Tank expanded!",
  "Erst den Fisch landen": "Land the fish first", "Halten zum Spannen, loslassen = Schuss": "Hold to charge, release to shoot",
  "Tipp auf einen Fisch zum Schießen": "Tap a fish to shoot", "Auf einen Fisch klicken zum Schießen": "Click a fish to shoot",
  "Getroffen!": "Hit!", "Daneben": "Missed", "Schnur": "Line", "SCHNUR": "LINE", "Phase": "Phase",
  "ER ZIEHT!": "HE PULLS!", "KURBELN!": "REEL!", "SPRUNG!": "JUMP!", "ER TAUCHT!": "HE DIVES!",
  "Finger weg!": "Hands off!", "Schnell tippen": "Tap fast", "Im Ring tippen": "Tap in the ring", "Gedrückt halten": "Hold it",
  "NICHT ZIEHEN": "DON'T PULL", "GEDRÜCKT HALTEN": "HOLD", "HALTEN!": "HOLD!",
  "Standgehalten": "Held firm", "Hochgezogen!": "Pulled up!", "PERFEKT!": "PERFECT!", "Zu früh!": "Too early!",
  "Verpasst!": "Missed!", "Nicht ziehen!": "Don't pull!", "Zu langsam": "Too slow", "Er erholt sich!": "He recovers!",
  "Er wird wütend!": "He's getting angry!", "Letzte Kraft!": "Last stand!",
  "Ort": "Spot", "Shop": "Shop", "Bonus": "Bonus", "Aufträge": "Quests", "Alle erledigt": "All done", "Fischdex": "Fishdex",
  "Level": "Level", "Anfänger": "Rookie", "Angler": "Angler", "Profi": "Pro", "Kapitän": "Captain", "Meisterangler": "Master Angler", "Legende des Sees": "Legend of the Lake",
  "Coins": "coins", "Gems": "gems", "Serie": "Streak", "Regen – die Fische beißen": "Rain – the fish are biting", "Goldene Stunde": "Golden hour",
  "Regen zieht auf – die Fische beißen!": "Rain is coming – the fish are biting!", "Der Regen hört auf.": "The rain stops.",
  "Einholen": "Reel in", "KLICK!": "TAP!", "Drill!": "Fight!", "Entwischt!": "Got away!", "Schnur gerissen!": "Line snapped!", "Schnur gerissen – ein Treffer hat gefehlt!": "Line snapped – one hit short!",
  "So knapp!": "So close!", "Verscheucht!": "Spooked!", "Verscheucht! Nah dran, nicht drauf.": "Spooked! Close, not on top.", "Jetzt warten… beim ! schnell tippen!": "Now wait… tap fast at the !",
  "Perfekt! ×1.5": "Perfect! ×1.5", "PERFEKT!": "PERFECT!", "Treffer!": "Hit!", "Daneben!": "Missed!", "Weg!": "Gone!", "Treffer": "Hits",
  "Abgeschüttelt! Halten nicht vergessen.": "Shaken off! Don't forget to hold.",
  "Factory New. Float 0.003. Kein Trade-Lock.": "Factory New. Float 0.003. No trade lock.", "Drei Netze auf der Vorderseite. Sammlerstück.": "Three webs on the front. Collector's item.", "Phase 2. Emerald wäre zu teuer gewesen.": "Phase 2. Emerald would've been too pricey.", "100 % Fade. Sagt jeder.": "100 % fade. Everyone says that.", "Blue Gem? Fast. 40 % Blau, Rest Gold.": "Blue gem? Almost. 40 % blue, rest gold.", "Fire & Ice. Der See ist beeindruckt.": "Fire & Ice. The lake is impressed.", "Mit Herz-Muster. Angeblich.": "With a heart pattern. Allegedly.",
  "Talente": "Talents", "Talentpunkt": "talent point", "Talentpunkte": "talent points", "verfügbar – antippen zum Lernen": "available – tap to learn", "Nächster Punkt beim nächsten Level-Up": "Next point at the next level-up", "Rang": "Rank",
  "Ruhige Hand": "Steady hand", "Kräftige Arme": "Strong arms", "Adlerauge": "Eagle eye", "Geduld": "Patience", "Gelehrter": "Scholar", "Feilscher": "Haggler",
  "+8 % Spannungsabbau je Rang": "+8 % tension release per rank", "+6 % Einholtempo je Rang": "+6 % reel speed per rank", "+8 % Lockradius je Rang": "+8 % lure radius per rank", "+10 % Biss-Rate je Rang": "+10 % bite rate per rank", "+25 % Shiny-Chance, +8 % Seltene je Rang": "+25 % shiny odds, +8 % rares per rank", "+5 % Coins je Rang": "+5 % coins per rank", "+6 % XP je Rang": "+6 % XP per rank",
  "Outfits": "Outfits", "Klassisch": "Classic", "Regenjacke": "Rain jacket", "Hawaiihemd": "Hawaiian shirt", "Taucheranzug": "Wetsuit", "Piratenmantel": "Pirate coat", "Polarparka": "Polar parka", "Kapitänsjacke": "Captain's jacket", "Goldanzug": "Gold suit",
  "Dunkler Pulli, Jeans. Zeitlos.": "Dark sweater, jeans. Timeless.", "Gelb wie ein Warnschild. Hält trocken.": "Yellow as a warning sign. Keeps you dry.", "Urlaub am See. Immer.": "Holiday at the lake. Always.", "Neopren mit Neonstreifen. Tiefsee-tauglich.": "Neoprene with neon stripe. Deep-sea ready.", "Passt zum Hut. Und zum Kraken.": "Matches the hat. And the Kraken.", "Mit Fellkragen. Eisloch-Pflicht.": "With fur collar. Ice-hole essential.", "Navy mit Goldknöpfen.": "Navy with gold buttons.", "Für den Angler, der alles hat. Außer Bescheidenheit.": "For the angler who has everything. Except modesty.",
  "Seetang": "Seaweed", "Tipp ins Wasser = einholen": "Tap the water = reel in",
  "Halten zum Einholen – zieht er (rot), loslassen!": "Hold to reel – when it pulls (red), let go!", "ZIEHT! LOSLASSEN!": "PULLING! LET GO!", "◀ ZIEHT LINKS – rechts tippen!": "◀ PULLS LEFT – tap right!", "ZIEHT RECHTS – links tippen! ▶": "PULLS RIGHT – tap left! ▶",
  "Achtung…": "Careful…", "Einholen…": "Reeling…", "HALTEN zum Einholen": "HOLD to reel", "Halten": "Hold", "Einholen": "Reel", "Spannung": "Tension", "hier tippen": "tap here",
  "Halten = einholen · Flucht: Gegenseite tippen": "Hold = reel · burst: tap opposite side", "Halten = einholen · rot = loslassen": "Hold = reel · red = let go", "Gegengehalten!": "Countered!", "Falsche Seite!": "Wrong side!",
  "verloren": "lost", "Serie von": "Streak of", "gerettet!": "saved!", "retten": "save",
  "Fisch gefangen!": "Fish caught!", "Na toll…": "Oh great…", "Beifang!": "Bycatch!", "Klicken zum Weiterangeln": "Tap to keep fishing", "Fang teilen": "Share catch",
  "NEU im Fischdex!": "NEW in Fishdex!", "Neuer Rekord!": "New record!", "Perfekter Drill ×1.5": "Perfect fight ×1.5", "SHINY ×5": "SHINY ×5", "SHINY!": "SHINY!",
  "Die Möwe hat": "The seagull stole", "geklaut!": "!", "Möwe! Antippen!": "Seagull! Tap it!", "Verjagt! +10": "Chased off! +10", "Möwe!": "Seagull!",
  "Zu wenig Coins!": "Not enough coins!", "Zu wenig Gems!": "Not enough gems!", "Auftrag erledigt!": "Quest done!", "Verdoppelt!": "Doubled!", "Nur Seetang.": "Just seaweed.",
  "Erst ab Level": "Requires level", "weiterangeln!": "keep fishing!", "freigeschaltet!": "unlocked!", "Neuer Angelplatz verfügbar (Level erreicht)": "New fishing spot available (level reached)",
  "Totem abgelaufen": "Totem expired", "aktiv!": "active!", "Werbefrei aktiviert – danke! ❤️": "Ad-free activated – thank you! ❤️",
  "LEVEL AUFSTIEG": "LEVEL UP", "Tippen zum Weiterspielen": "Tap to continue", "Nächster Ort:": "Next spot:", "ab Level": "from level", "hinfahren": "travel", "Über": "Via",
  "Tippen zum Schließen": "Tap to close", "Du hast gewonnen:": "You won:", "JACKPOT!": "JACKPOT!", "Hmm.": "Hmm.", "Neuer Skin": "New skin", "im Shop ausrüsten": "equip in the shop",
  "Boss besiegt": "Boss defeated", "Boss besiegt!": "Boss defeated!", "ist Geschichte.": "is history.", "Boss besiegt – der Weg ist frei, ohne Coins und Level": "Boss defeated – the way is open, no coins or level needed",
  "Shiny": "Shiny", "7 Tage Serie": "7-day streak",
  "Einstellungen": "Settings", "Pass": "Pass",
  "Ton": "Sound", "Musik": "Music", "Sprache": "Language", "EIN": "ON", "AUS": "OFF",
  "Rechtliches & Käufe": "Legal & purchases",
  "Werbe-Bonus:": "Ad bonus:", "heute genutzt": "used today",
  "7 Tage in Folge: +2 Gems und ein Erfolg": "7 days in a row: +2 gems and an achievement",
  "erreicht · Seite": "unlocked · page", "gutgeschrieben": "credited",
  "ABHOLEN ▸": "COLLECT ▸", "Alle Orte offen": "All spots unlocked",
  "Angelplätze": "Fishing spots", "Angelplätze – wohin geht's?": "Fishing spots – where to?", "Hier": "Here", "Hinfahren": "Travel", "Arten entdeckt": "species found",
  "Tagesbonus": "Daily bonus", "Login-Serie: Tag": "Login streak: day", "(max)": "(max)", "Tag": "Day", "Tagesbonus abholen:": "Claim daily bonus:", "Heute schon abgeholt – bis morgen!": "Already claimed – see you tomorrow!",
  "Werbung ansehen:": "Watch ad:", "Morgen wieder": "Back tomorrow", "Werbefrei aktiv": "Ad-free active", "bis Level": "to level", "Erfolge": "Achievements", "jeder Erfolg = 1": "each achievement = 1",
  "Tagesaufträge": "Daily quests", "Neue Aufträge in": "New quests in", "Insgesamt erledigt:": "Total completed:", "Kurze Pause": "Short break", "Kostenlos weiter": "Continue for free", "Kostenlos weiter in": "Free in",
  "Werbung ansehen: +": "Watch ad: +", "Coins extra": "extra coins", "Werbung ansehen: weiter": "Watch ad: continue", "Werbefrei für immer · 0,99 €": "Ad-free forever · €0.99", "Werbefrei · 0,99 €": "Ad-free · €0.99",
  "ANZEIGE": "AD", "Platzhalter – hier läuft später das Ad-SDK": "Placeholder – the ad SDK goes here", "Belohnung: doppelte Coins": "Reward: double coins", "Belohnung holen": "Collect reward", "Abbrechen": "Cancel", "Weiter": "Continue",
  "Ab ans Wasser": "Off to the water", "Der Fisch wartet.": "The fish are waiting.", "wartet.": "is waiting.",
  "Losangeln": "Start fishing", "Oder nimm Proviant mit:": "Or take supplies along:", "Proviant: +": "Supplies: +",
  "Kurz durchatmen": "Take a breath", "Dein Becken wartet.": "Your tank is waiting.",
  "Weiter zum Becken": "On to the tank", "Oder hol dir etwas dazu:": "Or grab something extra:",
  "✓ Belohnung ist schon gutgeschrieben": "✓ Reward is already credited", "Schließen": "Close",
  "Seite": "Page", "Fänge · Größter Fang": "catches · biggest", "Nur nachts…": "Night only…", "Rekord": "Record", "gefangen": "caught", "Noch nicht gefangen. Suche": "Not caught yet. Look", "nachts": "at night", "Besserer Köder erhöht die Chance.": "Better bait raises the odds.",
  "nahe der Oberfläche": "near the surface", "am Grund": "on the bottom", "mittlere Tiefe": "mid-water", "nur nachts": "night only",
  "Ruten": "Rods", "Köder": "Bait", "Posen": "Bobbers", "Skins": "Skins", "Hüte": "Hats", "Totems": "Totems", "Glück": "Luck", "Aktiv": "Active", "Ausgerüstet": "Equipped", "Nutzen": "Use", "Ausrüsten": "Equip", "Exklusiv": "Exclusive",
  "Was drin ist, weiß nur der See. Jackpot inklusive.": "Only the lake knows what's inside. Jackpot included.", "Bisher geöffnet:": "Opened so far:", "Aktiv – noch": "Active – ", "Wundertüte": "Mystery bag", "Goldene Wundertüte": "Golden mystery bag",
  "Coins, Köder, Skins – oder Seetang.": "Coins, bait, skins – or seaweed.", "Bessere Chancen auf Skins und den Jackpot.": "Better odds for skins and the jackpot.",
  "Gewöhnlich": "Common", "Ungewöhnlich": "Uncommon", "Selten": "Rare", "Episch": "Epic", "Legendär": "Legendary",
  "Petri Heil!": "Tight lines!", "Der nächste könnte selten sein…": "The next one might be rare…", "Der Shop hat auf": "The shop is open", "Bessere Rute = mehr Fische im Lockradius": "Better rod = more fish in range",
  "Fischdex 50 %": "Fishdex 50 %", "Fischdex komplett!": "Fishdex complete!", "Hut": "Hat",
  "Steg am See": "Lake Pier", "See": "Lake", "Ruderboot · Seemitte": "Rowboat · Mid-lake", "Ruderboot": "Rowboat", "Küste": "Coast", "Korallenriff": "Coral Reef", "Tiefsee": "Deep Sea", "Eisloch · Arktis": "Ice Hole · Arctic", "Eisloch": "Ice Hole",
  "Wo alles anfing. Karpfen, Hecht, Barsch – und ein Stiefel.": "Where it all began. Carp, pike, perch – and a boot.", "Tiefes Wasser, große Räuber. Und Gerüchte über etwas Großes.": "Deep water, big predators. And rumours of something huge.",
  "Salzwasser: Makrele, Krabbe, Oktopus. Die Möwen sind frecher.": "Saltwater: mackerel, crab, octopus. The gulls are bolder.", "Türkis, bunt, warm. Clownfische, Schildkröten, Mantas.": "Turquoise, colourful, warm. Clownfish, turtles, mantas.",
  "Kein Licht außer dem, was die Fische selbst machen.": "No light except what the fish make themselves.", "Ein Loch im Eis, ein Hocker, minus 20 Grad. Heilbutt wartet.": "A hole in the ice, a stool, minus 20. Halibut awaits.",
  "Holzrute": "Wooden rod", "Bambusrute": "Bamboo rod", "Carbonrute": "Carbon rod", "Teleskoprute": "Telescopic rod", "Profirute": "Pro rod", "Titanrute": "Titanium rod", "Poseidons Rute": "Poseidon's rod", "Das erste Projekt": "The first project",
  "Omas alte Rute. Tut's noch.": "Grandma's old rod. Still works.", "Leicht, biegsam, riecht nach Urlaub.": "Light, bendy, smells like holiday.", "Lockt Fische aus größerer Entfernung.": "Attracts fish from further away.", "Passt in jeden Rucksack, reicht bis zur Mitte.": "Fits any backpack, reaches the middle.",
  "Große Reichweite, ruhiges Drillen.": "Long range, calm fights.", "Federt jeden Ruck weg.": "Absorbs every jolt.", "Der halbe See hört auf dich.": "Half the lake obeys you.", "Ein Lernprojekt. Jetzt legendär.": "A learning project. Now legendary.",
  "Regenwurm": "Earthworm", "Brotkugel": "Bread ball", "Mais": "Corn", "Köderfisch": "Bait fish", "Garnele": "Shrimp", "Glitzerköder": "Glitter lure",
  "Der Klassiker. Fängt, was halt kommt.": "The classic. Catches whatever comes.", "Die Kleinen sind sofort da.": "The little ones come instantly.", "Beißt schneller, etwas mehr Seltenes.": "Faster bites, a bit more rare stuff.", "Raubfische lieben ihn.": "Predators love it.", "Delikatesse für Zander und Lachs.": "A delicacy for zander and salmon.", "Legendäre Fische werden neugierig.": "Legendary fish get curious.",
  "Klassiker": "Classic", "Neon": "Neon", "Herz": "Heart", "Erdbeere": "Strawberry", "Goldpose": "Gold bobber", "Fußball": "Football", "Quietscheente": "Rubber duck", "Totenkopf": "Skull", "Regenbogen": "Rainbow", "Discokugel": "Disco ball",
  "Rot-weiß, wie es sich gehört.": "Red and white, as it should be.", "Sieht man auch nachts.": "Visible at night too.", "Für die Fische, die man liebt.": "For the fish you love.", "Süß. Fische stehen nicht drauf, sieht aber gut aus.": "Sweet. Fish don't care, but it looks great.", "Reines Show-Off.": "Pure show-off.", "Abseits gibt's hier nicht.": "No offside here.", "Quak.": "Quack.", "Die Fische werden nervös.": "Makes the fish nervous.", "Wechselt permanent die Farbe.": "Constantly changes colour.", "Saturday Night Fishing.": "Saturday Night Fishing.",
  "Holz": "Wood", "Bambus": "Bamboo", "Carbon": "Carbon", "Eis": "Ice", "Zuckerstange": "Candy cane", "Lava": "Lava", "Gold": "Gold", "Galaxie": "Galaxy",
  "Natur pur.": "Pure nature.", "Knoten inklusive.": "Knots included.", "Matt-schwarz mit roten Ringen.": "Matte black with red rings.", "Grell. Absichtlich.": "Loud. On purpose.", "Kalt wie der See im Januar.": "Cold as the lake in January.", "Weihnachten am See.": "Christmas at the lake.", "Vorsicht, heiß.": "Careful, hot.", "Für den Angler mit Geschmack.": "For the angler with taste.", "Sterne inklusive.": "Stars included.", "Alle Farben. Gleichzeitig. Nacheinander.": "All colours. At once. In turn.",
  "Anglerhut": "Angler hat", "Basecap": "Baseball cap", "Strohhut": "Straw hat", "Weihnachtsmütze": "Santa hat", "Kapitänsmütze": "Captain's cap", "Piratenhut": "Pirate hat", "Zylinder": "Top hat", "Krone": "Crown",
  "Blätterkranz": "Leaf wreath", "Nessie-Mütze": "Nessie beanie", "Möwenhut": "Seagull hat", "Blumenkranz": "Flower crown", "Leuchthelm": "Lamp helmet", "Eiskrone": "Ice crown",
  "Grün, praktisch, unauffällig.": "Green, practical, inconspicuous.", "Schirm nach vorne. Oder hinten.": "Peak forward. Or backward.", "Sommer, Sonne, Sonnenbrand vermieden.": "Summer, sun, sunburn avoided.", "Ho ho ho, ein Karpfen.": "Ho ho ho, a carp.", "Aye aye.": "Aye aye.", "Arrr. Wo ist die Schatzkiste?": "Arrr. Where's the treasure chest?", "Angeln, aber elegant.": "Fishing, but classy.", "König des Sees.": "King of the lake.",
  "Für den, der den See kennt.": "For the one who knows the lake.", "Sie existiert. Du weißt es.": "She exists. You know it.", "Die Möwe sitzt jetzt auf deiner Seite.": "The seagull is on your side now.", "Aloha.": "Aloha.", "Selbst leuchten, statt zu suchen.": "Shine yourself instead of searching.", "Kalt. Königlich. Kalt.": "Cold. Royal. Cold.",
  "Fischdex Steg am See 100 %": "Fishdex Lake Pier 100 %", "Fischdex Seemitte 100 %": "Fishdex Mid-lake 100 %", "Fischdex Küste 100 %": "Fishdex Coast 100 %", "Fischdex Korallenriff 100 %": "Fishdex Coral Reef 100 %", "Fischdex Tiefsee 100 %": "Fishdex Deep Sea 100 %", "Fischdex Arktis 100 %": "Fishdex Arctic 100 %",
  "Gekauft ist noch nicht benutzt. Hier liegt, was bereit ist.": "Buying isn't using. What's ready waits here.",
  "Noch nichts im Vorrat.": "Nothing in your supplies yet.", "Totems gibt es im Shop.": "Totems are in the shop.",
  "Gekauftes landet im Vorrat": "Purchases go to your supplies", "Totems wirken am Wasser": "Totems work at the water",
  "Im Vorrat:": "In stock:", "Nicht im Vorrat": "Not in stock", "im Vorrat": "in stock", "Läuft – noch": "Running –",
  "läuft schon": "is already running", "abgelaufen": "expired", "läuft": "running",
  "Vorrat": "Supplies", "Zum Shop": "To the shop", "Einsetzen": "Use", "Am Wasser": "At the water",
  "Regentotem": "Rain totem", "Nachttotem": "Night totem", "Sonnentotem": "Sun totem", "Lockruf": "Lure call", "Glückstotem": "Luck totem", "Seltenheits-Magnet": "Rarity magnet",
  "90 s Regen – Fische beißen 1,6× schneller.": "90 s of rain – fish bite 1.6× faster.", "Sofort Nacht – Nachtfische kommen raus.": "Instant night – night fish come out.", "Sofort Mittag – für die Tagfische.": "Instant noon – for the day fish.", "3 min doppelte Lock-Rate.": "3 min double attraction.", "5 min vierfache Shiny-Chance.": "5 min quadruple shiny odds.", "5 min doppelt so viele seltene Fische.": "5 min twice as many rare fish.",
  "Fange 3 Fische": "Catch 3 fish", "Fange 5 Fische": "Catch 5 fish", "Fange 8 Fische": "Catch 8 fish",
  "Fange": "Catch", "Fange einen seltenen (oder besseren) Fisch": "Catch a rare (or better) fish", "Fange etwas über": "Catch something over", "perfekter Drill": "perfect fight", "Fange einen Nachtfisch": "Catch a night fish", "Serie von": "Streak of", "Fängen": "catches",
  "verschiedene Arten": "different species", "Fische etwas Müll aus dem Wasser": "Fish some junk out of the water", "Fange einen Fisch im Regen": "Catch a fish in the rain", "Verjage eine Möwe": "Chase off a seagull", "Fische:": "fish:",
  "Warmgeangelt": "Warmed up", "10 Fänge": "10 catches", "Seebär": "Sea dog", "50 Fänge": "50 catches", "Erster Fang": "First catch", "Schuhgröße 44": "Shoe size 44", "Einen Stiefel gefangen": "Caught a boot", "Briefträger": "Postman", "Eine Flaschenpost gefunden": "Found a message in a bottle",
  "Yo-ho-ho": "Yo-ho-ho", "Eine Schatzkiste geborgen": "Recovered a treasure chest", "Nachtangler": "Night angler", "Einen Nachtfisch gefangen": "Caught a night fish", "Legende": "Legend", "Einen Mondfisch gefangen": "Caught a moonfish", "Schwergewicht": "Heavyweight", "Ein Fang über 20 kg": "A catch over 20 kg",
  "Sammler": "Collector", "6 Arten im Fischdex": "6 species in the Fishdex", "Fischdex komplett": "Fishdex complete", "Alle Arten entdeckt": "All species found", "Heiße Serie": "Hot streak", "5 Fänge in Folge": "5 catches in a row", "Wie am Schnürchen": "Like clockwork", "Ein perfekter Drill": "A perfect fight",
  "Regenangler": "Rain angler", "Im Regen gefangen": "Caught in the rain", "Möwenschreck": "Gull scarer", "Eine Möwe verjagt": "Chased off a seagull", "Goldesel": "Cash cow", "1000 Coins insgesamt verdient": "Earned 1000 coins total", "Reisender": "Traveller", "Einen neuen Angelplatz freigeschaltet": "Unlocked a new fishing spot",
  "Weltenbummler": "Globetrotter", "Alle Angelplätze freigeschaltet": "Unlocked all fishing spots", "Meeresbiologe": "Marine biologist", "50 Arten entdeckt": "50 species found", "Hundert!": "One hundred!", "100 Arten entdeckt": "100 species found", "Sie existiert": "She exists", "Nessie gefangen": "Caught Nessie",
  "Falscher Kontinent": "Wrong continent", "Einen Pinguin geangelt": "Fished a penguin", "Acht Arme": "Eight arms", "Einen Oktopus gefangen": "Caught an octopus", "Da unten leuchtet was": "Something glows down there", "Fang in der Tiefsee": "A deep-sea catch",
  "Es glitzert!": "It sparkles!", "Einen Shiny-Fisch gefangen": "Caught a shiny fish", "Shiny-Jäger": "Shiny hunter", "10 Shiny-Fische gefangen": "Caught 10 shiny fish", "Glückspilz": "Lucky one", "Jackpot aus der Wundertüte": "Jackpot from the mystery bag", "Zocker": "Gambler", "20 Wundertüten geöffnet": "Opened 20 mystery bags",
  "Fleißig": "Diligent", "10 Tagesaufträge erledigt": "Completed 10 daily quests", "Angeberfoto": "Bragging photo", "Einen Fang geteilt": "Shared a catch", "Kein Anfänger mehr": "No rookie anymore", "Level 10 erreicht": "Reached level 10", "Level 25 erreicht": "Reached level 25", "Stammgast": "Regular", "7 Tage in Folge eingeloggt": "Logged in 7 days in a row",
  "Ortskundig": "Local expert", "Fischdex eines Orts komplett": "Completed a spot's Fishdex", "Bosskämpfer": "Boss fighter", "Einen Bossfisch besiegt": "Defeated a boss fish", "Herr der Gewässer": "Lord of the waters", "Alle sechs Bosse besiegt": "Defeated all six bosses",
  "Rotauge": "Roach", "Karpfen": "Carp", "Barsch": "Perch", "Forelle": "Trout", "Hecht": "Pike", "Zander": "Zander", "Goldfisch": "Goldfish", "Wels": "Catfish", "Aal": "Eel", "Mondfisch": "Moonfish", "Alter Stiefel": "Old boot", "Flaschenpost": "Message in a bottle", "Schatzkiste": "Treasure chest",
  "Brasse": "Bream", "Schleie": "Tench", "Döbel": "Chub", "Regenbogenforelle": "Rainbow trout", "Saibling": "Char", "Kugelfisch": "Pufferfish", "Piranha": "Piranha", "Lachs": "Salmon", "Neonfisch": "Neon tetra", "Koi": "Koi", "Anglerfisch": "Anglerfish", "Stör": "Sturgeon", "Hai": "Shark",
  "Ukelei": "Bleak", "Kaulbarsch": "Ruffe", "Renke": "Whitefish", "Zwergwels": "Bullhead", "Steinbeißer": "Spined loach", "Graskarpfen": "Grass carp", "Rapfen": "Asp", "Schwarzbarsch": "Black bass", "Sonnenbarsch": "Sunfish", "Seeforelle": "Lake trout", "Quappe": "Burbot", "Marmorkarpfen": "Bighead carp", "Urhecht": "Ancient pike", "Riesenwels": "Giant catfish", "Nessie": "Nessie",
  "Hering": "Herring", "Meeräsche": "Mullet", "Makrele": "Mackerel", "Scholle": "Plaice", "Seestern": "Starfish", "Qualle": "Jellyfish", "Strandkrabbe": "Shore crab", "Dorsch": "Cod", "Seelachs": "Pollock", "Wolfsbarsch": "Sea bass", "Kalmar": "Squid", "Muräne": "Moray", "Seepferdchen": "Seahorse", "Hummer": "Lobster", "Oktopus": "Octopus", "Stechrochen": "Stingray", "Thunfisch": "Tuna",
  "Clownfisch": "Clownfish", "Lippfisch": "Wrasse", "Falterfisch": "Butterflyfish", "Riffbarsch": "Damselfish", "Doktorfisch": "Surgeonfish", "Kofferfisch": "Boxfish", "Drückerfisch": "Triggerfish", "Papageienfisch": "Parrotfish", "Kaiserfisch": "Angelfish", "Feuerfisch": "Lionfish", "Barrakuda": "Barracuda", "Blauring-Oktopus": "Blue-ringed octopus", "Perlmuschel": "Pearl oyster", "Zackenbarsch": "Grouper", "Meeresschildkröte": "Sea turtle", "Riffhai": "Reef shark", "Mantarochen": "Manta ray",
  "Laternenfisch": "Lanternfish", "Grenadierfisch": "Grenadier", "Beilfisch": "Hatchetfish", "Blobfisch": "Blobfish", "Tiefsee-Qualle": "Deep-sea jelly", "Riesenassel": "Giant isopod", "Fangzahnfisch": "Fangtooth", "Viperfisch": "Viperfish", "Gespensterfisch": "Barreleye", "Pelikanaal": "Gulper eel", "Schwarzer Drachenfisch": "Black dragonfish", "Seeteufel": "Sea devil", "Vampirtintenfisch": "Vampire squid", "Koboldhai": "Goblin shark", "Riesenkalmar": "Giant squid", "Taucherstiefel": "Diver's boot",
  "Stint": "Smelt", "Lodde": "Capelin", "Polardorsch": "Polar cod", "Gefrorener Fisch": "Frozen fish", "Kabeljau": "Atlantic cod", "Seesaibling": "Arctic char", "Seeskorpion": "Sea scorpion", "Eisfisch": "Icefish", "Arktischer Lachs": "Arctic salmon", "Seewolf": "Wolffish", "Königskrabbe": "King crab", "Heilbutt": "Halibut", "Verirrter Pinguin": "Lost penguin", "Grönlandhai": "Greenland shark",
  "Der alte Karl": "Old Karl", "Der Kraken": "The Kraken", "Megalodon": "Megalodon", "Leviathan": "Leviathan", "Der Eiskönig": "The Ice King"
}
```

### 6.5 Token rules recap

- Longest-key-first substring match, word-boundary guarded (Unicode letter-aware).
- Exact whole-string match tried before substring decomposition.
- Per-string translation result cached (`I18N.cache`); cache cleared on `set(lang)`.
- No pluralization system, no ICU message format — every distinct phrase is its own
  dictionary entry (see the many near-duplicate quest/achievement lines above).
- Emoji and punctuation are copied through untouched.

---

## 7. Hub / Aquarium — full behavior (`aquarium.js`)

The Hub *is* the aquarium room screen — since the "Becken als Hauptmenü" rework it is not
a place you travel to; it's an overlay-like screen (`hubScreen`) that lies over a **paused**
fishing spot (see §7.9). `FEATURE-AQUARIUM-ALS-ORT.md` and `FEATURE-BECKEN-ALS-HAUPTMENUE.md`
in the old docs are **unbuilt proposals** — not reflected in the current code.

### 7.1 Room composition (3 depth layers)

- **Back**: wooden plank wall (`drawHubRoom`/`_hubRoom`) with a shelf (`drawHubShelf`)
  mounted on it. Room ambient: flat dark base `#241606`, a 34%-black overlay wash over the
  whole wall, one large radial "lamp bleed" gradient near the tank top
  (`rgba(160,215,255,0.26)→0`, the single implied light source), and a vignette radial
  gradient darkening the corners (`rgba(0,0,0,0)→rgba(0,0,0,0.4)`, centered at
  `(w/2, bottom*0.44)`).
- **Middle**: the glowing tank on a sideboard (`drawHubSideboard`).
- **Front**: a workbench (`drawHubBench`) carrying the location-card carousel and the
  ANGELN sign.

### 7.2 Layout geometry (functions of canvas size)

```
shelfY()        = hudTop() + 76
shelfBoardY()   = shelfY() + 44
tankTop()       = shelfBoardY() + 48
hubBenchTop()   = canvas.height - safeBottom - clamp(canvas.height*0.25, 208, 232)
hubSideboardH() = 78 (fixed)
tankBottom()    = hubBenchTop() - hubSideboardH()
tank x/width    = tx=22, tw=canvas.width-44 (22px wall margin each side)
tank shape      = roundRect(tx, top, tw, bot-top, 16)  // 16px corner radius
```

### 7.3 Tank glass & water rendering (still "glass", see §3)

Inside a clip of the rounded tank rect, back to front: water gradient fill (3-stop, from
the selected backdrop, see §7.6), caustics/light shafts (§7.8), gravel/ground band
(§7.6, wavy top edge via `sin(i*1.3)*4` over 16 segments, `gravelY = bot-26`), the 4
decoration slots + treasure chest, fish (§7.4), tank ambient bubbles (§7.7), then a wavy
water-surface stroke line at `top+6 + sin(x/22+uiTime*2)*2.2`, white 55% alpha, 2px.

Glass finish (outside the water clip, still inside the tank rect): two diagonal reflection
bands using `globalCompositeOperation = "lighter"`, gradients `rgba(255,255,255,0.10)` /
`0.055` fading to 0 (skewed quads at 2%/34% of width, 13%/7% wide), then the lamp (§7.8),
then a dark 7px outer frame stroke `rgba(12,20,32,0.9)` and a 2px light inner-edge stroke
`rgba(255,255,255,0.30)`.

### 7.4 Tank capacity & "level" (two separate systems, both loosely called "level")

**A. Slot capacity** — how many fish live in the tank:
```
TANK_BASE_SLOTS = 6, TANK_MAX_SLOTS = 12
tankCapacity() = min(TANK_MAX_SLOTS, TANK_BASE_SLOTS + save.aquarium.extra)
tankSlotCost()  = round(1000 * 1.7^extra)   // 1000, 1700, 2890, 4913, … coins
```
Bought one at a time via `buyTankSlot()` (sideboard button `"＋ Platz ${cost}"`, greys
out at max). No visual tank-size change with capacity — same glass rectangle, just more
fish slots.

**B. "Becken Stufe" (1–3 stars)** — a cosmetic composite score on a sideboard plaque:
```
score = slots.length/TANK_MAX_SLOTS + decorSlotsFilled/DECOR_SLOTS + extra/(TANK_MAX_SLOTS-TANK_BASE_SLOTS)
stars = clamp(floor(score/3*3)+1, 1, 3)
```
Rendered as `★★★` (filled gold `#ffd23a`, unfilled `rgba(255,255,255,0.2)`) plus
`"Becken Stufe ${st}"` in a `Wood.inset` plaque, 18px from left, 26px below `tankBottom()`,
36px tall.

**C. Passive income "fill"** (unrelated third meter): each occupied slot yields
coins/hour by species value/rarity/record size; storage caps at
`tankCap() = tankRatePerHour() * TANK_CAP_HOURS` (`TANK_CAP_HOURS = 8`). `TANK_RATE_F =
0.06` — tuned so passive tank income stays roughly 8% of active-fishing income.

### 7.5 Which fish move in / tank fish AI

Selection: `save.aquarium.slots` is player-chosen (persisted species-id array), filtered
to species actually caught (`save.dex[id]`). Empty slots up to `tankCapacity()` auto-fill
with the **highest-value known non-junk species not already in the tank**. Manual add/
remove via the Decorate → Fish tab (tap "Einsetzen" to add if room, "herausnehmen" to
remove). Exactly `tankCapacity()` fish render simultaneously; **no cycling/rotation** —
species beyond capacity simply aren't placed until the player swaps manually.

Per-fish object (`rebuildTankFish()`, id-preserving across rebuilds so swim state
survives unrelated changes):
```js
{ id, sp, x: W*(0.15+prnd(i,501)*0.7), y: lerp(top+40,bot-50,prnd(i,502)), baseY: y,
  dir: prnd(i,503)<0.5?-1:1, speed: 14+prnd(i,504)*18+sp.speed*6,
  tail: prnd(i,505)*6, phase: prnd(i,506)*6, turnT: 0 }
```
Update (`updateTankFish(dt)`):
- Horizontal drift: `x += dir*speed*dt` (≈14–32 px/s).
- Tail wag: `tail += dt*(5+speed*0.15)`.
- Vertical bob: `y = clamp(baseY + sin(phase*0.7)*12, top+20, bot-30)`, `phase += dt`
  (12px amplitude, ≈0.11Hz).
- Wall avoidance: flips `dir` and rerolls `baseY` within a species-size margin
  (`tankUnit(sp)`) at `x > width-24-u` or `x < 24+u`.
- Random turns: `turnT` counts down from `rand(4,9)`s; on expiry, 35% chance to flip
  `dir` independent of wall bounces.
- Render size: `tankUnit(sp) = clamp(13 * len^0.6 * uiScale(), 13, 30)` — compressed scale
  so large species don't dominate the glass.
- Drawn with the same shared `drawFishShape` used at the fishing spot, `{glow, caustic:
  0.45, ct: uiTime, wx: x}`.

### 7.6 Decorations, ground & backdrop catalogs

**9 decoration items** (`TANK_DECOR`), 4 fixed placement slots
(`slotXs = [w*0.13, w*0.31, w*0.69, w*0.87]` — the middle 38% is deliberately empty, that's
where the chest sits), default `{slots:["pflanzen",null,null,null]}`, no in-tank tap-to-add
(placement happens via the Decorate menu only):

| id | name | price | notes |
|---|---|---:|---|
| `pflanzen` | Wasserpflanzen | free (default) | 4 swaying blade stems, `sin(uiTime*0.9+i)*6*s` |
| `stein` | Findling | 200 coins | grey rock polygon + highlight stroke |
| `amphore` | Amphore | 450 coins | tilted amber vase, two handle arcs |
| `wrack` | Schiffswrack | 800 coins | brown hull polygon, plank seams, broken mast, moss patch |
| `helm` | Taucherhelm | 1000 coins | dome+collar radial gradient, viewport w/ glint, 5 rivets |
| `burg` | Aquarienburg | 1400 coins | 3 towers (heights −22/+44/+38 offsets), crenellations, gate arch |
| `vulkan` | Blubbervulkan | 1800 coins | triangular volcano, dark crater, 5 animated rising bubbles, orange glow |
| `schaedel` | Schädel | 12 gems | skull dome+jaw, eye sockets, teeth lines |
| `kristall` | Leuchtkristall | 18 gems | 3 glowing shard triangles, pulsing shadowBlur `0.6+0.4*sin(uiTime*1.6)` |

**5 ground textures** (`TANK_GROUNDS`): `kies` (Heller Kies, free, default), `sand`
(Feiner Sand, 250c), `vulkan` (Vulkangestein, 600c, dark), `koralle` (Korallensplit, 900c,
pink), `gold` (Goldsand, 15 gems). Drawn as a gradient wavy band + 22 randomly-placed
(`prnd`) pebble dots cycling 4 colors.

**5 backdrops** (`TANK_BACKS`, 3-stop gradient each): `schlicht` (free, default), `tief`
(Tiefes Blau, 300c), `riff` (Riffgrün, 700c), `daemmer` (Dämmerung, 1100c), `abyss`
(Abyss, 20 gems).

No level-gating on any decor unlock — purely coin/gem purchase.

### 7.7 Bubbles

Tank ambient bubbles (`tankBubbles`): spawn Bernoulli `random() < dt*2.2` per frame
(~2.2 events/sec expected), born at `x: 30+random*(w-60)`, `y: bot-6`, radius `1.5+
random*2.5`, rise speed `26+random*30` px/s, horizontal wobble `sin(t*3)*6*dt`; removed
at `y < top+8`. Drawn as circle strokes `rgba(230,248,255,0.65)` 1.2px. The volcano decor
has its own separate 5-bubble crater stream, purely decorative.

### 7.8 Light shafts / caustics / lamp

Inside the water clip, `globalCompositeOperation:"lighter"`:
- **9 "caustic sickle" arcs**: cyclic phase/envelope system (`env = sin(local*π)²`, fades
  below 0.03 to invisible) so each reappears in a new random position only while fully
  invisible (no hard pop-in). Drawn flattened (`scale(1,0.55)`) as two concentric arc
  strokes, radius 13–33px.
- **6 gravel light patches**: same cyclic-envelope technique, soft ellipses near `bot-20`.
- **12 suspended particles**: drifting motes, horizontal wrap-around drift `4+prnd*7`
  px/s, vertical bob `sin(uiTime*0.6+i)*7`, pulsing alpha.
- **Lamp** (outside the water clip): dark hood rectangle above the tank, light-edge strip,
  a cyan tube-glow bar, and a big soft light-cone gradient fanning down into the tank
  (clipped to the tank rect).

### 7.9 World-pause model (why the Hub can sit "over" a live fishing spot)

```js
function update(dt) {
  uiTime += dt;                            // surface clock: always runs
  if (!worldPaused()) updateWorld(dt);      // fishing spot: only while actually played
  updateAlways(dt);
}
function worldPaused() {
  return hubScreen || Intro.active || storyActive() || !!overlay || !!Ads.current || !!Ads.gate;
}
```
Two clocks: `time` (world clock — waves, weather, fish, caustics, rod shake, sonar beam,
scenery) freezes under `worldPaused()`; `uiTime` (surface clock — hub room, story
cutscenes, menu tablets, gacha, level-up) never stops, so an open menu never looks frozen
mid-animation. `updateEffects()` similarly splits into `updateWorldFx()` (splashes, wave
rings, bubbles, clouds — paused with the world) and `updateUIFx()` (confetti, coin-flies,
floating text, tap-echo, press feedback — always running, since a touch must always get a
visible response even inside a menu). Totem timers (`updateTotems`) live in `updateWorld`
— **spent while fishing, not by the calendar**: a 90s rain totem only counts down while
actively at the water; open the hub, a menu, or the tackle box and it holds. Tank
passive-income accrual, by contrast, uses real wall-clock time (`Date.now()` vs
`save.aquarium.lastTick`) and keeps accruing even while the app is closed — deliberately
the one exception.

Boss cutscenes (`cutscene`, §8.10) are the one exception in the *other* direction: they do
**not** pause the world — they're an in-scene event (you still see water/angler/boss), not
a menu.

**Three hub states**: `!hubScreen` (at the water, world runs); `hubScreen && hubReturn`
(hub laid over a paused, resumable spot); `hubScreen && !hubReturn` (cold start — the hub
*is* the whole screen, nothing to resume). `hubReturn` is not a save field — it's derived
from whether a session exists to return to.

### 7.10 Hub-only music (`music.js MOODS.hub`)

Same procedural synth engine as the 6 locations, no audio files, distinct mood:

| | Lake Pier | Hub room |
|---|---|---|
| Root note | 220.0 Hz | 293.7 Hz (a fourth higher) |
| Scale | major | major |
| Chord length | 5.5s | 3.6s (faster) |
| Filter cutoff | 1600 Hz | 2800 Hz (brighter) |
| Lead instrument | nylon string | marimba |
| Percussion | shaker, rate 0.5 | wood block, rate 1.1 |
| Swing | 0.55 | 0.62 (bouncier) |

Marimba+wood-block deliberately chosen as "wood instruments in a wood room." No night
dimming in the hub (the tank lamp is always lit; the clock visually stands still there),
ambient rain/birds are replaced by a quiet bubble hiss. Track changes cross-fade: master
gain dips to ~¼ over 0.20s and recovers over 0.55s, new chord entering at the dip
(measured: gain 0.30 → minimum 0.0751 at ~230ms → back to 0.30 by ~780ms, both directions).

### 7.11 Shelf (4 furniture icons, not the overlay tab-rail)

`drawHubShelf()`: a wood shelf mounted on the back wall, 4 icons, columns
`cw=(w-12)/4`, icons scaled 1.3× with a ground-contact shadow ellipse; labels painted
directly on the shelf's front board (chalk style, `±0.015rad` random tilt per item).

| id | label (DE/EN) | icon draw | opens |
|---|---|---|---|
| `dex` | Fische / Fish | small blue book w/ fish | Fishdex overlay |
| `shop` | Ausrüstung / Gear | 3 angled rods | Shop overlay |
| `decor` | Einrichten / Decorate | potted swaying plant | Decorate overlay (fish tab) |
| `daily` | Belohnungen / Rewards | corkboard w/ red-pinned note | Daily-bonus or Quests overlay (whichever has something) |

Badges: max **2** shown at once (a deliberate discipline enforced by `badgeMarks()`).
Green circle+number = claimable count (caps display at "9+"); red dot (no number) =
"something new." Priority order when more than 2 apply: bonus > shop > dex, sliced to 2.
Hit area is taller than the visible icon (`{y: by-50, h:78}`) for comfortable touch.

### 7.12 Location carousel ("Ortsband")

Full mechanics and interaction already captured verbatim in §9 (Input model) and here:

`LOC_CARD_W=104, LOC_CARD_H=104, LOC_CARD_GAP=10` (step 114px); `locBandY() =
hubBenchTop()+16`; centered card at `canvas.width/2`; sized so **3 cards are visible** on
a 390px screen (center + a cut-off card each side, an implicit "there's more, swipe"
affordance).

Card: `Wood.plank` tile (brighter `#9a6a3c` tone if owned, dull `#6b5a48` if locked)
inside a rounded rect with drop shadow; inset "picture window" mini-scene per
`loc.mode` (`dock`=forest+pier silhouette, `boat`=rowboat+rod, `pier`=stone jetty+rod,
`ice`=ice hole+post, `dive`=dark abyss+lamp cone, no sky — deliberately no emoji);
location name in bold 12.5px chalk-style text; if owned, `"${discovered}/${total} Arten"`
plus a small progress bar (green at 100%, else blue); if locked, a lock icon plus either
`"ab Level ${loc.level}"` (orange `#ffb066`) or the coin price (gold `#ffd23a` + coin
icon), whichever gate applies. Locked cards still show the artwork under a dark wash
(`rgba(18,24,34,0.42)`) — never a blind lock icon alone.

Selected card: 6px higher, tilt ~0 (`±0.014rad`) vs. neighbors up to `±0.085rad`; warm
radial glow behind it (`rgba(255,201,86,0.34)`), thin brass stroke outline
(`rgba(255,206,96,0.9)` 2px). Scale falls off with distance: `s = clamp(1-d*0.14,0.8,1)`.
A row of small nail-heads under the cards marks each location; the selected one shows a
polished gold dot instead of a plain nail.

Drag physics: exponential ease-out follow, `scroll += (target-scroll)*min(1,dt*12)`
(time-constant ≈83ms), frozen while actively dragging. Full down/move/up gesture spec is
in §9.

### 7.13 ANGELN button

`drawHubAction()`: `bx=18, by=canvas.height-safeBottom-bh-14, bw=canvas.width-36
(≈full width), bh=58`. A `Wood.sign` (seed 606, 4 nails, tilt 0.005rad), not a gradient
button. Font `bold 22px`. States:

| State | Label | Style | onClick |
|---|---|---|---|
| Owned + is the paused location | **WEITER ANGELN** / BACK TO FISHING | gold text `#ffd23a`, rod icon | `closeHub()` (resume) |
| Owned, no matching paused session | **ANGELN** / FISH | gold text, rod icon | `enterLocation(dest)` (travel) |
| Locked, level too low | lock icon + "Ab Level N" | 12px, dim beige `rgba(245,236,216,0.55)`, dark wash | disabled |
| Locked, affordable | lock icon + "Freischalten · price" | sign painted green `#2f9a45`, near-white text `#eaffea` | buy+unlock |
| Locked, can't afford | lock icon + price | muted beige text, dark wash `rgba(12,6,2,0.42)` | disabled |

### 7.14 Chest ("Ernte-Truhe")

Position: `chestX=w*0.5, chestY=gravelY-8-hop` (center of the tank floor, in the gap
between decoration slots). Idle bounce only once collectible: `hop = |sin(uiTime*(full?
4:2))| * (full?5:2)` — full = `stored >= tankCap()*0.99`. Drawn via
`drawChestIcon(x,y,15,false,full)`. Floating number above it when `ready` (`stored>=1`):
gold `#ffd23a` (full) / lighter `#ffe9a8` (not full), bold 13px, 4px black outline stroke
`rgba(0,0,0,0.55)`. Hit rect `{x-30,y-42,60,58}` → `harvestAquarium()`, explicitly the
**only tappable thing inside the tank glass itself**.

`harvestAquarium()`: collects `floor(stored)` coins; if `<1`, `Sound.fail()` + toast
**"Noch nichts zu holen"** (Nothing to collect yet); otherwise adds coins, spawns up to 24
coin-fly particles, `Sound.catchJingle(1)`, haptic `[15,25,40]`, floating text
`"+${n} Eintritt"`, fires a quest event, saves.

### 7.15 Empty-state notes

Two, both hand-drawn `Wood.paper` pinned notes, hard-coded German text (no i18n dict
routing found for these two strings — `I18N.num()` is used elsewhere in the file, but not
for these literals):

1. **No fish in tank at all**: 214×60px (or `w*0.62` if narrower) note at
   `top + (bot-top)*0.34`, seed 88, `rot:-0.04`, pinned, light paper. Line 1 (bold 14px):
   **"Noch keine Bewohner"**. Line 2 (11px, `rgba(58,42,20,0.78)`): **"Dein erster Fang
   zieht hier ein"**.
2. **No known species in the fish-picker tab**: pinned note, seed 5150, teal pin
   (`pinColor:"#3fc7a8"`), text wrapped to 2 lines: **"Fang deinen ersten Fisch, dann
   zieht er hier ein."**

### 7.16 Other interactive hub elements

- **Settings / close wall-signs** (`drawHubSettingsHook`, top-right corner,
  `by=hudTop()+4`): gear sign at `x=canvas.width-104` → `openOverlay("settings")`; a
  second sign at `x=canvas.width-56` with a chalk "✕", **only rendered if `hubReturn`** →
  `closeHub()`. Both are 44×44 nailed `Wood.sign`s with slight rotation.
- **Decorative wall rope** (`drawWallRope`, only when `!hubReturn`, replacing the close
  sign): a hung rope coil, purely decorative, no hit target.
- Sideboard "＋ Platz" button and the star plaque (§7.4).

### 7.17 Animation timings/easings (aquarium.js, consolidated)

| Element | Formula | Notes |
|---|---|---|
| Hub veil open/close | `hubVeil -= dt/0.16`, `alpha=0.55*veil²` | ~160ms countdown, quadratic-eased alpha |
| Location band follow | `scroll += (target-scroll)*min(1,dt*12)` | exp ease, τ≈83ms, frozen while dragging |
| Tank fish speed | `14+prnd*18+sp.speed*6` px/s | per-fish constant |
| Tank fish bob | `baseY+sin(phase*0.7)*12` | 12px amplitude, ≈0.11Hz |
| Tank fish tail | `tail += dt*(5+speed*0.15)` | speed-linked |
| Tank fish turn timer | `rand(4,9)`s, 35% flip chance on expiry | independent of wall bounce |
| Chest bounce (ready) | `|sin(uiTime*2)|*2`px | |
| Chest bounce (full) | `|sin(uiTime*4)|*5`px | |
| Tank bubble spawn | Bernoulli `random()<dt*2.2` | ~2.2/s |
| Tank bubble rise | `26+random*30` px/s, wobble `sin(t*3)*6*dt` | |
| Caustic sickles (9) | phase `uiTime*(0.35..0.75)+k*1.7`, envelope `sin(local*π)²` | cycle ≈8–18s |
| Gravel light patches (6) | phase `uiTime*(0.5..0.85)+i*2.3` | same envelope technique |
| Suspended particles (12) | drift `4+prnd*7`px/s, bob `sin(uiTime*0.6+i)*7` | |
| Water surface line | `sin(x/22+uiTime*2)*2.2` | traveling wave |
| Volcano decor bubbles | `t=(uiTime*0.5+i/5)%1` | ≈2s period |
| Crystal decor pulse | `0.6+0.4*sin(uiTime*1.6)` glow multiplier | ≈0.25Hz |
| Location card lift | static `clamp(6-d*12,0,6)` | distance-based, not time-animated |
| Location card tilt | static `(prnd(i,77)-0.5)*(active?0.014:0.085)` | per-card deterministic, not time-animated |

No named/library easing curves anywhere in this file — all hand-rolled (exponential
follow, sine oscillation, squared-sine fade envelopes).

### 7.18 Key globals/functions this file defines (cross-reference for §10)

State: `hubScreen, tankFish, tankBubbles, tankPickSlot, TANK_BASE_SLOTS, TANK_MAX_SLOTS,
TANK_CAP_HOURS, TANK_GROUNDS, TANK_BACKS, TANK_DECOR, DECOR_SLOTS, TANK_RATE_F,
LOC_CARD_W, LOC_CARD_H, LOC_CARD_GAP, locBandScroll, locBandTarget, hubDrag, hubReturn,
hubVeil, decorSlot, decorTab`.

Economy/state functions: `aquariumState, tankCapacity, tankSlotCost, tankRatePerHour,
tankCap, updateAquarium, harvestAquarium, buyTankSlot, tankDecor, tankGround, tankBack,
decorOwned, buyDecorItem, tankStars, rebuildTankFish, tankUnit, updateTankFish,
enterLocation, travelToLocation, hubBlocked, showHub, openHub, closeHub, updateHubVeil`.

Draw/layout/input functions: `drawDecorItem, shelfY, shelfBoardY, tankTop, hubBenchTop,
hubSideboardH, tankBottom, locBandStep, locBandY, locBandIndex, hubLocation,
locBandSyncToCurrent, updateLocBand, drawLocMini, drawHubBench, drawLocBoard, drawLocBand,
locBandHit, locBandCardAt, locBandDown, locBandMove, locBandUp, drawHub, drawHubRoom,
drawHubSettingsHook, hubWallSign, drawCloseCross, drawWallRope, drawHubSideboard,
drawHubShelf, drawShelfBook, drawShelfRods, drawShelfPlant, drawShelfBoard, drawHubAction,
drawHubVeil, drawDecorMenu, drawDecorPager, drawTankFishPicker`.

---

## 8. Story (`story.js`, `cutscene.js`)

Two **distinct** systems, easy to conflate:

- **`story.js`** — 6 narrative "chapter" cutscenes (`STORY.see/boot/kueste/riff/tiefsee/
  arktis`), one per location, ~26–30s each, triggered on **first visit** to that location.
  Cinematic camera moves, letterbox, subtitles, an ambient synth score.
- **`cutscene.js`** — a separate, short (**fixed 4.2s**) "boss appears" stinger
  (`startCutscene(sp)`), triggered by boss-encounter game logic (not by this doc's files —
  `bossfight.js`), reusing the live fishing-spot scene geometry rather than its own stage.

### 8.1 Story stage & API

Fixed virtual stage `ST_W=390, ST_H=844, ST_HZ=322` (horizon), letterboxed/scaled with
`contain` fit into the real canvas — identical framing on every device. Public API:
`startStory(id)`, `updateStory(dt)`, `drawStory()`, `storyActive()`, `storyTap()`,
`maybeStartStory(locId)` (only starts if not already seen: `save.storySeen[id]`).

```js
function storyLocationId() {
  return (story && LOCATIONS.some(l => l.id === story.id)) ? story.id : null;
}
```
While a chapter runs, the rest of the game treats its location as "current" (palette,
music mood, angler vs. diver) **without** touching `save.location` — purely a view for the
scene's duration.

### 8.2 Timeline system (`Timeline`, `Ease`)

```js
const Ease = {
  linear: t=>t, hold: ()=>0,
  in: t=>t*t, out: t=>1-(1-t)*(1-t),
  inOut: t=> t<0.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2,
  inCubic: t=>t*t*t, outCubic: t=>1-Math.pow(1-t,3),
  inOutCubic: t=> t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2,
  outBack: t=> 1+2.2*Math.pow(t-1,3)+1.6*Math.pow(t-1,2),
  outElastic: t=> t===0||t===1 ? t : Math.pow(2,-9*t)*Math.sin((t*10-0.75)*(Math.PI*2/3))+1
};
```
Every animated value in a scene is a named **track**: an array of `[time, value, ease?]`
keyframes (`ease` defaults to `"inOut"`, `"hold"` freezes the previous value until the next
key). `Timeline.sample(name,t)` linearly interpolates between the bracketing keys through
the named ease (color-valued tracks lerp through `lerpColor`). `cues` are one-shot side
effects (sound/haptics/particles) fired once when `t` crosses their timestamp; `subs` are
subtitle line objects. `seek(t, fire)` supports scrub/skip — cues already passed on a skip
are marked fired **without** re-firing (`fire=false`), so skipping never double-plays a cue.

`stShell(dur, outro)` supplies 5 tracks every chapter gets for free:
```js
fade:      [[0,1],[1.3,0,"outCubic"],[outro,0,"hold"],[outro+1.5,1,"inOut"]]
letterbox: [[0,0],[1.1,1,"outCubic"]]
hintA:     [[0,0],[1.6,0.55,"out"],[5.0,0.55],[7.0,0,"in"]]
titleA:    [[0,0],[outro+1.4,0,"hold"],[outro+2.6,1,"outCubic"]]
vignette:  [[0,0.22],[dur*0.5,0.45],[outro,0.62]]
```

### 8.3 Rendering pipeline (`drawStory`)

`contain`-fit into the real canvas (`s=min(w/390,h/844)`, centered), clipped to the
390×844 stage. World-space (camera-transformed) layers back→front: sky/stars/moon/shore →
far fog → underwater tint → water surface (with agitation) → ripple rings → back platform
half → angler-or-diver → front platform half → fishing rod (with slack/agitation) → the
**boss creature** (each chapter's bespoke `paint(c,tl,pal,set)`, drawn last among world
content, i.e. nearest the camera) → splash-drop particles → near fog. Screen-space layers
on top: a radial vignette (`rgba(0,0,10,0)→rgba(0,2,14,vignette)`), the **letterbox bars**
(see below), the subtitle box/big-text, the "tap to skip" hint, a fade-to-black overlay,
then the chapter title card.

**Camera** is a literal 2D transform applied to the world layers only:
```js
translate(ST_W/2, ST_H/2); scale(camZoom); rotate(camRot);
translate(-(camX + shakeX), -(camY + shakeY));
```
driven entirely by 4 timeline tracks (`camZoom, camX, camY, camRot`) plus an optional
`shake` track (adds `sin(uiTime*47)*9*shake` / `cos(uiTime*61)*7*shake` jitter) — a
scripted dolly/zoom/tilt per chapter, no physics/follow behavior, no shared camera object.

**Letterbox**: `barH = ST_H*0.085*letterboxTrack` (max ≈71.7px at 844 stage height), two
solid `#04060c` bars top/bottom plus a 1px `rgba(255,255,255,0.06)` inner edge line each.
Fades in over the shared `letterbox` track (`[[0,0],[1.1,1,"outCubic"]]` — 1.1s ease-out),
stays up for the whole chapter (no explicit fade-out track — it's covered by the shared
`fade` full-black overlay at the very end instead).

### 8.4 Subtitles & title card (verbatim styling)

`stSubtitle(c, s, barH)` — two subtitle styles selected per line via `style`:
- **`"box"`** (default): parchment card, bold `700 17px 'Segoe UI', system-ui,
  sans-serif`, width = `min(ST_W-36, textWidth+32)`, height = `lines*23+24`, positioned
  centered horizontally, `y = ST_H-barH-bh/2-26`, rotated **−0.014rad**, popping in via
  `scale(lerp(0.9,1,pop))` (`pop = Ease.outBack(fadeInAlpha)`); a drop shadow rect, a
  `#fffaf0→#f2e4cb` gradient card fill, a `#171a24` 3px stroke border, `#171a24` text.
- **`"big"`** (chapter-ending line, e.g. "Der alte Karl."): centered at `y = ST_H *
  (s.yFrac||0.70)`, `scale(lerp(0.86,1,pop))`, font `900 40px 'Segoe UI', system-ui,
  sans-serif`, black stroke `#0b0e16` width 9 + `shadowBlur 22` `rgba(0,0,0,0.85)`, fill
  is a vertical gradient `#ffffff→#ffd98a`.
- Fade in/out: `inA = clamp((t-s.t)/0.35,0,1)`, `outA = clamp((s.t+s.dur-t)/0.4,0,1)`,
  `alpha = min(inA,outA)` — **0.35s** fade in, **0.4s** fade out per line.

`stTitle(c, a, scene)` (the post-chapter title card): `cy = ST_H*0.44`. Chapter label
(e.g. "KAPITEL 1") — gold `#ffd23a`, `700 15px`, 4px letter-spacing, at `cy-42`. Title
(e.g. "Der See") — white `#fff`, `shadowBlur 18` `rgba(0,0,0,0.7)`, `700 40px`, at
`cy+4`. A thin gold divider line (`rgba(255,210,58,0.55)`, 1.5px, ±52px) at `cy+40`.
Sub-label (e.g. "Steg am See") — `rgba(255,255,255,0.65)`, `400 13px`, at `cy+62`.
Pulsing prompt **"Tippen zum Weiterspielen"** (hard-coded, not i18n-key-routed here, but
covered by the dictionary word-substitution mechanism since "Tippen zum Weiterspielen" IS
a dictionary key → "Tap to continue") — alpha `(0.45+0.4*|sin(uiTime*2.2)|)*a`, `700
15px`, at `ST_H*0.76`.

### 8.5 Story audio (`StoryAudio`)

A 4-voice detuned pad + sub-bass synth, entirely procedural (no audio files), layered
under/replacing the location's ambient music for the scene's duration (ducks
`Music.filter` to 240Hz over 0.6s on start, restores over 1.5s on stop).

**5 moods** (dramaturgy — same across every chapter, the emotional arc every chapter
follows): `calm, wonder, unease, dread, awe` — each a 4-note chord (Hz), a lowpass cutoff,
a gain, and a sub-bass note.

**6 per-chapter "tunes"** (what makes each chapter sound distinct — a deliberate fix for
an earlier version where all 6 chapters shared one key/timbre):

| id | transpose (semitones) | top-voice shift | osc A / osc B | detune | filter brightness |
|---|---:|---:|---|---:|---:|
| `see` | 0 | 0 | triangle/sine | 5 | 1.15 (warm evening) |
| `boot` | −3 | −1 | sawtooth/triangle | 9 | 0.80 (fog, cool, uncertain) |
| `kueste` | +2 | +2 | square/triangle | 11 | 1.00 (salt & wind, hard) |
| `riff` | +5 | 0 | triangle/sine | 6 | 1.40 (bright, tropical, open) |
| `tiefsee` | −7 | −2 | sine/sine | 3 | 0.50 (deep, dull, pressure) |
| `arktis` | −1 | +1 | sine/triangle | 4 | 1.30 (glassy, clear, cold) |

`swell(dur,vol,f0)` — a filtered noise burst (bandpass sweeping f0→f0×3) used for
"water breaks / ice cracks / fog rolls in" moments.

### 8.6 Six chapters — full data verbatim

Each chapter is `stScene({...})`: `chapter, title, sub, mood0, duration, labels.outro,
set{...}, tracks{...}, cues[...], subs[...], paint(c,tl,pal,set)`. `outro` marks where the
title card sequence begins; tapping before it jumps straight there (skip), tapping after
ends the chapter (`storyTap()`).

#### Chapter 1 — `see` (KAPITEL 1 · "Der See" · Steg am See · boss: Der alte Karl / Old Karl)
`duration 28.5s, outro 24.0s`. Set: dock platform, angler on a pier.
Subtitles (verbatim DE — see §0 header note: **not translated**, i18n dictionary has no
entries for these full sentences):
```
1.7s  "Abend am Steg.\nWie jeden Abend."
5.6s  "Das Wasser steht still.\nDann steht es nicht mehr still."
10.0s "Etwas verdrängt Wasser.\nSehr viel Wasser."
15.9s "Man sagt, er sei älter\nals der Steg."
19.4s "Er schaut kurz. Dann geht er."
22.4s "Der alte Karl."  (style: "big")
```
Creature: an ancient giant carp breaks the surface with a warm-eyed, non-threatening
"awe" beat (drawn with two eye-wrinkle strokes and a warm radial highlight — "an old eye,
not a monster stare," per the source comment) at 150,600, moss growth on its back.

#### Chapter 2 — `boot` (KAPITEL 2 · "Die Seemitte" · Ruderboot · boss: Nessie)
`duration 30.5s, outro 25.8s`. Set: rowboat mid-lake.
```
1.6s  "Seemitte.\nHier ist es tief."
5.2s  "Hier draußen soll Nessie\nleben. Sagen sie."
8.8s  "Sagen sie seit\nhundert Jahren."
12.0s "Nebel. Aus dem Nichts."
15.4s "Da war etwas."
18.4s "Das ist kein Fisch."
22.9s "Nessie.\nSie existiert."  (style: "big")
```
Creature: `drawSerpentRise` — a long-necked serpent rising through fog, culminating in a
"glint" eye-catch beat.

#### Chapter 3 — `kueste` (KAPITEL 3 · "Die Küste" · Steinmole · boss: Der Kraken / The Kraken)
`duration 26.5s, outro 22.0s`. Set: stone-pier platform, cliff shore.
```
1.6s  "Salzwasser.\nDie Möwen sind still."
5.4s  "Erst weicht das Wasser zurück."
9.0s  "Dann kommt es zurück.\nMit Begleitung."
13.6s "Acht Arme legen sich\nauf die Mole."
17.4s "Zwei Augen. Waagerecht."
20.4s "Der Kraken."  (style: "big")
```
Creature: 4 individually-swaying tentacles (staggered rise, suckers) grip the pier before
the mantle (`CREATURE_DRAW.octopus`) surfaces.

#### Chapter 4 — `riff` (KAPITEL 4 · "Das Riff" · Korallenriff · boss: Megalodon)
`duration 26.0s, outro 21.5s`. Set: boat on a reef, palms.
```
1.6s  "Türkis, warm, laut.\nDas Riff lebt."
5.6s  "Und dann, auf einmal:\nalle weg."
9.6s  "Der Schatten passt\nnicht ins Riff."
13.4s "Eine Flosse. Nur eine Flosse."
17.0s "Und die ist so hoch wie das Boot."
19.6s "Megalodon."  (style: "big")
```
Creature: reef fish flee off-screen, a giant dorsal fin crosses the frame right→left, then
the head breaks the surface at a steep angle.

#### Chapter 5 — `tiefsee` (KAPITEL 5 · "Die Tiefsee" · Ohne Sonne · boss: Leviathan)
`duration 27.0s, outro 22.5s`. Set: **no angler/rod/dock** — a diver with a headlamp
(`diver: {x:300,y:300,s:26}`), `shore:"none", deep:true`.
```
1.7s  "Kein Licht außer dem,\ndas die Fische selbst machen."
5.6s  "Die Lampe reicht acht Meter.\nDer Graben ist tiefer."
9.4s  "Unten leuchtet etwas.\nUnd es wird größer."
13.4s "Das ist keine Qualle."
16.6s "Es hat den Graben\nnur besucht."
20.4s "Leviathan."  (style: "big")
```
Creature: a rising cyan glow from below (radial gradient, pulsing) precedes another
long-necked serpent rise (shared `drawSerpentRise` as Nessie, different color/tune).

#### Chapter 6 — `arktis` (KAPITEL 6 · "Die Arktis" · Ein Loch im Eis · boss: Der Eiskönig / The Ice King)
`duration 27.5s, outro 23.0s`. Set: a stool over an ice hole, icebergs.
```
1.7s  "Minus zwanzig.\nEin Loch im Eis, ein Hocker."
5.6s  "Man hört hier alles.\nAuch das, was weit weg ist."
9.4s  "Das Eis knackt.\nWeit draußen."
12.6s "Näher."
16.4s "Das Loch war vorher\nkleiner."
20.6s "Der Eiskönig."  (style: "big", yFrac: 0.26 — placed higher than the default 0.70)
```
Creature: procedurally-drawn ice cracks radiate from the hole (deterministic per-index
walk, 5 jagged segments each), a shadow visible only through the hole's clip, then a huge
glowing (`{glow:true}`) shape rises and breaks the ice, with ice floes kicked away at the
rim.

### 8.7 Story trigger flow (`maybeStartStory`)

```js
function maybeStartStory(locId) {
  if (storyActive() || storySeen(locId) || !STORY[locId]) return false;
  return startStory(locId);
}
```
Called at the end of `enterLocation()` in `aquarium.js` — i.e. every chapter (**including
Chapter 1**, since the 2026-08-28 "Einstieg neu gedacht" rework) fires uniformly on first
travel to that location via the ANGELN button, not from a title screen or any special
case. `storySeen(id) = !!save.storySeen[id]`, written immediately on `startStory()` (so a
`saveGame()` mid-scene can't lose the "seen" flag, and it can never replay involuntarily).
`enterLocation()` switches the screen to the fishing spot **before** the chapter starts, so
by the time the chapter's outro/title card ends, the player is already standing at that
location (no jump-cut back).

### 8.8 Reward relationship (important distinction)

Story chapters are **purely narrative/atmospheric** — triggered by first-visit, not by
defeating anything, and they grant no explicit item/currency reward on their own (no
reward code found in `story.js`). The species named in each chapter (`alterkarl, nessie,
kraken, megalodon, leviathan, eiskoenig`) are also real catchable **boss fish** in the
separate boss-fight minigame (`bossfight.js`, out of this doc's read scope) — that system
handles combat rewards independently; the story chapter and the boss fight are sequenced
by the same species id but are not the same code path.

### 8.9 Intro / onboarding flow (`intro.js`) — replaces the old title screen entirely

**There is no classic title screen.** The old build's title screen (a darkened live-game
screenshot behind a logo and a "Tippen zum Start" / "tap to start" wall) was deliberately
removed. In its place: a single, always-auto-playing **2.6-second "cast" animation**
that ends by camera-pulling directly into the Hub's tank rectangle — the intro *is* the
transition into the Hub, not a separate screen with its own buttons.

**Phases** (`Intro.P`, cumulative timestamps in parentheses):

| Phase | Duration | End time | What happens |
|---|---:|---:|---|
| Cast | 0.60s | 0.60s | Line+bobber fly in from upper-left on a quadratic-Bézier arc (control point above the canvas, so it reads as a real arc). The line is drawn as the *already-flown* path, redrawn point-by-point up to progress `u`, so skipping to any point always shows a consistent rope shape. |
| Splash | 0.30s | 0.90s | Impact flash (first 0.16s), 22 analytically-computed spray droplets, 4 expanding ripple rings, bobber does a damped bounce `exp(-a*3.2)*cos(a*13)*9`px. `Sound.splash()` + `haptic(12)` fire here. |
| Haul | 0.78s | 1.68s | The game's **wooden name-sign** (not a logo image) breaks the surface, clipped under the waterline while still emerging, pulled up on a power ease `1-(1-u)^2.2` ("fast out, then damped settle — wood on a string, not rubber"). Rod attachment point migrates toward upper-left. |
| Hold | 0.30s | 1.98s | Sign sways (`exp(-a*1.15)*sin(a*5.4)*0.075` + a slow ambient `sin(t*0.9)*0.008` that never fully stops), drips fall, a koi swims under the surface and breaks through once. |
| Handover | 0.62s | 2.60s | Sign pulled further off-frame; waterline rises out of frame (camera "sinks in"); the whole water image optically zooms/clips down onto the **exact tank rectangle of the Hub**, which is drawn underneath and becomes visible around it — no cut, no fade-to-black. Ease: `easeOut(clamp((t-1.98)/0.62,0,1))`; image alpha only starts fading in the last 30% of this window; clip corner radius `lerp(0,16,u)`. |

Total: **2.6s** measured intro, **~3.0s** from page load to Hub visible (the extra 0.4s is
game script parse/boot).

**Advancement**: fully automatic, driven by `update(dt)` incrementing `Intro.t`; no tap
required. **Skip** (`Intro.skip()`, bound in `script.js` to any `pointerdown` anywhere on
the canvas plus keyboard Space/Enter/Escape): if `t < 1.98` (still before handover), jumps
straight to `t=1.98` — **always** routes through the same handover camera move, so a skip
never hard-cuts into the Hub; a second tap after that calls `finish()` immediately.
`finish()` (auto at `t≥2.6`, or via 2nd skip) sets `Intro.active=false` and calls the
global `showHub()`. No replay mechanism — every launch (including reloads) plays the full
2.6s; this is a named, deliberate self-critique in the source docs, not an oversight.

**Text** (per intro screen):
- Game name on the wooden sign, **deliberately not translated** ("it's the name," source
  comment): line 1 `"A Silly"` (`#ffd23a`, bold, size `sh*0.215`), line 2 `"Fishing Game"`
  (`#f7edd6`, bold, size `sh*0.335`).
- Skip hint, shown only for `t∈(0.9, 1.98)`, fading to max alpha **0.27**, bottom-center:
  dictionary key `"tippen zum Überspringen"` → **"tap to skip"**.
- Version footer: `` `v${GAME_VERSION}` ``, alpha 0.26, 10px, bottom-center — same string
  reused in Settings.

**Visuals**: night sky gradient `#080d16→#132029(62%)→#1b2f36` + a warm lamp radial glow
`rgba(255,204,130,0.20)`; far shore = 2 silhouette hills + 40 procedurally-varied pine
triangles (seeded, non-repeating); water gradient `#1d5570→#113a52(42%)→#061722`
**deliberately matches the Hub's default "Schlicht" tank backdrop** so the handover seam
is invisible; a radial vignette. Sign drawn via `Wood.sign(...,{seed:4711, tilt:-0.030+
sway, nails:4})` — fixed seed so the same board grain appears every launch. Sign width:
`min(W-44,344)`px on mobile, `clamp(W*0.42,344,620)`px on wide/desktop screens.

**No AudioContext/music on a true cold start**: the browser requires a real user gesture
before audio can play; `unlockAudio()` (bound to the first `pointerdown`/`keydown`
anywhere in the game, not specific to the intro) is what starts `Sound`/`Music`. If nobody
touches anything during the intro, it plays **silently** — by design, nothing is lost
versus the old title screen (which was equally silent before its own tap).

**Onboarding-adjacent behavior changes bundled with this rework** (documented, not
incidental): the Daily Bonus overlay no longer auto-pops for a brand-new player (gated on
`save.stats.catches > 0` — previously the Hub was only reachable *after* a first fishing
round, so this couldn't happen; now the Hub is the very first screen, and an unconditional
daily-bonus popup would greet a new player before they'd seen a single fish); the location
carousel now syncs to the player's last-played location on boot (`showHub()` →
`locBandSyncToCurrent()`), instead of always resetting to Lake Pier.

### 8.10 Per-boss encounter cutscene (`cutscene.js`) — distinct system, not `story.js`

Single global singleton `cutscene` (or `null`). Shape: `{ id, t, dur, name }`. `dur` is
always the module constant **`CUTSCENE_DUR = 4.2`** seconds for every boss — not
per-chapter durations like `story.js`. `id` is the boss species id, reused as a plain
`if`-branch key inside two shared functions (`updateCutscene`, `drawCutscene`) — there are
**no** separate per-boss functions (`startAlterkarlCutscene()` etc. do not exist).

`startCutscene(sp)`: sets `cutscene = {id:sp.id, t:0, dur:4.2, name:sp.name}`; ducks the
running location-music lowpass filter to 300Hz over 0.5s; plays a two-tone stinger
(`Sound.tone(70,1.2,"sine",0.25,-20)` + `Sound.tone(140,0.8,"sawtooth",0.12,-60,0.2)`);
haptic pattern `[80,60,80,60,200]`.

**No letterbox exists in this file** — the only screen-darkening is a flat full-frame tint
`rgba(2,8,20, 0.35*min(1,k*4))` (`k=t/dur`), ramping in over the first quarter of the
4.2s then holding — no bar geometry, no separate in/out timing. **No camera pan/zoom
exists either** — every effect draws in static screen space against the live fishing-scene
geometry (`horizonY, boatX, dockWidth, dockX, dockY, dockHeight`); only the foreground
effect elements themselves move.

**Shared title card**: alpha `= clamp((k-0.2)/0.2,0,1) * clamp((1-k)/0.15,0,1)` (fades in
over `k∈[0.2,0.4]`, holds, fades out over `k∈[0.85,1.0]`), two centered lines: **"BOSS"**
(`#ff5c5c`, bold, `~14px`) above the boss's actual name (`#fff`, `shadowBlur 16`
`rgba(0,0,0,0.7)`, bold, `~34px`) — note this literal English word "BOSS" is also the
i18n dictionary's translation target for the German key `"BOSS"` (i.e. unchanged in both
languages).

**Per-boss visual (all inline branches in `updateCutscene`/`drawCutscene`)**:
- `alterkarl`: a rolling wave silhouette crosses the dock (`easeInOut` over `k∈[0.1,0.7]`),
  foam-cap ellipse + 6 jittering foam blobs, splash particles spawned 50%/frame during
  `k∈(0.3,0.7)`. Shake: constant 6 only during `k∈(0.35,0.6)`.
- `kraken`: 3 tentacles rise beside the boat, staggered `i*0.12` in their individual rise
  curves, swaying via `sin`, 4 translucent sucker circles each. Shake: continuous
  `3+3*sin(t*6)`.
- `megalodon`: giant dorsal fin crosses right→left (`easeInOut` over `k∈[0.1,0.8]`),
  trailing wake line, ripples spawned 40%/frame. **No shake set** — motion carries it.
- `leviathan`: a pulsing radial glow rises from below (outer radius grows with `k`,
  `rgba(127,216,255, 0.55+0.3*sin(t*5))`), 3 pulsing dots. Shake: constant, subtle 1.5.
- `eiskoenig`: ice cracks spread (`n=floor(k*14)` cracks, deterministic jagged 5-segment
  paths). Probabilistic crackle: `random()<dt*6` → `Sound.noise(0.08,0.2,3000)` + a
  one-frame shake spike of 4.

**Sequencing/skip**: `startCutscene(sp)` is called externally by boss-encounter logic
(outside this file's scope). **There is no skip or tap-to-advance anywhere in
cutscene.js** — every boss cutscene runs its full fixed 4.2s and self-clears
(`cutscene=null`) when `t>=dur`, at which point the music filter is restored to the
current mood's cutoff over 1.5s. This is a deliberate structural contrast with
`intro.js`'s generous skip handling.

---

## 9. Input model

### 9.1 Pointer events (`script.js`)

All bound on the canvas element (`canvasEl`), Pointer Events API (works for mouse, touch,
and pen uniformly):

- **`pointerdown`**: `unlockAudio()` first (see §8.9); then, in strict priority order:
  1. Diagnostics ("Bench") overlay, if measuring — swallows the tap entirely.
  2. `Intro.active` → `Intro.skip()`.
  3. `storyActive()` → tap-echo + haptic(5) + `storyTap()` (chapter skip/advance).
  4. `cutscene` (boss stinger) → swallow (no skip, "just watch").
  5. `!overlay && tapSeagull(x,y)` → seagull-steals-your-fish minigame hit-test.
  6. `hubScreen && !overlay && locBandHit(y)` → routes into the location-carousel's own
     drag handler (`locBandDown`) **before** the generic button loop, since the carousel
     needs to distinguish a swipe from a tap on release, not on press.
  7. **Generic button hit-test**: iterate `hitButtons` **back-to-front** (`i =
     hitButtons.length-1 downto 0`) so the most-recently-drawn (topmost-rendered) button
     wins on overlap; on match: if the button carries an `fx` key, trigger the press
     animation (`pressFx = {key:b.fx, t:0}`) + `haptic(8)`, else a generic tap-echo +
     `haptic(5)`; then call `b.onClick()` and stop.
  8. If an overlay is open and nothing was hit, swallow (tap-outside-to-close is handled
     by the overlay's own dimmed backdrop button, itself a full-screen `hitButtons` entry).
  9. `hubScreen` with nothing hit → tap-echo + haptic(5) ("in the aquarium there's only
     buttons, no casting").
  10. Otherwise (at the water): tap-echo + haptic(5) unless `gameState` is `"reeling"` or
      `"bossfight"` (those get per-second taps already answered visibly by their own bars —
      an echo there "would be noise"). Then the actual fishing state machine: `snag` →
      `tapSnag()`; ice-hole blocked → `chopIceHole()`; `isDiveMode()&&ready` → charge a
      harpoon shot (`startCharge`); `ready` → `castTo(x,y)`; `waiting` → `retrieve()` (tap
      the water again to reel in — no separate button); `biting` → `startReeling()`;
      `reeling` → hold+`reelTap(x)`; `bossfight` → hold+`bossFightTap(x,y)`; `caught` →
      `finishCatch()`.
- **`pointerup`**: if a hub-drag was in progress, `locBandUp(x,y)`; else `isHolding=false`
  + `releaseCharge()` (harpoon release).
- **`pointercancel` / `pointerleave`**: same cleanup as pointerup (drag abort-safe).
- **`pointermove`**: tracks `mouseX/mouseY` and `hasMouse` (pointer type); if dragging the
  location band, `locBandMove(x)`; else `aimCharge(x,y)` (harpoon aim-while-charging).
- **`contextmenu`**: `preventDefault()` (suppress right-click menu — the game treats
  right-click/`button===2` as ignored input at the top of `pointerdown` too).

### 9.2 Hit-testing model

A single global `hitButtons` array, **rebuilt every frame** during draw — each drawer
pushes `{x, y, w, h, onClick, fx?}` (axis-aligned rect in canvas pixel space) as it draws
its element. `pointerdown` walks it back-to-front (last pushed = drawn last = visually on
top = checked first) and calls the first matching `onClick`. There is no retained widget
tree — a button "exists" for exactly one frame's worth of hit-testing, which is why
overlay open/close animations reposition hit rects automatically (§1.0): whatever moved
this frame pushed its rect at its current animated position.

The `fx` string key (not a coordinate) is what ties a `pointerdown` to a **press-feedback**
visual (`pressFx = {key, t:0}`, consumed by `pressApply`/`pressGlow` wherever that same
key is drawn again next frame) — this was a deliberate 2026-08-28 fix: the old system
matched press-feedback by comparing stored click coordinates to draw coordinates
(`Math.abs(pressFx.x-x)<2`), which silently broke the instant any element could move
between click-frame and draw-frame (exactly what the overlay slide-in animation does).
Elements with **no** `fx` key (full-screen dismiss catchers: overlay backdrop, panel
catch-all, ad/gacha/level-up full-screen catchers) get **no** press-in animation but
**do** still get the generic tap-echo ripple — "every touch answers, and what doesn't
[press] must be justified."

### 9.3 Tap-echo (`tapEcho`, `drawTapEchoes`)

A lightweight ripple feedback for taps that land on *nothing interactive* (water, empty
hub wall, next to an overlay, a cutscene tap): pushed to a small ring buffer (max 5
concurrent), drawn as a bright outward ring + a darker inner "imprint" ("a strike mark in
the wood"), **340ms** duration, two arcs. Always drawn last in the frame ("the response to
a touch must not be covered by anything").

### 9.4 Squash & stretch press feedback ("S2")

Explicitly **not** the generic "soft rubber" squash used elsewhere in the project's
reference notes (8% uniform scale-down with an elastic overshoot) — for a nailed wooden
board, a different physical model was chosen: it yields once, then springs back with a
single damped oscillation, never scales down uniformly:

```
t < 0.06s :  linear press-in over 60ms
t ≥ 0.06s :  exp(-3.4u) * cos(4.9u)   →  one overshoot bounce of ~14% of press depth
total duration: 0.24s
```
Applied anisotropically — **Y compresses more than X** (7% vs 3.5%) — plus a **3px
downward offset**: it reads as pressed *into* the board, not shrunk. A light-flash plus an
inner shadow along the top edge simulate "the dent a thumb makes." Drives ~60 `uiButton`
call sites automatically, plus ANGELN, the cast button, the status card, gear chips, shelf
furniture, the harvest chest, the gear/settings sign, location cards, Fishdex tiles, pass
cards, decor color tiles, and the depth-sounder icon.

### 9.5 Vibration (`haptic(pattern)`)

Bound to the same `fx`/no-`fx` split as press-feedback: **8ms** on any element with an `fx`
key, **5ms** on any free/unassigned tap; multi-value patterns (e.g. `[80,60,80,60,200]`)
used for cutscene stingers, boot-shake events, etc. `navigator.vibrate` is silently
ignored by iOS Safari — documented as a platform limitation, not a bug.

### 9.6 Keyboard (desktop convenience layer, `script.js`)

- `Space`: skip Intro; else start/continue the fishing state machine (hold-to-reel while
  `reeling`, start reeling from `biting`, finish a `caught` catch, or cast toward the last
  mouse position while `ready`).
- `Escape`: a **back-stack**, checked in this exact order — close the Fishdex detail card
  → else close whatever `overlay` is open → else `closeHub()` if the hub is open → else
  (nothing else active) `openHub()`. On desktop this is the fastest way back to the hub;
  on mobile the equivalent is the wall-mounted "✕" sign top-right.
- **Dev cheats** (`Shift+`, keyboard-only — unreachable on phones by design):
  `Shift+G` = +1000 coins, `Shift+L` = jump to next level, `Shift+J` = +10 gems,
  `Shift+I` = toggle the render-diagnostics HUD (`showRenderInfo`) and, the first time,
  also flips on the developer-mode flag (`Dev.an`) so the diagnostics toggle appears in
  Settings too (there is no keyboard on mobile, so mobile access to this switch has to
  live somewhere reachable — see §9.7), `Shift+D` = mark the current location's entire
  Fishdex complete.
- `resize` / `orientationchange` / `visualViewport.resize` → `resizeCanvas()`.

### 9.7 Dev-mode gesture (mobile-reachable diagnostics unlock)

Since dev cheats are keyboard-only and phones have no keyboard, developer/diagnostics mode
has a separate, touch-reachable unlock: **tap the version-number line at the bottom of
Settings 5 times within a 2-second rolling window** (`Dev.tippVersion()` — a tap resets the
counter to 1 if more than 2000ms has passed since the previous tap, otherwise increments;
at 5, toggles `Dev.an`, persists it to `sessionStorage`, shows a toast "🔧 Diagnose an" /
"Diagnose aus", and — if switching off — also force-clears the render-info HUD and
performance counters). Also reachable via URL query string `?dev=1` (checked once on boot,
persisted the same way). "Five taps on an otherwise-grey version number" is deliberately
chosen as a gesture nobody triggers by accident.

### 9.8 Global input-adjacent objects for §10

`hitButtons` (array, rebuilt per frame), `pressFx` (single active press state, `{key,t}`),
`tapEchoes` (ring buffer, max 5), `mouseX/mouseY/hasMouse`, `hubDrag` (location-carousel
drag state), `isHolding` (charge/reel hold flag).

---

## 10. Globals / functions depended on (cross-file)

This section consolidates the "depends on, defined elsewhere" lists surfaced throughout
§§2–9, organized by category, for anyone porting the UI layer without also porting the
simulation.

### 10.1 Canvas/runtime
`canvas`, `ctx` (2D context, `world.js`'s `World`/`gpu.js` provide an alternate WebGL
path for the water layer only — `intro.js` optionally routes through `World.begin()/
commit()` if that layer is already active, else falls back to plain Canvas2D), `uiTime`
(surface clock, never pauses), `time` (world clock, pauses under `worldPaused()`),
`resizeCanvas()`, `isNarrow()`, `uiScale()`, `safeBottom` (safe-area inset).

### 10.2 Math/utility
`prnd(i, salt)` (deterministic pseudo-random, the seed source for every "hand-made"
irregularity in `wood.js`/hub decor/intro scenery), `clamp`, `lerp`, `lerpColor`,
`shadeColor`, `rand`, `easeOut`/`easeInOut` (global versions used outside `story.js`'s own
`Ease` table), `fitText`, `wrapText`, `qPoint`/`cPoint` (bezier sampling, story.js-local).

### 10.3 Persistence
`save` (the single save object; fields referenced across this doc: `save.lang,
save.storySeen, save.location, save.aquarium.{slots,extra,decor,lastTick}, save.inv,
save.totemTime, save.owned, save.dex, save.stats.catches, save.music`), `saveGame()`,
`defaultSave()` (shop.js), `loadSave()` (Object.assign over defaults — new fields added
to a save format always need a default so old saves don't crash on a missing key; this
bit the team once already, see §7's decor-crash note in the source docs).

### 10.4 Audio/haptics
`Sound.{ensure, click, buy, fail, catchJingle, whoosh, splash, tone, noise, muted}`,
`Music.{start, started, filter, ctx, mood, master}`, `haptic(pattern)`,
`unlockAudio()` (script.js — the single first-touch/first-keypress audio unlock).

### 10.5 UI chrome primitives
`Wood.*` (§2), `Glass.panel` (§3, thin shim over `Wood.panel`), `drawIcon`,
`drawIconLabel`, `ICONS` (§4), `I18N.translate`/`I18N.num` (§6, invoked implicitly via the
patched `fillText`/`strokeText`/`measureText`), `fontMidNudge` (§5), `UI_FONT`.

### 10.6 Overlay/menu system (draw.js — see §1)
`overlay` (current overlay id or falsy), `openOverlay(id)`, `closeOverlay()`,
`drawOverlayFrame`, `overlayRect()`, `overlayContentNeed(id,...)`, `overlayTargetH()`,
`overlaySheetH`, `overlayAnim`, `overlayClosing`, `uiButton(...)`, `drawTabs(...)`,
`pressApply(key,x,y,w,h)`, `pressGlow(k,x,y,w,h,r)`, `tapEcho(x,y)`, `drawTapEchoes()`,
`badgeMarks()`, `hitButtons` (§9.2).

### 10.7 Hub/aquarium (§7)
All functions/state listed in §7.18.

### 10.8 Story/cutscene (§8)
`story` (active-chapter state or null), `startStory`, `updateStory`, `drawStory`,
`storyActive`, `storyTap`, `maybeStartStory`, `storySeen`, `STORY` (chapter data table),
`StoryAudio`; `cutscene` (active boss-stinger state or null), `CUTSCENE_DUR`,
`startCutscene`, `updateCutscene`, `drawCutscene`; `Intro` (object — see §8.9),
`showHub()` (called by `Intro.finish()`, defined in aquarium.js).

### 10.9 Game/economy data these UI files read (defined elsewhere, out of this doc's scope)
`SPECIES`, `LOCATIONS`, `RARITY`, `COIN_SCALE`, `getLevel()`, `getGems()`, `spendGems()`,
`talentMult()`, `isLocationOwned()`, `selectLocation()`, `speciesForLocation()`,
`dexDiscoveredIn()`, `badgeCounts()`, `runningTotems()`, `totemActive()`,
`totemRemaining()`, `totemTimeLabel()`, `invTotal()`, `drawFishShape`, `isGlowing`,
`drawChestIcon`, `drawCoinIcon`, `drawGemIcon`, `drawTotemRing`, `GAME_VERSION`.

---

## 11. Assessment — DOM/CSS overlay vs. must-stay-in-canvas

**Strongly suited to an HTML/CSS DOM layer** (static-ish, text-heavy, benefits from
accessibility/native input, and none of it needs to visually integrate with the animated
world behind it beyond a dim overlay):

- All 11 wood-tablet overlay **contents that are essentially lists/forms**: Settings
  (toggles), Leaderboard (a table), Quests/Daily-Bonus/Pass reward rows, Achievements list,
  Talents list, Shop's category list rows (though the wood/paint rendering of *each row*
  is bespoke enough it's a toss-up — see below).
- Toasts and simple text popups.
- The tackle-box compartment **contents once open** (though the swing-open reveal
  animation itself is closer to "must stay in canvas," see below).
- The i18n mechanism itself: a DOM rebuild should switch to a real per-key translation
  function (`t("key")`) rather than porting the string-patching trick — but the flat
  dictionary content (§6.4) can be reused directly, and the observed "story subtitles stay
  German" behavior should be a **deliberate decision**, not an accidental carry-over: either
  add real English subtitle translations for §8.6 or explicitly keep them German-only.

**Should stay in-canvas / custom-rendered** (the hand-made, procedurally-irregular wood
look is the product's visual identity — a DOM re-implementation would have to reinvent a
large fraction of `wood.js`'s per-seed jitter/grain/nail/chip system to look the same, and
the value of that look is specifically that *nothing lines up perfectly*, which fights
CSS's box model):

- Every `Wood.panel`/`Wood.plank`/`Wood.sign`/`Wood.paper`/`Wood.coat` surface — the
  entire "rustic hand-made wood" aesthetic (§2) is a procedural-generation system, not a
  fixed asset; a DOM version would either need pre-rendered PNG textures (losing the
  per-instance uniqueness that is the explicit design goal — "no two planks match") or a
  canvas-in-DOM component per panel anyway.
- The aquarium tank (§7.1–7.8): glass reflections, caustics, tank fish swimming, bubbles,
  the lamp light cone — a live simulated scene, not a UI panel; this is core "gameplay
  world" content that happens to double as the main menu.
- The location carousel (§7.12): drag physics + per-card mini-scene renders + a live
  glow/tilt/scale system tied to scroll position — a 60fps game-feel interaction, not a
  standard swiper component; a native `<div>` swiper would need substantial custom work to
  replicate the wood-plank tilt/lift/nail-dot feel and would still need canvas (or SVG) for
  the mini-scene thumbnails to match style.
- The story chapters (§8.1–8.8) and the intro (§8.9): fully custom camera/particle/paint
  systems keyed to a timeline — this is essentially a small cutscene engine and gains
  nothing from DOM.
- The boss cutscene (§8.10): same reasoning, plus it composites directly over the live
  fishing-scene canvas.
- The tackle-box swing-open reveal (§1.5): a rotated-hinge animation with per-compartment
  timing that the hit-testing model deliberately keeps non-interactive mid-animation — a
  DOM equivalent (CSS 3D transforms) is *possible* but the "don't accept taps on a still-
  rotating panel" rule would need to be reimplemented carefully to avoid regressing it.
- Tap-echo, press squash&stretch (§9.3–9.4), and coin-fly/confetti particles: cheap,
  frame-perfect canvas feedback that's tightly coupled to the `hitButtons`/`fx`-key model;
  portable in *concept* (the physical formulas in §9.4 translate directly to CSS
  transitions/Web Animations API) but the "any element, no coordinate matching" trick that
  makes it robust against layout changes is inherently a canvas-frame-loop pattern, not a
  DOM one.
- Fish rendering everywhere it appears (tank, fishing spot, story chapters) — a shared
  procedural fish-shape drawer (`drawFishShape`), not sprite assets; out of this doc's
  direct scope but every screen here calls into it.

**Middle ground worth a deliberate call**: the overlay **container** itself (the sliding
wood tablet: open/close animation, tab rail, handle) has real DOM-friendly structure (it's
essentially a bottom sheet / drawer with tabs) but its *decoration* is wood-panel-rendered.
A pragmatic split: implement the sheet mechanics (position, height-follows-content,
slide/rope animation, tab rail, dismiss-on-outside-tap) as a real DOM/CSS component for
input/accessibility/text-layout benefits, but render its wood background as a `<canvas>`
or pre-baked-per-size background image sized to the sheet's animated bounds — closer to
what `Blech`'s bake-cache already does internally (§2.5) than to a from-scratch DOM texture.
