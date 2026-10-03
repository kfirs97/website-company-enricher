import { Actor, log } from 'apify';
import { normalizeUrl } from './fetch.js';
import { enrich } from './enrich.js';

await Actor.main(async () => {
  const input = (await Actor.getInput()) ?? {};
  const urls = [...new Set((input.urls ?? []).map(u => (typeof u === 'string' ? u : u?.url)).map(normalizeUrl).filter(Boolean))];
  if (!urls.length) throw new Error('Provide at least one website in "urls", e.g. "example.com".');
  const opts = {
    maxPages: Math.max(1, Math.min(10, input.maxPagesPerSite ?? 4)),
    timeoutMs: Math.max(5, Math.min(60, input.timeoutSecs ?? 20)) * 1000,
    includeTechnologies: input.includeTechnologies !== false,
    minConfidence: Math.max(0, Math.min(100, input.minConfidence ?? 50)),
  };
  const concurrency = Math.max(1, Math.min(20, input.maxConcurrency ?? 10));
  log.info(`Enriching ${urls.length} website(s), up to ${opts.maxPages} page(s) each, concurrency ${concurrency}`);

  let next = 0;
  let limitReached = false;
  let done = 0;
  const worker = async () => {
    while (next < urls.length && !limitReached) {
      const url = urls[next++];
      let record;
      try {
        record = await enrich(url, opts);
      } catch (e) {
        record = { url, domain: null, finalUrl: null, statusCode: null, companyName: null, emails: [], phones: [], socials: {}, technologies: [], error: String(e?.cause?.code ?? e?.name ?? e) };
      }
      await Actor.pushData(record);
      // Charge only for websites that were actually reached and analyzed.
      if (!record.error) {
        const { eventChargeLimitReached } = await Actor.charge({ eventName: 'website-enriched' });
        // The user's spending cap is reached: stop instead of processing websites they can't be charged for.
        if (eventChargeLimitReached && !limitReached) {
          limitReached = true;
          log.warning('Maximum charge for this run reached — stopping. Raise "Max cost per run" to process the remaining websites.');
        }
      }
      if (++done % 25 === 0) log.info(`Progress: ${done}/${urls.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  log.info(`Done: ${done} website(s) processed.`);
});
