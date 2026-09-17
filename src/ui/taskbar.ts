/**
 * XP taskbar: Start button + menu, window buttons, tray clock.
 */
export interface TaskbarController {
  setWindowButton(title: string, active: boolean, visible: boolean): void;
  onWindowButtonClick: (() => void) | null;
  setVisible(v: boolean): void;
}

export function makeTaskbar(opts: {
  onStartItem?: (id: string) => void;
}): TaskbarController {
  const bar = document.getElementById('taskbar')!;
  const items = document.getElementById('taskbar-items')!;
  const clock = document.getElementById('clock')!;
  const startBtn = document.getElementById('btn-start') as HTMLButtonElement;

  // Clock
  const tick = () => {
    const d = new Date();
    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    clock.textContent = `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
  };
  tick();
  setInterval(tick, 10_000);

  // Window button
  const wbtn = document.createElement('button');
  wbtn.className = 'xp-task-btn active';
  wbtn.innerHTML = `<img src="/wmp.svg" width="16" height="16" alt=""><span>Windows Media Player</span>`;
  items.appendChild(wbtn);

  const ctl: TaskbarController = {
    onWindowButtonClick: null,
    setWindowButton(title, active, visible) {
      wbtn.querySelector('span')!.textContent = title;
      wbtn.classList.toggle('active', active);
      wbtn.hidden = !visible;
    },
    setVisible(v) {
      bar.classList.toggle('hidden-bar', !v);
      document.body.classList.toggle('no-taskbar', !v);
    },
  };
  wbtn.addEventListener('click', () => ctl.onWindowButtonClick?.());

  // Start menu
  let menu: HTMLElement | null = null;
  const closeStart = () => {
    menu?.remove();
    menu = null;
    startBtn.classList.remove('pressed');
  };
  startBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (menu) { closeStart(); return; }
    startBtn.classList.add('pressed');
    menu = document.createElement('div');
    menu.className = 'xp-startmenu';
    menu.innerHTML = `
      <div class="xp-sm-head"><div class="xp-sm-avatar"></div><span>User</span></div>
      <div class="xp-sm-cols">
        <div class="xp-sm-left">
          <div class="xp-sm-item" data-id="wmp"><img src="/wmp.svg" alt=""><div><b>Windows Media Player</b><small>Play music and visualizations</small></div></div>
          <div class="xp-sm-item" data-id="open-file"><img src="/recycle.svg" alt="" style="visibility:hidden"><div><b>Open…</b><small>Open a local audio file</small></div></div>
          <div class="xp-sm-item" data-id="open-url"><img src="/recycle.svg" alt="" style="visibility:hidden"><div><b>Open URL…</b><small>Play a YouTube or direct link</small></div></div>
          <div class="xp-sm-sep"></div>
          <div class="xp-sm-item" data-id="readme"><img src="/recycle.svg" alt="" style="visibility:hidden"><div><b>All Programs</b></div></div>
        </div>
        <div class="xp-sm-right">
          <div class="xp-sm-item" data-id="none"><b>My Documents</b></div>
          <div class="xp-sm-item" data-id="none"><b>My Music</b></div>
          <div class="xp-sm-item" data-id="none"><b>My Computer</b></div>
          <div class="xp-sm-sep"></div>
          <div class="xp-sm-item" data-id="options"><b>Control Panel</b></div>
          <div class="xp-sm-item" data-id="about"><b>Help and Support</b></div>
        </div>
      </div>
      <div class="xp-sm-foot">
        <button data-id="none"><span class="xp-sm-glyph log"></span>Log Off</button>
        <button data-id="none"><span class="xp-sm-glyph off"></span>Turn Off Computer</button>
      </div>`;
    menu.addEventListener('pointerdown', (e) => e.stopPropagation());
    menu.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (!t) return;
      const id = t.dataset.id!;
      closeStart();
      if (id !== 'none') opts.onStartItem?.(id);
    });
    document.body.appendChild(menu);
  });
  document.addEventListener('pointerdown', closeStart);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStart(); });

  return ctl;
}
