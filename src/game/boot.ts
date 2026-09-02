import { Graphics } from 'pixi.js';
import { engine } from '@/engine/app';

/** Placeholder scene until the world renderer lands. */
export async function startGame(): Promise<void> {
  const g = new Graphics();
  engine.world.addChild(g);
  const draw = () => {
    g.clear();
    g.rect(0, 0, engine.W, engine.H * 0.35).fill(0x4a90d9);
    g.rect(0, engine.H * 0.35, engine.W, engine.H * 0.65).fill(0x1c4f6b);
  };
  draw();
  engine.onUpdate(() => { /* sim */ });
  window.addEventListener('resize', draw);
}
