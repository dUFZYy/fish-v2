# 02 — Fish: Species, Rendering, AI, Shiny, Sprite Cache, Depth Fog, Dex

Source project (read-only, nothing modified): `C:\Users\duf73\Desktop\claude projekte\fishing-game`
Files read in full: `fish.js` (854 lines), `creatures.js` (808 lines), `sprites.js` (713 lines), `trivia.js` (118 lines),
`trivia_en.js` (130 lines), `locations.js` (species-pool part, lines 1–161 of 591), `visuals.js` (178 lines, full).
Cross-referenced with targeted greps: `script.js`, `shop.js`, `progress.js`, `draw.js`, `dive.js`, `aquarium.js`, `i18n.js`,
`gems.js`, `talents.js`, `world.js`, `events.js`, `cutscene.js`, `effects.js`.

This document targets a rebuild with a **GPU sprite renderer** where fish are baked into texture atlases ahead of
time (offline or at load), instead of the old game's runtime canvas-cache (`sprites.js`). Section 5 explains exactly
why that old cache existed, what it cost, and what a texture-atlas approach should keep/drop from its lessons.

---

## 1. Complete species table (111 species)

The old game has **111** species total (not ~105): 26 defined inline in `fish.js` (`SPECIES` array, includes 3
bycatch/junk items), 85 more appended in `locations.js` via a compact-row loader function `S()` (79 real species +
6 bosses, one of which — Nessie — is inside the `S("boot", …)` block, so "6 bosses" + "84 non-boss" = 85). All are
merged into one flat runtime array `SPECIES`; there is no separate boss/junk array.

Counts (computed from the live data, not eyeballed):

- By rarity: common 29, uncommon 27, rare 25, epic 17, legendary 13
- By flag: `boss: true` → 6, `junk: true` (bycatch) → 8, `night: true` → 7, `glow: true` (explicit flag, on top of
  the `glow`/`moon`/`lure` patterns which also count as glowing) → 5
- By location membership (a species can be in more than one `loc[]`, e.g. `schatzkiste` is in all six):
  see 27, boot 37, kueste 21, riff 19, tiefsee 18, arktis 16
- By pattern / body-type (`sp.pattern`, see §2 for what each does): none 15, spots 13, dashes 9, stripes 6, scales 7,
  glow 6, shark 6, teeth 5, whiskers 4, puffer 4, lure 4, crab 4, octopus 3, squid 3, jelly 2, ray 2, flat 2,
  serpent 2, boot 2, moon 1, koi 1, bottle 1, chest 1, weed 1, star 1, seahorse 1, shell 1, turtle 1, blob 1,
  frozen 1, penguin 1

### 1.1 Merged table (all 111 rows)

`depth band` is `sp.depth = [d0, d1]`, 0 = surface, 1 = bottom (see `depthToY()` in §3). `len/h` are the two body
proportion multipliers (`sp.len`, `sp.h`) used everywhere a fish is drawn — see §2. `weight kg` = `sp.kg` range used
to roll the actual catch weight. `speed` is a multiplier on base swim speed. `fight` is the minigame difficulty
(bigger = harder reel). `value` is the base coin payout (`sp.value`, scaled elsewhere by `COIN_SCALE`, rarity,
perfect-catch, shiny ×5, talents). `color/belly/fin` are hex (or `rgba()` for the two jellyfish) and feed every
gradient in §2. `pattern` doubles as the **body-type key**: values matching a key in `CREATURE_DRAW` (creatures.js)
use a completely different draw function (§2.2); `boot`/`bottle`/`chest` short-circuit to unique junk-item drawers;
everything else uses the generic fish body (§2.1) with that pattern as a surface-decoration switch.

