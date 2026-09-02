/**
 * Icons — the 38 hand-drawn UI icons, ported from the old game's `icons.js`.
 *
 * Emoji were the previous approach and are explicitly rejected there: they
 * render differently per OS (glossy/3D on iOS, flat on Windows/Android),
 * have inconsistent width and baseline, and never sit cleanly next to text.
 * These are Canvas 2D paths instead, drawn in a normalized -1..1 box exactly
 * like the old game, then baked once to a small `data:` PNG per (id, size)
 * — the DOM only ever gets an `<img>`/`background-image` URL, never a live
 * canvas it has to keep redrawing.
 */

const ICON_OUTLINE = 'rgba(12,22,34,0.55)';

function icoGrad(ctx: CanvasRenderingContext2D, a: string, b: string, y0 = -1, y1 = 1): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a); g.addColorStop(1, b);
  return g;
}
function icoLine(ctx: CanvasRenderingContext2D, w = 0.14): void {
  ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
}
function icoGloss(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = -0.5, a = 0.45): void {
  ctx.fillStyle = `rgba(255,255,255,${a})`;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
}

export type IconId =
  | 'tank' | 'book' | 'tacklebox' | 'calendar' | 'rod' | 'tv' | 'lock' | 'trophy' | 'gift'
  | 'clipboard' | 'map' | 'sparkle' | 'fish' | 'star' | 'chart' | 'ticket' | 'coral' | 'worm'
  | 'bobber' | 'palette' | 'hat' | 'coat' | 'trident' | 'orb' | 'gem' | 'net' | 'globe'
  | 'speaker' | 'speakerOff' | 'note' | 'gear' | 'rain' | 'moon' | 'sun' | 'horn' | 'clover'
  | 'flame' | 'magnet';

type IconFn = (ctx: CanvasRenderingContext2D) => void;

