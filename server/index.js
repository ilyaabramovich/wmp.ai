// WMP XP Visualizer — backend
// Resolves YouTube URLs with yt-dlp, caches the result on disk, and proxies the
// audio stream back to the browser with permissive CORS + HTTP Range support so
// the Web Audio API can analyse it and the <audio> element can seek.

import express from 'express';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const CACHE_DIR = path.join(__dirname, 'cache');
// Extracted googlevideo URLs are typically valid ~6h. Keep well under that.
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 4 * 60 * 60 * 1000);
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

// ---------------------------------------------------------------------------
// Startup checks
// ---------------------------------------------------------------------------
function checkBinary(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (r.error || r.status !== 0) return null;
    return (r.stdout || '').trim().split('\n')[0];
  } catch {
    return null;
  }
}

const ytdlpVersion = checkBinary(YTDLP, ['--version']);
const ffmpegVersion = checkBinary('ffmpeg', ['-version']);

if (!ytdlpVersion) {
  console.error('\n  ┌──────────────────────────────────────────────────────────────┐');
  console.error('  │  yt-dlp was not found on PATH.                               │');
  console.error('  │  YouTube URLs will not work until it is installed:           │');
  console.error('  │    brew install yt-dlp      (macOS)                          │');
  console.error('  │    pip install -U yt-dlp    (any platform)                   │');
  console.error('  │  Local files and direct audio URLs still work.               │');
  console.error('  └──────────────────────────────────────────────────────────────┘\n');
} else {
  console.log(`  yt-dlp ${ytdlpVersion}`);
}
if (!ffmpegVersion) {
  console.warn('  ffmpeg not found — not required for streaming, but yt-dlp may need it for some formats.');
} else {
  console.log(`  ${ffmpegVersion.replace(/ Copyright.*$/, '')}`);
}

await mkdir(CACHE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const YT_ID_RE = /(?:v=|\/(?:shorts|embed|live|v)\/|youtu\.be\/)([A-Za-z0-9_-]{11})/;

function extractVideoId(url) {
  const m = url.match(YT_ID_RE);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  return null;
}

function isYouTube(url) {
  try {
    const u = new URL(url);
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|music\.youtube\.com)$/.test(u.hostname);
  } catch {
    return false;
  }
}

