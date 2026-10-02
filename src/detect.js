/**
 * Technology detection engine for the webappanalyzer/Wappalyzer fingerprint format.
 * Works on data from a single HTTP response: URL, headers, cookies and HTML (parsed with cheerio).
 *
 * Pattern syntax: "regex\\;version:\\1\\;confidence:50" — the regex is case-insensitive, `version`
 * may reference capture groups (\1) and ternaries (\1?yes:no), `confidence` defaults to 100.
 */
import * as cheerio from 'cheerio';

const toArray = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

export function parsePattern(raw) {
  const [regexSource, ...attrs] = String(raw).split('\\;');
  const pattern = { regex: null, version: '', confidence: 100 };
  for (const attr of attrs) {
    const i = attr.indexOf(':');
    const key = attr.slice(0, i);
    const value = attr.slice(i + 1);
    if (key === 'confidence') pattern.confidence = Number(value) || 0;
    else if (key === 'version') pattern.version = value;
  }
  try {
    pattern.regex = new RegExp(regexSource, 'i');
  } catch {
    pattern.regex = null;
  }
  return pattern;
}

/** Resolves a version template against a regex match. */
export function resolveVersion(template, match) {
  if (!template || !match) return '';
  let out = template.replace(/\\(\d)\?([^:]*):(.*)$/, (_, n, yes, no) => (match[Number(n)] ? yes : no));
  out = out.replace(/\\(\d)/g, (_, n) => match[Number(n)] ?? '');
  out = out.trim();
  return /^[\w.\-+ ]{1,40}$/.test(out) ? out : '';
}

/** Pre-compiles a technologies map once; detection then runs many sites quickly. */
export function compile(technologies, categories) {
  const compiled = [];
  const byName = new Map();
  const patterns = v => toArray(v).map(parsePattern).filter(p => p.regex);
  const keyed = obj => Object.entries(obj ?? {}).map(([key, v]) => ({ key: key.toLowerCase(), patterns: patterns(v) }));
  for (const [name, t] of Object.entries(technologies)) {
    const dom = [];
    if (typeof t.dom === 'string' || Array.isArray(t.dom)) toArray(t.dom).forEach(sel => dom.push({ selector: sel, exists: true }));
    else if (t.dom && typeof t.dom === 'object') {
      for (const [selector, spec] of Object.entries(t.dom)) {
        dom.push({
          selector,
          exists: 'exists' in spec,
          text: spec.text !== undefined ? patterns(spec.text) : null,
          attributes: spec.attributes ? keyed(spec.attributes) : null,
        });
      }
    }
    const entry = {
      name,
      cats: t.cats ?? [],
      website: t.website,
      icon: t.icon,
      description: t.description,
      url: patterns(t.url),
      html: patterns(t.html),
      text: patterns(t.text),
      scriptSrc: patterns(t.scriptSrc),
      scripts: patterns(t.scripts),
      headers: keyed(t.headers),
      cookies: keyed(t.cookies),
      meta: keyed(t.meta),
      dom,
      js: Object.keys(t.js ?? {}),
      implies: toArray(t.implies),
      requires: toArray(t.requires),
      requiresCategory: toArray(t.requiresCategory),
      excludes: toArray(t.excludes),
    };
    compiled.push(entry);
    byName.set(name, entry);
  }
  const categoryNames = new Map(Object.entries(categories).map(([id, c]) => [Number(id), c.name]));
  return { compiled, byName, categoryNames };
}

/** Extracts everything detection needs from one HTTP response. */
export function extractSignals({ url, headers = {}, cookies = {}, html = '' }) {
  const $ = cheerio.load(html);
  const meta = {};
  $('meta').each((_, el) => {
    const key = ($(el).attr('name') || $(el).attr('property') || $(el).attr('http-equiv') || '').toLowerCase();
    const content = $(el).attr('content');
    if (key && content !== undefined) (meta[key] ??= []).push(content);
  });
  const scriptSrc = $('script[src]').map((_, el) => $(el).attr('src')).get();
  const scripts = $('script:not([src])').map((_, el) => $(el).html() || '').get();
  const lowerHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const lowerCookies = Object.fromEntries(Object.entries(cookies).map(([k, v]) => [k.toLowerCase(), String(v)]));
  // Visible text is only needed for "text" patterns; keep it bounded.
  const text = $('body').text().replace(/\s+/g, ' ').slice(0, 200_000);
  return { url, html: html.slice(0, 2_000_000), $, meta, scriptSrc, scripts, headers: lowerHeaders, cookies: lowerCookies, text };
}

function matchAll(patternList, values, hit) {
  for (const p of patternList) {
    for (const value of values) {
      const m = p.regex.exec(value);
      if (m) {
        hit(p, m);
        break;
      }
    }
  }
}

