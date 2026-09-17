/**
 * XP dialogs: generic modal, MessageBox, Open URL, progress.
 */
import { closeAllMenus, showDropdown } from './menu';

export interface DialogButton {
  label: string;
  value?: string;
  default?: boolean;
  cancel?: boolean;
  disabled?: boolean;
  onClick?: (ctx: DialogHandle) => void | boolean; // return false to keep open
}

export interface DialogOptions {
  title: string;
  body: HTMLElement | string;
  buttons?: DialogButton[];
  icon?: 'error' | 'info' | 'warning' | null;
  width?: number;
  onClose?: (value: string | null) => void;
  /** Called after the dialog is in the DOM (focus inputs etc.) */
  onOpen?: (root: HTMLElement) => void;
}

export interface DialogHandle {
  el: HTMLElement;
  close(value?: string | null): void;
  setButtonEnabled(label: string, enabled: boolean): void;
  result: Promise<string | null>;
}

const dialogRoot = () => document.getElementById('dialog-root')!;
let openDialogs = 0;

export function showDialog(opts: DialogOptions): DialogHandle {
  closeAllMenus();
  const overlay = document.createElement('div');
  overlay.className = 'xp-dialog-overlay';
  const dlg = document.createElement('div');
  dlg.className = 'xp-dialog';
  if (opts.width) dlg.style.width = opts.width + 'px';

  const tb = document.createElement('div');
  tb.className = 'xp-titlebar';
  tb.innerHTML = `<img class="xp-titleicon" src="/wmp.svg" width="16" height="16" alt=""><span class="xp-title"></span><div class="xp-titlebuttons"><button class="xp-tb xp-tb-close" aria-label="Close"></button></div>`;
  tb.querySelector('.xp-title')!.textContent = opts.title;
  dlg.appendChild(tb);

  const body = document.createElement('div');
  body.className = 'xp-dialog-body';
  if (opts.icon) {
    const ic = document.createElement('div');
    ic.className = `xp-dialog-icon xp-icon-${opts.icon}`;
    body.appendChild(ic);
  }
  const text = document.createElement('div');
  text.className = 'xp-dialog-text';
  if (typeof opts.body === 'string') text.textContent = opts.body;
  else text.appendChild(opts.body);
  body.appendChild(text);
  dlg.appendChild(body);

  const buttons = opts.buttons || [{ label: 'OK', default: true, cancel: true }];
  const br = document.createElement('div');
  br.className = 'xp-dialog-buttons';
  if (opts.icon && buttons.length === 1) br.classList.add('center');
  const btnEls = new Map<string, HTMLButtonElement>();

  let resolved = false;
  let resolveFn: (v: string | null) => void = () => {};
  const result = new Promise<string | null>((r) => (resolveFn = r));

  const handle: DialogHandle = {
    el: dlg,
    result,
    close(value = null) {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      openDialogs--;
      if (openDialogs <= 0) document.body.classList.remove('modal');
      opts.onClose?.(value);
      resolveFn(value);
    },
    setButtonEnabled(label, enabled) {
      const b = btnEls.get(label);
      if (b) b.disabled = !enabled;
    },
  };

  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'xp-button' + (b.default ? ' default' : '');
    btn.textContent = b.label;
    btn.disabled = !!b.disabled;
    btn.addEventListener('click', () => {
      const r = b.onClick?.(handle);
      if (r === false) return;
      handle.close(b.value ?? b.label);
    });
    br.appendChild(btn);
    btnEls.set(b.label, btn);
  }
  dlg.appendChild(br);

  tb.querySelector('.xp-tb-close')!.addEventListener('click', () => handle.close(null));

  // make the dialog draggable
  let drag: { dx: number; dy: number } | null = null;
  tb.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = dlg.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    dlg.style.position = 'fixed';
    dlg.style.left = r.left + 'px';
    dlg.style.top = r.top + 'px';
    dlg.style.margin = '0';
    overlay.style.justifyContent = 'flex-start';
    overlay.style.alignItems = 'flex-start';
    tb.setPointerCapture(e.pointerId);
  });
  tb.addEventListener('pointermove', (e) => {
    if (!drag) return;
    dlg.style.left = e.clientX - drag.dx + 'px';
    dlg.style.top = e.clientY - drag.dy + 'px';
  });
  tb.addEventListener('pointerup', () => (drag = null));

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const cancel = buttons.find((b) => b.cancel);
      handle.close(cancel ? (cancel.value ?? null) : null);
      e.stopPropagation();
    } else if (e.key === 'Enter' && !(e.target as HTMLElement).matches('textarea')) {
      const def = buttons.find((b) => b.default);
      if (def) {
        const el = btnEls.get(def.label);
        if (el && !el.disabled) { el.click(); e.preventDefault(); e.stopPropagation(); }
      }
    }
  });
  // Clicking the overlay outside the dialog: flash title (XP did a "ding"); keep modal.
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) {
      dlg.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }], { duration: 120 });
    }
  });

  overlay.appendChild(dlg);
  dialogRoot().appendChild(overlay);
  openDialogs++;
  document.body.classList.add('modal');
  opts.onOpen?.(dlg);
  if (!opts.onOpen) {
    const def = buttons.find((b) => b.default) || buttons[0];
    btnEls.get(def?.label || '')?.focus();
  }
  return handle;
}

