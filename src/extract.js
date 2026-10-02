import * as cheerio from 'cheerio';

/** Domains that appear in example/placeholder addresses or third-party tooling, never a company's real contact. */
const JUNK_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yourcompany\.com|company\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|sentry\.wixpress\.com|godaddy\.com|test\.com|mysite\.com|website\.com|address\.com)$/i;
const FILE_TLD = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|js|mjs|css|map|json|woff2?|ttf|eot|mp4|webm|pdf)$/i;
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi;

export function cleanEmail(raw) {
  let e = String(raw ?? '').trim().toLowerCase();
  try {
    e = decodeURIComponent(e);
  } catch {}
  e = e.replace(/^mailto:/, '').split('?')[0].trim().replace(/^[.\-_]+|[.\-_]+$/g, '');
  const m = /^([a-z0-9][a-z0-9._%+-]{0,63})@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})$/.exec(e);
  if (!m) return null;
  const [, local, domain] = m;
  if (FILE_TLD.test(e) || JUNK_EMAIL_DOMAINS.test(domain)) return null;
  if (/^[0-9a-f]{24,}$/.test(local)) return null; // tracking/error-reporting keys
  if (/(^|\.)(png|jpe?g|gif|svg|webp)$/.test(domain.split('.').slice(0, -1).join('.'))) return null; // logo@2x.png.example
  return e;
}

