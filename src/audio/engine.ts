import { AudioFrame, createEmptyFrame } from './frame';

export type EngineEvent =
  | 'frame'
  | 'tainted'
  | 'contextresumed'
  | 'error';

type Listener = (payload?: unknown) => void;

const FFT_SIZE = 1024;
const SMOOTHING = 0.8;

/**
 * Owns the <audio> element, the AudioContext graph and the analyser.
 * Call `update()` once per animation frame to refresh `frame`.
 */
export class AudioEngine {
  readonly audio: HTMLAudioElement;
  readonly frame: AudioFrame;

  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;

  private listeners = new Map<EngineEvent, Set<Listener>>();
  private startTime = performance.now();
  private lastTime = performance.now();

  // Beat detection state
  private energyHistory = new Float32Array(43); // ~0.7s at 60fps
  private historyIdx = 0;
  private lastBeatAt = -1;

  // Taint detection
  private silentSince: number | null = null;
  private taintReported = false;

  private _volume = 0.8;
  private _muted = false;

  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'auto';
    this.audio.volume = this._volume;
    this.frame = createEmptyFrame(FFT_SIZE);
  }

  on(evt: EngineEvent, fn: Listener): () => void {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt)!.add(fn);
    return () => this.listeners.get(evt)?.delete(fn);
  }

  private emit(evt: EngineEvent, payload?: unknown) {
    this.listeners.get(evt)?.forEach((fn) => fn(payload));
  }

  /** Must be called from a user gesture at least once (autoplay policy). */
  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext = (window.AudioContext || (window as any).webkitAudioContext);
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = SMOOTHING;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 1;
      this.source = this.ctx.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.gain);
      this.gain.connect(this.ctx.destination);
      this.frame.sampleRate = this.ctx.sampleRate;
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
        this.emit('contextresumed');
      } catch (e) {
        this.emit('error', e);
      }
    }
    return this.ctx;
  }

  get contextState(): AudioContextState | 'none' {
    return this.ctx ? this.ctx.state : 'none';
  }

  get volume() { return this._volume; }
  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    this.audio.volume = this._muted ? 0 : this._volume;
  }
  get muted() { return this._muted; }
  set muted(m: boolean) {
    this._muted = m;
    this.audio.volume = m ? 0 : this._volume;
  }

  /** Reset taint detection (call when loading a new source). */
  resetTaint() {
    this.silentSince = null;
    this.taintReported = false;
    this.frame.live = false;
  }

  /** Refresh `frame` from the analyser. Call once per rAF. */
  update(quality = 1): AudioFrame {
    const now = performance.now();
    const f = this.frame;
    f.dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    f.time = (now - this.startTime) / 1000;
    f.quality = quality;
    f.beat = false;

    if (!this.analyser) {
      f.beatIntensity = Math.max(0, f.beatIntensity - f.dt * 3.3);
      return f;
    }

    this.analyser.getByteFrequencyData(f.fft);
    this.analyser.getFloatTimeDomainData(f.wave);

    // Normalised FFT + band energies
    let sum = 0;
    const n = f.fft.length;
    for (let i = 0; i < n; i++) {
      const v = f.fft[i] / 255;
      f.fftNorm[i] = v;
      sum += v;
    }
    const bandAvg = (lo: number, hi: number) => {
      let s = 0;
      for (let i = lo; i < hi; i++) s += f.fftNorm[i];
      return s / Math.max(1, hi - lo);
    };
    // With 44.1k / 1024 fft each bin ≈ 43Hz.
    f.bass = bandAvg(1, 6);      // ~43–260 Hz
    f.mid = bandAvg(6, 60);      // ~260–2600 Hz
    f.treble = bandAvg(60, 256); // ~2.6k–11k Hz

    // RMS
    let sq = 0;
    for (let i = 0; i < f.wave.length; i++) sq += f.wave[i] * f.wave[i];
    f.rms = Math.sqrt(sq / f.wave.length);

    // Energy envelope: fast attack, slow release
    const inst = Math.min(1, f.rms * 2.2);
    const k = inst > f.energy ? 0.5 : 0.08;
    f.energy += (inst - f.energy) * k;

    // Beat: bass-weighted instant energy vs recent history
    const instBeat = f.bass * 0.7 + inst * 0.3;
    let hAvg = 0;
    let hVar = 0;
    for (let i = 0; i < this.energyHistory.length; i++) hAvg += this.energyHistory[i];
    hAvg /= this.energyHistory.length;
    for (let i = 0; i < this.energyHistory.length; i++) {
      const d = this.energyHistory[i] - hAvg;
      hVar += d * d;
    }
    hVar /= this.energyHistory.length;
    const c = Math.max(1.15, 1.5 - hVar * 12);
    const sinceBeat = f.time - this.lastBeatAt;
    if (instBeat > 0.08 && instBeat > hAvg * c && sinceBeat > 0.22) {
      f.beat = true;
      f.beatIntensity = 1;
      this.lastBeatAt = f.time;
    } else {
      f.beatIntensity = Math.max(0, f.beatIntensity - f.dt * 3.3);
    }
    this.energyHistory[this.historyIdx] = instBeat;
    this.historyIdx = (this.historyIdx + 1) % this.energyHistory.length;

    // Taint detection: playing, time advancing, but analyser flat for >1.5s.
    const playing = !this.audio.paused && !this.audio.ended && this.audio.currentTime > 0.5 && this.audio.readyState >= 3;
    const flat = sum < 0.001 && f.rms < 1e-5;
    if (playing && flat) {
      if (this.silentSince == null) this.silentSince = now;
      else if (now - this.silentSince > 1500 && !this.taintReported) {
        this.taintReported = true;
        this.emit('tainted');
      }
    } else {
      this.silentSince = null;
      if (playing && !flat) f.live = true;
    }

    return f;
  }
}