| id | Name DE | Name EN | rarity | location(s) | depth band | len/h | weight kg | speed | fight | value | color | belly | fin | pattern/body-type | flags | trivia DE | trivia EN |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rotauge | Rotauge | Roach | common | see, boot | 0.05–0.50 | 0.80 / 0.90 | 0.2–1.2 kg | 1.1 | 0.9 | 8 | #9fb3c8 | #e8eef4 | #d9534f | none | - | Heißt so wegen der roten Augen. Kreativ waren die Namensgeber nicht. | Named for its red eyes. The naming committee was not feeling creative. |
| karpfen | Karpfen | Carp | common | see, boot | 0.30–0.90 | 1.15 / 1.15 | 1–9 kg | 0.7 | 1.1 | 12 | #7a8f3a | #d8d29a | #5f6f2a | scales | - | Kann über 40 Jahre alt werden – und sieht jeden Tag gleich beleidigt aus. | Can live over 40 years – and looks equally offended every single day. |
| barsch | Barsch | Perch | common | see, boot | 0.10–0.70 | 0.90 / 1.10 | 0.3–2.5 kg | 1.2 | 1.3 | 15 | #4f7942 | #d9e0a8 | #e07b39 | stripes | - | Die Streifen sind Tarnung. Funktioniert offensichtlich nicht. | The stripes are camouflage. Clearly not working. |
| forelle | Forelle | Trout | uncommon | see, boot | 0.05–0.50 | 1.00 / 0.85 | 0.5–4 kg | 1.4 | 1.6 | 30 | #6f9ea3 | #f3d6c8 | #5a7f83 | spots | - | Steht gern gegen die Strömung. Der Rebell unter den Fischen. | Likes facing the current. The rebel of the fish world. |
| hecht | Hecht | Pike | uncommon | see, boot | 0.20–0.80 | 1.60 / 0.60 | 2–15 kg | 1 | 2 | 60 | #5c7a3a | #c9d39a | #8a6a2a | dashes | - | Hat rund 700 Zähne. Zahnarztbesuch: nie. | About 700 teeth. Dentist visits: zero. |
| zander | Zander | Zander | rare | see, boot | 0.40–0.95 | 1.35 / 0.70 | 1–10 kg | 1.1 | 2.2 | 95 | #8b8f6c | #e0e2cc | #4e5140 | stripes | - | Sieht im Dunkeln besser als du am Morgen. | Sees better in the dark than you do in the morning. |
| goldfisch | Goldfisch | Goldfish | rare | see | 0.02–0.35 | 0.60 / 1.00 | 0.1–0.6 kg | 1.9 | 1.9 | 200 | #ffab1f | #ffe08a | #ff7a1f | glow | - | Das mit dem 3-Sekunden-Gedächtnis ist ein Mythos. Er erinnert sich an deinen Köder. | The 3-second memory is a myth. It remembers your bait. |
| wels | Wels | Catfish | epic | see, boot | 0.70–1.00 | 2.30 / 0.90 | 12–65 kg | 0.55 | 2.9 | 380 | #4a4a55 | #a8a8b4 | #33333d | whiskers | - | Kann bis zu 2,5 Meter lang werden. Die Badesaison ist hiermit beendet. | Grows up to 2.5 metres. Swimming season is hereby over. |
| aal | Aal | Eel | uncommon | see, boot | 0.50–1.00 | 1.90 / 0.38 | 0.5–3.5 kg | 1.3 | 2.1 | 70 | #3c4a3c | #b9c2a5 | #2c382c | none | night-only | Wandert zum Laichen bis in die Sargassosee – 6000 km, ohne Navi. | Migrates 6000 km to the Sargasso Sea to spawn – without sat-nav. |
| mondfisch | Mondfisch | Moonfish | legendary | see, boot | 0.10–0.60 | 1.10 / 1.35 | 1–6 kg | 1 | 3.4 | 1200 | #cfd8ff | #ffffff | #9fb0ff | moon | night-only | Existiert offiziell nicht. Sag’s niemandem. | Officially doesn't exist. Don't tell anyone. |
| brasse | Brasse | Bream | common | see, boot | 0.40–0.90 | 1.05 / 1.30 | 0.5–5 kg | 0.7 | 1 | 10 | #a3a99a | #e6e6dc | #6f7566 | scales | - | Wird auch Blei genannt, weil sie so schwer ist. Und so grau. | Also called 'lead' in German, because it's that heavy. And that grey. |
| schleie | Schleie | Tench | common | see, boot | 0.60–1.00 | 1.00 / 1.05 | 0.5–4 kg | 0.6 | 1.1 | 11 | #5d6b2f | #c8c76a | #3f4a1f | none | - | Ihre Schleimschicht soll heilend wirken. Kein Grund, sie zu lecken. | Its slime is said to heal. Still no reason to lick it. |
| doebel | Döbel | Chub | common | see, boot | 0.05–0.50 | 0.95 / 0.95 | 0.3–3 kg | 1.3 | 1.2 | 9 | #8fa0b3 | #e9eef3 | #c0392b | scales | - | Frisst alles: Kirschen, Käse, Brot. Der Allesfresser mit Lippen. | Eats everything: cherries, cheese, bread. The omnivore with lips. |
| regenbogenforelle | Regenbogenforelle | Rainbow trout | uncommon | see, boot | 0.05–0.50 | 1.05 / 0.85 | 0.5–5 kg | 1.5 | 1.7 | 45 | #7aa6c2 | #f6c1d0 | #557a92 | spots | - | Kam aus Nordamerika. Hat sich gut eingelebt. | Came over from North America. Settled in nicely. |
| saibling | Saibling | Char | uncommon | see, boot | 0.30–0.80 | 1.00 / 0.80 | 0.5–4 kg | 1.4 | 1.6 | 50 | #4f6d7a | #ffb27a | #35505c | spots | - | Liebt eiskaltes Wasser. Ein Fisch, der Winter mag – unverständlich. | Loves ice-cold water. A fish that likes winter – incomprehensible. |
| kugelfisch | Kugelfisch | Pufferfish | uncommon | see, boot | 0.20–0.70 | 0.70 / 1.30 | 0.3–1.5 kg | 0.5 | 1.3 | 55 | #d9c46b | #fff3c4 | #a58f3a | puffer | - | Pumpt sich bei Gefahr auf. Wie du nach dem Buffet. | Inflates when threatened. Like you after the buffet. |
| piranha | Piranha | Piranha | rare | see, boot | 0.20–0.70 | 0.80 / 1.15 | 0.5–3 kg | 1.7 | 2 | 110 | #7d8a5a | #e0655a | #55603a | teeth | - | Ihr Ruf ist schlimmer als ihr Biss. Aber nicht viel. | Its reputation is worse than its bite. But not by much. |
| lachs | Lachs | Salmon | rare | see, boot | 0.10–0.60 | 1.40 / 0.80 | 3–18 kg | 1.6 | 2.4 | 120 | #8fa5b8 | #f0b8a0 | #5c7386 | dashes | - | Springt Wasserfälle hoch, um nach Hause zu kommen. Und du beschwerst dich über Treppen. | Leaps up waterfalls to get home. And you complain about stairs. |
| neonfisch | Neonfisch | Neon tetra | rare | see | 0.10–0.50 | 0.50 / 0.80 | 0.05–0.2 kg | 2.2 | 1.9 | 150 | #2ee6ff | #ff3d8a | #1aa3b8 | glow | night-only | Leuchtet, damit sein Schwarm ihn im Dunkeln findet. Praktisch beim Ausgehen. | Glows so its school can find it in the dark. Handy on a night out. |
| koi | Koi | Koi | epic | see | 0.05–0.40 | 1.10 / 1.00 | 1–8 kg | 0.8 | 1.8 | 400 | #f4f1ec | #ffffff | #e0552b | koi | - | Ein Koi kostete mal 1,8 Millionen Dollar. Deiner war günstiger. | One koi once sold for 1.8 million dollars. Yours was cheaper. |
| anglerfisch | Anglerfisch | Anglerfish | epic | see, boot | 0.80–1.00 | 1.00 / 1.20 | 2–12 kg | 0.5 | 2.6 | 450 | #3b3f5c | #6b6f8c | #2a2d45 | lure | night-only | Angelt selbst – mit einer Leuchtangel am Kopf. Konkurrenz. | Fishes too – with a glowing rod on its head. Competition. |
| stoer | Stör | Sturgeon | epic | see, boot | 0.80–1.00 | 2.60 / 0.60 | 15–120 kg | 0.6 | 3.2 | 500 | #6d7b7a | #c9d1cf | #4a5554 | dashes | - | Lebt seit 200 Millionen Jahren fast unverändert. Kein Update nötig. | Almost unchanged for 200 million years. No update required. |
| hai | Hai | Shark | legendary | boot, kueste | 0.20–0.70 | 2.80 / 0.90 | 40–300 kg | 1.4 | 3.8 | 1500 | #6f8296 | #e6edf3 | #4d5d6d | shark | - | Was der in einem See macht, fragt sich der Hai auch. | What it's doing in a lake, the shark wonders too. |
| stiefel | Alter Stiefel | Old boot | common | see | 0.85–1.00 | 0.90 / 1.00 | 0.8–1.5 kg | 0.25 | 0.5 | 1 | #6b4a2b | #6b4a2b | #4a3018 | boot | bycatch | Größe 44, linker Fuß. Der rechte ist noch da unten. | Size 44, left foot. The right one is still down there. |
| flaschenpost | Flaschenpost | Message in a bottle | uncommon | see | 0.00–0.15 | 0.80 / 1.00 | 0.3–0.5 kg | 0.3 | 0.4 | 5 | #7fc8a9 | #7fc8a9 | #5a8f78 | bottle | bycatch | Papier, Korken, Hoffnung. Antwort nicht garantiert. | Paper, cork, hope. Reply not guaranteed. |
| schatzkiste | Schatzkiste | Treasure chest | epic | see, boot, kueste, riff, tiefsee, arktis | 0.90–1.00 | 0.90 / 1.00 | 4–12 kg | 0.15 | 1.2 | 250 | #8a5a2b | #8a5a2b | #d4a017 | chest | bycatch | Niemand weiß, wer sie verloren hat. Alle wissen, wer sie behält. | Nobody knows who lost it. Everybody knows who's keeping it. |
| ukelei | Ukelei | Bleak | common | boot | 0.02–0.30 | 0.70 / 0.70 | 0.05–0.2 kg | 1.4 | 0.8 | 6 | #b9c4cf | #eef2f5 | #8a97a3 | none | - | Aus seinen Schuppen wurden mal Perlmutt-Imitate gemacht. Glamour für Arme. | Its scales were once used for fake pearls. Glamour on a budget. |
| kaulbarsch | Kaulbarsch | Ruffe | common | boot | 0.50–1.00 | 0.70 / 1.00 | 0.1–0.4 kg | 1.1 | 0.9 | 7 | #8c8a5a | #d8d3a0 | #5f5d3a | stripes | - | Klein, stachelig, überall. Der Kaktus unter den Fischen. | Small, spiny, everywhere. The cactus of fish. |
| renke | Renke | Whitefish | common | boot | 0.30–0.80 | 1.00 / 0.80 | 0.5–3 kg | 1.2 | 1.2 | 14 | #9fb6c6 | #f0f4f7 | #6f8695 | none | - | Schmeckt hervorragend geräuchert. Sagt man. Frag den Fisch nicht. | Delicious smoked. So they say. Don't ask the fish. |
| zwergwels | Zwergwels | Bullhead | common | boot | 0.70–1.00 | 0.85 / 1.00 | 0.3–1.5 kg | 0.7 | 1.1 | 12 | #4b4a3f | #a89f80 | #33322a | whiskers | - | Klein, aber mit Barteln. Der Hipster unter den Welsen. | Small, but with whiskers. The hipster of catfish. |
| steinbeisser | Steinbeißer | Spined loach | common | boot | 0.85–1.00 | 1.30 / 0.35 | 0.05–0.2 kg | 0.9 | 0.8 | 9 | #a68b5b | #e6d7b3 | #7a6440 | dashes | - | Beißt keine Steine. Der Name ist eine Frechheit. | German name means 'stone biter'. It bites no stones. Outrageous. |
| graskarpfen | Graskarpfen | Grass carp | uncommon | boot | 0.20–0.70 | 1.40 / 0.90 | 3–25 kg | 0.7 | 1.6 | 40 | #6e8f4e | #d3dcb0 | #4c6633 | scales | - | Frisst bis zum eigenen Körpergewicht an Pflanzen pro Tag. Vegan und stolz. | Eats its own body weight in plants daily. Vegan and proud. |
| rapfen | Rapfen | Asp | uncommon | boot | 0.05–0.40 | 1.40 / 0.70 | 1–8 kg | 1.7 | 1.9 | 48 | #7d95a8 | #e3ebf0 | #c0392b | none | - | Der einzige Karpfenfisch, der andere Fische jagt. Schwarzes Schaf der Familie. | The only carp that hunts other fish. Black sheep of the family. |
| schwarzbarsch | Schwarzbarsch | Black bass | uncommon | boot | 0.20–0.70 | 1.00 / 1.05 | 0.5–4 kg | 1.3 | 1.8 | 45 | #3e5a3a | #b7c9a0 | #28402a | dashes | - | Der beliebteste Sportfisch der USA. Hat einen eigenen Fernsehsender. Fast. | America's favourite sport fish. Almost has its own TV channel. |
| sonnenbarsch | Sonnenbarsch | Sunfish | uncommon | boot | 0.10–0.50 | 0.70 / 1.20 | 0.1–0.6 kg | 1.2 | 1.3 | 35 | #c98a3a | #ffd97a | #3b6fb0 | spots | - | Bunt wie ein Sonnenuntergang, klein wie eine Handfläche. Süß, bis er beißt. | Colourful as a sunset, small as a palm. Cute until it bites. |
| seeforelle | Seeforelle | Lake trout | uncommon | boot | 0.20–0.70 | 1.30 / 0.80 | 1–12 kg | 1.5 | 2 | 55 | #5f7f8f | #e8d6c0 | #44606e | spots | - | Wird in tiefen Seen über einen Meter groß. Die Forelle mit Ambitionen. | Grows over a metre in deep lakes. The trout with ambitions. |
| quappe | Quappe | Burbot | rare | boot | 0.80–1.00 | 1.40 / 0.70 | 0.5–6 kg | 0.8 | 2 | 90 | #6b5a3e | #c2b28f | #4a3d2a | whiskers | night-only | Der einzige Dorsch im Süßwasser. Hat sich verlaufen und ist geblieben. | The only freshwater cod. Got lost and stayed. |
| marmorkarpfen | Marmorkarpfen | Bighead carp | rare | boot | 0.30–0.80 | 1.70 / 1.00 | 8–45 kg | 0.6 | 2.6 | 130 | #7c8a8f | #d0d8da | #56646a | scales | - | Ein Kopf so groß wie ein Drittel des Körpers. Denkt aber trotzdem nicht viel. | A head one third of its body. Still doesn't think much. |
| urhecht | Urhecht | Ancient pike | epic | boot | 0.30–0.80 | 2.40 / 0.60 | 12–30 kg | 1.1 | 3.2 | 600 | #3d5a2a | #a8b88a | #6b4f22 | dashes | - | Alter Hecht, alte Tricks. Kennt jeden Köder seit 1987. | Old pike, old tricks. Knows every lure since 1987. |
| riesenwels | Riesenwels | Giant catfish | epic | boot | 0.80–1.00 | 3.00 / 0.90 | 60–150 kg | 0.5 | 3.5 | 750 | #2f2f3a | #8a8a99 | #1f1f28 | whiskers | night-only | Über 100 Kilo Fisch. Braucht kein Fitnessstudio. | Over 100 kilos of fish. Doesn't need a gym. |
| nessie | Nessie | Nessie | legendary | boot | 0.30–0.70 | 2.20 / 1.20 | 500–2000 kg | 0.7 | 4 | 5000 | #2d6b4f | #7fb89a | #1f4a37 | serpent | BOSS | Angeblich ein Mythos. Du hast sie trotzdem gefangen. Glückwunsch, Wissenschaft. | Supposedly a myth. You caught her anyway. Congratulations, science. |
| seetang | Seetang | Seaweed | common | see, boot, kueste | 0.85–1.00 | 0.80 / 1.00 | 0.2–0.8 kg | 0.1 | 0.3 | 2 | #3f8a4f | #3f8a4f | #2c5e37 | weed | bycatch | Nährstoffreich, nachhaltig, nass. Trotzdem kein Fisch. | Nutritious, sustainable, wet. Still not a fish. |
| alterkarl | Der alte Karl | Old Karl | legendary | see | 0.50–0.95 | 3.00 / 1.20 | 40–90 kg | 0.5 | 4 | 3000 | #5a6b2a | #c9c27a | #3f4f1a | scales | BOSS | Der Karpfen, von dem alle am See reden. Kennt jeden Köder, jeden Angler, jede Ausrede. | The carp everyone at the lake talks about. Knows every bait, every angler, every excuse. |
| kraken | Der Kraken | The Kraken | legendary | kueste | 0.50–1.00 | 3.60 / 1.10 | 800–2500 kg | 0.5 | 4.2 | 8000 | #5a2a4a | #a86a90 | #3a1a30 | octopus | BOSS | Acht Arme, ein Plan: dein Boot. Seemannsgarn, bis er an deiner Schnur hängt. | Eight arms, one plan: your boat. A sailor's tale until it's on your line. |
| megalodon | Megalodon | Megalodon | legendary | riff | 0.20–0.70 | 4.20 / 0.90 | 3000–8000 kg | 1.2 | 4.5 | 12000 | #4a5a6a | #c8d4dc | #2e3a46 | shark | BOSS | Ausgestorben seit 3 Millionen Jahren. Offenbar nicht ganz. | Extinct for 3 million years. Apparently not entirely. |
| leviathan | Leviathan | Leviathan | legendary | tiefsee | 0.40–0.90 | 4.00 / 1.00 | 5000–20000 kg | 0.6 | 4.8 | 20000 | #0e1a2e | #3a5a8a | #7fd8ff | serpent | BOSS, glow-flag | Das Ding, vor dem die Tiefsee-Fische Angst haben. Leuchtet, damit du es kommen siehst. | The thing the deep-sea fish are afraid of. Glows so you see it coming. |
| eiskoenig | Der Eiskönig | The Ice King | legendary | arktis | 0.60–1.00 | 4.00 / 0.90 | 2000–6000 kg | 0.4 | 5 | 30000 | #dfefff | #ffffff | #9fd0ff | shark | BOSS, glow-flag | Ein Hai aus Eis, oder Eis in Haiform. Beides falsch. Beides gefangen. | A shark made of ice, or ice shaped like a shark. Both wrong. Both caught. |
| hering | Hering | Herring | common | kueste | 0.05–0.50 | 0.80 / 0.70 | 0.1–0.4 kg | 1.5 | 0.9 | 8 | #9fb3c8 | #f0f4f7 | #6f8397 | none | - | Kommuniziert mit Furzgeräuschen. Ernsthaft. Google es. | Communicates with fart noises. Seriously. Google it. |
| meeraesche | Meeräsche | Mullet | common | kueste | 0.05–0.40 | 1.00 / 0.80 | 0.5–3 kg | 1.2 | 1.1 | 10 | #8a9aa6 | #e6ecef | #5f6f7a | dashes | - | Springt ohne Grund aus dem Wasser. Einfach so. Aus Freude. | Leaps out of the water for no reason. Just because. Out of joy. |
| makrele | Makrele | Mackerel | common | kueste | 0.05–0.50 | 1.10 / 0.70 | 0.3–2 kg | 1.8 | 1.4 | 15 | #3d7f9f | #e8f2f6 | #2c5d75 | stripes | - | Muss ständig schwimmen, sonst erstickt sie. Kein Homeoffice möglich. | Has to swim constantly or it suffocates. No working from home. |
| scholle | Scholle | Plaice | common | kueste | 0.85–1.00 | 1.00 / 0.80 | 0.3–3 kg | 0.5 | 1 | 12 | #8b6f47 | #e8d9c0 | #6a5334 | flat | - | Beide Augen auf einer Seite. Die andere Seite hat aufgegeben. | Both eyes on one side. The other side gave up. |
| seestern | Seestern | Starfish | common | kueste | 0.92–1.00 | 0.70 / 0.70 | 0.1–0.5 kg | 0.05 | 0.3 | 5 | #e0733a | #e0733a | #b85a2a | star | bycatch | Kann Arme nachwachsen lassen. Kann aber nicht wegschwimmen. Prioritäten. | Can regrow arms. Can't swim away. Priorities. |
| qualle | Qualle | Jellyfish | uncommon | kueste | 0.10–0.60 | 0.80 / 1.00 | 0.5–3 kg | 0.3 | 0.7 | 20 | rgba(180,200,255,0.75) | #fff | rgba(180,200,255,0.6) | jelly | - | Kein Hirn, kein Herz, kein Problem. Lebt seit 500 Millionen Jahren so. | No brain, no heart, no problem. Has lived like that for 500 million years. |
| krabbe | Strandkrabbe | Shore crab | uncommon | kueste | 0.92–1.00 | 0.70 / 0.80 | 0.1–0.5 kg | 0.4 | 1 | 30 | #5f7a4a | #8fa870 | #44592f | crab | - | Läuft seitwärts. Hat es nie anders versucht. | Walks sideways. Never tried anything else. |
| dorsch | Dorsch | Cod | uncommon | kueste | 0.50–0.95 | 1.30 / 0.85 | 1–15 kg | 1 | 1.8 | 40 | #8a7a5a | #e2d9c2 | #66593e | spots | - | Früher so häufig, dass man darauf laufen konnte. Angeblich. | Once so plentiful you could walk on them. Allegedly. |
| seelachs | Seelachs | Pollock | uncommon | kueste | 0.20–0.70 | 1.30 / 0.75 | 1–10 kg | 1.5 | 1.9 | 45 | #4f5f6b | #cfd8dd | #38454d | none | - | Ist kein Lachs. Marketing vom Fischhändler. | Is not a salmon. Marketing by the fishmonger. |
| wolfsbarsch | Wolfsbarsch | Sea bass | rare | kueste | 0.10–0.60 | 1.30 / 0.80 | 1–10 kg | 1.6 | 2.3 | 110 | #8aa0b0 | #eef2f5 | #5c7180 | none | - | Der Lieblingsfisch der Sterneköche. Jetzt deiner. | The star chef's favourite. Now yours. |
| tintenfisch | Kalmar | Squid | rare | kueste | 0.30–0.80 | 1.00 / 0.60 | 0.5–4 kg | 1.4 | 2 | 140 | #c98aa5 | #f2d6e2 | #a86f8a | squid | - | Hat drei Herzen und blaues Blut. Adel. | Three hearts and blue blood. Nobility. |
| muraene | Muräne | Moray | rare | kueste | 0.70–1.00 | 2.00 / 0.40 | 2–15 kg | 1 | 2.5 | 150 | #4a5a3a | #b8c49a | #33402a | spots | night-only | Sieht aus, als würde sie dich hassen. Tut sie auch. | Looks like it hates you. It does. |
| seepferdchen | Seepferdchen | Seahorse | rare | kueste | 0.30–0.80 | 0.50 / 0.90 | 0.01–0.05 kg | 0.4 | 1.2 | 160 | #e6b04a | #f6d98a | #c48a2a | seahorse | - | Das Männchen trägt die Babys aus. Gleichberechtigung seit Urzeiten. | The male carries the babies. Equality since prehistoric times. |
| hummer | Hummer | Lobster | rare | kueste | 0.92–1.00 | 0.90 / 0.80 | 0.5–4 kg | 0.4 | 2.2 | 200 | #b03a2e | #e07a6a | #7a2a20 | crab | - | Kann theoretisch ewig leben. Endet trotzdem meist im Topf. | Could theoretically live forever. Usually ends up in a pot. |
| oktopus | Oktopus | Octopus | epic | kueste | 0.60–1.00 | 1.00 / 1.00 | 2–15 kg | 0.6 | 2.8 | 450 | #8a4a6a | #c98aa5 | #6a3450 | octopus | - | Löst Puzzles, öffnet Gläser, entkommt aus Aquarien. Schlauer als dein Köder. | Solves puzzles, opens jars, escapes aquariums. Smarter than your bait. |
| rochen | Stechrochen | Stingray | epic | kueste | 0.70–1.00 | 1.40 / 0.90 | 5–40 kg | 0.9 | 3 | 500 | #6a7a86 | #d8e0e4 | #4b5860 | ray | - | Der Stachel sitzt am Schwanz. Der Rest ist Pfannkuchen. | The sting is in the tail. The rest is pancake. |
| thunfisch | Thunfisch | Tuna | legendary | kueste | 0.20–0.70 | 2.20 / 0.90 | 60–350 kg | 1.9 | 3.9 | 1800 | #2f4f6f | #dfe8ef | #ffd23a | none | - | Bis zu 75 km/h schnell. Und trotzdem am Haken. | Up to 75 km/h. Still on the hook. |
| clownfisch | Clownfisch | Clownfish | common | riff | 0.30–0.80 | 0.60 / 1.00 | 0.05–0.2 kg | 1.3 | 1 | 20 | #ff7a1f | #ffb07a | #ffffff | stripes | - | Alle Clownfische werden als Männchen geboren. Nemo hatte einen komplizierten Vater. | All clownfish are born male. Nemo had a complicated dad. |
| lippfisch | Lippfisch | Wrasse | common | riff | 0.20–0.70 | 0.80 / 0.90 | 0.2–1 kg | 1.2 | 1.1 | 22 | #3fa66b | #b0f0c8 | #e55d8a | dashes | - | Putzt anderen Fischen die Zähne. Zahnhygiene im Riff. | Cleans other fish's teeth. Dental hygiene on the reef. |
| falterfisch | Falterfisch | Butterflyfish | common | riff | 0.20–0.70 | 0.70 / 1.20 | 0.1–0.5 kg | 1.2 | 1 | 25 | #ffd23a | #fff2b0 | #222222 | spots | - | Hat ein Fake-Auge am Schwanz. Verwirrt Räuber und Angler. | Has a fake eye on its tail. Confuses predators and anglers. |
| riffbarsch | Riffbarsch | Damselfish | common | riff | 0.20–0.70 | 0.60 / 1.00 | 0.05–0.3 kg | 1.5 | 1 | 18 | #3b6fd6 | #9fc0ff | #26499a | none | - | Verteidigt seinen Algengarten wie ein Rentner den Rasen. | Defends its algae garden like a retiree defends his lawn. |
| doktorfisch | Doktorfisch | Surgeonfish | uncommon | riff | 0.20–0.70 | 0.80 / 1.10 | 0.2–1 kg | 1.4 | 1.4 | 45 | #1f6fe0 | #7fc4ff | #ffd23a | none | - | Das Skalpell sitzt am Schwanz. Ohne Approbation. | The scalpel is on the tail. No medical licence. |
| kofferfisch | Kofferfisch | Boxfish | uncommon | riff | 0.30–0.90 | 0.70 / 1.10 | 0.2–1.5 kg | 0.5 | 1.2 | 50 | #f0c419 | #fff2a8 | #222222 | puffer | - | Eckig, gelb, giftig. Wie ein Reisekoffer, den man nicht anfassen sollte. | Boxy, yellow, poisonous. Like a suitcase you shouldn't touch. |
| drueckerfisch | Drückerfisch | Triggerfish | uncommon | riff | 0.30–0.80 | 0.90 / 1.20 | 0.5–3 kg | 1 | 1.6 | 55 | #5a8aa8 | #ffd97a | #2e5570 | spots | - | Kann seine Rückenflosse verriegeln. Anti-Diebstahl-Schutz. | Can lock its dorsal fin. Anti-theft protection. |
| papageienfisch | Papageienfisch | Parrotfish | uncommon | riff | 0.20–0.80 | 1.00 / 1.00 | 1–5 kg | 1 | 1.5 | 60 | #2fbf9f | #ff8ac2 | #1f8fbf | scales | - | Kackt Sand. Der weiße Traumstrand? Zum Teil Papageienfisch. | Poops sand. That white dream beach? Partly parrotfish. |
| kaiserfisch | Kaiserfisch | Angelfish | rare | riff | 0.20–0.70 | 0.90 / 1.20 | 0.5–2 kg | 1 | 1.8 | 150 | #2a3b8f | #ffd23a | #5ad4ff | stripes | - | Ändert als Erwachsener komplett die Farbe. Midlife-Crisis mit Stil. | Completely changes colour as an adult. Midlife crisis with style. |
| feuerfisch | Feuerfisch | Lionfish | rare | riff | 0.30–0.80 | 0.90 / 1.10 | 0.5–2 kg | 0.7 | 2 | 180 | #c0392b | #f5c6a0 | #7a1f16 | puffer | - | Giftig, schön und invasiv. Der Influencer des Riffs. | Venomous, beautiful, invasive. The influencer of the reef. |
| barrakuda | Barrakuda | Barracuda | rare | riff | 0.10–0.50 | 1.90 / 0.50 | 3–20 kg | 2 | 2.6 | 200 | #8fa3b3 | #e8eef2 | #5f7383 | teeth | - | Wird von glänzendem Schmuck angezogen. Uhr ab beim Schwimmen. | Attracted to shiny jewellery. Watch off when swimming. |
| blauring | Blauring-Oktopus | Blue-ringed octopus | rare | riff | 0.70–1.00 | 0.70 / 0.80 | 0.05–0.3 kg | 0.6 | 1.7 | 300 | #c9b56a | #e8dca8 | #1f6fe0 | octopus | - | Klein wie ein Golfball, Gift für 26 Menschen. Bitte nicht streicheln. | Golf-ball sized, venom for 26 people. Please don't pet. |
| perlmuschel | Perlmuschel | Pearl oyster | rare | riff | 0.95–1.00 | 0.70 / 0.80 | 0.3–1 kg | 0.05 | 0.5 | 300 | #b8a48c | #e6d8c4 | #8a7a66 | shell | - | Eine Perle ist im Grunde eine Muschel, die ein Sandkorn nervt. | A pearl is basically an oyster annoyed by a grain of sand. |
| zackenbarsch | Zackenbarsch | Grouper | epic | riff | 0.60–1.00 | 1.80 / 1.10 | 20–150 kg | 0.7 | 3.2 | 550 | #6b4a3a | #c9a88a | #4a3328 | spots | - | Kann über 400 Kilo wiegen. Der Chef im Riff. | Can weigh over 400 kilos. The boss of the reef. |
| schildkroete | Meeresschildkröte | Sea turtle | epic | riff | 0.10–0.70 | 1.40 / 0.90 | 40–150 kg | 0.6 | 2.4 | 700 | #4a7a5a | #c9d9b0 | #6a8a4a | turtle | - | Findet nach Jahrzehnten den Strand, an dem sie geboren wurde. Du findest dein Auto nicht. | Finds the beach it was born on after decades. You can't find your car. |
| riffhai | Riffhai | Reef shark | epic | riff | 0.20–0.70 | 2.20 / 0.80 | 20–80 kg | 1.5 | 3.5 | 900 | #7a8a96 | #e6edf3 | #556370 | shark | - | Eigentlich schüchtern. Sagt jeder Hai. | Actually shy. Says every shark. |
| manta | Mantarochen | Manta ray | legendary | riff | 0.10–0.60 | 2.60 / 1.20 | 500–1500 kg | 1 | 3.8 | 2500 | #2a3a4a | #e6edf3 | #1a2530 | ray | - | Bis zu 7 Meter Spannweite. Frisst trotzdem nur Plankton. Bescheiden. | Up to 7 metres wide. Still only eats plankton. Humble. |
| laternenfisch | Laternenfisch | Lanternfish | common | tiefsee | 0.20–0.70 | 0.60 / 0.80 | 0.02–0.1 kg | 1.2 | 1 | 40 | #4a5a7a | #9fd8ff | #3a4660 | glow | - | Macht 65 % der Tiefsee-Biomasse aus. Der wahre Herrscher der Erde. | Makes up 65 % of deep-sea biomass. The true ruler of Earth. |
| grenadier | Grenadierfisch | Grenadier | common | tiefsee | 0.60–1.00 | 1.60 / 0.50 | 0.5–4 kg | 0.7 | 1.3 | 45 | #6a6a7a | #b8b8c8 | #4a4a58 | none | - | Lebt in 6000 Metern Tiefe. Miete dort: unschlagbar. | Lives at 6000 metres. Rent down there: unbeatable. |
| beilfisch | Beilfisch | Hatchetfish | uncommon | tiefsee | 0.20–0.70 | 0.60 / 1.30 | 0.02–0.1 kg | 1 | 1.2 | 90 | #c8d0dc | #ffffff | #8a94a4 | glow | - | Leuchtet von unten, um keinen Schatten zu werfen. Tarnung auf Nobelpreis-Niveau. | Glows from below to cast no shadow. Nobel-level camouflage. |
| blobfisch | Blobfisch | Blobfish | uncommon | tiefsee | 0.85–1.00 | 0.90 / 1.00 | 1–5 kg | 0.3 | 0.8 | 120 | #e8b4c0 | #f6d6dc | #c8909c | blob | - | Sieht an Land traurig aus, weil der Druck fehlt. In der Tiefe sieht er normal aus. Ehrlich. | Looks sad on land because the pressure is gone. Down deep it looks normal. Honestly. |
| tiefseequalle | Tiefsee-Qualle | Deep-sea jelly | uncommon | tiefsee | 0.10–0.70 | 0.90 / 1.00 | 0.5–4 kg | 0.25 | 0.8 | 100 | rgba(255,120,200,0.7) | #fff | rgba(255,120,200,0.6) | jelly | glow-flag | Pulsierendes Licht in der Finsternis. Die Disco ohne Gäste. | Pulsing light in the darkness. The disco with no guests. |
| riesenassel | Riesenassel | Giant isopod | uncommon | tiefsee | 0.92–1.00 | 1.00 / 0.80 | 0.5–2 kg | 0.3 | 1.4 | 110 | #8a8a80 | #c8c8be | #5a5a52 | crab | - | Kann fünf Jahre ohne Essen. Dann frisst sie ein Aquarium-Team an den Nerven. | Can go five years without food. Then eats an aquarium team's nerves. |
| fangzahn | Fangzahnfisch | Fangtooth | rare | tiefsee | 0.50–0.90 | 0.70 / 1.10 | 0.2–1 kg | 1 | 2.1 | 240 | #2e2e3e | #6a6a80 | #1e1e2a | teeth | - | Die größten Zähne im Verhältnis zum Körper aller Fische. Kann den Mund nicht ganz schließen. | Largest teeth relative to body of any fish. Can't fully close its mouth. |
| viperfisch | Viperfisch | Viperfish | rare | tiefsee | 0.30–0.80 | 1.50 / 0.50 | 0.3–2 kg | 1.4 | 2.4 | 250 | #1f3b4a | #5fb8c8 | #12262f | teeth | glow-flag | Schaltet sein Leuchtorgan blinkend an. Der Blinker der Tiefsee. | Blinks its light organ. The indicator of the deep. |
| gespenster | Gespensterfisch | Barreleye | rare | tiefsee | 0.30–0.80 | 0.80 / 0.90 | 0.1–0.5 kg | 0.8 | 1.8 | 260 | #8fb8c8 | #e0f4ff | #5f8896 | glow | - | Durchsichtiger Kopf, Augen, die nach oben schauen. Sieht dich, bevor du ihn siehst. | Transparent head, eyes pointing up. Sees you before you see it. |
| pelikanaal | Pelikanaal | Gulper eel | rare | tiefsee | 0.50–1.00 | 2.20 / 0.40 | 0.5–3 kg | 0.8 | 2.3 | 280 | #1a1a2a | #3a3a55 | #101018 | lure | - | Ein Maul wie ein Müllsack, ein Körper wie ein Schnürsenkel. | A mouth like a bin bag, a body like a shoelace. |
| drachenfisch | Schwarzer Drachenfisch | Black dragonfish | rare | tiefsee | 0.40–0.90 | 1.40 / 0.50 | 0.2–1 kg | 1.2 | 2.5 | 300 | #151520 | #3a3a4a | #0d0d14 | lure | - | Schwarz wie die Nacht, Zähne wie Glas. Das Design ist Absicht. | Black as night, teeth like glass. The design is intentional. |
| seeteufel | Seeteufel | Sea devil | epic | tiefsee | 0.80–1.00 | 1.40 / 1.30 | 5–40 kg | 0.5 | 3 | 700 | #3a3a4a | #7a7a8a | #26262f | lure | - | Der Anglerfisch mit dem größten Maul. Alles, was reinpasst, ist Mittagessen. | The anglerfish with the biggest mouth. Anything that fits is lunch. |
| vampirtinten | Vampirtintenfisch | Vampire squid | epic | tiefsee | 0.50–0.90 | 0.90 / 0.80 | 0.3–1.5 kg | 0.8 | 2.6 | 800 | #7a1f2e | #c04a5a | #4a0f18 | squid | glow-flag | Dreht sich bei Gefahr von innen nach außen. Der ultimative Rückzug. | Turns itself inside out when threatened. The ultimate retreat. |
| koboldhai | Koboldhai | Goblin shark | legendary | tiefsee | 0.60–1.00 | 2.60 / 0.70 | 100–250 kg | 1 | 3.9 | 3500 | #d9a0a8 | #f2d0d4 | #a87078 | shark | - | Schleudert seinen Kiefer nach vorne wie ein Alien. Weil er einer ist. Vermutlich. | Shoots its jaw forward like an alien. Because it is one. Probably. |
| riesenkalmar | Riesenkalmar | Giant squid | legendary | tiefsee | 0.40–0.90 | 3.20 / 0.80 | 200–500 kg | 0.9 | 4 | 4000 | #8a2a3a | #c05a6a | #5a1a24 | squid | - | Augen so groß wie Fußbälle. Sieht dein Boot lange vor dir. | Eyes the size of footballs. Sees your boat long before you do. |
| taucherstiefel | Taucherstiefel | Diver's boot | common | tiefsee | 0.90–1.00 | 0.90 / 1.00 | 1–3 kg | 0.2 | 0.5 | 2 | #2a3a4a | #2a3a4a | #1a2530 | boot | bycatch | Zur Ausrüstung gehörte mal ein Taucher. Keine weiteren Fragen. | A diver came with this once. No further questions. |
| stint | Stint | Smelt | common | arktis | 0.10–0.60 | 0.70 / 0.60 | 0.05–0.2 kg | 1.4 | 0.8 | 9 | #a8b8c8 | #eef4f8 | #7a8a9a | none | - | Riecht nach Gurke. Kein Witz. Frisch gefangen riecht er nach Gurke. | Smells like cucumber. No joke. Freshly caught, it smells like cucumber. |
| lodde | Lodde | Capelin | common | arktis | 0.10–0.60 | 0.80 / 0.60 | 0.05–0.3 kg | 1.5 | 0.9 | 12 | #8fa8b8 | #e6f0f6 | #5f7888 | none | - | Nahrung für alles, was im Nordmeer Zähne hat. Undankbarer Job. | Food for everything with teeth in the northern sea. Thankless job. |
| polardorsch | Polardorsch | Polar cod | common | arktis | 0.30–0.90 | 1.00 / 0.80 | 0.3–2 kg | 1 | 1.2 | 20 | #7a8a7a | #d8e0d8 | #566456 | spots | - | Hat Frostschutzmittel im Blut. Der Fisch, der Winterreifen nicht braucht. | Has antifreeze in its blood. The fish that doesn't need winter tyres. |
| gefroren | Gefrorener Fisch | Frozen fish | common | arktis | 0.20–0.80 | 0.90 / 0.90 | 0.5–2 kg | 0.15 | 0.4 | 4 | #8fa0b3 | #e9eef3 | #6a7a8a | frozen | bycatch | Frische garantiert. Auftauen dauert. | Freshness guaranteed. Thawing takes a while. |
| kabeljau | Kabeljau | Atlantic cod | uncommon | arktis | 0.50–0.95 | 1.30 / 0.85 | 2–25 kg | 1 | 1.9 | 55 | #8a7a5a | #e2d9c2 | #66593e | spots | - | Ganze Kriege wurden um ihn geführt. Die Kabeljaukriege. Wirklich. | Whole wars were fought over it. The Cod Wars. Really. |
| seesaibling | Seesaibling | Arctic char | uncommon | arktis | 0.30–0.80 | 1.00 / 0.80 | 0.5–6 kg | 1.4 | 1.7 | 60 | #3f5a6a | #ff9a5c | #2c4250 | spots | - | Der nördlichste Süßwasserfisch der Welt. Ganz oben, ganz kalt. | The northernmost freshwater fish in the world. Way up, way cold. |
| seeskorpion | Seeskorpion | Sea scorpion | uncommon | arktis | 0.80–1.00 | 0.90 / 1.10 | 0.3–2 kg | 0.6 | 1.8 | 70 | #7a5a3a | #c8a880 | #4a3520 | puffer | - | Stachelig, giftig, hässlich – und Vater des Jahres: bewacht die Eier wochenlang. | Spiny, venomous, ugly – and father of the year: guards the eggs for weeks. |
| eisfisch | Eisfisch | Icefish | rare | arktis | 0.40–0.90 | 1.10 / 0.70 | 0.5–3 kg | 1 | 2 | 200 | #dfefff | #ffffff | #a8c8e0 | glow | - | Hat kein Hämoglobin, sein Blut ist durchsichtig. Ein Geist mit Flossen. | No haemoglobin, its blood is clear. A ghost with fins. |
| arktislachs | Arktischer Lachs | Arctic salmon | rare | arktis | 0.10–0.60 | 1.40 / 0.80 | 3–20 kg | 1.6 | 2.5 | 220 | #9fb0c0 | #f0b8a0 | #6f8090 | dashes | - | Schwimmt tausende Kilometer durch eiskaltes Wasser. Für Liebe. | Swims thousands of kilometres through icy water. For love. |
| seewolf | Seewolf | Wolffish | rare | arktis | 0.70–1.00 | 1.60 / 0.70 | 5–20 kg | 0.9 | 2.7 | 250 | #5a6a7a | #b8c4cc | #3e4a56 | teeth | - | Knackt Muscheln mit den Zähnen und wechselt sie jedes Jahr komplett. Zahnfee-Großkunde. | Cracks shells with its teeth and replaces them all yearly. Tooth fairy VIP. |
| koenigskrabbe | Königskrabbe | King crab | epic | arktis | 0.92–1.00 | 1.20 / 1.00 | 3–12 kg | 0.3 | 2.6 | 600 | #c0392b | #e8907a | #8a2a20 | crab | - | Bis 1,8 Meter Spannweite. Der Spinnen-Albtraum in Krabbenform. | Up to 1.8 metres across. The spider nightmare in crab form. |
| heilbutt | Heilbutt | Halibut | epic | arktis | 0.85–1.00 | 2.20 / 1.20 | 30–200 kg | 0.5 | 3.4 | 800 | #5a6a5a | #e8e8d8 | #3e4a3e | flat | - | Der größte Plattfisch. Bis 300 Kilo Teppich. | The biggest flatfish. Up to 300 kilos of carpet. |
| pinguin | Verirrter Pinguin | Lost penguin | epic | arktis | 0.05–0.40 | 0.90 / 1.00 | 3–6 kg | 1.2 | 2.2 | 100 | #1a1a2e | #ffffff | #ff9f1c | penguin | bycatch | Falscher Pol. Pinguine leben in der Antarktis. Dieser hier hat sich mächtig verlaufen. | Wrong pole. Penguins live in the Antarctic. This one got seriously lost. |
| groenlandhai | Grönlandhai | Greenland shark | legendary | arktis | 0.70–1.00 | 3.40 / 0.90 | 400–1000 kg | 0.35 | 4 | 5000 | #5a6068 | #b8bcc2 | #3e444a | shark | - | Wird über 400 Jahre alt. Hat schon Shakespeare überlebt. Schwimmt in Zeitlupe. | Lives over 400 years. Has outlived Shakespeare. Swims in slow motion. |

