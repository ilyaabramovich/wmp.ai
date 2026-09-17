import type { AudioFrame } from '../audio/frame';
import { Visualizer, logBands, bandValue, PeakCaps, fade, hsl, clamp } from './types';

const BAR_COUNT = 32;

interface Ember { x: number; y: number; vx: number; vy: number; life: number; hue: number; }

/** Bars and Waves — Fire Storm: red/orange spectrum with decaying white-hot peak caps and rising embers. */
export class FireStorm implements Visualizer {
  id = 'bars-fire-storm';
  category = 'Bars and Waves';
  name = 'Fire Storm';

  private bands = logBands(BAR_COUNT, 512, 0.6);
  private levels = new Float32Array(BAR_COUNT);
  private caps = new PeakCaps(BAR_COUNT, 0.35, 3.2);
  private embers: Ember[] = [];
  private grad: CanvasGradient | null = null;

  init(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    this.grad = ctx.createLinearGradient(0, h, 0, h * 0.2);
    this.grad.addColorStop(0, '#4a0500');
    this.grad.addColorStop(0.35, '#c81a00');
    this.grad.addColorStop(0.7, '#ff7a00');
    this.grad.addColorStop(0.92, '#ffd23a');
    this.grad.addColorStop(1, '#fff6c8');
    this.embers.length = 0;
  }

  render(ctx: CanvasRenderingContext2D, f: AudioFrame, w: number, h: number) {
    fade(ctx, w, h, 0.22, '#0a0000');

    const gap = 2;
    const bw = (w - gap * (BAR_COUNT + 1)) / BAR_COUNT;
    const baseY = h - 4;
    const maxH = h * 0.8;

    for (let i = 0; i < BAR_COUNT; i++) {
      const raw = bandValue(f.fftNorm, this.bands[i]);
      const v = clamp(Math.pow(raw, 1.25) * (1 + i / BAR_COUNT * 0.9), 0, 1);
      this.levels[i] += (v - this.levels[i]) * (v > this.levels[i] ? 0.7 : 0.22);
    }
    this.caps.update(this.levels, f.dt);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // heat haze behind bars
    const haze = ctx.createLinearGradient(0, h, 0, h * 0.5);
    haze.addColorStop(0, hsl(10, 100, 30, 0.25 + f.bass * 0.25));
    haze.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);

    ctx.fillStyle = this.grad || '#f40';
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = gap + i * (bw + gap);
      const bh = Math.max(1, this.levels[i] * maxH);
      ctx.fillRect(Math.round(x), Math.round(baseY - bh), Math.max(1, Math.round(bw)), Math.round(bh));
    }
    // white-hot caps that cool as they fall
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = gap + i * (bw + gap);
      const cap = this.caps.values[i];
      const cy = baseY - cap * maxH - 3;
      const heat = clamp(1 - (cap - this.levels[i]) * 3, 0, 1); // hotter when close to bar
      ctx.fillStyle = hsl(40 * heat + 5, 100, 55 + heat * 40);
      ctx.fillRect(Math.round(x), Math.round(cy), Math.max(1, Math.round(bw)), 3);
    }
    ctx.restore();

    // embers spawn on beats / high energy
    const maxEmbers = Math.round(160 * f.quality);
    const spawn = (f.beat ? 14 : 0) + Math.round(f.energy * 3 * f.quality);
    for (let s = 0; s < spawn && this.embers.length < maxEmbers; s++) {
      const bi = Math.floor(Math.random() * BAR_COUNT);
      const x = gap + bi * (bw + gap) + Math.random() * bw;
      const y = baseY - this.levels[bi] * maxH;
      this.embers.push({
        x, y,
        vx: (Math.random() - 0.5) * 18,
        vy: -(30 + Math.random() * 60) * (0.6 + f.energy),
        life: 0.7 + Math.random() * 0.9,
        hue: 10 + Math.random() * 40,
      });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.life -= f.dt;
      if (e.life <= 0 || e.y < -4) { this.embers.splice(i, 1); continue; }
      e.vx += Math.sin(f.time * 3 + e.y * 0.1) * 30 * f.dt;
      e.vy -= 10 * f.dt;
      e.x += e.vx * f.dt;
      e.y += e.vy * f.dt;
      const a = clamp(e.life, 0, 1);
      ctx.fillStyle = hsl(e.hue, 100, 55 + a * 30, a);
      ctx.fillRect(Math.round(e.x), Math.round(e.y), 1, 1);
    }
    ctx.restore();
  }
}
