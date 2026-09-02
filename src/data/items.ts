/**
 * Shop / cosmetic / consumable item catalogs.
 *
 * Ported renderer-free from the OLD game (`..\fishing-game`, read-only source of truth).
 * Every numeric/string value below is copied verbatim from the old source so the new
 * game reproduces the exact same balance. See `docs/spec/04-economy-meta.md` §1 for the
 * annotated version of these tables.
 *
 * Sources (old game, read in full):
 *   - shop.js      -> RODS, BAITS, BOBBERS, RODSKINS, HATS, OUTFITS, HARPOONS, SHOP_TABS
 *   - gems.js      -> TOTEMS, GEM_PACKS
 *   - gacha.js     -> GACHA
 *   - aquarium.js  -> TANK_GROUNDS, TANK_BACKS, TANK_DECOR, DECOR_SLOTS, TANK_BASE_SLOTS,
 *                     TANK_MAX_SLOTS (aquarium *logic* itself is out of scope for this port,
 *                     see src/game — it depends on SPECIES data that does not exist yet)
 *   - pass.js      -> the 3 pass-exclusive cosmetics appended at load time (`HATS.push(...)`,
 *                     `BOBBERS.push(...)`, `RODSKINS.push(...)`) are folded into the arrays
 *                     below, at the end, in the same order the old game appended them.
 *
 * A `price` of `-1` means "not purchasable through the normal buy flow" — it is granted
 * directly into `save.owned[...]` by dex-completion rewards (progress.ts) or season-pass
 * claims (meta.ts). Those items carry an `unlock` string describing how to get them
 * (player-facing, kept verbatim/German like the rest of the item text).
 */

/** Shared shape every purchasable/equippable catalog item has, at minimum. */
export interface ShopItem {
  readonly id: string;
  readonly name: string;
  /** Coin price. `0` = free/starter item. `-1` = not buyable (dex/pass unlock only). */
  readonly price: number;
  /** Gem price for gem-currency items. When present, `price` is `0` and is ignored. */
  readonly gemPrice?: number;
  readonly desc: string;
  /** Player-facing unlock condition text, only present on `price: -1` items. */
  readonly unlock?: string;
}

// ---------------------------------------------------------------------------------------
// Rods — shop.js RODS
// radius = lock-on radius as a fraction of screen width, zone = drill "zone" size.
// shaft/grip/accent = shop preview colors, glow = optional glow color.
// Prices are the post-#84-rebalance values (docs/WIRTSCHAFT.md records the pre-rebalance
// 60/150/300/500/900/1500/3000 history only — not used here, per the spec).
// ---------------------------------------------------------------------------------------
export interface RodItem extends ShopItem {
  readonly radius: number;
  readonly zone: number;
  readonly shaft: string;
  readonly grip: string;
  readonly accent: string;
  readonly glow?: string;
  readonly segments?: boolean;
}

export const RODS: readonly RodItem[] = [
  { id: "holz", name: "Holzrute", price: 0, radius: 0.14, zone: 0.26, shaft: "#a9753f", grip: "#6b4423", accent: "#d9a441", desc: "Omas alte Rute. Tut's noch." },
  { id: "bambus", name: "Bambusrute", price: 150, radius: 0.17, zone: 0.28, shaft: "#d8c56a", grip: "#8a6b2f", accent: "#a8c93a", desc: "Leicht, biegsam, riecht nach Urlaub." },
  { id: "carbon", name: "Carbonrute", price: 400, radius: 0.20, zone: 0.30, shaft: "#3a3f47", grip: "#1c1f24", accent: "#5ac8fa", desc: "Lockt Fische aus größerer Entfernung." },
  { id: "teleskop", name: "Teleskoprute", price: 1000, radius: 0.24, zone: 0.32, shaft: "#b9c2cc", grip: "#5a6470", accent: "#e0e6ec", segments: true, desc: "Passt in jeden Rucksack, reicht bis zur Mitte." },
  { id: "profi", name: "Profirute", price: 2200, radius: 0.28, zone: 0.35, shaft: "#26426b", grip: "#14243c", accent: "#ff9f43", desc: "Große Reichweite, ruhiges Drillen." },
  { id: "titan", name: "Titanrute", price: 5000, radius: 0.33, zone: 0.38, shaft: "#8e9aa6", grip: "#3d4750", accent: "#4fd6d2", desc: "Federt jeden Ruck weg." },
  { id: "poseidon", name: "Poseidons Rute", price: 11000, radius: 0.40, zone: 0.42, shaft: "#1f8a8a", grip: "#0f4f52", accent: "#ffd66b", glow: "#37e0d8", desc: "Der halbe See hört auf dich." },
  { id: "kumpel", name: "Das erste Projekt", price: 24000, radius: 0.50, zone: 0.48, shaft: "#7b5cff", grip: "#2e1c66", accent: "#ff6ec7", glow: "#b18cff", desc: "Ein Lernprojekt. Jetzt legendär." },
] as const;