*(`value` above is the raw `sp.value` coin figure. The actual payout at catch time is
`Math.round(base * mult * (f.shiny ? 5 : 1) * talentMult("feilsch", 0.05))` where `base = sp.value * COIN_SCALE`,
`mult` is a perfect-catch/streak multiplier — see `script.js` around line 780; junk species (`sp.junk`) skip `mult`
entirely and pay flat `base`.)*

### 1.2 Verbatim source — `fish.js` lines 2–53

```js
const RARITY = {
  common:    { idx: 0, name: "Gewöhnlich",   color: "#c3ccd6", weight: 50 },
  uncommon:  { idx: 1, name: "Ungewöhnlich", color: "#5ad46a", weight: 24 },
  rare:      { idx: 2, name: "Selten",       color: "#4aa3ff", weight: 10 },
  epic:      { idx: 3, name: "Episch",       color: "#c072ff", weight: 3.5 },
  legendary: { idx: 4, name: "Legendär",     color: "#ffc83d", weight: 1 }
};

// len/h = Körperproportionen, depth = Tiefenband (0 = Oberfläche, 1 = Grund), fight = Kampfstärke im Minigame
const SPECIES = [
  { id: "rotauge",  name: "Rotauge",   rarity: "common",    value: 8,   color: "#9fb3c8", belly: "#e8eef4", fin: "#d9534f", len: 0.8, h: 0.9, speed: 1.1, depth: [0.05, 0.5], kg: [0.2, 1.2],  fight: 0.9, pattern: "none" },
  { id: "karpfen",  name: "Karpfen",   rarity: "common",    value: 12,  color: "#7a8f3a", belly: "#d8d29a", fin: "#5f6f2a", len: 1.15, h: 1.15, speed: 0.7, depth: [0.3, 0.9], kg: [1, 9],     fight: 1.1, pattern: "scales" },
  { id: "barsch",   name: "Barsch",    rarity: "common",    value: 15,  color: "#4f7942", belly: "#d9e0a8", fin: "#e07b39", len: 0.9, h: 1.1, speed: 1.2, depth: [0.1, 0.7], kg: [0.3, 2.5],  fight: 1.3, pattern: "stripes" },
  { id: "forelle",  name: "Forelle",   rarity: "uncommon",  value: 30,  color: "#6f9ea3", belly: "#f3d6c8", fin: "#5a7f83", len: 1.0, h: 0.85, speed: 1.4, depth: [0.05, 0.5], kg: [0.5, 4],   fight: 1.6, pattern: "spots" },
  { id: "hecht",    name: "Hecht",     rarity: "uncommon",  value: 60,  color: "#5c7a3a", belly: "#c9d39a", fin: "#8a6a2a", len: 1.6, h: 0.6, speed: 1.0, depth: [0.2, 0.8], kg: [2, 15],    fight: 2.0, pattern: "dashes" },
  { id: "zander",   name: "Zander",    rarity: "rare",      value: 95,  color: "#8b8f6c", belly: "#e0e2cc", fin: "#4e5140", len: 1.35, h: 0.7, speed: 1.1, depth: [0.4, 0.95], kg: [1, 10],   fight: 2.2, pattern: "stripes" },
  { id: "goldfisch",name: "Goldfisch", rarity: "rare",      value: 200, color: "#ffab1f", belly: "#ffe08a", fin: "#ff7a1f", len: 0.6, h: 1.0, speed: 1.9, depth: [0.02, 0.35], kg: [0.1, 0.6], fight: 1.9, pattern: "glow" },
  { id: "wels",     name: "Wels",      rarity: "epic",      value: 380, color: "#4a4a55", belly: "#a8a8b4", fin: "#33333d", len: 2.3, h: 0.9, speed: 0.55, depth: [0.7, 1.0], kg: [12, 65],   fight: 2.9, pattern: "whiskers" },
  { id: "aal",      name: "Aal",       rarity: "uncommon",  value: 70,  color: "#3c4a3c", belly: "#b9c2a5", fin: "#2c382c", len: 1.9, h: 0.38, speed: 1.3, depth: [0.5, 1.0], kg: [0.5, 3.5], fight: 2.1, pattern: "none", night: true },
  { id: "mondfisch",name: "Mondfisch", rarity: "legendary", value: 1200,color: "#cfd8ff", belly: "#ffffff", fin: "#9fb0ff", len: 1.1, h: 1.35, speed: 1.0, depth: [0.1, 0.6], kg: [1, 6],    fight: 3.4, pattern: "moon", night: true },
  // --- Stunde 2: mehr Fische ---
  { id: "brasse",   name: "Brasse",    rarity: "common",    value: 10,  color: "#a3a99a", belly: "#e6e6dc", fin: "#6f7566", len: 1.05, h: 1.3, speed: 0.7, depth: [0.4, 0.9], kg: [0.5, 5],    fight: 1.0, pattern: "scales" },
  { id: "schleie",  name: "Schleie",   rarity: "common",    value: 11,  color: "#5d6b2f", belly: "#c8c76a", fin: "#3f4a1f", len: 1.0, h: 1.05, speed: 0.6, depth: [0.6, 1.0], kg: [0.5, 4],    fight: 1.1, pattern: "none" },
  { id: "doebel",   name: "Döbel",     rarity: "common",    value: 9,   color: "#8fa0b3", belly: "#e9eef3", fin: "#c0392b", len: 0.95, h: 0.95, speed: 1.3, depth: [0.05, 0.5], kg: [0.3, 3],   fight: 1.2, pattern: "scales" },
  { id: "regenbogenforelle", name: "Regenbogenforelle", rarity: "uncommon", value: 45, color: "#7aa6c2", belly: "#f6c1d0", fin: "#557a92", len: 1.05, h: 0.85, speed: 1.5, depth: [0.05, 0.5], kg: [0.5, 5], fight: 1.7, pattern: "spots" },
  { id: "saibling", name: "Saibling",  rarity: "uncommon",  value: 50,  color: "#4f6d7a", belly: "#ffb27a", fin: "#35505c", len: 1.0, h: 0.8, speed: 1.4, depth: [0.3, 0.8], kg: [0.5, 4],     fight: 1.6, pattern: "spots" },
  { id: "kugelfisch", name: "Kugelfisch", rarity: "uncommon", value: 55, color: "#d9c46b", belly: "#fff3c4", fin: "#a58f3a", len: 0.7, h: 1.3, speed: 0.5, depth: [0.2, 0.7], kg: [0.3, 1.5], fight: 1.3, pattern: "puffer" },
  { id: "piranha",  name: "Piranha",   rarity: "rare",      value: 110, color: "#7d8a5a", belly: "#e0655a", fin: "#55603a", len: 0.8, h: 1.15, speed: 1.7, depth: [0.2, 0.7], kg: [0.5, 3],    fight: 2.0, pattern: "teeth" },
  { id: "lachs",    name: "Lachs",     rarity: "rare",      value: 120, color: "#8fa5b8", belly: "#f0b8a0", fin: "#5c7386", len: 1.4, h: 0.8, speed: 1.6, depth: [0.1, 0.6], kg: [3, 18],     fight: 2.4, pattern: "dashes" },
  { id: "neonfisch",name: "Neonfisch", rarity: "rare",      value: 150, color: "#2ee6ff", belly: "#ff3d8a", fin: "#1aa3b8", len: 0.5, h: 0.8, speed: 2.2, depth: [0.1, 0.5], kg: [0.05, 0.2], fight: 1.9, pattern: "glow", night: true },
  { id: "koi",      name: "Koi",       rarity: "epic",      value: 400, color: "#f4f1ec", belly: "#ffffff", fin: "#e0552b", len: 1.1, h: 1.0, speed: 0.8, depth: [0.05, 0.4], kg: [1, 8],     fight: 1.8, pattern: "koi" },
  { id: "anglerfisch", name: "Anglerfisch", rarity: "epic", value: 450, color: "#3b3f5c", belly: "#6b6f8c", fin: "#2a2d45", len: 1.0, h: 1.2, speed: 0.5, depth: [0.8, 1.0], kg: [2, 12],  fight: 2.6, pattern: "lure", night: true },
  { id: "stoer",    name: "Stör",      rarity: "epic",      value: 500, color: "#6d7b7a", belly: "#c9d1cf", fin: "#4a5554", len: 2.6, h: 0.6, speed: 0.6, depth: [0.8, 1.0], kg: [15, 120],  fight: 3.2, pattern: "dashes" },
  { id: "hai",      name: "Hai",       rarity: "legendary", value: 1500,color: "#6f8296", belly: "#e6edf3", fin: "#4d5d6d", len: 2.8, h: 0.9, speed: 1.4, depth: [0.2, 0.7], kg: [40, 300],  fight: 3.8, pattern: "shark" },
  // --- Beifang ---
  { id: "stiefel",  name: "Alter Stiefel", rarity: "common",value: 1,   color: "#6b4a2b", belly: "#6b4a2b", fin: "#4a3018", len: 0.9, h: 1.0, speed: 0.25, depth: [0.85, 1.0], kg: [0.8, 1.5], fight: 0.5, pattern: "boot", junk: true },
  { id: "flaschenpost", name: "Flaschenpost", rarity: "uncommon", value: 5, color: "#7fc8a9", belly: "#7fc8a9", fin: "#5a8f78", len: 0.8, h: 1.0, speed: 0.3, depth: [0.0, 0.15], kg: [0.3, 0.5], fight: 0.4, pattern: "bottle", junk: true },
  { id: "schatzkiste", name: "Schatzkiste", rarity: "epic", value: 250, color: "#8a5a2b", belly: "#8a5a2b", fin: "#d4a017", len: 0.9, h: 1.0, speed: 0.15, depth: [0.9, 1.0], kg: [4, 12], fight: 1.2, pattern: "chest", junk: true }
];

const BOTTLE_MESSAGES = [
  "Hilfe, ich sitze auf einer Insel fest. Bringt Pizza.",
  "Wer das liest, schuldet mir ein Bier.",
  "Der Fisch, der dir entwischt ist, grüßt.",
  "Mein Schatz liegt… ach, hab ich vergessen.",
  "Hier stand mal ein Rechtschreibfehler.",
  "Dies ist kein Fisch. Trotzdem Glückwunsch.",
  "Grüße vom anderen Ufer. Hier ist es auch nass.",
  "Ich habe den Stiefel verloren. Falls du ihn findest…",
  "TODO: bessere Nachricht schreiben",
  "Angeln ist wie Programmieren: Warten, dann kurz Panik."
];
```

