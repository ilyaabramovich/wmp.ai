import type { AudioFrame } from '../audio/frame';
import { Visualizer, fade, hsl, TAU } from './types';

const RIBBONS = 5;

/** Battery — Rainbow Ribbons: Lissajous oscilloscope ribbons plotted from the waveform against a delayed copy of itself. */
export class RainbowRibbons implements Visualizer {
  id = 'battery-rainbow-ribbons';
  category = 'Battery';
  name = 'Rainbow Ribbons';

  private hue = 0;
  private rot = 0;
  private prevWave = new Float32Array(1024);
  private zoom = 1;
  /** running peak used for auto-gain so quiet material still fills the pane */
  private peak = 0.3;

  init(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    this.prevWave.fill(0);
  }

  render(ctx: CanvasRenderingContext2D, f: AudioFrame, w: number, h: number) {
    fade(ctx, w, h, 0.3, '#000');

    const cx = w / 2;
    const cy = h / 2;
    this.hue += f.dt * (25 + f.treble * 120);
    this.rot += f.dt * (0.15 + f.energy * 0.6);
    const targetZoom = 0.85 + f.beatIntensity * 0.35 + f.energy * 0.25;
    this.zoom += (targetZoom - this.zoom) * 0.2;

    const N = f.wave.length;
    let pk = 0;
    for (let i = 0; i < N; i += 4) { const v = Math.abs(f.wave[i]); if (v > pk) pk = v; }
    this.peak = pk > this.peak ? this.peak + (pk - this.peak) * 0.3 : Math.max(0.05, this.peak - f.dt * 0.15);
    const gain = Math.min(5, 0.7 / this.peak);
    const ampX = w * 0.42 * this.zoom * gain;
    const ampY = h * 0.42 * this.zoom * gain;
    const step = f.quality < 0.6 ? 8 : 4;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';

    for (let r = 0; r < RIBBONS; r++) {
      // each ribbon uses a different phase delay → different Lissajous figure
      const delay = Math.floor(N * (0.06 + r * 0.045)) ;
      const ang = this.rot + r * (TAU / RIBBONS) * 0.25;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const hue = this.hue + r * (360 / RIBBONS);
      ctx.strokeStyle = hsl(hue, 100, 60, 0.5);
      ctx.beginPath();
      for (let i = 0; i < N; i += step) {
        const x0 = f.wave[i];
        const j = i + delay;
        const y0 = j < N ? f.wave[j] : this.prevWave[j - N];
        // rotate
        const xr = x0 * ca - y0 * sa;
        const yr = x0 * sa + y0 * ca;
        const x = cx + xr * ampX;
        const y = cy + yr * ampY;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // a fainter, brighter echo drawn larger on beats
    if (f.beatIntensity > 0.1) {
      ctx.strokeStyle = hsl(this.hue + 180, 100, 85, 0.35 * f.beatIntensity);
      ctx.beginPath();
      const k = 1 + f.beatIntensity * 0.25;
      for (let i = 0; i < N; i += step * 2) {
        const x = cx + f.wave[i] * ampX * k;
        const y = cy + f.wave[(i + N / 4) % N] * ampY * k;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // "battery" level meters in the top-right corner, a nod to the preset family
    const meterW = 3;
    const bands = [f.bass, f.mid, f.treble, f.energy];
    for (let i = 0; i < bands.length; i++) {
      const mh = Math.round(bands[i] * (h * 0.2));
      ctx.fillStyle = hsl(this.hue + i * 50, 100, 60, 0.9);
      ctx.fillRect(w - 4 - (bands.length - i) * (meterW + 2), 4 + (h * 0.2 - mh), meterW, mh);
    }
    ctx.restore();

    this.prevWave.set(f.wave);
  }
}