/** Rod upgrades (coin sink). `rodUpgradeLevel(id) = save.rodUpgrades[id] || 0`. */
export const ROD_MAX_UPGRADE = 10;
/** +3% radius, +0.01 zone per upgrade level. */
export const ROD_UPGRADE_RADIUS_PER_LEVEL = 0.03;
export const ROD_UPGRADE_ZONE_PER_LEVEL = 0.01;

// ---------------------------------------------------------------------------------------
// Baits — shop.js BAITS
// rareMult scales rare+ species weight in the catch roll, rate scales bite/attraction rate.
// ---------------------------------------------------------------------------------------
export interface BaitItem extends ShopItem {
  readonly rareMult: number;
  readonly rate: number;
  readonly icon: string;
}

export const BAITS: readonly BaitItem[] = [
  { id: "wurm", name: "Regenwurm", price: 0, rareMult: 1, rate: 1, icon: "🪱", desc: "Der Klassiker. Fängt, was halt kommt." },
  { id: "brot", name: "Brotkugel", price: 40, rareMult: 1.2, rate: 1.4, icon: "🍞", desc: "Die Kleinen sind sofort da." },
  { id: "mais", name: "Mais", price: 80, rareMult: 1.6, rate: 1.3, icon: "🌽", desc: "Beißt schneller, etwas mehr Seltenes." },
  { id: "koeder", name: "Köderfisch", price: 300, rareMult: 2.6, rate: 1.5, icon: "🐟", desc: "Raubfische lieben ihn." },
  { id: "shrimp", name: "Garnele", price: 550, rareMult: 3.4, rate: 1.6, icon: "🦐", desc: "Delikatesse für Zander und Lachs." },
  { id: "glitzer", name: "Glitzerköder", price: 900, rareMult: 4.5, rate: 1.8, icon: "✨", desc: "Legendäre Fische werden neugierig." },
] as const;

// ---------------------------------------------------------------------------------------
// Bobber skins — shop.js BOBBERS (+ pass.js pass-exclusive "sonnenblume" appended)
// shape/duck/rainbow are draw-mode flags for the renderer, cosmetic only.
// ---------------------------------------------------------------------------------------
export interface BobberItem extends ShopItem {
  readonly main?: string;
  readonly top?: string;
  readonly shape?: "heart" | "strawberry" | "ball" | "skull" | "disco";
  readonly duck?: boolean;
  readonly rainbow?: boolean;
}

