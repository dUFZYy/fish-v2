/**
 * Sheet — the wood-framed bottom sheet the old game used for every menu
 * (Shop, Fischdex, Aufträge, Einstellungen, Erfolge — spec `05-ui-hub-story.md`
 * §1.0 "Shared overlay chrome"). One `Sheet` instance is reused by `Screens`
 * for whichever menu is currently open.
 *
 * CLAUDE.md rule 2 ("no second full-screen opaque layer") is why this is a
 * bounded, content-sized DOM panel rather than a canvas overlay: the scrim
 * behind it is a translucent CSS background (cheap, compositor-only), and
 * the panel itself only ever occupies the height its content needs, clamped
 * between the spec's 240px floor and a `100cqh - 40px` ceiling — never an
 * opaque full-screen surface in its own right.
 *
 * `coversWorld` answers the other half of that rule: once the sheet's actual
 * rendered height is most of the screen (spec: Shop/Fischdex/Achievements sit
 * at 95-100% fill), the engine can stop drawing the scene behind it — the
 * cheap version of the old game's `display:none` trick, measured per-open
 * rather than assumed, because different screens (Settings 51%, Quests 58%)
 * genuinely do NOT cover the world and should leave it rendering.
 *
 * Animation timings match spec §1.0: open ~200ms cubic ease-out (with a
 * small overshoot baked into the easing curve), close ~110ms quadratic
 * ease-in, no overshoot.
 */

import { el, woodButton } from './dom';
import { bakeIcon, type IconId } from './icons';
import { bakePanel, applyNineSlice } from './wood';

export interface SheetTab {
  id: string;
  label: string;
  icon?: IconId;
  badge?: number;
}

export interface SheetOpenOptions {
  title: string;
  icon: IconId;
  /** Per-screen accent hex, spec §1.0's `OVERLAY_THEME` table (e.g. shop `#ff8c00`). */
  accent: string;
  tabs?: readonly SheetTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** Called once the close animation finishes hiding the panel (not on open-cancel). */
  onClose?: () => void;
}

const OPEN_MS = 200;
const CLOSE_MS = 110;
/** Fraction of the container's height at/above which the sheet is treated as covering the world. */
const COVERS_WORLD_RATIO = 0.85;

export class Sheet {
  private readonly container: HTMLElement;
  readonly root: HTMLElement;
  private readonly scrim: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly iconTile: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly tabsRow: HTMLElement;
  private readonly bodyEl: HTMLElement;

  private open_ = false;
  private coversWorld_ = false;
  private closeTimer: number | undefined;
  private onCloseCb: (() => void) | undefined;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.root = el('div', 'sheet-root');
    this.root.hidden = true;

    this.scrim = el('div', 'sheet-scrim');
    this.scrim.addEventListener('click', () => this.close());

    this.panel = el('div', 'sheet-panel');
    const panelTex = bakePanel({ w: 358, h: 400, r: 10, battens: true, seed: 9100 });
    applyNineSlice(this.panel, panelTex);
    this.panel.addEventListener('click', (ev) => ev.stopPropagation());

