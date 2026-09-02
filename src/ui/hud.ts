/**
 * Hud — the fishing-place HUD (spec `05-ui-hub-story.md` §1.1/§1.2), rebuilt
 * as small DOM elements over the Pixi canvas. Deliberately renderer-free: it
 * takes a plain data object (`HudState`, defined here) and never imports
 * from `src/game` — those modules are being written concurrently by another
 * agent, and this file only needs to know what to display, not how the game
 * computes it.
 *
 * Layout uses the safe-area CSS variables already defined in `ui.css`
 * (`--sat/--sab/--sal/--sar`) and is sized against the 390×844 reference
 * frame from the spec, with `min()`/`clamp()` so it still fits a narrower
 * or safe-area-inset device without reading `env()` again in TS.
 */

import { el, woodButton, countBadge } from './dom';
import { bakeIcon, type IconId } from './icons';
import { applyNineSlice, bakePanel, shadeColor } from './wood';
import { t } from './i18n';

export type TimeOfDay = 'day' | 'dusk' | 'night';

export interface HudRodState {
  name: string;
  /** current upgrade tier suffix, e.g. 2 -> "+2" */
  upgradeLevel?: number;
  /** an affordable next upgrade exists — shows the pulsing gold arrow */
  upgradeAvailable?: boolean;
  upgradeCost?: number;
}

export interface HudBadges {
  dex?: number;
  shop?: number;
  bonus?: number;
  /** bonus badge is the "ready to claim" green-filled kind rather than a plain red dot */
  bonusClaimable?: boolean;
}

/** Everything the HUD needs to render one frame of state. Renderer-free by design. */
export interface HudState {
  coins: number;
  gems: number;
  /** already rounded to the nearest 10 minutes, "HH:MM", per spec §1.1 */
  clock?: string;
  timeOfDay?: TimeOfDay;
  level: number;
  anglerTitle: string;
  xp: number;
  xpToNext: number;
  skillPoints?: number;
  /** true while the hub screen is open — hides the clock and dims the Menü board */
  hub?: boolean;
  hubBlocked?: boolean;
  newLocationAvailable?: boolean;
  rod: HudRodState;
  bait?: { name: string };
  /** dive mode replaces the rod/bait card with a single harpoon line */
  harpoon?: { name: string };
  badges?: HudBadges;
}

export interface HudCallbacks {
  /** whole status card is one button (spec: opens the Talents/Angler overlay) */
  onStatusCard?: () => void;
  onMenu?: () => void;
  /** rod/bait/harpoon card → opens the Shop on that item's tab */
  onGear?: () => void;
  onDex?: () => void;
  onShop?: () => void;
  onBonus?: () => void;
}

