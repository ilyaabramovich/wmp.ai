/**
 * Player controller: binds the AudioEngine + playlist to the WMP chrome.
 */
import type { AudioEngine } from '../audio/engine';
import { Track, describeMediaError } from '../audio/sources';

export type PlayerState = 'stopped' | 'playing' | 'paused' | 'buffering' | 'opening';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const rr = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
}

export class Player {
  tracks: Track[] = [];
  index = -1;
  state: PlayerState = 'stopped';

  onTrackChange: ((t: Track | null) => void) | null = null;
  onError: ((message: string, detail?: string) => void) | null = null;
  onStateChange: ((s: PlayerState) => void) | null = null;

  private audio: HTMLAudioElement;
  private seekEl = $('seek');
  private seekFill = $('seek-fill');
  private seekBuffered = $('seek-buffered');
  private seekThumb = $('seek-thumb');
  private volEl = $('volume');
  private volFill = $('vol-fill');
  private volThumb = $('vol-thumb');
  private btnPlay = $<HTMLButtonElement>('btn-play');
  private btnMute = $<HTMLButtonElement>('btn-mute');
  private statusText = $('status-text');
  private statusBitrate = $('status-bitrate');
  private statusTime = $('status-time');
  private plItems = $('playlist-items');
  private plEmpty = $('playlist-empty');
  private plCount = $('pl-count');
  private plTotal = $('pl-total');
  private npTitle = $('np-title');
  private npArtist = $('np-artist');
  private npThumb = $<HTMLImageElement>('np-thumb');
  private npHeader = $('np-header-title');

  private seeking = false;
  private statusOverride: string | null = null;
  private statusOverrideTimer = 0;
  private lastErrorSrc = '';

  constructor(private engine: AudioEngine) {
    this.audio = engine.audio;
    this.bindTransport();
    this.bindSeek();
    this.bindVolume();
    this.bindAudioEvents();
    this.setVolumeUI(engine.volume);
    this.renderPlaylist();
    this.updateTime();
  }

  // ---------------------------------------------------------------- playlist
  get current(): Track | null {
    return this.tracks[this.index] || null;
  }

  add(tracks: Track[], opts: { play?: boolean; replace?: boolean } = {}) {
    if (opts.replace) this.clear();
    const startIdx = this.tracks.length;
    this.tracks.push(...tracks);
    this.renderPlaylist();
    if (opts.play || this.index < 0) this.playIndex(startIdx);
  }

  clear() {
    this.stop();
    for (const t of this.tracks) if (t.objectUrl) URL.revokeObjectURL(t.objectUrl);
    this.tracks = [];
    this.index = -1;
    this.audio.removeAttribute('src');
    this.audio.load();
    this.setNowPlaying(null);
    this.renderPlaylist();
    this.updateTime();
  }

  remove(i: number) {
    const t = this.tracks[i];
    if (!t) return;
    const wasCurrent = i === this.index;
    this.tracks.splice(i, 1);
    if (t.objectUrl) URL.revokeObjectURL(t.objectUrl);
    if (wasCurrent) {
      this.stop();
      this.index = -1;
      this.audio.removeAttribute('src');
      this.audio.load();
      this.setNowPlaying(null);
    } else if (i < this.index) this.index--;
    this.renderPlaylist();
  }

  async playIndex(i: number) {
    const t = this.tracks[i];
    if (!t) return;
    this.index = i;
    this.engine.resetTaint();
    this.lastErrorSrc = '';
    this.setState('opening');
    this.setNowPlaying(t);
    this.renderPlaylist();
    await this.engine.ensureContext();
    this.audio.src = t.src;
    this.audio.load();
    try {
      await this.audio.play();
    } catch (e: any) {
      if (e?.name === 'AbortError') return; // superseded by another load
      if (e?.name === 'NotAllowedError') {
        this.setState('paused');
        this.flashStatus('Click Play to start (autoplay blocked)');
        return;
      }
      // NotSupportedError etc. — the 'error' event usually also fires; avoid double dialogs.
      if (!this.lastErrorSrc) {
        this.lastErrorSrc = t.src;
        this.setState('stopped');
        this.onError?.(describeMediaError(this.audio.error, t), String(e?.message || e));
      }
    }
  }

  async togglePlay() {
    if (!this.current) {
      if (this.tracks.length) return this.playIndex(0);
      return;
    }
    await this.engine.ensureContext();
    if (this.audio.paused) {
      if (this.state === 'stopped') {
        this.audio.currentTime = 0;
      }
      try { await this.audio.play(); } catch (e: any) {
        if (e?.name !== 'AbortError') this.onError?.(describeMediaError(this.audio.error, this.current), String(e?.message || e));
      }
    } else {
      this.audio.pause();
    }
  }

  async play() {
    if (this.audio.paused) await this.togglePlay();
  }

  pause() {
    if (!this.audio.paused) this.audio.pause();
  }

  stop() {
    this.audio.pause();
    if (this.audio.src && this.audio.readyState > 0) {
      try { this.audio.currentTime = 0; } catch { /* ignore */ }
    }
    this.setState('stopped');
    this.updateTime();
  }