/** Cloudflare "email protection" obfuscation: hex string XOR-ed with its first byte. */
export function decodeCfEmail(hex) {
  if (!/^[0-9a-f]{4,}$/i.test(hex ?? '')) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** "name [at] company [dot] com" and similar human obfuscations. */
function deobfuscate(text) {
  return text
    .replace(/\s*(\[|\(|\{)\s*at\s*(\]|\)|\})\s*/gi, '@')
    .replace(/\s+at\s+(?=[a-z0-9-]+\s*(\[|\(|\{)\s*dot\s*(\]|\)|\}))/gi, '@')
    .replace(/\s*(\[|\(|\{)\s*dot\s*(\]|\)|\})\s*/gi, '.');
}

export function normalizePhone(raw) {
  let s = String(raw ?? '').trim();
  try {
    s = decodeURIComponent(s);
  } catch {}
  s = s.replace(/^tel:/i, '').replace(/^callto:/i, '').split(/[;,?]/)[0].trim();
  const plus = s.startsWith('+') || s.startsWith('00');
  const digits = s.replace(/\D/g, '').replace(/^00/, '');
  if (digits.length < 7 || digits.length > 15 || /^(\d)\1+$/.test(digits)) return null;
  return (plus ? '+' : '') + digits;
}

/** Social profile patterns. Each returns a canonical profile URL, or null for share/intent/post links. */
const SOCIAL = {
  linkedin: u => {
    const m = /^(?:[a-z]{2,3}\.)?linkedin\.com$/.test(u.host) && /^\/(company|in|school|showcase)\/([^/?#]+)/i.exec(u.pathname);
    return m ? `https://www.linkedin.com/${m[1].toLowerCase()}/${m[2]}` : null;
  },
  twitter: u => {
    const m = /^(mobile\.)?(twitter|x)\.com$/.test(u.host) && /^\/@?([A-Za-z0-9_]{1,15})\/?$/.exec(u.pathname);
    return m && !/^(intent|share|home|search|hashtag|i|login|signup|explore|settings|privacy|tos)$/i.test(m[1]) ? `https://x.com/${m[1]}` : null;
  },
  facebook: u => {
    if (!/^([a-z-]+\.)?facebook\.com$/.test(u.host) && u.host !== 'fb.com' && u.host !== 'fb.me') return null;
    if (/^\/profile\.php/.test(u.pathname) && u.searchParams.get('id')) return `https://www.facebook.com/profile.php?id=${u.searchParams.get('id')}`;
    const m = /^\/(?:pg\/)?([A-Za-z0-9.\-]{2,})\/?$/.exec(u.pathname);
    return m && !/^(sharer|share|dialog|plugins|tr|login|home\.php|watch|groups|events|policies|privacy|help|business|ads)/i.test(m[1]) ? `https://www.facebook.com/${m[1]}` : null;
  },
  instagram: u => {
    const m = /^instagram\.com$/.test(u.host) && /^\/([A-Za-z0-9._]{1,30})\/?$/.exec(u.pathname);
    return m && !/^(p|reel|reels|explore|stories|accounts|about|developer|legal)$/i.test(m[1]) ? `https://www.instagram.com/${m[1]}` : null;
  },
  youtube: u => {
    const m = /^(m\.)?youtube\.com$/.test(u.host) && /^\/((?:channel|c|user)\/[^/?#]+|@[^/?#]+)/.exec(u.pathname);
    return m ? `https://www.youtube.com/${m[1]}` : null;
  },
  tiktok: u => {
    const m = /^tiktok\.com$/.test(u.host) && /^\/@([^/?#]+)/.exec(u.pathname);
    return m ? `https://www.tiktok.com/@${m[1]}` : null;
  },
  pinterest: u => {
    const m = /^([a-z]{2}\.)?pinterest\.[a-z.]+$/.test(u.host) && /^\/([A-Za-z0-9_]{3,30})\/?$/.exec(u.pathname);
    return m && !/^(pin|search|ideas|today|business)$/i.test(m[1]) ? `https://www.pinterest.com/${m[1]}` : null;
  },
  github: u => {
    const m = /^github\.com$/.test(u.host) && /^\/([A-Za-z0-9-]{1,39})\/?$/.exec(u.pathname);
    return m && !/^(features|about|pricing|login|join|enterprise|sponsors|marketplace|topics|explore|security|site|contact)$/i.test(m[1]) ? `https://github.com/${m[1]}` : null;
  },
  discord: u => {
    const m = (/^discord\.gg$/.test(u.host) && /^\/([A-Za-z0-9-]+)/.exec(u.pathname)) || (/^discord(app)?\.com$/.test(u.host) && /^\/invite\/([A-Za-z0-9-]+)/.exec(u.pathname));
    return m ? `https://discord.gg/${m[1]}` : null;
  },
  telegram: u => {
    const m = /^(t\.me|telegram\.me)$/.test(u.host) && /^\/([A-Za-z0-9_+]{3,})\/?$/.exec(u.pathname);
    return m && m[1] !== 'share' ? `https://t.me/${m[1]}` : null;
  },
  whatsapp: u => {
    if (u.host === 'wa.me') {
      const m = /^\/(\d{7,15})/.exec(u.pathname);
      return m ? `https://wa.me/${m[1]}` : null;
    }
    const phone = /^(api|web)\.whatsapp\.com$/.test(u.host) && u.searchParams.get('phone')?.replace(/\D/g, '');
    return phone && phone.length >= 7 ? `https://wa.me/${phone}` : null;
  },
  threads: u => {
    const m = /^threads\.(net|com)$/.test(u.host) && /^\/@([^/?#]+)\/?$/.exec(u.pathname);
    return m ? `https://www.threads.net/@${m[1]}` : null;
  },
};
export const SOCIAL_NETWORKS = Object.keys(SOCIAL);

export function classifySocial(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.host = u.host.toLowerCase().replace(/^www\./, '');
  for (const [network, fn] of Object.entries(SOCIAL)) {
    const url = fn(u);
    if (url) return { network, url: url.replace(/\/+$/, '') };
  }
  return null;
}

/** All JSON-LD nodes on the page, flattened (@graph, arrays). */
function jsonLdNodes($) {
  const out = [];
  const walk = n => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    out.push(n);
    if (n['@graph']) walk(n['@graph']);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).text().trim()));
    } catch {}
  });
  return out;
}

const ORG_TYPE = /Organization|Corporation|LocalBusiness|Company|Store|Restaurant|Hotel|Agency|Service|Brand|NGO|School|Dentist|Physician|Attorney|LegalService|MedicalBusiness|ProfessionalService/i;
const types = n => [].concat(n['@type'] ?? []).join(' ');
const asUrl = v => (typeof v === 'string' ? v : v?.url ?? v?.['@id'] ?? v?.contentUrl ?? null);

function formatAddress(a) {
  if (!a) return null;
  if (typeof a === 'string') return a.trim() || null;
  const parts = [a.streetAddress, a.postalCode && a.addressLocality ? `${a.postalCode} ${a.addressLocality}` : a.addressLocality || a.postalCode, a.addressRegion, typeof a.addressCountry === 'object' ? a.addressCountry?.name : a.addressCountry];
  const s = parts.filter(Boolean).map(p => String(p).trim()).join(', ');
  return s || null;
}

const absolute = (href, base) => {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
};

/** Extracts contacts, socials and (from the homepage) company details from one HTML page. */
export function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const emails = new Set();
  const phones = new Set();
  const socials = {};
  const addSocial = href => {
    const s = classifySocial(href);
    if (s) (socials[s.network] ??= new Set()).add(s.url);
  };

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (/^mailto:/i.test(href)) {
      for (const part of href.replace(/^mailto:/i, '').split(/[,;]/)) {
        const e = cleanEmail(part);
        if (e) emails.add(e);
      }
    } else if (/^(tel|callto):/i.test(href)) {
      const p = normalizePhone(href);
      if (p) phones.add(p);
    } else {
      const abs = absolute(href, pageUrl);
      if (abs) addSocial(abs);
    }
  });
  $('[data-cfemail]').each((_, el) => {
    const e = cleanEmail(decodeCfEmail($(el).attr('data-cfemail')));
    if (e) emails.add(e);
  });
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
    const e = cleanEmail(decodeCfEmail(($(el).attr('href') ?? '').split('#')[1]));
    if (e) emails.add(e);
  });

  const ld = jsonLdNodes($);
  const org = ld.find(n => ORG_TYPE.test(types(n)) && n.name) ?? ld.find(n => ORG_TYPE.test(types(n)));
  for (const n of ld) {
    for (const s of [].concat(n.sameAs ?? [])) if (typeof s === 'string') addSocial(s);
    for (const e of [].concat(n.email ?? [])) {
      const c = cleanEmail(e);
      if (c) emails.add(c);
    }
    if (ORG_TYPE.test(types(n)) || types(n) === 'ContactPoint') {
      for (const t of [].concat(n.telephone ?? [])) {
        const p = normalizePhone(t);
        if (p) phones.add(p);
      }
    }
    for (const cp of [].concat(n.contactPoint ?? [])) {
      const p = normalizePhone(cp?.telephone);
      if (p) phones.add(p);
      const e = cleanEmail(cp?.email);
      if (e) emails.add(e);
    }
  }

  // Plain-text emails (also "name [at] domain [dot] com").
  $('script, style, noscript, svg').remove();
  // Join text nodes with spaces so "a@b.org" followed by "<b>to</b>" doesn't become "a@b.orgto".
  const text = deobfuscate(
    $('body *')
      .contents()
      .filter((_, n) => n.type === 'text')
      .map((_, n) => n.data)
      .get()
      .join(' ')
      .replace(/\s+/g, ' '),
  );
  for (const m of text.match(EMAIL_RE) ?? []) {
    const e = cleanEmail(m);
    if (e) emails.add(e);
  }

  const meta = name => $(`meta[property="${name}"], meta[name="${name}"]`).attr('content')?.trim() || null;
  const icon =
    $('link[rel~="apple-touch-icon"]').attr('href') ||
    $('link[rel~="icon"][sizes]').last().attr('href') ||
    $('link[rel~="icon"], link[rel="shortcut icon"]').attr('href') ||
    '/favicon.ico';
  const title = $('title').first().text().replace(/\s+/g, ' ').trim() || null;

  return {
    emails: [...emails],
    phones: [...phones],
    socials: Object.fromEntries(Object.entries(socials).map(([k, v]) => [k, [...v]])),
    company: {
      name: (typeof org?.name === 'string' && org.name.trim()) || pickName([meta('og:site_name'), meta('application-name')], title, pageUrl),
      description: meta('description') || meta('og:description') || (typeof org?.description === 'string' ? org.description.trim() : null),
      logo: absolute(asUrl(org?.logo) ?? asUrl(org?.image) ?? icon, pageUrl),
      favicon: absolute(icon, pageUrl),
      image: absolute(meta('og:image'), pageUrl),
      language: $('html').attr('lang')?.trim() || null,
      address: formatAddress(org?.address),
      title,
    },
    links: $('a[href]')
      .map((_, el) => ({ href: absolute($(el).attr('href'), pageUrl), text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 80) }))
      .get()
      .filter(l => l.href),
  };
}