### 1.3 Verbatim source — `locations.js` lines 1–56 (location list, loader, boss registration)

```js
// --- Angelplätze + deren Arten ---
// mode: dock (Steg) | pier (Steinmole) | boat (Ruderboot) | ice (Eisloch)
const LOCATIONS = [
  { id: "see",     name: "Steg am See",       price: 0,     level: 1,  mode: "dock", icon: "🌲", water: ["#5fa8c9", "#1c4f6b"], dark: 0,    desc: "Wo alles anfing. Karpfen, Hecht, Barsch – und ein Stiefel." },
  { id: "boot",    name: "Ruderboot · Seemitte", price: 1200, level: 3, mode: "boat", icon: "🚣", water: ["#4b8fb5", "#0f3448"], dark: 0.05, desc: "Tiefes Wasser, große Räuber. Und Gerüchte über etwas Großes." },
  { id: "kueste",  name: "Küste",              price: 3000,  level: 7,  mode: "pier", icon: "🌊", water: ["#3f7fb0", "#0c2b48"], dark: 0,    desc: "Salzwasser: Makrele, Krabbe, Oktopus. Die Möwen sind frecher." },
  { id: "riff",    name: "Korallenriff",       price: 6000,  level: 12, mode: "boat", icon: "🐠", water: ["#3fd0c9", "#0e6b7a"], dark: 0,    desc: "Türkis, bunt, warm. Clownfische, Schildkröten, Mantas." },
  { id: "tiefsee", name: "Tiefsee",            price: 12000, level: 18, mode: "dive", icon: "🦑", water: ["#0d2038", "#010409"], dark: 0.6,  desc: "Kein Licht außer dem, was die Fische selbst machen." },
  { id: "arktis",  name: "Eisloch · Arktis",   price: 20000, level: 25, mode: "ice",  icon: "🧊", water: ["#3a7f96", "#0a2a3a"], dark: 0.1,  desc: "Ein Loch im Eis, ein Hocker, minus 20 Grad. Heilbutt wartet." }
];

// Kompakte Definition: [id, name, rarity, value, color, belly, fin, len, h, speed, d0, d1, kg0, kg1, fight, pattern, flags]
function S(loc, rows) {
  for (const r of rows) {
    const [id, name, rarity, value, color, belly, fin, len, h, speed, d0, d1, kg0, kg1, fight, pattern, flags = {}] = r;
    SPECIES.push(Object.assign({ id, name, rarity, value, color, belly, fin, len, h, speed, depth: [d0, d1], kg: [kg0, kg1], fight, pattern, loc: [loc] }, flags));
  }
}

// Vorhandene See-Arten den Orten zuordnen
for (const sp of SPECIES) {
  if (["goldfisch", "koi", "stiefel", "flaschenpost", "neonfisch"].includes(sp.id)) sp.loc = ["see"];
  else if (sp.id === "schatzkiste") sp.loc = LOCATIONS.map(l => l.id);
  else if (sp.id === "hai") sp.loc = ["boot", "kueste"];
  else if (["wels", "stoer", "anglerfisch"].includes(sp.id)) sp.loc = ["see", "boot"];
  else sp.loc = ["see", "boot"];
}

S("boot", [
  ["ukelei",       "Ukelei",          "common",    6,   "#b9c4cf", "#eef2f5", "#8a97a3", 0.7, 0.7, 1.4, 0.02, 0.3, 0.05, 0.2, 0.8, "none"],
  ["kaulbarsch",   "Kaulbarsch",      "common",    7,   "#8c8a5a", "#d8d3a0", "#5f5d3a", 0.7, 1.0, 1.1, 0.5, 1.0, 0.1, 0.4, 0.9, "stripes"],
  ["renke",        "Renke",           "common",    14,  "#9fb6c6", "#f0f4f7", "#6f8695", 1.0, 0.8, 1.2, 0.3, 0.8, 0.5, 3, 1.2, "none"],
  ["zwergwels",    "Zwergwels",       "common",    12,  "#4b4a3f", "#a89f80", "#33322a", 0.85, 1.0, 0.7, 0.7, 1.0, 0.3, 1.5, 1.1, "whiskers"],
  ["steinbeisser", "Steinbeißer",     "common",    9,   "#a68b5b", "#e6d7b3", "#7a6440", 1.3, 0.35, 0.9, 0.85, 1.0, 0.05, 0.2, 0.8, "dashes"],
  ["graskarpfen",  "Graskarpfen",     "uncommon",  40,  "#6e8f4e", "#d3dcb0", "#4c6633", 1.4, 0.9, 0.7, 0.2, 0.7, 3, 25, 1.6, "scales"],
  ["rapfen",       "Rapfen",          "uncommon",  48,  "#7d95a8", "#e3ebf0", "#c0392b", 1.4, 0.7, 1.7, 0.05, 0.4, 1, 8, 1.9, "none"],
  ["schwarzbarsch","Schwarzbarsch",   "uncommon",  45,  "#3e5a3a", "#b7c9a0", "#28402a", 1.0, 1.05, 1.3, 0.2, 0.7, 0.5, 4, 1.8, "dashes"],
  ["sonnenbarsch", "Sonnenbarsch",    "uncommon",  35,  "#c98a3a", "#ffd97a", "#3b6fb0", 0.7, 1.2, 1.2, 0.1, 0.5, 0.1, 0.6, 1.3, "spots"],
  ["seeforelle",   "Seeforelle",      "uncommon",  55,  "#5f7f8f", "#e8d6c0", "#44606e", 1.3, 0.8, 1.5, 0.2, 0.7, 1, 12, 2.0, "spots"],
  ["quappe",       "Quappe",          "rare",      90,  "#6b5a3e", "#c2b28f", "#4a3d2a", 1.4, 0.7, 0.8, 0.8, 1.0, 0.5, 6, 2.0, "whiskers", { night: true }],
  ["marmorkarpfen","Marmorkarpfen",   "rare",      130, "#7c8a8f", "#d0d8da", "#56646a", 1.7, 1.0, 0.6, 0.3, 0.8, 8, 45, 2.6, "scales"],
  ["urhecht",      "Urhecht",         "epic",      600, "#3d5a2a", "#a8b88a", "#6b4f22", 2.4, 0.6, 1.1, 0.3, 0.8, 12, 30, 3.2, "dashes"],
  ["riesenwels",   "Riesenwels",      "epic",      750, "#2f2f3a", "#8a8a99", "#1f1f28", 3.0, 0.9, 0.5, 0.8, 1.0, 60, 150, 3.5, "whiskers", { night: true }],
  ["nessie",       "Nessie",          "legendary", 5000,"#2d6b4f", "#7fb89a", "#1f4a37", 2.2, 1.2, 0.7, 0.3, 0.7, 500, 2000, 4.0, "serpent", { boss: true }]
]);

// Seetang als Beifang (See, Boot, Küste)
S("see",    [["seetang",   "Seetang",   "common", 2, "#3f8a4f", "#3f8a4f", "#2c5e37", 0.8, 1.0, 0.1, 0.85, 1.0, 0.2, 0.8, 0.3, "weed", { junk: true }]]);
SPECIES.find(s => s.id === "seetang").loc = ["see", "boot", "kueste"];

// --- Bossfische: erscheinen erst, wenn der Fischdex des Orts (ohne Boss) komplett ist ---
S("see",     [["alterkarl",  "Der alte Karl",   "legendary", 3000,  "#5a6b2a", "#c9c27a", "#3f4f1a", 3.0, 1.2, 0.5, 0.5, 0.95, 40, 90, 4.0, "scales", { boss: true }]]);
S("kueste",  [["kraken",     "Der Kraken",      "legendary", 8000,  "#5a2a4a", "#a86a90", "#3a1a30", 3.6, 1.1, 0.5, 0.5, 1.0, 800, 2500, 4.2, "octopus", { boss: true }]]);
S("riff",    [["megalodon",  "Megalodon",       "legendary", 12000, "#4a5a6a", "#c8d4dc", "#2e3a46", 4.2, 0.9, 1.2, 0.2, 0.7, 3000, 8000, 4.5, "shark", { boss: true }]]);
S("tiefsee", [["leviathan",  "Leviathan",       "legendary", 20000, "#0e1a2e", "#3a5a8a", "#7fd8ff", 4.0, 1.0, 0.6, 0.4, 0.9, 5000, 20000, 4.8, "serpent", { boss: true, glow: true }]]);
S("arktis",  [["eiskoenig",  "Der Eiskönig",    "legendary", 30000, "#dfefff", "#ffffff", "#9fd0ff", 4.0, 0.9, 0.4, 0.6, 1.0, 2000, 6000, 5.0, "shark", { boss: true, glow: true }]]);
```

### 1.4 Verbatim source — `locations.js` lines 79–153 (küste, riff, tiefsee, arktis rows)