  next() {
    if (!this.tracks.length) return;
    const n = this.index + 1;
    if (n < this.tracks.length) this.playIndex(n);
    else this.stop();
  }

  prev() {
    if (!this.tracks.length) return;
    if (this.audio.currentTime > 3 || this.index <= 0) {
      this.audio.currentTime = 0;
      return;
    }
    this.playIndex(this.index - 1);
  }

  seekBy(delta: number) {
    if (!isFinite(this.audio.duration)) return;
    this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + delta));
  }

  setVolume(v: number) {
    this.engine.volume = v;
    if (this.engine.muted && v > 0) this.setMuted(false);
    this.setVolumeUI(this.engine.volume);
  }

  setMuted(m: boolean) {
    this.engine.muted = m;
    this.btnMute.querySelector<HTMLElement>('.ico-vol')!.hidden = m;
    this.btnMute.querySelector<HTMLElement>('.ico-muted')!.hidden = !m;
    this.btnMute.title = m ? 'Unmute (F8)' : 'Mute (F8)';
  }

  toggleMute() { this.setMuted(!this.engine.muted); }

  // ---------------------------------------------------------------- UI
  flashStatus(text: string, ms = 3000) {
    this.statusOverride = text;
    this.statusText.textContent = text;
    clearTimeout(this.statusOverrideTimer);
    this.statusOverrideTimer = window.setTimeout(() => { this.statusOverride = null; this.updateStatus(); }, ms);
  }

  setStatusSticky(text: string | null) {
    this.statusOverride = text;
    clearTimeout(this.statusOverrideTimer);
    this.updateStatus();
  }

  private setState(s: PlayerState) {
    if (this.state === s) return;
    this.state = s;
    const playing = s === 'playing' || s === 'buffering';
    this.btnPlay.querySelector<HTMLElement>('.ico-play')!.hidden = playing;
    this.btnPlay.querySelector<HTMLElement>('.ico-pause')!.hidden = !playing;
    this.btnPlay.classList.toggle('playing', playing);
    this.btnPlay.title = playing ? 'Pause (Ctrl+P)' : 'Play (Ctrl+P)';
    this.updateStatus();
    this.onStateChange?.(s);
  }

  private updateStatus() {
    if (this.statusOverride) { this.statusText.textContent = this.statusOverride; return; }
    const t = this.current;
    const map: Record<PlayerState, string> = {
      stopped: t ? 'Stopped' : 'Ready',
      playing: 'Playing',
      paused: 'Paused',
      buffering: 'Buffering...',
      opening: 'Opening media...',
    };
    this.statusText.textContent = map[this.state];
  }

  private setNowPlaying(t: Track | null) {
    this.npTitle.textContent = t ? t.title : 'Windows Media Player';
    this.npArtist.textContent = t ? t.artist : 'Open a file or URL to begin (File → Open URL…)';
    this.npHeader.textContent = t ? `${t.title}` : '';
    if (t?.thumbnail) {
      this.npThumb.src = t.thumbnail;
      this.npThumb.hidden = false;
    } else {
      this.npThumb.hidden = true;
      this.npThumb.removeAttribute('src');
    }
    this.statusBitrate.textContent = t?.bitrate ? `${t.bitrate} Kbps` : (t ? (t.kind === 'file' ? 'Local file' : '') : '');
    this.statusBitrate.hidden = !this.statusBitrate.textContent;
    document.title = t ? `${t.title} - Windows Media Player` : 'Windows Media Player';
    this.onTrackChange?.(t);
  }

  private renderPlaylist() {
    this.plItems.innerHTML = '';
    this.plEmpty.hidden = this.tracks.length > 0;
    let total = 0;
    let known = true;
    this.tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'wmp-pl-item' + (i === this.index ? ' current' : '');
      const dur = t.duration ?? (i === this.index && isFinite(this.audio.duration) ? this.audio.duration : null);
      if (dur != null) total += dur; else known = false;
      li.innerHTML = `<span class="wmp-pl-mark">${i === this.index ? '▶' : ''}</span><span class="wmp-pl-idx">${i + 1}</span><span class="wmp-pl-title"></span><span class="wmp-pl-dur">${dur != null ? fmtTime(dur) : ''}</span>`;
      li.querySelector('.wmp-pl-title')!.textContent = t.title;
      li.title = `${t.title}\n${t.artist}${t.sourceUrl ? '\n' + t.sourceUrl : ''}`;
      li.addEventListener('dblclick', () => this.playIndex(i));
      li.addEventListener('click', () => {
        this.plItems.querySelectorAll('.selected').forEach((e) => e.classList.remove('selected'));
        li.classList.add('selected');
      });
      li.dataset.index = String(i);
      this.plItems.appendChild(li);
    });
    this.plCount.textContent = `${this.tracks.length} item(s)`;
    this.plTotal.textContent = `Total Time: ${known ? fmtTime(total) : fmtTime(total) + '+'}`;
  }

  private updateTime() {
    const cur = this.audio.currentTime || 0;
    const dur = isFinite(this.audio.duration) ? this.audio.duration : (this.current?.duration ?? 0);
    this.statusTime.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
    if (!this.seeking) {
      const p = dur > 0 ? Math.min(1, cur / dur) : 0;
      this.seekFill.style.width = `${p * 100}%`;
      this.seekThumb.style.left = `${p * 100}%`;
    }
    // buffered range containing current time
    let bufEnd = 0;
    try {
      const b = this.audio.buffered;
      for (let i = 0; i < b.length; i++) if (b.start(i) <= cur + 0.5 && b.end(i) > bufEnd) bufEnd = b.end(i);
    } catch { /* ignore */ }
    this.seekBuffered.style.width = dur > 0 ? `${Math.min(100, (bufEnd / dur) * 100)}%` : '0%';
    this.seekEl.classList.toggle('disabled', !(dur > 0));
  }

  private setVolumeUI(v: number) {
    this.volFill.style.width = `${v * 100}%`;
    this.volThumb.style.left = `${v * 100}%`;
  }

  // ---------------------------------------------------------------- bindings
  private bindTransport() {
    this.btnPlay.addEventListener('click', () => this.togglePlay());
    $('btn-stop').addEventListener('click', () => this.stop());
    $('btn-prev').addEventListener('click', () => this.prev());
    $('btn-next').addEventListener('click', () => this.next());
    $('btn-rew').addEventListener('click', () => this.seekBy(-10));
    $('btn-ff').addEventListener('click', () => this.seekBy(10));
    this.btnMute.addEventListener('click', () => this.toggleMute());
  }

  private bindSeek() {
    const posFromEvent = (e: PointerEvent) => {
      const r = this.seekEl.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    this.seekEl.addEventListener('pointerdown', (e) => {
      if (!isFinite(this.audio.duration) || this.audio.duration <= 0) return;
      this.seeking = true;
      this.seekEl.setPointerCapture(e.pointerId);
      const p = posFromEvent(e);
      this.seekFill.style.width = `${p * 100}%`;
      this.seekThumb.style.left = `${p * 100}%`;
    });
    this.seekEl.addEventListener('pointermove', (e) => {
      if (!this.seeking) return;
      const p = posFromEvent(e);
      this.seekFill.style.width = `${p * 100}%`;
      this.seekThumb.style.left = `${p * 100}%`;
      this.statusTime.textContent = `${fmtTime(p * this.audio.duration)} / ${fmtTime(this.audio.duration)}`;
    });
    const end = (e: PointerEvent) => {
      if (!this.seeking) return;
      this.seeking = false;
      const p = posFromEvent(e);
      this.audio.currentTime = p * this.audio.duration;
      this.updateTime();
    };
    this.seekEl.addEventListener('pointerup', end);
    this.seekEl.addEventListener('pointercancel', () => { this.seeking = false; });
  }

  private bindVolume() {
    let dragging = false;
    const set = (e: PointerEvent) => {
      const r = this.volEl.getBoundingClientRect();
      this.setVolume(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
    };
    this.volEl.addEventListener('pointerdown', (e) => { dragging = true; this.volEl.setPointerCapture(e.pointerId); set(e); });
    this.volEl.addEventListener('pointermove', (e) => { if (dragging) set(e); });
    this.volEl.addEventListener('pointerup', () => (dragging = false));
    this.volEl.addEventListener('pointercancel', () => (dragging = false));
    this.volEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setVolume(this.engine.volume + (e.deltaY < 0 ? 0.05 : -0.05));
    }, { passive: false });
  }

  private bindAudioEvents() {
    const a = this.audio;
    a.addEventListener('play', () => this.setState('playing'));
    a.addEventListener('playing', () => { this.setState('playing'); this.updateTime(); });
    a.addEventListener('pause', () => { if (this.state !== 'stopped') this.setState('paused'); });
    a.addEventListener('waiting', () => { if (!a.paused) this.setState('buffering'); });
    a.addEventListener('stalled', () => { if (!a.paused) this.setState('buffering'); });
    a.addEventListener('canplay', () => { if (!a.paused) this.setState('playing'); });
    a.addEventListener('timeupdate', () => this.updateTime());
    a.addEventListener('progress', () => this.updateTime());
    a.addEventListener('durationchange', () => { this.updateTime(); this.renderPlaylist(); });
    a.addEventListener('loadedmetadata', () => {
      const t = this.current;
      if (t && (t.duration == null) && isFinite(a.duration)) t.duration = a.duration;
      this.updateTime();
      this.renderPlaylist();
    });
    a.addEventListener('ended', () => { this.setState('stopped'); this.next(); });
    a.addEventListener('error', () => {
      const t = this.current;
      if (!t || !a.src || this.lastErrorSrc === a.src) return;
      this.lastErrorSrc = a.src;
      this.setState('stopped');
      const err = a.error;
      this.onError?.(describeMediaError(err, t), err ? `MediaError code ${err.code}${err.message ? ': ' + err.message : ''}` : undefined);
    });
  }
}
