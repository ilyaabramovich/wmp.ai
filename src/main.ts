import './styles/xp.css';
import './styles/wmp.css';

import { AudioEngine } from './audio/engine';
import { Track, trackFromFile, trackFromDirectUrl, resolveYouTube, isYouTubeUrl, SourceError } from './audio/sources';
import { VisualizerHost } from './visualizers/host';
import { presets, presetsByCategory, findPreset, RANDOM_ID } from './visualizers/index';
import { makeWindow, placeInitial } from './ui/window';
import { MenuBar, MenuItem, showContextMenu, showDropdown, closeAllMenus } from './ui/menu';
import { messageBox, openUrlDialog, progressDialog, aboutDialog, pushUrlHistory, showDialog } from './ui/dialog';
import { Player } from './ui/player';
import { makeTaskbar } from './ui/taskbar';
import { openNotepad, NotepadHandle } from './ui/notepad';
import promptText from '../PROMPT.md?raw';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
interface Settings {
  preset: string;
  random: boolean;
  crt: boolean;
  taskbar: boolean;
  playlist: boolean;
  volume: number;
  featureBar: boolean;
}
const SETTINGS_KEY = 'wmp.settings';
const settings: Settings = Object.assign(
  { preset: presets[0].id, random: false, crt: false, taskbar: true, playlist: true, volume: 0.8, featureBar: true },
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } })(),
);
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

// ---------------------------------------------------------------------------
// Core objects
// ---------------------------------------------------------------------------
const engine = new AudioEngine();
engine.volume = settings.volume;
const player = new Player(engine);
const vizCanvas = $<HTMLCanvasElement>('viz');
const vizPane = $('viz-pane');
const host = new VisualizerHost(vizCanvas, engine, $('viz-overlay'));
const desktop = $('desktop');
const windowEl = $('window');

placeInitial(windowEl, desktop);

const win = makeWindow(windowEl, {
  titlebar: $('titlebar'),
  desktop,
  onResize: () => layoutChanged(),
});

const taskbar = makeTaskbar({
  onStartItem: (id) => {
    if (id === 'wmp') reopenWindow();
    else if (id === 'open-file') fileInput.click();
    else if (id === 'open-url') openUrlFlow();
    else if (id === 'about') aboutDialog();
    else if (id === 'options') optionsDialog();
    else if (id === 'notepad') openPromptFile();
    else if (id === 'readme') messageBox('All Programs', 'Windows Media Player and Notepad are installed on this computer.', 'info');
  },
});
taskbar.onWindowButtonClick = () => {
  if (win.isMinimized()) win.restore();
  else win.minimize();
};
win.onStateChange = (s) => {
  taskbar.setWindowButton(titleFor(player.current), s !== 'minimized', true);
  if (s !== 'minimized') { win.setActive(true); layoutChanged(); }
};