```js
S("kueste", [
  ["hering",       "Hering",          "common",    8,   "#9fb3c8", "#f0f4f7", "#6f8397", 0.8, 0.7, 1.5, 0.05, 0.5, 0.1, 0.4, 0.9, "none"],
  ["meeraesche",   "Meeräsche",       "common",    10,  "#8a9aa6", "#e6ecef", "#5f6f7a", 1.0, 0.8, 1.2, 0.05, 0.4, 0.5, 3, 1.1, "dashes"],
  ["makrele",      "Makrele",         "common",    15,  "#3d7f9f", "#e8f2f6", "#2c5d75", 1.1, 0.7, 1.8, 0.05, 0.5, 0.3, 2, 1.4, "stripes"],
  ["scholle",      "Scholle",         "common",    12,  "#8b6f47", "#e8d9c0", "#6a5334", 1.0, 0.8, 0.5, 0.85, 1.0, 0.3, 3, 1.0, "flat"],
  ["seestern",     "Seestern",        "common",    5,   "#e0733a", "#e0733a", "#b85a2a", 0.7, 0.7, 0.05, 0.92, 1.0, 0.1, 0.5, 0.3, "star", { junk: true }],
  ["qualle",       "Qualle",          "uncommon",  20,  "rgba(180,200,255,0.75)", "#fff", "rgba(180,200,255,0.6)", 0.8, 1.0, 0.3, 0.1, 0.6, 0.5, 3, 0.7, "jelly"],
  ["krabbe",       "Strandkrabbe",    "uncommon",  30,  "#5f7a4a", "#8fa870", "#44592f", 0.7, 0.8, 0.4, 0.92, 1.0, 0.1, 0.5, 1.0, "crab"],
  ["dorsch",       "Dorsch",          "uncommon",  40,  "#8a7a5a", "#e2d9c2", "#66593e", 1.3, 0.85, 1.0, 0.5, 0.95, 1, 15, 1.8, "spots"],
  ["seelachs",     "Seelachs",        "uncommon",  45,  "#4f5f6b", "#cfd8dd", "#38454d", 1.3, 0.75, 1.5, 0.2, 0.7, 1, 10, 1.9, "none"],
  ["wolfsbarsch",  "Wolfsbarsch",     "rare",      110, "#8aa0b0", "#eef2f5", "#5c7180", 1.3, 0.8, 1.6, 0.1, 0.6, 1, 10, 2.3, "none"],
  ["tintenfisch",  "Kalmar",          "rare",      140, "#c98aa5", "#f2d6e2", "#a86f8a", 1.0, 0.6, 1.4, 0.3, 0.8, 0.5, 4, 2.0, "squid"],
  ["muraene",      "Muräne",          "rare",      150, "#4a5a3a", "#b8c49a", "#33402a", 2.0, 0.4, 1.0, 0.7, 1.0, 2, 15, 2.5, "spots", { night: true }],
  ["seepferdchen", "Seepferdchen",    "rare",      160, "#e6b04a", "#f6d98a", "#c48a2a", 0.5, 0.9, 0.4, 0.3, 0.8, 0.01, 0.05, 1.2, "seahorse"],
  ["hummer",       "Hummer",          "rare",      200, "#b03a2e", "#e07a6a", "#7a2a20", 0.9, 0.8, 0.4, 0.92, 1.0, 0.5, 4, 2.2, "crab"],
  ["oktopus",      "Oktopus",         "epic",      450, "#8a4a6a", "#c98aa5", "#6a3450", 1.0, 1.0, 0.6, 0.6, 1.0, 2, 15, 2.8, "octopus"],
  ["rochen",       "Stechrochen",     "epic",      500, "#6a7a86", "#d8e0e4", "#4b5860", 1.4, 0.9, 0.9, 0.7, 1.0, 5, 40, 3.0, "ray"],
  ["thunfisch",    "Thunfisch",       "legendary", 1800,"#2f4f6f", "#dfe8ef", "#ffd23a", 2.2, 0.9, 1.9, 0.2, 0.7, 60, 350, 3.9, "none"]
]);

S("riff", [
  ["clownfisch",   "Clownfisch",      "common",    20,  "#ff7a1f", "#ffb07a", "#ffffff", 0.6, 1.0, 1.3, 0.3, 0.8, 0.05, 0.2, 1.0, "stripes"],
  ["lippfisch",    "Lippfisch",       "common",    22,  "#3fa66b", "#b0f0c8", "#e55d8a", 0.8, 0.9, 1.2, 0.2, 0.7, 0.2, 1, 1.1, "dashes"],
  ["falterfisch",  "Falterfisch",     "common",    25,  "#ffd23a", "#fff2b0", "#222222", 0.7, 1.2, 1.2, 0.2, 0.7, 0.1, 0.5, 1.0, "spots"],
  ["riffbarsch",   "Riffbarsch",      "common",    18,  "#3b6fd6", "#9fc0ff", "#26499a", 0.6, 1.0, 1.5, 0.2, 0.7, 0.05, 0.3, 1.0, "none"],
  ["doktorfisch",  "Doktorfisch",     "uncommon",  45,  "#1f6fe0", "#7fc4ff", "#ffd23a", 0.8, 1.1, 1.4, 0.2, 0.7, 0.2, 1, 1.4, "none"],
  ["kofferfisch",  "Kofferfisch",     "uncommon",  50,  "#f0c419", "#fff2a8", "#222222", 0.7, 1.1, 0.5, 0.3, 0.9, 0.2, 1.5, 1.2, "puffer"],
  ["drueckerfisch","Drückerfisch",    "uncommon",  55,  "#5a8aa8", "#ffd97a", "#2e5570", 0.9, 1.2, 1.0, 0.3, 0.8, 0.5, 3, 1.6, "spots"],
  ["papageienfisch","Papageienfisch", "uncommon",  60,  "#2fbf9f", "#ff8ac2", "#1f8fbf", 1.0, 1.0, 1.0, 0.2, 0.8, 1, 5, 1.5, "scales"],
  ["kaiserfisch",  "Kaiserfisch",     "rare",      150, "#2a3b8f", "#ffd23a", "#5ad4ff", 0.9, 1.2, 1.0, 0.2, 0.7, 0.5, 2, 1.8, "stripes"],
  ["feuerfisch",   "Feuerfisch",      "rare",      180, "#c0392b", "#f5c6a0", "#7a1f16", 0.9, 1.1, 0.7, 0.3, 0.8, 0.5, 2, 2.0, "puffer"],
  ["barrakuda",    "Barrakuda",       "rare",      200, "#8fa3b3", "#e8eef2", "#5f7383", 1.9, 0.5, 2.0, 0.1, 0.5, 3, 20, 2.6, "teeth"],
  ["blauring",     "Blauring-Oktopus","rare",      300, "#c9b56a", "#e8dca8", "#1f6fe0", 0.7, 0.8, 0.6, 0.7, 1.0, 0.05, 0.3, 1.7, "octopus"],
  ["perlmuschel",  "Perlmuschel",     "rare",      300, "#b8a48c", "#e6d8c4", "#8a7a66", 0.7, 0.8, 0.05, 0.95, 1.0, 0.3, 1, 0.5, "shell"],
  ["zackenbarsch", "Zackenbarsch",    "epic",      550, "#6b4a3a", "#c9a88a", "#4a3328", 1.8, 1.1, 0.7, 0.6, 1.0, 20, 150, 3.2, "spots"],
  ["schildkroete", "Meeresschildkröte","epic",     700, "#4a7a5a", "#c9d9b0", "#6a8a4a", 1.4, 0.9, 0.6, 0.1, 0.7, 40, 150, 2.4, "turtle"],
  ["riffhai",      "Riffhai",         "epic",      900, "#7a8a96", "#e6edf3", "#556370", 2.2, 0.8, 1.5, 0.2, 0.7, 20, 80, 3.5, "shark"],
  ["manta",        "Mantarochen",     "legendary", 2500,"#2a3a4a", "#e6edf3", "#1a2530", 2.6, 1.2, 1.0, 0.1, 0.6, 500, 1500, 3.8, "ray"]
]);

S("tiefsee", [
  ["laternenfisch","Laternenfisch",   "common",    40,  "#4a5a7a", "#9fd8ff", "#3a4660", 0.6, 0.8, 1.2, 0.2, 0.7, 0.02, 0.1, 1.0, "glow"],
  ["grenadier",    "Grenadierfisch",  "common",    45,  "#6a6a7a", "#b8b8c8", "#4a4a58", 1.6, 0.5, 0.7, 0.6, 1.0, 0.5, 4, 1.3, "none"],
  ["beilfisch",    "Beilfisch",       "uncommon",  90,  "#c8d0dc", "#ffffff", "#8a94a4", 0.6, 1.3, 1.0, 0.2, 0.7, 0.02, 0.1, 1.2, "glow"],
  ["blobfisch",    "Blobfisch",       "uncommon",  120, "#e8b4c0", "#f6d6dc", "#c8909c", 0.9, 1.0, 0.3, 0.85, 1.0, 1, 5, 0.8, "blob"],
  ["tiefseequalle","Tiefsee-Qualle",  "uncommon",  100, "rgba(255,120,200,0.7)", "#fff", "rgba(255,120,200,0.6)", 0.9, 1.0, 0.25, 0.1, 0.7, 0.5, 4, 0.8, "jelly", { glow: true }],
  ["riesenassel",  "Riesenassel",     "uncommon",  110, "#8a8a80", "#c8c8be", "#5a5a52", 1.0, 0.8, 0.3, 0.92, 1.0, 0.5, 2, 1.4, "crab"],
  ["fangzahn",     "Fangzahnfisch",   "rare",      240, "#2e2e3e", "#6a6a80", "#1e1e2a", 0.7, 1.1, 1.0, 0.5, 0.9, 0.2, 1, 2.1, "teeth"],
  ["viperfisch",   "Viperfisch",      "rare",      250, "#1f3b4a", "#5fb8c8", "#12262f", 1.5, 0.5, 1.4, 0.3, 0.8, 0.3, 2, 2.4, "teeth", { glow: true }],
  ["gespenster",   "Gespensterfisch", "rare",      260, "#8fb8c8", "#e0f4ff", "#5f8896", 0.8, 0.9, 0.8, 0.3, 0.8, 0.1, 0.5, 1.8, "glow"],
  ["pelikanaal",   "Pelikanaal",      "rare",      280, "#1a1a2a", "#3a3a55", "#101018", 2.2, 0.4, 0.8, 0.5, 1.0, 0.5, 3, 2.3, "lure"],
  ["drachenfisch", "Schwarzer Drachenfisch", "rare", 300, "#151520", "#3a3a4a", "#0d0d14", 1.4, 0.5, 1.2, 0.4, 0.9, 0.2, 1, 2.5, "lure"],
  ["seeteufel",    "Seeteufel",       "epic",      700, "#3a3a4a", "#7a7a8a", "#26262f", 1.4, 1.3, 0.5, 0.8, 1.0, 5, 40, 3.0, "lure"],
  ["vampirtinten", "Vampirtintenfisch","epic",     800, "#7a1f2e", "#c04a5a", "#4a0f18", 0.9, 0.8, 0.8, 0.5, 0.9, 0.3, 1.5, 2.6, "squid", { glow: true }],
  ["koboldhai",    "Koboldhai",       "legendary", 3500,"#d9a0a8", "#f2d0d4", "#a87078", 2.6, 0.7, 1.0, 0.6, 1.0, 100, 250, 3.9, "shark"],
  ["riesenkalmar", "Riesenkalmar",    "legendary", 4000,"#8a2a3a", "#c05a6a", "#5a1a24", 3.2, 0.8, 0.9, 0.4, 0.9, 200, 500, 4.0, "squid"],
  ["taucherstiefel","Taucherstiefel", "common",    2,   "#2a3a4a", "#2a3a4a", "#1a2530", 0.9, 1.0, 0.2, 0.9, 1.0, 1, 3, 0.5, "boot", { junk: true }]
]);

S("arktis", [
  ["stint",        "Stint",           "common",    9,   "#a8b8c8", "#eef4f8", "#7a8a9a", 0.7, 0.6, 1.4, 0.1, 0.6, 0.05, 0.2, 0.8, "none"],
  ["lodde",        "Lodde",           "common",    12,  "#8fa8b8", "#e6f0f6", "#5f7888", 0.8, 0.6, 1.5, 0.1, 0.6, 0.05, 0.3, 0.9, "none"],
  ["polardorsch",  "Polardorsch",     "common",    20,  "#7a8a7a", "#d8e0d8", "#566456", 1.0, 0.8, 1.0, 0.3, 0.9, 0.3, 2, 1.2, "spots"],
  ["gefroren",     "Gefrorener Fisch","common",    4,   "#8fa0b3", "#e9eef3", "#6a7a8a", 0.9, 0.9, 0.15, 0.2, 0.8, 0.5, 2, 0.4, "frozen", { junk: true }],
  ["kabeljau",     "Kabeljau",        "uncommon",  55,  "#8a7a5a", "#e2d9c2", "#66593e", 1.3, 0.85, 1.0, 0.5, 0.95, 2, 25, 1.9, "spots"],
  ["seesaibling",  "Seesaibling",     "uncommon",  60,  "#3f5a6a", "#ff9a5c", "#2c4250", 1.0, 0.8, 1.4, 0.3, 0.8, 0.5, 6, 1.7, "spots"],
  ["seeskorpion",  "Seeskorpion",     "uncommon",  70,  "#7a5a3a", "#c8a880", "#4a3520", 0.9, 1.1, 0.6, 0.8, 1.0, 0.3, 2, 1.8, "puffer"],
  ["eisfisch",     "Eisfisch",        "rare",      200, "#dfefff", "#ffffff", "#a8c8e0", 1.1, 0.7, 1.0, 0.4, 0.9, 0.5, 3, 2.0, "glow"],
  ["arktislachs",  "Arktischer Lachs","rare",      220, "#9fb0c0", "#f0b8a0", "#6f8090", 1.4, 0.8, 1.6, 0.1, 0.6, 3, 20, 2.5, "dashes"],
  ["seewolf",      "Seewolf",         "rare",      250, "#5a6a7a", "#b8c4cc", "#3e4a56", 1.6, 0.7, 0.9, 0.7, 1.0, 5, 20, 2.7, "teeth"],
  ["koenigskrabbe","Königskrabbe",    "epic",      600, "#c0392b", "#e8907a", "#8a2a20", 1.2, 1.0, 0.3, 0.92, 1.0, 3, 12, 2.6, "crab"],
  ["heilbutt",     "Heilbutt",        "epic",      800, "#5a6a5a", "#e8e8d8", "#3e4a3e", 2.2, 1.2, 0.5, 0.85, 1.0, 30, 200, 3.4, "flat"],
  ["pinguin",      "Verirrter Pinguin","epic",     100, "#1a1a2e", "#ffffff", "#ff9f1c", 0.9, 1.0, 1.2, 0.05, 0.4, 3, 6, 2.2, "penguin", { junk: true }],
  ["groenlandhai", "Grönlandhai",     "legendary", 5000,"#5a6068", "#b8bcc2", "#3e444a", 3.4, 0.9, 0.35, 0.7, 1.0, 400, 1000, 4.0, "shark"]
]);
```

DE names + trivia are the *source of truth* (`trivia.js:1-118`, `locations.js`, `fish.js`); EN names come from
`i18n.js` lines 209–224 (`Object.assign(I18N.dict, {...})`, exact-string dictionary keyed by the German UI text —
the game never stores an English name field, it translates the rendered string at draw time via `I18N.translate()`);
EN trivia is a hand-written parallel dict, `trivia_en.js:1-130` (`TRIVIA_EN`), selected by `triviaFor(sp)`
(`trivia.js:117-120`) when `I18N.lang === "en"`.

---

## 2. Body rendering: generic fish anatomy + all 20 non-fish body types

Every creature — fish or otherwise — is drawn by one dispatcher, **`drawFishShape(c, sp, x, y, L, dir, tail, opts)`**
in `fish.js` (lines 444–735). It is called with the world context `c`, the species object `sp`, screen position
`x,y`, half-body-length `L` (already includes `fishUnit(f) = 18 * sp.len * scale * uiScale() * (1 - 0.3*z)`,
`fish.js:98`), a signed direction `dir` (−1..1, fractional while turning), a phase float `tail`, and an `opts` bag
(`alpha, glow, halo, shiny, haze, hazeColor, deepSheen, caustic, ct, wx, silhouette, silhouetteColor, ohneSchein`).

Dispatch order inside `drawFishShape` (fish.js:498–511):
1. `opts.haze > 0.01` → recurse: draw the real fish once, then draw a same-shaped silhouette over it (depth fog, §6).
2. `sp.pattern === "boot"` → `drawBoot()`, return.
3. `sp.pattern === "bottle"` → `drawBottle()`, return.
4. `sp.pattern === "chest"` → `drawChest()`, return.
5. `CREATURE_DRAW[sp.pattern]` exists → call it (creatures.js body types, §2.2), return.
6. Otherwise → the generic fish body (§2.1) runs inline, with `sp.pattern` only switching the *surface decoration*.

`fishUnit()`/`L` scale everything; two shared half-extents are computed once: `Hh = L * sp.h * 0.5` (half body
height) and a squash factor `dsc = clamp(dir, min-magnitude 0.12)` applied via `c.scale(dsc, 1)` — this is how a
turning fish narrows to an edge-on silhouette instead of instantly flipping.