export const BOBBERS: readonly BobberItem[] = [
  { id: "classic", name: "Klassiker", price: 0, main: "#e63946", top: "#ffffff", desc: "Rot-weiß, wie es sich gehört." },
  { id: "neon", name: "Neon", price: 60, main: "#39ff14", top: "#111111", desc: "Sieht man auch nachts." },
  { id: "herz", name: "Herz", price: 120, shape: "heart", desc: "Für die Fische, die man liebt." },
  { id: "erdbeere", name: "Erdbeere", price: 180, shape: "strawberry", desc: "Süß. Fische stehen nicht drauf, sieht aber gut aus." },
  { id: "gold", name: "Goldpose", price: 250, main: "#ffd700", top: "#fff4c2", desc: "Reines Show-Off." },
  { id: "fussball", name: "Fußball", price: 300, shape: "ball", desc: "Abseits gibt's hier nicht." },
  { id: "ente", name: "Quietscheente", price: 400, duck: true, desc: "Quak." },
  { id: "schaedel", name: "Totenkopf", price: 500, shape: "skull", desc: "Die Fische werden nervös." },
  { id: "rainbow", name: "Regenbogen", price: 600, rainbow: true, desc: "Wechselt permanent die Farbe." },
  { id: "disco", name: "Discokugel", price: 800, shape: "disco", desc: "Saturday Night Fishing." },
  { id: "diamant", name: "Diamantpose", price: 0, gemPrice: 20, main: "#7fd8ff", top: "#ffffff", desc: "Funkelt wie dein Kontostand. Hoffentlich." },
  // Pass-exclusive (pass.js: BOBBERS.push(...), Angel-Pass Premium tier 20)
  { id: "sonnenblume", name: "Sonnenblume", price: -1, unlock: "Angel-Pass Premium Stufe 20", main: "#ffd23a", top: "#6b4a2b", desc: "Nur im Angel-Pass." },
] as const;

// ---------------------------------------------------------------------------------------
// Rod skins — shop.js RODSKINS (+ pass.js pass-exclusive "sommerbrise" appended)
// Includes a CS:GO-parody "knife skin" easter-egg line (`fx` field, cosmetic only here).
// ---------------------------------------------------------------------------------------
export interface RodSkinItem extends ShopItem {
  readonly color?: string;
  readonly accent: string;
  readonly glow?: boolean;
  readonly rainbow?: boolean;
  readonly fx?: "tiger" | "web" | "gamma" | "fade" | "case" | "marble" | "slaughter";
}

export const RODSKINS: readonly RodSkinItem[] = [
  { id: "holz", name: "Holz", price: 0, color: "#4a3018", accent: "#7a5a38", desc: "Natur pur." },
  { id: "bambus", name: "Bambus", price: 80, color: "#c2b280", accent: "#7a6a3a", desc: "Knoten inklusive." },
  { id: "carbon", name: "Carbon", price: 120, color: "#1b1b1f", accent: "#e63946", desc: "Matt-schwarz mit roten Ringen." },
  { id: "neon", name: "Neon", price: 200, color: "#39ff14", accent: "#111111", desc: "Grell. Absichtlich." },
  { id: "eis", name: "Eis", price: 250, color: "#bfe9ff", accent: "#ffffff", desc: "Kalt wie der See im Januar." },
  { id: "candy", name: "Zuckerstange", price: 300, color: "#ff4f7b", accent: "#ffffff", desc: "Weihnachten am See." },
  { id: "lava", name: "Lava", price: 450, color: "#ff4500", accent: "#ffd23a", desc: "Vorsicht, heiß." },
  { id: "gold", name: "Gold", price: 800, color: "#e0b000", accent: "#fff2a8", desc: "Für den Angler mit Geschmack." },
  { id: "galaxie", name: "Galaxie", price: 1200, color: "#2a1b5e", accent: "#c77dff", glow: true, desc: "Sterne inklusive." },
  { id: "rainbow", name: "Regenbogen", price: 1500, rainbow: true, accent: "#ffffff", desc: "Alle Farben. Gleichzeitig. Nacheinander." },
  { id: "kristall", name: "Kristall", price: 0, gemPrice: 25, color: "#bfe9ff", accent: "#7fd8ff", glow: true, desc: "Durchsichtig. Die Fische sehen die Rute nicht kommen." },
  // Easter Egg: die Klassiker aus einem gewissen Messer-Markt
  { id: "tigertooth", name: "Tiger Tooth", price: 2200, fx: "tiger", color: "#f39c12", accent: "#1a1a1a", desc: "Factory New. Float 0.003. Kein Trade-Lock." },
  { id: "crimsonweb", name: "Crimson Web", price: 0, gemPrice: 35, fx: "web", color: "#8a1c2b", accent: "#1a0a0e", desc: "Drei Netze auf der Vorderseite. Sammlerstück." },
  { id: "gammadoppler", name: "Gamma Doppler", price: 0, gemPrice: 45, fx: "gamma", color: "#2ee6a6", accent: "#0b6b3a", glow: true, desc: "Phase 2. Emerald wäre zu teuer gewesen." },
  { id: "fade", name: "Fade", price: 3000, fx: "fade", color: "#ff5c8a", accent: "#ffd23a", desc: "100 % Fade. Sagt jeder." },
  { id: "casehardened", name: "Case Hardened", price: 2600, fx: "case", color: "#2a6fd6", accent: "#c9a227", desc: "Blue Gem? Fast. 40 % Blau, Rest Gold." },
  { id: "marblefade", name: "Marble Fade", price: 0, gemPrice: 40, fx: "marble", color: "#ff3b30", accent: "#ffd23a", desc: "Fire & Ice. Der See ist beeindruckt." },
  { id: "slaughter", name: "Slaughter", price: 2400, fx: "slaughter", color: "#c0392b", accent: "#f5b7b1", desc: "Mit Herz-Muster. Angeblich." },
  // Pass-exclusive (pass.js: RODSKINS.push(...), Angel-Pass Premium tier 30)
  { id: "sommerbrise", name: "Sommerbrise", price: -1, unlock: "Angel-Pass Premium Stufe 30", color: "#5ad4e6", accent: "#fff3a0", glow: true, desc: "Nur im Angel-Pass." },
] as const;

