/**
 * dom — tiny DOM helpers for the `#ui` layer. No framework: `#ui` only ever
 * holds a handful of small, short-lived elements (CLAUDE.md rule 2), so a
 * few factory functions are all this needs.
 */

import { bakePanel, bakeButton, bakeBadge, applyNineSlice, seedOf, type BakePanelOpts, type BakeButtonOpts } from './wood';
import { bakeIcon, type IconId } from './icons';

/** `document.createElement` with class and text in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * A nine-slice wood panel element: any size the caller sets via CSS
 * (width/height, flex, grid) is dressed by ONE baked panel texture via
 * `border-image` — no re-bake per instance or per resize.
 */
export function woodPanel(cls?: string, opts: BakePanelOpts = {}): HTMLDivElement {
  const node = el('div', cls);
  const tex = bakePanel(opts);
  applyNineSlice(node, tex);
  node.style.position = 'relative';
  return node;
}

export interface WoodButtonOpts extends BakeButtonOpts {
  icon?: IconId;
  label?: string;
  onClick?: (ev: PointerEvent) => void;
  disabled?: boolean;
  /** distinguishes otherwise-identical bakes (e.g. same size/paint, different row) so the cache key varies deliberately */
  seed?: number;
}

/**
 * A wood-plaque button with the old game's press feedback: a quick
 * squash + darken on pointerdown, released on pointerup/cancel/leave.
 * (The old canvas build did this as a per-frame formula on `hitButtons`;
 * here the same feel is a CSS transition, which is the DOM-native
 * equivalent the spec's §11 assessment calls out as directly portable.)
 */
export function woodButton(o: WoodButtonOpts = {}): HTMLButtonElement {
  const btn = el('button', 'wood-btn');
  btn.type = 'button';
  const tex = bakeButton({ w: o.w, h: o.h, seed: o.seed, paint: o.paint, worn: o.worn, nails: o.nails, slice: o.slice });
  applyNineSlice(btn, tex);
  if (o.icon) {
    const img = el('img', 'wood-btn-icon') as HTMLImageElement;
    img.src = bakeIcon(o.icon, 22);
    img.alt = '';
    btn.appendChild(img);
  }
  if (o.label) {
    const span = el('span', 'wood-btn-label', o.label);
    btn.appendChild(span);
  }
  if (o.disabled) btn.disabled = true;
  if (o.onClick) btn.addEventListener('click', (ev) => { if (!btn.disabled) o.onClick!(ev as unknown as PointerEvent); });
  let pressed = false;
  const press = () => { if (btn.disabled || pressed) return; pressed = true; btn.classList.add('is-pressed'); };
  const release = () => { if (!pressed) return; pressed = false; btn.classList.remove('is-pressed'); };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
  return btn;
}

/**
 * Red (or green) count badge — a flat signal colour, never wood-painted
 * (spec §2.13: status markers are kept as flat colour, not procedural
 * wood). Returns `null`-safe: pass `count<=0` to render the plain-dot
 * "unseen" marker instead of a number (spec §1.12's two-marker rule).
 */
export function countBadge(count: number, opts: { color?: string; claimable?: boolean } = {}): HTMLSpanElement {
  const color = opts.color ?? (opts.claimable ? '#3ad46a' : '#e0483c');
  const span = el('span', 'badge');
  const showNumber = opts.claimable && count > 0;
  const size = showNumber ? 18 : 10;
  span.style.backgroundImage = `url(${bakeBadge(color, size)})`;
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  if (showNumber) span.textContent = count > 9 ? '9+' : String(count);
  return span;
}

/** Deterministic seed helper for callers baking multiple wood variants (e.g. dev sheet rows). */
export { seedOf };