function titleFor(t: Track | null) {
  return t ? `${t.title} - Windows Media Player` : 'Windows Media Player';
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function layoutChanged() {
  windowEl.classList.toggle('narrow', windowEl.offsetWidth < 700);
  host.fitTo(vizPane);
}
new ResizeObserver(() => host.fitTo(vizPane)).observe(vizPane);
layoutChanged();

// ---------------------------------------------------------------------------
// Visualizer plumbing
// ---------------------------------------------------------------------------
const vizName = $('viz-name');
host.onPresetChange = (id, random) => {
  const p = findPreset(id);
  vizName.textContent = p ? `${p.category}: ${p.name}${random ? '  (Random)' : ''}` : '';
  settings.preset = id;
  settings.random = random;
  saveSettings();
};
host.setPreset(settings.preset, false);
if (settings.random) host.setRandom(true);
host.start();

function visualizationMenu(): MenuItem[] {
  const items: MenuItem[] = [];
  for (const [cat, list] of presetsByCategory()) {
    items.push({
      label: cat,
      submenu: list.map((p) => ({
        label: p.name,
        radio: true,
        checked: () => !host.random && host.currentId === p.id,
        action: () => { host.random = false; host.setPreset(p.id); },
      })),
    });
  }
  items.push({ separator: true });
  items.push({ label: 'Random', radio: true, checked: () => host.random, action: () => host.setRandom(!host.random) });
  items.push({ separator: true });
  items.push({ label: 'Next Visualization', shortcut: 'Ctrl+Right', action: () => host.next(1) });
  items.push({ label: 'Previous Visualization', shortcut: 'Ctrl+Left', action: () => host.next(-1) });
  return items;
}

$('viz-prev').addEventListener('click', () => host.next(-1));
$('viz-next').addEventListener('click', () => host.next(1));
$('viz-select').addEventListener('click', (e) => showDropdown(e.currentTarget as HTMLElement, visualizationMenu));
$('viz-fullscreen').addEventListener('click', toggleFullScreen);
$('btn-np-options').addEventListener('click', (e) => showDropdown(e.currentTarget as HTMLElement, () => [
  { label: 'Visualizations', submenu: visualizationMenu() },
  { label: 'Show Playlist', checked: () => settings.playlist, action: togglePlaylist },
  { separator: true },
  { label: 'CRT Scanlines', checked: () => settings.crt, action: toggleCrt },
  { separator: true },
  { label: 'Full Screen', shortcut: 'Alt+Enter', action: toggleFullScreen },
]));
$('btn-pl-options').addEventListener('click', (e) => showDropdown(e.currentTarget as HTMLElement, () => [
  { label: 'Open...', shortcut: 'Ctrl+O', action: () => fileInput.click() },
  { label: 'Open URL...', shortcut: 'Ctrl+U', action: openUrlFlow },
  { separator: true },
  { label: 'Remove Selected', disabled: () => !selectedPlaylistIndex(), action: () => { const i = selectedPlaylistIndex(); if (i != null) player.remove(i); } },
  { label: 'Clear List', disabled: () => player.tracks.length === 0, action: () => player.clear() },
]));

function selectedPlaylistIndex(): number | null {
  const sel = document.querySelector<HTMLElement>('.wmp-pl-item.selected');
  return sel ? Number(sel.dataset.index) : null;
}

function toggleFullScreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else vizPane.requestFullscreen?.().catch(() => player.flashStatus('Full screen is not available.'));
}
document.addEventListener('fullscreenchange', () => host.fitTo(vizPane));

function toggleCrt() {
  settings.crt = !settings.crt;
  $('crt').hidden = !settings.crt;
  saveSettings();
}
$('crt').hidden = !settings.crt;

function toggleTaskbar() {
  settings.taskbar = !settings.taskbar;
  taskbar.setVisible(settings.taskbar);
  saveSettings();
  layoutChanged();
}
taskbar.setVisible(settings.taskbar);

function togglePlaylist() {
  settings.playlist = !settings.playlist;
  $('playlist').classList.toggle('hidden-pane', !settings.playlist);
  saveSettings();
  layoutChanged();
}
$('playlist').classList.toggle('hidden-pane', !settings.playlist);

function toggleFeatureBar() {
  settings.featureBar = !settings.featureBar;
  $('wmp-taskbar').hidden = !settings.featureBar;
  saveSettings();
  layoutChanged();
}
$('wmp-taskbar').hidden = !settings.featureBar;

// Context menu on the visualizer pane
vizPane.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, [
    { label: player.state === 'playing' ? 'Pause' : 'Play', shortcut: 'Ctrl+P', disabled: () => !player.tracks.length, action: () => player.togglePlay() },
    { label: 'Stop', shortcut: 'Ctrl+S', disabled: () => player.state === 'stopped', action: () => player.stop() },
    { separator: true },
    { label: 'Visualizations', submenu: visualizationMenu() },
    { label: 'Full Screen', shortcut: 'Alt+Enter', action: toggleFullScreen },
    { separator: true },
    { label: 'Open URL...', shortcut: 'Ctrl+U', action: openUrlFlow },
    { label: 'Open...', shortcut: 'Ctrl+O', action: () => fileInput.click() },
  ]);
});
// XP-style context menu elsewhere in the window body
windowEl.addEventListener('contextmenu', (e) => {
  if ((e.target as HTMLElement).closest('#viz-pane, input, textarea')) return;
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, [
    { label: 'Show Menu Bar', checked: true, disabled: true },
    { label: 'Show Playlist', checked: () => settings.playlist, action: togglePlaylist },
    { label: 'Show Feature Taskbar', checked: () => settings.featureBar, action: toggleFeatureBar },
    { separator: true },
    { label: 'About Windows Media Player', action: () => aboutDialog() },
  ]);
});
desktop.addEventListener('contextmenu', (e) => {
  if ((e.target as HTMLElement).closest('.xp-window')) return;
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, [
    { label: 'Arrange Icons By', submenu: [{ label: 'Name', radio: true, checked: true }, { label: 'Size' }, { label: 'Type' }, { label: 'Modified' }] },
    { label: 'Refresh', action: () => location.reload() },
    { separator: true },
    { label: 'Open Windows Media Player', action: reopenWindow },
    { label: 'Open PROMPT.md', action: openPromptFile },
    { separator: true },
    { label: 'Show Taskbar', checked: () => settings.taskbar, action: toggleTaskbar },
    { label: 'Properties', disabled: true },
  ]);
});