// ---------------------------------------------------------------------------------------
// Hats — shop.js HATS (+ pass.js pass-exclusive "sommerhut" appended)
// Six items are not purchasable (price: -1) — unlocked only via 100% fishdex per location
// (see DEX_HATS in progress.ts).
// ---------------------------------------------------------------------------------------
export type HatItem = ShopItem;

export const HATS: readonly HatItem[] = [
  { id: "angler", name: "Anglerhut", price: 0, desc: "Grün, praktisch, unauffällig." },
  { id: "cap", name: "Basecap", price: 50, desc: "Schirm nach vorne. Oder hinten." },
  { id: "stroh", name: "Strohhut", price: 120, desc: "Sommer, Sonne, Sonnenbrand vermieden." },
  { id: "muetze", name: "Weihnachtsmütze", price: 200, desc: "Ho ho ho, ein Karpfen." },
  { id: "kapitaen", name: "Kapitänsmütze", price: 350, desc: "Aye aye." },
  { id: "pirat", name: "Piratenhut", price: 600, desc: "Arrr. Wo ist die Schatzkiste?" },
  { id: "zylinder", name: "Zylinder", price: 900, desc: "Angeln, aber elegant." },
  { id: "krone", name: "Krone", price: 2000, desc: "König des Sees." },
  { id: "perlenkrone", name: "Perlenkrone", price: 0, gemPrice: 30, desc: "Aus dem Riff. Für Königinnen und Könige." },
  // Exklusiv: nur über Fischdex 100 % des jeweiligen Orts (progress.ts DEX_HATS)
  { id: "kranz", name: "Blätterkranz", price: -1, unlock: "Fischdex Steg am See 100 %", desc: "Für den, der den See kennt." },
  { id: "nessiemuetze", name: "Nessie-Mütze", price: -1, unlock: "Fischdex Seemitte 100 %", desc: "Sie existiert. Du weißt es." },
  { id: "moewenhut", name: "Möwenhut", price: -1, unlock: "Fischdex Küste 100 %", desc: "Die Möwe sitzt jetzt auf deiner Seite." },
  { id: "blumenkranz", name: "Blumenkranz", price: -1, unlock: "Fischdex Korallenriff 100 %", desc: "Aloha." },
  { id: "leuchthelm", name: "Leuchthelm", price: -1, unlock: "Fischdex Tiefsee 100 %", desc: "Selbst leuchten, statt zu suchen." },
  { id: "eiskrone", name: "Eiskrone", price: -1, unlock: "Fischdex Arktis 100 %", desc: "Kalt. Königlich. Kalt." },
  // Pass-exclusive (pass.js: HATS.push(...), Angel-Pass Premium tier 10)
  { id: "sommerhut", name: "Sommerhut", price: -1, unlock: "Angel-Pass Premium Stufe 10", desc: "Nur im Angel-Pass." },
] as const;

