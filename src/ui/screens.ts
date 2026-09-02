/**
 * Screens — the five menu screens the old game drew as `Sheet` content (spec
 * `05-ui-hub-story.md` §1.3-§1.8, §1.7's Achievements tab): Fischdex, Shop,
 * daily quests, Settings, Achievements. Each is a small renderer-free-ish
 * class (`mount`/`update`/`unmount`) driven by a plain data object; `Screens`
 * owns one `Sheet` and swaps which screen is mounted into its body.
 *
 * Data sources: `src/game/save.ts` (SaveData shapes), `src/game/quests.ts`
 * (`resetCountdown`), `src/data/species.ts` (SPECIES), `src/data/items.ts`
 * (shop catalogs), `src/data/locations.ts` (LOCATIONS). None of those files
 * are modified here — only their exported types/values are read.
 *
 * A few player-facing strings the spec calls for (quality-tier names,
 * "Haptik", "Ambience") have no entry in the old game's `i18n.ts` dictionary
 * (they're new to this rebuild — quality tiers/haptics didn't exist in the
 * Canvas2D original). Those use `trLocal()` below instead of `t()` rather
 * than inventing dictionary keys in a file this agent doesn't own.
 */

import { el, woodButton } from './dom';
import { bakeIcon, type IconId } from './icons';
import { PAINT } from './wood';
import { t, num, getLang } from './i18n';
import { Sheet, type SheetTab } from './sheet';
import { drawSpecies } from '@/bake/fishArt';
import { SPECIES, type Species, type Rarity } from '@/data/species';
import { LOCATIONS } from '@/data/locations';
import {
  RODS,
  BAITS,
  BOBBERS,
  RODSKINS,
  HATS,
  OUTFITS,
  TOTEMS,
  type ShopItem,
} from '@/data/items';
import type { DexEntry, OwnedCatalog, EquippedCatalog, QuestsState } from '@/game/save';
import { resetCountdown } from '@/game/quests';

// ---------------------------------------------------------------------------
// Small shared helpers (rarity meta, formatting, species art, string hashing)
// ---------------------------------------------------------------------------

export interface RarityMeta {
  idx: number;
  /** fish.js RARITY[].color, spec 02-fish.md §1.2 — verbatim. */
  color: string;
  /** German dictionary key (also the German-source display text). */
  nameDe: string;
}

/** fish.js RARITY table (color + name), spec 02-fish.md §1.2. */
export const RARITY_META: Record<Rarity, RarityMeta> = {
  common: { idx: 0, color: '#c3ccd6', nameDe: 'Gewöhnlich' },
  uncommon: { idx: 1, color: '#5ad46a', nameDe: 'Ungewöhnlich' },
  rare: { idx: 2, color: '#4aa3ff', nameDe: 'Selten' },
  epic: { idx: 3, color: '#c072ff', nameDe: 'Episch' },
  legendary: { idx: 4, color: '#ffc83d', nameDe: 'Legendär' },
};

export function rarityName(r: Rarity): string {
  return t(RARITY_META[r].nameDe);
}

export function rarityColor(r: Rarity): string {
  return RARITY_META[r].color;
}

/** German uses a comma decimal separator (i18n.ts `num`) — kept consistent everywhere weight is shown. */
export function fmtKg(kg: number): string {
  return `${num(kg, 2)} kg`;
}

/**
 * `sp.depth` is a [0,1] band (0 = surface, 1 = bottom) with no explicit
 * label thresholds in the spec — this buckets the band's midpoint into the
 * spec's three depth-label strings (05-ui-hub-story.md §1.4).
 */
export function depthLabel(depth: readonly [number, number]): string {
  const avg = (depth[0] + depth[1]) / 2;
  if (avg < 0.35) return t('nahe der Oberfläche');
  if (avg > 0.65) return t('am Grund');
  return t('mittlere Tiefe');
}

/** Species display name in the current language (species.ts has no `t()` hookup of its own). */
export function speciesName(sp: Species): string {
  return getLang() === 'de' ? sp.nameDe : sp.nameEn;
}

/** Species trivia sentence in the current language. */
export function speciesTrivia(sp: Species): string {
  return getLang() === 'de' ? sp.triviaDe : sp.triviaEn;
}

/** Deterministic small numeric seed from a string id, for wood-bake variety without a live RNG. */
export function strSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 8191;
}

/**
 * Renders one species into a fresh `<canvas>` via `drawSpecies` (the only
 * PixiJS-adjacent import these UI files are allowed — see CLAUDE.md/task
 * brief). `dim` approximates the old game's "silhouette, 50% alpha" look
 * for an undiscovered species with a CSS filter instead of a `fishArt.ts`
 * silhouette mode (deliberately not ported there, see that file's header).
 */
