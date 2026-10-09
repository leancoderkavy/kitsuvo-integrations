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
  function analyze(snapshot) {
    if (snapshot.skipped) return { skipped: snapshot.skipped, signals: [] };
    const signals = [];
    const add = (id, label, evidence, weight, builder = null) => {
      if (!signals.some(s => s.id === id)) signals.push({ id, label, evidence, weight, builder });
    };
    const hosting = builderHost(snapshot.url);
    if (hosting) add('host_builder', `Hosted on ${hosting[1]}`, host(snapshot.url), hosting[2], hosting[1]);
    const source = (snapshot.html || '').toLowerCase();
    const loaded = (snapshot.resources || []).join('\n').toLowerCase();
    for (const [needle, builder, label, weight] of rules.markup) {
      if (contains(source, needle) || contains(loaded, needle))
        add(needle, label, `Found ${needle} in page markup or loaded resources`, weight, builder);
    }
    for (const [selector, value, builder, label] of rules.meta) {
      if ((snapshot.meta?.[selector] || '').toLowerCase() === value) {
        add('builder_meta', label, `${selector}: ${value}`, 45, builder); break;
      }
    }
    const generator = (snapshot.generator || '').toLowerCase();
    const named = rules.generators.find(([needle]) => contains(generator, needle));
    if (named) add('generator_ai', `Generator names ${named[1]}`, snapshot.generator, named[2], named[1]);
    else if (rules.humanGenerators.some(g => generator.includes(g)))
      add('generator_cms', 'Traditional CMS or static generator', snapshot.generator, -20);
    if (source.includes('wp-content/') || source.includes('wp-includes/'))
      add('wordpress', 'WordPress assets', 'wp-content or wp-includes in markup', -15);
    const points = signals.reduce((sum, s) => sum + s.weight, 0);
    const value = score(points);
    const builders = signals.filter(s => s.builder).sort((a, b) => b.weight - a.weight);
    return { url: snapshot.url, title: snapshot.title, score: value,
      label: value >= 70 ? 'Likely AI-built' : value >= 40 ? 'Possibly vibe coded' : 'No strong AI signs',
      builder: builders[0]?.builder || null, signals,
      scope: 'Local builder fingerprints and hosting. Not the full desktop detector.' };
  }
  globalThis.KitsuvoDetector = { analyze, builderHost, score, sensitive, contains };
})();
