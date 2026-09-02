/**
 * Layout — one coordinate system for the whole game.
 *
 * The game is portrait-only. All gameplay/UI code works in LOGICAL pixels
 * (CSS px) exactly like the old game did (W, H = innerWidth/innerHeight),
 * so the old layout constants (water line at H*0.35 etc.) carry over 1:1.
 *
 * Device pixels are handled by the renderer's `resolution`. Nobody outside
 * the engine layer needs to know the DPR.
 */

export interface SafeArea { top: number; right: number; bottom: number; left: number }

export const layout = {
  /** logical width/height in CSS px */
  W: 390,
  H: 844,
  /** safe area insets in CSS px (notch, home indicator) */
  safe: { top: 0, right: 0, bottom: 0, left: 0 } as SafeArea,
  /** devicePixelRatio actually used by the renderer */
  dpr: 1,
  /** listeners called after every resize */
  listeners: new Set<() => void>(),
};

let probe: HTMLDivElement | null = null;

/** Reads env(safe-area-inset-*) via a hidden probe element. */
function readSafeArea(): SafeArea {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);' +
      'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  const px = (v: string) => parseFloat(v) || 0;
  return {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
}

export function measureLayout(): void {
  // visualViewport is the most reliable size inside WKWebView / Chrome mobile.
  const vv = window.visualViewport;
  layout.W = Math.round(vv ? vv.width : window.innerWidth);
  layout.H = Math.round(vv ? vv.height : window.innerHeight);
  layout.safe = readSafeArea();
}

export function onLayout(fn: () => void): () => void {
  layout.listeners.add(fn);
  return () => layout.listeners.delete(fn);
}

export function notifyLayout(): void {
  for (const fn of layout.listeners) fn();
}