// ---------------------------------------------------------------------------------------
// Outfits — shop.js OUTFITS
// ---------------------------------------------------------------------------------------
export interface OutfitItem extends ShopItem {
  readonly body: string;
  readonly pants: string;
  readonly skin: string;
  readonly pattern?: "flowers";
  readonly stripe?: string;
  readonly fur?: boolean;
}

export const OUTFITS: readonly OutfitItem[] = [
  { id: "klassisch", name: "Klassisch", price: 0, body: "#2b2f3a", pants: "#2b2f3a", skin: "#e9c3a0", desc: "Dunkler Pulli, Jeans. Zeitlos." },
  { id: "regen", name: "Regenjacke", price: 200, body: "#f4c542", pants: "#2b3a55", skin: "#e9c3a0", desc: "Gelb wie ein Warnschild. Hält trocken." },
  { id: "hawaii", name: "Hawaiihemd", price: 350, body: "#ff6b6b", pants: "#f0e6c8", skin: "#d9a878", pattern: "flowers", desc: "Urlaub am See. Immer." },
  { id: "taucher", name: "Taucheranzug", price: 600, body: "#1b1b1f", pants: "#1b1b1f", skin: "#e9c3a0", stripe: "#39ff14", desc: "Neopren mit Neonstreifen. Tiefsee-tauglich." },
  { id: "pirat", name: "Piratenmantel", price: 800, body: "#8a1c2b", pants: "#2b2f3a", skin: "#e9c3a0", stripe: "#ffd700", desc: "Passt zum Hut. Und zum Kraken." },
  { id: "eskimo", name: "Polarparka", price: 900, body: "#dfefff", pants: "#4a5a6a", skin: "#e9c3a0", fur: true, desc: "Mit Fellkragen. Eisloch-Pflicht." },
  { id: "kapitaen", name: "Kapitänsjacke", price: 1200, body: "#1d3557", pants: "#f2f2f2", skin: "#e9c3a0", stripe: "#ffd700", desc: "Navy mit Goldknöpfen." },
  { id: "gold", name: "Goldanzug", price: 0, gemPrice: 40, body: "#e0b000", pants: "#c99a00", skin: "#e9c3a0", stripe: "#fff2a8", desc: "Für den Angler, der alles hat. Außer Bescheidenheit." },
] as const;

// ---------------------------------------------------------------------------------------
// Harpoon skins — shop.js HARPOONS
// Relevant only in the "dive" mode location (Tiefsee).
// ---------------------------------------------------------------------------------------
export interface HarpoonItem extends ShopItem {
  readonly shaft: string;
  readonly accent: string;
  readonly glow?: string;
  readonly fx?: "tiger" | "gamma" | "fade";
}