// ---------------------------------------------------------------------------
// Menu bar
// ---------------------------------------------------------------------------
const menubar = new MenuBar($('menubar'), [
  {
    label: '&File',
    items: () => [
      { label: '&Open...', shortcut: 'Ctrl+O', action: () => fileInput.click() },
      { label: 'Open &URL...', shortcut: 'Ctrl+U', action: openUrlFlow },
      { separator: true },
      { label: '&Save As...', disabled: true },
      { separator: true },
      { label: 'Add to Media &Library...', disabled: true },
      { label: 'CD &Audio', disabled: true },
      { separator: true },
      { label: 'Recent URLs', submenu: () => {
        const h = JSON.parse(localStorage.getItem('wmp.urlHistory') || '[]') as string[];
        return h.length ? h.map((u) => ({ label: u.length > 60 ? u.slice(0, 57) + '...' : u, action: () => openUrl(u) })) : [{ label: '(Empty)', disabled: true }];
      } },
      { separator: true },
      { label: '&Properties', disabled: () => !player.current, action: propertiesDialog },
      { separator: true },
      { label: 'E&xit', action: closeWindow },
    ],
  },
  {
    label: '&View',
    items: () => [
      { label: '&Full Mode', radio: true, checked: true },
      { label: '&Skin Mode', radio: true, disabled: true },
      { separator: true },
      { label: 'Full &Screen', shortcut: 'Alt+Enter', action: toggleFullScreen },
      { separator: true },
      { label: 'Now Playing &Tools', submenu: [
        { label: 'Show Playlist', checked: () => settings.playlist, action: togglePlaylist },
        { label: 'Show Feature Taskbar', checked: () => settings.featureBar, action: toggleFeatureBar },
        { label: 'Show Title', checked: true, disabled: true },
      ] },
      { label: '&Visualizations', submenu: visualizationMenu() },
      { separator: true },
      { label: 'CRT Scanlines / Vignette', checked: () => settings.crt, action: toggleCrt },
      { label: 'Windows Taskbar', checked: () => settings.taskbar, action: toggleTaskbar },
      { separator: true },
      { label: '&Refresh', shortcut: 'F5', action: () => location.reload() },
    ],
  },
  {
    label: '&Play',
    items: () => [
      { label: player.state === 'playing' || player.state === 'buffering' ? 'P&ause' : '&Play', shortcut: 'Ctrl+P', disabled: () => !player.tracks.length, action: () => player.togglePlay() },
      { label: '&Stop', shortcut: 'Ctrl+S', disabled: () => player.state === 'stopped', action: () => player.stop() },
      { separator: true },
      { label: 'P&revious', shortcut: 'Ctrl+B', disabled: () => !player.tracks.length, action: () => player.prev() },
      { label: '&Next', shortcut: 'Ctrl+F', disabled: () => !player.tracks.length, action: () => player.next() },
      { separator: true },
      { label: 'Rewind', shortcut: 'Ctrl+Shift+B', action: () => player.seekBy(-10) },
      { label: 'Fast Forward', shortcut: 'Ctrl+Shift+F', action: () => player.seekBy(10) },
      { separator: true },
      { label: 'Play Speed', submenu: [
        { label: 'Slow', radio: true, checked: () => engine.audio.playbackRate < 1, action: () => (engine.audio.playbackRate = 0.5) },
        { label: 'Normal', radio: true, checked: () => engine.audio.playbackRate === 1, action: () => (engine.audio.playbackRate = 1) },
        { label: 'Fast', radio: true, checked: () => engine.audio.playbackRate > 1, action: () => (engine.audio.playbackRate = 1.4) },
      ] },
      { label: '&Volume', submenu: [
        { label: 'Up', shortcut: 'F10', action: () => player.setVolume(engine.volume + 0.1) },
        { label: 'Down', shortcut: 'F9', action: () => player.setVolume(engine.volume - 0.1) },
        { label: 'Mute', shortcut: 'F8', checked: () => engine.muted, action: () => player.toggleMute() },
      ] },
    ],
  },
  {
    label: '&Tools',
    items: () => [
      { label: '&Search for Media Files...', shortcut: 'F3', disabled: true },
      { label: 'Process Media Information Now', disabled: true },
      { separator: true },
      { label: 'Plug-ins', submenu: [{ label: 'Visualizations', submenu: visualizationMenu() }, { label: 'Options...', action: optionsDialog }] },
      { separator: true },
      { label: '&Options...', action: optionsDialog },
    ],
  },
  {
    label: '&Help',
    items: () => [
      { label: '&Help Topics', shortcut: 'F1', action: helpDialog },
      { separator: true },
      { label: 'Check for Player &Updates...', action: () => messageBox('Windows Media Player', 'There are no updates available at this time.', 'info') },
      { separator: true },
      { label: '&About Windows Media Player', action: () => aboutDialog() },
    ],
  },
]);

