# 03 — World & Visuals Spec

Reverse-engineered from the old Canvas 2D / Phaser-hybrid game
(`C:\Users\duf73\Desktop\claude projekte\fishing-game`) for a ground-up rebuild
with a GPU sprite renderer. Sources read in full: `locations.js`, `backdrop.js`,
`visuals.js`, `world.js`, `world-frag.js`, `gpu.js`, `blech.js`, plus the
scene-drawing parts of `draw.js`, `script.js` (resizeCanvas/getWave/dayTime),
`effects.js`, `events.js`, `dive.js`, `fish.js` (shadeColor/daylight), `shop.js`
(equipment tables), `hype.js` (camera zoom), and `docs/PHASER-UMZUG.md`. No file
in the old project was modified.

All coordinates in the old game are **CSS pixels** in a logical `canvas =
{width, height}` object; the real `<canvas>` element (`canvasEl`) is DPR-scaled
and `ctx` is transformed with `setTransform(dpr,0,0,dpr,0,0)`. Colors are quoted
verbatim from source.

---

## 1. Locations

`LOCATIONS` array (`locations.js:3-10`). Each location: `id, name, price
(coins), level (player level gate), mode, icon (emoji), water: [top, bottom]
hex, dark (0..1 extra night-darkening of the whole location), desc`.

| id | name | price | level | mode | icon | water top | water bottom | dark |
|---|---|---:|---:|---|---|---|---|---:|
| `see` | Steg am See | 0 | 1 | `dock` | 🌲 | `#5fa8c9` | `#1c4f6b` | 0 |
| `boot` | Ruderboot · Seemitte | 1200 | 3 | `boat` | 🚣 | `#4b8fb5` | `#0f3448` | 0.05 |
| `kueste` | Küste | 3000 | 7 | `pier` | 🌊 | `#3f7fb0` | `#0c2b48` | 0 |
| `riff` | Korallenriff | 6000 | 12 | `boat` | 🐠 | `#3fd0c9` | `#0e6b7a` | 0 |
| `tiefsee` | Tiefsee | 12000 | 18 | `dive` | 🦑 | `#0d2038` | `#010409` | 0.6 |
| `arktis` | Eisloch · Arktis | 20000 | 25 | `ice` | 🧊 | `#3a7f96` | `#0a2a3a` | 0.1 |

`mode` drives which platform/rig is drawn (`drawLocationPlatform`,
`locations.js:544`): `dock`→`drawDock`, `pier`→`drawPier`, `boat`→`drawBoat`,
`ice`→`drawIce`; `dive` has no platform (diver floats in open water).

`isLocationOwned(loc)`: `price===0 || save.owned.locations.includes(id)`.
Unlocking (`selectLocation`, `locations.js:169`) also completes by beating a
location's **boss fish** for free (`onBossCaught`, `locations.js:63`), which
auto-unlocks the *next* location in array order regardless of coins/level.

Effective water color actually used at runtime is **not** `loc.water` directly
— `getPalette()` (draw.js:26) recolors it (see §2).

### Per-location draw order & scenery (`drawLocationScenery`, `locations.js:532`; `drawBackdropFar`/`Near`, `backdrop.js:12-38`)

Global per-frame draw order (from `script.js:redraw`/typical call sequence
reconstructed from function bodies): sky/water gradient (`drawBackground`) →
stars → sun → moon → clouds → `drawBackdropFar` (far silhouettes, parallax
0.45) → birds → underwater platform parts (`drawBoatUnderwater`/
`drawPierUnderwater`, drawn **before** water so water overlaps them) →
`drawWater` (surface bands + foam + glitter) → `drawBackdropNear` (seabed +
near clutter, parallax 0.16) → fish → hook/line/bobber → dock/pier/boat/ice
platform (`drawLocationPlatform`) → angler/diver → boat front wall
(`drawLocationPlatformFront`, drawn **after** angler so he sits *in* the boat)
→ effects (caustics, god rays, surface mirror, depth fog, weather, snow) → UI.

**See (Steg am See)** — mode `dock`.
- Far (`drawLakeShore`, backdrop.js:389, baked region `0, horizonY-150,
  W, 175`): distant mountain range (7 peaks, gradient `#7c93a6`→`#4c6274`,
  dimmed by daylight), snow caps (`rgba(244,250,255,α)`) on peaks above
  `shore-78`, haze band, a darker forested ridge (`#2f5a44`, 26 zig-zag
  segments), two pine layers (12 small `s=0.55` @ `#2b5240` α0.75 behind, 8
  large `s=1` @ `#37694f` in front — `drawPine`, backdrop.js:315), grass bank
  gradient `#5c7a4a→#40573a→#2f4030`. Live (wind, not baked): 60 grass tufts
  (`#6f8f56`, swaying `sin(time*1.4+i)*1.2`), 12 cattail reeds on the left 22%
  of width (`#7d9a4a`, sway `sin(time*1.1+i)*3`), every 3rd with a brown seed
  head.
- Near: `drawLilyPads` (5 pads, `rgba(46,96,58,0.55)` ellipse + darker leaf
  notch, `r=12..24`) and `drawLakeRocks` (seabed `drawSeaBed` + 9 rocks,
  gradient `rgba(96,108,102,.75)→rgba(34,44,42,.8)`).
- Platform: wooden dock (`drawDock`, draw.js:303) + legs (`drawDockLegs`,
  draw.js:288) + seaweed (`drawWeeds(9, "rgba(50,120,70,0.8)")`).

**Ruderboot (boot)** — mode `boat`.
- Far (`drawOpenWater`, backdrop.js:545, region `0, horizonY-70, W, 90`):
  hazy far shoreline mountains `rgba(126,148,168,α)`, a forested rock island
  at `x=0.17W` with 6 pines and a mirrored reflection (`α=0.18·light`). Live:
  3 sailboats drifting `x = W·(0.55+i·0.16) + sin(time·0.1+i·2)·7`, bobbing
  `sin(time·0.8+i)*1.4`.
- Near: `drawSeaBed("rgba(38,62,66,.85)","rgba(14,28,36,.95)")` +
  `drawBedStones(6,"70,88,92")` + `drawDriftParticles("rgba(190,225,245,.35)",26)`.