function cacheKey(url) {
  return extractVideoId(url) || createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function cachePath(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

async function readCache(key) {
  try {
    const raw = await readFile(cachePath(key), 'utf8');
    const entry = JSON.parse(raw);
    if (Date.now() - entry.resolvedAt > CACHE_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

async function writeCache(key, entry) {
  await writeFile(cachePath(key), JSON.stringify(entry), 'utf8');
}

async function dropCache(key) {
  try { await unlink(cachePath(key)); } catch { /* ignore */ }
}

async function sweepCache() {
  try {
    const files = await readdir(CACHE_DIR);
    for (const f of files) {
      const p = path.join(CACHE_DIR, f);
      const s = await stat(p);
      if (Date.now() - s.mtimeMs > CACHE_TTL_MS * 2) await unlink(p);
    }
  } catch { /* ignore */ }
}
setInterval(sweepCache, 30 * 60 * 1000).unref();

/** Map yt-dlp stderr to a period-accurate, human message + HTTP status. */
function classifyYtdlpError(stderr) {
  const s = stderr || '';
  const rules = [
    [/Sign in to confirm your age|age[- ]restricted|confirm your age/i, 451,
      'This video is age-restricted. Windows Media Player cannot play age-restricted YouTube content without signing in.'],
    [/not available in your country|geo[- ]?restricted|blocked it in your country/i, 451,
      'The uploader has not made this video available in your country.'],
    [/Private video/i, 403,
      'This video is private. The file could not be opened.'],
    [/Video unavailable|This video is unavailable|has been removed|no longer available/i, 404,
      'The requested video is unavailable. It may have been removed, or the address may be incorrect.'],
    [/is not a valid URL|Unsupported URL/i, 400,
      'The address is not a valid URL. Please check the address and try again.'],
    [/Sign in to confirm you.re not a bot|HTTP Error 429|Too Many Requests/i, 429,
      'YouTube is rate-limiting requests from this computer. Please wait a few minutes and try again.'],
    [/requested format is not available|No video formats found/i, 415,
      'Windows Media Player cannot play the file. No compatible audio format was found.'],
    [/is a live event|live stream|This live event/i, 415,
      'Live streams are not supported. Please choose a recorded video.'],
    [/Premieres in|premiere/i, 415,
      'This video has not premiered yet.'],
    [/members-only|Join this channel/i, 403,
      'This video is available to channel members only.'],
    [/Unable to download webpage|getaddrinfo|Network is unreachable|Temporary failure in name resolution/i, 502,
      'Windows Media Player cannot connect to the server. Check your Internet connection and try again.'],
  ];
  for (const [re, status, message] of rules) {
    if (re.test(s)) return { status, message };
  }
  const lastErr = s.split('\n').reverse().find((l) => /ERROR/.test(l));
  return {
    status: 500,
    message: 'Windows Media Player cannot play the file. The extractor reported an error.',
    detail: lastErr ? lastErr.replace(/^ERROR:\s*/, '').trim() : undefined,
  };
}

/** Run yt-dlp -J and pick the best audio-only format. */
const ALLOWED_EXTS = ['m4a', 'webm', 'mp3', 'ogg', 'opus'];

/** Build a yt-dlp -f selector from the browser's preferred container order. */
function formatSelector(prefer) {
  const exts = (Array.isArray(prefer) ? prefer : []).filter((e) => ALLOWED_EXTS.includes(e));
  if (!exts.length) exts.push('m4a', 'webm');
  return exts.map((e) => `bestaudio[ext=${e}]`).concat(['bestaudio', 'best']).join('/');
}

function runYtdlp(url, prefer) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      // Prefer a container the requesting browser can decode natively.
      '-f', formatSelector(prefer),
      url,
    ];
    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('yt-dlp timed out'), { status: 504, message: 'The server timed out while resolving the video. Please try again.' }));
    }, 60_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      if (e.code === 'ENOENT') {
        reject(Object.assign(new Error('yt-dlp missing'), {
          status: 503,
          message: 'yt-dlp is not installed on the server. Install it (brew install yt-dlp) and restart.',
        }));
      } else reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const c = classifyYtdlpError(err);
        reject(Object.assign(new Error(c.message), c));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 500, message: 'The extractor returned an unreadable response.' }));
      }
    });
  });
}

function pickFormat(info) {
  // With -f given, yt-dlp puts the selected format at top level.
  if (info.url) {
    return {
      url: info.url,
      ext: info.ext,
      abr: info.abr,
      acodec: info.acodec,
      http_headers: info.http_headers || {},
      filesize: info.filesize || info.filesize_approx || null,
    };
  }
  if (Array.isArray(info.requested_formats) && info.requested_formats.length) {
    const f = info.requested_formats.find((x) => x.vcodec === 'none') || info.requested_formats[0];
    return { url: f.url, ext: f.ext, abr: f.abr, acodec: f.acodec, http_headers: f.http_headers || {}, filesize: f.filesize || null };
  }
  const audio = (info.formats || []).filter((f) => f.vcodec === 'none' && f.url);
  audio.sort((a, b) => (b.abr || 0) - (a.abr || 0));
  const f = audio[0];
  if (!f) return null;
  return { url: f.url, ext: f.ext, abr: f.abr, acodec: f.acodec, http_headers: f.http_headers || {}, filesize: f.filesize || null };
}

function mimeFor(ext, acodec) {
  if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
  if (ext === 'webm') return acodec && /opus/i.test(acodec) ? 'audio/webm; codecs="opus"' : 'audio/webm';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
  return 'application/octet-stream';
}

