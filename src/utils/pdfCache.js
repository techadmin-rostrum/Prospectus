/**
 * Shared in-memory PDF document cache.
 * Lets the landing page hand off an already-opened doc to the Flipbook
 * (and survives remounts within the same session).
 */
const cache = new Map();

export function getCachedPdf(url) {
  return cache.get(url) || null;
}

export function setCachedPdf(url, doc) {
  if (!url || !doc) return;
  const prev = cache.get(url);
  if (prev && prev !== doc) {
    try { prev.destroy?.(); } catch { /* ignore */ }
  }
  cache.set(url, doc);
}

export function peekCachedPdf(url) {
  return cache.has(url);
}
