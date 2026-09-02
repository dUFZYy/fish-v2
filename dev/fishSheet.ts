/**
 * Dev-only visual self-check for `src/bake/fishArt.ts`. Draws every species
 * in `src/data/species.ts` into its own small 2D canvas via `drawSpecies`, so
 * a missing/broken body type shows up as an empty or errored cell instead of
 * silently failing inside the atlas baker. Not part of the shipped game.
 */
import { SPECIES } from '@/data/species';
import { drawSpecies, fishAspect } from '@/bake/fishArt';

const grid = document.getElementById('grid') as HTMLDivElement;
const stateEl = document.getElementById('state') as HTMLDivElement;
const lightInput = document.getElementById('light') as HTMLInputElement;
const lightOut = document.getElementById('lightOut') as HTMLOutputElement;
const shinyInput = document.getElementById('shiny') as HTMLInputElement;

const BOX_W = 84; // logical px width every cell's bake box gets; height follows fishAspect(sp)

function render(): void {
  const light = +lightInput.value / 100;
  lightOut.textContent = light.toFixed(2);
  const shiny = shinyInput.checked;

  grid.innerHTML = '';
  let ok = 0;
  const errors: string[] = [];

  for (const sp of SPECIES) {
    const cell = document.createElement('div');
    cell.className = 'cell';

    const aspect = fishAspect(sp);
    const w = BOX_W;
    const h = Math.max(24, Math.round(BOX_W * aspect));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    cell.appendChild(canvas);

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = `${sp.nameDe} (${sp.id})`;
    cell.appendChild(name);

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      drawSpecies(ctx, w, h, sp, { shiny, light });
      ok++;
    } catch (err) {
      cell.classList.add('err');
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${sp.id}: ${msg}`);
    }

    grid.appendChild(cell);
  }

  stateEl.textContent = `${ok}/${SPECIES.length} Arten gezeichnet, bodyType-Zählung: `
    + JSON.stringify(countByBodyType())
    + (errors.length ? `\n\nFehler:\n${errors.join('\n')}` : '');
}

function countByBodyType(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sp of SPECIES) counts[sp.bodyType] = (counts[sp.bodyType] || 0) + 1;
  return counts;
}

lightInput.addEventListener('input', render);
shinyInput.addEventListener('change', render);
render();