- Boat geometry (`boatGeom`, locations.js:211): `L = dockWidth*1.45` (length),
  `fb = dockHeight*1.15` (freeboard), `d = dockHeight*1.3` (draft — must hide
  angler's feet), `heel = sin(time*1.3)*0.018` rad (roll), `boatY = getWave
  (boatX)` (bob). Hull path is a closed bezier/quad curve (bow left, transom
  right, sheer line sagging bow→stern). Drawn in **3 passes**: underwater hull
  (`drawBoatUnderwater`, gradient `#5c3a19→#3a2410`, before water), topside
  hull+interior+thwarts (`drawBoat`, gradient `#c08a4c/#96632f/#6e4520`,
  before angler), front bulwark+oar+water rings (`drawBoatFront`, gradient
  `#b8834a/#8a5a2a/#5c3a18`, **after** angler). Oar blade `#6b451f` dips into
  water at `x=L*0.55, y=d*0.45`. 3 concentric water rings pulse
  `α = 0.4-i*0.11 + sin(time*1.6+i)*0.06`.

**Küste** — mode `pier`.
- Far (`drawCliffs`, backdrop.js:624, region `0, horizonY-125, W, 145`): hazy
  headland right side, chalk cliff left side (gradient `#b9b2a6/#8d8578/
  #5d5850`) with 5 rock strata lines and grass cap `#4c7048`. Live: surf spray
  at cliff foot (7 ellipses, `rgba(255,255,255,0.25+0.12·sin(time*1.8))`), 3
  sailboats with hull.
- Near: `drawSeaBed("rgba(96,96,86,.85)","rgba(34,40,44,.95)")` +
  `drawSeaRocks` (6 jagged rock silhouettes `rgba(46,58,64,α)`) +
  `drawDriftParticles("rgba(200,230,245,.3)",20)`.
- Platform (`drawPier`, locations.js:387): stone pier block `#6f7378`, black
  bollard, a lighthouse stump (white shaft `#f2f2f2`, red band `#e63946`,
  black cap `#2a2a30`) with a rotating light beam
  `rgba(255,240,150, (0.4+0.6·|sin(time*1.5)|)·(1-light))`. Underwater part
  (`drawPierUnderwater`) is 10 stone blocks `#5a5e63` + 5 footing blocks
  `#4a4e53`. Seaweed `drawWeeds(6, "rgba(90,110,60,0.8)")`.

**Korallenriff** — mode `boat` (same boat rig as Boot).
- Far (`drawPalmIsland`, backdrop.js:714, region `0, horizonY-30, W, 55`):
  two hazy distant islands, sand bank gradient `#f2e2bd→#cfae7c`. Live: surf
  line + 3 palms (curved trunk `#8a6236` w/ 5 segment ticks, 6 fronds
  alternating `#2f8a55`/`#3fa066`, 2 coconuts `#6b4a2a`, sway `sin(time*0.8+i)
  *3.5`).
- Near: `drawSeaBed("rgba(214,196,150,.9)","rgba(120,110,84,.95)")` +
  `drawAnemones` (7 anemones, colors `["#ff8fbf","#ffd166","#8fe3ff",
  "#c792ff"]`, 9 swaying tentacle strokes each) + `drawCorals` (14 corals: 3
  types round-robin — branching, bubble-cluster, blade — colors `["#ff6b6b",
  "#ff9f43","#f368e0","#feca57","#1dd1a1"]`, α0.65, plus 10 seagrass blades
  `rgba(40,160,110,0.6)`). `drawSunShafts` (4 soft cyan light columns
  `rgba(190,255,250,α)`, additive) when `light≥0.45`.

**Tiefsee** — mode `dive`. No sky/horizon line: `horizonY = canvas.height*0.05`
(near top) in `resizeCanvas`; `drawBackground` fills a 4-stop vertical
gradient `#0a2742→#05172c→#020c18→#01050c` covering the whole canvas (no
separate sky/water split).
- Far (`drawDeepFar`, backdrop.js:58, region `0, H*0.45, W, H*0.6`): 2 layered
  canyon-wall silhouettes (`rgba(8,18,32,.75)` / `rgba(4,10,20,.9)`). Live: 4
  drifting bioluminescent cloud blobs, colors `["120,220,255","140,255,200",
  "170,150,255"]`, radial gradient α≈0.07-0.10, additive-ish soft glow.
- Near (`drawDeepNear`, backdrop.js:151): 2 black-smoker vents (`rgba(10,16,
  26,0.95)` triangular chimneys) with 7 rising particle puffs each
  (`rgba(120,140,165,α)`); 11 glowing corals (colors `["#37e0d8","#7b6bff",
  "#ff5ea8","#5ad4ff","#a8ff6b"]`, pulsing `0.5+0.5·sin(time*1.4+i*1.3)`, each
  casts an actual **light pool** into the water — 5-stop radial gradient
  additive, radius `hgt*1.9`, plus a baked `shadowBlur` halo, see §6); 55
  bioluminescent plankton points (baked stamps, colors round-robin `"170,255,
  220"` (1/7), `"180,170,255"` (1/5), else `"150,225,255"`); 3 floating glow
  jellyfish (dome + 5 tentacles, `_qualleForm`, halo `#8fd3ff` blur 18).
  Additionally `drawDeepSpecks` (locations.js:491, 60 drifting cyan specks
  `rgba(120,220,255,α)`) is called from `drawLocationScenery`.
- Seabed: `drawSeaBed("rgba(16,26,38,.9)","rgba(2,6,12,.98)")`.
- No platform. Diver floats mid-water (§4).

**Arktis (Eisloch)** — mode `ice`.
- Far (`drawIcebergs`, backdrop.js:815) is drawn **by hand**, not via the
  `zweiteilig` split, because the aurora sits *behind* the baked snowfield/
  icebergs: `_polarlicht()` (live, aurora, only when `light<0.55`: 3 vertical
  bands, colors `120,255,190` (middle) / `140,200,255`, wobbling
  `sin(time*0.4+i)*22`) is drawn first, then `Blech.bild("fern:arktis", …,
  0, horizonY-80, W, 100, _icebergs)` (always-baked snowfield ridge + 4
  icebergs with sunlit/shadow facets, cyan waterline band, reflection).
- Near: `drawSeaBed("rgba(58,78,90,.85)","rgba(16,30,40,.95)")` +
  `drawBedStones(5,"96,116,128")` + `drawIceUnderside` (16 icicles hanging
  from the ice ceiling, `rgba(190,224,240,0.5)`) +
  `drawDriftParticles("rgba(225,245,255,.4)",30)`.
- Snow (`updateSnow`/`drawSnow`, locations.js:503): only spawns at this
  location; particle count `120 + round(weatherGloom()*140)` (rain weather =
  denser, slanted snow instead of rain streaks — the location's precipitation
  IS snow); fall speed `rand(20,50)`, drift `sin(time+w)*15 + gloom*26`.
- Platform (`drawIce`, locations.js:406): full-width ice sheet, gradient
  `#f2f9fd→#e3f0f8→#c3dbe8`, wavy top edge (`sin(x*0.021)`), a hole cut at
  `iceHoleX() = rodTipX` (so the line always enters through the hole),
  `holeRX = max(dockWidth*0.12, canvas.width*0.07)`, `holeRY = dockHeight*0.5`,
  scaled by `iceHole` (0..1, shrinks — the hole slowly freezes over per
  `mechanics.js`); frozen rim + ice chunks appear as it closes; a stool
  (`#3a3a44`) + igloo silhouette (`#f4fafd` dome, `#2a4a5a` doorway) decorate
  the platform.

### Static vs animated summary
"Static" = baked once per signature via `Blech` (see §6) and only redrawn on
signature change (location, quantized daylight step, canvas size, weather).
"Animated" = drawn live every frame.

| Element | Static/Animated | Driver |
|---|---|---|
| Far mountain/cliff/island/canyon silhouettes | static (baked "Ruhig" half) | `kulissenSig()` |
| Grass tufts, reeds, surf spray, sailboats, aurora, coral polyps live shapes | animated | `time` |
| Sea bed shape + rocks | live (not baked — cheap, changes with `time*0.2`) | — |
| Corals/anemones sway, plankton pulses | animated (position/shape), halo baked | `time`, `Blech.stempel` |
| Boat hull | live every frame (bobs on wave `boatY=getWave(boatX)`, heel) | never baked (Runde 8 lesson) |
| Dock/pier/ice platform | live (cheap, few draws) | — |
| Angler body | baked at "see" rest, **live in boat** (sub-pixel position changes) | see §4 |
| Rod body | baked at rest, crank always live; live whenever bending/boat/glow skin | see §4 |

---

## 2. Day/Night, Sun/Moon, Stars, Weather

### `getPalette(t, raw)` (draw.js:26)

`SKY_KEYS` — 7 keyframes over `t∈[0,1]` (`dayTime`), each `{t, top, bot, wTop,
wBot, light}`, linearly interpolated per-channel between the two bracketing
keys (`lerpColor`/`lerp`):

| t | top | bot | wTop | wBot | light |
|---:|---|---|---|---|---:|
| 0.00 | `#070b1e` | `#141c3a` | `#12283d` | `#03101c` | 0.12 |
| 0.16 | `#1a2350` | `#d07a6a` | `#3c5d7d` | `#0b2436` | 0.45 |
| 0.30 | `#4a90d9` | `#bfe3f5` | `#5fa8c9` | `#1c4f6b` | 1.00 |
| 0.66 | `#4a90d9` | `#bfe3f5` | `#5fa8c9` | `#1c4f6b` | 1.00 |
| 0.80 | `#3d4f8a` | `#ff9a5c` | `#5b7fa0` | `#1a3a55` | 0.70 |
| 0.90 | `#141a3d` | `#5a3a6a` | `#243b58` | `#08192a` | 0.28 |
| 1.00 | `#070b1e` | `#141c3a` | `#12283d` | `#03101c` | 0.12 |

`top`/`bot` = sky gradient stops; `wTop`/`wBot` = default (Steg-am-See) water
gradient stops; `light` = 0..1 daylight scalar driving nearly everything else.

Post-processing (unless `raw=true`, used only to read raw `light` for
star/moon visibility without location tint):
1. **Location water tint**: if `loc.id !== "see" || loc.dark`, water colors
   become `lerpColor(loc.water[0/1], "#06141f"/"#020810", night*0.85)` where
   `night = 1-pal.light`, i.e. the location's own `water[]` hex pair replaces
   the lake default and is progressively blackened at night. `light *= (1 -
   loc.dark)`. If `loc.dark>0`, sky `top`/`bot` are also pulled toward
   `#0a0f1e`/`#1a2438` by `loc.dark`.
2. **Rain (`weatherGloom()`, 0..1)**: if `>0.01 && !loc.dark`, sky/water
   colors pulled toward grey: `top→#5a6673` (0.55×g), `bot→#7d8894` (0.5×g),
   `wTop→#4a5a66` (0.35×g), `wBot→#26313a` (0.3×g). `light` is **not**
   touched by rain (so night-fish logic stays pure).

`DAY_LENGTH = 300` seconds per full day/night cycle (`script.js:49`); `dayTime
= (dayTime + dt/300) % 1` (`script.js:893`), only advances while the world
clock `time` runs (paused in menus). Save default `dayTime = 0.32`.

### Sun/moon path (`draw.js:63-76`)
```
celestialPos(p) = {
  x: canvas.width * (0.08 + 0.84*p),
  y: horizonY + canvas.height*0.03 - sin(p*PI) * canvas.height*0.33
}
```
i.e. a single sine arc from left horizon to right horizon, peak height
`0.33·H` above `horizonY+0.03·H`.
- Sun: `p = clamp((dayTime-0.12)/0.76, -0.1, 1.1)`; `sunVisible = p>-0.05 &&
  p<1.05`; `sunRadius = min(W*0.08, H*0.11)`.
- Moon: `q = clamp(((dayTime+0.5)%1 - 0.12)/0.76, -0.1, 1.1)` (opposite phase,
  12h offset); `moonVisible = q>-0.05 && q<1.05`.
- Recomputed every frame by `updateCelestials()`.

**Sun rendering** (`drawSunBody`, draw.js:132): clipped to sky
(`clipToSky`: rect `0,0,W,horizonY-8`). `low = clamp(1-(horizonY-sunY)/(H*0.3),
0,1)` (low-on-horizon factor) grows radius `×(1+low*0.3)` and warms color:
`core = lerp(#fff6c9→#ffe9b0, low)`, `mid = lerp(#ffe066→#ff9d4d, low)`, `rim =
lerp(#ffc94d→#ff7a30, low)`. Two soft outer glow radial gradients (r×3.4 α
0.22-0.32, r×1.7 α0.35) plus the core disc (radial gradient offset up-left,
`core→mid(0.6)→rim(1.0)`). Dimmed by rain: `globalAlpha *= max(0.15, 1-g*0.8)`.

**Moon rendering** (`drawMoon`, draw.js:162): visible only if
`moonVisible && light≤0.75`; `globalAlpha = clamp((0.75-light)/0.4,0,1)`;
`r = sunRadius*0.6`. **Baked as a stamp** (`Blech.stempel("mond", …)`
keyed on rounded radius only — position/alpha applied live): disc `#e9edff`
with `shadowBlur=r` halo `rgba(200,210,255,0.6)`, 3 crater dots `rgba(160,170,
210,0.35)`.

### Stars (`drawStars`, draw.js:101)
Visible when raw `light<0.6`; `α = clamp((0.6-light)/0.5,0,1)`. 90 stars,
deterministic pseudo-random position `sx=(i*7919%1000)/1000*W`,
`sy=(i*104729%1000)/1000*horizonY*0.9`; twinkle `tw=0.5+0.5·sin(time*2+i)`,
per-star `α = base·(0.4+0.6·tw)`; radius 1.8px every 5th star, else 1.1px;
color `#ffffff`.

### Clouds (`drawClouds`, draw.js:187; state in `effects.js:6,55`)
6 clouds, each `{x∈[0,1), y=rand(0.04,0.22), s=rand(0.6,1.4), v=rand(0.006,
0.014)}`, drift `x += v*dt`, wrap at `x>1.25→x=-0.25`. Each rendered as 4
overlapping ellipses (`s*1.6×s*0.55` center, 3 offset puffs) in top color
`rgba(w,w,w,aOben)` with `aOben = 0.25+0.6·light+g*0.2` (g=rain gloom), plus a
darker underside ellipse `rgba(90,105,120,aUnten)`, `aUnten=0.07·light+g*0.32`.
Rain greys cloud color toward `#66707c` (0.75×g) and scales `s×(1+g*0.35)`.

### Birds (`drawBirds`, draw.js:220; state `effects.js:7,56`)
Hidden when `light<0.5`. 3 birds `{x∈[-0.2,1.2], y=rand(0.06,0.2), v=rand(0.03,
0.06), phase, dir:±1}`; each drawn as 2 quadratic-curve wing strokes,
`w=9px` half-span, `flap=sin(phase)*5`, stroke `rgba(30,30,40,0.8)`, 2px.

### Glitter / sun-and-moon sparkle on water (`drawWater`, draw.js:267-284)
Source = sun (if visible & `light>0.3`, `α=0.35·light`) else moon (if visible,
`α=0.25`). For `y` from `horizonY+12` to `horizonY+H*0.3` step 7: 3 candidate
streaks per row; `seed = sin(y*0.37+k*2.1+time*1.7)*cos(y*0.11+time*0.9+k)`,
skip if `seed<0.35`; `gx = srcX + sin(y*1.3+k*4.7)*spread` where
`spread=(y-horizonY)*0.9+10`; draws a `16+k*6 × 2`px white rect at
`α = srcA*(seed-0.35)/0.65`.

### Golden hour (`events.js:57`)
`isGoldenHour() = light>0.4 && light<0.85` — doubles rare-fish odds elsewhere;
purely a light-band check, no unique visual beyond the warm sun/sky palette
already in place at that `dayTime` range.

### Weather (rain/lightning) (`events.js:1-53`)
State `weather = {type:"clear"|"rain", timer, drops[], gloom}`.
- `weather.gloom` eases toward `type==="rain"?1:0` at rate `min(1,dt*0.45)`
  (≈2.2s time-constant) — drives `weatherGloom()` used throughout §2/§3.
- Cycle timers: clear→rain after `rand(30,50)`s; rain→clear after
  `rand(70,140)`s. Toast text on transition (`"Regen zieht auf – die Fische
  beißen!"` / `"Der Regen hört auf."`).
- While raining: spawns 6 drops/frame at `x=rand(-50,W+50), y=-20,
  v=rand(600,900)`; each drop falls `y+=v*dt`, drifts `x+=60*dt`, removed at
  `y>getWave(x)`. Occasional lightning: `Math.random()<dt*0.05` sets
  `weather.flash=1` (decays `-dt*3`) and schedules thunder SFX 400-1000ms
  later. Ripples spawn on the wave line at rate `dt*25`.
- `drawRain()`: white flash overlay `rgba(255,255,255,flash*0.55)` full-screen;
  rain streaks `rgba(200,225,255,0.45)` 1.2px 14px-long diagonals (skipped
  entirely at Arktis — precipitation there is snow, see §1); a constant grey
  overlay wash `rgba(40,60,90,0.18)` over the whole screen while raining.
- Arctic snow is the location's stand-in precipitation (§1), density scales
  with `weatherGloom()`.

---

## 3. Water

### `getWave(x, phase=0)` (script.js:151) — the CPU/pure-logic wave formula
```js
function getWave(x, phase = 0) {
  const waveHeight = 10, waveLength = 25;
  return horizonY
       + Math.sin(x / waveLength + time * 2 + phase) * waveHeight
       + Math.sin(x / 90 - time * 0.7 + phase) * 4;
}
```
Two summed sine waves: primary `wavelength≈25px, amplitude 10px, speed 2rad/s`
+ secondary `wavelength≈90px, amplitude 4px, speed -0.7rad/s` (opposite
direction, "chop"). This exact function also seeds the boat's vertical bob
(`boatY=getWave(boatX)`), rain-drop removal, ripple placement, and the
shader's `waveY()` (same functional form, different parametrization — see
below).

