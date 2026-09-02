/**
 * ToastQueue — floating text messages (achievements, streak, bonus, error
 * feedback), ported from the old game's `addFloatingText` (spec
 * `05-ui-hub-story.md` §1.11): **1.4s** lifetime, fade in fast/out slow,
 * white by default, colored for specific message kinds.
 *
 * `hud.ts` already has this exact mechanism built into the fishing HUD
 * (`Hud.toast`) for in-play messages anchored over the water. This class is
 * the same host/timing/markup reused standalone — for toasts fired from a
 * `Screens` sheet or the catch card, where there may be no `Hud` instance
 * mounted (e.g. the dev page, or the hub). Same CSS classes
 * (`.hud-toasts`/`.hud-toast`/`.is-live`) so there is exactly one toast
 * look in the whole game, not two near-identical ones.
 */

import { el } from './dom';

export interface ToastOptions {
  /** CSS color, defaults to white — spec: cyan for XP, red for errors, gold for rewards. */
  color?: string;
}

let seq = 0;

export class ToastQueue {
  readonly host: HTMLElement;

  constructor(container: HTMLElement) {
    this.host = el('div', 'hud-toasts');
    container.appendChild(this.host);
  }

  /** Shows one floating message. Auto-removes itself after 1.4s; never captures pointer events. */
  show(text: string, opts: ToastOptions = {}): void {
    const node = el('div', 'hud-toast', text);
    node.style.color = opts.color ?? '#ffffff';
    node.dataset.toastId = String(++seq);
    this.host.appendChild(node);
    requestAnimationFrame(() => node.classList.add('is-live'));
    setTimeout(() => node.remove(), 1400);
  }

  clear(): void {
    this.host.replaceChildren();
  }

  destroy(): void {
    this.host.remove();
  }
}
