/**
 * XP-style menu bar, dropdowns, submenus and context menus. Data-driven.
 */
export interface MenuItem {
  label?: string;
  separator?: boolean;
  disabled?: boolean | (() => boolean);
  checked?: boolean | (() => boolean);
  radio?: boolean;
  shortcut?: string;
  submenu?: MenuItem[] | (() => MenuItem[]);
  action?: () => void;
  icon?: string;
}

export interface TopMenu {
  label: string;
  items: MenuItem[] | (() => MenuItem[]);
}

const root = () => document.getElementById('menu-root')!;

let openStack: HTMLElement[] = [];
let closeAllHook: (() => void) | null = null;

export function closeAllMenus() {
  for (const p of openStack) p.remove();
  openStack = [];
  closeAllHook?.();
  closeAllHook = null;
  document.querySelectorAll('.xp-menu-top.open, .open[data-menu-anchor]').forEach((e) => e.classList.remove('open'));
}

function resolve<T>(v: T | (() => T)): T {
  return typeof v === 'function' ? (v as () => T)() : v;
}

function positionPopup(popup: HTMLElement, x: number, y: number, opts: { alignRight?: boolean; submenu?: boolean; anchorRect?: DOMRect } = {}) {
  popup.style.left = '0px';
  popup.style.top = '0px';
  root().appendChild(popup);
  const pw = popup.offsetWidth;
  const ph = popup.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x;
  let top = y;
  if (opts.submenu && opts.anchorRect) {
    left = opts.anchorRect.right - 3;
    top = opts.anchorRect.top - 3;
    if (left + pw > vw) left = opts.anchorRect.left - pw + 3;
  } else if (opts.alignRight) {
    left = x - pw;
  }
  if (left + pw > vw) left = Math.max(0, vw - pw - 2);
  if (top + ph > vh) top = Math.max(0, (opts.anchorRect && !opts.submenu ? opts.anchorRect.top - ph : vh - ph - 2));
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

function buildPopup(items: MenuItem[], depth: number): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'xp-popup animate';
  popup.dataset.depth = String(depth);
  let subTimer = 0;
  let openSub: HTMLElement | null = null;
  let openSubItem: HTMLElement | null = null;

  const closeSub = () => {
    if (openSub) {
      // remove this popup's submenu and anything deeper
      const idx = openStack.indexOf(openSub);
      if (idx >= 0) {
        openStack.splice(idx).forEach((p) => p.remove());
      }
      openSub = null;
    }
    openSubItem?.classList.remove('open');
    openSubItem = null;
  };

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'xp-sep';
      popup.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'xp-mi';
    const disabled = resolve(item.disabled ?? false);
    const checked = resolve(item.checked ?? false);
    if (disabled) el.classList.add('disabled');
    if (checked) el.classList.add('checked');
    if (item.radio) el.classList.add('radio');
    if (item.submenu) el.classList.add('has-sub');
    const check = document.createElement('span');
    check.className = 'xp-mi-check';
    el.appendChild(check);
    if (item.icon) {
      const img = document.createElement('img');
      img.className = 'xp-mi-icon';
      img.src = item.icon;
      el.appendChild(img);
    }
    const label = document.createElement('span');
    label.className = 'xp-mi-label';
    label.innerHTML = accel(item.label || '');
    el.appendChild(label);
    if (item.shortcut) {
      const sc = document.createElement('span');
      sc.className = 'xp-mi-shortcut';
      sc.textContent = item.shortcut;
      el.appendChild(sc);
    }

    el.addEventListener('pointerenter', () => {
      clearTimeout(subTimer);
      if (openSubItem !== el) {
        subTimer = window.setTimeout(() => {
          closeSub();
          if (item.submenu && !disabled) {
            const sub = buildPopup(resolve(item.submenu), depth + 1);
            positionPopup(sub, 0, 0, { submenu: true, anchorRect: el.getBoundingClientRect() });
            openStack.push(sub);
            openSub = sub;
            openSubItem = el;
            el.classList.add('open');
          }
        }, item.submenu ? 220 : 350);
      }
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (disabled) return;
      if (item.submenu) {
        // open immediately on click
        clearTimeout(subTimer);
        if (openSubItem === el) return;
        closeSub();
        const sub = buildPopup(resolve(item.submenu), depth + 1);
        positionPopup(sub, 0, 0, { submenu: true, anchorRect: el.getBoundingClientRect() });
        openStack.push(sub);
        openSub = sub;
        openSubItem = el;
        el.classList.add('open');
        return;
      }
      closeAllMenus();
      item.action?.();
    });
    popup.appendChild(el);
  }
  popup.addEventListener('pointerdown', (e) => e.stopPropagation());
  return popup;
}

/** Underline the accelerator marked with & e.g. "&File". */
function accel(label: string): string {
  const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc.replace(/&amp;(\w)/, '<u>$1</u>');
}

export function showContextMenu(x: number, y: number, items: MenuItem[]) {
  closeAllMenus();
  const popup = buildPopup(items, 0);
  positionPopup(popup, x, y);
  openStack.push(popup);
}

/** Show a dropdown anchored below an element (used by WMP's "Now Playing ▾" buttons). */
export function showDropdown(anchor: HTMLElement, items: MenuItem[] | (() => MenuItem[])) {
  if (anchor.classList.contains('open')) { closeAllMenus(); return; }
  closeAllMenus();
  const popup = buildPopup(resolve(items), 0);
  const r = anchor.getBoundingClientRect();
  positionPopup(popup, r.left, r.bottom, { anchorRect: r });
  openStack.push(popup);
  anchor.classList.add('open');
  anchor.dataset.menuAnchor = '1';
  closeAllHook = () => anchor.classList.remove('open');
}

export class MenuBar {
  private tops: HTMLElement[] = [];
  private openIndex = -1;

  constructor(container: HTMLElement, private menus: TopMenu[]) {
    menus.forEach((m, i) => {
      const t = document.createElement('div');
      t.className = 'xp-menu-top';
      t.innerHTML = accel(m.label);
      t.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (this.openIndex === i) { closeAllMenus(); this.openIndex = -1; }
        else this.open(i);
      });
      t.addEventListener('pointerenter', () => {
        if (this.openIndex >= 0 && this.openIndex !== i) this.open(i);
      });
      container.appendChild(t);
      this.tops.push(t);
    });
  }

  open(i: number) {
    closeAllMenus();
    this.openIndex = i;
    const t = this.tops[i];
    t.classList.add('open');
    const popup = buildPopup(resolve(this.menus[i].items), 0);
    const r = t.getBoundingClientRect();
    positionPopup(popup, r.left, r.bottom);
    openStack.push(popup);
    closeAllHook = () => { this.openIndex = -1; };
  }

  /** Alt+letter support. */
  openByAccel(letter: string): boolean {
    const i = this.menus.findIndex((m) => new RegExp('&' + letter, 'i').test(m.label));
    if (i < 0) return false;
    this.open(i);
    return true;
  }
}

// Global dismissal
document.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest?.('.xp-popup')) closeAllMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openStack.length) closeAllMenus();
});
window.addEventListener('blur', closeAllMenus);
window.addEventListener('resize', closeAllMenus);