// ---------------------------------------------------------------------------
// Open flows
// ---------------------------------------------------------------------------
const fileInput = $<HTMLInputElement>('file-input');
fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  fileInput.value = '';
  if (files.length) addFiles(files);
});

function addFiles(files: File[]) {
  const audioFiles = files.filter((f) => /^(audio|video)\//.test(f.type) || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm|mp4)$/i.test(f.name));
  if (!audioFiles.length) {
    messageBox('Windows Media Player', 'Windows Media Player cannot play the file. The Player might not support the file type or might not support the codec that was used to compress the file.', 'error');
    return;
  }
  player.add(audioFiles.map(trackFromFile), { play: true });
}

let resolveAbort: AbortController | null = null;

async function openUrlFlow() {
  const url = await openUrlDialog(() => fileInput.click());
  if (!url) return;
  await openUrl(url);
}

async function openUrl(url: string) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url) && !/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(url) && !isYouTubeUrl('https://' + url)) {
    await messageBox('Windows Media Player', 'The address is not a valid URL. Please check the address and try again.', 'error');
    return;
  }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  await engine.ensureContext();

  if (isYouTubeUrl(url)) {
    resolveAbort?.abort();
    resolveAbort = new AbortController();
    const signal = resolveAbort.signal;
    player.setStatusSticky('Connecting to media...');
    const pd = progressDialog('Opening URL', `Connecting to ${new URL(url).hostname}...`, () => resolveAbort?.abort());
    try {
      pd.setText('Locating media... (yt-dlp)');
      const track = await resolveYouTube(url, { signal });
      pd.close();
      player.setStatusSticky(null);
      pushUrlHistory(url);
      player.add([track], { play: true });
      player.flashStatus(`Opened ${track.title}`, 2500);
    } catch (e: any) {
      pd.close();
      player.setStatusSticky(null);
      if (e?.name === 'AbortError') { player.flashStatus('Cancelled'); return; }
      const msg = e instanceof SourceError ? e.message : 'Windows Media Player cannot play the file. An unexpected error occurred.';
      const detail = e instanceof SourceError ? e.detail : String(e?.message || e);
      await messageBox('Windows Media Player', msg, 'error', detail);
    }
    return;
  }

  // Direct audio URL
  pushUrlHistory(url);
  const track = trackFromDirectUrl(url);
  player.add([track], { play: true });
}

// Drag & drop anywhere
let dragDepth = 0;
document.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files') && !e.dataTransfer?.types.includes('text/uri-list')) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging-file');
});
document.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('dragging-file');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging-file');
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length) { engine.ensureContext(); addFiles(files); return; }
  const uri = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
  if (uri && /^https?:\/\//i.test(uri.trim())) openUrl(uri.trim().split('\n')[0]);
});