### Surface bands (`drawWater`, draw.js:240-265)
Three filled wave-shaped bands, each `moveTo(0,horizonY+off)` then
`lineTo(x, getWave(x,phase)+off)` for `x` step 5 to canvas edge, closed to
`horizonY+60`:

| layer | off | alpha | phase | color |
|---|---:|---:|---:|---|
| back | 18 | 0.18 | 1.7 | `pal.wBot` |
| mid | 8 | 0.25 | 0.8 | `pal.wTop` |
| front (surface line fill) | 0 | 0.55 | 0 | `pal.wTop` |

Foam/surface line: 1.5px stroke `rgba(255,255,255,0.15+0.25*light)` traced
along `getWave(x,0)`.

### Bobber wake rings, splashes (`effects.js`)
`spawnRipple`: growing stroked ellipse (`rx=r, ry=r*0.35`), `maxR` param,
`α = (1-age/life)*0.7`, white stroke 1.5px, life 1.1s, eased `easeOut`.
`spawnSplash`: 16 drop particles, gravity 700px/s², removed when crossing
`getWave(x)` (spawns a ripple there).

### GPU shader (`world-frag.js`) — copied verbatim

```glsl
// --- Der Wasser- und Licht-Shader der Phaser-Ebene (world.js) ---
//
// Ein Vollbild-Quad, ein Draw-Call. Er bekommt die komplette, von Canvas 2D
// gezeichnete Weltszene als Textur (uMainSampler) und veredelt sie:
//
//   über der Wasserlinie   unverändert durchgereicht (Himmel, Kulisse, Angler)
//   unter der Wasserlinie  Brechung, Spiegelung, Kaustik-Netz, Beer-Lambert-
//                          Trübung, Lichtschächte, Plankton, Glitzern, Schaum
//   Tiefsee                alles ist Wasser: Wabern, Restlicht, Meeresschnee
//
// Weil die FISCHE in derselben Textur liegen, wirken Brechung und Trübung auf
// sie mit — genau die Bedingung aus SPIKE-PHASER.md ("die Szene zieht als ein
// Stück um"). Und weil die Trübung ein Schleier ÜBER dem Fisch ist statt einer
// Deckkraft AM Fisch, baut sie den Fehler #48 nicht nach.
//
// Die Wellenformel ist parametrisiert (uWaveA/uWaveB), damit derselbe Shader
// die Spielszene (getWave, script.js) UND den Ladebildschirm (Intro._wave)
// bedienen kann — nur die Zahlen unterscheiden sich.
//
// FALLE aus dem Machbarkeitsnachweis, hier beherzigt: kein `continue` in
// Shader-Schleifen (machte das gesamte Wasser lautlos schwarz). Nur `if`.

const WORLD_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform sampler2D uMainSampler; // die Weltszene aus Canvas 2D
uniform vec2  uRes;      // CSS-Pixel
uniform float uTime;     // Weltzeit (steht im Menue still)
uniform float uHorizon;  // Wasserlinie in px
uniform vec4  uWaveA;    // Amplitude, 1/Laenge, Tempo, (frei)
uniform vec4  uWaveB;
uniform float uLight;    // Tageslicht 0..1
uniform vec3  uWTop;     // Wasserfarbe oben (Palette des Ortes)
uniform vec3  uWBot;     // Wasserfarbe unten
uniform vec4  uSun;      // x, y, Radius, Staerke (sichtbar * Licht)
uniform vec4  uFx1;      // Brechung, Kaustik, Spiegelung, Glitzern
uniform vec4  uFx2;      // Truebung, Schaum, Vignette, Tiefsee (0/1)
uniform vec4  uCam;      // Hype-Zoom: cx, cy, Faktor, (frei)
uniform vec2  uShake;    // Bildschirmwackeln in px
uniform float uLid;      // Eisdecke: Wasser-Effekte beginnen erst UNTER dieser y-px (0 = keine)
uniform float uBloom;    // echtes Leuchten: Staerke des additiven Halos
// Leistungsstufe (#107). EIN Uniform, zwei Zahlen, und jeder Sprung daran ist
// fuer das ganze Bild gleich - deshalb kostet er auf einer Handy-GPU nichts.
//   x  Bloom-Ringe:      2 = 12 Abtastungen, 1 = 6, 0 = kein Leuchten
//   y  Kaustik-Oktaven:  2 = grobes Netz + feines Flirren + Lichtschaechte,
//                        1 = nur das grobe Netz (und billigere Tiefsee)
//   z  ROH (0/1):        1 = die Szene wird 1:1 durchgereicht, kein einziger
//                        Effekt. Das ist kein Aussehen, das ist ein MESSGERAET:
//                        laeuft es SO fluessig, kosten die Effekte; ruckelt es
//                        auch dann, ist die Bauweise schuld (Kopie + Upload),
//                        und dann hilft kein Regler mehr.
uniform vec3  uQual;

// ===================== Die Orientierung der Quelle (#107, der Umbau) =======
//
// Es gibt zwei Quellen fuer die Szene, und sie liegen unterschiedlich herum:
//
//   0  eine HOCHGELADENE LEINWAND (world.js, Leinwand-Weg). Ohne FLIP_Y
//      angelegt, Zeile 0 liegt also bei v = 0 - wie in Canvas 2D.
//   1  ein KAMERA-FRAMEBUFFER (gpu.js, der Umbau). Der liegt wie jedes
//      Rendertarget in WebGL auf dem Kopf: Zeile 0 liegt bei v = 1.
//
// Ohne diese eine Zahl steht die ganze Welt kopfueber - der Himmel unten, der
// Angler an der Decke. Genau so sah der erste Lauf des Umbaus aus.
uniform float uFlipV;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

// Dieselbe Form wie getWave (script.js) bzw. Intro._wave (intro.js) - nur die
// Parameter kommen von aussen.
float waveY(float x, float ph) {
  return uHorizon + sin(x * uWaveA.y + uTime * uWaveA.z + ph) * uWaveA.x
                  + sin(x * uWaveB.y + uTime * uWaveB.z + ph) * uWaveB.x;
}

// Die Weltszene an einer Pixelposition (y von oben, wie in Canvas 2D).
// Hochgeladen wird ohne FLIP_Y (world.js), Zeile 0 liegt also bei v = 0.
vec3 szene(vec2 p) {
  vec2 uv = clamp(p / uRes, 0.0, 1.0);
  uv.y = mix(uv.y, 1.0 - uv.y, uFlipV);
  return texture2D(uMainSampler, uv).rgb;
}

void main() {
  // ROH: nur durchreichen. Ein Sampler-Zugriff, sonst nichts - damit misst
  // dieser Durchgang ausschliesslich Kopie und Upload (#107).
  if (uQual.z > 0.5) {
    gl_FragColor = vec4(szene(vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uRes), 1.0);
    return;
  }
  // Bildschirm-Pixel, y von oben
  vec2 spx = vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uRes;
  // Hype-Zoom und Wackeln ZURUECKrechnen: alles Weitere passiert in
  // Welt-Koordinaten, damit Wasserlinie und Effekte auf der Szene sitzen.
  vec2 px = (spx - uShake - uCam.xy) / max(uCam.z, 0.001) + uCam.xy;

  vec3 col;
  float wy = waveY(px.x, 0.0);

  if (uFx2.w > 0.5) {
    // ============================ Tiefsee ============================
    // Kein Himmel, keine Linie: das ganze Bild ist Wasser.
    float d = clamp(px.y / uRes.y, 0.0, 1.0);
    // leises Wabern statt Oberflaechenbrechung
    vec2 roff = vec2(sin(px.y * 0.031 + uTime * 0.8) + sin(px.y * 0.011 - uTime * 0.35),
                     cos(px.x * 0.024 - uTime * 0.6)) * 1.7 * uFx1.x;
    col = szene(px + roff);
    // Restlicht von oben: ein breiter, weicher Schimmer. Die erste Fassung
    // hatte hier drei harte Saeulen, die wie Strahlen vom Himmel aussahen
    // (Dustins Fund) - jetzt nur noch ein leises, breites Atmen.
    // Sparsame Stufe: eine Rauschebene statt drei (fBm sind drei noise() und
    // damit zwoelf sin() je Pixel - der teuerste Einzelposten im Tiefsee-Zweig)
    float shaft = uQual.y > 1.5 ? fbm(vec2(px.x / uRes.x * 2.2 + uTime * 0.05, uTime * 0.1))
                                : noise(vec2(px.x / uRes.x * 2.2 + uTime * 0.05, uTime * 0.1));
    col += vec3(0.3, 0.5, 0.7) * (0.35 + 0.65 * shaft) * exp(-d * 4.0) * 0.045;
    // Beer-Lambert in die Schwaerze - deutlich gedeckelt: man muss mit der
    // Harpune auf einzelne Fische ZIELEN koennen. Fern heisst hier blasser
    // (der Restlicht-Schleier kommt von den Fischen selbst, fish.js),
    // nicht schwarz.
    col = mix(col, vec3(0.01, 0.028, 0.055), min(0.35, (1.0 - exp(-d * 2.0)) * 0.4 * uFx2.x));
    // Meeresschnee: zwei Ebenen traege sinkender Flocken
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      // zweite Ebene nur auf der vollen Stufe - mit if, nicht mit continue
      // (die FALLE aus dem Kopf dieser Datei)
      if (i == 0 || uQual.y > 1.5) {
        float sc = 0.017 + fi * 0.012;
        vec2 pg = vec2(px.x * sc + fi * 7.3 + sin(uTime * 0.2 + fi) * 0.3,
                       px.y * sc - uTime * (0.05 + fi * 0.04));
        vec2 cell = floor(pg);
        vec2 f = fract(pg) - vec2(hash(cell), hash(cell + 3.7));
        float fl = exp(-dot(f, f) * 260.0) * step(0.72, hash(cell + 11.0));
        col += vec3(0.55, 0.72, 0.85) * fl * 0.32;
      }
    }
  } else if (px.y < max(wy, uLid)) {
    // ================== ueber Wasser (oder auf dem Eis) ==============
    // Die Arktis friert die Oberflaeche ein: alles bis zur Unterkante der
    // Eisdecke (uLid) wird unveraendert durchgereicht - sonst "wellt" das
    // Wasser durch das Eis (Dustins Fund am Zwischenstand).
    col = szene(px);
  } else {
    // ============================= Wasser ============================
    float d = clamp((px.y - uHorizon) / max(uRes.y - uHorizon, 1.0), 0.0, 1.0);
    float edge = px.y - wy;
    // offene Oberflaeche? Unter einer Eisdecke gibt es keine Wellen-Baender
    // und keinen Schaum - das sind Phaenomene der freien Wasserlinie.
    float surf = uLid > 1.0 ? 0.0 : 1.0;

    // Brechung: Versatz nach der Neigung der Oberflaeche, dazu traege Wogen
    // in der Tiefe. Bricht ALLES in der Textur - auch die Fische.
    // Der HUB: was dicht unter der Oberflaeche liegt, faehrt sichtbar mit
    // DERSELBEN Welle auf und ab wie die Linie darueber - erst diese
    // Kopplung macht aus dem Filter eine Oberflaeche ("man merkt, dass
    // man auf Wasser guckt"). Klingt mit der Tiefe ab, wie Brechung es tut.
    float slope = (waveY(px.x + 2.0, 0.0) - waveY(px.x - 2.0, 0.0)) * 0.25;
    float sway = sin(px.y * 0.045 - uTime * 1.1 + sin(px.x * 0.012)) * (0.5 + d);
    float lift = (uHorizon - wy) * exp(-d * 3.0) * 0.75;
    vec2 roff = vec2(slope * 14.0 * exp(-d * 2.1) + sway * 0.9,
                     lift + cos(px.x * 0.02 + uTime * 0.8) * 0.6) * uFx1.x;
    col = szene(px + roff);

    // Spiegelung von Steg, Boot, Angler und Himmel dicht unter der Linie.
    // Direkt an der Linie ein schmales, fast blickdichtes Spiegelband:
    // flach auf Wasser geschaut wird es zum Spiegel (Fresnel), erst mit
    // steilerem Blick darunter gibt es den Blick nach unten frei.
    if (uFx1.z > 0.001) {
      float ra = uFx1.z * (exp(-edge / (uRes.y * 0.05)) * 0.38 + exp(-edge / 13.0) * 0.3);
      vec2 rp = vec2(px.x + sin(px.y * 0.11 + uTime * 1.9) * 5.0, wy - edge * 1.12 - 2.0);
      col = mix(col, szene(rp), clamp(ra, 0.0, 0.72));
    }

    // Die drei Wellen-Baender aus drawWater (draw.js:183), als Formel.
    // smoothstep statt step: die harten 1-px-Kanten waren als Treppchen
    // sichtbar (Dustins "pixelig an den Kanten").
    float bandEnd = smoothstep(72.0, 26.0, px.y - uHorizon) * surf;
    col = mix(col, uWBot, 0.18 * smoothstep(-0.9, 0.9, px.y - waveY(px.x, 1.7) - 18.0) * bandEnd);
    col = mix(col, uWTop, 0.25 * smoothstep(-0.9, 0.9, px.y - waveY(px.x, 0.8) - 8.0) * bandEnd);
    col = mix(col, uWTop, 0.45 * smoothstep(-0.9, 0.9, px.y - wy) * bandEnd);

    // Kaustik: zwei ueberlagerte Lichtnetze (grob traegt, fein flirrt)
    vec2 cq = vec2(px.x + roff.x * 2.0, px.y) * 0.035;
    float c1 = sin(cq.x * 1.7 + cq.y * 0.9 + uTime * 0.9);
    float c2 = sin(cq.x * -1.1 + cq.y * 2.3 - uTime * 0.7);
    float c3 = sin((cq.x + cq.y) * 1.9 + uTime * 1.3);
    float cNet = pow(max(0.0, (c1 + c2 + c3) / 3.0), 6.0);
    float caust = cNet;
    if (uQual.y > 1.5) {
      vec2 cf = cq * 2.3;
      float f1 = sin(cf.x * 1.3 - cf.y * 1.1 - uTime * 1.1);
      float f2 = sin(cf.x * -0.9 + cf.y * 1.9 + uTime * 0.8);
      // die feine Oktave flirrt nur DORT, wo das grobe Netz ohnehin hell ist -
      // frei stehend bildete sie diagonale Streifen (Artefakt, kein Licht)
      caust += pow(max(0.0, (f1 + f2) / 2.0), 7.0) * 0.7 * smoothstep(0.01, 0.12, cNet);
    }
    caust *= exp(-d * 2.6) * uLight * uFx1.y;
    col += vec3(0.85, 0.95, 1.0) * caust * 0.5;

    // Lichtschaechte von der SONNE, mit wanderndem Rauschen. Nur bei echtem
    // Tageslicht - der Mond wirft Glitzern, aber keine Schaechte (nachts
    // standen hier drei fahle Saeulen im Wasser, die nach nichts aussahen).
    // Unter einer Eisdecke stark gedaempft: dort kommt Licht diffus an.
    // Auf der sparsamen Stufe fallen sie weg: ein fBm je Pixel (zwoelf sin())
    // fuer einen Schleier, den man ohne Vergleichsbild nicht vermisst.
    float shaftOn = smoothstep(0.35, 0.6, uSun.w) * step(1.5, uQual.y);
    if (shaftOn > 0.01) {
      float sx = (px.x - uSun.x) / uRes.x;
      float shaft = fbm(vec2(sx * 6.0 - d * 1.1, uTime * 0.22));
      col += vec3(1.0, 0.98, 0.88) * smoothstep(0.55, 0.95, shaft)
             * 0.10 * shaftOn * uSun.w * (1.0 - d * 0.75) * min(uFx1.y, 1.0) * surf;
    }

    // Truebung: exponentielle Ausloeschung (Beer-Lambert). Der Schleier liegt
    // ZWISCHEN Betrachter und Fisch - Entfernung ist Diesigkeit, nicht
    // Durchsichtigkeit (#48).
    float turb = 1.0 - exp(-d * 1.9 * uFx2.x);
    col = mix(col, uWBot * 0.55, turb * 0.55);

    // Plankton: Punktfeld ohne Draw-Call - vereinzelt, nicht als Rauschen
    vec2 pg = vec2(px.x * 0.02 + uTime * 0.06, px.y * 0.02);
    vec2 cell = floor(pg);
    vec2 f = fract(pg) - vec2(hash(cell), hash(cell + 3.7));
    float pl = exp(-dot(f, f) * 220.0) * step(0.72, hash(cell + 11.0));
    col += vec3(0.78, 0.92, 1.0) * pl * 0.35 * (1.0 - d * 0.5) * min(uFx1.y + 0.3, 1.0);

    // Sonnenglitzern knapp unter der Oberflaeche: Streifen, die mit den Wellen
    // wandern - grob genug, dass es funkelt statt zu rauschen
    if (uSun.w > 0.02 && uFx1.w > 0.001) {
      float band = exp(-(px.y - uHorizon) / 80.0);
      float g = noise(vec2(px.x * 0.055 - uTime * 1.9, px.y * 0.35 + uTime * 0.4));
      g *= 0.6 + 0.4 * sin(px.x * uWaveA.y + uTime * uWaveA.z);   // an die Wellenkaemme geheftet
      col += vec3(1.0) * smoothstep(0.62, 0.95, g) * band * 0.5 * uSun.w * uFx1.w
             * exp(-abs(px.x - uSun.x) / (uRes.x * 0.22));
    }

    // Schaumlinie, vom Rauschen aufgebrochen statt durchgezogen
    float foam = smoothstep(2.6, 0.0, edge) * (0.18 + 0.30 * uLight) * uFx2.y * surf;
    foam *= 0.55 + 0.45 * noise(vec2(px.x * 0.08 - uTime * 1.4, uTime * 0.5));
    col += vec3(1.0) * foam;
  }

  // ======================= echtes Leuchten =========================
  // Additiver Halo um alles, was heller ist als die Schwelle: die
  // Leuchtangel des Anglerfischs, Neonfische, Mond, Sonne, Korallen.
  // 12 Abtastungen auf zwei Ringen, direkt aus der Szenentextur - ein
  // Pass, kein Zwischenpuffer, und damit auch beim Kontextverlust simpel.
  // Auf der mittleren Stufe bleibt nur der INNERE Ring (6 Abtastungen). Der
  // aeussere traegt den weichen Ausklang bei; ohne ihn ist der Halo enger,
  // aber er ist da. Deshalb wird der innere staerker gewichtet.
  if (uBloom > 0.005 && uQual.x > 0.5) {
    vec3 halo = vec3(0.0);
    float w1 = uQual.x > 1.5 ? 1.0 : 1.5;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0471976;                    // 60 Grad
      vec2 dir = vec2(cos(a), sin(a));
      halo += max(vec3(0.0), szene(px + dir * 5.0) - 0.66) * w1;
      if (uQual.x > 1.5) {
        halo += max(vec3(0.0), szene(px + vec2(cos(a + 0.5236), sin(a + 0.5236)) * 12.0) - 0.66) * 0.65;
      }
    }
    col += halo * (uBloom / 4.5);
  }

  // Vignette (ersetzt die Flaeche aus drawDepthFog)
  float vig = smoothstep(0.45, 1.0, distance(spx / uRes, vec2(0.5))) * 0.28 * uFx2.z;
  col = mix(col, vec3(0.0, 0.0, 0.055), vig);

  gl_FragColor = vec4(col, 1.0);
}
`;
```

### Shader effect inventory (by name)
- **Refraction** (`uFx1.x`): screen-space distortion of the sampled scene,
  slope- and depth-coupled to the wave line, plus a slow `sway`/`lift` wobble
  that visibly rides the same wave as the surface line.
- **Reflection/mirror** (`uFx1.z`): narrow specular band right under the
  waterline sampling the scene mirrored/offset vertically (Fresnel-like double
  exponential falloff `exp(-edge/(H*0.05))` + `exp(-edge/13)`).
- **Surface wave bands**: 3 `smoothstep`-blended color bands replicating
  `drawWater`'s CPU bands as a formula (so both renderers show the same
  banding even under the shader).
- **Caustics** (`uFx1.y`): two overlaid triple-sine interference nets
  (`pow(...,6)` coarse + optional `pow(...,7)` fine flicker gated by the
  coarse net's brightness), `exp(-d*2.6)*light` depth/light falloff.
- **God rays / light shafts**: `fbm`-noise streaks fanning from the sun's x
  position, only at `uSun.w>0.35` (real daylight, not moon) and only at
  `uQual.y>1.5` (top quality tier).
- **Turbidity/depth fog** (`uFx2.x`): Beer-Lambert `1-exp(-d*1.9*murk)` mix
  toward `wBot*0.55`, capped at 0.55 — a veil *in front of* the fish, never an
  opacity *on* the fish (explicit fix of a prior "#48" transparency bug).
- **Plankton**: cheap stamp-free point field via `hash`/cell noise, no draw
  call, `exp(-dot(f,f)*220)` falloff.
- **Sun glitter** (`uFx1.w`): noise streaks banded to `exp(-(y-horizon)/80)`
  and phase-locked to the wave crests (`sin(x*uWaveA.y+time*uWaveA.z)`),
  fading with horizontal distance from the sun.
- **Foam**: `smoothstep(2.6,0,edge)` line broken up by 1D noise, scaled by
  `uFx2.y` and `light`.
- **Deep-sea branch** (`uFx2.w`): replaces the whole above pipeline — waver
  refraction (no wave line), broad ambient light shimmer from above
  (`fbm`/`noise` pick by quality), Beer-Lambert fade to near-black
  `vec3(0.01,0.028,0.055)` capped at 0.35, 2-layer marine snow (cell noise
  flakes sinking, second layer only at top quality).
- **Ice lid** (`uLid`): everything above this y (even below the wave line) is
  passed through unmodified — water effects only start under the physical ice
  hole.
- **Bloom**: additive 6-or-12-tap glow sampled from the *scene itself* above a
  `0.66` brightness threshold, radius 5px (inner ring) / 12px (outer ring,
  full quality only), strength `uBloom/4.5`.
- **Vignette** (`uFx2.z`): radial darken to `vec3(0,0,0.055)`,
  `smoothstep(0.45,1.0,dist)*0.28`.
- **uCam/uShake**: un-does hype-zoom and screen-shake before computing effects
  in world space, so waterline/effects stay glued to the scene through zoom
  and shake.
- **uFlipV**: 0 for an uploaded canvas texture (row 0 = v0, "Leinwand" path),
  1 for a WebGL camera framebuffer (row 0 = v1, "Umbau"/GPU-objects path).

### Uniforms fed from `world.js` (`_setUniforms`, world.js:1579; values built by `worldGameProfile()`, world.js:1633)

| Uniform | Meaning | Per-frame source |
|---|---|---|
| `uRes` | `[canvas.width, canvas.height]` CSS px | `canvas` |
| `uFlipV` | 1 if scene comes from a GPU camera framebuffer (`Gpu.bereit`), else `dynFlip` (DYN path) or 0 | render-path branch |
| `uTime` | world clock `time` (frozen in menus) | `time` |
| `uHorizon` | `horizonY` | `resizeCanvas` |
| `uWaveA` | `[10, 1/25, 2, 0]` — amplitude, 1/wavelength, speed, spare | constant, matches `getWave` primary term |
| `uWaveB` | `[4, 1/90, -0.7, 0]` — same for the secondary term | constant, matches `getWave` secondary term |
| `uLight` | `pal.light * (1 - gloom*0.45)` | `getPalette(dayTime)`, `weatherGloom()` |
| `uWTop`/`uWBot` | `rgb01(pal.wTop/wBot)` (0..1 float RGB) | `getPalette(dayTime)` |
| `uSun` | `[srcX, srcY, sunRadius, strength]`; source = sun if `sunVisible && light>0.25` else moon; `strength = (sunOn?light:(moonVisible?0.42:0)) * (1-gloom*0.8)` | celestial state |
| `uFx1` | `[refr, caust, mirror, glitz]` from `WATER_PROFILES[loc.id]` | location table (below) |
| `uFx2` | `[murk, foam, vig, deep(0/1)]` from same table | location table |
| `uCam` | `[hz.x, hz.y, hz.k, 0]` hype-zoom center+factor (`hypeZoom()`, `{x,y,k:1}` default) | `hype.js` |
| `uShake` | `[rand(-shake,shake), rand(-shake,shake)]` if `shake>0.05` else `[0,0]` | `shake` global (hit/impact feedback) |
| `uLid` | `dockY + dockHeight*1.5` if `loc.mode==="ice"` else 0 | ice geometry |
| `uBloom` | `(P.bloom||0) * (0.5 + (1-light)*1.1)`, zeroed if quality tier has no bloom rings or diag-disabled | location table × daylight |
| `uQual` | `[bloom?0:tier.ringe, snow?1:tier.oktaven, roh?1:0]` performance-tier + diagnostic overrides | `World.stufe`, `World.roh` |

### `WATER_PROFILES` (world.js:35-44) — per-location shader character

| loc | refr | caust | mirror | glitz | murk | foam | vig | bloom | deep |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| see | 1.0 | 0.9 | 0.55 | 0.8 | 1.0 | 1.0 | 1.0 | 0.3 | – |
| boot | 1.1 | 0.7 | 0.65 | 1.0 | 1.15 | 1.0 | 1.0 | 0.35 | – |
| kueste | 1.25 | 0.8 | 0.5 | 1.1 | 1.05 | 1.3 | 1.0 | 0.3 | – |
| riff | 1.0 | 1.6 | 0.45 | 1.2 | 0.55 | 1.0 | 0.9 | 0.4 | – |
| tiefsee | 1.0 | 0 | 0 | 0 | 1.0 | 0 | 1.15 | 1.2 | 1 |
| arktis | 0.65 | 0.18 | 0 | 0 | 1.0 | 0 | 1.0 | 0.3 | – |

Riff is the clearest water (`murk 0.55`) with the strongest caustics (`1.6`);
Arktis has almost no refraction (ice-protected) and zero mirror/glitz/foam
(frozen surface).

### CPU-side (Canvas 2D fallback) water dressing (`visuals.js`)
- `drawGodRays` (visuals.js:4): 7 soft additive light cones from the sun (or
  dim moon) below the waterline, swaying `sin(time*0.35+i*1.3)*40`, alpha
  `0.10*light` (sun) or flat `0.05` (moon), reduced ×0.3 in Tiefsee.
- `drawCaustics` (visuals.js:30): 12 drifting stroked ellipses,
  `rgba(255,255,255,0.045*light)`, additive, only when `light≥0.3`.
- `drawSurfaceMirror` (visuals.js:80): the CPU-path reflection — blits **8
  horizontal slices** of the strip above the waterline back below it
  (`ctx.scale(1,-1)` mirror), each slice offset by `sin(time*1.9+t*5.4)*
  (1.5+t*5)` and fading `α = k*0.5*(1-t)²` (quadratic falloff with depth,
  `k = WATER_PROFILES[loc].mirror`). Band height `min(H*0.13,130)`px. Skipped
  for `dive`/`ice` modes. Self-disables under sustained frame time >20ms,
  re-enables under 17ms (hysteresis) — a pure performance guard, not part of
  the target look.
- `drawDepthFog` (visuals.js:123): linear gradient `rgba(0,10,30,0)→
  rgba(0,10,30,0.04)@55%→rgba(0,8,25,0.22)@100%` over the water area, plus a
  radial vignette `rgba(0,0,0,0)→rgba(0,0,20,0.28)`.
- `drawFishShadows` (visuals.js:133): soft ellipse shadow under each fish,
  `rgba(0,10,30,0.18)`, offset `+0.2L, +0.9L` below the fish (L = fish unit
  size), skipped for faded fleeing fish.

---

## 4. Angler, Diver, Harpoon

All proportions are relative to `s = dockHeight` (`≈ max(14, canvas.height*
0.03)`), anchored at `x = rodBaseX + s*1.2, y = dockY` (`_drawAngler`,
draw.js:334-511). A gentle idle breathing offset `breathe = sin(time*1.6)*
s*0.03` is applied to torso/head y.

### Body construction (single-pass silhouettes, not part sprites)
1. Contact shadow: radial gradient ellipse under the seat, `rgba(0,0,0,
   0.16+0.12*dl)→0`, where `dl = daylight()`.
2. **Legs** (`leg(ox,oy,tone)` closure, called twice — back leg darker
   `dark(o.pants)` at `ox=-0.42`, front leg `o.pants` at `ox=-0.62`): one
   continuous path hip→knee→shin, ×`s`; boots grow out of the pant leg (not a
   separate shape) with a cap, sole strip `#4a3b2a`.
