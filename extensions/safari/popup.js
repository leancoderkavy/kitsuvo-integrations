(() => {
  const api = globalThis.browser || globalThis.chrome;
  const $ = id => document.getElementById(id);
  const origins = ['https://www.google.com/search*', 'https://www.bing.com/search*', 'https://duckduckgo.com/*', 'https://html.duckduckgo.com/*', 'https://lite.duckduckgo.com/*'];
  const status = text => { $('status').textContent = text; };
  const tour = () => { $('tour').hidden = false; };
  $('help').addEventListener('click', () => { tour(); $('dismiss').focus(); });
  async function closeTour() {
    $('tour').hidden = true; $('help').focus();
    try { await api.storage.local.set({ tourVersion: 1 }); } catch { /* storage failure leaves UI usable */ }
  }
  $('dismiss').addEventListener('click', closeTour);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('tour').hidden) { event.preventDefault(); closeTour(); } });
  $('scan').addEventListener('click', async () => {
    $('scan').disabled = true; $('report').hidden = true; status('Checking this page on your device…');
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('Select a website tab first.');
      const response = await api.runtime.sendMessage({ type: 'scan', tabId: tab.id });
      if (!response?.ok) throw new Error(response?.error || 'The browser could not scan this page.');
      const report = response.result;
      if (report.skipped) { status(report.skipped); return; }
      $('score').textContent = report.score; $('verdict').textContent = report.label;
      $('builder').textContent = report.builder || 'No builder identified'; $('page-title').textContent = report.title;
      $('evidence').replaceChildren();
      for (const signal of report.signals) {
        const item = document.createElement('li'); item.textContent = `${signal.label}: ${signal.evidence}`;
        $('evidence').append(item);
      }
      if (!report.signals.length) { const item = document.createElement('li'); item.textContent = 'No known builder fingerprints found.'; $('evidence').append(item); }
      $('report').hidden = false; status(report.scope);
    } catch (error) { status(error.message); }
    finally { $('scan').disabled = false; }
  });
  $('filter').addEventListener('change', async () => {
    const enabled = $('filter').checked; $('filter').disabled = true;
    try {
      // Call request in the checkbox gesture; never grant access through the tour.
      if (enabled && !await api.permissions.request({ origins })) throw new Error('Search access was not granted. The filter stays off.');
      await api.storage.local.set({ searchFilter: enabled });
      const response = await api.runtime.sendMessage({ type: 'sync-filter' });
      if (!response?.ok) throw new Error(response?.error || 'Search filter registration failed.');
      if (!enabled) await api.permissions.remove({ origins });
      status(enabled ? 'Filter enabled. Reload a supported search page.' : 'Filter off. Reload search tabs to restore all results.');
    } catch (error) {
      $('filter').checked = false;
      await api.storage.local.set({ searchFilter: false }).catch(() => {});
      await api.permissions.remove({ origins }).catch(() => {});
      await api.runtime.sendMessage({ type: 'sync-filter' }).catch(() => {});
      status(error.message);
    } finally { $('filter').disabled = false; }
  });
  api.storage.local.get(['searchFilter', 'tourVersion']).then(settings => {
    $('filter').checked = !!settings.searchFilter;
    if (settings.tourVersion !== 1) tour();
  }).catch(() => { tour(); status('Settings could not be saved. Page scans still work.'); });
})();