export const HARPOONS: readonly HarpoonItem[] = [
  { id: "standard", name: "Standard", price: 0, shaft: "#8a929b", accent: "#e6edf5", desc: "Tut, was sie soll." },
  { id: "stahl", name: "Gehärteter Stahl", price: 300, shaft: "#5f6b78", accent: "#cfd8e2", desc: "Schwerer Schaft, ruhigerer Flug." },
  { id: "knochen", name: "Walknochen", price: 600, shaft: "#e6dcc4", accent: "#b8a888", desc: "Aus der Tiefe, für die Tiefe." },
  { id: "obsidian", name: "Obsidian", price: 900, shaft: "#1a1a22", accent: "#6a5acd", desc: "Vulkanglas. Schneidet Wasser." },
  { id: "biolum", name: "Biolumineszenz", price: 1400, shaft: "#0f3b3a", accent: "#37e0d8", glow: "#37e0d8", desc: "Leuchtet wie die Korallen. Fische kommen näher." },
  { id: "abyss", name: "Abyss", price: 2000, shaft: "#101a2e", accent: "#7b6bff", glow: "#7b6bff", desc: "Aus dem, was da unten leuchtet." },
  { id: "goldharp", name: "Goldene Harpune", price: 0, gemPrice: 30, shaft: "#c9a227", accent: "#fff2a8", glow: "#ffd66b", desc: "Poseidon hätte Fragen." },
  // Easter Egg – die Messer-Markt-Linie geht auch unter Wasser weiter
  { id: "harptiger", name: "Tiger Tooth", price: 2200, fx: "tiger", shaft: "#f39c12", accent: "#1a1a1a", desc: "Auch unter Wasser Factory New." },
  { id: "harpdoppler", name: "Doppler", price: 0, gemPrice: 40, fx: "gamma", shaft: "#2ee6a6", accent: "#0b6b3a", glow: "#2ee6a6", desc: "Phase 4. Diesmal wirklich." },
  { id: "harpfade", name: "Fade", price: 3000, fx: "fade", shaft: "#ff5c8a", accent: "#ffd23a", desc: "Der Farbverlauf allein ist den Tauchgang wert." },
] as const;

// ---------------------------------------------------------------------------------------
// Totems — gems.js TOTEMS
// Timed-effect consumables. Bought into an inventory bag, activated separately (buy != use,
// see save.ts SaveData.inv / save.totemTime). dur = seconds of effect, 0 = instant one-shot.
// ---------------------------------------------------------------------------------------
export interface TotemItem {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  /** Drawn-icon id for the renderer (icons.js-adjacent); not used by game logic. */
  readonly ico: string;
  /** Ring-timer tint color. */
  readonly tint: string;
  /** Coin price. Absent when the totem is gem-priced (see `gems`). */
  readonly price?: number;
  /** Gem price. Absent when the totem is coin-priced (see `price`). */
  readonly gems?: number;
  readonly desc: string;
  /** Seconds of effect. `0` = instant, one-shot. */
  readonly dur: number;
}

export const TOTEMS: readonly TotemItem[] = [
  { id: "regen", name: "Regentotem", icon: "🌧️", ico: "rain", tint: "#7fc7ff", price: 800, desc: "90 s Regen – Fische beißen 1,6× schneller.", dur: 90 },
  { id: "nacht", name: "Nachttotem", icon: "🌙", ico: "moon", tint: "#b9a8ff", price: 900, desc: "Sofort Nacht – Nachtfische kommen raus.", dur: 0 },
  { id: "sonne", name: "Sonnentotem", icon: "☀️", ico: "sun", tint: "#ffd23a", price: 500, desc: "Sofort Mittag – für die Tagfische.", dur: 0 },
  { id: "lockruf", name: "Lockruf", icon: "📣", ico: "horn", tint: "#ff9a5c", price: 650, desc: "3 min doppelte Lock-Rate.", dur: 180 },
  { id: "glueck", name: "Glückstotem", icon: "🍀", ico: "clover", tint: "#7fe08a", gems: 2, desc: "5 min vierfache Shiny-Chance.", dur: 300 },
  { id: "magnet", name: "Seltenheits-Magnet", icon: "🧲", ico: "magnet", tint: "#ff8a80", gems: 3, desc: "5 min doppelt so viele seltene Fische.", dur: 300 },
] as const;

/**
 * Effect wiring (documented for the systems that will consume totem state — none of that
 * belongs in this data file, see gems.js in the old game for the original wiring):
 *   regen   -> forces rain, kept alive while save.totemTime.regen > 0
 *   nacht   -> sets dayTime = 0.97
 *   sonne   -> sets dayTime = 0.5
 *   lockruf -> doubles waitBoost in fish attraction
 *   glueck  -> multiplies shiny roll chance x4
 *   magnet  -> doubles rare+ species weight in pickSpecies
 */
