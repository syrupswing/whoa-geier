/**
 * Temporary on-screen readout for diagnosing the blank strip that can appear at the bottom of
 * the screen on iOS. Turn it on with `?vvdebug=1` in the URL, or — for the home-screen app,
 * which can't take a URL — by tapping five times in the top-left corner of the screen within
 * two seconds (five more taps turns it off). The setting is remembered on the device.
 */
const STORAGE_KEY = 'vvdebug';

function isEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage can be blocked; the readout just won't persist */ }
}

let panel: HTMLPreElement | null = null;
let timer: number | undefined;
const log: string[] = [];

/** Height of a CSS viewport unit, measured by laying out an element that uses it. */
function unitHeight(unit: string): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:100${unit};`;
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}

function snapshot(): string {
  const vv = window.visualViewport;
  const container = document.querySelector('.app-container') as HTMLElement | null;
  const dock = document.querySelector('.home-chat-dock') as HTMLElement | null;
  const r = (n?: number) => (n === undefined ? '-' : Math.round(n));
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  return [
    `standalone ${standalone}  screen ${r(screen.width)}x${r(screen.height)}  inner ${r(innerWidth)}x${r(innerHeight)}`,
    `vv ${r(vv?.width)}x${r(vv?.height)}  scale ${vv ? vv.scale.toFixed(2) : '-'}  vv.top ${r(vv?.offsetTop)}  scrollY ${r(scrollY)}`,
    `100dvh ${r(unitHeight('dvh'))}  100svh ${r(unitHeight('svh'))}  100lvh ${r(unitHeight('lvh'))}  100vh ${r(unitHeight('vh'))}`,
    `html ${r(document.documentElement.getBoundingClientRect().height)}  body ${r(document.body.getBoundingClientRect().height)}`,
    `container top ${r(container?.getBoundingClientRect().top)} bottom ${r(container?.getBoundingClientRect().bottom)} client ${r(container?.clientHeight)} scrollH ${r(container?.scrollHeight)}`,
    `dock bottom ${r(dock?.getBoundingClientRect().bottom)}  safeTop ${getComputedStyle(document.documentElement).getPropertyValue('--app-safe-area-top') || '-'} safeBottom ${getComputedStyle(document.documentElement).getPropertyValue('--app-safe-area-bottom') || '-'}`
  ].join('\n');
}

function render(): void {
  if (panel) panel.textContent = `${snapshot()}\n--\n${log.slice(-5).join('\n')}`;
}

function note(label: string): void {
  const vv = window.visualViewport;
  const container = document.querySelector('.app-container') as HTMLElement | null;
  log.push(`${label}: inner ${Math.round(innerHeight)} vv.h ${Math.round(vv?.height ?? 0)} top ${Math.round(vv?.offsetTop ?? 0)} cont.bottom ${Math.round(container?.getBoundingClientRect().bottom ?? 0)}`);
  render();
}

function show(): void {
  if (panel) return;
  panel = document.createElement('pre');
  panel.style.cssText =
    'position:fixed;top:48px;left:4px;right:4px;z-index:99999;margin:0;padding:6px;' +
    'font:10px/1.3 monospace;color:#0f0;background:rgba(0,0,0,.78);border-radius:6px;' +
    'pointer-events:none;white-space:pre-wrap;';
  document.body.appendChild(panel);
  timer = window.setInterval(render, 500);
  render();
}

function hide(): void {
  panel?.remove();
  panel = null;
  if (timer !== undefined) clearInterval(timer);
}

export function startViewportDebug(): void {
  // The app routes with a URL hash (/#/path), so accept the flag before or inside the hash.
  if (/[?&]vvdebug\b/.test(location.href)) setEnabled(true);
  if (isEnabled()) show();

  // Five taps in the top-left corner within two seconds toggles the readout (for the home-screen app).
  let taps: number[] = [];
  document.addEventListener('touchstart', (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t || t.clientX > 110 || t.clientY > 140) return;
    const now = Date.now();
    taps = [...taps.filter(x => now - x < 2000), now];
    if (taps.length >= 5) {
      taps = [];
      const on = !panel;
      setEnabled(on);
      if (on) show(); else hide();
    }
  }, { passive: true });

  ['focusin', 'focusout'].forEach(type => document.addEventListener(type, () => {
    note(type);
    if (type === 'focusout') [300, 800, 1500].forEach(ms => setTimeout(() => note(`+${ms}ms`), ms));
  }));
  window.visualViewport?.addEventListener('resize', () => note('vv-resize'));
  window.addEventListener('resize', render);
  window.addEventListener('scroll', render, true);
}
