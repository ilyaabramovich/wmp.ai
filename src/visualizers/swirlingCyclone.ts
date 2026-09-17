import type { AudioFrame } from '../audio/frame';
import { Visualizer, fade, hsl, TAU, clamp } from './types';

interface P { a: number; r: number; speed: number; bin: number; size: number; phase: number; }

const MAX_PARTICLES = 420;

/** Ambience — Swirling Cyclone: hue-cycling particles orbiting a beat-reactive vortex, with long trails. */
export class SwirlingCyclone implements Visualizer {
  id = 'ambience-swirling-cyclone';
  category = 'Ambience';
  name = 'Swirling Cyclone';

  private ps: P[] = [];
  private rot = 0;
  private hue = 200;
  private pulse = 0;

  init(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    this.ps.length = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) this.ps.push(this.spawn(i));
  }

  private spawn(i: number): P {
    const t = i / MAX_PARTICLES;
    return {
      a: Math.random() * TAU,
      r: 0.08 + Math.pow(Math.random(), 0.7) * 0.92,
      speed: 0.35 + Math.random() * 0.9,
      bin: 2 + Math.floor(Math.pow(t, 1.6) * 180),
      size: Math.random() < 0.15 ? 2 : 1,
      phase: Math.random() * TAU,
    };
  }

  render(ctx: CanvasRenderingContext2D, f: AudioFrame, w: number, h: number) {
    fade(ctx, w, h, 0.09 + f.beatIntensity * 0.05, '#000006');

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.48;
    this.hue += f.dt * (12 + f.energy * 60);
    this.rot += f.dt * (0.35 + f.energy * 2.2 + f.beatIntensity * 1.5);
    this.pulse += ((f.beat ? 1 : 0) - this.pulse) * (f.beat ? 1 : f.dt * 4);

    const count = Math.round(MAX_PARTICLES * clamp(f.quality, 0.3, 1));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const p = this.ps[i];
      const mag = f.fftNorm[p.bin];
      // Inner particles spin faster; audio magnitude pushes them outward.
      p.a += f.dt * p.speed * (1.2 - p.r * 0.7) * (1 + mag * 3) * (1 + f.energy * 1.5);
      const wobble = Math.sin(f.time * 1.7 + p.phase) * 0.06;
      const r = (p.r + wobble + mag * 0.35 + this.pulse * 0.08) * R * (0.85 + f.energy * 0.25);
      const ang = p.a + this.rot * (0.6 + p.r * 0.6);
      const x = cx + Math.cos(ang) * r * (w / h > 1 ? 1.15 : 1);
      const y = cy + Math.sin(ang) * r * 0.78;
      const hue = this.hue + p.r * 90 + mag * 60;
      const lum = 45 + mag * 45;
      ctx.fillStyle = hsl(hue, 95, lum, 0.55 + mag * 0.45);
      ctx.fillRect(Math.round(x), Math.round(y), p.size, p.size);
    }

    // eye of the cyclone
    const eyeR = R * (0.08 + f.bass * 0.2 + f.beatIntensity * 0.12);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, eyeR);
    g.addColorStop(0, hsl(this.hue + 40, 100, 92, 0.9));
    g.addColorStop(0.5, hsl(this.hue + 20, 100, 60, 0.35));
    g.addColorStop(1, hsl(this.hue, 100, 50, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - eyeR, cy - eyeR, eyeR * 2, eyeR * 2);

    // spiral arms
    ctx.lineWidth = 1;
    for (let arm = 0; arm < 3; arm++) {
      ctx.strokeStyle = hsl(this.hue + arm * 40, 100, 70, 0.18 + f.mid * 0.4);
      ctx.beginPath();
      const steps = 60;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const ang = -this.rot * 1.4 + arm * (TAU / 3) + t * 4.2;
        const rr = t * R * (0.9 + f.energy * 0.2);
        const x = cx + Math.cos(ang) * rr * 1.1;
        const y = cy + Math.sin(ang) * rr * 0.78;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