export const TOTEM_WARN_SECONDS = 10;

// ---------------------------------------------------------------------------------------
// Gacha — gacha.js GACHA
// ---------------------------------------------------------------------------------------
export interface GachaItem {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly icon: string;
  readonly desc: string;
  readonly gold: boolean;
}

export const GACHA: readonly GachaItem[] = [
  { id: "tuete", name: "Wundertüte", price: 400, icon: "🎁", desc: "Coins, Köder, Skins – oder Seetang.", gold: false },
  { id: "gold", name: "Goldene Wundertüte", price: 1600, icon: "✨", desc: "Bessere Chancen auf Skins und den Jackpot.", gold: true },
] as const;

// ---------------------------------------------------------------------------------------
// Aquarium (tank) decorations — aquarium.js TANK_GROUNDS/TANK_BACKS/TANK_DECOR
// Pure cosmetics for the home-tank hub, no gameplay effect. The aquarium *logic* (passive
// income, slot management) is NOT ported here — it depends on SPECIES data that does not
// exist in this repo yet (src/data/species.ts is being ported separately). These catalogs
// are included because they are pure item data, independent of that dependency.
// ---------------------------------------------------------------------------------------
export interface TankGroundItem {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly gemPrice?: number;
  readonly top: string;
  readonly bot: string;
  readonly dots: readonly string[];
}

export const TANK_GROUNDS: readonly TankGroundItem[] = [
  { id: "kies", name: "Heller Kies", price: 0, top: "#c9b58c", bot: "#8a7a5a", dots: ["#b9a27a", "#d8c8a3", "#8f7f60", "#e2d4b1"] },
  { id: "sand", name: "Feiner Sand", price: 250, top: "#efe0b8", bot: "#c4ae7e", dots: ["#e6d4a6", "#f6ecd0", "#d2bd8c", "#fff6e0"] },
  { id: "vulkan", name: "Vulkangestein", price: 600, top: "#4a4148", bot: "#241f26", dots: ["#5c525a", "#3a333c", "#6b5f68", "#2c262e"] },
  { id: "koralle", name: "Korallensplit", price: 900, top: "#f0c9c2", bot: "#c08a86", dots: ["#ffdcd6", "#e0aaa4", "#ffeae6", "#cf9a95"] },
  { id: "gold", name: "Goldsand", price: 0, gemPrice: 15, top: "#f3d98a", bot: "#c9a227", dots: ["#ffeaa8", "#e0c060", "#fff6cf", "#d4ae3a"] },
] as const;

export interface TankBackItem {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly gemPrice?: number;
  readonly a: string;
  readonly b: string;
  readonly c: string;
}

export const TANK_BACKS: readonly TankBackItem[] = [
  { id: "schlicht", name: "Schlicht", price: 0, a: "#3a9ec4", b: "#1f6f95", c: "#123f5c" },
  { id: "tief", name: "Tiefes Blau", price: 300, a: "#2a6f96", b: "#134863", c: "#0a2536" },
  { id: "riff", name: "Riffgrün", price: 700, a: "#3fd0c9", b: "#1f8f8a", c: "#0e5a5a" },
  { id: "daemmer", name: "Dämmerung", price: 1100, a: "#7a6fb0", b: "#4a3f7a", c: "#241f45" },
  { id: "abyss", name: "Abyss", price: 0, gemPrice: 20, a: "#16324a", b: "#0a1c2c", c: "#03080f" },
] as const;

export interface TankDecorItem {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly gemPrice?: number;
  readonly desc: string;
}

