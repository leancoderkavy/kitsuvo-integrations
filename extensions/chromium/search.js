(() => {
  if (globalThis.__kitsuvoSearchInstalled) return;
  globalThis.__kitsuvoSearchInstalled = true;
  const api = globalThis.browser || globalThis.chrome;
  const removed = new Map();
  let active = true, revealed = false, timer, banner, label;
  const destination = link => {
    try {
      const url = new URL(link.href);
      if (url.hostname === location.hostname) {
        const target = url.searchParams.get('uddg') || (url.pathname === '/url' ? url.searchParams.get('q') || url.searchParams.get('url') : null);
        return target ? new URL(target).href : url.href;
      }
      return url.href;
    } catch { return ''; }
  };
  function restore() { for (const [row, wasHidden] of removed) row.hidden = wasHidden; removed.clear(); }
  function render() {
    if (!active || revealed) return;
    for (const link of [...document.querySelectorAll('a[href]')].slice(0, 1500)) {
      if (!link.querySelector('h3') && !link.matches('.result__a,[data-testid="result-title-a"],.b_algo h2 a')) continue;
      const entry = KitsuvoDetector.builderHost(destination(link));
      if (!entry || KitsuvoDetector.score(entry[2]) < 70) continue;
      const row = link.closest('.MjjYud,.g,.result,.b_algo,article[data-testid="result"]');
      if (!row || removed.has(row) || row.contains(banner)) continue;
      removed.set(row, row.hidden); row.hidden = true;
    }
    if (!removed.size) return;
    if (!banner) {
      banner = document.createElement('aside'); banner.setAttribute('aria-label', 'Kitsuvo search filter');
      label = document.createElement('span');
      const show = document.createElement('button'); show.type = 'button'; show.textContent = 'Show hidden results';
      show.addEventListener('click', () => { revealed = true; restore(); banner.remove(); });
      banner.append(label, document.createTextNode(' '), show);
      const search = document.querySelector('#search,#b_results,#links,[data-testid="mainline"]') || document.body;
      search.prepend(banner);
    }
    const text = `Kitsuvo hid ${removed.size} result${removed.size === 1 ? '' : 's'} hosted on known AI builders. Hosting is a clue, not proof.`;
    if (label.textContent !== text) label.textContent = text;
  }
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(render, 120); });
  api.storage.local.get('searchFilter').then(({ searchFilter }) => {
    active = !!searchFilter;
    if (active) { render(); observer.observe(document.body, { childList: true, subtree: true }); }
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.searchFilter?.newValue === false) {
      active = false; clearTimeout(timer); observer.disconnect(); restore(); banner?.remove();
    }
  });
})();
