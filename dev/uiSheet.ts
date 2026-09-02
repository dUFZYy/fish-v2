/**
 * Dev sheet — renders every wood panel variant, button state, all 38 icons,
 * and the full fishing-place HUD with sample data, in German and English,
 * so `src/ui` can be eyeballed without booting the game. Served by Vite at
 * `/dev/ui-sheet.html`.
 */

import { el, woodPanel, woodButton, countBadge } from '@/ui/dom';
import { PAINT, bakeBadge } from '@/ui/wood';
import { ICON_IDS, bakeIcon } from '@/ui/icons';
import { Hud, type HudState } from '@/ui/hud';
import { setLang, getLang, applyI18n, t, type Lang } from '@/ui/i18n';

const app = document.getElementById('app')!;

function section(title: string): HTMLElement {
  const h = el('h2', undefined, title);
  app.appendChild(h);
  const row = el('div', 'row');
  app.appendChild(row);
  return row;
}

function labeled(label: string, node: HTMLElement): HTMLElement {
  const wrap = el('div', 'swatch');
  wrap.appendChild(node);
  wrap.appendChild(el('small', undefined, label));
  return wrap;
}

function buildPanels(): void {
  const row = section('Wood panels — bakePanel() (§2.5)');
  const variants: Array<{ label: string; opts: Parameters<typeof woodPanel>[1] }> = [
    { label: 'small, no accent', opts: { w: 96, h: 64, r: 8, seed: 1 } },
    { label: 'card, accent gold', opts: { w: 160, h: 90, r: 8, accent: PAINT.gold, seed: 2 } },
    { label: 'card, paint buy', opts: { w: 160, h: 90, r: 8, paint: PAINT.buy, seed: 3 } },
    { label: 'card, paint danger + accent', opts: { w: 160, h: 90, r: 8, paint: PAINT.danger, accent: '#fff', seed: 4 } },
    { label: 'tall overlay w/ battens', opts: { w: 160, h: 260, r: 8, battens: true, accent: PAINT.info, seed: 5 } },
  ];
  for (const v of variants) {
    const box = el('div', 'panel-demo');
    box.style.width = `${v.opts?.w ?? 160}px`;
    box.style.height = `${v.opts?.h ?? 90}px`;
    const tex = woodPanel(undefined, v.opts);
    tex.style.width = '100%'; tex.style.height = '100%';
    box.appendChild(tex);
    row.appendChild(labeled(v.label, box));
  }

  const row2 = section('Nine-slice reuse — ONE bake, three element sizes');
  const shared = { seed: 42, accent: PAINT.reward } as const;
  for (const [w, h] of [[70, 50], [160, 90], [280, 140]] as const) {
    const box = el('div');
    box.style.width = `${w}px`; box.style.height = `${h}px`;
    const tex = woodPanel(undefined, { ...shared, w: 160, h: 90 }); // same bake opts every time
    tex.style.width = '100%'; tex.style.height = '100%';
    box.appendChild(tex);
    row2.appendChild(labeled(`${w}×${h}`, box));
  }
}

function buildButtons(): void {
  const row = section('Buttons — bakeButton() / woodButton() (§2.7)');
  const specs: Array<{ label: string; opts: Parameters<typeof woodButton>[0] }> = [
    { label: 'default', opts: { label: 'Auswerfen', icon: 'rod', seed: 10 } },
    { label: 'buy (orange)', opts: { label: t('Nutzen'), paint: PAINT.buy, seed: 11 } },
    { label: 'equipped (green)', opts: { label: '✔ ' + t('Aktiv'), paint: PAINT.reward, seed: 12 } },
    { label: 'gold', opts: { label: t('Premium'), paint: PAINT.gold, seed: 13 } },
    { label: 'gem price (info)', opts: { icon: 'gem', label: '120', paint: PAINT.info, seed: 14 } },
    { label: 'danger', opts: { label: t('Abbrechen'), paint: PAINT.danger, seed: 15 } },
    { label: 'locked (worn)', opts: { label: '🔒 ' + t('Exklusiv'), paint: PAINT.worn, worn: true, disabled: true, seed: 16 } },
  ];
  for (const s of specs) {
    const btn = woodButton({ w: 132, h: 44, ...s.opts });
    row.appendChild(labeled(s.label, btn));
  }

  const row2 = section('Press-state feedback (pointerdown/up on the button above)');
  const hint = el('div', undefined, 'Press and hold any button above — it should squash 3% and darken instantly, then release cleanly. This is a CSS transition triggered by pointer events (dom.ts), replacing the old game\'s per-frame press formula.');
  hint.style.maxWidth = '520px';
  hint.style.color = '#bbb';
  row2.appendChild(hint);
}

