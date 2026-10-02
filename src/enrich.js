import { readFileSync } from 'node:fs';
import { compile, detect, extractSignals } from './detect.js';
import { fetchPage } from './fetch.js';
import { extractPage, mergePages, pickContactPages, SOCIAL_NETWORKS } from './extract.js';

const dataFile = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const db = compile(dataFile('technologies.json'), dataFile('categories.json'));

/** Enriches one website: homepage + a few contact/about pages → one company record. */
export async function enrich(url, opts) {
  const home = await fetchPage(url, { timeoutMs: opts.timeoutMs });
  if (home.status >= 400) throw Object.assign(new Error(`HTTP ${home.status}`), { name: `HTTP_${home.status}` });
  const homePage = extractPage(home.html, home.finalUrl);
  const extraUrls = pickContactPages(homePage.links, home.finalUrl, opts.maxPages - 1);
  const extra = (
    await Promise.all(
      extraUrls.map(u =>
        fetchPage(u, { timeoutMs: opts.timeoutMs })
          .then(p => (p.status < 400 && p.html ? { url: p.finalUrl, ...extractPage(p.html, p.finalUrl) } : null))
          .catch(() => null),
      ),
    )
  ).filter(Boolean);
  const pages = [homePage, ...extra];
  const { emails, phones, socials } = mergePages(pages, home.finalUrl);
  const company = { ...homePage.company, address: homePage.company.address ?? extra.find(p => p.company.address)?.company.address ?? null };

  let technologies = [];
  if (opts.includeTechnologies) {
    technologies = detect(extractSignals({ url: home.finalUrl, headers: home.headers, cookies: home.cookies, html: home.html }), db)
      .filter(t => t.confidence >= opts.minConfidence)
      .map(t => ({ name: t.name, version: t.version, categories: t.categories }));
  }
  const byCategory = {};
  for (const t of technologies) for (const c of t.categories.length ? t.categories : ['Other']) (byCategory[c] ??= []).push(t.name);

  return {
    url,
    domain: new URL(home.finalUrl).hostname.replace(/^www\./, ''),
    finalUrl: home.finalUrl,
    statusCode: home.status,
    companyName: company.name,
    description: company.description,
    // Flat "first" fields make CSV/Excel exports and CRM imports easy.
    email: emails[0] ?? null,
    phone: phones[0] ?? null,
    ...Object.fromEntries(SOCIAL_NETWORKS.map(n => [n, socials[n]?.[0] ?? null])),
    emails,
    phones,
    socials,
    logo: company.logo,
    favicon: company.favicon,
    image: company.image,
    language: company.language,
    address: company.address,
    technologies: technologies.map(t => t.name),
    technologyDetails: technologies,
    byCategory,
    pagesVisited: [home.finalUrl, ...extra.map(p => p.url)],
    error: null,
  };
}
