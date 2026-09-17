// End-to-end smoke test. Requires `npm run dev` to be running and Playwright:
//   npm i -g playwright && npx playwright install chrome   (or set CHANNEL=chromium)
// Usage: TEST_MP3=path/to/song.mp3 node scripts/e2e.mjs
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const SHOT = process.env.SHOT_DIR || '/tmp/wmp-test';
const YT = process.env.YT_URL || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const log = (...a) => console.log('[e2e]', ...a);

const browser = await chromium.launch({
  channel: process.env.CHANNEL || 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE);
await page.waitForSelector('#viz');
await page.screenshot({ path: `${SHOT}/01-desktop.png` });
log('loaded');

// user gesture to unlock audio context
await page.mouse.click(640, 400);
const rafHz = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); }));
log('raw rAF rate in this headless browser:', rafHz, 'Hz');

// ---- local file
await page.setInputFiles('#file-input', process.env.TEST_MP3 || `${SHOT}/test.mp3`);
await page.waitForTimeout(2500);
let s = await page.evaluate(() => {
  const w = window.__wmp; const f = w.engine.frame;
  return { state: w.player.state, live: f.live, rms: f.rms, energy: f.energy, bass: f.bass, fps: w.host.fps, ctx: w.engine.contextState, cur: w.engine.audio.currentTime, status: document.getElementById('status-text').textContent, time: document.getElementById('status-time').textContent };
});
log('local file:', s);
await page.screenshot({ path: `${SHOT}/02-local-ocean.png` });
if (!s.live || s.rms <= 0) { console.error('FAIL: analyser not live on local file'); }

// ---- cycle presets via the View → Visualizations menu
const presets = ['bars-fire-storm', 'ambience-swirling-cyclone', 'battery-rainbow-ribbons', 'bars-ocean-mist'];
for (const id of presets) {
  await page.evaluate((id) => window.__wmp.host.setPreset(id), id);
  await page.waitForTimeout(1600);
  const fps = await page.evaluate(() => window.__wmp.host.fps);
  log('preset', id, 'fps', fps.toFixed(1));
  await page.screenshot({ path: `${SHOT}/03-${id}.png` });
}

// open View menu and Visualizations submenu for a screenshot
await page.click('.xp-menu-top:nth-child(2)');
await page.waitForTimeout(200);
await page.hover('.xp-popup .xp-mi:has-text("Visualizations")');
await page.waitForTimeout(400);
await page.hover('.xp-popup[data-depth="1"] .xp-mi:has-text("Bars and Waves")');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOT}/04-menu.png` });
await page.keyboard.press('Escape');

// ---- YouTube via Open URL dialog
await page.keyboard.press('Control+U');
await page.waitForSelector('#openurl-input');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOT}/05-openurl.png` });
await page.fill('#openurl-input', YT);
await page.keyboard.press('Enter');
log('resolving youtube…');
await page.waitForTimeout(250);
await page.screenshot({ path: `${SHOT}/05b-progress.png` });
const t0 = Date.now();
try {
  await page.waitForFunction(() => window.__wmp.player.current?.kind === 'youtube' && window.__wmp.player.state === 'playing' && window.__wmp.engine.audio.currentTime > 1, null, { timeout: 60000 });
} catch (e) {
  const st = await page.evaluate(() => ({ state: window.__wmp.player.state, err: window.__wmp.engine.audio.error && window.__wmp.engine.audio.error.code, dlg: document.querySelector('.xp-dialog-text')?.textContent }));
  console.error('FAIL: youtube did not reach playing:', st);
  await page.screenshot({ path: `${SHOT}/06-youtube-fail.png` });
}
await page.waitForTimeout(2500);
s = await page.evaluate(() => {
  const w = window.__wmp; const f = w.engine.frame;
  return { state: w.player.state, live: f.live, rms: f.rms, cur: w.engine.audio.currentTime, dur: w.engine.audio.duration, title: document.getElementById('np-title').textContent, bitrate: document.getElementById('status-bitrate').textContent, time: document.getElementById('status-time').textContent };
});
log(`youtube after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, s);
await page.screenshot({ path: `${SHOT}/06-youtube.png` });

// ---- seek mid-track
await page.evaluate(() => { window.__wmp.engine.audio.currentTime = 120; });
const ts = Date.now();
try {
  await page.waitForFunction(() => window.__wmp.engine.audio.currentTime > 121 && window.__wmp.player.state === 'playing', null, { timeout: 15000 });
  log(`seek resumed in ${Date.now() - ts}ms`);
} catch { console.error('FAIL: seek stalled', await page.evaluate(() => ({ cur: window.__wmp.engine.audio.currentTime, state: window.__wmp.player.state }))); }
s = await page.evaluate(() => ({ cur: window.__wmp.engine.audio.currentTime, live: window.__wmp.engine.frame.live, rms: window.__wmp.engine.frame.rms, time: document.getElementById('status-time').textContent }));
log('after seek:', s);

// ---- random mode + fullscreen-ish + context menu screenshot
await page.click('#viz', { button: 'right' });
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOT}/07-context.png` });
await page.keyboard.press('Escape');

// ---- error dialog: bad video
await page.keyboard.press('Control+U');
await page.waitForSelector('#openurl-input');
await page.fill('#openurl-input', 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
await page.keyboard.press('Enter');
await page.waitForSelector('.xp-dialog .xp-icon-error', { timeout: 30000 });
log('error dialog:', await page.evaluate(() => document.querySelector('.xp-dialog-text').textContent.trim()));
await page.screenshot({ path: `${SHOT}/08-error.png` });
await page.keyboard.press('Escape');

// ---- window ops
await page.click('#btn-max');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOT}/09-maximized.png` });
await page.click('#btn-max');
await page.evaluate(() => window.__wmp.host.setRandom(true));
await page.waitForTimeout(300);
log('viz label:', await page.textContent('#viz-name'));

log('errors:', errors.length ? errors : 'none');
await browser.close();