function buildBadges(): void {
  const row = section('Badges — bakeBadge() (§1.12, at most 2 markers per element)');
  row.appendChild(labeled('unseen (red dot)', countBadge(1, { claimable: false })));
  row.appendChild(labeled('claimable ×3', countBadge(3, { claimable: true })));
  row.appendChild(labeled('claimable capped', countBadge(14, { claimable: true })));
  const rawImg = el('img') as HTMLImageElement;
  rawImg.src = bakeBadge('#e0483c', 24);
  rawImg.width = 24; rawImg.height = 24;
  row.appendChild(labeled('raw bakeBadge()', rawImg));
}

function buildIcons(): void {
  app.appendChild(el('h2', undefined, `Icons — all ${ICON_IDS.length} (icons.js §4)`));
  const grid = el('div', 'icon-grid');
  app.appendChild(grid);
  for (const id of ICON_IDS) {
    const cell = el('div', 'icon-cell');
    const img = el('img') as HTMLImageElement;
    img.src = bakeIcon(id, 32);
    img.alt = id;
    cell.append(img, el('span', undefined, id));
    grid.appendChild(cell);
  }
}

let hud: Hud | null = null;
function sampleState(): HudState {
  return {
    coins: 1284,
    gems: 37,
    clock: '14:30',
    timeOfDay: 'day',
    level: 12,
    anglerTitle: t('Profi'),
    xp: 420,
    xpToNext: 900,
    skillPoints: 1,
    hub: false,
    hubBlocked: false,
    newLocationAvailable: true,
    rod: { name: t('Carbonrute'), upgradeLevel: 2, upgradeAvailable: true, upgradeCost: 340 },
    bait: { name: t('Garnele') },
    badges: { dex: 3, shop: 1, bonus: 1, bonusClaimable: true },
  };
}

function buildHud(): void {
  app.appendChild(el('h2', undefined, 'Full HUD — hud.ts, sample state'));
  const controls = el('div', 'row');
  const toastBtn = document.createElement('button');
  toastBtn.textContent = 'Fire a toast (+15 XP)';
  toastBtn.style.cssText = 'padding:8px 14px;border-radius:6px;border:1px solid #555;background:#333;color:#fff;cursor:pointer;margin-bottom:12px;';
  toastBtn.addEventListener('click', () => hud?.toast('+15 XP', { color: '#8fd3ff' }));
  controls.appendChild(toastBtn);
  app.appendChild(controls);

  const stage = el('div');
  stage.id = 'hud-stage';
  const mount = el('div');
  mount.id = 'hud-mount';
  stage.appendChild(mount);
  app.appendChild(stage);

  hud = new Hud(mount, {
    onStatusCard: () => hud?.toast(t('Talente')),
    onMenu: () => hud?.toast(t('Menü')),
    onGear: () => hud?.toast(t('Ausrüstung')),
    onDex: () => hud?.toast(t('Fischdex')),
    onShop: () => hud?.toast(t('Shop')),
    onBonus: () => hud?.toast(t('Bonus')),
  });
  hud.update(sampleState());
}

function rebuildAll(): void {
  app.replaceChildren();
  buildPanels();
  buildButtons();
  buildBadges();
  buildIcons();
  hud = null;
  buildHud();
  applyI18n(document);
}

function setupLangToggle(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('#lang-toggle button');
  const sync = () => {
    for (const b of buttons) b.classList.toggle('active', b.dataset.lang === getLang());
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      setLang(b.dataset.lang as Lang);
      sync();
      rebuildAll();
    });
  }
  sync();
}

setupLangToggle();
rebuildAll();
