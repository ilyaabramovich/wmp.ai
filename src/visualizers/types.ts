import type { AudioFrame } from '../audio/frame';

/**
 * Every preset implements this. The host gives each preset its own offscreen
 * canvas (so trail effects persist) and calls render() once per frame.
 */
export interface Visualizer {
  /** Stable id used in menus and settings, e.g. "bars-ocean-mist". */
  id: string;
  /** WMP category, e.g. "Bars and Waves". */
  category: string;
  /** Preset display name, e.g. "Ocean Mist". */
  name: string;
  /** Called once when the preset becomes active or the canvas is resized. */
  init?(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  /** Draw one frame. `w`/`h` are the internal (low) resolution. */
  render(ctx: CanvasRenderingContext2D, frame: AudioFrame, w: number, h: number): void;
}

// ------- small shared helpers -------

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;
}

/**
 * Map `count` bars to FFT bins on a log scale so bass doesn't hog the display.
 * Returns [startBin, endBin) pairs. Highest useful bin ≈ 16kHz.
 */
export function logBands(count: number, bins: number, maxBinFrac = 0.72): Array<[number, number]> {
  const maxBin = Math.floor(bins * maxBinFrac);
  const out: Array<[number, number]> = [];
  const minBin = 1;
  for (let i = 0; i < count; i++) {
    const a = Math.floor(minBin * Math.pow(maxBin / minBin, i / count));
    let b = Math.floor(minBin * Math.pow(maxBin / minBin, (i + 1) / count));
    if (b <= a) b = a + 1;
    out.push([a, b]);
  }
  return out;
}

export function bandValue(fftNorm: Float32Array, band: [number, number]): number {
  let m = 0;
  for (let i = band[0]; i < band[1] && i < fftNorm.length; i++) if (fftNorm[i] > m) m = fftNorm[i];
  return m;
}

/** Peak-hold caps with gravity, the WMP "Bars" signature. */
export class PeakCaps {
  values: Float32Array;
  velocities: Float32Array;
  constructor(count: number, public hold = 0.25, public gravity = 2.4) {
    this.values = new Float32Array(count);
    this.velocities = new Float32Array(count);
  }
  private holdTimers = new Float32Array(512);
  update(levels: ArrayLike<number>, dt: number) {
    for (let i = 0; i < this.values.length; i++) {
      const lvl = levels[i];
      if (lvl >= this.values[i]) {
        this.values[i] = lvl;
        this.velocities[i] = 0;
        this.holdTimers[i] = this.hold;
      } else if (this.holdTimers[i] > 0) {
        this.holdTimers[i] -= dt;
      } else {
        this.velocities[i] += this.gravity * dt;
        this.values[i] = Math.max(lvl, this.values[i] - this.velocities[i] * dt);
      }
    }
  }
}

/** Fade the existing canvas content towards black (the "trail" effect). */
export function fade(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number, color = '#000') {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