export const TANK_DECOR: readonly TankDecorItem[] = [
  { id: "pflanzen", name: "Wasserpflanzen", price: 0, desc: "Grün, wiegt sich." },
  { id: "stein", name: "Findling", price: 200, desc: "Ein Stein. Ehrliche Arbeit." },
  { id: "amphore", name: "Amphore", price: 450, desc: "Antik. Angeblich." },
  { id: "wrack", name: "Schiffswrack", price: 800, desc: "Kleines Wrack, große Geschichte." },
  { id: "helm", name: "Taucherhelm", price: 1000, desc: "Der Vorbesitzer fehlt." },
  { id: "burg", name: "Aquarienburg", price: 1400, desc: "Der Klassiker aus dem Zoohandel." },
  { id: "vulkan", name: "Blubbervulkan", price: 1800, desc: "Speit Blasen statt Lava." },
  { id: "schaedel", name: "Schädel", price: 0, gemPrice: 12, desc: "Rein dekorativ. Hoffentlich." },
  { id: "kristall", name: "Leuchtkristall", price: 0, gemPrice: 18, desc: "Leuchtet im Dunkeln." },
] as const;

/** Free-standing decor items visible at once (ground + back are single-slot, always visible). */
export const DECOR_SLOTS = 4;
/** Base fish display slots in the tank. */
export const TANK_BASE_SLOTS = 6;
/** Max fish display slots, after buying all extra slots. */
export const TANK_MAX_SLOTS = 12;

// ---------------------------------------------------------------------------------------
// Gem packages (IAP) — gems.js GEM_PACKS
// ---------------------------------------------------------------------------------------
export interface GemPackItem {
  readonly id: string;
  readonly gems: number;
  /** Display price string, verbatim (e.g. "1,99 €"). Not a number: shown, never computed with. */
  readonly price: string;
  readonly icon: string;
  readonly desc: string;
  readonly tag?: string;
}

export const GEM_PACKS: readonly GemPackItem[] = [
  { id: "gems_50", gems: 50, price: "1,99 €", icon: "💎", desc: "Ein Sack voll." },
  { id: "gems_200", gems: 200, price: "5,99 €", icon: "💎💎", desc: "Beliebteste Wahl.", tag: "+25 %" },
  { id: "gems_600", gems: 600, price: "12,99 €", icon: "💎💎💎", desc: "Für Sammler.", tag: "+50 %" },
  { id: "adfree", gems: 0, price: "0,99 €", icon: "🚫📺", desc: "Werbefrei für immer. Keine Pausen, keine Anzeigen." },
] as const;

// ---------------------------------------------------------------------------------------
// Shop tab registry — shop.js SHOP_TABS
// `equipKey` names the `SaveData.equipped` field a tab's items get equipped into; `null`
// for tabs that don't equip (totems/gems/gacha draw custom panels, UI-only).
// ---------------------------------------------------------------------------------------
export type ShopTabId =
  | "rods"
  | "baits"
  | "bobbers"
  | "rodskins"
  | "hats"
  | "outfits"
  | "harpoons"
  | "totems"
  | "gems"
  | "gacha";

export interface ShopTab {
  readonly id: ShopTabId;
  readonly label: string;
  readonly icon: string;
  readonly items: readonly ShopItem[];
  readonly equipKey: string | null;
}

export const SHOP_TABS: readonly ShopTab[] = [
  { id: "rods", label: "Ruten", icon: "rod", items: RODS, equipKey: "rod" },
  { id: "baits", label: "Köder", icon: "worm", items: BAITS, equipKey: "bait" },
  { id: "bobbers", label: "Posen", icon: "bobber", items: BOBBERS, equipKey: "bobber" },
  { id: "rodskins", label: "Skins", icon: "palette", items: RODSKINS, equipKey: "rodskin" },
  { id: "hats", label: "Hüte", icon: "hat", items: HATS, equipKey: "hat" },
  { id: "outfits", label: "Outfits", icon: "coat", items: OUTFITS, equipKey: "outfit" },
  { id: "harpoons", label: "Harpunen", icon: "trident", items: HARPOONS, equipKey: "harpoon" },
  { id: "totems", label: "Totems", icon: "orb", items: [], equipKey: null },
  { id: "gems", label: "Gems", icon: "gem", items: [], equipKey: null },
  { id: "gacha", label: "Glück", icon: "gift", items: [], equipKey: null },
] as const;
