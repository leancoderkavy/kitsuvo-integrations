(() => {
  const detector = globalThis.KitsuvoDetector;
  if (detector.sensitive(location.href)) return { skipped: 'Sign-in provider pages are not scanned.', signals: [] };
  if (!/^https?:$/.test(location.protocol)) return { skipped: 'Open an HTTP or HTTPS page to scan.', signals: [] };
  if (document.querySelector('input[type="password"]')) return { skipped: 'Pages with password fields are not scanned.', signals: [] };
  const copy = document.documentElement.cloneNode(true);
  for (const el of copy.querySelectorAll('input,textarea,select,[contenteditable]')) {
    el.removeAttribute('value'); el.removeAttribute('checked'); el.replaceChildren();
  }
  const meta = {};
  for (const [selector] of globalThis.KitsuvoRules.meta) meta[selector] = document.querySelector(selector)?.getAttribute('content') || '';
  const url = new URL(location.href); url.search = ''; url.hash = ''; url.username = ''; url.password = '';
  return detector.analyze({ url: url.href, title: document.title.slice(0, 200),
    html: copy.outerHTML.slice(0, 3_000_000), dom: copy, meta,
    generator: document.querySelector('meta[name=generator]')?.getAttribute('content') || '',
    resources: performance.getEntriesByType('resource').slice(-380).map(e => e.name.split(/[?#]/)[0].slice(0, 300)) });
})();
