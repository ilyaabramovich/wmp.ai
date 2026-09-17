/**
 * Source loading: local files, YouTube (via backend /api/resolve) and direct URLs.
 */

export type TrackKind = 'file' | 'youtube' | 'url';

export interface Track {
  id: string;
  kind: TrackKind;
  title: string;
  artist: string;
  /** URL to assign to <audio>.src */
  src: string;
  /** Original URL the user supplied (for re-resolve) */
  sourceUrl?: string;
  duration?: number | null;
  thumbnail?: string | null;
  bitrate?: number | null;
  mime?: string | null;
  /** Object URL to revoke when the track is removed */
  objectUrl?: string;
}

export class SourceError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status = 0, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

let counter = 0;
const nextId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}`;

export function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(u.hostname);
  } catch {
    return false;
  }
}

export function trackFromFile(file: File): Track {
  const objectUrl = URL.createObjectURL(file);
  const name = file.name.replace(/\.[^.]+$/, '');
  return {
    id: nextId(),
    kind: 'file',
    title: name,
    artist: 'Unknown Artist',
    src: objectUrl,
    objectUrl,
    mime: file.type || null,
    bitrate: null,
  };
}

export function trackFromDirectUrl(url: string): Track {
  let title = url;
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
    title = last.replace(/\.[^.]+$/, '') || u.hostname;
  } catch { /* keep url */ }
  return {
    id: nextId(),
    kind: 'url',
    title,
    artist: safeHost(url),
    src: url,
    sourceUrl: url,
  };
}

function safeHost(url: string) {
  try { return new URL(url).hostname; } catch { return 'Internet'; }
}

export interface ResolveResult {
  id: string;
  key: string;
  title: string;
  uploader: string;
  duration: number | null;
  thumbnail: string | null;
  bitrate: number | null;
  mime: string;
  streamUrl: string;
  expiresAt: number;
  cached: boolean;
}

/**
 * Container preference for this browser, most-preferred first. Chromium (open
 * source builds) lacks AAC, Safari lacks WebM/Opus; ask the server for what we
 * can actually decode.
 */
export function preferredContainers(): string[] {
  const a = document.createElement('audio');
  const can = (t: string) => a.canPlayType(t) !== '';
  const out: string[] = [];
  const m4a = can('audio/mp4; codecs="mp4a.40.2"');
  const webm = can('audio/webm; codecs="opus"');
  if (m4a) out.push('m4a');
  if (webm) out.push('webm');
  if (!m4a && webm) return ['webm', 'm4a'];
  if (!out.length) out.push('m4a', 'webm');
  return out;
}

export async function resolveYouTube(url: string, opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<Track> {
  let res: Response;
  try {
    res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, force: !!opts.force, prefer: preferredContainers() }),
      signal: opts.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new SourceError(
      'Windows Media Player cannot connect to the local server. Make sure `npm run dev` started the API on port 3001.',
      0,
      String(e?.message || e),
    );
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    throw new SourceError(body?.error || `The server returned HTTP ${res.status}.`, res.status, body?.detail);
  }
  const r = body as ResolveResult;
  return {
    id: nextId(),
    kind: 'youtube',
    title: r.title,
    artist: r.uploader,
    src: r.streamUrl,
    sourceUrl: url,
    duration: r.duration,
    thumbnail: r.thumbnail,
    bitrate: r.bitrate,
    mime: r.mime,
  };
}

/** Map a MediaError from <audio> to a WMP-style message. */
export function describeMediaError(err: MediaError | null, track?: Track | null): string {
  if (!err) return 'Windows Media Player encountered an unknown problem while playing the file.';
  switch (err.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Playback was aborted.';
    case MediaError.MEDIA_ERR_NETWORK:
      return track?.kind === 'youtube'
        ? 'A network error interrupted the stream. The extracted address may have expired — try opening the URL again.'
        : 'Windows Media Player cannot play the file because a network error occurred.';
    case MediaError.MEDIA_ERR_DECODE:
      return 'Windows Media Player cannot play the file. The file is corrupt or uses a codec that is not supported.';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return track?.kind === 'url'
        ? 'Windows Media Player cannot play the file. The server may not allow cross-origin access, or the format is not supported.'
        : 'Windows Media Player cannot play the file. The format is not supported or the address is invalid.';
    default:
      return err.message || 'Windows Media Player encountered an unknown problem while playing the file.';
  }
}