const ICONS: Record<IconId, IconFn> = {
  tank(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#8fd7f0', '#2f8fbd', -0.8, 0.7);
    ctx.beginPath(); ctx.roundRect(-0.85, -0.72, 1.7, 1.42, 0.22); ctx.fill(); icoLine(ctx, 0.15);
    ctx.save(); ctx.beginPath(); ctx.roundRect(-0.85, -0.72, 1.7, 1.42, 0.22); ctx.clip();
    ctx.fillStyle = '#1f6f9b';
    ctx.beginPath(); ctx.moveTo(-0.9, -0.28);
    ctx.quadraticCurveTo(-0.3, -0.44, 0.15, -0.28); ctx.quadraticCurveTo(0.6, -0.13, 0.9, -0.3);
    ctx.lineTo(0.9, 0.8); ctx.lineTo(-0.9, 0.8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffb03a';
    ctx.beginPath(); ctx.ellipse(-0.05, 0.16, 0.32, 0.19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0.24, 0.16); ctx.lineTo(0.5, 0.0); ctx.lineTo(0.5, 0.33); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#12303f'; ctx.beginPath(); ctx.arc(-0.2, 0.12, 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    icoGloss(ctx, -0.5, -0.32, 0.11, 0.3, -0.35, 0.5);
    ctx.fillStyle = '#4a3a2c';
    ctx.beginPath(); ctx.roundRect(-0.95, 0.66, 1.9, 0.28, 0.1); ctx.fill(); icoLine(ctx, 0.13);
  },
  book(ctx) {
    ctx.fillStyle = '#b8643a';
    ctx.beginPath(); ctx.roundRect(-0.92, -0.72, 1.84, 1.44, 0.14); ctx.fill(); icoLine(ctx, 0.14);
    ctx.fillStyle = icoGrad(ctx, '#fff6e2', '#e5d3b4');
    ctx.beginPath(); ctx.roundRect(-0.8, -0.6, 0.74, 1.2, 0.08); ctx.fill();
    ctx.beginPath(); ctx.roundRect(0.06, -0.6, 0.74, 1.2, 0.08); ctx.fill();
    ctx.strokeStyle = 'rgba(80,60,40,0.45)'; ctx.lineWidth = 0.09; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const yy = -0.32 + i * 0.32;
      ctx.beginPath(); ctx.moveTo(-0.68, yy); ctx.lineTo(-0.2, yy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.2, yy); ctx.lineTo(0.68, yy); ctx.stroke();
    }
    ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = 0.13;
    ctx.beginPath(); ctx.moveTo(0, -0.62); ctx.lineTo(0, 0.62); ctx.stroke();
  },
  tacklebox(ctx) {
    ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = 0.13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -0.5, 0.3, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = icoGrad(ctx, '#e0603f', '#a63a22', -0.5, 0.75);
    ctx.beginPath(); ctx.roundRect(-0.9, -0.42, 1.8, 1.16, 0.14); ctx.fill(); icoLine(ctx, 0.14);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.roundRect(-0.9, -0.12, 1.8, 0.13, 0.05); ctx.fill();
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath(); ctx.roundRect(-0.17, -0.2, 0.34, 0.3, 0.07); ctx.fill(); icoLine(ctx, 0.1);
    icoGloss(ctx, -0.5, -0.28, 0.26, 0.07, -0.1, 0.35);
  },
  calendar(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#fdfdff', '#d8dde6', -0.6, 0.75);
    ctx.beginPath(); ctx.roundRect(-0.85, -0.62, 1.7, 1.4, 0.16); ctx.fill(); icoLine(ctx, 0.14);
    ctx.fillStyle = '#e0483c';
    ctx.beginPath(); ctx.roundRect(-0.85, -0.62, 1.7, 0.52, 0.16); ctx.fill();
    ctx.fillStyle = '#e0483c'; ctx.fillRect(-0.85, -0.28, 1.7, 0.2);
    ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = 0.13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.42, -0.9); ctx.lineTo(-0.42, -0.42); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.42, -0.9); ctx.lineTo(0.42, -0.42); ctx.stroke();
    ctx.fillStyle = '#2a3a4c';
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      ctx.beginPath(); ctx.arc(-0.42 + i * 0.42, 0.16 + j * 0.36, 0.11, 0, Math.PI * 2); ctx.fill();
    }
  },
  rod(ctx) {
    ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 0.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.72, 0.78); ctx.quadraticCurveTo(0.1, 0.1, 0.68, -0.78); ctx.stroke();
    ctx.strokeStyle = '#5c3a1a'; ctx.lineWidth = 0.09;
    ctx.beginPath(); ctx.moveTo(-0.72, 0.78); ctx.quadraticCurveTo(0.1, 0.1, 0.68, -0.78); ctx.stroke();
    ctx.fillStyle = '#c9d4de';
    ctx.beginPath(); ctx.arc(-0.34, 0.5, 0.2, 0, Math.PI * 2); ctx.fill(); icoLine(ctx, 0.11);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.moveTo(0.66, -0.72); ctx.quadraticCurveTo(0.5, -0.1, 0.3, 0.3); ctx.stroke();
    ctx.strokeStyle = '#cfd8e0'; ctx.lineWidth = 0.12;
    ctx.beginPath(); ctx.arc(0.22, 0.42, 0.16, -0.4, Math.PI * 0.95); ctx.stroke();
  },
  tv(ctx) {
    ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = 0.12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.3, -0.5); ctx.lineTo(-0.05, -0.14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.3, -0.5); ctx.lineTo(0.05, -0.14); ctx.stroke();
    ctx.fillStyle = icoGrad(ctx, '#6f7d8c', '#3a4653', -0.2, 0.8);
    ctx.beginPath(); ctx.roundRect(-0.92, -0.18, 1.84, 1.0, 0.18); ctx.fill(); icoLine(ctx, 0.14);
    ctx.fillStyle = icoGrad(ctx, '#9fe8ff', '#3fa8d8', -0.1, 0.66);
    ctx.beginPath(); ctx.roundRect(-0.74, -0.04, 1.24, 0.72, 0.1); ctx.fill();
    icoGloss(ctx, -0.45, 0.08, 0.09, 0.22, -0.5, 0.55);
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath(); ctx.arc(0.68, 0.14, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0483c';
    ctx.beginPath(); ctx.arc(0.68, 0.46, 0.1, 0, Math.PI * 2); ctx.fill();
  },
  lock(ctx) {
    ctx.strokeStyle = '#b9c4cf'; ctx.lineWidth = 0.22; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -0.18, 0.42, Math.PI, 0); ctx.stroke();
    ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = 0.09;
    ctx.beginPath(); ctx.arc(0, -0.18, 0.42, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = icoGrad(ctx, '#ffd97a', '#d99a1c', -0.1, 0.8);
    ctx.beginPath(); ctx.roundRect(-0.62, -0.16, 1.24, 0.94, 0.16); ctx.fill(); icoLine(ctx, 0.14);
    ctx.fillStyle = 'rgba(90,55,0,0.7)';
    ctx.beginPath(); ctx.arc(0, 0.16, 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-0.08, 0.16); ctx.lineTo(0.08, 0.16); ctx.lineTo(0.05, 0.52); ctx.lineTo(-0.05, 0.52); ctx.closePath(); ctx.fill();
    icoGloss(ctx, -0.36, 0.1, 0.08, 0.2, -0.2, 0.4);
  },
  trophy(ctx) {
    ctx.strokeStyle = '#d9a020'; ctx.lineWidth = 0.14;
    ctx.beginPath(); ctx.arc(-0.62, -0.22, 0.26, Math.PI * 0.5, Math.PI * 1.5, true); ctx.stroke();
    ctx.beginPath(); ctx.arc(0.62, -0.22, 0.26, Math.PI * 1.5, Math.PI * 0.5); ctx.stroke();
    ctx.fillStyle = icoGrad(ctx, '#ffe485', '#d99a1c', -0.7, 0.3);
    ctx.beginPath(); ctx.moveTo(-0.56, -0.74); ctx.lineTo(0.56, -0.74);
    ctx.quadraticCurveTo(0.5, 0.18, 0, 0.28); ctx.quadraticCurveTo(-0.5, 0.18, -0.56, -0.74);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.14);
    ctx.fillStyle = '#c98f00';
    ctx.beginPath(); ctx.roundRect(-0.14, 0.24, 0.28, 0.3, 0.05); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-0.5, 0.52, 1.0, 0.26, 0.1); ctx.fill(); icoLine(ctx, 0.13);
    icoGloss(ctx, -0.28, -0.42, 0.08, 0.22, -0.15, 0.55);
  },
  gift(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#ff7a6a', '#c93a3a', -0.2, 0.82);
    ctx.beginPath(); ctx.roundRect(-0.8, -0.18, 1.6, 1.0, 0.12); ctx.fill(); icoLine(ctx, 0.14);
    ctx.fillStyle = icoGrad(ctx, '#ff9a8a', '#e0483c', -0.5, -0.1);
    ctx.beginPath(); ctx.roundRect(-0.92, -0.5, 1.84, 0.36, 0.1); ctx.fill(); icoLine(ctx, 0.13);
    ctx.fillStyle = '#ffd23a';
    ctx.fillRect(-0.16, -0.5, 0.32, 1.32);
    ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 0.16;
    ctx.beginPath(); ctx.ellipse(-0.26, -0.62, 0.22, 0.15, 0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0.26, -0.62, 0.22, 0.15, -0.4, 0, Math.PI * 2); ctx.stroke();
  },
  clipboard(ctx) {
    ctx.fillStyle = '#8a6a48';
    ctx.beginPath(); ctx.roundRect(-0.78, -0.72, 1.56, 1.5, 0.14); ctx.fill(); icoLine(ctx, 0.14);
    ctx.fillStyle = icoGrad(ctx, '#fffdf6', '#dfe3e8', -0.55, 0.7);
    ctx.beginPath(); ctx.roundRect(-0.64, -0.5, 1.28, 1.16, 0.08); ctx.fill();
    ctx.fillStyle = '#c9b28a';
    ctx.beginPath(); ctx.roundRect(-0.3, -0.88, 0.6, 0.34, 0.1); ctx.fill(); icoLine(ctx, 0.12);
    ctx.strokeStyle = '#3fc7a8'; ctx.lineWidth = 0.15; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < 2; i++) {
      const yy = -0.18 + i * 0.44;
      ctx.beginPath(); ctx.moveTo(-0.42, yy); ctx.lineTo(-0.26, yy + 0.16); ctx.lineTo(0.04, yy - 0.18); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(70,80,95,0.5)'; ctx.lineWidth = 0.1;
    ctx.beginPath(); ctx.moveTo(0.16, -0.14); ctx.lineTo(0.48, -0.14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.16, 0.3); ctx.lineTo(0.48, 0.3); ctx.stroke();
  },
  map(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#e8dcbe', '#c3b087', -0.6, 0.7);
    ctx.beginPath();
    ctx.moveTo(-0.92, -0.5); ctx.lineTo(-0.3, -0.72); ctx.lineTo(0.3, -0.5); ctx.lineTo(0.92, -0.72);
    ctx.lineTo(0.92, 0.56); ctx.lineTo(0.3, 0.78); ctx.lineTo(-0.3, 0.56); ctx.lineTo(-0.92, 0.78);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.14);
    ctx.strokeStyle = 'rgba(90,80,55,0.5)'; ctx.lineWidth = 0.1;
    ctx.beginPath(); ctx.moveTo(-0.3, -0.72); ctx.lineTo(-0.3, 0.56); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.3, -0.5); ctx.lineTo(0.3, 0.78); ctx.stroke();
    ctx.fillStyle = '#e0483c';
    ctx.beginPath(); ctx.arc(0.02, -0.14, 0.26, Math.PI * 0.85, Math.PI * 0.15); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-0.22, -0.06); ctx.lineTo(0.26, -0.06); ctx.lineTo(0.02, 0.44); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7a1a14'; ctx.beginPath(); ctx.arc(0.02, -0.16, 0.09, 0, Math.PI * 2); ctx.fill();
  },
  sparkle(ctx) {
    ctx.fillStyle = '#fff3a0';
    const star = (cx2: number, cy2: number, r: number, k: number) => {
      ctx.beginPath(); ctx.moveTo(cx2, cy2 - r);
      ctx.quadraticCurveTo(cx2 + r * k, cy2 - r * k, cx2 + r, cy2);
      ctx.quadraticCurveTo(cx2 + r * k, cy2 + r * k, cx2, cy2 + r);
      ctx.quadraticCurveTo(cx2 - r * k, cy2 + r * k, cx2 - r, cy2);
      ctx.quadraticCurveTo(cx2 - r * k, cy2 - r * k, cx2, cy2 - r);
      ctx.fill();
    };
    star(-0.1, -0.05, 0.9, 0.12);
    ctx.fillStyle = '#fff'; star(0.52, 0.5, 0.36, 0.1);
  },
  fish(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#7fc9e8', '#2c7fa8', -0.5, 0.5);
    ctx.beginPath(); ctx.ellipse(-0.1, 0, 0.66, 0.42, 0, 0, Math.PI * 2); ctx.fill(); icoLine(ctx, 0.13);
    ctx.fillStyle = '#2c7fa8';
    ctx.beginPath(); ctx.moveTo(0.5, 0); ctx.lineTo(0.94, -0.4); ctx.lineTo(0.94, 0.4); ctx.closePath(); ctx.fill(); icoLine(ctx, 0.12);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-0.42, -0.1, 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#12303f'; ctx.beginPath(); ctx.arc(-0.44, -0.09, 0.08, 0, Math.PI * 2); ctx.fill();
  },
  star(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#ffe485', '#f0a81c', -0.9, 0.8);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 0.95;
      i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.14);
  },
  chart(ctx) {
    const bar = (bx: number, top: number, col: string) => {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(bx - 0.26, top, 0.52, 0.82 - top, 0.09); ctx.fill(); icoLine(ctx, 0.13);
    };
    bar(-0.6, 0.06, '#c9d4de');
    bar(0.6, 0.3, '#c98f00');
    bar(0, -0.4, '#ffd23a');
    ctx.fillStyle = '#fff8c9';
    ctx.beginPath(); ctx.moveTo(-0.2, -0.5); ctx.lineTo(-0.2, -0.78); ctx.lineTo(-0.06, -0.62);
    ctx.lineTo(0, -0.84); ctx.lineTo(0.06, -0.62); ctx.lineTo(0.2, -0.78); ctx.lineTo(0.2, -0.5);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.1);
  },
  ticket(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#ff8fb0', '#e0446e', -0.5, 0.6);
    ctx.beginPath();
    ctx.moveTo(-0.9, -0.52); ctx.lineTo(0.9, -0.52);
    ctx.lineTo(0.9, -0.16); ctx.arc(0.9, 0, 0.16, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(0.9, 0.56); ctx.lineTo(-0.9, 0.56);
    ctx.lineTo(-0.9, 0.16); ctx.arc(-0.9, 0, 0.16, Math.PI / 2, -Math.PI / 2, true);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.14);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 0.08;
    ctx.setLineDash([0.12, 0.12]);
    ctx.beginPath(); ctx.moveTo(0.32, -0.46); ctx.lineTo(0.32, 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.roundRect(-0.66, -0.24, 0.72, 0.12, 0.06); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-0.66, 0.06, 0.5, 0.12, 0.06); ctx.fill();
  },
  coral(ctx) {
    ctx.strokeStyle = '#ff7a6a'; ctx.lineWidth = 0.24; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0.72); ctx.lineTo(0, -0.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0.2); ctx.quadraticCurveTo(-0.5, 0.02, -0.56, -0.46); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0.0); ctx.quadraticCurveTo(0.5, -0.16, 0.56, -0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -0.1); ctx.quadraticCurveTo(-0.14, -0.5, 0.06, -0.82); ctx.stroke();
    ctx.strokeStyle = '#ffb0a0'; ctx.lineWidth = 0.09;
    ctx.beginPath(); ctx.moveTo(0, 0.5); ctx.lineTo(0, -0.06); ctx.stroke();
    ctx.fillStyle = '#e0cda0';
    ctx.beginPath(); ctx.ellipse(0, 0.76, 0.66, 0.18, 0, Math.PI, 0); ctx.fill();
    ctx.fillRect(-0.66, 0.76, 1.32, 0.14);
  },
  worm(ctx) {
    ctx.strokeStyle = '#e0607a'; ctx.lineWidth = 0.34; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.66, 0.6);
    ctx.bezierCurveTo(-0.95, 0.05, -0.2, 0.12, -0.3, -0.34);
    ctx.bezierCurveTo(-0.38, -0.7, 0.3, -0.82, 0.52, -0.4);
    ctx.stroke();
    ctx.strokeStyle = '#f7a0b0'; ctx.lineWidth = 0.11;
    ctx.beginPath(); ctx.moveTo(-0.6, 0.46); ctx.bezierCurveTo(-0.82, 0.06, -0.14, 0.1, -0.24, -0.32); ctx.stroke();
    ctx.fillStyle = '#3a1a24';
    ctx.beginPath(); ctx.arc(0.42, -0.46, 0.08, 0, Math.PI * 2); ctx.fill();
  },
  bobber(ctx) {
    ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = 0.12;
    ctx.beginPath(); ctx.moveTo(0, -0.62); ctx.lineTo(0, -0.94); ctx.stroke();
    ctx.fillStyle = '#e0483c';
    ctx.beginPath(); ctx.arc(0, 0, 0.62, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#f2f5f8';
    ctx.beginPath(); ctx.arc(0, 0, 0.62, 0, Math.PI); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 0.62, 0, Math.PI * 2); icoLine(ctx, 0.14);
    icoGloss(ctx, -0.24, -0.26, 0.1, 0.2, -0.6, 0.5);
  },
  palette(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#e8d9bd', '#bfa887', -0.8, 0.8);
    ctx.beginPath(); ctx.ellipse(0, 0.02, 0.9, 0.76, 0, 0, Math.PI * 2); ctx.fill(); icoLine(ctx, 0.14);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.ellipse(0.34, 0.3, 0.24, 0.19, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    const cols = ['#e0483c', '#ffd23a', '#5ad46a', '#4aa3ff'];
    cols.forEach((col, i) => {
      const a = Math.PI * (1.15 + i * 0.28);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(Math.cos(a) * 0.5, Math.sin(a) * 0.42 - 0.04, 0.17, 0, Math.PI * 2); ctx.fill();
    });
  },
  hat(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#4a6f4a', '#2c4a30', -0.7, 0.2);
    ctx.beginPath(); ctx.roundRect(-0.42, -0.72, 0.84, 0.82, 0.14); ctx.fill(); icoLine(ctx, 0.14);
    ctx.fillStyle = '#1f3524';
    ctx.fillRect(-0.44, -0.2, 0.88, 0.2);
    ctx.fillStyle = icoGrad(ctx, '#3f6444', '#274228', 0.0, 0.5);
    ctx.beginPath(); ctx.ellipse(0, 0.12, 0.94, 0.28, 0, 0, Math.PI * 2); ctx.fill(); icoLine(ctx, 0.14);
    icoGloss(ctx, -0.2, -0.5, 0.07, 0.16, -0.15, 0.35);
  },
  coat(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#5f7fa8', '#33506f', -0.7, 0.8);
    ctx.beginPath();
    ctx.moveTo(-0.34, -0.66); ctx.lineTo(-0.86, -0.36); ctx.lineTo(-0.7, 0.78); ctx.lineTo(0.7, 0.78);
    ctx.lineTo(0.86, -0.36); ctx.lineTo(0.34, -0.66); ctx.closePath(); ctx.fill(); icoLine(ctx, 0.14);
    ctx.fillStyle = 'rgba(10,20,34,0.4)';
    ctx.beginPath(); ctx.moveTo(-0.34, -0.66); ctx.lineTo(0, -0.06); ctx.lineTo(0.34, -0.66);
    ctx.lineTo(0.1, -0.72); ctx.lineTo(-0.1, -0.72); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath(); ctx.arc(0, 0.18, 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0.52, 0.09, 0, Math.PI * 2); ctx.fill();
  },
  trident(ctx) {
    ctx.save(); ctx.rotate(-Math.PI / 4);
    ctx.strokeStyle = '#8a929b'; ctx.lineWidth = 0.2; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(0, 1.05); ctx.lineTo(0, -0.3); ctx.stroke();
    ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.moveTo(0, 1.05); ctx.lineTo(0, -0.3); ctx.stroke();
    ctx.fillStyle = '#c98f00';
    ctx.beginPath(); ctx.roundRect(-0.16, 0.5, 0.32, 0.34, 0.09); ctx.fill();
    ctx.fillStyle = icoGrad(ctx, '#f2f7fb', '#a8b6c4', -1.05, -0.2);
    ctx.beginPath();
    ctx.moveTo(0, -1.08);
    ctx.lineTo(0.3, -0.42); ctx.lineTo(0.12, -0.5); ctx.lineTo(0.12, -0.16);
    ctx.lineTo(-0.12, -0.16); ctx.lineTo(-0.12, -0.5); ctx.lineTo(-0.3, -0.42);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.12);
    ctx.restore();
  },
  orb(ctx) {
    ctx.fillStyle = '#6a4a8f';
    ctx.beginPath(); ctx.moveTo(-0.5, 0.9); ctx.lineTo(0.5, 0.9); ctx.lineTo(0.3, 0.5); ctx.lineTo(-0.3, 0.5); ctx.closePath(); ctx.fill(); icoLine(ctx, 0.13);
    const g = ctx.createRadialGradient(-0.24, -0.32, 0.06, 0, -0.06, 0.74);
    g.addColorStop(0, '#f2d9ff'); g.addColorStop(0.5, '#b06de0'); g.addColorStop(1, '#5b2f8f');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, -0.06, 0.7, 0, Math.PI * 2); ctx.fill(); icoLine(ctx, 0.14);
    icoGloss(ctx, -0.28, -0.36, 0.12, 0.22, -0.6, 0.6);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(0.24, 0.16, 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-0.1, 0.3, 0.05, 0, Math.PI * 2); ctx.fill();
  },
  gem(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#dff6ff', '#2fa8dd', -0.7, 0.85);
    ctx.beginPath();
    ctx.moveTo(0, -0.72); ctx.lineTo(0.78, -0.16); ctx.lineTo(0, 0.86); ctx.lineTo(-0.78, -0.16);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.14);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.moveTo(0, -0.72); ctx.lineTo(0.3, -0.16); ctx.lineTo(0, 0.86); ctx.lineTo(-0.3, -0.16); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.moveTo(-0.78, -0.16); ctx.lineTo(0.78, -0.16); ctx.stroke();
  },
  net(ctx) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = icoGrad(ctx, '#a9753f', '#63401f', -0.2, 1);
    ctx.lineWidth = 0.24;
    ctx.beginPath(); ctx.moveTo(0.5, 1.0); ctx.lineTo(0.06, 0.12); ctx.stroke();
    ctx.fillStyle = icoGrad(ctx, '#e6eef3', '#8ea4b3', -0.5, 0.9);
    ctx.beginPath();
    ctx.moveTo(-0.74, -0.28);
    ctx.quadraticCurveTo(-0.62, 0.74, 0, 0.82);
    ctx.quadraticCurveTo(0.62, 0.74, 0.74, -0.28);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.12);
    ctx.strokeStyle = 'rgba(38,58,72,0.42)'; ctx.lineWidth = 0.065;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(i * 0.36 - 0.06, -0.22); ctx.lineTo(i * 0.22 + 0.04, 0.66); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(-0.62, 0.08); ctx.quadraticCurveTo(0, 0.34, 0.62, 0.08); ctx.stroke();
    ctx.strokeStyle = icoGrad(ctx, '#f4dda6', '#b3862c', -0.7, 0.1);
    ctx.lineWidth = 0.2;
    ctx.beginPath(); ctx.ellipse(0, -0.28, 0.76, 0.29, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.ellipse(0, -0.28, 0.76, 0.29, 0, 0, Math.PI * 2); ctx.stroke();
    icoGloss(ctx, -0.32, -0.42, 0.17, 0.055, -0.32, 0.55);
  },
  globe(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#7fd0f0', '#2b7fae', -0.9, 0.9);
    ctx.beginPath(); ctx.arc(0, 0, 0.88, 0, Math.PI * 2); ctx.fill(); icoLine(ctx, 0.14);
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 0.88, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#5aa860';
    ctx.beginPath(); ctx.ellipse(-0.38, -0.28, 0.34, 0.24, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0.34, 0.26, 0.4, 0.28, -0.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0.3, -0.5, 0.22, 0.14, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.ellipse(0, 0, 0.42, 0.88, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.88, 0); ctx.lineTo(0.88, 0); ctx.stroke();
    ctx.restore();
    icoGloss(ctx, -0.36, -0.4, 0.1, 0.24, -0.6, 0.4);
  },
  speaker(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#e6edf5', '#a3b1c0', -0.5, 0.6);
    ctx.beginPath();
    ctx.moveTo(-0.82, -0.26); ctx.lineTo(-0.36, -0.26); ctx.lineTo(0.1, -0.78);
    ctx.lineTo(0.1, 0.78); ctx.lineTo(-0.36, 0.26); ctx.lineTo(-0.82, 0.26);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.14);
    ctx.strokeStyle = '#5ad46a'; ctx.lineWidth = 0.15; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0.24, 0, 0.32, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(0.24, 0, 0.62, -0.85, 0.85); ctx.stroke();
  },
  speakerOff(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#c4ccd6', '#78848f', -0.5, 0.6);
    ctx.beginPath();
    ctx.moveTo(-0.82, -0.26); ctx.lineTo(-0.36, -0.26); ctx.lineTo(0.1, -0.78);
    ctx.lineTo(0.1, 0.78); ctx.lineTo(-0.36, 0.26); ctx.lineTo(-0.82, 0.26);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.14);
    ctx.strokeStyle = '#e0483c'; ctx.lineWidth = 0.16; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0.3, -0.34); ctx.lineTo(0.84, 0.34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.84, -0.34); ctx.lineTo(0.3, 0.34); ctx.stroke();
  },
  note(ctx) {
    ctx.strokeStyle = '#b78fe8'; ctx.lineWidth = 0.17; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.16, 0.46); ctx.lineTo(-0.16, -0.72); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.6, 0.24); ctx.lineTo(0.6, -0.9); ctx.stroke();
    ctx.fillStyle = '#b78fe8';
    ctx.beginPath(); ctx.moveTo(-0.16, -0.72); ctx.quadraticCurveTo(0.24, -0.94, 0.6, -0.9);
    ctx.lineTo(0.6, -0.56); ctx.quadraticCurveTo(0.24, -0.62, -0.16, -0.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = icoGrad(ctx, '#d8b8ff', '#8f5cd0', 0.2, 0.7);
    ctx.beginPath(); ctx.ellipse(-0.42, 0.5, 0.3, 0.22, -0.3, 0, Math.PI * 2); ctx.fill(); icoLine(ctx, 0.12);
    ctx.beginPath(); ctx.ellipse(0.34, 0.28, 0.3, 0.22, -0.3, 0, Math.PI * 2); ctx.fill(); icoLine(ctx, 0.12);
  },
  gear(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#c9d4de', '#7c8a99', -0.9, 0.9);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a0 = i * Math.PI / 4;
      ctx.arc(0, 0, 0.92, a0 - 0.19, a0 + 0.19);
      ctx.arc(0, 0, 0.64, a0 + 0.26, a0 + Math.PI / 4 - 0.26);
    }
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.13);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(0, 0, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = 0.12;
    ctx.beginPath(); ctx.arc(0, 0, 0.3, 0, Math.PI * 2); ctx.stroke();
  },
  rain(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#eaf4ff', '#9fb8cf', -0.8, 0.2);
    ctx.beginPath();
    ctx.arc(-0.36, -0.18, 0.4, Math.PI * 0.9, Math.PI * 1.9);
    ctx.arc(0.14, -0.38, 0.46, Math.PI * 1.25, Math.PI * 0.15);
    ctx.arc(0.52, -0.1, 0.32, Math.PI * 1.7, Math.PI * 0.6);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.13);
    ctx.fillStyle = '#4fa8e8';
    for (const dx of [-0.42, 0.04, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(dx, 0.28);
      ctx.quadraticCurveTo(dx + 0.17, 0.62, dx, 0.84);
      ctx.quadraticCurveTo(dx - 0.17, 0.62, dx, 0.28);
      ctx.fill();
    }
  },
  moon(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#fff8d8', '#e8c85a', -0.9, 0.9);
    ctx.beginPath(); ctx.arc(0.04, 0.04, 0.82, 0, Math.PI * 2); ctx.fill(); icoLine(ctx, 0.13);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(0.5, -0.3, 0.74, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff3a0';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 4, r = i % 2 ? 0.08 : 0.26;
      const px = 0.58 + Math.cos(a) * r, py = -0.58 + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  },
  sun(ctx) {
    ctx.strokeStyle = '#ffb02a'; ctx.lineWidth = 0.15; ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 0.66, Math.sin(a) * 0.66);
      ctx.lineTo(Math.cos(a) * 0.95, Math.sin(a) * 0.95);
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(-0.18, -0.22, 0.05, 0, 0, 0.6);
    g.addColorStop(0, '#fff6c2'); g.addColorStop(1, '#f5a20c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 0.54, 0, Math.PI * 2); ctx.fill(); icoLine(ctx, 0.13);
    icoGloss(ctx, -0.2, -0.24, 0.1, 0.17, -0.6, 0.5);
  },
  horn(ctx) {
    ctx.fillStyle = icoGrad(ctx, '#ff9a5c', '#d4501f', -0.6, 0.6);
    ctx.beginPath();
    ctx.moveTo(-0.66, -0.3); ctx.lineTo(0.12, -0.78);
    ctx.lineTo(0.12, 0.78); ctx.lineTo(-0.66, 0.3);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.13);
    ctx.fillStyle = '#6b4423';
    ctx.beginPath(); ctx.roundRect(-0.95, -0.2, 0.3, 0.4, 0.08); ctx.fill(); icoLine(ctx, 0.12);
    ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 0.11; ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      ctx.beginPath(); ctx.arc(0.16, 0, 0.38 + i * 0.28, -0.72, 0.72); ctx.stroke();
    }
  },
  clover(ctx) {
    ctx.strokeStyle = '#3f8b3a'; ctx.lineWidth = 0.12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0.06, 0.3); ctx.quadraticCurveTo(0.3, 0.62, 0.14, 0.95); ctx.stroke();
    ctx.fillStyle = icoGrad(ctx, '#8ce06a', '#3f9b34', -0.8, 0.5);
    const leaf = (ax: number, ay: number) => {
      ctx.save(); ctx.translate(ax * 0.33, ay * 0.33); ctx.rotate(Math.atan2(ay, ax) - Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0.4);
      ctx.bezierCurveTo(-0.5, 0.34, -0.48, -0.4, 0, -0.14);
      ctx.bezierCurveTo(0.48, -0.4, 0.5, 0.34, 0, 0.4);
      ctx.fill(); icoLine(ctx, 0.1);
      ctx.restore();
    };
    leaf(-1, -1); leaf(1, -1); leaf(-1, 1); leaf(1, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.ellipse(-0.4, -0.5, 0.08, 0.14, -0.7, 0, Math.PI * 2); ctx.fill();
  },
  flame(ctx) {
    const g = ctx.createRadialGradient(0, 0.4, 0.06, 0, 0.1, 1);
    g.addColorStop(0, '#fff3a0'); g.addColorStop(0.45, '#ff9a2e'); g.addColorStop(1, '#e0451c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -0.95);
    ctx.bezierCurveTo(0.62, -0.32, 0.78, 0.2, 0.44, 0.62);
    ctx.bezierCurveTo(0.2, 0.9, -0.2, 0.9, -0.44, 0.62);
    ctx.bezierCurveTo(-0.78, 0.2, -0.5, -0.2, -0.16, -0.42);
    ctx.bezierCurveTo(-0.2, -0.1, 0.02, 0.0, 0.1, -0.2);
    ctx.bezierCurveTo(0.18, -0.44, 0.06, -0.7, 0, -0.95);
    ctx.closePath(); ctx.fill(); icoLine(ctx, 0.12);
    ctx.fillStyle = '#fff0b8';
    ctx.beginPath(); ctx.ellipse(0.02, 0.42, 0.19, 0.3, 0, 0, Math.PI * 2); ctx.fill();
  },
  magnet(ctx) {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = icoGrad(ctx, '#c9d4de', '#78848f', -0.9, 0.6);
    ctx.lineWidth = 0.42;
    ctx.beginPath(); ctx.arc(0, 0.1, 0.6, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.6, 0.1); ctx.lineTo(-0.6, 0.52); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.6, 0.1); ctx.lineTo(0.6, 0.52); ctx.stroke();
    ctx.strokeStyle = '#e8443a';
    ctx.beginPath(); ctx.moveTo(-0.6, 0.54); ctx.lineTo(-0.6, 0.86); ctx.stroke();
    ctx.strokeStyle = '#3f7fe0';
    ctx.beginPath(); ctx.moveTo(0.6, 0.54); ctx.lineTo(0.6, 0.86); ctx.stroke();
    ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = 0.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0.1, 0.81, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0.1, 0.39, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.81, 0.1); ctx.lineTo(-0.81, 0.86); ctx.lineTo(-0.39, 0.86); ctx.lineTo(-0.39, 0.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.81, 0.1); ctx.lineTo(0.81, 0.86); ctx.lineTo(0.39, 0.86); ctx.lineTo(0.39, 0.1); ctx.stroke();
  },
};

