/**
 * CatchCard — the full-screen catch-result modal (spec `05-ui-hub-story.md`
 * §1.11): fish name/art/rarity/weight, the coin payout with its
 * multiplier breakdown, NEW-in-dex/record/perfect/shiny ribbons, a share
 * button, and "tap to continue". Plus `LevelUpPopup`, the sibling level-up
 * screen from the same spec section.
 *
 * Deliberately NOT an `overlay`-state Sheet screen (spec: "not an
 * overlay-state screen; a standalone full-screen modal") — it is its own
 * small class with `show(container, data)`/`hide()`, matching the old
 * game's `catchInfo`-driven full-screen popup rather than the bottom-sheet
 * chrome `sheet.ts` provides. Per CLAUDE.md rule 2 it is still not an
 * opaque full-screen surface: the scrim is translucent CSS and the card
 * itself is a small centered, content-sized element — the world stays
 * visible (dimmed) behind it, exactly like the sheet's scrim.
 *
 * Animation: spec's 350ms cubic scale-in with a small fixed rotation ("the
 * certificate never hangs perfectly straight") is done with a CSS
 * transition plus a per-catch deterministic tilt (hashed from the species
 * id, so the same species doesn't visibly "reset" to dead-straight between
 * catches, without pulling in `bake/baker.ts`'s `prnd`).
 */

import { el, woodButton } from './dom';
import { t, num } from './i18n';
import type { Species } from '@/data/species';
import { rarityColor, rarityName, fmtKg, speciesName, speciesCanvas } from './screens';

// ---------------------------------------------------------------------------
// Catch card
// ---------------------------------------------------------------------------

export interface CoinsBreakdown {
  /** Base coin value before streak/perfect/shiny multipliers (catch.ts `rollCoins`'s `base`). */
  base: number;
  /** Combined streak × perfect multiplier (catch.ts `CatchResult.multiplier`). Junk catches: 1. */
  multiplier: number;
  /** Present + >1 only for shiny catches (catch.ts `SHINY_COIN_MULT`, always 5 when shiny). */
  shinyMult?: number;
}

export interface CatchCardData {
  species: Species;
  weightKg: number;
  shiny?: boolean;
  perfect?: boolean;
  newInDex?: boolean;
  newRecord?: boolean;
  coins: number;
  coinsBreakdown?: CoinsBreakdown;
  /** Coins the seagull stole from this catch, if any (catch.ts `seagullTheftAmount`). */
  seagullStole?: number;
  /** A smaller "fish inside the fish" bonus catch (spec 5.8 / §1.11 bycatch line). */
  bycatch?: { name: string; kg: number } | null;
  /** Header swaps to "BOSS BESIEGT!"/"BOSS DEFEATED!". */
  boss?: boolean;
  /** Header swaps to "Na toll…"/"Oh great…" (junk catch). */
  junk?: boolean;
}

export interface CatchCardCallbacks {
  onContinue?: () => void;
  onShare?: () => void;
}

/** Deterministic small tilt in degrees (≈ ±0.86°, spec's `(prnd(500,2)-0.5)*0.03` rad) from a string id. */
function smallTiltDeg(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const frac = (Math.abs(h) % 1000) / 1000; // 0..1
  return (frac - 0.5) * 1.72;
}

export class CatchCard {
  private root: HTMLElement | null = null;
  private readonly cb: CatchCardCallbacks;

  constructor(cb: CatchCardCallbacks = {}) {
    this.cb = cb;
  }

  get isOpen(): boolean {
    return this.root != null;
  }

