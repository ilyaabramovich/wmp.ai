# Windows Media Player XP Visualizer

A web re-creation of Windows Media Player 9 on Windows XP that plays a song from a
**local file**, a **YouTube link**, or a **direct audio URL**, and renders WMP-era
visualizations (Bars and Waves, Ambience, Battery) that react to the live audio via the
Web Audio API. Vanilla TypeScript + Vite on the front end, a small Node/Express server
that drives `yt-dlp` on the back end. No UI framework, no visualization libraries: the CSS
and the canvas render loops are hand-written.

## Prerequisites

| Tool | Why | Install |
| --- | --- | --- |
| Node.js 20+ | runs Vite and the API server | https://nodejs.org |
| yt-dlp | extracts the audio-only stream for YouTube URLs | `brew install yt-dlp` or `pip install -U yt-dlp` |
| ffmpeg (optional) | yt-dlp may need it for some formats; not required for streaming | `brew install ffmpeg` |

The server checks for `yt-dlp` on startup and prints a clear message if it is missing.
Local files and direct URLs still work without it. Point at a non-PATH binary with
`YTDLP_PATH=/path/to/yt-dlp`.

## Run

```bash
npm install
npm run dev
```

`npm run dev` starts both the API server (port 3001) and Vite (port 5173, proxying
`/api` to the server). Open http://localhost:5173.

Production build:

```bash
npm run build      # typecheck + bundle to dist/
npm start          # serves dist/ and the API on port 3001
```

## Using it

- **Local file**: drag an audio file anywhere onto the player, or File → Open… (Ctrl+O).
- **YouTube**: File → Open URL… (Ctrl+U), paste a `youtube.com` / `youtu.be` link, OK.
  A progress dialog shows while the server resolves the stream. Title, uploader, duration,
  thumbnail and bitrate appear in the Now Playing pane and status bar.
- **Direct URL**: paste an `.mp3` / `.ogg` / `.wav` / `.m4a` address into Open URL….
- **Visualizations**: View → Visualizations → category → preset, the right-click menu on the
  visualizer, the ✱ button under it, or Ctrl+←/→. **Random** cross-fades to a new preset
  every 30 seconds.
- **Full screen**: Alt+Enter or View → Full Screen. F1 lists all shortcuts.
- Optional toggles under View: CRT scanline/vignette overlay, Windows taskbar, playlist pane.

## How the audio pipeline works

Real-time visualization needs raw sample access (`createMediaElementSource` →
`AnalyserNode`). The YouTube IFrame API never exposes that, and cross-origin audio
without CORS headers makes the analyser return zeros. So:

1. `POST /api/resolve { url, prefer }` runs `yt-dlp --dump-single-json -f bestaudio[ext=…]`
   and returns metadata plus a `streamUrl`. The `prefer` list comes from the browser's
   `canPlayType` results (Chromium open-source builds lack AAC, Safari lacks WebM/Opus).
2. `GET /api/stream/:key` proxies the upstream googlevideo URL with the browser's `Range`
   header forwarded, so the `<audio>` element gets `206 Partial Content` and can seek.
   Permissive CORS headers are added so the Web Audio graph is not tainted. If upstream
   returns 403/410 (expired URL) the server re-resolves once and retries transparently.
3. Resolved entries are cached on disk in `server/cache/<videoId>-<ext>.json` for
   `CACHE_TTL_MS` (default 4 h; extracted URLs expire in roughly 6 h).
4. `GET /api/proxy?url=` is a generic CORS proxy for direct audio URLs whose hosts do not
   send CORS headers. The client offers it automatically when it detects a tainted stream.

On the client, `src/audio/engine.ts` owns the `<audio>` element, resumes the
`AudioContext` on the first user gesture (autoplay policy), and produces one shared
`AudioFrame` per animation frame: FFT magnitudes (1024-point, smoothing 0.8), the
time-domain waveform, RMS, a fast-attack/slow-release energy envelope, bass/mid/treble
bands, and a beat onset detector with a decaying `beatIntensity`. Every visualizer consumes
that same object.

### Failure handling

Failures surface as XP message boxes with real messages, never a dead canvas:
unavailable, private, age-gated, region-locked or members-only videos, rate limiting,
live streams, yt-dlp missing, server unreachable, expired stream URL, media decode errors.
If audio is audibly playing but the analyser has been flat for 1.5 s, the player says the
stream is CORS-tainted and, for direct URLs, offers to reopen it through the proxy.

## Input-mode limitations

- **YouTube**: needs the local server and `yt-dlp`. Live streams and premieres are not
  supported. YouTube occasionally rate-limits or requires sign-in; the error dialog will say
  so. Extracted URLs expire, so a cached entry older than the TTL is re-resolved.
- **Direct URLs**: the host must send `Access-Control-Allow-Origin` for the analyser to see
  data; otherwise use the offered proxy. Hosts that do not support `Range` cannot seek.
