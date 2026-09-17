/**
 * Windows XP Notepad: a second Luna window used to open text files from the desktop.
 */
import { makeWindow, WindowController } from './window';
import { MenuBar } from './menu';
import { showDialog, messageBox } from './dialog';
import type { TaskbarController, TaskButton } from './taskbar';

export interface NotepadOptions {
  fileName: string;
  text: string;
  desktop: HTMLElement;
  taskbar: TaskbarController;
  /** Called when this window becomes active (so others can deactivate). */
  onActivate?: () => void;
}

export interface NotepadHandle {
  win: WindowController;
  el: HTMLElement;
  focus(): void;
  /** Mark inactive (title bar dims, taskbar button unpressed). */
  deactivate(): void;
  close(): void;
}

let openCount = 0;

export function openNotepad(opts: NotepadOptions): NotepadHandle {
  const { desktop, taskbar } = opts;
  const title = `${opts.fileName} - Notepad`;

  const el = document.createElement('div');
  el.className = 'xp-window xp-notepad';
  el.innerHTML = `
    <div class="xp-titlebar">
      <img class="xp-titleicon" src="/notepad.svg" width="16" height="16" alt="" draggable="false">
      <span class="xp-title"></span>
      <div class="xp-titlebuttons">
        <button class="xp-tb xp-tb-min" title="Minimize" aria-label="Minimize"></button>
        <button class="xp-tb xp-tb-max" title="Maximize" aria-label="Maximize"></button>
        <button class="xp-tb xp-tb-close" title="Close" aria-label="Close"></button>
      </div>
    </div>
    <div class="xp-menubar"></div>
    <textarea class="xp-notepad-text" spellcheck="false" wrap="off"></textarea>
    <div class="xp-statusbar xp-notepad-status">
      <span class="xp-status-cell xp-status-main"></span>
      <span class="xp-status-cell xp-notepad-pos">Ln 1, Col 1</span>
    </div>
    <div class="xp-resize n"></div><div class="xp-resize s"></div><div class="xp-resize e"></div><div class="xp-resize w"></div>
    <div class="xp-resize ne"></div><div class="xp-resize nw"></div><div class="xp-resize se"></div><div class="xp-resize sw"></div>`;
  el.querySelector('.xp-title')!.textContent = title;

  // size & cascade position
  const dw = desktop.clientWidth;
  const dh = desktop.clientHeight;
  const w = Math.min(720, Math.max(420, Math.round(dw * 0.5)));
  const h = Math.min(560, Math.max(320, Math.round(dh * 0.65)));
  const offset = (openCount++ % 6) * 24;
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.left = Math.max(0, Math.round((dw - w) / 2) + 60 + offset) + 'px';
  el.style.top = Math.max(0, Math.round((dh - h) / 2) + 20 + offset) + 'px';
  desktop.appendChild(el);

  const ta = el.querySelector<HTMLTextAreaElement>('.xp-notepad-text')!;
  ta.value = opts.text;
  const status = el.querySelector<HTMLElement>('.xp-notepad-status')!;
  const pos = el.querySelector<HTMLElement>('.xp-notepad-pos')!;
  let wordWrap = true;
  let statusBar = false;
  const applyWrap = () => {
    ta.setAttribute('wrap', wordWrap ? 'soft' : 'off');
    ta.style.whiteSpace = wordWrap ? 'pre-wrap' : 'pre';
  };
  applyWrap();
  status.hidden = !statusBar;

  const updatePos = () => {
    const before = ta.value.slice(0, ta.selectionStart);
    const lines = before.split('\n');
    pos.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
  };
  ta.addEventListener('keyup', updatePos);
  ta.addEventListener('click', updatePos);
  ta.addEventListener('select', updatePos);

  let taskBtn: TaskButton | null = null;
  const win = makeWindow(el, { titlebar: el.querySelector('.xp-titlebar')!, desktop });

  const handle: NotepadHandle = {
    win,
    el,
    focus() {
      if (win.isMinimized()) win.restore();
      win.setActive(true);
      taskBtn?.setActive(true);
      opts.onActivate?.();
      ta.focus({ preventScroll: true });
    },
    deactivate() {
      win.setActive(false);
      taskBtn?.setActive(false);
    },
    close() {
      el.remove();
      taskBtn?.remove();
      window.removeEventListener('blur', onBlur);
    },
  };

  taskBtn = taskbar.addButton(title, '/notepad.svg', () => {
    if (win.isMinimized()) handle.focus();
    else win.minimize();
  });
  win.onStateChange = (s) => {
    taskBtn?.setActive(s !== 'minimized');
    if (s !== 'minimized') { win.setActive(true); opts.onActivate?.(); }
  };

  const onBlur = () => { /* keep state; nothing to do */ };
  window.addEventListener('blur', onBlur);

  el.querySelector('.xp-tb-min')!.addEventListener('click', () => win.minimize());
  el.querySelector('.xp-tb-max')!.addEventListener('click', () => win.toggleMaximize());
  el.querySelector('.xp-tb-close')!.addEventListener('click', () => handle.close());
  el.addEventListener('pointerdown', () => { win.setActive(true); taskBtn?.setActive(true); opts.onActivate?.(); });

  const saveAs = () => {
    const blob = new Blob([ta.value], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = opts.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  new MenuBar(el.querySelector('.xp-menubar')!, [
    { label: '&File', items: () => [
      { label: '&New', shortcut: 'Ctrl+N', action: () => { ta.value = ''; el.querySelector('.xp-title')!.textContent = 'Untitled - Notepad'; taskBtn?.setTitle('Untitled - Notepad'); } },
      { label: '&Open...', shortcut: 'Ctrl+O', disabled: true },
      { label: '&Save', shortcut: 'Ctrl+S', action: saveAs },
      { label: 'Save &As...', action: saveAs },
      { separator: true },
      { label: 'Page Set&up...', disabled: true },
      { label: '&Print...', shortcut: 'Ctrl+P', action: () => window.print() },
      { separator: true },
      { label: 'E&xit', action: () => handle.close() },
    ] },
    { label: '&Edit', items: () => [
      { label: '&Undo', shortcut: 'Ctrl+Z', action: () => document.execCommand('undo') },
      { separator: true },
      { label: 'Cu&t', shortcut: 'Ctrl+X', action: () => { ta.focus(); document.execCommand('cut'); } },
      { label: '&Copy', shortcut: 'Ctrl+C', action: () => { ta.focus(); document.execCommand('copy'); } },
      { label: '&Paste', shortcut: 'Ctrl+V', disabled: true },
      { label: 'De&lete', shortcut: 'Del', action: () => { ta.focus(); document.execCommand('delete'); } },
      { separator: true },
      { label: '&Find...', shortcut: 'Ctrl+F', disabled: true },
      { label: 'Find &Next', shortcut: 'F3', disabled: true },
      { label: '&Replace...', shortcut: 'Ctrl+H', disabled: true },
      { label: '&Go To...', shortcut: 'Ctrl+G', disabled: true },
      { separator: true },
      { label: 'Select &All', shortcut: 'Ctrl+A', action: () => { ta.focus(); ta.select(); updatePos(); } },
      { label: 'Time/&Date', shortcut: 'F5', action: () => {
        const d = new Date();
        const stamp = `${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ${d.toLocaleDateString()}`;
        const s0 = ta.selectionStart; ta.setRangeText(stamp, s0, ta.selectionEnd, 'end'); ta.focus(); updatePos();
      } },
    ] },
    { label: 'F&ormat', items: () => [
      { label: '&Word Wrap', checked: () => wordWrap, action: () => { wordWrap = !wordWrap; applyWrap(); } },
      { label: '&Font...', action: () => messageBox('Font', 'Lucida Console, Regular, 10 pt.', 'info') },
    ] },
    { label: '&View', items: () => [
      { label: '&Status Bar', checked: () => statusBar, action: () => { statusBar = !statusBar; status.hidden = !statusBar; updatePos(); } },
    ] },
    { label: '&Help', items: () => [
      { label: '&Help Topics', disabled: true },
      { separator: true },
      { label: '&About Notepad', action: () => {
        const body = document.createElement('div');
        body.innerHTML = `<div style="display:flex;gap:14px;align-items:flex-start"><img src="/notepad.svg" width="40" height="40" alt=""><div><p><b style="font-size:13px">Notepad</b><br>Microsoft Windows XP, Version 5.1 (Build 2600.xpsp_sp2)</p><p>Copyright © 1981–2001 Microsoft Corporation</p></div></div>`;
        showDialog({ title: 'About Notepad', body, width: 380 });
      } },
    ] },
  ]);

  handle.focus();
  return handle;
}