const squash = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Does this name look like the brand behind the domain? ("Katz's Delicatessen" ↔ katzsdelicatessen.com) */
function matchesDomain(name, pageUrl) {
  const label = squash(new URL(pageUrl).hostname.replace(/^www\./, '').split('.')[0]);
  const n = squash(name);
  return n.length >= 3 && label.length >= 3 && (label.includes(n) || n.includes(label));
}

/** Prefers a meta/title candidate matching the domain; otherwise meta site name, then the title. */
function pickName(metaCandidates, title, pageUrl) {
  const metas = metaCandidates.filter(Boolean);
  const segments = titleSegments(title);
  return [...metas, ...segments].find(c => matchesDomain(c, pageUrl)) ?? metas[0] ?? nameFromTitle(title);
}

const titleSegments = title =>
  (title ?? '')
    .split(/\s+[|\-–—:·•]\s+/)
    .map(s => s.trim())
    .filter(p => p && !/^(home|homepage|welcome|official (site|website)|start|startseite|accueil|inicio)$/i.test(p));

/** "Acme Inc. | Home" → "Acme Inc." — picks the shortest title segment that isn't a generic word. */
export function nameFromTitle(title) {
  const good = titleSegments(title);
  if (!good.length) return null;
  return good.reduce((a, b) => (b.length < a.length ? b : a));
}