3. **Torso**: one closed bezier/quad path (`torso()`), filled with a
   left-to-right linear gradient `light(body)→body(0.5)→dark(body)`. Interior
   details (zipper, fold lines, pocket, outfit stripe/flower pattern, rim
   light, collar shadow) are drawn **clipped to the torso path**.
4. Outfit extras: `o.fur` → fur collar ellipse `#f7f3ee` on shoulder line;
   `o.stripe` → colored ribbon across chest + 3 button dots; `o.pattern===
   "flowers"` → 6 yellow dots `#ffe066`.
5. **Head**: trapezoid neck growing from collar (`dark(skin)`), then a radial
   -gradient sphere `light(skin)→dark(skin)` for the skull, ear disc `skin`,
   nose disc `dark(skin)`, hair patch + sideburn + eyebrow stroke `#4a3222`.
6. **Face**: mood driven by `gameState`: `biting→surprised` (wide eye+pupil),
   `reeling→focused` (flat eye rect), `caught→happy`, `(time-lastEscape<1.6)→
   sad`, else `calm`. Mouth is an arc (happy: smile arc `0.15..π-0.4`; sad:
   inverted arc; surprised: small O; else: short flat line).
7. **Hat** drawn via `drawHat(getHat(), hx, hy, hr)` — attachment point =
   head center `(hx,hy)`, scale `hr` (head radius = `s*0.58`); a soft brim
   shadow ellipse is drawn first for every hat.