// ---------------------------------------------------------------------------
// Errors & taint detection
// ---------------------------------------------------------------------------
player.onError = (message, detail) => {
  messageBox('Windows Media Player', message, 'error', detail);
};

engine.on('tainted', async () => {
  const t = player.current;
  if (!t) return;
  const isDirect = t.kind === 'url' && !t.src.startsWith('/api/proxy');
  const body = document.createElement('div');
  body.innerHTML = `
    <p>The audio is playing, but the visualizer is receiving <b>silence</b> from the analyser.</p>
    <p>This happens when the stream is served <b>without CORS headers</b>: the browser lets the &lt;audio&gt; element play it, but taints the Web Audio graph and returns zeroed sample data.</p>
    ${isDirect ? '<p>Windows Media Player can re-open this address through the local proxy server, which adds the required headers.</p>' : '<p>Try opening the file from your computer instead.</p>'}`;
  const r = await showDialog({
    title: 'Windows Media Player',
    body,
    icon: 'warning',
    width: 440,
    buttons: isDirect
      ? [{ label: 'Use Proxy', default: true }, { label: 'Ignore', cancel: true }]
      : [{ label: 'OK', default: true, cancel: true }],
  }).result;
  if (r === 'Use Proxy' && t.sourceUrl) {
    const proxied: Track = { ...t, src: `/api/proxy?url=${encodeURIComponent(t.sourceUrl)}` };
    const i = player.index;
    player.tracks[i] = proxied;
    player.playIndex(i);
  }
});

// Track info overlay: WMP shows it briefly on track change and whenever playback isn't running.
const vizInfo = $('viz-info');
let infoTimer = 0;
function showInfo(sticky: boolean) {
  vizInfo.classList.add('show');
  clearTimeout(infoTimer);
  if (!sticky) infoTimer = window.setTimeout(() => { if (player.state === 'playing') vizInfo.classList.remove('show'); }, 5000);
}
showInfo(true);
player.onTrackChange = (t) => {
  taskbar.setWindowButton(titleFor(t), !win.isMinimized(), !windowClosed);
  showInfo(false);
};
player.onStateChange = (st) => {
  if (st === 'playing') showInfo(false);
  else showInfo(true);
};
vizPane.addEventListener('pointermove', () => showInfo(false));

// ---------------------------------------------------------------------------
// Window buttons / close / reopen
// ---------------------------------------------------------------------------
let windowClosed = false;
$('btn-min').addEventListener('click', () => win.minimize());
$('btn-max').addEventListener('click', () => win.toggleMaximize());
$('btn-close').addEventListener('click', closeWindow);

function closeWindow() {
  player.stop();
  windowClosed = true;
  windowEl.classList.add('minimized');
  taskbar.setWindowButton(titleFor(player.current), false, false);
  closeAllMenus();
}
function reopenWindow() {
  windowClosed = false;
  windowEl.classList.remove('minimized');
  if (win.isMinimized()) win.restore();
  taskbar.setWindowButton(titleFor(player.current), true, true);
  win.setActive(true);
  layoutChanged();
}
$('icon-wmp').addEventListener('dblclick', reopenWindow);
$('icon-wmp').addEventListener('click', () => { document.querySelectorAll('.desk-icon').forEach((e) => e.classList.remove('selected')); $('icon-wmp').classList.add('selected'); });
$('icon-recycle').addEventListener('click', () => { document.querySelectorAll('.desk-icon').forEach((e) => e.classList.remove('selected')); $('icon-recycle').classList.add('selected'); });
$('icon-recycle').addEventListener('dblclick', () => messageBox('Recycle Bin', 'The Recycle Bin is empty.', 'info'));

// PROMPT.md on the desktop opens in Notepad
let promptNotepad: NotepadHandle | null = null;
function openPromptFile() {
  if (promptNotepad && document.body.contains(promptNotepad.el)) { promptNotepad.focus(); return; }
  promptNotepad = openNotepad({
    fileName: 'PROMPT.md',
    text: promptText,
    desktop,
    taskbar,
    onActivate: () => {
      win.setActive(false);
      taskbar.setWindowButton(titleFor(player.current), false, !windowClosed);
    },
  });
}
$('icon-prompt').addEventListener('click', () => { document.querySelectorAll('.desk-icon').forEach((e) => e.classList.remove('selected')); $('icon-prompt').classList.add('selected'); });
$('icon-prompt').addEventListener('dblclick', openPromptFile);
$('icon-prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter') openPromptFile(); });