const CONTACT_WORDS = /contact|kontakt|contacto|contato|contatti|impressum|imprint|about|uber-uns|ueber-uns|über|a-propos|quienes-somos|chi-siamo|team|company|legal|support|reach|get-in-touch|locations|offices/i;

/** Picks the most promising same-site pages (contact, about, imprint, team…) to visit after the homepage. */
export function pickContactPages(links, homeUrl, max) {
  if (max <= 0) return [];
  const home = new URL(homeUrl);
  const site = home.hostname.replace(/^www\./, '');
  const scored = new Map();
  for (const { href, text } of links) {
    let u;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== site) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|mp4)$/i.test(u.pathname)) continue;
    if (/sign-?up|log-?in|sign-?in|register|cart|checkout|pricing|download|careers|jobs/i.test(u.pathname)) continue;
    u.hash = '';
    const key = u.toString();
    if (key === home.toString() || u.pathname === '/' ) continue;
    let score = 0;
    if (CONTACT_WORDS.test(u.pathname)) score += 2;
    if (CONTACT_WORDS.test(text)) score += 1;
    if (/contact|kontakt|contacto|contato|contatti|impressum|imprint/i.test(u.pathname + ' ' + text)) score += 2;
    score -= u.pathname.split('/').filter(Boolean).length * 0.2; // prefer top-level pages
    if (score > 1 && (scored.get(key) ?? -Infinity) < score) scored.set(key, score);
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

/** Merges per-page results into one company record; emails on the company's own domain come first. */
export function mergePages(pages, homeUrl) {
  const site = new URL(homeUrl).hostname.replace(/^www\./, '');
  const root = site.split('.').slice(-2).join('.');
  const emails = [...new Set(pages.flatMap(p => p.emails))];
  const own = e => e.endsWith(`@${site}`) || e.endsWith(`.${root}`) || e.endsWith(`@${root}`);
  // Company-domain first, then general inboxes (info@, contact@…), then personal/other addresses; stable otherwise.
  const generic = e => /^(info|contact|hello|hi|sales|office|enquiries|inquiries|team|mail|support|admin|kontakt|contacto|bonjour)@/.test(e);
  const rank = e => (own(e) ? 0 : 2) + (generic(e) ? 0 : 1);
  emails.sort((a, b) => rank(a) - rank(b));
  const socials = {};
  for (const p of pages) for (const [k, v] of Object.entries(p.socials)) socials[k] = [...new Set([...(socials[k] ?? []), ...v])];
  return { emails, phones: [...new Set(pages.flatMap(p => p.phones))], socials };
}