### 2.1 Generic fish body (`fish.js:444-735`) — used by patterns `none, glow, whiskers, moon, koi, puffer, shark,
teeth, lure, scales, stripes, spots, dashes, frozen` (i.e. every species not in `CREATURE_DRAW` and not `boot/bottle/chest`)

Silhouette body path, shared by every fish (`fishBodyPath(c, L, Hh)`, fish.js:329-338): a closed Bézier outline —
snout at `(L, 0)`, back arches to `(-L*0.1, -Hh*0.94)` via two cubic curves, tail root narrows to `(-L*0.9, ±Hh*0.26)`
via a quadratic, belly mirrors the back. All patterns/props are placed relative to this same shape, so `±L`/`±Hh`
stay the anchor points for eye, teeth, fins, etc. across every species.

Draw order for one fish (all offsets are multiples of `L`/`Hh`, i.e. proportional to body size, so every species
uses the exact same code with different `len/h/color/belly/fin`):

1. **Light behind the fish** (`drawFishGlowBehind`, fish.js:340-370) — drawn *before* the turn-squash so it stays
   circular: deep-sheen halo (`opts.deepSheen`, radius `1.5L`) for non-glowing fish in dark water, or the glow halo
   (`opts.halo && opts.glow`, radius `2.8L`, or `3.4L` + offset for `lure` pattern) for glowing species — see §4/§6.
2. `c.scale(dsc, 1)` — apply turn squash from here on.
3. Shiny tint (`opts.shiny`): `c.filter = "hue-rotate(150deg) saturate(1.7) brightness(1.15)"` + a `#ffe680` shadow
   blur of `0.9L` — see §4.
4. **Tail fin**: forked, `tw = sin(tail) * Hh * 0.45` controls fan spread; drawn as a gradient (`fin` color fading to
   35–50% transparent at the fin tips, membrane look) with 3 fin-ray strokes if `L >= 9` ("fine" detail threshold).
5. **Dorsal fin**: fixed quadratic-curve triangle leaning backward, no animation.
6. **Anal fin**: small fixed triangle under the tail root.
7. **Far pectoral fin** (the one on the averted side, drawn small/dark/behind body): rotation
   `0.9 + sin(tail*0.9 + 2.6) * 0.22`, filled with `shadeColor(fin, -0.4)` at 75% alpha.
8. **Body fill**: linear gradient top→bottom: `shadeColor(body,-0.14)` → `body` (42%) → `belly` (78%) →
   `shadeColor(belly,-0.05)`; filled into `fishBodyPath`.
9. **Volume shading**, clipped to the body path (fish.js:557-596):
   - Core shadow band just above the belly edge (`rgba(8,14,24, up to 0.15)`), NOT at the very edge — reads as
     roundness rather than an edge line.
   - "Bounce light" gradient below that (`rgba(165,215,235, up to 0.24)`) simulating light reflected off sand/water.
   - A **traveling gloss** highlight: radial gradient centered at
     `gx0 = L*0.1 + sin(tail*0.55) * L*0.24` — this is the "glint that runs along the back as the fish undulates."
   - Lateral line: one quadratic stroke, `rgba(0,0,0,0.14)`.
   - Body caustics (only if `opts.caustic > 0.03` and `L >= 9`) — see the dedicated `drawFishCaustics` note in §6.
   - Gill cover (only if `L >= 9`): a soft-shadowed ellipse arc behind the head plus a highlighted stroke in front
     of it.
   - Soft outline stroke around the whole body, 50% alpha.
10. **Pattern overlay**, clipped to the body path (fish.js:598-650) — this is the only step keyed on `sp.pattern`:
    - `stripes`: 5 vertical bars, `rgba(0,0,0,0.22)`.
    - `spots`: 7 circles in a sine-wavy row, `rgba(220,90,90,0.55)`.
    - `dashes`: 6 short horizontal bars, `rgba(230,230,160,0.4)`.
    - `scales`: 4 rows × 6 arcs (scallop arcs), `rgba(0,0,0,0.15)` stroke.
    - `moon`: two overlapping circles (white disc + body-color crescent) — a moon-phase icon on the flank.
    - `koi`: two colored blotches (`fin` color) + a black "eye" dot — Kohaku/Sanke-style patches.
    - `puffer`: 3×3 grid of dots, `rgba(90,70,20,0.35)` (body texture only; spikes are drawn separately, step 12).
    - `shark`: 3 concentric arc strokes near the gill — gill-slit suggestion.
    - `teeth` / `lure`: a single dark rectangle across the snout (shading before the maw is drawn in step 12).
    - `none`, `glow`, `whiskers`, `moon`(handled above), `frozen`: **no overlay** — plain gradient body. (`glow`
      species rely entirely on the halo/shadow glow for their look; `frozen` gets an ice-block overlay *after*
      everything else, step 15.)
11. **Standard mouth** (small curved stroke) — only drawn if the species does NOT have a predator maw
    (see step 12), i.e. `pattern` is not `shark`/`teeth`/`lure`.
12. **Extras outside the body outline** (fish.js:655-679):
    - `puffer`: 14 radial spike strokes around the ellipse (`sp.fin` color).
    - `shark`: a tall triangular dorsal fin spike (`-2.2 Hh` tall) plus the shared predator maw.
    - `shark`/`teeth`/`lure`: **`drawMaw()`** (fish.js:743-782) — a proper jaw, not floating teeth: upper-lip/
      lower-jaw quadratic curves define a gape (`teeth`=0.24·Hh, `shark`=0.32·Hh, `lure`=0.42·Hh), filled with a
      dark-red→near-black gradient "throat", then 4–6 upper teeth + 3–5 shorter lower teeth as triangles placed
      *along* the lip curve (`qU(t)` Bézier sampling, not a straight line) and clipped to the mouth shape, then a
      lip-edge stroke drawn **over** the tooth roots so teeth read as embedded in the jaw.
    - `lure` only: a curved fishing-rod stroke from the head to a glowing bulb (`shadowBlur = 0.6L`, `#c8fff0`
      fill) — the anglerfish/dragonfish/gulper-eel lure.
13. **Near pectoral fin** (visible side, drawn last so it's on top): first casts a soft shadow onto the body
    (drawn clipped to the body path, `rgba(0,12,22,0.22)`), then the fin itself is drawn with rotation
    `finRot = 0.35 + sin(tail*0.9 + 1.2) * 0.3` and a gradient from full `fin` color to 50% transparent at the tip.
14. **Whiskers** (`pattern === "whiskers"` only — wels/zwergwels/riesenwels/quappe): two curved strokes from the
    snout, animated with `sin(tail)` on the longer one.
15. **Eye**: eye-socket shadow ellipse, white sclera, colored iris (`shadeColor(fin,-0.15)`, only if `L>=9`), black
    pupil, and a white highlight dot (only if `L>=9`).
16. `frozen` overlay (`drawFrozenOverlay`, fish.js:794-807) — drawn last, on top of everything: a rounded
    semi-transparent ice-blue rounded rect over the whole fish with two diagonal "crack" strokes and one white
    corner highlight triangle. Only species: `gefroren`.

### 2.2 Non-fish body types — `CREATURE_DRAW` dictionary (`creatures.js:1-808`, full file)

Shared helpers used by every entry (creatures.js:1-38): `cGrad(c,col,y0,y1)` (top-dark→bottom-light linear
gradient using `col.body`/`col.belly`, or flat `col.body` if `col.sil` — the depth-fog silhouette flag), `cOutline`
(soft stroke at `shadeColor(body,-0.4)`, default 55% alpha), `cEye` (white sclera + dark pupil + highlight dot,
skipped entirely if `col.sil`), `cGloss` (a soft white ellipse highlight).

Every entry has signature `(c, L, Hh, tail, col)` where `col = {body, belly, fin, sil}` — same call convention as
the generic fish body, drawn around local origin `(0,0)` with head toward `+x`.

| body type (`pattern` key) | species using it | shape summary | animated per frame (formula) |
|---|---|---|---|
| `octopus` | oktopus, blauring, kraken (boss) | 8 tapering arm bands with 4 suction-cup dots each, radial mantle/head ellipse with skin-wart texture, horizontal-pupil eyes | each arm sways independently: `sway_i = sin(tail*1.4 + i*0.8) * L*0.3`, arm length `len_i = Hh*(1.35 + sin(i*1.7)*0.25)` |
| `squid` | tintenfisch, riesenkalmar, vampirtinten | rear stabilizer fins, pointed mantle, 7 tentacle strokes forward, single large eye | fins: `fl = sin(tail)*Hh*0.22`; tentacles: `w_i = sin(tail*2 + i) * L*0.18` (each tentacle bows independently) |
| `jelly` | qualle, tiefseequalle | translucent bell (radial gradient core + edge light-rim + inner "stomach thread" strokes), 7 tapering tentacle ribbons, 12 short edge fringes | pulse drives bell shape itself: `pulse = sin(tail*0.8)`, bell radius `R = L*0.82*(1+pulse*0.09)`, bell height `bellH = Hh*(1.05 - pulse*0.12)` (contracts taller when pulsing); tentacles sway `sin(tail*1.1 + i*0.9)`; fringes wag `sin(tail*2+i)` |
| `crab` | krabbe, hummer, riesenassel, koenigskrabbe | 6 jointed legs (2 segments each), domed carapace with ridge/highlight, 2 claws, 2 stalked eyes | legs kick: `k = sin(tail*3 + i + sideOffset) * L*0.09`; claws swing: `o = sin(tail*2 + sideOffset) * 0.18` |
| `ray` | rochen, manta | wide diamond wing pair, whip tail with stinger, manta-pattern light spots, gill slits, small eye | wing flap: `flap = sin(tail)*Hh*0.35`; tail whip: two independent sines (`sin(tail*1.5)`, `sin(tail)`) |
| `turtle` | schildkroete | 2 flippers + 2 rear flippers, oval head, domed shell with 3 vertical scute outlines + 2 horizontal seams | flipper stroke: `k = sin(tail)*L*0.16`, front/rear flippers move in opposing phase |
| `flat` | scholle, heilbutt | top-down flounder: fin-fringe halo ellipse, body ellipse, tail wedge, both eyes on ONE side (the defining flatfish trait) | body wobble: `w = sin(tail)*Hh*0.16`, offsets body/tail/spot rows together |
| `seahorse` | seepferdchen | S-curve body drawn as a thick rounded stroke, dorsal-crest ribbon, angled snout, curled tail tip, body rings, crown spikes | tail curl: `curl = sin(tail)*Hh*0.22`; crest ripple: `sin(tail*3)*Hh*0.15` |
| `star` | seestern | 5-armed soft-edged star with radial-gradient body, per-arm ridge highlight + suction-foot dots along each arm | whole shape rotates slowly: `rot = tail*0.1` (arms and every ridge/foot follow) |
| `shell` | perlmuschel | bottom shell half + hinged top shell half (rotates open around the hinge point) with a radial-gradient pearl inside, radiating growth-line strokes | opening angle: `open = 0.25 + max(0, sin(tail*0.5))*0.35` |
| `penguin` | pinguin (bycatch) | upright body (rotated 90°+wobble so "swimming" reads as tobogganing), white belly patch, orange beak/feet, two flippers front+back | whole body tilt: `0.9 + sin(tail*0.5)*0.1`; flippers flap: `sin(tail*3)*0.22` |
| `serpent` | nessie (boss), leviathan (boss) | the "Nessie" rig: 3 separate humps (Bézier-curve backs with crest spikes placed *on* the curve via derivative sampling, not guessed), tapering neck (quadratic Bézier with belly-scale arcs + neck crest spikes), horned head with reptile eye, submerging tail tip, water rings at each hump's waterline | each hump bobs independently: `by_i = sin(tail*0.9 + i*1.2)*Hh*0.12`; neck sways: `sin(tail*0.7)*Hh*0.12`; tail tip: `sin(tail)*Hh*0.3` |
| `weed` | seetang (bycatch) | 5 tapering kelp strands (gradient dark-green→light-green stroke) with 2 leaf blobs each | each strand sways independently, phase-offset by index: `sway_i = sin(tail*0.8 + i)*L*0.4` |
| `blob` | blobfisch | droopy gelatinous body (radial gradient), hanging bulbous "nose", drooping tail fin, sad eyebrows + frown mouth | body sags: `sag = sin(tail*0.7)*0.06`, applied to the belly-curve control points |

Every `CREATURE_DRAW` entry independently re-implements gradient/outline/eye via the shared helpers rather than
reusing the generic fish's fin/eye code — there is **no shared body-part library** across the two systems; a GPU
atlas rebuild should treat "generic fish" and "the 14 creature types" as two separate rigs/atlases, not one
parameterized fish skeleton.

### 2.3 Junk / bycatch shapes (short-circuit before both of the above, `fish.js:783-853`)

- `drawBoot(c, L, sil, silCol)` — a boot silhouette (fixed polygon), sole rectangle, 3 lace strokes. Static, no
  `tail` parameter passed through to any motion (only used for silhouette re-draw, not for a swim animation).
- `drawBottle(c, L, sil, tail, silCol)` — rounded bottle body + neck rect + cork rect + rolled paper note with 3
  "handwriting" lines + a glass-highlight strip. Animated: whole bottle rocks, `c.rotate(sin(tail*0.3)*0.25 + 0.9)`.
- `drawChest(c, L, sil, silCol)` — wooden base + domed lid, gold trim bands/hinges, a keyhole, and a glowing gold
  highlight strip along the seam (`shadowBlur = 0.6L`). Static, no animation.

---

## 3. Swim AI (`fish.js:143-236`, function `updateFishes(dt)`)

**Per-fish state machine**: `f.state` ∈ `"roam" | "attracted" | "biting" | "hooked" | "fleeing"`.

**Spawn** (`createFish`, fish.js:79-96): random `scale` 0.8–1.3, random depth within `species.depth` band mapped to
a screen Y via `depthToY(d)` (fish.js:60-64: lerp between `horizonY + canvas.height*0.07` and either
`bottomBarY()-60` on phones or `canvas.height*0.94` on desktop), random initial `dir` (±1), spawned either off one
screen edge (`fromEdge=true`, x = -80 or width+80) or anywhere on screen (initial fill only). Initial velocity
`vx = dir * species.speed * 40`. **Shiny roll happens at spawn** (§4). 2.5D pseudo-depth `z` is rolled here too
(§6). Bosses always spawn patrolling (`bossPatrol = !!species.boss`).

**Species selection** (`pickSpecies`, fish.js:66-78):
- 50% chance per tick to force-spawn the location's boss IF `bossUnlocked(here)` (non-boss dex 100% complete for
  this location) AND no boss is currently present/fleeing.
