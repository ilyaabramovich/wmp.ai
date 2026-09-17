# Windows XP Media Player Visualizer — Build Prompt

Build a web app that plays a song from a YouTube link (or a local file) and renders authentic Windows XP–era Windows Media Player visualizations reacting to the live audio, inside a UI that looks and feels like WMP 9 on Windows XP.

## Audio pipeline (solve this first — it gates everything else)

Real-time visualization requires raw sample access via the Web Audio API (`createMediaElementSource` → `AnalyserNode`). The YouTube IFrame Player API does NOT expose this, and cross-origin audio without CORS headers yields silent/zeroed analyser data. So YouTube requires a backend.

Support these inputs, in priority order:

1. **Local file upload** (drag & drop) — always works, build/verify this first so the visualizers are testable before the backend exists.
2. **YouTube URL** — a small Node backend endpoint (`POST /resolve`) that uses yt-dlp to extract the best audio-only format, then streams it back through the server with permissive CORS and HTTP Range support so seeking works. Return title, duration, uploader, and thumbnail for the Now Playing pane.
3. **Direct audio URL** (.mp3/.ogg/.wav) with `crossOrigin="anonymous"`.

Requirements:

- Handle the autoplay policy: resume AudioContext on first user gesture.
- Stream, don't fully download-then-play: start playback as soon as enough is buffered, and show an XP-style progress bar while resolving.
- Cache resolved streams on disk by video ID with a TTL (extracted URLs expire); serve repeat requests from cache.
- Surface failures (unavailable/age-gated/region-locked video, yt-dlp not installed, expired URL) as period-accurate error dialogs with real messages — never a dead canvas or a silent spinner.
- Detect zeroed analyser data (CORS-tainted stream) and say so explicitly.
- Document in the README that YouTube extraction may violate YouTube's ToS and this is intended for local/personal use.
- Expose FFT magnitudes, waveform, and a derived beat/energy envelope as a shared per-frame "audio frame" object all visualizers consume.

## Visualizations

Implement at least 4 presets on `<canvas>`, switchable via a "Visualizations" menu with WMP's category → preset submenu structure:

- **Bars and Waves — "Ocean Mist"** (frequency bars + mirrored waveform, blue)
- **Bars and Waves — "Fire Storm"** (red/orange spectrum, decaying peak caps)
- **Ambience — "Swirling Cyclone"** (rotating trailing particles, hue-cycling)
- **Battery — "Rainbow Ribbons"** (Lissajous/oscilloscope ribbons off waveform)

Add a "Random" mode that cross-fades presets every ~30s.

Fidelity details that sell the era:

- Render at a low internal resolution (~320×240) and upscale with `image-rendering: pixelated`.
- Additive blending + a per-frame alpha-fade trail instead of clearing.
- Peak-hold bar caps with gravity decay; smoothing constant ~0.8.
- Target 60fps via `requestAnimationFrame`; degrade particle counts if the frame budget slips.

## UI / nostalgia

- Windows XP Luna (blue) theme: gradient title bar with the 3 glossy buttons, 3D beveled button borders, Tahoma 11px (fallback Verdana), `#ECE9D8` dialog chrome, `#0054E3`→`#3A93FF` title gradient.
- WMP 9 silver-blue rounded player chrome: Now Playing pane, transport controls (play/pause/stop/prev/next), XP-groove seek bar, volume slider, Playlist sidebar, status bar showing elapsed/total time and bitrate.
- URL entry lives in a File → "Open URL…" modal dialog, exactly as WMP did it — not a modern hero input.
- Menu bar (File / View / Play / Tools / Help) with functioning Visualizations and Full Screen items; XP-style right-click context menu.
- Window is draggable, resizable, minimize/maximize; the app fills the viewport with an XP Bliss-style desktop wallpaper behind it.
- Optional toggles: CRT scanline/vignette overlay, and a taskbar with the glossy green Start button and a system-tray clock.
- Keep it tasteful-authentic, not parody — no jokes, no modern flat design leaking in.

## Tech & delivery

- **Frontend:** vanilla TypeScript + Vite, hand-written CSS (no component library — the CSS *is* the deliverable). No canvas/audio visualization libraries; write the render loops directly.
- **Backend:** Node + Express (or Hono), yt-dlp invoked as a subprocess, checked for on startup with a clear message if missing.
- **Structure:** `server/` (resolve + stream proxy), `src/audio/` (loading, analysis), `src/visualizers/` (one module per preset, sharing a common `render(ctx, frame)` interface), `src/ui/` (chrome).
- Single `npm run dev` starts both, with the Vite proxy pointed at the API.
- Include a README: prerequisites (yt-dlp, ffmpeg), how to run, input-mode limitations, ToS caveat, and how to add a new visualizer.

## Done when

I can paste a YouTube link into the Open URL dialog, hit play, and watch bars and particles move in time with the music inside a window I'd mistake for a 2003 screenshot — switching presets from the menu without dropping frames, and seeking mid-track without a stall.
