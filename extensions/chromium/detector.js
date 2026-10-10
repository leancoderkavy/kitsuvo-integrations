/* Local fingerprint subset of the desktop detector. No network or form values. */
(() => {
  const rules = globalThis.KitsuvoRules;
  const host = value => { try { return new URL(value).hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; } };
  const builderHost = value => {
    const h = `.${host(value)}`;
    return rules.hosts.find(([suffix]) => h.endsWith(suffix));
  };
  const contains = (text, needle) => {
    let at = text.indexOf(needle);
    while (at !== -1) {
      const before = text[at - 1] || '', after = text[at + needle.length] || '';
      if ((!/^[a-z0-9_]/i.test(needle) || !/[a-z0-9_]/i.test(before)) &&
          (!/[a-z0-9_]$/i.test(needle) || !/[a-z0-9_]/i.test(after))) return true;
      at = text.indexOf(needle, at + 1);
    }
    return false;
  };
  const sensitive = value => {
    const h = host(value);
    return rules.sensitiveHosts.includes(h) || rules.sensitiveSuffixes.some(s => h.length > s.length && h.endsWith(s));
  };
  const score = points => Math.min(100, Math.max(0, Math.round(100 * (1 - Math.exp(-Math.max(0, points) / 40)))));
  const fingerprintContext = snapshot => {
    const html = snapshot.html || '', attributes = new Set(), urls = [], badges = [];
    let markup = '';
    const resolve = value => { try { const u = new URL(value, snapshot.url); if (/^https?:$/.test(u.protocol)) urls.push(u); } catch {} };
    for (const r of snapshot.resources || []) if (!/^(js|css):/.test(r)) resolve(r);
    if (snapshot.dom?.querySelectorAll) {
      // Scan the already-cloned DOM directly. Never reparse page-controlled
      // HTML into a sink or attach copied nodes to the live document.
      const doc = snapshot.dom;
      for (const el of doc.querySelectorAll('*')) {
        for (const a of el.attributes) attributes.add(a.name);
        markup += ` ${el.getAttribute('class') || ''} ${el.id || ''}`;
        if (el.matches('script:not([type="application/ld+json"])')) markup += ' ' + el.textContent;
        if (el.matches('meta[name="description"]') && el.getAttribute('content')?.toLowerCase() === 'lovable generated project') markup += ' lovable generated project';
        if (el.matches('script[src],img[src],source[src],link[rel="stylesheet"],link[rel="icon"],link[rel="preload"],link[rel="modulepreload"],meta[property="og:image"],meta[name="twitter:image"]')) resolve(el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('content'));
        if (el.matches('a[href]') && !el.closest('pre,code,blockquote')) {
          let target;
          try { target = new URL(el.getAttribute('href'), snapshot.url); } catch { continue; }
          const h = host(target.href);
          if (['lovable.dev','www.lovable.dev','bolt.new','v0.app','dyad.sh','emergent.sh','macaly.com','manus.im'].includes(h)) badges.push(el.textContent.toLowerCase());
          if (h === 'bolt.new') { const u = new URL(el.getAttribute('href'), snapshot.url); if (u.pathname === '/' && u.searchParams.has('rid')) markup += ' bolt.new/?rid'; }
        }
      }
    } else {
      // Non-browser consumers can supply attributes/URLs; raw prose never
      // becomes a fingerprint. Browser scans use the detached DOM above.
      for (const tag of html.replace(/<!--[\s\S]*?-->/g, '').match(/<[a-z][^>]*>/gi) || []) {
        for (const m of tag.matchAll(/\s([a-z][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi)) {
          const name = m[1].toLowerCase(), value = m[2] ?? m[3] ?? m[4] ?? '';
          attributes.add(name);
          if (name === 'class' || name === 'id') markup += ' ' + value;
          if (name === 'src' && /^<(script|img|source)\b/i.test(tag)) resolve(value);
        }
      }
    }
    return { attributes, urls, markup: markup.toLowerCase(), badges };
  };
  const fingerprint = (needle, ctx, snapshot) => {
    if (needle.startsWith('data-')) return ctx.attributes.has(needle);
    if (needle.startsWith('js:')) return (snapshot.resources || []).some(r => r.toLowerCase() === needle);
    if (/^(made with |built with |edit with |made in )/.test(needle)) return ctx.badges.some(text => contains(text, needle));
    if (needle === 'bolt.new/?rid') return ctx.markup.includes(needle);
    if (needle.startsWith('/') || needle.endsWith('.js') || /\.(?:com|co|app|sh|io|new|dev)(?:\/|$)/.test(needle)) {
      return ctx.urls.some(u => {
        const h = u.hostname.toLowerCase().replace(/\.$/, ''), p = u.pathname.toLowerCase();
        if (needle.startsWith('/')) return needle.endsWith('/') ? p.includes(needle) : p === needle;
        const slash = needle.indexOf('/');
        if (slash !== -1) return h === needle.slice(0, slash) && contains(p, needle.slice(slash));
        return needle.endsWith('.js') ? p.split('/').includes(needle) : h === needle;
      });
    }
    return contains(ctx.markup, needle);
  };
  function analyze(snapshot) {
    if (snapshot.skipped) return { skipped: snapshot.skipped, signals: [] };
    const signals = [];
    const add = (id, label, evidence, weight, builder = null) => {
      if (!signals.some(s => s.id === id)) signals.push({ id, label, evidence, weight, builder });
    };
    const hosting = builderHost(snapshot.url);
    if (hosting) add('host_builder', `Hosted on ${hosting[1]}`, host(snapshot.url), hosting[2], hosting[1]);
    const source = (snapshot.html || '').toLowerCase();
    const fingerprints = fingerprintContext(snapshot);
    for (const [needle, builder, label, weight] of rules.markup) {
      if (fingerprint(needle, fingerprints, snapshot))
        add(needle, label, `Found ${needle} in page markup or loaded resources`, weight, builder);
    }
    for (const [selector, value, builder, label] of rules.meta) {
      if ((snapshot.meta?.[selector] || '').toLowerCase() === value) {
        add('builder_meta', label, `${selector}: ${value}`, 45, builder); break;
      }
    }
    const generator = (snapshot.generator || '').toLowerCase();
    const agent = rules.agentGenerators.find(([name]) => generator.trim() === name);
    const declared = snapshot.dom?.querySelector('head meta[name="ai-built"]')?.getAttribute('content')?.trim().toLowerCase() === 'true';
    if (agent || declared) add('agent_provenance', 'Publisher declares coding-agent construction',
      agent ? `Generator: ${snapshot.generator} (unverified publisher declaration)` : 'ai-built=true (unverified publisher declaration)', 60, agent?.[1] || null);
    const named = rules.generators.find(([needle]) => contains(generator, needle));
    if (named) add('generator_ai', `Generator names ${named[1]}`, snapshot.generator, named[2], named[1]);
    else if (rules.humanGenerators.some(g => generator.includes(g)))
      add('generator_cms', 'Traditional CMS or static generator', snapshot.generator, -20);
    if (source.includes('wp-content/') || source.includes('wp-includes/'))
      add('wordpress', 'WordPress assets', 'wp-content or wp-includes in markup', -15);
    const total = signals.reduce((sum, s) => sum + s.weight, 0);
    const points = signals.some(s => s.id === 'agent_provenance') ? Math.max(60, total) : total;
    const value = score(points);
    const builders = signals.filter(s => s.builder).sort((a, b) => b.weight - a.weight);
    return { url: snapshot.url, title: snapshot.title, score: value,
      label: value >= 70 ? 'Likely AI-built' : value >= 40 ? 'Possibly vibe coded' : 'No strong AI signs',
      builder: builders[0]?.builder || null, signals,
      scope: 'Local builder fingerprints and hosting. Not the full desktop detector.' };
  }
  globalThis.KitsuvoDetector = { analyze, builderHost, score, sensitive, contains };
})();