- Otherwise builds `pool = SPECIES.filter(s => s.loc.includes(here) && (!s.night || isNight) && !s.boss)` and does a
  weighted random pick where weight starts at `RARITY[rarity].weight` (50/24/10/3.5/1 for
  common/uncommon/rare/epic/legendary) and is then multiplied by:
  - `bait.rareMult` for rare+ (idx≥2), further `× 2` during golden hour, `× 2` if the "magnet" totem is active,
    `× talentMult("glueck", 0.08)` per talent rank.
  - legendary (idx=4) additionally gets `w = sqrt(w) * 0.8` — dampens how much a great bait can inflate a
    legendary's odds.
  - uncommon (idx=1) gets a smaller slice of the bait bonus: `× (1 + (bait.rareMult-1)*0.4)`.
  - `night: true` species get `× 2.2` (on top of already being filtered to night-only when it's night).
  - junk species get a fixed override weight instead of the rarity table: `stiefel=5`, `schatzkiste=1.2`,
    `pinguin=0.8`, everything else junk `=3`.

**Roam** (fish.js:180-203): every `rand(0.8, 2.5)` s picks a new velocity (`base = speed*45*uiScale()`, 60% chance
of full-speed horizontal cruise, else a slower/more-vertical drift); softly clamps back into its own depth band
(`sp.depth[0..1]` via `depthToY`, a spring-like `vy += 30*dt*4` push when outside); off-screen fish (unless a
patrolling boss) are despawned and will be replaced by the spawn-timer, not repositioned. **Boss patrol**: instead
of leaving the screen, a boss bounces off screen edges (`L*1.5` margin) and has a speed floor
(`15 * uiScale()`), staying visible.

**Attraction** (fish.js:158-176, only while `gameState==="waiting"` and the hook is in water): within
`attractRadius = max(canvas.width, canvas.height*0.85) * rod.radius * talentMult("auge", 0.08)` (bosses get ×1.6 and
have priority — a non-boss fish cannot become attracted while a boss is present), a roaming fish rolls into
`"attracted"` at rate `0.55 * rarityPenalty * bait.rate * waitBoost * talentMult("geduld", 0.10)` per second, where
`rarityPenalty = boss?1.5 : [1, 0.7, 0.45, 0.3, 0.2][rarityIdx]` (rarer fish are harder to attract) and
`waitBoost = (waiting? 1+waitTime/6 : 1) * (rain? 1.6:1) * (goldenHour? 1.3:1) * onboardingBoost * (totem"lockruf"?2:1)`
(`onboardingBoost = 5` for the player's first two catches, else 1 — a deliberate "don't make the first bite take
20s" ramp). Once attracted, velocity lerps toward the hook (`lerp(vx, dir_to_hook * speed*70*uiScale(), dt*3)`);
inside `70*uiScale()` px of the hook it may "nibble" (`Math.random() < dt*2.5` → `nibble=0.35` pose twitch + tick
sound + haptic + ripple FX); inside `14*uiScale()` px it calls `startBite(f)` (script.js) which flips `gameState`.
An attracted fish that stops meeting the water-hook condition reverts to `"roam"`.

**Biting** (fish.js:206-210): fish snaps to hover at the hook with a small sine jitter
(`x = hookX + sin(age*25)*3`, `y = hookY + 6*uiScale()`), tail beats fast (`+= dt*20`), facing whichever side of
the screen the hook is on.

**Hooked** (fish.js:211-217, during the reel minigame): jitter magnitude lerps toward 4 (or 12 during a reel
"burst") at `dt*4`; fish trails behind the hook's recent horizontal movement direction, offset
`(dir*10*uiScale() + sin(age*31)*jitter, 8*uiScale() + cos(age*23)*jitter*0.6)`; tail beats fastest (`+=dt*25`).

**Fleeing** (fish.js:218-224, after a failed catch/escape): velocity lerps hard toward
`dir * speed*260*uiScale()` (`dt*6`) plus a downward `vy→60` drift (`dt*3`), `alpha -= dt*0.9` (fades out), removed
once transparent or off-screen.

**Turn smoothing** (fish.js:150): `f.turn = lerp(f.turn ?? f.dir, f.dir, min(1, dt*6))` — this is the value fed to
`drawFishShape`'s `dir` parameter as the squash factor, independent of the tail-phase animation, so a fish visually
turns over a few frames instead of instantly flipping.

**Tail phase advance** (fish.js:149): `f.tail += dt * (4 + swimSpeed*0.08)` in normal states — i.e. tail beat rate
scales with current speed on top of a 4 rad/s base; overridden to fixed `dt*20` (biting) / `dt*25` (hooked) in
those states.

**Spawn count / respawn** (fish.js:100-102, 227-234):
`targetFishCount() = (isNarrow()?8:11) + 2 * indexOfCurrentRod` — better rods (further in `RODS[]`) keep more fish
on screen simultaneously. `spawnInitialFish()` clears and refills to that count on location/rod change (also clears
the sprite cache, §5). Each frame, if `fishes.length < target`, a countdown timer (`rand(0.6, 2.2)` s) spawns one
more fish from the edge; if it rolled a boss species, `bossArrives(f)` (fish.js:238-244) additionally forces it to
enter from a screen edge at mid-depth, plays a cutscene (`startCutscene`), and shows a toast after the cutscene
duration.

**Background/ambient fish** (fish.js:246-283) are a *separate, non-interactive* system: up to 8 fake fish
(`AMBIENT_SPECIES` stub — no real species, always flat dark color) spawn in loose 1- or 3-fish "schools" at
`Math.random()<dt*0.5`, drift at `rand(14,32)` px/s with a small sine bob, always drawn as silhouettes (§6), never
attracted/caught, and are suppressed entirely in the `tiefsee` (deep-sea) location in favor of `drawDeepSpecks()`
(locations.js:491-500, 60 twinkling bioluminescent dots).

**Alternate interaction mode — deep-sea harpoon** (`dive.js`, not part of fish.js but changes how a fish enters
"hooked" state): in the `tiefsee` location (`mode:"dive"`), there is no cast/wait loop — the player aims and fires a
harpoon (`shootHarpoon`→`updateHarpoon`), which travels in a straight line and hit-tests every fish in `fishes[]`
(`Math.hypot(f.x-h.x, f.y-h.y) < fishUnit(f)*0.55+6`, dive.js:65-70); the first fish hit is handed to the exact same
`bitingFish`/`gameState="biting"`→`startReeling()` pipeline as a normal bite, so rod stats, hooked-state rendering,
and the reel minigame are unchanged — only the *approach* to reaching "biting" differs.

**Fisch-in-Fisch (bonus catch)** (`script.js:805-819`, not fish.js — a post-catch mechanic worth documenting here
since it's fish-species-driven): after landing one of 15 hardcoded predator species (`hecht, zander, wels, urhecht,
riesenwels, barrakuda, thunfisch, seeteufel, hai, riffhai, muraene, seewolf, rapfen, wolfsbarsch, piranha`), there's
an 18% chance (`Math.random() < 0.18`) of a bonus smaller fish "found inside": picked from
`SPECIES.filter(loc-match && !junk && !boss && rarityIdx<=1 && len < predator.len*0.7)`, awarded as an instant
second catch (own weight roll, own dex record, 80%-value coin bonus) shown 900ms later with its own toast/SFX and
unlocking the `fischinfisch` achievement.

---

## 4. Shiny fish

**Roll** — happens once, at spawn, for every non-junk, non-boss fish (fish.js:87):

```js
shiny: !species.junk && !species.boss && Math.random() < (totemActive("glueck") ? 4 : 1) * talentMult("glueck", 0.25) / 80
```

Base probability is **1/80 = 1.25%** per spawned fish. `talentMult(id, per) = 1 + talentRank(id) * per`
(`talents.js:12`), so each rank of the "glueck" (luck) talent adds `0.25/80 = +0.3125` percentage points
(additively to the multiplier, i.e. rank 1 → `1.25 × 1.3125` ≈ 1.64%, not a flat +0.25%). The "glueck" totem
(`totemActive`, `gems.js`) is a hard `×4` while active, making the roll ≈5%+ . A shiny fish also gets its 2.5D depth
bias reduced (`f.z *= 0.3`, fish.js:96) so shinies aren't hidden in the depth-fog haze (§6).

**Visual transform** (`drawFishShape`, fish.js:474-477, applied only if `opts.shiny && !opts.silhouette`):
```js
if ("filter" in c) c.filter = "hue-rotate(150deg) saturate(1.7) brightness(1.15)";
c.shadowColor = "#ffe680"; c.shadowBlur = L * 0.9;
```
A CSS `hue-rotate(150deg)` recolor of the *entire* fish (not a fixed palette swap — any species can go shiny and
the hue shift is applied uniformly) plus a warm gold ambient shadow blur.

**Sparkle FX** (`drawSparkles`, fish.js:335-345): drawn separately, on top, only in the live scene (called from
`drawFishes()`, not baked — see §5): 4 rotating 4-pointed "diamond" sparkles orbit the fish at radius
`fishUnit(f)*1.3`, position `angle = age*1.5 + i*1.57` (evenly spaced, slowly rotating), each pulsing in size/alpha
via `k = 0.5 + 0.5*sin(age*6 + i*2)`.

**Rewards**: coin payout multiplier `×5` (`script.js:780`: `gained = base * mult * (shiny?5:1) * talentMult(...)`);
+1 gem instantly on catch (`script.js:796`); triggers the `"shiny"` hype (slow-mo + zoom + banner, `startHype`,
takes priority over boss/legend/record hype); `save.dex[id].shiny` counter increments (`recordCatch`, shop.js:215-224,
also bumps the global `save.stats.shinies`); the dex tile shows a small sparkle icon (`drawIcon("sparkle", …)`,
draw.js:2497) whenever `entry.shiny` is truthy; unlocks achievements at 1 and 10 shiny catches
(`i18n.js` strings "Es glitzert!" / "Shiny-Jäger").

---

## 5. `sprites.js` — the runtime sprite/atlas cache (713 lines, read in full)

This file is **the single most relevant precedent for the GPU-atlas rebuild** — it is a self-documented history of
three failed and one working caching strategy for exactly this problem ("draw the same fish shape many times per
second cheaply"), written as extensive Rundee-numbered comments in the source. Below is both *how it works* and
*the lessons it states explicitly*, since the task calls for both.

### 5.1 Why it exists (measured, documented at the top of the file)

- Resolution is **not** the cost driver: rendering the scene at 3× vs 1× resolution barely changes frame time
  (5.8ms vs 6.2ms "see", 15.1ms vs 10.5ms "tiefsee") — cost is per **draw call**, not per pixel (gradients, clips,
  state changes).
- Measured per-frame draw-call counts at 1170×2532: fish (`drawFishShape`) are **~40% of all draw calls** at every
  location (2675/6712 at "see", 2007/4574 at "tiefsee", etc.).
- One fish, drawn live, costs ~286 draw calls: 214 for the main body (gradients/clip/volume/fins/pattern/eye),
  47 for the depth-fog silhouette pass (the *same fish redrawn flat-colored* on top — bug #48, see §6), 25 for
  body caustics.

### 5.2 What is cached, and the cache key

Each **(species, size-step, tail-phase-step, flag-combo)** combination is rendered once to an offscreen canvas and
reused thereafter. Cache key: `sp.id + "|" + LC + "|" + stufe + "|" + flaggen` where:
- `LC` = the size step from a **geometric ladder**: `_stufe(L)` (sprites.js:243-248) rounds `L` up to the next rung
  of a ladder with `STUFEN_PRO_OKTAVE = 8` rungs per size-doubling (→ each rung is at most **9.05%** bigger than the
  fish needs, then ceil'd to a whole pixel), capped at `MAX_L = 384` (above that, always drawn live — a fish that
  big fills half the screen and only ever appears once, e.g. a boss fight close-up).
- `stufe` = the tail phase quantized to `PHASEN = 16` steps (`Math.round(phase/2π * 16) % 16`) — a full tail-beat
  cycle plays back at ~16 discrete poses instead of continuously; at a ~1 beat/second cycle this renders the tail at
  ~17fps effectively instead of 60fps, with a visible swing amplitude of about a tenth of the fish's length (a few
  pixels) — judged acceptable, and disableable per the flags below.
- `flaggen` = `(glow?"G":"-") + (shiny?"Y":"-")` — up to 4 image variants per species/size (plain, glow, shiny,
  glow+shiny).

Baking happens in **real device pixels**, not CSS units (sprites.js:539-548): the code reads the canvas's current
transform scale (`c.getTransform()`, hypot of the a/b components), clamps to `[1,3]`, rounds to the nearest 0.5, and
feeds that into the size-ladder lookup — this was a fix for a documented regression (see §5.4, lesson 3).

Bounding box per bake is **measured, not estimated** (`randMessen`, sprites.js:456-499): for each new
species+flag-combo, all 16 tail phases are drawn into a 4×-oversized probe canvas at a fixed reference size
(`MESS_L=48`), then one `getImageData` call finds the union of the non-transparent pixel bounds across *all 16
phases* (+2% padding for rounding). This measurement is rate-limited to **at most once per rendered frame**
(`messErlaubt()`, gated on the global `lastFrame` frame-id counter) — species that haven't been measured yet in the
current frame budget are drawn live that frame and measured (and thus cached) on a subsequent frame. This avoids a
single location-entry frame measuring 6+ new species at once (documented regression: one such frame spiked from
89ms to 213ms before the once-per-frame throttle was added).

**What draws from the cache vs. live, every frame** (`kopiere` + the recolor pass, sprites.js:353-357, 606-679):
1. The wide ambient light behind the fish (deep-sheen shimmer up to `1.5L`, glow halo up to `3.4L`) — drawn live,
   every frame, from `drawFishGlowBehind` — baking it would make the cached image ~7L wide instead of ~3L (10×
   area) for a light effect that only costs 8 draw calls anyway.
2. The cached body image itself — one `drawImage` call (`ctx.drawImage(e.cv, ...)`), replacing the 214 body draw
   calls.
3. Body caustics — drawn live, clipped to `fishBodyPath`, because their phase depends on **world time AND world
   x-position** (`ph = wx*0.035 + ct*0.9 + k*2.09`), so no two fish at any two positions/times would ever share a
   cached frame.
4. Depth-fog silhouette overlay — drawn live too (see §5.4 lesson 4 and §6) as a same-shaped flat-color silhouette
   pass, OR (GPU path only) as a single tinted-quad draw (`Gpu.viereckGefaerbt`) that recolors the cached texture's
   alpha channel via a shader uniform in one call — this is the one place the GPU path is explicitly *cheaper* than
   the Canvas2D cache, not just parallel to it.

**Fallback to the direct/live path** (`roh()`, the original un-cached `drawFishShape`) happens whenever: the cache
is disabled (`?sprites=0` or a runtime toggle), the fish is smaller than `MIN_L = 9`, larger than `MAX_L`/
`MAX_KANTE` (1024px hard cap on the offscreen canvas edge), the destination context has a non-default
`globalCompositeOperation` or an active `shadowBlur` (a baked image can't reproduce those correctly), a silhouette
call (ambient fish / ready-to-render fog pass — cheap enough already, ~47 calls, not worth a whole image), or the
bounding-box measurement for that species+flags hasn't happened yet this frame.

**Cache invalidation / eviction**: `MAX_BYTES = 32 * 1024 * 1024` (32MB) hard cap, evicted LRU (JS `Map` insertion
order = recency, oldest evicted first) whenever a new bake would exceed it. `spawnInitialFish()` is monkey-patched
to call `FishSprites.leeren()` (full clear) before every call — i.e. the cache is fully dropped on every location
change and every rod change (since `targetFishCount()` depends on rod), because the *set of visible species*
changes and old images would just sit there until evicted one-by-one otherwise (documented: 340 evictions measured
across a 6-location loop before this explicit clear was added).

### 5.3 GPU-texture interaction (`_gpuWeg`, sprites.js:237-240)

When the GPU path (`gpu.js`) is active, each baked canvas also has an associated uploaded texture. Eviction from
the sprite `Map` must also call `Gpu.vergiss(cv)` to free that texture — otherwise GPU memory grows unbounded even
though the CPU-side cache respects its 32MB cap.

### 5.4 Lessons explicitly stated in the comments (paraphrased, with the measurements that back them)

1. **Cost is call-count, not pixel-count.** Confirmed by a 1×-vs-3×-resolution A/B that shows near-identical frame
   time — three earlier optimization rounds spent time on resolution/MSAA/upload-path tuning that couldn't have
   worked, because the bottleneck was never there.
2. **First cache attempt baked in CSS pixels, not device pixels.** On a 3×-DPI phone this drew a 32px-wide image
   for a fish whose actual on-screen size was 88px — a 2.75× upscale-then-blur, which is exactly the "fish look
   blurry underwater" bug report that triggered the fix. It looked *worse* than the un-cached path for fine detail.
3. **A "cache a white mask, tint it per-frame" scheme is a trap.** Recoloring a canvas image in Canvas2D requires an
   offscreen scratch canvas (clear → copy in → `source-in` composite → copy out), and that round-trip forces the
   browser to flush all pending draw commands to sync CPU/GPU — measured **11 of 16.7ms** frame budget on an
   iPhone 15 Pro Max for *just the depth-fog recolor step*. Turning the cache off entirely ran at 37fps, *faster*
   than the cached-with-mask version's 33.3fps — proving the recolor trick was net-negative even against zero
   caching. Fixed by drawing the silhouette pass directly (same draw calls as the uncached path, ~47 calls) instead
   of trying to derive it from the cached image.
4. **A fixed 10-rung size ladder (33–37% gaps) forced up to 32% pre-downscale blur**, visibly softening fine
   linework (scale arcs, gill strokes, eye rings) at zoom — replaced with a geometric ladder tuned to a stated
   maximum 9% error (`STUFEN_PRO_OKTAVE`), a deliberate memory-for-sharpness tradeoff, sized to the *actual working
   set* (fish on screen × phase count) rather than the number of distinct sizes that could theoretically occur.
5. **A guessed bounding box was simultaneously too loose and too tight.** Too loose: reserving glow-halo space for
   every glow species even though the halo is never baked (a 32px koi got a 174×142px image, 97% wasted/transparent
   area, still copied+blended every frame). Too tight: `mondfisch` needed 1.75L but only 1.6L was reserved →
   visibly clipped fins. Fixed by measuring instead of estimating (§5.2), and — a second, later refinement —
   measuring the **union across all 16 tail phases**, not just one representative phase plus a fudge factor:
   sampling only one phase clipped `seetang`/`perlmuschel`/`qualle`/`tiefseequalle` in specific poses (worst case:
   164 of 178 pixels on the image edge for `seetang`).
6. **A cache that evicts constantly is worse than no cache.** When the memory cap was left at its old (pre-GPU-era)
   16MB after the world scene moved to always baking at 3×, the cache measured 2.4 evictions + 3.2 new-texture
   misses per second — each miss is a full 286-call redraw *plus* a new GPU texture upload (up to 1.3MB each). The
   fix wasn't a smarter eviction policy, it was raising the cap to fit the measured per-location working set
   (worst location "tiefsee" alone needs 15.9MB) — the file's stated principle throughout is that a thrashing cache
   should be sized to stop thrashing, not tuned around.

### 5.5 What this means for a GPU-atlas rebuild

The old cache is a *runtime, on-demand, per-(species×size×phase×flags) rasterizer* — closer to "lazy sprite-sheet
generation" than to a real pre-built atlas. A proper offline/load-time texture atlas removes problems 2–6 above by
construction (fixed, known resolution; fixed, known phase count; no runtime measurement/throttling needed) but
should keep the *design decisions* those lessons produced:
- Bake tail-phase animation as a **discrete frame strip** (16 phases is the value this game converged on as
  visually sufffient at the game's fish sizes) rather than trying to animate bones/deformation on the GPU per fish.
- Bake glow-halo/deep-sheen and body caustics **separately from the body**, or accept redundant per-frame draws for
  them — they are cheap, wide, soft, and either depend on world time/position (caustics) or would balloon atlas
  cell size for little benefit (halo).
- Depth-fog/distance tinting should be a **shader/material tint on the atlas alpha channel** (exactly what
  `Gpu.viereckGefaerbt` already does as this project's one GPU-native win) — never a CPU offscreen-canvas recolor
  round-trip.
- Still needs a real bounding-box measurement pass (or hand-authored padding with generous, verified margins) per
  sprite — several species in this roster (long fins/tails/tentacles/necks) exceed a naive `len × h` box.

---

## 6. Depth fog / 2.5D far-silhouette fish

Two unrelated systems both create a sense of depth; neither uses real 3D — both are 2D compositing tricks over the
same flat playfield.

### 6.1 Per-fish "haze" (`drawFishes()`, fish.js:246-282, plus the recursive haze branch in `drawFishShape`)

Every real fish carries a scalar pseudo-depth **`z` ∈ [0,1]** (0 = at the play-plane, 1 = far behind it), rolled at
spawn as `Math.pow(Math.random(), 1.6)` (biased toward the front — fewer fish spawn very far back), fixed to `0` for
bosses (always prominent), and reduced to `×0.3` for shiny fish (kept visible, §4). While a fish is `attracted`,
`biting`, or `hooked` it visibly swims forward: `z = max(0, z - dt*1.5)`.

Each frame, `haze` is computed per fish:
```js
let haze = (f.z||0) * (dark ? 0.4 : 0.55)
         + depth * (shaderFog ? 0.06 : 0.2)        // depth = normalized screen-Y between horizon and canvas bottom
         + (1 - light) * (dark ? 0 : 0.06);         // dimmer at night/dusk
haze = clamp(haze, 0, 0.72) * clearWater;            // clearWater = 0.55 in "riff" (clear water), else 1
if (isGlowing(species)) haze *= 0.35;                // glowing fish read through fog better
if (state === "hooked" || state === "biting") haze = 0; // always fully visible once engaged
```
`dark` = the current location's `dark` flag (0 for most, 0.6 for tiefsee, small values elsewhere); `shaderFog` = true
when the GPU/World renderer is active (it already applies its own volumetric depth fog to the whole scene, so the
2D haze layer here only needs to carry the fish-specific `z` contribution, not full screen-depth).

**Critical rendering rule (documented bugfix, referenced as "#48" throughout both `fish.js` and `sprites.js`):**
haze is **never implemented as transparency**. `drawFishShape`'s haze branch (fish.js:498-505) draws the fish
twice: once fully opaque/normal, then a second pass with `silhouette:true` — the *same body silhouette*, flat-
filled with a water-mixed color (`hazeColor`), at `alpha = min(haze, 0.85)` — composited **over** the first pass.
In dark water the fog color is deliberately *lighter* than the fish body (`shadeColor(pal.wTop, 0.3)`) so a fish
never fades toward invisible-black; in lit water it's `lerpColor(pal.wTop, pal.wBot, 0.4 + depth*0.6)` (a blend
toward the ambient water gradient at that screen depth). The stated design intent: distant fish become pale,
fogged *silhouettes*, never see-through — because the deep-sea harpoon aiming (dive.js) requires a distant fish to
still be a legible, clickable shape. (The bug this fixed: an earlier version multiplied THREE factors — depth,
night, flee-alpha — directly into `globalAlpha`, which made a far-away fish genuinely transparent instead of
merely foggy.)

Body caustics dim with both screen depth and `z`: `opts.caustic *= (1 - depth*0.65) * (1 - (f.z||0)*0.5)`.

Fish are depth-sorted before drawing (`fishes.slice().sort((a,b) => (b.z||0)-(a.z||0))`, fish.js:263) so farther
fish (`z` larger) draw first and nearer fish draw on top — the only place `z` affects draw order rather than just
shading.

### 6.2 Ambient background fish (fish.js:246-283) — see also §3

A cosmetically-only school system, separate from `fishes[]`: `AMBIENT_SPECIES` is a stub object (not a real
species — fixed `len:1, h:0.9, pattern:"none"`, `color/belly/fin` all `#0b1c2c`, `kg:[0,0]`), instantiated up to 8
at a time, always rendered with `opts.silhouette = true` and a computed color
`lerpColor(lerpColor(pal.wTop, pal.wBot, 0.5+depth*0.5), "#0b1c2c", 0.35)` — i.e. "mostly water-color, a third of
the way toward near-black," never a hard black cutout. These fish cannot be attracted, bitten, or caught; they
exist purely to keep the mid-background from looking empty. Fully disabled in `tiefsee` (`isDeepSea()` check,
fish.js:252) — that location uses `drawDeepSpecks()` instead (locations.js:491-500): 60 small twinkling cyan dots
(`rgba(120,220,255, 0.15–0.5)`) drifting at varying speed by index, simulating distant bioluminescent plankton
rather than distant fish silhouettes (a deep-sea location has no ambient light source for a silhouette to read
against).

### 6.3 The `silhouette` render path itself (`drawFishShape`, invoked with `opts.silhouette=true`)

When `silhouette` is set, every fill in the generic-fish path and in `CREATURE_DRAW` collapses to a single flat
color (`col.sil` short-circuits `cGrad`/`cEye`/`cOutline` in creatures.js; in fish.js, `body`/`belly`/`fin` are all
overridden to `silhouetteColor` and most per-part gradients/eyes/pattern-overlays are skipped) — this is
deliberately the *cheap* path (~47 draw calls vs ~214), used for both the depth-haze overlay pass and the ambient
background school, and explicitly never cached in `sprites.js` (§5.2) because it's already cheaper than a cached
`drawImage` + recolor would be.

---

## 7. Fischdex (species dex) data model

**Per-species save record** (`save.dex[speciesId]`, written by `recordCatch()` in `shop.js:215-224`):
```js
{ count: number, record: number /* kg, best weight seen */, shiny?: number /* shiny catches of this species */ }
```
First catch of a species creates the entry (`isNew = entry.count === 0` before incrementing) and always counts as
the record; subsequent catches bump `count` and `record = max(record, kg)` (`isRecord = kg > oldRecord && !isNew`,
i.e. a record only fires on a catch AFTER the first). A `shiny` catch also increments the account-wide
`save.stats.shinies`.

**"NEU" (new) badge — separate from "caught"** (`draw.js:1672-1690`): the game tracks a second boolean per species,
`save.seenSpecies[id]`, meaning "the player has opened this species' detail card at least once," independent of
`save.dex[id]` ("has this species ever been caught"). The dex grid badges a tile "NEU" (draw.js:2499) only when
`save.dex[id]` exists **AND** `!save.seenSpecies[id]` — i.e. it marks *freshly caught, not yet reviewed*, not
"never caught." Clicking a tile (`onClick` in `drawDex`) immediately writes `save.seenSpecies[id] = true` and saves.
Navigating pages/tabs calls `flushSeen()` first (draw.js:1681-1686) to commit a `pendingSeen` batch set (fish caught
mid-session are queued there, not written to `save` immediately, to avoid a save-write storm) — this same
`seenSpecies`/`pendingSeen`/badge pattern is reused verbatim for the shop's "NEU" item badges and the achievements
list's "NEU" badges (`isNewItem`, `unseenSpecies`, `badgeCounts`, draw.js/events.js).

**Uncaught species** render as a silhouette fish (`opts.silhouette: !entry, alpha: entry?1:0.5`), name shown as
`"???"`, and — in the detail card (`drawDexDetail`, draw.js:2523-2557) — a generated hint string instead of trivia:
`"Noch nicht gefangen. Suche {surface/mid/bottom}{, nachts} – {location icons/names}.{ + bait hint if rare+}"`.

**Location dex-completion rewards** (`checkDexRewards()`, `progress.js:568-587`), evaluated per location, boss
species excluded from the denominator:
- ≥50% of that location's non-boss species discovered → one-time coin reward `300 * (locationIndex+1)`
  (300/600/900/1200/1500/1800 for see/boot/kueste/riff/tiefsee/arktis).
- 100% discovered → one-time coin reward `1000 * (locationIndex+1)` **+ 3 gems** + a unique cosmetic hat
  (`DEX_HATS = { see:"kranz", boot:"nessiemuetze", kueste:"moewenhut", riff:"blumenkranz", tiefsee:"leuchthelm",
  arktis:"eiskrone" }`) added to `save.owned.hats`. Reaching 100% is also the gate that unlocks that location's boss
  spawning (`bossUnlocked()`, locations.js:59-62, checked live every `pickSpecies()` call, not just at reward time).

**Dex counters used elsewhere**: `dexDiscovered()` (shop.js:229, global count across all 111 species with a
`save.dex` entry) drives the Fischdex screen's header (`"Fischdex N / 111"`); `dexDiscoveredIn(locId)`
(locations.js:193) drives the per-location tab labels and the location-select screen; `unseenSpecies(locId)`
(draw.js:1687) drives the small red "NEU count" badge on each location tab.

---

## 8. Globals / functions this system depends on from other files

`fish.js`/`creatures.js`/`sprites.js` are **not self-contained** — they read a large number of globals owned
elsewhere. A rebuild needs equivalents (or a refactor that removes the implicit coupling) for all of these:

| symbol | defined in | used for |
|---|---|---|
| `canvas`, `ctx` | `script.js` | the shared 2D context every draw function writes into (module-level singleton, not passed as a real render target except as the `c` param, which is *usually* just `ctx`) |
| `horizonY` | `script.js` (set per-location in `enterLocation`) | surface line; `depthToY()` and `drawFishGlowBehind`/fog math all anchor to it |
| `dayTime`, `getPalette(t)` | `script.js` / `draw.js` | day/night color palette + `light` (0..1) used for haze, glow visibility, caustic strength |
| `weather`, `weatherGloom()` | `script.js` / `events.js` | rain speeds up bite rate (`waitBoost`); gloom dims caustics |
| `isGoldenHour()` | `events.js` | rarity-weight boost + bite-rate boost during golden hour |
| `getLocation()`, `LOCATIONS`, `bossFor()`, `bossUnlocked()`, `speciesForLocation()`, `dexDiscoveredIn()` | `locations.js` | current location object, boss lookups, dex denominators |
| `WATER_PROFILES`, `World.active` | `world.js` | per-location caustic strength / mirror reflectivity; whether the GPU shader owns scene-wide depth fog (changes the fish-haze weighting) |
| `Gpu.aktiv`, `Gpu.ctx`, `Gpu.viereckGefaerbt()`, `Gpu.vergiss()` | `gpu.js` | GPU-path tinted-quad draw for the cached sprite's fog overlay; texture eviction hook |
| `getRod()`, `getBait()`, `RODS[]`, `BAITS[]` | `shop.js` | attraction radius, bite rate multiplier, rare-fish weight multiplier, `targetFishCount()` |
| `totemActive(id)` | `gems.js` | "glueck" (luck→shiny/rare odds) and "lockruf" (bite-rate) consumable totem checks |
| `talentMult(id, per)` | `talents.js` | permanent player-talent multipliers on luck/patience/attract-radius/XP/coins |
| `save`, `saveGame()`, `coins`, `addGems()` | `script.js` / persistence layer | `save.dex`, `save.seenSpecies`, `save.stats.*`, coin/gem economy |
| `recordCatch()`, `dexDiscovered()` | `shop.js` | writes/reads the dex record on catch |
| `checkDexRewards()` | `progress.js` | location-completion payouts + hat unlock |
| `gameState`, `hookX/hookY`, `hookInWater`, `bobberX/bobberY`, `startBite()`, `startReeling()` | `script.js` | the cast/bite/reel state machine fish AI reads and writes into |
| `I18N.translate()`, `I18N.dict`, `I18N.lang` | `i18n.js` | species/UI name localization (EN names are a translation dictionary, not a data field) |
| `TRIVIA`, `TRIVIA_EN`, `triviaFor(sp)` | `trivia.js`, `trivia_en.js` | per-species flavor text |
| `RARITY` | `fish.js` itself | shared by shop/dex/UI for rarity color/name/weight |
| `shadeColor()`, `hexToRgb()`, `lerpColor()` | `fish.js` (`shadeColor`) / `draw.js` (`hexToRgb`, `lerpColor`) | every gradient/tint computation in §2 |
| `clamp()`, `lerp()`, `rand()` | `effects.js` | numeric helpers used throughout |
| `uiScale()`, `isNarrow()`, `bottomBarY()` | `fish.js` / `script.js` / `draw.js` | responsive sizing (phone vs desktop layout affects fish size and the visible "floor") |
| `Sound.*`, `haptic()` | `audio.js` / `script.js` | bite/catch/nibble feedback |
| `spawnRipple()`, `spawnSplash()`, `spawnConfetti()`, `addFloatingText()`, `toasts` | `effects.js` / `script.js` | catch/nibble/boss-arrival juice |
| `startCutscene()`, `CUTSCENE_DUR` | `cutscene.js` | boss-arrival cinematic |
| `startHype()` | referenced from `script.js` (implemented in a "hype.js"-style module) | shiny/boss/legendary/record slow-mo+banner moment |
| `lastFrame` | `script.js` (frame loop) | throttles `sprites.js`'s bounding-box measurement to once per rendered frame |
| `Wood.*`, `Glass.*`, `drawBadgeText()`, `drawIcon()`, `fitText()`, `uiButton()`, `drawTabs()`, `hitButtons` | `draw.js` (+ small helper modules) | all Fischdex/shop UI chrome around the fish renderer |

---

## 9. Pure data / logic (portable) vs. renderer-bound (Canvas2D-specific)

**Portable as-is (data or math, no Canvas2D API calls) — safe to lift into any engine's data layer:**
- The full `SPECIES` array (§1) — id, names, rarity, location membership, depth band, size/weight/speed/fight/value,
  color triplet, pattern key, flags. This is plain JSON-shaped data.
- `RARITY` table, `BOTTLE_MESSAGES`, `TRIVIA`/`TRIVIA_EN`, the DE→EN name dictionary slice of `i18n.js`.
- `pickSpecies()`'s weighting math, the shiny-roll formula, `fishUnit()`'s size formula, `depthToY()`'s depth→Y
  mapping (as a formula, independent of `ctx`), the full swim-AI state machine and its per-state formulas (§3),
  the boss-unlock/dex-completion/reward logic (§7), the Fisch-in-Fisch bonus-catch logic.
- `DEX_HATS`, `checkDexRewards()`'s thresholds/payouts, `recordCatch()`'s isNew/isRecord logic.
- The sprite-cache's **conceptual** design decisions (§5.4/5.5: geometric size ladder, N-phase quantization,
  measure-don't-guess bounding boxes, tint-the-atlas-not-the-CPU-pixels) — portable as *architecture*, not as code.

**Renderer-bound (Canvas2D `ctx` calls, gradients, clips, filters — must be rewritten, not ported) — everything a
GPU sprite-atlas pipeline replaces outright:**
- `drawFishShape()` and every helper it calls (`fishBodyPath`, `drawFishGlowBehind`, `drawFishCaustics`, `drawMaw`,
  `drawBoot`/`drawBottle`/`drawChest`/`drawFrozenOverlay`) — all raw path/gradient/clip/shadow drawing (§2.1, §2.3).
- All 14 `CREATURE_DRAW` body-type functions (§2.2) — same story, entirely bespoke Canvas2D path code per shape,
  with zero shared geometry with the generic fish body.
- `sprites.js` in its entirety (§5) — it is an *implementation* of a Canvas2D-specific problem (expensive draw
  calls, no persistent GPU sprite memory) that a real GPU/atlas renderer does not have in the same form; its
  measured lessons (§5.4) should inform the atlas *design*, but none of its code (LRU map, offscreen-canvas
  measurement, `getTransform()`-based DPI detection) is portable.
- The `haze`/silhouette depth-fog compositing technique in `drawFishes()`/`drawFishShape()` (§6.1/6.3) — the
  "draw twice, second pass flat-colored" trick is a Canvas2D workaround for the absence of a cheap shader tint; a
  GPU renderer should do this as a fragment-shader color-lerp against the atlas alpha channel in one draw call
  (exactly what `Gpu.viereckGefaerbt` already does for the cached-sprite case — that one function is the closest
  existing precedent for "how the new renderer should do this").
  `c.filter = "hue-rotate(...)"` — CSS Canvas filters, not available/performant as a per-instance GPU sprite effect;
  needs a shader uniform (HSV shift) or a pre-baked shiny atlas variant instead (the old game partially already does
  this by including the shiny flag in its sprite-cache key, §5.2).
- `ambientFishes`/`drawAmbientFish()`'s silhouette draw and `drawDeepSpecks()` — trivially reimplementable as cheap
  GPU-instanced sprites/particles, but the *current* implementation is raw Canvas2D arcs/paths.
- Depth-sort-then-draw (`fishes.slice().sort(...)`) is a CPU painter's-algorithm workaround; a GPU renderer would
  more naturally use a depth/layer value per sprite instance.
