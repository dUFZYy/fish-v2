/**
 * Dev sheet — opens every menu screen, the catch card, the level-up popup,
 * and a toast, with plausible sample data, in German and English, so
 * `src/ui/screens.ts`/`sheet.ts`/`catchCard.ts`/`toast.ts` can be eyeballed
 * without booting the game. Served by Vite at `/dev/screens.html`.
 */

import { el } from '@/ui/dom';
import { setLang, getLang, applyI18n, t, type Lang } from '@/ui/i18n';
import { Screens, type ScreenId } from '@/ui/screens';
import { CatchCard, LevelUpPopup } from '@/ui/catchCard';
import { ToastQueue } from '@/ui/toast';
import { SPECIES } from '@/data/species';
import { anglerTitle } from '@/game/progress';
import { ensureQuests } from '@/game/quests';
import { defaultSave } from '@/game/save';

const controls = document.getElementById('controls')!;
const stage = document.getElementById('stage')!;

function button(label: string, onClick: () => void): void {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  row.appendChild(btn);
}

let row = el('div', 'row');
controls.appendChild(row);
function newRow(title: string): void {
  controls.appendChild(el('h2', undefined, title));
  row = el('div', 'row');
  controls.appendChild(row);
}

// ---------------------------------------------------------------------------
// Sample data — plausible mid-game state, not a fresh save, so every visual
// state (NEU badges, equipped/owned/locked shop rows, done quests, unlocked
// achievements) has at least one example on screen.
// ---------------------------------------------------------------------------

function sampleDexData() {
  const discovered: Record<string, { count: number; record: number; shiny?: number }> = {
    rotauge: { count: 12, record: 0.9 },
    karpfen: { count: 4, record: 6.3 },
    barsch: { count: 7, record: 1.8 },
    forelle: { count: 2, record: 2.1, shiny: 1 },
    hecht: { count: 1, record: 8.4 },
  };
  const seenSpecies: Record<string, boolean> = {
    rotauge: true,
    karpfen: true,
    barsch: false, // -> NEU badge
    forelle: false, // -> NEU badge
    hecht: true,
  };
  return { dex: discovered, seenSpecies, totalCatches: 26, biggestKg: 8.4 };
}

function sampleShopData() {
  return {
    coins: 1284,
    gems: 37,
    owned: {
      rods: ['holz', 'bambus', 'carbon'],
      baits: ['wurm', 'brot'],
      bobbers: ['classic'],
      rodskins: ['holz'],
      hats: ['angler'],
      outfits: ['klassisch'],
      harpoons: ['standard'],
      locations: [],
    },
    equipped: { rod: 'carbon', bait: 'brot', bobber: 'classic', rodskin: 'holz', hat: 'angler', outfit: 'klassisch', harpoon: 'standard' },
    totemStock: { regen: 2, glueck: 1 },
  };
}

function sampleQuestsData() {
  const save = ensureQuests(defaultSave());
  const quests = save.quests!;
  // Give the sample some visual variety: first quest half-done, second done.
  quests.list[0] && (quests.list[0] = { ...quests.list[0], progress: Math.max(1, Math.floor(quests.list[0].target / 2)) });
  quests.list[1] && (quests.list[1] = { ...quests.list[1], progress: quests.list[1].target, done: true });
  return { quests, totalCompleted: 42 };
}

function sampleSettingsData() {
  return {
    lang: getLang(),
    musicOn: true,
    sfxOn: true,
    musicVolume: 0.7,
    sfxVolume: 0.9,
    ambienceVolume: 0.5,
    quality: 'balanced' as const,
    haptics: true,
    version: '0.1.0',
  };
}

function sampleAchievementsData() {
  return { unlockedIds: ['warmgeangelt', 'ersterFang', 'schuhgroesse44', 'nachtangler', 'reisender'] };
}

function sampleCatchCardData() {
  const sp = SPECIES.find((s) => s.id === 'mondfisch')!;
  return {
    species: sp,
    weightKg: 4.8,
    shiny: true,
    perfect: true,
    newInDex: true,
    newRecord: true,
    coins: 1350,
    coinsBreakdown: { base: 300, multiplier: 1.5, shinyMult: 5 },
    bycatch: { name: t('Rotauge'), kg: 0.4 },
  };
}

function sampleCatchCardPlainData() {
  const sp = SPECIES.find((s) => s.id === 'barsch')!;
  return {
    species: sp,
    weightKg: 1.2,
    coins: 12,
    coinsBreakdown: { base: 12, multiplier: 1 },
  };
}

