import type { AudioFrame } from '../audio/frame';
import { Visualizer, logBands, bandValue, PeakCaps, fade, hsl, clamp } from './types';

const BAR_COUNT = 40;

/** Bars and Waves — Ocean Mist: cool blue spectrum bars beneath a mirrored waveform. */
export class OceanMist implements Visualizer {
  id = 'bars-ocean-mist';
  category = 'Bars and Waves';
  name = 'Ocean Mist';

  private bands = logBands(BAR_COUNT, 512);
  private levels = new Float32Array(BAR_COUNT);
  private smooth = new Float32Array(BAR_COUNT);
  private caps = new PeakCaps(BAR_COUNT, 0.2, 2.0);
  private grad: CanvasGradient | null = null;

  init(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    this.grad = ctx.createLinearGradient(0, h, 0, h * 0.25);
    this.grad.addColorStop(0, '#041a4a');
    this.grad.addColorStop(0.4, '#0d4fb8');
    this.grad.addColorStop(0.8, '#3fa6f0');
    this.grad.addColorStop(1, '#bfeeff');
  }

  render(ctx: CanvasRenderingContext2D, f: AudioFrame, w: number, h: number) {
    fade(ctx, w, h, 0.42, '#00030c');

    // --- bars
    const gap = 1;
    const bw = (w - gap * (BAR_COUNT + 1)) / BAR_COUNT;
    const baseY = h - 6;
    const maxH = h * 0.66;
    for (let i = 0; i < BAR_COUNT; i++) {
      const v = clamp(bandValue(f.fftNorm, this.bands[i]) * (1 + i / BAR_COUNT * 0.6), 0, 1);
      this.smooth[i] += (v - this.smooth[i]) * (v > this.smooth[i] ? 0.55 : 0.18);
      this.levels[i] = this.smooth[i];
    }
    this.caps.update(this.levels, f.dt);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.grad || '#2a7fff';
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = gap + i * (bw + gap);
      const bh = Math.max(1, this.levels[i] * maxH);
      ctx.fillRect(Math.round(x), Math.round(baseY - bh), Math.max(1, Math.round(bw)), Math.round(bh));
    }
    // peak caps
    for (let i = 0; i < BAR_COUNT; i++) {
      if (this.caps.values[i] < 0.01) continue;
      const x = gap + i * (bw + gap);
      const cy = baseY - this.caps.values[i] * maxH - 2;
      ctx.fillStyle = hsl(195, 100, 85 - this.caps.values[i] * 15);
      ctx.fillRect(Math.round(x), Math.round(cy), Math.max(1, Math.round(bw)), 2);
    }
    ctx.restore();

    // --- mirrored waveform through the middle
    const midY = h * 0.42;
    const amp = h * 0.22 * (0.6 + f.energy * 0.8);
    const step = Math.max(1, Math.floor(f.wave.length / w));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    for (let pass = 0; pass < 2; pass++) {
      const sign = pass === 0 ? 1 : -1;
      ctx.strokeStyle = pass === 0 ? hsl(200, 100, 78, 0.95) : hsl(215, 100, 62, 0.7);
      ctx.beginPath();
      for (let x = 0, i = 0; x < w; x++, i += step) {
        const s = f.wave[Math.min(i, f.wave.length - 1)];
        const y = midY + sign * s * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // horizon line glow
    ctx.strokeStyle = hsl(205, 100, 90, 0.35 + f.beatIntensity * 0.4);
    ctx.beginPath();
    ctx.moveTo(0, midY + 0.5);
    ctx.lineTo(w, midY + 0.5);
    ctx.stroke();
    ctx.restore();

    // mist: soft radial bloom on beats
    if (f.beatIntensity > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = w * 0.35;
      const g = ctx.createRadialGradient(w / 2, midY, 0, w / 2, midY, r);
      g.addColorStop(0, hsl(200, 100, 70, 0.28 * f.beatIntensity));
      g.addColorStop(1, hsl(200, 100, 70, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }
}
