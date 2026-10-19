// Read-only DOM collector. Pass this function expression to the host's
// documented read-only browser evaluator; never inject it as a page script.
() => {
  const url = new URL(location.href);
  const host = url.hostname.toLowerCase();
  const sensitive = ['accounts.google.com', 'accounts.youtube.com', 'myaccount.google.com',
    'login.microsoftonline.com', 'login.live.com', 'login.microsoft.com', 'account.live.com',
    'appleid.apple.com', 'idmsa.apple.com', 'account.apple.com', 'auth.openai.com', 'login.yahoo.com'];
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      sensitive.includes(host) || ['.okta.com', '.oktapreview.com', '.auth0.com'].some(s => host.endsWith(s)) ||
      /\/(?:login|signin|sign-in|oauth|authorize|checkout|payment)(?:\/|$)/i.test(url.pathname) ||
      document.querySelector('input[type="password"],input[autocomplete="one-time-code"],input[autocomplete^="cc-"]')) {
    return { skipped: 'Sensitive or unsupported page; continue browsing without analysis.' };
  }
  // Build inert evidence from a small allowlist. No input values, inline
  // scripts, application state, data attributes, URL queries or fragments.
  const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const address = value => {
    try { const u = new URL(value, url); if (!['http:', 'https:'].includes(u.protocol)) return '';
      u.search = ''; u.hash = ''; u.username = ''; u.password = ''; return u.href; } catch { return ''; }
  };
  const parts = []; let size = 0, truncated = false, nodes = 0;
  function walk(el) {
    if (++nodes > 20000 || size > 1500000) { truncated = true; return; }
    const tag = el.localName;
    if (['input', 'textarea', 'select', 'option', 'template', 'noscript', 'iframe', 'object', 'embed'].includes(tag) ||
        el.hasAttribute('contenteditable') || el.closest('[contenteditable]')) return;
    const attrs = [];
    for (const name of ['class', 'id', 'lang', 'rel', 'type', 'role']) {
      const value = el.getAttribute(name); if (value) attrs.push(`${name}="${escape(value.slice(0, 1000))}"`);
    }
    for (const name of ['href', 'src']) { const value = el.getAttribute(name); if (value) attrs.push(`${name}="${escape(address(value))}"`); }
    if (tag === 'meta' && /^(generator|description)$/i.test(el.getAttribute('name') || '')) {
      attrs.push(`name="${escape(el.getAttribute('name'))}"`, `content="${escape((el.getAttribute('content') || '').slice(0, 2000))}"`);
    }
    const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
    parts.push(open); size += open.length;
    if (!['script', 'style'].includes(tag)) {
      for (const node of el.childNodes) {
        if (size > 1500000 || nodes > 20000) { truncated = true; break; }
        if (node.nodeType === 1) walk(node);
        else if (node.nodeType === 3) { const t = escape((node.textContent || '').slice(0, 20000)); parts.push(t); size += t.length; }
      }
    }
    parts.push(`</${tag}>`);
  }
  walk(document.documentElement);
  url.search = ''; url.hash = ''; url.username = ''; url.password = '';
  return { url: url.href, html: parts.join(''), truncated,
    source: 'codex-live-dom', omitted: ['inline scripts', 'form fields', 'embedded frames', 'response headers', 'runtime globals'] };
}