8. **Rod-holding arm**: shoulder `(shX,shY)=(x-0.5s, ty+0.52s)`, elbow
   `(elX,elY)=(x-0.98s, ty+1.62s)`, hand `(haX,haY)=(rodBaseX+0.16s,
   rodBaseY-0.6s+0.06s)` — i.e. the hand attachment point is locked to the
   rod's grip position. Upper/forearm are conic strokes (dark outer + light
   inner pass), shoulder cap + elbow rondel circles, fist ellipse + thumb
   curl.
9. Second (idle) arm: a stroke from torso to a resting hand ellipse on the
   knee at `(x-0.98s, y-0.42s)`.

### `getOutfit()` fields used: `body, pants, skin, stripe?, pattern?, fur?`.
See `OUTFITS` table in shop.js (colors below, §8).

### Color-shading helper — `shadeColor(col, amt)` (fish.js:60), used for every
lit/shaded surface in the whole game (angler, hats, rod, harpoon, fish):
```js
function shadeColor(col, amt) {
  // amt<0: v *= (1+amt)   (darken toward 0)
  // amt>=0: v += (255-v)*amt  (lighten toward 255)
  // returns "rgba(r,g,b,a)"
}
```
`dark(c) = shadeColor(c, -(0.24+0.1*(1-dl)))`, `light(c) = shadeColor(c,
0.12+0.14*dl)` where `dl = daylight() = getPalette(dayTime).light` — lighting
strength itself is tied to the day/night curve (flatter modeling at night).

### Hats (`drawHat`, draw.js:798) — attachment point `(x,y)` = head center,
`s` = head radius. Each `hv(col,y0,y1)` helper builds a vertical gradient
`light(col,0.16+0.12·dl)→col(0.55)→dark(col,-0.24)` for lit hat faces. 16
variants keyed on `hat.id`: `cap, stroh (straw), muetze (christmas), kapitaen
(captain), pirat, zylinder (top hat), kranz/blumenkranz (wreaths), nessiemuetze,
moewenhut (seagull hat), leuchthelm (glow miner helmet, `shadowBlur=1.2s` cyan
`#9fffe0`), eiskrone, perlenkrone, krone (crown w/ red+2 blue gems), default =
`angler` bucket hat (green `#3f7a4a`). Exact per-variant paths/colors are in
draw.js:813-931 (unabridged; port geometry 1:1 for a faithful rebuild — every
shape is expressed in multiples of `s`).

### Rod (`drawRod`/`_drawRod`, draw.js:558-694)
- `rodBend` (0..1, global) interpolates the visible rod tip:
  `curRodTipX = lerp(rodTipX, rodTipX+(bobberX-rodTipX)*0.25, bend)`,
  `curRodTipY = lerp(rodTipY, rodTipY+60*bend, bend)`.
- The rod is a **quadratic bezier** from grip `(bx,by)=(rodBaseX, rodBaseY-
  0.6s)` through control `(cx,cy) = lerp(midpoint, {bobberX, rodTipY+40},
  bend*{0.35,0.6})` to tip `(tipX,tipY)` (same lerp as above). `P(t)`/`N(t)`
  give point and normal along the curve; width tapers `w0=max(2.6,s*0.16)`
  (grip) → `w1=max(0.9,s*0.05)` (tip), 10 segments, filled as a closed
  ribbon along ±normal.