// Active/inactive window feel
desktop.addEventListener('pointerdown', (e) => {
  const target = e.target as HTMLElement;
  const inWin = !!target.closest('.xp-window');
  win.setActive(!!target.closest('#window'));
  if (!inWin) promptNotepad?.deactivate();
  if (!inWin) document.querySelectorAll('.desk-icon').forEach((el) => { if (!(e.target as HTMLElement).closest('.desk-icon')) el.classList.remove('selected'); });
});
windowEl.addEventListener('pointerdown', () => {
  win.setActive(true);
  taskbar.setWindowButton(titleFor(player.current), true, !windowClosed);
  promptNotepad?.deactivate();
});

// WMP feature tabs
document.querySelectorAll<HTMLButtonElement>('.wmp-tab').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.tab === 'nowplaying') return;
    player.flashStatus(`${b.textContent} is not available. Connect to the Internet to use this feature.`, 3500);
  });
});

// ---------------------------------------------------------------------------
// Dialogs: options, properties, help
// ---------------------------------------------------------------------------
function optionsDialog() {
  const body = document.createElement('div');
  body.innerHTML = `
    <p><b>Visualization settings</b></p>
    <label><input type="checkbox" id="opt-random"> Switch visualizations randomly every 30 seconds</label>
    <label><input type="checkbox" id="opt-crt"> CRT scanline / vignette overlay</label>
    <p style="margin-top:10px"><b>Player</b></p>
    <label><input type="checkbox" id="opt-taskbar"> Show Windows taskbar</label>
    <label><input type="checkbox" id="opt-playlist"> Show playlist pane</label>
    <label><input type="checkbox" id="opt-featurebar"> Show feature taskbar (Now Playing, Media Guide, …)</label>
    <p style="margin-top:10px;color:#444">Renderer: ${host.fps.toFixed(0)} fps, quality ${(host.quality * 100).toFixed(0)}%, ${vizCanvas.width}×${vizCanvas.height} internal, audio ${engine.contextState}</p>`;
  const get = (id: string) => body.querySelector<HTMLInputElement>('#' + id)!;
  get('opt-random').checked = settings.random;
  get('opt-crt').checked = settings.crt;
  get('opt-taskbar').checked = settings.taskbar;
  get('opt-playlist').checked = settings.playlist;
  get('opt-featurebar').checked = settings.featureBar;
  showDialog({
    title: 'Options',
    body,
    width: 420,
    buttons: [
      { label: 'OK', default: true, onClick: () => {
        if (get('opt-random').checked !== host.random) host.setRandom(get('opt-random').checked);
        if (get('opt-crt').checked !== settings.crt) toggleCrt();
        if (get('opt-taskbar').checked !== settings.taskbar) toggleTaskbar();
        if (get('opt-playlist').checked !== settings.playlist) togglePlaylist();
        if (get('opt-featurebar').checked !== settings.featureBar) toggleFeatureBar();
      } },
      { label: 'Cancel', cancel: true },
    ],
  });
}