    const header = el('div', 'sheet-header');
    this.iconTile = el('div', 'sheet-icon-tile');
    const tileTex = bakePanel({ w: 40, h: 40, r: 8, seed: 9101 });
    applyNineSlice(this.iconTile, tileTex);
    this.titleEl = el('div', 'sheet-title');
    const closeBtn = woodButton({ label: '✕', w: 40, h: 40, seed: 9102 });
    closeBtn.classList.add('sheet-close');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => this.close());
    header.append(this.iconTile, this.titleEl, closeBtn);

    this.tabsRow = el('div', 'sheet-tabs');
    this.bodyEl = el('div', 'sheet-body');

    this.panel.append(header, this.tabsRow, this.bodyEl);
    this.root.append(this.scrim, this.panel);
    container.appendChild(this.root);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.recomputeCoversWorld());
      this.resizeObserver.observe(this.panel);
    }
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** True once the currently-open sheet's rendered height covers most of the screen. */
  get coversWorld(): boolean {
    return this.open_ && this.coversWorld_;
  }

  /** The scrollable content host — screens (`screens.ts`) mount their DOM into this. */
  get body(): HTMLElement {
    return this.bodyEl;
  }

  /** Opens (or reconfigures, if already open) the sheet's chrome and returns the body host. */
  open(opts: SheetOpenOptions): HTMLElement {
    this.onCloseCb = opts.onClose;
    if (this.closeTimer != null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }

    this.iconTile.replaceChildren();
    const img = el('img', 'sheet-icon-img') as HTMLImageElement;
    img.src = bakeIcon(opts.icon, 22);
    img.alt = '';
    this.iconTile.appendChild(img);
    this.titleEl.textContent = opts.title;
    this.panel.style.setProperty('--sheet-accent', opts.accent);

    this.setTabs(opts.tabs ?? [], opts.activeTab, opts.onTabChange);

    this.root.hidden = false;
    // Force a layout flush so the browser has a "closed" starting point to
    // transition FROM — otherwise a re-open while mid-close (or the very
    // first open) can skip straight to the open state with no animation.
    void this.panel.getBoundingClientRect();
    this.root.classList.remove('is-closing');
    this.root.classList.add('is-open');
    this.open_ = true;
    requestAnimationFrame(() => this.recomputeCoversWorld());
    window.setTimeout(() => this.recomputeCoversWorld(), OPEN_MS + 20);
    return this.bodyEl;
  }

  /** Rebuilds the tab rail (segment tabs) without touching header/body content. */
  setTabs(tabs: readonly SheetTab[], activeTab?: string, onTabChange?: (id: string) => void): void {
    this.tabsRow.replaceChildren();
    this.tabsRow.hidden = tabs.length === 0;
    for (const tab of tabs) {
      const btn = el('button', 'sheet-tab');
      btn.type = 'button';
      btn.classList.toggle('is-active', tab.id === activeTab);
      if (tab.icon) {
        const tabImg = el('img', 'sheet-tab-icon') as HTMLImageElement;
        tabImg.src = bakeIcon(tab.icon, 16);
        tabImg.alt = '';
        btn.appendChild(tabImg);
      }
      if (tab.label) btn.appendChild(el('span', 'sheet-tab-label', tab.label));
      if (tab.badge) {
        btn.appendChild(el('span', 'sheet-tab-badge', tab.badge > 9 ? '9+' : String(tab.badge)));
      }
      btn.addEventListener('click', () => {
        for (const sib of Array.from(this.tabsRow.children)) sib.classList.remove('is-active');
        btn.classList.add('is-active');
        onTabChange?.(tab.id);
        requestAnimationFrame(() => this.recomputeCoversWorld());
      });
      this.tabsRow.appendChild(btn);
    }
  }

  /** Slides the sheet closed. Safe to call when already closed (no-op). */
  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.coversWorld_ = false;
    this.root.classList.remove('is-open');
    this.root.classList.add('is-closing');
    const cb = this.onCloseCb;
    this.closeTimer = window.setTimeout(() => {
      this.root.hidden = true;
      this.root.classList.remove('is-closing');
      cb?.();
    }, CLOSE_MS + 20);
  }

  private recomputeCoversWorld(): void {
    if (!this.open_) {
      this.coversWorld_ = false;
      return;
    }
    const containerH = this.container.clientHeight || window.innerHeight || 1;
    const panelH = this.panel.getBoundingClientRect().height;
    this.coversWorld_ = panelH / containerH >= COVERS_WORLD_RATIO;
  }

  destroy(): void {
    if (this.closeTimer != null) clearTimeout(this.closeTimer);
    this.resizeObserver?.disconnect();
    this.root.remove();
  }
}