- 5 line guides at `t = 0.3, 0.5, 0.68, 0.84, 0.97`, radius shrinking toward
  tip `(1-t*0.6)`, each a stand-off stroke + ring + wrap-band.
- Cork grip: thick round-cap stroke behind the base, dashed shading overlay,
  black end-cap.
- Reel: radial-gradient disc `#5a616b→#23262c` at `(rx,ry)` (computed from the
  grip's normal), radius `rr=max(3,s*0.24)`, accent-color spool center. Crank
  (the **only live-every-frame part when otherwise baked**) spins
  `spin=time*14` while actively reeling/retrieving, else idle `time*0.4`; a
  small light dot orbits at `rr*1.15`.
- Skins (`getRodSkin()`): plain `color`/`accent`, or a rainbow HSL cycle
  (`hsl((time*60)%360,90%,55%)`), or 4 gradient FX along the shaft (`gamma`
  pulsing green/teal, `fade` yellow→pink→purple, `case` 9-stop blue/gold,
  `marble` yellow/red/purple/blue), or 3 pattern overlays drawn by
  `drawRodPattern` (`tiger` black diagonal bands, `web` spidery line fans,
  `slaughter` light veins).
- Diving mode substitutes `drawHarpoon()` for the rod entirely (see below).

### Line sag / bow (`drawLine`, draw.js:697; `updateLine`, draw.js:710)
Single quadratic curve from `(curRodTipX,curRodTipY)` to `(bobberX,bobberY)`
via midpoint `(mx,my)`:
```
sag = reeling ? 14+|lineBow|*0.35 : casting ? 0 : 25      // px vertical sag
bow = reeling ? lineBow + sin(time*27)*3 : 0               // px horizontal bow+shiver
mx = (curRodTipX+bobberX)/2 + bow
my = (curRodTipY+bobberY)/2 + sag
```
`lineBow` itself eases toward `clamp((bobberX-prevBobberX)*9,-70,70)` at rate
`min(1,dt*7)` — a lag/whip response to bobber velocity. Line width 1.4px
while reeling, else 1px, color `rgba(255,255,255,0.85)`.

### Hook (`drawHook`, draw.js:935)
Leader line from `(bobberX,bobberY+6)` to the hook target — a straight line
normally, a quadratic curve bowed by `lineBow*0.6` while reeling — target is
`hookedFish.{x,y}` (offset by fish length toward its facing direction) during
reeling, else `(hookX,hookY)`. The hook shape itself (`#cfd6dd`, 2px, round
cap: vertical stem + half-circle barb, `r=5*uiScale()`) is only drawn when not
reeling (it's "in the fish's mouth" otherwise). Bait icon (emoji from
`getBait().icon`) rendered at `(hookX-1.6s, hookY+1.8s)` — emoji font is
listed **first** in the font stack specifically so Canvas emoji rendering
doesn't depend on a fallback from the custom web font.

### Bobber skins (`drawBobberSkin`, draw.js:731; called from `drawBobber`,
draw.js:720 at `(bobberX, bobberY+dip)`, `r=7*uiScale()`)
`dip` (bobble animation): `biting→|sin(time*18)|*9`; `reeling→4+sin(time*30)*2`;
`waiting` w/ nibble>0 → `|sin(time*40)|*4*(nibble/0.35)`, `nibble` decays
`-1/60`/frame.
10 `BOBBERS` skins (shop.js:22): default classic float (stick + 2-tone dome,
top color over main color, white highlight dot) recolored per `main`/`top`,
plus special shapes selected by `skin.shape`/`skin.duck`/`skin.rainbow`:
`duck` (rubber duck), `heart`, `strawberry`, `ball` (soccer pentagons),
`skull`, `disco` (mirror-ball facets rotating `time*2` + 4 sweeping light
rays), and `rainbow` (cycling HSL on the classic shape).

### Diver (`drawDiver`, dive.js:95) — replaces the angler at `tiefsee`
Anchor `(x,y) = (rodBaseX+s*1.2, dockY + sin(time*1.1)*s*0.12)` (floats,
sinusoidal bob). Headlamp is a real **additive light cone** (radial gradient,
`globalCompositeOperation="lighter"`, `coneLen=s*7`, flicker
`0.92+0.08*sin(time*7.3)`) painted *into the scene* so shader turbidity/bloom
react to it — the diver's only light source in a sunless world. Draw order:
lamp cone → fins (2, kicking `sin(time*2.2)*s*0.35`) → O2 tank (`#e0a020`) +
strap → wetsuit body (rounded rect, gradient `suitLight→suit`, `suit=
"#1d2b3a"`) → outfit-colored accent stripe (so outfit skins still register
underwater) → arms (one reaching to `diverHandX/Y() = rodTipX/rodTipY`, i.e.
the harpoon grip point) → hooded head growing seamlessly from the suit → mask
frame + lamp housing + glass (gradient `rgba(190,235,255,.95)→rgba(90,160,
200,.9)`) → 2 eyes behind glass (blink every 4.5s for 0.12s) → glass glare
triangle → regulator disc → breath bubbles (spawned at mask, `p<0.08/frame`
while `diveBubbles.length<90`).

### Harpoon (`drawHarpoon`, dive.js:220) — replaces the rod at `tiefsee`
- Charge/aim: `startCharge`→`aimCharge`→`releaseCharge` (hold-to-charge,
  `t/0.85` clamped 0.25..1) drives `harpoonRange(charge) = hypot(W, bottomBarY
  ()-horizonY) * (0.55+rod.radius*0.5) * (0.6+0.4*charge)`.
- Flight (`updateHarpoon`, dive.js:57): `speed = max(W,H)*(0.85+0.95*charge)`;
  travels in a straight line from the diver's hand; hit-tests every live fish
  within `fishUnit(f)*0.55+6` px; on miss beyond `max` range or off-screen it
  reverses ("back" state) at `1.6×` speed back to the hand.
- Rendering: leader line (quadratic curve, `rgba(230,245,255,0.75)`) from hand
  to tip while flying/stuck. The shaft itself is a **tapered cone** (thick at
  the grip `wB=max(1.6,s*0.11)`, fine at the tip `wF=max(1,s*0.06)`) with a
  linear gradient shaft (`shadeColor(shaft,-25)→shadeColor(shaft,20)`),
  optional `skin.glow` shadowBlur 10, grip wrap + rubber tension band (wobble
  `sin(time*5)`), a barbed triangular tip in `accent` color, and — for
  glow skins — an additive radial light pool at the tip (same technique as
  the diver's headlamp / deep-sea coral light pools).
- Skins: `HARPOONS` table (shop.js), same `fx` overlay system as rod skins
  (`drawRodPattern` reused), colors in §8.

---

## 5. `gpu.js` — primitive abstraction

`gpu.js` implements `GpuCtx`, a class that mimics the **Canvas 2D
`CanvasRenderingContext2D` API surface** used by the existing draw code
(`draw.js`/`backdrop.js`/`fish.js`/`locations.js`/`effects.js` are completely
unmodified — they call the same `ctx.*` methods) and translates every call
into Phaser 4 GPU objects instead of rasterizing. This is the "abstraction
layer" a GPU sprite-renderer rebuild should study/replace.

**State/transform**: `save/restore`, `translate/scale/rotate/transform/
setTransform/resetTransform/getTransform` — kept as a plain 2×3 matrix
`this.m`, applied manually to every point (`_p(x,y)`).

**Path building**: `beginPath/moveTo/lineTo/closePath/quadraticCurveTo/
bezierCurveTo/arc/arcTo/ellipse/rect/roundRect` — curves are flattened to line
segments at *build time* via `_segmente(length)` (sqrt-scaled: `max(3,
min(16, ceil(sqrt(length_in_device_px)*0.8)))`) and `ellipse()`'s own
`n = max(6,min(40, ceil(|Δangle|/2π*(4+sqrt(deviceRadius)*2))))` — deliberately
coarse (measured: a naive 1/6px segment budget cost 2.8ms/frame on clouds and
birds alone).

**Fill/stroke → Phaser Graphics (geometry, no texture upload)**:
- Flat-color fill/stroke of an arbitrary polygon → `Graphics.fillPoints`/
  `strokePoints`.
- `fill("evenodd")` with multiple subpaths (a ring, e.g. the freezing ice
  hole) is converted into **one polygon with a bridge-cut hole** (`_mitLoechern`
  — connects each hole's rightmost point to the nearest outer-ring point,
  standard hole-bridging for a single-polygon triangulator).
- Linear-gradient fills over an arbitrary shape are decomposed into up to
  **20 bands perpendicular to the gradient axis** (`_verlaufFuellen`,
  Sutherland-Hodgman half-plane clips), each band solid-colored.
- Linear-gradient fills over an axis-aligned rect are instead baked as a **1D
  gradient strip texture** and stretched across the rect
  (`_verlaufRechteck`/`streifenTextur`) — exact color stops, no banding (used
  for sky/water/ice/haze gradients).
- Radial-gradient fills (any shape) are baked into a small square texture
  (`rundTextur`, next power-of-two ≥ edge, ≤256px, circularly masked) and
  drawn as a textured quad over the path's bounding box — one bake per unique
  (size, focal-offset, quantized-color-stop) key, reused across identical
  gradients (e.g. every fish of the same species/glow shares one texture).
- Strokes: `Graphics.strokePoints`, with manual dash-pattern segment walking
  when `setLineDash` is active, and round-cap circles at open path ends.

**Images → Phaser Image (textured quad)**: `drawImage` (all 3/5/9-arg forms)
becomes one pooled `Image` game object per call: position/rotation/scale
derived from the current matrix, `setCrop` for sub-rect draws, `setBlendMode`
(`lighter` → additive), `setAlpha`. A `viereckGefaerbt` variant recolors the
image via Phaser's tint-fill mode (used instead of the removed
`setTintFill`).