function matchKeyed(list, source, hit) {
  for (const { key, patterns } of list) {
    if (!(key in source)) continue;
    const values = toArray(source[key]);
    // A header/cookie/meta with an empty pattern means "present".
    if (patterns.length === 0) hit({ confidence: 100, version: '' }, null);
    else matchAll(patterns, values, hit);
  }
}

/**
 * Detects technologies from extracted signals.
 * Returns [{ name, version, confidence, categories, website, icon, description }] sorted by category then name.
 */
export function detect(signals, db) {
  const found = new Map(); // name -> { confidence, version }
  const add = (tech, pattern, match) => {
    const prev = found.get(tech.name) ?? { confidence: 0, version: '' };
    const version = resolveVersion(pattern.version, match);
    found.set(tech.name, {
      confidence: Math.min(100, prev.confidence + (pattern.confidence ?? 100)),
      version: prev.version.length >= version.length ? prev.version : version,
    });
  };
  const inlineJs = signals.scripts.join('\n').slice(0, 2_000_000);
  // Global names declared by inline scripts, collected once (checking per technology with regexes is far too slow).
  const declared = new Set();
  for (const m of inlineJs.matchAll(/(?:window\.|\bvar\s+|\blet\s+|\bconst\s+)([A-Za-z_$][\w$]{4,})/g)) declared.add(m[1]);

  for (const tech of db.compiled) {
    const hit = (p, m) => add(tech, p, m);
    matchAll(tech.url, [signals.url], hit);
    matchAll(tech.html, [signals.html], hit);
    matchAll(tech.text, [signals.text], hit);
    matchAll(tech.scriptSrc, signals.scriptSrc, hit);
    matchAll(tech.scripts, [inlineJs], hit);
    matchKeyed(tech.headers, signals.headers, hit);
    matchKeyed(tech.cookies, signals.cookies, hit);
    matchKeyed(tech.meta, signals.meta, hit);
    for (const d of tech.dom) {
      let els;
      try {
        els = signals.$(d.selector);
      } catch {
        continue; // selector syntax cheerio doesn't support
      }
      if (!els.length) continue;
      if (d.exists) hit({ confidence: 100, version: '' }, null);
      if (d.text) matchAll(d.text, [els.first().text()], hit);
      if (d.attributes) {
        for (const { key, patterns } of d.attributes) {
          const values = els.map((_, el) => signals.$(el).attr(key)).get().filter(v => v !== undefined);
          if (values.length) patterns.length ? matchAll(patterns, values, hit) : hit({ confidence: 100, version: '' }, null);
        }
      }
    }
    // Global JS variables can't be evaluated without a browser; a declaration in inline code is a weaker signal.
    if (tech.js.some(global => declared.has(global.split('.')[0]))) hit({ confidence: 50, version: '' }, null);
  }

  resolveRelations(found, db);

  return [...found.entries()]
    .filter(([, f]) => f.confidence >= 50)
    .map(([name, f]) => {
      const t = db.byName.get(name);
      return {
        name,
        version: f.version || null,
        confidence: f.confidence,
        categories: t.cats.map(id => db.categoryNames.get(id)).filter(Boolean),
        website: t.website ?? null,
        icon: t.icon ? `https://raw.githubusercontent.com/enthec/webappanalyzer/main/src/images/icons/${encodeURIComponent(t.icon)}` : null,
        description: t.description ?? null,
      };
    })
    .sort((a, b) => (a.categories[0] ?? '~').localeCompare(b.categories[0] ?? '~') || a.name.localeCompare(b.name));
}

/** Applies implies (with "\\;confidence:"), requires, requiresCategory and excludes until stable. */
function resolveRelations(found, db) {
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const [name, f] of [...found]) {
      const t = db.byName.get(name);
      for (const raw of t?.implies ?? []) {
        const p = parsePattern(raw);
        const implied = String(raw).split('\\;')[0];
        if (!db.byName.has(implied)) continue;
        const confidence = Math.min(f.confidence, p.confidence);
        const prev = found.get(implied);
        if (!prev || prev.confidence < confidence) {
          found.set(implied, { confidence, version: prev?.version ?? '' });
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const cats = () => new Set([...found.keys()].flatMap(n => db.byName.get(n)?.cats ?? []));
  for (const [name] of [...found]) {
    const t = db.byName.get(name);
    if (t.requires.length && !t.requires.some(r => found.has(r))) found.delete(name);
    else if (t.requiresCategory.length && !t.requiresCategory.some(c => cats().has(Number(c)))) found.delete(name);
  }
  for (const [name] of [...found]) {
    for (const ex of db.byName.get(name)?.excludes ?? []) if (ex !== name) found.delete(ex);
  }
}