export const ICON_IDS = Object.keys(ICONS) as IconId[];

/** Draws icon `id` centered at (0,0) in a -1..1 box, scaled by `r` (half-edge-length). */
export function drawIcon(ctx: CanvasRenderingContext2D, id: IconId, x: number, y: number, r: number): boolean {
  const f = ICONS[id];
  if (!f) return false;
  ctx.save();
  ctx.translate(x, y); ctx.scale(r, r);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  f(ctx);
  ctx.restore();
  return true;
}

// ---------------------------------------------------------------------------
// Baking — one small `data:` PNG per (id, pixel size), cached forever.
// ---------------------------------------------------------------------------

const iconCache = new Map<string, string>();

/** Bakes icon `id` into a square PNG of `sizeCss` CSS px and returns its data URL. */
export function bakeIcon(id: IconId, sizeCss = 32): string {
  const key = id + ':' + sizeCss;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const scale = Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 3);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sizeCss * scale));
  canvas.height = canvas.width;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  const r = sizeCss / 2;
  drawIcon(ctx, id, r, r, r * 0.92);
  const url = canvas.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

/** Lookup by id — throws-free accessor for dynamic ids coming from data. */
export function hasIcon(id: string): id is IconId { return Object.prototype.hasOwnProperty.call(ICONS, id); }