**Gradients as objects**: `createLinearGradient/createRadialGradient/
createConicGradient` (conic degrades to a radial with r0=0) → `GpuGradient`
(stores stops, exposes `.bei(t)`/`.mitte()` for approximate solid-color use
where geometry can't carry a real gradient).

**Clipping without a stencil**: `clip()` reduces the current path to an
axis-aligned bounding box plus, if the path is a single **convex** polygon
(≤96 verts), its exact edges as half-planes; concave paths (e.g. a fish
silhouette with fins) fall back to just the bbox. Clipped fills/strokes are
polygon-clipped against these half-planes before upload; clipped images are
rectangle-cropped.

**Not supported → explicitly documented as "must be baked to a canvas
first"**: shadows/`shadowBlur`, patterns (`createPattern` returns null),
non-rectangular multi-clip stacks, arbitrary composite modes beyond
`source-over`/`lighter`. Anything using these goes through `Blech` (§6) to
become a plain texture, then flows through the `drawImage` path above.

**Text**: none — `fillText/strokeText` are no-ops in the world layer; the
project keeps all text on the Canvas 2D UI overlay above the GPU layer.

**Output/scene management (`Gpu` object)**: pools and reuses `Image`/
`Graphics` objects across frames (never allocates per-frame — avoids GC
pauses), assigns Phaser `depth` incrementally per draw call so z-order exactly
mirrors call order, converts CSS color strings/`rgba()`/`hsl()` to packed
`0xRRGGBB` + separate alpha (cached), and turns any `<canvas>` source
(including `Blech` bake targets) into a Phaser texture exactly once, only
re-uploading when the source canvas's own `__gpuVer` bake-counter changes.

**Conclusion for the rebuild**: the primitive set the old renderer actually
needs is small — **filled/stroked polygons and lines (flattened curves),
textured quads (with crop/tint/blend), axis-aligned rect clipping, and small
pre-baked gradient/shadow textures**. A native sprite-renderer rebuild should
skip this Canvas-2D-emulation layer entirely and author scenery directly as
sprites/tilemaps/particle emitters/shader materials — this section exists so
the rebuild knows which *visual behaviors* (see §1-4) that emulation was
standing in for.

---

## 6. `blech.js` — baking system, lessons for the rebuild

`Blech` ("baking sheet") is a signature-keyed canvas cache: draw a motif once
into an offscreen canvas, then `drawImage`-copy it every subsequent frame
until its **signature** changes. Two entry points:
- `Blech.bild(key, sig, x,y,w,h, mal)` — a big motif, baked to whole **device
  pixels** (see subpixel note below).
- `Blech.stempel(key, sig, x,y, hw,hh, mal)` — a small motif (glow, gradient
  dot), baked once at max brightness and recolored per-use via `globalAlpha`,
  placed at the exact **fractional** position (no pixel-snap — correct for
  soft/no-edge shapes).
- `Blech.zweiteilig(key, sig, x,y,w,h, mal)` runs `mal()` **twice**: once with
  `Blech.teil = RUHIG` (the draw function should skip anything that moves and
  bake only the static base) and once with `Blech.teil = BEWEGT` (skip the
  static parts, draw only what moves, live, every frame, on top of the baked
  base). Every scenery function in `backdrop.js` is written with `if
  (Blech.ruhig()) { …static… }` / `if (!Blech.bewegt()) return; …live…` guards
  for exactly this reason. **Only valid if the moving parts are the topmost
  layer** — Arktis's aurora sits *behind* the baked iceberg/snowfield, so it
  is special-cased by hand (drawn live first, then the rest is baked
  normally, not via `zweiteilig`).

### Determinism via `prnd(i, salt)` (backdrop.js:7)
```js
function prnd(i, salt = 0) {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}
```
A classic GLSL-style hash (same constants as the shader's `hash()`), used for
*every* pseudo-random scenery placement (rocks, corals, grass, plankton,
icebergs, snowfield notches, etc.) so the same `(i, salt)` always yields the
same value — the entire baking system depends on this: without deterministic
placement, "unchanged" scenery would still shift a pixel between bakes.

### 64 light steps (`kulissenStufe`/`kulissenLicht`, backdrop.js:374-381)
```js
const KULISSE_STUFEN = 64;
function kulissenStufe() { return round(clamp(getPalette(dayTime).light,0,1) * 64); }
function kulissenLicht(min) { return clamp(kulissenStufe()/64, min??0, 1); }
```
Continuous daylight would invalidate a bake every single frame. Quantizing to
64 steps means one step = 1.5/64 ≈ 1.6% brightness change — below the
just-noticeable threshold — while cutting re-bakes from 60/s to roughly one
every ~2 seconds during dawn/dusk. **Critically, both the bake's signature
*and* its actual pixel content must use the quantized value** (`kulissenLicht
()`, never raw `getPalette().light`), or the baked background and the live
foreground drift to different brightness at the seam.

### Subpixel positioning (`_backe`, blech.js:353; the "halbe Pixel" note)
A bake is copied at whole device pixels (no resampling), but a motif's true
on-screen position is usually fractional. The fractional remainder `(fx,fy)`
is **baked into the pixel content itself** (the bake's internal transform is
offset by it) and **included in the signature** (rounded to ¼px). Consequence
— stated explicitly as "Merksatz 12" in the source: **anything that moves
continuously (not in discrete steps) must never be baked**, because its
subpixel remainder is a new signature every frame, turning the cache into a
guaranteed miss that still pays the write+read cost (the single most
expensive operation class in the whole project — a canvas written and read
within the same frame).

### Budget & book-keeping (the "two safeguards" of the 01.09 rewrite)
- `BUDGET_BILD = 1` big bake + `BUDGET_STEMPEL = 4` small bakes **per frame**,
  reset every frame (`_neuesBild`, keyed off the global `lastFrame` stamp).
  Anything that would exceed budget draws **directly instead** (same cost as
  no cache) and retries next frame — so a signature bug degrades to "no
  caching" rather than "every motif rebakes every frame" (measured 126ms
  frames from an earlier, unbudgeted version).
- `jeBild(reset)` reports re-bakes-per-frame since last read; the project's
  own perf harness treats `>0.01` as "lazy motif" and `≥1` as "anti-cache" and
  fails a motif out of the baked set at that point.
- LRU eviction by `MAX_BYTES = 32MB`, insertion-order `Map` re-inserted on
  hit.
- Size caps: `MAX_KANTE=4096`px edge, `MAX_PIXEL=6M`px per big bake,
  `MAX_STEMPEL=512`px edge per small stamp.
- On bake, the canvas gets a monotonically incrementing `__gpuVer` counter —
  this is the hook `gpu.js`'s texture cache uses to know a "same canvas
  object" now holds different pixels and must re-upload.

### Never-bake list (explicit in source comments)
- The **boat** hull (continuously bobs on `getWave`, continuously heels) —
  attempted once, caused ~479/706 frames to re-bake (3 motifs × angler ×
  rod simultaneously = "3.4 canvases written+read per frame", the exact
  failure class §above describes). Always drawn live.
- The **angler**, live whenever in a boat (same sub-pixel-drift reason); baked
  only at rest on fixed platforms (dock/pier/ice).
- The **rod body**, live whenever: bending (`rodBend>0.002`), reeling fast,
  boat mode, or using a `rainbow`/`glow`/`gamma` skin (continuous color/blur
  animation) — otherwise baked, with the **crank always drawn live on top**
  (it spins even at idle, `time*0.4`).
- **Text** (i18n-translated at draw time), any **hit-test/press-feedback
  region**, and anything whose look changes every single frame — explicitly
  excluded by the file's own header comment.
- Clouds, birds, jellyfish — reverted back to a **fully-live** draw after an
  earlier attempt at stamping them (too many too-small/too-cheap shapes to be
  worth a bake+lookup).

**Rebuild guidance**: a GPU sprite renderer doesn't need this system at all —
it should render deterministic scenery as pre-baked sprite sheets / static
meshes at *build time* (or once at load) instead of re-deriving `prnd()`
placement every session, and animate only the elements this file's
never-bake list identifies as genuinely continuous (boat, angler-in-boat, rod
crank, bending rod, glow/rainbow materials, aurora, weather).

---

## 7. Layout

- **Canvas**: `canvasEl` (real, DPR-scaled) vs `canvas = {width,height}`
  (logical CSS-pixel size all draw code uses). `ctx.setTransform(dpr,0,0,dpr,
  0,0)` bridges them.
- **DPR** (`resizeCanvas`, script.js:67): `dpr = World.uiDpr()` if the Phaser
  layer exists, else `min(devicePixelRatio, innerWidth<700 ? 3 : 2)`.
  `World.uiDpr()` (world.js:442): `min(devicePixelRatio, innerWidth<700 ?
  stufe.uiDpr : 2)`, where `stufe.uiDpr` is 2 or 3 per `WORLD_TIERS` (§ below)
  — **phones cap UI sharpness at 2x on the lowest tier, 3x otherwise; desktop
  always caps at 2x.** The `<canvas>` backing store is only reallocated
  (`canvasEl.width=`) when the pixel size actually changed, to avoid churn
  from iOS toolbar show/hide.
- **World-layer resolution** is decoupled from UI resolution
  (`World.weltDpr()`, defaults to `uiDpr()` i.e. full sharpness; historically
  capped lower for upload-cost reasons, but the GPU-objects path removed that
  cost — see world.js comments around `WELT_DECKEL_TELEFON`). A rebuild on a
  native GPU renderer has no equivalent upload cost and should simply render
  everything at the display's native resolution.
- **`WORLD_TIERS`** (world.js:81, performance/quality ladder, not pixel-art
  intent): `0 "Canvas 2D"` (skala 0, no shader), `1 "sparsam"` (skala 0.5,
  no bloom, 1 caustic octave), `2 "mittel"` (skala 0.7, 1 bloom ring, 2
  octaves), `3 "voll"` (skala 1.0, 2 bloom rings, 2 octaves) — `uiDpr` is 2/3
  /3/3 respectively. Default tier is 3 (full) on all devices as of the file's
  latest revision.
- **Water line fraction** (`resizeCanvas`, script.js:99): `horizonY =
  canvas.height * (mode==="dive" ? 0.05 : 0.35)`. Tiefsee pushes the
  "horizon" almost to the top edge (no sky, the whole frame is water); every
  other location keeps it at 35% down from the top.
- **Per-mode platform geometry** (script.js:100-125), all relative to
  `canvas.width/height` and `dockHeight = max(14, canvas.height*0.03)`:
  - `boat`: `dockWidth=max(120,W*0.22)`, boat anchored at `x=W*0.72`, rod base
    `= boatX - dockWidth*0.22`.
  - `ice`: `dockWidth=W*0.42`, right-aligned (`dockX=W-dockWidth`), rod base
    `= dockX+dockWidth*0.2`.
  - `dive`: `dockWidth=W*0.22`, `dockX=W*0.60`, `dockY = horizonY +
    (H-horizonY)*0.16` (diver floats in the upper third of the water column,
    no dock), rod base = `dockX`.
  - `dock`/`pier` (default): `dockWidth=W*0.3`, right-aligned, `dockY =
    horizonY - dockHeight - H*0.025`.
  - `rodBaseY = dockY`; `rodTipX = rodBaseX - W*0.15`, `rodTipY = rodBaseY -
    H*0.12` (harpoon mode instead: `rodTipX = rodBaseX - W*0.13`, `rodTipY =
    rodBaseY + H*0.005` — held level, not angled up).
- **Safe areas**: `safeTop`/`safeBottom` read from CSS custom properties
  `--sat`/`--sab` (device notch/home-indicator insets); `safeBottom` also adds
  `Ads.bannerReserve()` (reserves space for a native ad banner without the
  game drawing it itself). `bottomBarY() = canvas.height - safeBottom - 12 -
  44` (draw.js:1465) — the top edge of the bottom UI bar, used by mobile
  scenery (`seaFloorY`, coral/anemone base, weed base) to keep the seabed
  visible above the button bar.
- **Portrait/mobile assumptions**: `isNarrow() = canvas.width < 700`
  (script.js:148) is the single mobile/desktop layout switch used throughout
  — mobile gets full-size UI scale (`uiScale()=1.0`) and reflowed single-
  column menus; desktop scales UI by `clamp(min(W/1100,H/650),0.85,1.3)`. The
  whole scene system assumes a **portrait-oriented, roughly phone-sized**
  viewport is the primary target (dock/platform anchored to the right edge,
  cast button centered near the bottom `min(H*0.85, H-castH-40-safeBottom)`);
  desktop is a wider variant of the same layout, not a distinct one.
- **`istTelefon()`** (world.js:107): phone = `min(innerWidth,innerHeight)<700
  && (has touch points || pointer:coarse media query)` — used only to pick
  initial performance tier/DPR ceiling, not layout.

---

## 8. Colors (consolidated reference)

### Locations — see §1 table (water top/bottom hex, `dark` factor).

### Sky/water day-night keyframes — see §2 `SKY_KEYS` table.

### Angler outfits (`OUTFITS`, shop.js:76) — fields `body, pants, skin,
stripe?, pattern?, fur?`:

| id | body | pants | skin | extra |
|---|---|---|---|---|
| klassisch | `#2b2f3a` | `#2b2f3a` | `#e9c3a0` | – |
| regen | `#f4c542` | `#2b3a55` | `#e9c3a0` | – |
| hawaii | `#ff6b6b` | `#f0e6c8` | `#d9a878` | pattern `flowers` |
| taucher | `#1b1b1f` | `#1b1b1f` | `#e9c3a0` | stripe `#39ff14` |
| pirat | `#8a1c2b` | `#2b2f3a` | `#e9c3a0` | stripe `#ffd700` |
| eskimo | `#dfefff` | `#4a5a6a` | `#e9c3a0` | fur:true |
| kapitaen | `#1d3557` | `#f2f2f2` | `#e9c3a0` | stripe `#ffd700` |
| gold (gem) | `#e0b000` | `#c99a00` | `#e9c3a0` | stripe `#fff2a8` |

### Hats — see `HATS` id list in §4; per-id colors are inline in
`drawHat` (draw.js:813-931), summarized: cap `#c0392b`, straw `#e6c96b`
w/ red band `#b5462c`, muetze `#d62828` w/ white trim, kapitaen `#f4f6f8`
hull + `#1d3557` band + `#ffd700` emblem, pirat `#26262c` w/ gold trim
`rgba(212,175,55,.55)`, zylinder gradient `#2e2e33/#454550/#1c1c20/#101014`
w/ `#8a1c2b` band, kranz leaves `#4f8a3a`/dots `#7fb35a,#3f6f2a`,
blumenkranz leaves `#2fa35a`/dots `#ff6b9d,#ffd23a,#ff8c42,#ffffff`,
nessiemuetze `#2d6b4f`, moewenhut `#e6c96b` + white/orange gull, leuchthelm
`#3a3f55` + glow `#9fffe0`, eiskrone `#bfe9ff`, perlenkrone `#e8d8c0` +
pearls `#fff8e7`, krone `#ffd700` + gems `#e63946`/`#4aa3ff`, default angler
hut `#3f7a4a`.

### Rod skins (`RODSKINS`, shop.js:29) — `color`/`accent` (+`fx`, `glow`,
`rainbow`):
holz `#4a3018`/`#7a5a38` · bambus `#c2b280`/`#7a6a3a` · carbon `#1b1b1f`/
`#e63946` · neon `#39ff14`/`#111111` · eis `#bfe9ff`/`#ffffff` · candy
`#ff4f7b`/`#ffffff` · lava `#ff4500`/`#ffd23a` · gold `#e0b000`/`#fff2a8` ·
galaxie `#2a1b5e`/`#c77dff` (glow) · rainbow (accent `#ffffff`, HSL cycle) ·
kristall (gem) `#bfe9ff`/`#7fd8ff` (glow) · tigertooth `#f39c12`/`#1a1a1a`
(fx tiger) · crimsonweb (gem) `#8a1c2b`/`#1a0a0e` (fx web) · gammadoppler
(gem) `#2ee6a6`/`#0b6b3a` (fx gamma, glow) · fade `#ff5c8a`/`#ffd23a` (fx
fade) · casehardened `#2a6fd6`/`#c9a227` (fx case) · marblefade (gem)
`#ff3b30`/`#ffd23a` (fx marble) · slaughter `#c0392b`/`#f5b7b1` (fx
slaughter).

