import { engine } from './engine/app';
import { PerfHud } from './engine/perf';

async function boot(): Promise<void> {
  const q = new URLSearchParams(location.search).get('q');
  const quality = q === 'sharp' || q === 'balanced' || q === 'perf' ? q : 'auto';
  await engine.init({ quality });

  if (/[?&]perf=1/.test(location.search)) {
    const hud = new PerfHud(engine.perf, () => engine.currentTier);
    engine.onUpdate((dt) => hud.update(dt * 1000));
  }

  // Game modules are attached here as they come online.
  const { startGame } = await import('./game/boot');
  await startGame();
}

boot().catch((err) => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'color:#fff;padding:16px;font:12px monospace;white-space:pre-wrap';
  el.textContent = 'Startfehler:\n' + (err?.stack || err);
  document.body.appendChild(el);
});