function sampleLevelUpData() {
  return {
    level: 7,
    anglerTitle: t(anglerTitle(7)),
    coins: 175,
    gems: 0,
    unlockedLocationName: t('Küste'),
    unlockedLocationLevel: 7,
  };
}

// ---------------------------------------------------------------------------
// Wire up: one Screens instance, one CatchCard, one LevelUpPopup, one toast
// queue, all mounted into the bounded #stage frame (the world stand-in).
// ---------------------------------------------------------------------------

let screens: Screens | null = null;
let catchCard: CatchCard | null = null;
let levelUp: LevelUpPopup | null = null;
let toasts: ToastQueue | null = null;

function openScreen(id: ScreenId): void {
  if (!screens) return;
  switch (id) {
    case 'dex':
      screens.open({ id: 'dex', data: sampleDexData() });
      break;
    case 'shop':
      screens.open({ id: 'shop', data: sampleShopData() });
      break;
    case 'quests':
      screens.open({ id: 'quests', data: sampleQuestsData() });
      break;
    case 'settings':
      screens.open({ id: 'settings', data: sampleSettingsData() });
      break;
    case 'achievements':
      screens.open({ id: 'achievements', data: sampleAchievementsData() });
      break;
  }
  logCoversWorld();
}

function logCoversWorld(): void {
  // Re-checked a beat after the open animation settles, since coversWorld is
  // measured from the sheet's actual rendered height (see sheet.ts).
  window.setTimeout(() => {
    const status = document.getElementById('covers-world-status');
    if (status && screens) {
      status.textContent = `coversWorld: ${screens.coversWorld} (open: ${screens.openId ?? 'none'})`;
    }
  }, 260);
}

function build(): void {
  stage.querySelectorAll('.stage-runtime').forEach((n) => n.remove());
  const mount = el('div', 'stage-runtime');
  mount.style.position = 'absolute';
  mount.style.inset = '0';
  stage.appendChild(mount);

  screens = new Screens(mount, {
    shop: {
      onBuyOrEquip: (category, itemId) => toasts?.show(`${t('Kauf')}: ${category}/${itemId}`, { color: '#ffd23a' }),
      onBuyTotem: (itemId) => toasts?.show(`${t('Einsetzen')}: ${itemId}`, { color: '#7fc7ff' }),
    },
    settings: {
      onLangChange: (lang) => {
        setLang(lang);
        rebuildAll();
      },
    },
    onClose: () => logCoversWorld(),
  });
  catchCard = new CatchCard({
    onContinue: () => toasts?.show(t('Klicken zum Weiterangeln')),
    onShare: () => toasts?.show(t('Fang teilen'), { color: '#8fd3ff' }),
  });
  levelUp = new LevelUpPopup({
    onContinue: () => toasts?.show(t('Tippen zum Weiterspielen')),
    onTravel: () => toasts?.show(t('hinfahren'), { color: '#5ad46a' }),
  });
  toasts = new ToastQueue(mount);
}

function buildControls(): void {
  controls.replaceChildren();

  newRow('Sheet screens (Screens.open)');
  button('Fischdex', () => openScreen('dex'));
  button('Shop', () => openScreen('shop'));
  button('Aufträge / Quests', () => openScreen('quests'));
  button('Einstellungen / Settings', () => openScreen('settings'));
  button('Erfolge / Achievements', () => openScreen('achievements'));
  button('Close sheet', () => screens?.close());
  const status = el('span');
  status.id = 'covers-world-status';
  status.style.cssText = 'color:#8f8; font:12px monospace; align-self:center;';
  row.appendChild(status);

  newRow('Catch card & level-up (catchCard.ts)');
  button('Catch card — legendary/shiny/perfect', () => catchCard?.show(stage, sampleCatchCardData()));
  button('Catch card — plain common', () => catchCard?.show(stage, sampleCatchCardPlainData()));
  button('Level-up — with unlock', () => levelUp?.show(stage, sampleLevelUpData()));
  button('Level-up — plain', () => levelUp?.show(stage, { level: 4, anglerTitle: t(anglerTitle(4)), coins: 100 }));

  newRow('Toasts (toast.ts)');
  button('+15 XP', () => toasts?.show('+15 XP', { color: '#8fd3ff' }));
  button('Zu wenig Coins!', () => toasts?.show(t('Zu wenig Coins!'), { color: '#ff6a5a' }));
  button('Auftrag erledigt!', () => toasts?.show(t('Auftrag erledigt!'), { color: '#5ad46a' }));
}

function rebuildAll(): void {
  screens?.destroy();
  catchCard?.hide();
  levelUp?.hide();
  build();
  buildControls();
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