- **Local files**: anything the browser can decode (MP3, AAC/M4A, OGG/Opus, WAV, FLAC,
  WebM). Files are never uploaded; they play from an object URL in the page.

## Deploying (Vercel)

The repo deploys to Vercel as a static Vite site plus the serverless functions in `api/`
(`vercel.json` pins the framework and `dist` output). Those functions replace
`server/index.js` on the host:

| Route | Hosted (Vercel) | Local (`npm run dev`) |
| --- | --- | --- |
| `/api/health` | reports `capabilities.youtube: false` | reports yt-dlp version |
| `/api/proxy?url=` | streaming CORS proxy with Range | same |
| `/api/resolve` | 501 with an explanatory message | yt-dlp extraction |
| `/api/stream/:key` | not available | Range-aware proxy of the extracted stream |

So a hosted copy plays **local files and direct audio URLs**; **YouTube links only work
locally**, because yt-dlp needs a subprocess (and YouTube blocks most datacenter IPs). The
app detects this from `/api/health` and says so in the status bar and the Open URL dialog.

## Terms of service caveat

Extracting audio from YouTube with `yt-dlp` may violate YouTube's Terms of Service. This
project is intended for **local, personal use** on your own machine. Do not deploy the
server publicly or use it to redistribute content.

## Project structure

```
server/index.js          Express API: /api/resolve, /api/stream/:key, /api/proxy, /api/health
api/*.js                 Vercel serverless stand-ins (health, proxy, resolve → 501)
vercel.json              Vercel build settings
src/audio/frame.ts       AudioFrame type shared by all visualizers
src/audio/engine.ts      AudioContext graph, analyser, energy/beat envelope, taint detection
src/audio/sources.ts     Track model, local-file / direct-URL / YouTube (via server) loaders
src/visualizers/types.ts Visualizer interface + helpers (log bands, peak caps, trail fade)
src/visualizers/*.ts     One module per preset
src/visualizers/index.ts Registry that menus are built from
src/visualizers/host.ts  Render loop, low-res offscreen canvases, cross-fade, Random mode,
                         frame-budget governor
src/ui/window.ts         Drag / resize / minimize / maximize
src/ui/menu.ts           Menu bar, dropdowns, submenus, context menus
src/ui/dialog.ts         XP dialogs: message box, Open URL, progress, About
src/ui/player.ts         Transport, seek bar, volume, playlist, status bar
src/ui/taskbar.ts        Start button + menu, window button, tray clock
src/ui/…  src/styles/    Luna theme (xp.css) and WMP 9 skin (wmp.css)
src/main.ts              Wiring, menus, shortcuts, drag & drop, settings persistence
scripts/e2e.mjs          Playwright smoke test (local file → presets → YouTube → seek → errors)
```

## Adding a visualizer

1. Create `src/visualizers/myPreset.ts` exporting a class that implements `Visualizer`
   from `./types`:

   ```ts
   import type { AudioFrame } from '../audio/frame';
   import { Visualizer, fade, hsl } from './types';

   export class MyPreset implements Visualizer {
     id = 'ambience-my-preset';       // stable id used in menus/settings
     category = 'Ambience';           // WMP category (new categories are fine)
     name = 'My Preset';

     init(ctx: CanvasRenderingContext2D, w: number, h: number) {
       ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);   // called on activate/resize
     }

     render(ctx: CanvasRenderingContext2D, f: AudioFrame, w: number, h: number) {
       fade(ctx, w, h, 0.2);                 // trail instead of clearing
       ctx.globalCompositeOperation = 'lighter';
       // use f.fftNorm, f.wave, f.energy, f.bass, f.beat, f.beatIntensity, f.dt, f.quality…
     }
   }
   ```

2. Add `new MyPreset()` to the `presets` array in `src/visualizers/index.ts`. The View →
   Visualizations menu, the context menu, Random mode and Ctrl+←/→ pick it up automatically.

Rendering notes: the host gives each preset its own offscreen canvas at roughly 320×240
(width follows the pane's aspect ratio, 240–480 px) which is upscaled with
`image-rendering: pixelated`. Respect `f.quality` (1 → 0.35) by reducing particle counts;
the host lowers it when the frame budget slips and raises it back when frames are fast.

## Testing

`scripts/e2e.mjs` drives the app in headless Chrome: loads a local MP3, verifies the
analyser produces non-zero data, cycles every preset while sampling fps, opens a YouTube URL
through the Open URL dialog, seeks mid-track, triggers an error dialog and exercises
maximize/random. It needs Playwright and a running `npm run dev`:

```bash
npm i -g playwright && npx playwright install chrome
TEST_MP3=/path/to/song.mp3 node scripts/e2e.mjs
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 3001 | API server port |
| `CACHE_TTL_MS` | 14400000 (4 h) | how long a resolved stream URL is trusted |
| `YTDLP_PATH` | `yt-dlp` | path to the yt-dlp binary |