### Harpoon skins (`HARPOONS`, shop.js:65) — `shaft`/`accent`/`glow?`:
standard `#8a929b`/`#e6edf5` · stahl `#5f6b78`/`#cfd8e2` · knochen `#e6dcc4`/
`#b8a888` · obsidian `#1a1a22`/`#6a5acd` · biolum `#0f3b3a`/`#37e0d8` (glow
`#37e0d8`) · abyss `#101a2e`/`#7b6bff` (glow `#7b6bff`) · goldharp (gem)
`#c9a227`/`#fff2a8` (glow `#ffd66b`) · harptiger `#f39c12`/`#1a1a1a` (fx
tiger) · harpdoppler (gem) `#2ee6a6`/`#0b6b3a` (fx gamma, glow `#2ee6a6`) ·
harpfade `#ff5c8a`/`#ffd23a` (fx fade).

### Bobbers (`BOBBERS`, shop.js:22): classic `main #e63946`/`top #ffffff` ·
neon `main #39ff14`/`top #111111` · herz (heart shape, pink `#ff3b7a`) ·
erdbeere (strawberry, `#e8334a` body/`#3fa34d` leaves/`#ffe8a0` seeds) · gold
`main #ffd700`/`top #fff4c2` · fussball (soccer, white/`#111` pentagons) ·
ente (rubber duck, `#ffd42a` body/`#ff8c1a` bill) · schaedel (skull, `#f2f2f2`
w/ `#111` sockets) · rainbow (HSL cycle) · disco (mirror ball, `#b8c4d0` base)
· diamant (gem) `main #7fd8ff`/`top #ffffff`.

### Neutral/system colors used throughout: line `rgba(255,255,255,0.85)`;
hook `#cfd6dd`; shadow/contact `rgba(0,0,0,α)`; UI accents live in a separate
UI/HUD spec, not repeated here.

---

## 9. Globals / functions this system depends on

Cross-file globals the world-visuals code reads or writes every frame
(non-exhaustive of gameplay state, exhaustive of what §1-4 touch):

- **Canvas/layout**: `canvas {width,height}`, `canvasEl`, `ctx` (mutable —
  swapped between the UI context and `World.canvas`'s 2D context during the
  "world block", per `world.js`/`gpu.js` — draw functions never know which),
  `horizonY`, `dockWidth/Height/X/Y`, `rodBaseX/Y`, `rodTipX/Y`,
  `curRodTipX/Y`, `boatX/Y`, `safeTop/Bottom`.
- **Clocks**: `time` (world clock, pauses in menus), `uiTime` (always runs),
  `dayTime` (0..1, `DAY_LENGTH=300`s/cycle), `lastFrame` (frame stamp used by
  `Blech`'s per-frame budget reset).
- **Location/state**: `getLocation()`, `save.location`, `save.owned.locations`,
  `getPalette(dayTime)`, `WATER_PROFILES`, `gameState` (`ready|casting|
  waiting|biting|reeling|caught|retrieving|shooting|bossfight…` — drives
  angler mood, bobber dip, hook/line curve, rod bend source).
- **Celestials**: `sunX/Y/Radius/Visible`, `moonX/Y/Visible`,
  `updateCelestials()`.
- **Camera/effects**: `camX`, `updateCamera(dt)`, `withParallax(k,fn)`,
  `hypeZoom()`, `shake` (screen-shake magnitude).
- **Rig/fishing state**: `bobberX/Y`, `hookX/Y`, `hookInWater`, `rodBend`,
  `lineBow`, `hookedFish`, `bitingFish`, `nibble`, `mouseX/Y`, `isHolding`.
- **Weather**: `weather {type,timer,drops,gloom}`, `weatherGloom()`,
  `updateWeather(dt)`, `isGoldenHour()`.
- **Decor entities**: `clouds[]`, `birds[]`, `snow[]`, `bubbles[]`,
  `diveBubbles[]`, `particles[]`, `ripples[]`, `floatingTexts[]`.
- **Equipment getters** (`shop.js`): `getRod/getBait/getBobber/getRodSkin/
  getHat/getOutfit/getHarpoonSkin`, all reading `save.equipped.*`.
- **Shared math/helpers**: `rand, lerp, clamp, easeOut, easeInOut` (effects.js);
  `hexToRgb, lerpColor, shadeColor, daylight()` (draw.js/fish.js);
  `uiScale(), isNarrow(), bottomBarY()`.
- **Caching/renderer bridges**: `Blech` (blech.js), `Gpu`/`GpuCtx`/
  `GpuGradient` (gpu.js), `World` (world.js, owns the offscreen scene canvas,
  shader uniforms, performance tier).
- **Fish interop** (read by water/shadow/shader logic, not owned by this
  spec): `fishes[]`, `fishUnit(f)`, `isGlowing(sp)` — the shader's turbidity/
  refraction/bloom apply to fish because they're baked into the same texture
  the shader filters (Canvas2D path) or share the same GPU scene graph
  (GPU-objects path).

---

## 10. Pure logic vs renderer-bound; bake-once vs animate-live

### Pure logic (renderer-agnostic — port as plain functions/data)
- `getWave(x,phase)`, `getPalette(dayTime,raw)`, `SKY_KEYS`, `LOCATIONS`,
  `WATER_PROFILES`, `celestialPos(p)`/`updateCelestials()`, `shadeColor()`,
  `prnd(i,salt)`, day/night `dayTime` advance, weather state machine
  (`updateWeather`), `resizeCanvas`'s geometry math (dock/rod/horizon
  positions as functions of `canvas.width/height`), rod-bend/line-sag math
  (`curRodTip*`, `lineBow`, quadratic bezier sag curve), harpoon flight/hit
  physics, hype-zoom easing curve, parallax offset math (`withParallax`'s
  `versatz` formula, `PARA_*` constants).
- All of §1's per-location numeric layout (positions/sizes as fractions of
  W/H/dockHeight) is pure data+math and should be ported directly regardless
  of renderer.

### Renderer-bound (Canvas-2D-specific, must be reauthored for a GPU sprite renderer)
- Every `draw*` function's literal sequence of `ctx.beginPath/moveTo/
  quadraticCurveTo/fill` calls — these are **vector paths procedurally
  rebuilt every call**, which is exactly what `gpu.js` had to intercept and
  what a sprite renderer replaces with actual sprites/meshes/particles.
- `gpu.js`'s whole Canvas-2D-emulation shim (§5) — skip entirely; author
  scenery as native engine primitives instead.
- `blech.js`'s whole bake/cache system (§6) — skip entirely; pre-author
  static scenery as sprite sheets/atlases at build time or bake once at load,
  using the *never-bake list* (§6) as the authoritative "this must stay a
  live-animated object" list.
- The `world-frag.js` GLSL shader — port as a post-process material/shader on
  the new engine (the uniform contract in §3 is the porting checklist), or
  reimplement per-effect as engine-native systems (refraction as a distortion
  post-effect, caustics as a scrolling normal/light texture, bloom as engine
  bloom, etc.) if a literal custom-shader port isn't desired.
- The `drawSurfaceMirror` 8-slice canvas-blit reflection (visuals.js) is a
  Canvas-2D workaround for lacking a real reflection texture — a GPU renderer
  should do an actual mirrored-camera or planar-reflection instead.

### Bake once (build-time or load-time, static)
Per §6's rules: far-scenery silhouettes (mountains, cliffs, islands, canyon
walls, iceberg/snowfield base), seabed shape + rocks (cheap, but could be
static meshes), coral/anemone/plankton base shapes (motion is a shader/vertex
wobble, not a redraw), the moon disc+halo, the angler and rod bodies **at
rest on a fixed platform**.

### Must animate live (per-frame, every render)
Boat hull (continuous bob+heel), angler **whenever in the boat** or otherwise
moving, rod **whenever bending, boat, or wearing a continuous-FX skin**, the
rod-reel crank (always), grass/reeds/kelp/anemone-tentacle sway, surf spray,
sailboats, aurora, weather (rain/snow/lightning-flash), sun/moon position and
color-temperature-by-altitude, all glow/pulse effects (corals, jellyfish,
glow fish, leuchthelm, glow rod/harpoon skins), water surface itself (wave
line, shader distortion/caustics/glitter/foam — driven by `time` every
frame), diver fins/kick/breathing bubbles/headlamp flicker, harpoon flight,
hook/line/bobber (game-state-driven motion), hype-zoom/screen-shake, all
particle systems (splashes, ripples, confetti, coins, floating text).
