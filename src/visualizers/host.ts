import type { AudioEngine } from '../audio/engine';
import type { Visualizer } from './types';
import { presets, findPreset, RANDOM_ID } from './index';

const INTERNAL_H = 240;
const MIN_W = 240;
const MAX_W = 480;
const RANDOM_INTERVAL_MS = 30_000;
const CROSSFADE_MS = 1400;

interface Layer {
  viz: Visualizer;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * Drives the render loop: pulls an AudioFrame from the engine, renders the
 * active preset (and the outgoing one during a cross-fade) into low-res
 * offscreen canvases, then composites onto the visible canvas. Also owns the
 * frame-budget governor and Random mode.
 */
export class VisualizerHost {
  private display: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private w = 320;
  private h = INTERNAL_H;

  private current: Layer | null = null;
  private outgoing: Layer | null = null;
  private fadeStart = 0;

  private raf = 0;
  private running = false;
  private lastFrameAt = 0;

  // governor
  quality = 1;
  fps = 0;
  private frameTimes: number[] = [];
  private slowStreak = 0;
  private fastStreak = 0;

  // random mode
  random = false;
  private randomTimer = 0;

  // overlay (crisp DOM label rather than low-res canvas text)
  private overlayEl: HTMLElement | null = null;
  private overlayTimer = 0;

  currentId: string = presets[0].id;
  onPresetChange: ((id: string, random: boolean) => void) | null = null;

  constructor(display: HTMLCanvasElement, private engine: AudioEngine, overlayEl?: HTMLElement) {
    this.display = display;
    this.overlayEl = overlayEl || null;
    this.dctx = display.getContext('2d', { alpha: false })!;
    this.dctx.imageSmoothingEnabled = false;
    this.fitTo(display.parentElement || display);
    this.setPreset(presets[0].id, false);
  }

  /** Choose internal resolution from the container's aspect ratio. */
  fitTo(el: Element) {
    const r = el.getBoundingClientRect();
    const aspect = r.width > 0 && r.height > 0 ? r.width / r.height : 4 / 3;
    const w = Math.round(Math.max(MIN_W, Math.min(MAX_W, INTERNAL_H * aspect)));
    if (w === this.w && this.display.width === w && this.display.height === this.h) return;
    this.w = w;
    this.display.width = w;
    this.display.height = this.h;
    this.dctx.imageSmoothingEnabled = false;
    for (const layer of [this.current, this.outgoing]) {
      if (!layer) continue;
      layer.canvas.width = w;
      layer.canvas.height = this.h;
      layer.viz.init?.(layer.ctx, w, this.h);
    }
  }

  private makeLayer(viz: Visualizer): Layer {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    viz.init?.(ctx, this.w, this.h);
    return { viz, canvas, ctx };
  }

  setPreset(id: string, crossfade = true) {
    if (id === RANDOM_ID) {
      this.setRandom(true);
      return;
    }
    const viz = findPreset(id);
    if (!viz) return;
    if (this.current && this.current.viz.id === id) return;
    if (this.current && crossfade) {
      this.outgoing = this.current;
      this.fadeStart = performance.now();
    } else {
      this.outgoing = null;
    }
    this.current = this.makeLayer(viz);
    this.currentId = id;
    this.showOverlay(`${viz.category}: ${viz.name}`);
    this.onPresetChange?.(id, this.random);
  }

  setRandom(on: boolean) {
    this.random = on;
    this.randomTimer = 0;
    if (on) this.pickRandom();
    this.onPresetChange?.(this.currentId, this.random);
  }

  private pickRandom() {
    const others = presets.filter((p) => p.id !== this.currentId);
    const pick = others[Math.floor(Math.random() * others.length)] || presets[0];
    const wasRandom = this.random;
    this.setPreset(pick.id, true);
    this.random = wasRandom;
  }

  next(dir = 1) {
    const i = presets.findIndex((p) => p.id === this.currentId);
    const n = (i + dir + presets.length) % presets.length;
    this.random = false;
    this.setPreset(presets[n].id, true);
  }

  showOverlay(text: string, ms = 2200) {
    if (!this.overlayEl) return;
    this.overlayEl.textContent = text;
    this.overlayEl.classList.add('show');
    clearTimeout(this.overlayTimer);
    this.overlayTimer = window.setTimeout(() => this.overlayEl?.classList.remove('show'), ms);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrameAt = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.tick(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private govern(t: number) {
    const dt = t - this.lastFrameAt;
    this.lastFrameAt = t;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = avg > 0 ? 1000 / avg : 0;
    if (avg > 19.5) {
      this.slowStreak++;
      this.fastStreak = 0;
      if (this.slowStreak > 20) {
        this.quality = Math.max(0.35, this.quality - 0.1);
        this.slowStreak = 0;
      }
    } else if (avg < 15) {
      this.fastStreak++;
      this.slowStreak = 0;
      if (this.fastStreak > 180 && this.quality < 1) {
        this.quality = Math.min(1, this.quality + 0.05);
        this.fastStreak = 0;
      }
    }
  }

  private tick(t: number) {
    this.govern(t);
    const frame = this.engine.update(this.quality);

    if (this.random) {
      this.randomTimer += frame.dt * 1000;
      if (this.randomTimer >= RANDOM_INTERVAL_MS) {
        this.randomTimer = 0;
        this.pickRandom();
      }
    }

    if (this.current) this.current.viz.render(this.current.ctx, frame, this.w, this.h);
    let fadeT = 1;
    if (this.outgoing) {
      fadeT = Math.min(1, (t - this.fadeStart) / CROSSFADE_MS);
      this.outgoing.viz.render(this.outgoing.ctx, frame, this.w, this.h);
    }

    const d = this.dctx;
    d.globalCompositeOperation = 'source-over';
    d.globalAlpha = 1;
    d.fillStyle = '#000';
    d.fillRect(0, 0, this.w, this.h);
    if (this.outgoing) {
      d.globalAlpha = 1 - fadeT;
      d.drawImage(this.outgoing.canvas, 0, 0);
      if (fadeT >= 1) this.outgoing = null;
    }
    if (this.current) {
      d.globalAlpha = this.outgoing ? fadeT : 1;
      d.drawImage(this.current.canvas, 0, 0);
    }
    d.globalAlpha = 1;

  }
}