async function resolveAndCache(url, key, prefer) {
  const info = await runYtdlp(url, prefer);
  const fmt = pickFormat(info);
  if (!fmt) {
    throw Object.assign(new Error('no format'), { status: 415, message: 'No compatible audio-only format was found for this video.' });
  }
  const entry = {
    key,
    id: info.id || key,
    sourceUrl: url,
    title: info.title || 'Unknown title',
    uploader: info.uploader || info.channel || info.artist || 'Unknown artist',
    duration: info.duration || null,
    thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.length ? info.thumbnails.at(-1).url : null),
    prefer: Array.isArray(prefer) ? prefer : undefined,
    abr: fmt.abr ? Math.round(fmt.abr) : null,
    ext: fmt.ext,
    acodec: fmt.acodec,
    mime: mimeFor(fmt.ext, fmt.acodec),
    filesize: fmt.filesize,
    upstream: fmt.url,
    headers: fmt.http_headers,
    resolvedAt: Date.now(),
  };
  await writeCache(key, entry);
  return entry;
}

const inflight = new Map();
function resolveDeduped(url, key, force = false, prefer = undefined) {
  if (!force && inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    if (!force) {
      const cached = await readCache(key);
      if (cached) return { entry: cached, cached: true };
    }
    const entry = await resolveAndCache(url, key, prefer);
    return { entry, cached: false };
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function publicEntry(entry, cached) {
  return {
    id: entry.id,
    key: entry.key,
    title: entry.title,
    uploader: entry.uploader,
    duration: entry.duration,
    thumbnail: entry.thumbnail,
    bitrate: entry.abr,
    mime: entry.mime,
    streamUrl: `/api/stream/${encodeURIComponent(entry.key)}`,
    expiresAt: entry.resolvedAt + CACHE_TTL_MS,
    cached,
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ytdlp: ytdlpVersion, ffmpeg: !!ffmpegVersion, cacheTtlMs: CACHE_TTL_MS });
});

app.post('/api/resolve', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const force = !!req.body?.force;
  if (!url) return res.status(400).json({ error: 'Please type the address of the file you want to open.' });
  if (!isYouTube(url)) {
    return res.status(400).json({ error: 'Windows Media Player only resolves YouTube addresses through the server. For other audio, open the direct file URL.' });
  }
  if (!ytdlpVersion) {
    return res.status(503).json({ error: 'yt-dlp is not installed on the server. Install it (brew install yt-dlp or pip install yt-dlp) and restart the server.' });
  }
  const prefer = Array.isArray(req.body?.prefer) ? req.body.prefer.map(String).slice(0, 5) : undefined;
  // The container preference is part of the identity: Chromium wants webm/opus, Safari wants m4a.
  const key = cacheKey(url) + (prefer && prefer[0] && ALLOWED_EXTS.includes(prefer[0]) ? `-${prefer[0]}` : '');
  try {
    const { entry, cached } = await resolveDeduped(url, key, force, prefer);
    console.log(`  resolve ${key} ${cached ? '(cache)' : '(yt-dlp)'} "${entry.title}" ${entry.ext} ${entry.abr || '?'}kbps`);
    res.json(publicEntry(entry, cached));
  } catch (e) {
    const status = e.status || 500;
    console.error(`  resolve ${key} failed [${status}]: ${e.message}${e.detail ? ' — ' + e.detail : ''}`);
    res.status(status).json({ error: e.message || 'Unknown error', detail: e.detail });
  }
});

/**
 * Proxy the upstream audio with Range passthrough. If upstream returns 403/410
 * (expired URL), re-resolve once and retry.
 */