  show(container: HTMLElement, data: CatchCardData): void {
    this.hide();

    const scrim = el('div', 'catchcard-scrim');
    const card = el('div', 'catchcard');
    card.style.setProperty('--rarity-color', rarityColor(data.species.rarity));
    card.style.setProperty('--catchcard-tilt', `${smallTiltDeg(data.species.id)}deg`);

    let headerText = t('Fisch gefangen!');
    if (data.junk) headerText = t('Na toll…');
    if (data.boss) headerText = t('BOSS BESIEGT!');
    card.appendChild(el('div', 'catchcard-header', headerText));

    card.appendChild(speciesCanvas(data.species, 160, 118, { shiny: data.shiny }));
    card.appendChild(el('div', 'catchcard-name', speciesName(data.species)));
    card.appendChild(el('div', 'catchcard-subtitle', `${rarityName(data.species.rarity)} · ${fmtKg(data.weightKg)}`));

    const ribbons = el('div', 'catchcard-ribbons');
    if (data.newInDex) ribbons.appendChild(el('span', 'catchcard-ribbon ribbon-new', t('NEU im Fischdex!')));
    if (data.newRecord) ribbons.appendChild(el('span', 'catchcard-ribbon ribbon-record', t('Neuer Rekord!')));
    if (data.perfect) ribbons.appendChild(el('span', 'catchcard-ribbon ribbon-perfect', t('Perfekter Drill ×1.5')));
    if (data.shiny) ribbons.appendChild(el('span', 'catchcard-ribbon ribbon-shiny', t('SHINY ×5')));
    if (ribbons.childElementCount > 0) card.appendChild(ribbons);

    const coinsLine = el('div', 'catchcard-coins', `+${data.coins}`);
    if (data.seagullStole) coinsLine.classList.add('is-stolen');
    card.appendChild(coinsLine);

    if (data.coinsBreakdown) {
      const b = data.coinsBreakdown;
      const parts: string[] = [String(b.base)];
      if (Math.abs(b.multiplier - 1) > 0.001) parts.push(`×${num(b.multiplier, 2)}`);
      if (b.shinyMult && b.shinyMult !== 1) parts.push(`×${b.shinyMult}`);
      if (parts.length > 1) card.appendChild(el('div', 'catchcard-breakdown', parts.join(' · ')));
    }

    if (data.seagullStole) {
      card.appendChild(el('div', 'catchcard-seagull', `${t('Die Möwe hat')} ${data.seagullStole} ${t('geklaut!')}`));
    }

    if (data.bycatch) {
      card.appendChild(el('div', 'catchcard-bycatch', `+ ${data.bycatch.name} (${fmtKg(data.bycatch.kg)})`));
    }

    card.appendChild(el('div', 'catchcard-footer', t('Klicken zum Weiterangeln')));

    const shareBtn = woodButton({ label: t('Fang teilen'), icon: 'tv', w: 170, h: 38, seed: 7001 });
    shareBtn.classList.add('catchcard-share');
    shareBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.cb.onShare?.();
    });
    card.appendChild(shareBtn);

    scrim.appendChild(card);
    scrim.addEventListener('click', () => {
      this.cb.onContinue?.();
      this.hide();
    });

    container.appendChild(scrim);
    this.root = scrim;
    void scrim.getBoundingClientRect();
    requestAnimationFrame(() => scrim.classList.add('is-live'));
  }

  hide(): void {
    this.root?.remove();
    this.root = null;
  }
}

// ---------------------------------------------------------------------------
// Level-up popup — spec §1.11 `drawLevelUp`
// ---------------------------------------------------------------------------

export interface LevelUpData {
  level: number;
  anglerTitle: string;
  coins: number;
  /** Only every 5th level grants a gem (progress.ts `addXP`). */
  gems?: number;
  /** Present when a location's unlock level was just reached (progress.ts `LevelUpEvent.revealedLocationId`). */
  unlockedLocationName?: string;
  unlockedLocationLevel?: number;
}

export interface LevelUpCallbacks {
  onContinue?: () => void;
  onTravel?: () => void;
}

export class LevelUpPopup {
  private root: HTMLElement | null = null;
  private readonly cb: LevelUpCallbacks;

  constructor(cb: LevelUpCallbacks = {}) {
    this.cb = cb;
  }

  get isOpen(): boolean {
    return this.root != null;
  }

  show(container: HTMLElement, data: LevelUpData): void {
    this.hide();

    const scrim = el('div', 'levelup-scrim');
    const panel = el('div', 'levelup-panel');
    panel.classList.toggle('has-unlock', !!data.unlockedLocationName);

    panel.appendChild(el('div', 'levelup-label', t('LEVEL AUFSTIEG')));
    panel.appendChild(el('div', 'levelup-number', String(data.level)));
    panel.appendChild(el('div', 'levelup-title', data.anglerTitle));

    let rewardText = `+${data.coins} ${t('Coins')}`;
    if (data.gems) rewardText += ` +${data.gems} 💎`;
    rewardText += ' +1 ⭐';
    panel.appendChild(el('div', 'levelup-reward', rewardText));

    if (data.unlockedLocationName) {
      panel.appendChild(el('div', 'levelup-unlock', `🏝 ${t('Ort')} ${t('freigeschaltet!')}`));
      const levelPart = data.unlockedLocationLevel != null ? ` · ${t('ab Level')} ${data.unlockedLocationLevel}` : '';
      panel.appendChild(el('div', 'levelup-teaser', `${t('Nächster Ort:')} ${data.unlockedLocationName}${levelPart}`));
      const travelBtn = woodButton({ label: t('hinfahren'), w: 150, h: 38, seed: 7101 });
      travelBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.cb.onTravel?.();
        this.hide();
      });
      panel.appendChild(travelBtn);
    }

    panel.appendChild(el('div', 'levelup-footer', t('Tippen zum Weiterspielen')));

    scrim.appendChild(panel);
    scrim.addEventListener('click', () => {
      this.cb.onContinue?.();
      this.hide();
    });

    container.appendChild(scrim);
    this.root = scrim;
    void scrim.getBoundingClientRect();
    requestAnimationFrame(() => scrim.classList.add('is-live'));
  }

  hide(): void {
    this.root?.remove();
    this.root = null;
  }
}
