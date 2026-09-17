/**
 * The shared per-frame audio snapshot every visualizer consumes.
 * Produced once per requestAnimationFrame by AudioEngine.
 */
export interface AudioFrame {
  /** FFT magnitudes 0..255, length = fftSize/2 (512). Index 0 = DC. */
  fft: Uint8Array<ArrayBuffer>;
  /** FFT magnitudes normalised 0..1 (same length as fft). */
  fftNorm: Float32Array<ArrayBuffer>;
  /** Time-domain waveform, -1..1, length = fftSize (1024). */
  wave: Float32Array<ArrayBuffer>;
  /** Root-mean-square of the waveform, 0..~1. */
  rms: number;
  /** Smoothed loudness envelope 0..1 (fast attack, slow release). */
  energy: number;
  /** Band energies 0..1. */
  bass: number;
  mid: number;
  treble: number;
  /** True on the frame a beat onset is detected. */
  beat: boolean;
  /** 1.0 on a beat, decays to 0 over ~300ms. */
  beatIntensity: number;
  /** Seconds since the engine started rendering. */
  time: number;
  /** Seconds since the previous frame (clamped 0..0.1). */
  dt: number;
  /** 0..1 render quality hint; host lowers it when frames are dropped. */
  quality: number;
  /** Audio sample rate. */
  sampleRate: number;
  /** True when the engine believes the analyser is receiving real signal. */
  live: boolean;
}

export function createEmptyFrame(fftSize = 1024, sampleRate = 44100): AudioFrame {
  return {
    fft: new Uint8Array(fftSize / 2),
    fftNorm: new Float32Array(fftSize / 2),
    wave: new Float32Array(fftSize),
    rms: 0,
    energy: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    beat: false,
    beatIntensity: 0,
    time: 0,
    dt: 0,
    quality: 1,
    sampleRate,
    live: false,
  };
}