export function messageBox(title: string, message: string, icon: 'error' | 'info' | 'warning' = 'error', detail?: string): Promise<string | null> {
  const body = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = message;
  body.appendChild(p);
  if (detail) {
    const d = document.createElement('div');
    d.className = 'xp-dialog-detail';
    d.textContent = detail;
    body.appendChild(d);
  }
  return showDialog({ title, body, icon, width: 400 }).result;
}

const URL_HISTORY_KEY = 'wmp.urlHistory';
export function getUrlHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(URL_HISTORY_KEY) || '[]'); } catch { return []; }
}
export function pushUrlHistory(url: string) {
  const h = [url, ...getUrlHistory().filter((u) => u !== url)].slice(0, 10);
  localStorage.setItem(URL_HISTORY_KEY, JSON.stringify(h));
}

/** WMP's File → Open URL… dialog. Resolves with the URL or null. */
export function openUrlDialog(onBrowse?: () => void): Promise<string | null> {
  const body = document.createElement('div');
  body.innerHTML = `
    <p>Enter the URL or path to a media file on the Internet, your computer, or your network that you want to play.</p>
    <label for="openurl-input">Open:</label>
    <div class="xp-combo">
      <input id="openurl-input" class="xp-input" type="text" spellcheck="false" autocomplete="off" placeholder="https://www.youtube.com/watch?v=…" />
      <button class="xp-combo-btn" type="button" tabindex="-1" aria-label="History"></button>
    </div>
    <p style="margin-top:10px;color:#444">Supports YouTube links (resolved through the local server) and direct .mp3 / .ogg / .wav / .m4a addresses.</p>
  `;
  let value = '';
  const input = body.querySelector<HTMLInputElement>('#openurl-input')!;
  const histBtn = body.querySelector<HTMLButtonElement>('.xp-combo-btn')!;
  const handle = showDialog({
    title: 'Open URL',
    body,
    width: 420,
    buttons: [
      { label: 'OK', default: true, disabled: true, onClick: () => { value = input.value.trim(); return true; } },
      { label: 'Cancel', cancel: true },
      { label: 'Browse...', onClick: (h) => { h.close(null); onBrowse?.(); return false; } },
    ],
    onOpen: () => {
      input.focus();
    },
  });
  const hist = getUrlHistory();
  if (hist.length) {
    input.value = hist[0];
    input.select();
    handle.setButtonEnabled('OK', true);
  }
  input.addEventListener('input', () => handle.setButtonEnabled('OK', input.value.trim().length > 0));
  histBtn.addEventListener('click', () => {
    if (!hist.length) return;
    showDropdown(histBtn, hist.map((u) => ({ label: u, action: () => { input.value = u; handle.setButtonEnabled('OK', true); input.focus(); } })));
  });
  return handle.result.then((r) => (r === 'OK' ? value : null));
}

export interface ProgressHandle {
  setText(t: string): void;
  close(): void;
  cancelled: boolean;
}

/** Marquee progress dialog shown while the server resolves a URL. */
export function progressDialog(title: string, text: string, onCancel?: () => void): ProgressHandle {
  const body = document.createElement('div');
  body.innerHTML = `<p class="pd-text"></p><div class="xp-progress marquee"><div class="xp-progress-fill"></div></div>`;
  body.querySelector('.pd-text')!.textContent = text;
  const state = { cancelled: false };
  const handle = showDialog({
    title,
    body,
    width: 380,
    icon: null,
    buttons: [{ label: 'Cancel', cancel: true, default: true, onClick: () => { state.cancelled = true; onCancel?.(); return true; } }],
  });
  return {
    setText: (t) => { const p = body.querySelector('.pd-text'); if (p) p.textContent = t; },
    close: () => handle.close('done'),
    get cancelled() { return state.cancelled; },
  };
}

export function aboutDialog() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div style="display:flex;gap:14px;align-items:flex-start">
      <img src="/wmp.svg" width="48" height="48" alt="">
      <div>
        <p><b style="font-size:13px">Windows Media Player</b><br>Version 9.00.00.3250</p>
        <p>Copyright © 1992–2003 Microsoft Corporation. All rights reserved.</p>
        <p>This product is licensed under the terms of the End-User License Agreement to:<br><b>${escapeHtml(navigator.platform || 'User')}</b></p>
        <p style="color:#444">Web re-creation: Vite + TypeScript + Web Audio API. Audio analysis runs locally in your browser; YouTube audio is fetched by the local yt-dlp server.</p>
      </div>
    </div>`;
  return showDialog({ title: 'About Windows Media Player', body, width: 440 }).result;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
