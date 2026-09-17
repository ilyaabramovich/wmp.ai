/**
 * Draggable / resizable / minimize / maximize XP window behaviour.
 */
export interface WindowController {
  el: HTMLElement;
  minimize(): void;
  restore(): void;
  toggleMaximize(): void;
  isMinimized(): boolean;
  isMaximized(): boolean;
  setActive(active: boolean): void;
  onStateChange: ((state: 'normal' | 'minimized' | 'maximized') => void) | null;
}

interface Options {
  titlebar: HTMLElement;
  desktop: HTMLElement;
  onClose?: () => void;
  onResize?: () => void;
}

export function makeWindow(el: HTMLElement, opts: Options): WindowController {
  const { titlebar, desktop } = opts;
  let minimized = false;
  let maximized = false;
  let restoreRect: { left: number; top: number; width: number; height: number } | null = null;

  const ctl: WindowController = {
    el,
    onStateChange: null,
    minimize() {
      if (minimized) return;
      minimized = true;
      el.classList.add('minimized');
      ctl.onStateChange?.('minimized');
    },
    restore() {
      minimized = false;
      el.classList.remove('minimized');
      ctl.onStateChange?.(maximized ? 'maximized' : 'normal');
      opts.onResize?.();
    },
    toggleMaximize() {
      maximized = !maximized;
      if (maximized) {
        restoreRect = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
        el.classList.add('maximized');
      } else {
        el.classList.remove('maximized');
        if (restoreRect) {
          el.style.left = restoreRect.left + 'px';
          el.style.top = restoreRect.top + 'px';
          el.style.width = restoreRect.width + 'px';
          el.style.height = restoreRect.height + 'px';
        }
      }
      ctl.onStateChange?.(maximized ? 'maximized' : 'normal');
      opts.onResize?.();
    },
    isMinimized: () => minimized,
    isMaximized: () => maximized,
    setActive(active) {
      el.classList.toggle('inactive', !active);
    },
  };

  // ---- drag
  let drag: { dx: number; dy: number } | null = null;
  titlebar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    if (maximized) return;
    drag = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop };
    el.classList.add('dragging');
    titlebar.setPointerCapture(e.pointerId);
  });
  titlebar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dw = desktop.clientWidth;
    const dh = desktop.clientHeight;
    let left = e.clientX - drag.dx;
    let top = e.clientY - drag.dy;
    // keep the titlebar reachable
    left = Math.max(-el.offsetWidth + 120, Math.min(dw - 120, left));
    top = Math.max(0, Math.min(dh - 30, top));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    el.classList.remove('dragging');
  };
  titlebar.addEventListener('pointerup', endDrag);
  titlebar.addEventListener('pointercancel', endDrag);
  titlebar.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    ctl.toggleMaximize();
  });

  // ---- resize handles
  const minW = parseInt(getComputedStyle(el).minWidth) || 400;
  const minH = parseInt(getComputedStyle(el).minHeight) || 300;
  el.querySelectorAll<HTMLElement>('.xp-resize').forEach((h) => {
    const dir = Array.from(h.classList).find((c) => c !== 'xp-resize') || 'se';
    let start: { x: number; y: number; l: number; t: number; w: number; h: number } | null = null;
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || maximized) return;
      start = { x: e.clientX, y: e.clientY, l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      el.classList.add('resizing');
      h.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    h.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      let { l, t, w, h: hh } = start;
      if (dir.includes('e')) w = Math.max(minW, start.w + dx);
      if (dir.includes('s')) hh = Math.max(minH, start.h + dy);
      if (dir.includes('w')) { w = Math.max(minW, start.w - dx); l = start.l + (start.w - w); }
      if (dir.includes('n')) { hh = Math.max(minH, start.h - dy); t = Math.max(0, start.t + (start.h - hh)); }
      el.style.left = l + 'px';
      el.style.top = t + 'px';
      el.style.width = w + 'px';
      el.style.height = hh + 'px';
      opts.onResize?.();
    });
    const end = () => { if (start) { start = null; el.classList.remove('resizing'); opts.onResize?.(); } };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  });

  // Keep window inside desktop when the viewport shrinks
  window.addEventListener('resize', () => {
    if (maximized) return;
    const dw = desktop.clientWidth;
    const dh = desktop.clientHeight;
    if (el.offsetLeft + 120 > dw) el.style.left = Math.max(0, dw - el.offsetWidth) + 'px';
    if (el.offsetTop + 30 > dh) el.style.top = Math.max(0, dh - 60) + 'px';
    opts.onResize?.();
  });

  return ctl;
}

/** Centre the window in the desktop with a sensible default size. */
export function placeInitial(el: HTMLElement, desktop: HTMLElement) {
  const dw = desktop.clientWidth;
  const dh = desktop.clientHeight;
  const w = Math.min(960, Math.max(640, Math.round(dw * 0.78)));
  const h = Math.min(700, Math.max(440, Math.round(dh * 0.82)));
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.left = Math.max(0, Math.round((dw - w) / 2)) + 'px';
  el.style.top = Math.max(0, Math.round((dh - h) / 2) - 10) + 'px';
}