function propertiesDialog() {
  const t = player.current;
  if (!t) return;
  const body = document.createElement('div');
  const rows: [string, string][] = [
    ['Title', t.title],
    ['Artist', t.artist],
    ['Source', t.kind === 'file' ? 'Local file' : t.kind === 'youtube' ? 'YouTube (via yt-dlp)' : 'Internet URL'],
    ['Location', t.sourceUrl || t.src],
    ['Duration', isFinite(engine.audio.duration) ? `${Math.round(engine.audio.duration)} s` : 'Unknown'],
    ['Bit rate', t.bitrate ? `${t.bitrate} Kbps` : 'Unknown'],
    ['Type', t.mime || 'Unknown'],
  ];
  body.innerHTML = `<table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#444;white-space:nowrap">${k}:</td><td style="padding:2px 0;word-break:break-all">${escapeHtml(v)}</td></tr>`).join('')}</table>`;
  showDialog({ title: 'Properties', body, width: 440 });
}

function helpDialog() {
  const body = document.createElement('div');
  body.innerHTML = `
    <p><b>Keyboard shortcuts</b></p>
    <table style="border-collapse:collapse;line-height:16px">
      <tr><td style="padding-right:14px">Ctrl+O</td><td>Open a local file</td></tr>
      <tr><td>Ctrl+U</td><td>Open URL…</td></tr>
      <tr><td>Ctrl+P / Space</td><td>Play / Pause</td></tr>
      <tr><td>Ctrl+S</td><td>Stop</td></tr>
      <tr><td>Ctrl+B / Ctrl+F</td><td>Previous / Next track</td></tr>
      <tr><td>← / →</td><td>Seek 5 seconds</td></tr>
      <tr><td>Ctrl+← / Ctrl+→</td><td>Previous / Next visualization</td></tr>
      <tr><td>F8 / F9 / F10</td><td>Mute / Volume down / Volume up</td></tr>
      <tr><td>Alt+Enter</td><td>Full screen</td></tr>
    </table>
    <p style="margin-top:10px">Drag an audio file anywhere onto the player to play it.</p>`;
  showDialog({ title: 'Windows Media Player Help', body, width: 420 });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.matches('input, textarea')) return;
  if (document.body.classList.contains('modal')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (ctrl && !e.shiftKey && k.toLowerCase() === 'o') { e.preventDefault(); fileInput.click(); }
  else if (ctrl && k.toLowerCase() === 'u') { e.preventDefault(); openUrlFlow(); }
  else if (ctrl && k.toLowerCase() === 'p') { e.preventDefault(); player.togglePlay(); }
  else if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); player.stop(); }
  else if (ctrl && e.shiftKey && k.toLowerCase() === 'b') { e.preventDefault(); player.seekBy(-10); }
  else if (ctrl && e.shiftKey && k.toLowerCase() === 'f') { e.preventDefault(); player.seekBy(10); }
  else if (ctrl && k.toLowerCase() === 'b') { e.preventDefault(); player.prev(); }
  else if (ctrl && k.toLowerCase() === 'f') { e.preventDefault(); player.next(); }
  else if (ctrl && k === 'ArrowRight') { e.preventDefault(); host.next(1); }
  else if (ctrl && k === 'ArrowLeft') { e.preventDefault(); host.next(-1); }
  else if (k === ' ') { e.preventDefault(); player.togglePlay(); }
  else if (k === 'ArrowRight') { e.preventDefault(); player.seekBy(5); }
  else if (k === 'ArrowLeft') { e.preventDefault(); player.seekBy(-5); }
  else if (k === 'F8') { e.preventDefault(); player.toggleMute(); }
  else if (k === 'F9') { e.preventDefault(); player.setVolume(engine.volume - 0.1); }
  else if (k === 'F10') { e.preventDefault(); player.setVolume(engine.volume + 0.1); }
  else if (k === 'F1') { e.preventDefault(); helpDialog(); }
  else if (e.altKey && k === 'Enter') { e.preventDefault(); toggleFullScreen(); }
  else if (e.altKey && /^[a-z]$/i.test(k)) { if (menubar.openByAccel(k)) e.preventDefault(); }
});

// Persist volume
engine.audio.addEventListener('volumechange', () => { settings.volume = engine.volume; saveSettings(); });

// Resume AudioContext on first gesture anywhere (autoplay policy)
const resumeOnce = () => { engine.ensureContext(); };
document.addEventListener('pointerdown', resumeOnce, { once: true, capture: true });
document.addEventListener('keydown', resumeOnce, { once: true, capture: true });

// Random-mode + preset id from URL hash for quick demoing: #preset=bars-fire-storm
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('preset')) host.setPreset(hash.get('preset')!, false);
if (hash.get('random') === '1') host.setRandom(true);
if (hash.get('preset') === RANDOM_ID) host.setRandom(true);

// Debug handle (used by the test harness and handy in DevTools)
(window as any).__wmp = { engine, host, player, settings };

// Server health → status bar hint when yt-dlp is missing
fetch('/api/health').then((r) => r.json()).then((h) => {
  if (!h.ytdlp) player.flashStatus('yt-dlp not found on server — YouTube URLs disabled (local files still work)', 8000);
}).catch(() => {
  player.flashStatus('API server not reachable — run `npm run dev` for YouTube support', 8000);
});
