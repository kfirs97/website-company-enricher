/** Fetches a page like a regular browser would, following redirects, with a timeout and size cap. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const MAX_BYTES = 5 * 1024 * 1024;

export function normalizeUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) ? null : u.toString();
  } catch {
    return null;
  }
}

/** Rejects if `promise` doesn't settle within `ms` (a hard stop even if the network layer ignores aborts). */
export function withDeadline(promise, ms, label = 'deadline') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(label), { name: 'TimeoutError' })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function fetchPage(url, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await withDeadline(fetchInner(url, controller.signal), timeoutMs + 2000, 'TimeoutError');
  } finally {
    clearTimeout(timer);
    controller.abort(); // release the connection if it's still open
  }
}

async function fetchInner(url, signal) {
  const started = Date.now();
  const res = await fetch(url, {
    redirect: 'follow',
    signal,
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' },
  });
  const headers = Object.fromEntries(res.headers.entries());
  const cookies = {};
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  let html = '';
  const type = res.headers.get('content-type') ?? '';
  if (/html|xml|text\/plain/i.test(type) || !type) {
    const reader = res.body?.getReader();
    const chunks = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      chunks.push(value);
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
  }
  return { finalUrl: res.url, status: res.status, headers, cookies, html, ms: Date.now() - started };
}