async function proxyStream(req, res, entry, { retried = false } = {}) {
  const headers = { ...(entry.headers || {}) };
  delete headers['Accept-Encoding'];
  headers['Accept-Encoding'] = 'identity';
  if (req.headers.range) headers['Range'] = req.headers.range;

  const controller = new AbortController();
  const onClose = () => controller.abort();
  req.on('close', onClose);

  let upstream;
  try {
    upstream = await fetch(entry.upstream, { headers, signal: controller.signal, redirect: 'follow' });
  } catch (e) {
    req.off('close', onClose);
    if (controller.signal.aborted) return;
    return res.status(502).json({ error: 'Windows Media Player cannot connect to the media server.', detail: String(e.message || e) });
  }

  if ((upstream.status === 403 || upstream.status === 410 || upstream.status === 404) && !retried) {
    req.off('close', onClose);
    try { upstream.body?.cancel(); } catch { /* ignore */ }
    console.warn(`  stream ${entry.key}: upstream ${upstream.status}, re-resolving`);
    await dropCache(entry.key);
    try {
      const { entry: fresh } = await resolveDeduped(entry.sourceUrl, entry.key, true, entry.prefer);
      return proxyStream(req, res, fresh, { retried: true });
    } catch (e) {
      return res.status(e.status || 502).json({ error: e.message || 'The stream address has expired and could not be renewed.' });
    }
  }

  if (!upstream.ok && upstream.status !== 206) {
    req.off('close', onClose);
    try { upstream.body?.cancel(); } catch { /* ignore */ }
    return res.status(upstream.status === 416 ? 416 : 502).json({
      error: upstream.status === 416
        ? 'The requested range is not satisfiable.'
        : `The media server returned HTTP ${upstream.status}.`,
    });
  }

  res.status(upstream.status);
  const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];
  for (const h of passthrough) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  if (!upstream.headers.get('content-type') || /octet-stream/.test(upstream.headers.get('content-type'))) {
    res.setHeader('Content-Type', entry.mime);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Track-Title', encodeURIComponent(entry.title));

  if (req.method === 'HEAD' || !upstream.body) {
    req.off('close', onClose);
    return res.end();
  }

  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.on('error', (e) => {
    if (!controller.signal.aborted) console.warn(`  stream ${entry.key}: upstream error ${e.message}`);
    res.destroy();
  });
  res.on('close', () => {
    req.off('close', onClose);
    controller.abort();
    nodeStream.destroy();
  });
  nodeStream.pipe(res);
}

app.get('/api/stream/:key', async (req, res) => {
  const key = req.params.key;
  let entry = await readCache(key);
  if (!entry) {
    // Expired or missing: we can re-resolve only if we still know the source URL.
    try {
      const raw = await readFile(cachePath(key), 'utf8');
      const stale = JSON.parse(raw);
      const { entry: fresh } = await resolveDeduped(stale.sourceUrl, key, true, stale.prefer);
      entry = fresh;
    } catch (e) {
      return res.status(e.status || 410).json({ error: e.message || 'The stream address has expired. Please open the URL again.' });
    }
  }
  proxyStream(req, res, entry);
});
app.head('/api/stream/:key', async (req, res) => {
  const entry = await readCache(req.params.key);
  if (!entry) return res.sendStatus(410);
  proxyStream(req, res, entry);
});

/** Generic CORS proxy for direct audio URLs whose hosts don't send CORS headers. */
app.get('/api/proxy', async (req, res) => {
  const target = typeof req.query.url === 'string' ? req.query.url : '';
  let u;
  try {
    u = new URL(target);
    if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
  } catch {
    return res.status(400).json({ error: 'The address is not a valid http(s) URL.' });
  }
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 5.1) WindowsMediaPlayer/9.0', 'Accept-Encoding': 'identity' };
  if (req.headers.range) headers['Range'] = req.headers.range;
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  let upstream;
  try {
    upstream = await fetch(u, { headers, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) return;
    return res.status(502).json({ error: 'Windows Media Player cannot connect to the server.', detail: String(e.message || e) });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return res.status(502).json({ error: `The server returned HTTP ${upstream.status}.` });
  }
  res.status(upstream.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  if (!upstream.body) return res.end();
  const s = Readable.fromWeb(upstream.body);
  res.on('close', () => { controller.abort(); s.destroy(); });
  s.on('error', () => res.destroy());
  s.pipe(res);
});

// Serve the built frontend in production (after `npm run build`).
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));

app.listen(PORT, () => {
  console.log(`  API listening on http://localhost:${PORT}  (cache: ${CACHE_DIR}, ttl ${Math.round(CACHE_TTL_MS / 60000)} min)\n`);
});
