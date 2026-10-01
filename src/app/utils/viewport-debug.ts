/**
 * Temporary on-screen readout for diagnosing the blank strip that can appear at the bottom of
 * the screen on iOS after the keyboard closes. Only active when the page is opened with
 * `?vvdebug=1`; it shows the viewport numbers that tell the likely causes apart.
 */
export function startViewportDebug(): void {
  // The app routes with a URL hash (/#/path), so accept the flag either before the # or inside it,
  // and remember it for the tab — a later navigation can rewrite the URL and drop the parameter.
  if (/[?&]vvdebug\b/.test(location.href)) {
    try { sessionStorage.setItem('vvdebug', '1'); } catch { /* storage can be blocked; the URL flag still works */ }
  }
  let enabled = /[?&]vvdebug\b/.test(location.href);
  try { enabled = enabled || sessionStorage.getItem('vvdebug') === '1'; } catch { /* ignore */ }
  if (!enabled) return;

  const panel = document.createElement('pre');
  panel.style.cssText =
    'position:fixed;top:48px;left:4px;right:4px;z-index:99999;margin:0;padding:6px;' +
    'font:10px/1.3 monospace;color:#0f0;background:rgba(0,0,0,.78);border-radius:6px;' +
    'pointer-events:none;white-space:pre-wrap;';
  document.body.appendChild(panel);

  const log: string[] = [];
  const snapshot = (): string => {
    const vv = window.visualViewport;
    const container = document.querySelector('.app-container') as HTMLElement | null;
    const dock = document.querySelector('.home-chat-dock') as HTMLElement | null;
    const r = (n?: number) => (n === undefined ? '-' : Math.round(n));
    return [
      `inner ${r(innerWidth)}x${r(innerHeight)}  vv ${r(vv?.width)}x${r(vv?.height)}  scale ${vv ? vv.scale.toFixed(2) : '-'}  vv.top ${r(vv?.offsetTop)} pageTop ${r(vv?.pageTop)}`,
      `scrollY ${r(scrollY)}  doc ${r(document.documentElement.scrollHeight)}  body ${r(document.body.getBoundingClientRect().height)}`,
      `container client ${r(container?.clientHeight)} scrollTop ${r(container?.scrollTop)} scrollH ${r(container?.scrollHeight)} bottom ${r(container?.getBoundingClientRect().bottom)}`,
      `dock bottom ${r(dock?.getBoundingClientRect().bottom)}  safeBottom ${getComputedStyle(document.documentElement).getPropertyValue('--app-safe-area-bottom') || '-'}`,
      `active ${(document.activeElement as HTMLElement | null)?.tagName ?? '-'}`
    ].join('\n');
  };
  const render = () => { panel.textContent = `${snapshot()}\n--\n${log.slice(-6).join('\n')}`; };
  const note = (label: string) => {
    const vv = window.visualViewport;
    const container = document.querySelector('.app-container') as HTMLElement | null;
    log.push(`${label}: scale ${(vv?.scale ?? 1).toFixed(2)} vv.h ${Math.round(vv?.height ?? 0)} top ${Math.round(vv?.offsetTop ?? 0)} scrollY ${Math.round(scrollY)} cont.bottom ${Math.round(container?.getBoundingClientRect().bottom ?? 0)}`);
    render();
  };

  ['focusin', 'focusout'].forEach(type => document.addEventListener(type, () => {
    note(type);
    if (type === 'focusout') [300, 800, 1500].forEach(ms => setTimeout(() => note(`+${ms}ms`), ms));
  }));
  window.visualViewport?.addEventListener('resize', () => note('vv-resize'));
  window.addEventListener('resize', render);
  window.addEventListener('scroll', render, true);
  setInterval(render, 500);
  render();
}