export function speciesCanvas(sp: Species, wCss: number, hCss: number, opts: { shiny?: boolean; dim?: boolean } = {}): HTMLCanvasElement {
  const scale = Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 3);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(wCss * scale));
  canvas.height = Math.max(1, Math.round(hCss * scale));
  canvas.style.width = `${wCss}px`;
  canvas.style.height = `${hCss}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(scale, scale);
    drawSpecies(ctx, wCss, hCss, sp, { shiny: opts.shiny });
  }
  if (opts.dim) canvas.style.filter = 'brightness(0) opacity(0.38)';
  return canvas;
}

/** A couple of new-to-this-rebuild strings the old i18n dictionary has no key for. */
function trLocal(de: string, en: string): string {
  return getLang() === 'de' ? de : en;
}

/** Common shape every screen class below satisfies, for `Screens`' bookkeeping. */
interface MountableScreen {
  mount(host: HTMLElement): void;
  unmount(): void;
}

// ---------------------------------------------------------------------------
// Fischdex — spec §1.4
// ---------------------------------------------------------------------------

const LOCATION_SHORT_LABEL: Readonly<Record<string, string>> = {
  see: 'See',
  boot: 'Ruderboot',
  kueste: 'Küste',
  riff: 'Korallenriff',
  tiefsee: 'Tiefsee',
  arktis: 'Eisloch',
};

export interface DexScreenData {
  /** `SaveData.dex` — species id -> catch count/record/shiny count. */
  dex: Readonly<Record<string, DexEntry>>;
  /** `SaveData.seenSpecies` — discovered-but-not-yet-viewed drives the NEU badge. */
  seenSpecies: Readonly<Record<string, boolean>>;
  /** Optional footer stats line, e.g. from `SaveData.stats`. */
  totalCatches?: number;
  biggestKg?: number;
}

export class DexScreen implements MountableScreen {
  private host: HTMLElement | null = null;
  private data: DexScreenData | null = null;
  location: string = LOCATIONS[0]!.id;
  private detailId: string | null = null;

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('dex-screen');
    this.render();
  }

  update(data: DexScreenData): void {
    this.data = data;
    this.render();
  }

  setLocation(id: string): void {
    this.location = id;
    this.detailId = null;
    this.render();
  }

  unmount(): void {
    this.host?.replaceChildren();
    this.host = null;
  }

  /** Per-location unseen-species count — `Screens` reads this to badge the Sheet's location tabs. */
  unseenCountFor(locId: string): number {
    if (!this.data) return 0;
    const data = this.data;
    return SPECIES.filter((sp) => sp.locations.includes(locId) && data.dex[sp.id] && !data.seenSpecies[sp.id]).length;
  }

  private render(): void {
    if (!this.host || !this.data) return;
    this.host.replaceChildren();
    if (this.detailId) {
      const sp = SPECIES.find((s) => s.id === this.detailId);
      if (sp) {
        this.renderDetail(sp);
        return;
      }
      this.detailId = null;
    }
    this.renderGrid();
  }

  private renderGrid(): void {
    const data = this.data!;
    const list = SPECIES.filter((sp) => sp.locations.includes(this.location));
    const grid = el('div', 'dex-grid');
    for (const sp of list) {
      const entry = data.dex[sp.id];
      const discovered = !!entry;
      const unseen = discovered && !data.seenSpecies[sp.id];
      const cell = el('button', 'dex-cell');
      cell.type = 'button';
      cell.style.setProperty('--rarity-color', rarityColor(sp.rarity));
      cell.classList.toggle('is-locked', !discovered);
      cell.appendChild(speciesCanvas(sp, 76, 58, { shiny: discovered && !!entry?.shiny, dim: !discovered }));
      cell.appendChild(el('div', 'dex-cell-name', discovered ? speciesName(sp) : '???'));
      const info = el('div', 'dex-cell-info');
      if (discovered) {
        info.textContent = `${entry!.count}× · ${fmtKg(entry!.record)}`;
      } else {
        info.textContent = sp.nightOnly ? t('Nur nachts…') : rarityName(sp.rarity);
        info.classList.add('is-dim');
      }
      cell.appendChild(info);
      if (unseen) cell.appendChild(el('span', 'dex-cell-badge', t('NEU')));
      if (discovered && entry?.shiny) {
        const sparkle = el('img', 'dex-cell-sparkle') as HTMLImageElement;
        sparkle.src = bakeIcon('sparkle', 16);
        sparkle.alt = '';
        cell.appendChild(sparkle);
      }
      cell.addEventListener('click', () => {
        this.detailId = sp.id;
        this.render();
      });
      grid.appendChild(cell);
    }
    this.host!.appendChild(grid);

    if (data.totalCatches != null || data.biggestKg != null) {
      this.host!.appendChild(
        el('div', 'dex-footer', `${data.totalCatches ?? 0} ${t('Fänge')} · ${t('Größter Fang')} ${fmtKg(data.biggestKg ?? 0)}`),
      );
    }
  }

  private renderDetail(sp: Species): void {
    const data = this.data!;
    const entry = data.dex[sp.id];
    const discovered = !!entry;

    const wrap = el('div', 'dex-detail');
    const back = woodButton({ label: '‹ ' + t('Fischdex'), w: 140, h: 36, seed: 9200 });
    back.addEventListener('click', () => {
      this.detailId = null;
      this.render();
    });
    wrap.appendChild(back);

    const card = el('div', 'dex-detail-card');
    card.style.setProperty('--rarity-color', rarityColor(sp.rarity));
    card.appendChild(speciesCanvas(sp, 160, 120, { shiny: discovered && !!entry?.shiny, dim: !discovered }));
    card.appendChild(el('div', 'dex-detail-name', discovered ? speciesName(sp) : '???'));
    card.appendChild(el('div', 'dex-detail-rarity', rarityName(sp.rarity)));

    const meta = el('div', 'dex-detail-meta');
    meta.appendChild(el('span', undefined, depthLabel(sp.depth) + (sp.nightOnly ? ' · 🌙 ' + t('nur nachts') : '')));
    meta.appendChild(el('span', undefined, `${fmtKg(sp.weight[0])} – ${fmtKg(sp.weight[1])}`));
    card.appendChild(meta);

    const body = el('div', 'dex-detail-body');
    if (discovered) {
      body.textContent = speciesTrivia(sp);
    } else {
      const locNames = sp.locations.map((id) => (LOCATION_SHORT_LABEL[id] ? t(LOCATION_SHORT_LABEL[id]!) : id)).join(', ');
      body.textContent = `${t('Noch nicht gefangen. Suche')} ${depthLabel(sp.depth)}${sp.nightOnly ? ', ' + t('nachts') : ''}. – ${locNames}.`;
    }
    card.appendChild(body);

    if (discovered) {
      card.appendChild(
        el(
          'div',
          'dex-detail-stats',
          `${entry!.count}× ${t('gefangen')} · ${t('Rekord')} ${fmtKg(entry!.record)}${entry!.shiny ? ` · ${entry!.shiny}× Shiny` : ''}`,
        ),
      );
    }

    wrap.appendChild(card);
    this.host!.appendChild(wrap);
  }
}

// ---------------------------------------------------------------------------
// Shop — spec §1.3
// ---------------------------------------------------------------------------

export type ShopCategoryId = 'rods' | 'baits' | 'bobbers' | 'rodskins' | 'hats' | 'outfits' | 'totems';
type EquippableCategoryId = Exclude<ShopCategoryId, 'totems'>;

interface ShopCategoryDef {
  id: ShopCategoryId;
  label: string;
  icon: IconId;
}

const SHOP_CATEGORIES: readonly ShopCategoryDef[] = [
  { id: 'rods', label: 'Ruten', icon: 'rod' },
  { id: 'baits', label: 'Köder', icon: 'worm' },
  { id: 'bobbers', label: 'Posen', icon: 'bobber' },
  { id: 'rodskins', label: 'Skins', icon: 'palette' },
  { id: 'hats', label: 'Hüte', icon: 'hat' },
  { id: 'outfits', label: 'Outfits', icon: 'coat' },
  { id: 'totems', label: 'Totems', icon: 'orb' },
];

const CATEGORY_ITEMS: Record<EquippableCategoryId, readonly ShopItem[]> = {
  rods: RODS,
  baits: BAITS,
  bobbers: BOBBERS,
  rodskins: RODSKINS,
  hats: HATS,
  outfits: OUTFITS,
};

const CATEGORY_OWNED_KEY: Record<EquippableCategoryId, keyof OwnedCatalog> = {
  rods: 'rods',
  baits: 'baits',
  bobbers: 'bobbers',
  rodskins: 'rodskins',
  hats: 'hats',
  outfits: 'outfits',
};

const CATEGORY_EQUIPPED_KEY: Record<EquippableCategoryId, keyof EquippedCatalog> = {
  rods: 'rod',
  baits: 'bait',
  bobbers: 'bobber',
  rodskins: 'rodskin',
  hats: 'hat',
  outfits: 'outfit',
};

export interface ShopScreenData {
  coins: number;
  gems: number;
  owned: OwnedCatalog;
  equipped: EquippedCatalog;
  /** totem id -> count owned (`SaveData.inv.totem`, or `{}` if never bought one). */
  totemStock?: Readonly<Record<string, number>>;
}

export interface ShopCallbacks {
  onBuyOrEquip?: (category: EquippableCategoryId, itemId: string) => void;
  onBuyTotem?: (itemId: string) => void;
}

export class ShopScreen implements MountableScreen {
  private host: HTMLElement | null = null;
  private data: ShopScreenData | null = null;
  category: ShopCategoryId = 'rods';
  private readonly cb: ShopCallbacks;

  constructor(cb: ShopCallbacks = {}) {
    this.cb = cb;
  }

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('shop-screen');
    this.render();
  }

  update(data: ShopScreenData): void {
    this.data = data;
    this.render();
  }

  setCategory(id: ShopCategoryId): void {
    this.category = id;
    this.render();
  }

  unmount(): void {
    this.host?.replaceChildren();
    this.host = null;
  }

  private render(): void {
    if (!this.host || !this.data) return;
    this.host.replaceChildren();
    if (this.category === 'totems') this.renderTotems();
    else this.renderItems(this.category);
  }

  private renderItems(category: EquippableCategoryId): void {
    const data = this.data!;
    const items = CATEGORY_ITEMS[category];
    const ownedList = data.owned[CATEGORY_OWNED_KEY[category]];
    const equippedId = data.equipped[CATEGORY_EQUIPPED_KEY[category]];
    const list = el('div', 'shop-list');

    for (const item of items) {
      const owned = ownedList.includes(item.id);
      const equipped = equippedId === item.id;
      const row = el('div', 'shop-row');
      row.classList.toggle('is-equipped', equipped);

      const info = el('div', 'shop-row-info');
      info.appendChild(el('div', 'shop-row-name', item.name));
      info.appendChild(el('div', 'shop-row-desc', item.desc));
      row.appendChild(info);

      let label: string;
      let paint: string | undefined;
      let disabled = false;
      let icon: IconId | undefined;

      if (item.price === -1) {
        label = t('Exklusiv');
        paint = PAINT.worn;
        disabled = true;
        icon = 'lock';
      } else if (owned) {
        if (equipped) {
          label = '✔ ' + t('Ausgerüstet');
          paint = PAINT.reward;
          disabled = true;
        } else {
          label = t('Ausrüsten');
          paint = PAINT.info;
        }
      } else if (item.gemPrice) {
        label = String(item.gemPrice);
        paint = PAINT.info;
        icon = 'gem';
        disabled = data.gems < item.gemPrice;
      } else {
        label = String(item.price);
        paint = PAINT.buy;
        disabled = data.coins < item.price;
      }

      const btn = woodButton({ label, paint, disabled, icon, w: 100, h: 38, seed: strSeed(category + ':' + item.id) });
      btn.addEventListener('click', () => {
        if (item.price === -1) return;
        this.cb.onBuyOrEquip?.(category, item.id);
      });
      row.appendChild(btn);
      list.appendChild(row);
    }
    this.host!.appendChild(list);
  }

  private renderTotems(): void {
    const data = this.data!;
    const list = el('div', 'shop-list');
    for (const item of TOTEMS) {
      const stock = data.totemStock?.[item.id] ?? 0;
      const row = el('div', 'shop-row');
      const info = el('div', 'shop-row-info');
      info.appendChild(el('div', 'shop-row-name', item.name));
      info.appendChild(el('div', 'shop-row-desc', item.desc));
      if (stock > 0) info.appendChild(el('div', 'shop-row-stock', `${t('im Vorrat')}: ×${stock}`));
      row.appendChild(info);

      const gemPrice = item.gems;
      const coinPrice = item.price ?? 0;
      let label: string;
      let paint: string;
      let disabled: boolean;
      let icon: IconId | undefined;
      if (gemPrice) {
        label = String(gemPrice);
        paint = PAINT.info;
        icon = 'gem';
        disabled = data.gems < gemPrice;
      } else {
        label = String(coinPrice);
        paint = PAINT.buy;
        disabled = data.coins < coinPrice;
      }
      const btn = woodButton({ label, paint, disabled, icon, w: 100, h: 38, seed: strSeed('totem:' + item.id) });
      btn.addEventListener('click', () => this.cb.onBuyTotem?.(item.id));
      row.appendChild(btn);
      list.appendChild(row);
    }
    this.host!.appendChild(list);
  }
}

// ---------------------------------------------------------------------------
// Daily quests — spec §1.6 (Aufträge tab)
// ---------------------------------------------------------------------------

export interface QuestsScreenData {
  quests: QuestsState | null;
  /** Total completed-ever, for the footer line ("Insgesamt erledigt: {n}"). */
  totalCompleted?: number;
  now?: Date;
}

export class QuestsScreen implements MountableScreen {
  private host: HTMLElement | null = null;
  private data: QuestsScreenData | null = null;

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('quests-screen');
    this.render();
  }

  update(data: QuestsScreenData): void {
    this.data = data;
    this.render();
  }

  unmount(): void {
    this.host?.replaceChildren();
    this.host = null;
  }

  private render(): void {
    if (!this.host || !this.data) return;
    const data = this.data;
    this.host.replaceChildren();

    const list = data.quests?.list ?? [];
    if (list.length === 0) {
      this.host.appendChild(el('div', 'quests-empty', t('Alle erledigt')));
    } else {
      const wrap = el('div', 'quests-list');
      for (const q of list) {
        const row = el('div', 'quests-row');
        row.classList.toggle('is-done', q.done);
        row.appendChild(el('div', 'quests-row-text', q.text));
        const bar = el('div', 'quests-row-bar');
        const fill = el('div', 'quests-row-fill');
        fill.style.width = `${Math.round(Math.min(1, q.progress / Math.max(1, q.target)) * 100)}%`;
        bar.appendChild(fill);
        row.appendChild(bar);
        row.appendChild(el('div', 'quests-row-meta', `${q.progress}/${q.target} · +${q.reward} ${t('Coins')}`));
        if (q.done) row.appendChild(el('span', 'quests-row-check', '✔'));
        wrap.appendChild(row);
      }
      this.host.appendChild(wrap);
    }

    const footer = el('div', 'quests-footer');
    const cd = resetCountdown(data.now ?? new Date());
    footer.appendChild(el('span', undefined, `${t('Neue Aufträge in')} ${cd.hours}${t('Std')} ${cd.minutes}${t('min')}`));
    if (data.totalCompleted != null) {
      footer.appendChild(el('span', undefined, `${t('Insgesamt erledigt:')} ${data.totalCompleted}`));
    }
    this.host.appendChild(footer);
  }
}

// ---------------------------------------------------------------------------
// Settings — spec §1.8
// ---------------------------------------------------------------------------

export type QualityTier = 'sharp' | 'balanced' | 'perf';

export interface SettingsScreenData {
  lang: 'de' | 'en';
  musicOn: boolean;
  sfxOn: boolean;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  quality: QualityTier;
  haptics: boolean;
  version: string;
}

export interface SettingsCallbacks {
  onLangChange?: (lang: 'de' | 'en') => void;
  onMusicToggle?: (on: boolean) => void;
  onSfxToggle?: (on: boolean) => void;
  onMusicVolume?: (v: number) => void;
  onSfxVolume?: (v: number) => void;
  onAmbienceVolume?: (v: number) => void;
  onQualityChange?: (q: QualityTier) => void;
  onHapticsToggle?: (on: boolean) => void;
  /** The version line is also the spec §9.7 5-tap dev-mode gesture; wiring the count is the caller's job. */
  onVersionTap?: () => void;
}

export class SettingsScreen implements MountableScreen {
  private host: HTMLElement | null = null;
  private data: SettingsScreenData | null = null;
  private readonly cb: SettingsCallbacks;

  constructor(cb: SettingsCallbacks = {}) {
    this.cb = cb;
  }

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('settings-screen');
    this.render();
  }

  update(data: SettingsScreenData): void {
    this.data = data;
    this.render();
  }

  unmount(): void {
    this.host?.replaceChildren();
    this.host = null;
  }

  private render(): void {
    if (!this.host || !this.data) return;
    const data = this.data;
    this.host.replaceChildren();

    const wrap = el('div', 'settings-list');
    wrap.appendChild(this.toggleRow(t('Ton'), data.sfxOn, (v) => this.cb.onSfxToggle?.(v)));
    wrap.appendChild(this.sliderRow(t('Ton'), data.sfxVolume, (v) => this.cb.onSfxVolume?.(v)));
    wrap.appendChild(this.toggleRow(t('Musik'), data.musicOn, (v) => this.cb.onMusicToggle?.(v)));
    wrap.appendChild(this.sliderRow(t('Musik'), data.musicVolume, (v) => this.cb.onMusicVolume?.(v)));
    wrap.appendChild(this.sliderRow(trLocal('Umgebung', 'Ambience'), data.ambienceVolume, (v) => this.cb.onAmbienceVolume?.(v)));
    wrap.appendChild(this.langRow(data.lang));
    wrap.appendChild(this.qualityRow(data.quality));
    wrap.appendChild(this.toggleRow(trLocal('Haptik', 'Haptics'), data.haptics, (v) => this.cb.onHapticsToggle?.(v)));

    const version = el('div', 'settings-version', `v${data.version}`);
    version.addEventListener('click', () => this.cb.onVersionTap?.());
    wrap.appendChild(version);

    this.host.appendChild(wrap);
  }

  private toggleRow(label: string, on: boolean, onChange: (v: boolean) => void): HTMLElement {
    const row = el('div', 'settings-row');
    row.appendChild(el('div', 'settings-row-label', label));
    const btn = woodButton({ label: on ? t('EIN') : t('AUS'), paint: on ? PAINT.reward : PAINT.worn, w: 84, h: 36, seed: strSeed('toggle:' + label) });
    btn.addEventListener('click', () => onChange(!on));
    row.appendChild(btn);
    return row;
  }

  private sliderRow(label: string, value: number, onChange: (v: number) => void): HTMLElement {
    const row = el('div', 'settings-row');
    row.appendChild(el('div', 'settings-row-label', label));
    const input = el('input', 'settings-slider') as HTMLInputElement;
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = String(value);
    input.addEventListener('input', () => onChange(Number(input.value)));
    row.appendChild(input);
    return row;
  }

  private langRow(lang: 'de' | 'en'): HTMLElement {
    const row = el('div', 'settings-row');
    row.appendChild(el('div', 'settings-row-label', t('Sprache')));
    const group = el('div', 'settings-lang-group');
    for (const l of ['de', 'en'] as const) {
      const btn = woodButton({ label: l.toUpperCase(), paint: lang === l ? PAINT.info : undefined, w: 56, h: 36, seed: strSeed('lang:' + l) });
      btn.addEventListener('click', () => this.cb.onLangChange?.(l));
      group.appendChild(btn);
    }
    row.appendChild(group);
    return row;
  }

  private qualityRow(quality: QualityTier): HTMLElement {
    const row = el('div', 'settings-row');
    row.appendChild(el('div', 'settings-row-label', trLocal('Qualität', 'Quality')));
    const group = el('div', 'settings-quality-group');
    const opts: ReadonlyArray<readonly [QualityTier, string]> = [
      ['sharp', trLocal('Scharf', 'Sharp')],
      ['balanced', trLocal('Ausgewogen', 'Balanced')],
      ['perf', trLocal('Sparsam', 'Efficient')],
    ];
    for (const [id, label] of opts) {
      const btn = woodButton({ label, paint: quality === id ? PAINT.info : undefined, w: 96, h: 36, seed: strSeed('quality:' + id) });
      btn.addEventListener('click', () => this.cb.onQualityChange?.(id));
      group.appendChild(btn);
    }
    row.appendChild(group);
    return row;
  }
}

// ---------------------------------------------------------------------------
// Achievements — spec §1.7
//
// The old game has no standalone achievements.ts-equivalent data file among
// this port's read-only sources (only the flat i18n dictionary strings, spec
// §6.4) — this local catalog pairs the dictionary's own name/description
// string pairs (verbatim, in their original dictionary order) with a
// reasonable existing icon. `id`s are slugs local to THIS catalog (not the
// old game's internal short codes, which aren't documented in the files
// this port read) — see this agent's final report for that caveat.
// ---------------------------------------------------------------------------

export interface AchievementDef {
  id: string;
  nameDe: string;
  /** Empty for the two entries where the dictionary had no distinct desc string (see file header). */
  descDe: string;
  icon: IconId;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'warmgeangelt', nameDe: 'Warmgeangelt', descDe: '10 Fänge', icon: 'fish' },
  { id: 'seebaer', nameDe: 'Seebär', descDe: '50 Fänge', icon: 'fish' },
  { id: 'ersterFang', nameDe: 'Erster Fang', descDe: '', icon: 'sparkle' },
  { id: 'schuhgroesse44', nameDe: 'Schuhgröße 44', descDe: 'Einen Stiefel gefangen', icon: 'net' },
  { id: 'brieftraeger', nameDe: 'Briefträger', descDe: 'Eine Flaschenpost gefunden', icon: 'note' },
  { id: 'yohoho', nameDe: 'Yo-ho-ho', descDe: 'Eine Schatzkiste geborgen', icon: 'gift' },
  { id: 'nachtangler', nameDe: 'Nachtangler', descDe: 'Einen Nachtfisch gefangen', icon: 'moon' },
  { id: 'legende', nameDe: 'Legende', descDe: 'Einen Mondfisch gefangen', icon: 'moon' },
  { id: 'schwergewicht', nameDe: 'Schwergewicht', descDe: 'Ein Fang über 20 kg', icon: 'trophy' },
  { id: 'sammler', nameDe: 'Sammler', descDe: '6 Arten im Fischdex', icon: 'book' },
  { id: 'fischdexKomplett', nameDe: 'Fischdex komplett', descDe: 'Alle Arten entdeckt', icon: 'book' },
  { id: 'heisseSerie', nameDe: 'Heiße Serie', descDe: '5 Fänge in Folge', icon: 'flame' },
  { id: 'wieAmSchnuerchen', nameDe: 'Wie am Schnürchen', descDe: 'Ein perfekter Drill', icon: 'star' },
  { id: 'regenangler', nameDe: 'Regenangler', descDe: 'Im Regen gefangen', icon: 'rain' },
  { id: 'moewenschreck', nameDe: 'Möwenschreck', descDe: 'Eine Möwe verjagt', icon: 'horn' },
  { id: 'goldesel', nameDe: 'Goldesel', descDe: '1000 Coins insgesamt verdient', icon: 'gem' },
  { id: 'reisender', nameDe: 'Reisender', descDe: 'Einen neuen Angelplatz freigeschaltet', icon: 'map' },
  { id: 'weltenbummler', nameDe: 'Weltenbummler', descDe: 'Alle Angelplätze freigeschaltet', icon: 'globe' },
  { id: 'meeresbiologe', nameDe: 'Meeresbiologe', descDe: '50 Arten entdeckt', icon: 'book' },
  { id: 'hundert', nameDe: 'Hundert!', descDe: '100 Arten entdeckt', icon: 'trophy' },
  { id: 'sieExistiert', nameDe: 'Sie existiert', descDe: 'Nessie gefangen', icon: 'sparkle' },
  { id: 'falscherKontinent', nameDe: 'Falscher Kontinent', descDe: 'Einen Pinguin geangelt', icon: 'fish' },
  { id: 'achtArme', nameDe: 'Acht Arme', descDe: 'Einen Oktopus gefangen', icon: 'fish' },
  { id: 'daUntenLeuchtetWas', nameDe: 'Da unten leuchtet was', descDe: 'Fang in der Tiefsee', icon: 'sparkle' },
  { id: 'esGlitzert', nameDe: 'Es glitzert!', descDe: 'Einen Shiny-Fisch gefangen', icon: 'sparkle' },
  { id: 'shinyJaeger', nameDe: 'Shiny-Jäger', descDe: '10 Shiny-Fische gefangen', icon: 'sparkle' },
  { id: 'glueckspilz', nameDe: 'Glückspilz', descDe: 'Jackpot aus der Wundertüte', icon: 'gift' },
  { id: 'zocker', nameDe: 'Zocker', descDe: '20 Wundertüten geöffnet', icon: 'gift' },
  { id: 'fleissig', nameDe: 'Fleißig', descDe: '10 Tagesaufträge erledigt', icon: 'clipboard' },
  { id: 'angeberfoto', nameDe: 'Angeberfoto', descDe: 'Einen Fang geteilt', icon: 'tv' },
  { id: 'keinAnfaengerMehr', nameDe: 'Kein Anfänger mehr', descDe: 'Level 10 erreicht', icon: 'star' },
  { id: 'level25', nameDe: 'Level 25 erreicht', descDe: '', icon: 'star' },
  { id: 'stammgast', nameDe: 'Stammgast', descDe: '7 Tage in Folge eingeloggt', icon: 'calendar' },
  { id: 'ortskundig', nameDe: 'Ortskundig', descDe: 'Fischdex eines Orts komplett', icon: 'book' },
  { id: 'bosskaempfer', nameDe: 'Bosskämpfer', descDe: 'Einen Bossfisch besiegt', icon: 'trident' },
  { id: 'herrDerGewaesser', nameDe: 'Herr der Gewässer', descDe: 'Alle sechs Bosse besiegt', icon: 'trophy' },
];

export interface AchievementsScreenData {
  /** `SaveData.achievements`, verbatim. */
  unlockedIds: readonly string[];
}

export class AchievementsScreen implements MountableScreen {
  private host: HTMLElement | null = null;
  private data: AchievementsScreenData | null = null;

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('achievements-screen');
    this.render();
  }

  update(data: AchievementsScreenData): void {
    this.data = data;
    this.render();
  }

  unmount(): void {
    this.host?.replaceChildren();
    this.host = null;
  }

  private render(): void {
    if (!this.host || !this.data) return;
    const set = new Set(this.data.unlockedIds);
    this.host.replaceChildren();
    const list = el('div', 'ach-list');
    for (const a of ACHIEVEMENTS) {
      const unlocked = set.has(a.id);
      const row = el('div', 'ach-row');
      row.classList.toggle('is-locked', !unlocked);
      const iconImg = el('img', 'ach-row-icon') as HTMLImageElement;
      iconImg.src = bakeIcon(unlocked ? a.icon : 'lock', 26);
      iconImg.alt = '';
      row.appendChild(iconImg);
      const info = el('div', 'ach-row-info');
      info.appendChild(el('div', 'ach-row-name', t(a.nameDe)));
      if (a.descDe) info.appendChild(el('div', 'ach-row-desc', t(a.descDe)));
      row.appendChild(info);
      if (unlocked) row.appendChild(el('span', 'ach-row-check', '✔'));
      list.appendChild(row);
    }
    this.host.appendChild(list);
  }
}

// ---------------------------------------------------------------------------
// Screens — owns one Sheet, swaps screen content into it.
// ---------------------------------------------------------------------------

export type ScreenId = 'dex' | 'shop' | 'quests' | 'settings' | 'achievements';

export type ScreenOpenRequest =
  | { id: 'dex'; data: DexScreenData }
  | { id: 'shop'; data: ShopScreenData }
  | { id: 'quests'; data: QuestsScreenData }
  | { id: 'settings'; data: SettingsScreenData }
  | { id: 'achievements'; data: AchievementsScreenData };

export interface ScreensCallbacks {
  shop?: ShopCallbacks;
  settings?: SettingsCallbacks;
  /** Called once the sheet finishes closing (any screen). */
  onClose?: () => void;
}

interface ScreenTheme {
  icon: IconId;
  accent: string;
  titleDe: string;
}

/** spec §1.0 OVERLAY_THEME, restricted to the 5 screens this file owns. */
const SCREEN_THEME: Record<ScreenId, ScreenTheme> = {
  dex: { icon: 'book', accent: '#4aa3ff', titleDe: 'Fischdex' },
  shop: { icon: 'tacklebox', accent: '#ff8c00', titleDe: 'Shop' },
  quests: { icon: 'clipboard', accent: '#c072ff', titleDe: 'Tagesaufträge' },
  settings: { icon: 'gear', accent: '#d8b25a', titleDe: 'Einstellungen' },
  achievements: { icon: 'trophy', accent: '#8b7cf6', titleDe: 'Erfolge' },
};

export class Screens {
  private readonly sheet: Sheet;
  private current: ScreenId | null = null;
  private mountedScreen: MountableScreen | null = null;

  private readonly dex = new DexScreen();
  private readonly shop: ShopScreen;
  private readonly quests = new QuestsScreen();
  private readonly settings: SettingsScreen;
  private readonly achievements = new AchievementsScreen();
  private readonly onCloseCb: (() => void) | undefined;

  constructor(container: HTMLElement, cb: ScreensCallbacks = {}) {
    this.sheet = new Sheet(container);
    this.shop = new ShopScreen(cb.shop ?? {});
    this.settings = new SettingsScreen(cb.settings ?? {});
    this.onCloseCb = cb.onClose;
  }

  get isOpen(): boolean {
    return this.sheet.isOpen;
  }

  /** Whether the currently-open screen fills most of the viewport — the engine can skip the world redraw while true. */
  get coversWorld(): boolean {
    return this.sheet.coversWorld;
  }

  get openId(): ScreenId | null {
    return this.current;
  }

  open(req: ScreenOpenRequest): void {
    switch (req.id) {
      case 'dex':
        this.openDex(req.data);
        break;
      case 'shop':
        this.openShop(req.data);
        break;
      case 'quests':
        this.openQuests(req.data);
        break;
      case 'settings':
        this.openSettings(req.data);
        break;
      case 'achievements':
        this.openAchievements(req.data);
        break;
    }
  }

  close(): void {
    this.sheet.close();
  }

  destroy(): void {
    this.sheet.destroy();
  }

  private openDex(data: DexScreenData): void {
    this.dex.update(data);
    const tabs: SheetTab[] = LOCATIONS.map((loc) => ({
      id: loc.id,
      label: t(LOCATION_SHORT_LABEL[loc.id] ?? loc.name),
      badge: this.dex.unseenCountFor(loc.id),
    }));
    const total = SPECIES.length;
    const discovered = Object.keys(data.dex).length;
    this.openSheet(
      'dex',
      { title: `${t('Fischdex')} ${discovered}/${total}`, tabs, activeTab: this.dex.location, onTabChange: (id) => this.dex.setLocation(id) },
      this.dex,
    );
  }

  private openShop(data: ShopScreenData): void {
    this.shop.update(data);
    const tabs: SheetTab[] = SHOP_CATEGORIES.map((c) => ({ id: c.id, label: t(c.label), icon: c.icon }));
    this.openSheet(
      'shop',
      { title: t('Shop'), tabs, activeTab: this.shop.category, onTabChange: (id) => this.shop.setCategory(id as ShopCategoryId) },
      this.shop,
    );
  }

  private openQuests(data: QuestsScreenData): void {
    this.quests.update(data);
    this.openSheet('quests', { title: t('Tagesaufträge') }, this.quests);
  }

  private openSettings(data: SettingsScreenData): void {
    this.settings.update(data);
    this.openSheet('settings', { title: t('Einstellungen') }, this.settings);
  }

  private openAchievements(data: AchievementsScreenData): void {
    this.achievements.update(data);
    this.openSheet('achievements', { title: t('Erfolge') }, this.achievements);
  }

  private openSheet(
    id: ScreenId,
    extra: { title: string; tabs?: SheetTab[]; activeTab?: string; onTabChange?: (id: string) => void },
    screen: MountableScreen,
  ): void {
    const theme = SCREEN_THEME[id];
    const sameScreenAlreadyOpen = this.current === id && this.sheet.isOpen;
    const body = this.sheet.open({
      title: extra.title,
      icon: theme.icon,
      accent: theme.accent,
      tabs: extra.tabs,
      activeTab: extra.activeTab,
      onTabChange: extra.onTabChange,
      onClose: () => {
        if (this.current === id) this.current = null;
        this.onCloseCb?.();
      },
    });
    if (!sameScreenAlreadyOpen) {
      this.mountedScreen?.unmount();
      screen.mount(body);
      this.mountedScreen = screen;
    }
    this.current = id;
  }
}
