/**
 * Scrolls to and briefly flashes the element marked `data-highlight-id="<id>"` — for links that
 * point at one specific item (a to-do, shopping item, event, fact). The item may not have
 * rendered yet (lists fill in from Firestore after the page opens), so this keeps looking for a
 * few seconds before giving up.
 */
export function highlightWhenPresent(id: string, timeoutMs: number = 6000): void {
  const started = Date.now();
  const look = (): void => {
    const el = Array.from(document.querySelectorAll<HTMLElement>('[data-highlight-id]'))
      .find(candidate => candidate.dataset['highlightId'] === id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('deep-link-highlight');
      setTimeout(() => el.classList.remove('deep-link-highlight'), 3000);
    } else if (Date.now() - started < timeoutMs) {
      setTimeout(look, 150);
    }
  };
  look();
}