const COIN_ICON_CACHE = new Map<number, string>();
/** `drawCoinIcon` from the old game — deliberately not an emoji (spec §1.1: emoji coin colour/shape differs by OS). Not one of the 38 `icons.js` icons, so it lives here rather than in `icons.ts`. */
function bakeCoinIcon(sizeCss = 20): string {
  const hit = COIN_ICON_CACHE.get(sizeCss);
  if (hit) return hit;
  const scale = Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 3);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.max(1, Math.round(sizeCss * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  const r = sizeCss / 2, cx = r, cy = r;
  ctx.save();
  ctx.fillStyle = '#a8720a';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.96, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r * 0.9);
  g.addColorStop(0, '#fff3b6'); g.addColorStop(0.55, '#ffd23a'); g.addColorStop(1, '#dc9d05');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(150,92,0,0.55)'; ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = shadeColor('#a8720a', -0.25);
  ctx.font = `bold ${Math.round(r * 1.1)}px 'Baloo 2','Segoe UI',system-ui,sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('¢', cx, cy + r * 0.04);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.ellipse(cx - r * 0.32, cy - r * 0.34, r * 0.28, r * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  const url = canvas.toDataURL('image/png');
  COIN_ICON_CACHE.set(sizeCss, url);
  return url;
}

function icon(id: IconId, size: number, cls?: string): HTMLImageElement {
  const img = el('img', cls) as HTMLImageElement;
  img.src = bakeIcon(id, size);
  img.width = size; img.height = size;
  img.alt = '';
  return img;
}

let toastSeq = 0;

export class Hud {
  readonly root: HTMLElement;
  private statusCard: HTMLElement;
  private coinsEl: HTMLElement;
  private gemsEl: HTMLElement;
  private clockWrap: HTMLElement;
  private clockIcon: HTMLImageElement;
  private clockText: HTMLElement;
  private levelChip: HTMLElement;
  private titleEl: HTMLElement;
  private xpText: HTMLElement;
  private xpFill: HTMLElement;
  private skillBadge: HTMLElement;
  private menuBtn: HTMLButtonElement;
  private gearBtn: HTMLButtonElement;
  private gearLine1: HTMLElement;
  private gearLine2: HTMLElement;
  private dexBadgeSlot: HTMLElement;
  private shopBadgeSlot: HTMLElement;
  private bonusBadgeSlot: HTMLElement;
  private toastHost: HTMLElement;

  constructor(container: HTMLElement, cb: HudCallbacks = {}) {
    this.root = el('div', 'hud');

    // --- status card -------------------------------------------------
    this.statusCard = el('button', 'hud-status');
    this.statusCard.setAttribute('type', 'button');
    // The status card was the only wooden element left undressed — every
    // other board in the HUD goes through woodButton, which applies the
    // nine-slice itself, so this one silently rendered as floating text over
    // the sky.
    applyNineSlice(this.statusCard, bakePanel({ w: 250, h: 64, r: 12, slice: 22, seed: 17 }));
    const row1 = el('div', 'hud-status-row1');
    const coinIco = el('img', 'hud-coin-icon') as HTMLImageElement;
    coinIco.src = bakeCoinIcon(20); coinIco.alt = '';
    this.coinsEl = el('span', 'hud-coins', '0');
    const gemIco = icon('gem', 16, 'hud-gem-icon');
    this.gemsEl = el('span', 'hud-gems', '0');
    this.clockIcon = icon('sun', 14, 'hud-clock-icon');
    this.clockText = el('span', 'hud-clock-text', '');
    this.clockWrap = el('span', 'hud-clock');
    this.clockWrap.append(this.clockIcon, this.clockText);
    row1.append(coinIco, this.coinsEl, gemIco, this.gemsEl, this.clockWrap);

    const divider = el('div', 'hud-divider');

    const row2 = el('div', 'hud-status-row2');
    this.levelChip = el('span', 'hud-level-chip', '1');
    this.titleEl = el('span', 'hud-title', '');
    this.xpText = el('span', 'hud-xp-text', '0 / 0 XP');
    row2.append(this.levelChip, this.titleEl, this.xpText);

    const xpBar = el('div', 'hud-xp-bar');
    this.xpFill = el('div', 'hud-xp-fill');
    xpBar.appendChild(this.xpFill);

    this.skillBadge = countBadge(0, { claimable: true });
    this.skillBadge.classList.add('hud-skill-badge');
    this.skillBadge.hidden = true;

    this.statusCard.append(row1, divider, row2, xpBar, this.skillBadge);
    if (cb.onStatusCard) this.statusCard.addEventListener('click', cb.onStatusCard);

    // --- gear column (Menü + rod/bait) --------------------------------
    const gearCol = el('div', 'hud-gear-col');
    this.menuBtn = woodButton({ icon: 'tank', label: t('Menü'), w: 122, h: 44, seed: 401 });
    this.menuBtn.classList.add('hud-menu-btn');
    if (cb.onMenu) this.menuBtn.addEventListener('click', cb.onMenu);

    this.gearBtn = woodButton({ w: 122, h: 44, seed: 402 });
    this.gearBtn.classList.add('hud-gear-btn');
    this.gearLine1 = el('span', 'hud-gear-line');
    this.gearLine2 = el('span', 'hud-gear-line');
    this.gearBtn.append(this.gearLine1, this.gearLine2);
    if (cb.onGear) this.gearBtn.addEventListener('click', cb.onGear);

    gearCol.append(this.menuBtn, this.gearBtn);

    // --- bottom bar ----------------------------------------------------
    const bottomBar = el('div', 'hud-bottombar');
    const dexBtn = woodButton({ icon: 'book', label: t('Fischdex'), seed: 403 });
    const shopBtn = woodButton({ icon: 'tacklebox', label: t('Shop'), seed: 404 });
    const bonusBtn = woodButton({ icon: 'gift', label: t('Bonus'), seed: 405 });
    dexBtn.classList.add('hud-bar-btn'); shopBtn.classList.add('hud-bar-btn'); bonusBtn.classList.add('hud-bar-btn');
    if (cb.onDex) dexBtn.addEventListener('click', cb.onDex);
    if (cb.onShop) shopBtn.addEventListener('click', cb.onShop);
    if (cb.onBonus) bonusBtn.addEventListener('click', cb.onBonus);
    this.dexBadgeSlot = el('span', 'hud-bar-badge-slot'); dexBtn.appendChild(this.dexBadgeSlot);
    this.shopBadgeSlot = el('span', 'hud-bar-badge-slot'); shopBtn.appendChild(this.shopBadgeSlot);
    this.bonusBadgeSlot = el('span', 'hud-bar-badge-slot'); bonusBtn.appendChild(this.bonusBadgeSlot);
    bottomBar.append(dexBtn, shopBtn, bonusBtn);

    // --- toast host ------------------------------------------------------
    this.toastHost = el('div', 'hud-toasts');

    this.root.append(this.statusCard, gearCol, bottomBar, this.toastHost);
    container.appendChild(this.root);
  }

  /** Apply one plain state snapshot to the DOM. Cheap: only touches text/classes that changed conceptually. */
  update(state: HudState): void {
    this.coinsEl.textContent = String(state.coins);
    this.gemsEl.textContent = String(state.gems);

    const inHub = !!state.hub;
    this.clockWrap.hidden = inHub || !state.clock;
    if (!inHub && state.clock) {
      this.clockText.textContent = state.clock;
      const tod = state.timeOfDay ?? 'day';
      this.clockIcon.src = bakeIcon(tod === 'night' ? 'moon' : 'sun', 14);
      this.clockIcon.style.filter = tod === 'dusk' ? 'sepia(0.5) saturate(2) hue-rotate(-20deg) brightness(0.9)' : '';
    }

    this.levelChip.textContent = String(state.level);
    this.titleEl.textContent = state.anglerTitle;
    // "XP" itself has no dictionary entry in the old game (spec §6.4) and is
    // shown unchanged in both languages — only the surrounding words translate.
    this.xpText.textContent = `${state.xp} / ${state.xpToNext} XP`;
    const pct = state.xpToNext > 0 ? Math.max(0, Math.min(1, state.xp / state.xpToNext)) : 0;
    this.xpFill.style.width = `${Math.round(pct * 100)}%`;

    const sp = state.skillPoints ?? 0;
    this.skillBadge.hidden = sp <= 0;

    this.menuBtn.style.opacity = state.hubBlocked ? '0.45' : '1';
    this.menuBtn.classList.toggle('has-marker', !!state.newLocationAvailable);

    if (state.harpoon) {
      this.gearLine1.textContent = state.harpoon.name;
      this.gearLine2.textContent = '';
      this.gearBtn.classList.add('is-single-line');
    } else {
      this.gearBtn.classList.remove('is-single-line');
      const rod = state.rod;
      const suffix = rod.upgradeLevel ? ` +${rod.upgradeLevel}` : '';
      this.gearLine1.textContent = rod.name + suffix;
      this.gearLine1.classList.toggle('has-upgrade-arrow', !!rod.upgradeAvailable);
      this.gearLine2.textContent = state.bait?.name ?? '';
    }

    const badges = state.badges ?? {};
    this.setBarBadge(this.dexBadgeSlot, badges.dex);
    this.setBarBadge(this.shopBadgeSlot, badges.shop);
    this.setBarBadge(this.bonusBadgeSlot, badges.bonus, badges.bonusClaimable);
  }

  private setBarBadge(slot: HTMLElement, count: number | undefined, claimable = false): void {
    slot.replaceChildren();
    if (!count) return;
    slot.appendChild(countBadge(count, { claimable }));
  }

  /**
   * Floating toast text (`addFloatingText` in the old game): short-lived,
   * auto-removed, never captures pointer events. Matches the 1.4s lifetime
   * and fade-out from spec §1.11.
   */
  toast(text: string, opts: { color?: string } = {}): void {
    const node = el('div', 'hud-toast', text);
    node.style.color = opts.color ?? '#ffffff';
    node.dataset.toastId = String(++toastSeq);
    this.toastHost.appendChild(node);
    requestAnimationFrame(() => node.classList.add('is-live'));
    setTimeout(() => node.remove(), 1400);
  }

  destroy(): void {
    this.root.remove();
  }
}
