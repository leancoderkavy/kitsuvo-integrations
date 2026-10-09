/* Chrome uses a worker; Firefox and Safari use an event page. */
if (typeof importScripts === 'function') importScripts('rules.js', 'detector.js');
const api = globalThis.browser || globalThis.chrome;
const SEARCH_MATCHES = ['https://www.google.com/search*', 'https://www.bing.com/search*', 'https://duckduckgo.com/*', 'https://html.duckduckgo.com/*', 'https://lite.duckduckgo.com/*'];
async function syncFilter() {
  const { searchFilter = false } = await api.storage.local.get('searchFilter');
  const hasAccess = await api.permissions.contains({ origins: SEARCH_MATCHES });
  const scripts = await api.scripting.getRegisteredContentScripts();
  if (scripts.some(s => s.id === 'kitsuvo-search')) await api.scripting.unregisterContentScripts({ ids: ['kitsuvo-search'] });
  if (searchFilter && hasAccess) await api.scripting.registerContentScripts([{ id: 'kitsuvo-search',
    matches: SEARCH_MATCHES, js: ['rules.js', 'detector.js', 'search.js'], runAt: 'document_idle' }]);
}
async function scan(tabId) {
  const tab = await api.tabs.get(tabId);
  if (tab.incognito) return { skipped: 'Private tabs are not scanned.', signals: [] };
  if (!/^https?:/.test(tab.url || '')) return { skipped: 'Select a normal website tab. Browser settings and store pages cannot be scanned.', signals: [] };
  if (KitsuvoDetector.sensitive(tab.url)) return { skipped: 'Sign-in provider pages are not scanned.', signals: [] };
  const results = await api.scripting.executeScript({ target: { tabId }, files: ['rules.js', 'detector.js', 'scan.js'] });
  const result = results.find(r => r.frameId === 0)?.result;
  if (!result) throw new Error('The page could not be read. Reload it and try again.');
  return result;
}
api.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== api.runtime.id || sender.tab) return false;
  const task = message?.type === 'scan' && Number.isInteger(message.tabId) ? scan(message.tabId)
    : message?.type === 'sync-filter' ? syncFilter().then(() => ({ ok: true })) : null;
  if (!task) return false;
  task.then(result => reply({ ok: true, result }), error => reply({ ok: false, error: error.message }));
  return true;
});
api.runtime.onInstalled.addListener(() => { syncFilter().catch(console.error); });
api.runtime.onStartup.addListener(() => { syncFilter().catch(console.error); });
api.permissions.onRemoved.addListener(() => { syncFilter().catch(console.error); });
