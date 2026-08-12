/**
 * PDFDocumentProxy cache — short-lived only.
 * Prefer destroy-on-leave; do not hand documents across Flipbook sessions.
 */
const cache = new Map();

export function getCachedPdf(url) {
  const entry = cache.get(url);
  if (!entry) return null;
  // Guard against accidental cross-wiring of URL → doc
  if (entry.url !== url) {
    cache.delete(url);
    return null;
  }
  return entry.doc;
}

export function setCachedPdf(url, doc) {
  if (!url || !doc) return;
  const prev = cache.get(url);
  if (prev?.doc && prev.doc !== doc) {
    try {
      prev.doc.destroy?.();
    } catch {
      /* ignore */
    }
  }
  cache.set(url, { url, doc });
}

export function peekCachedPdf(url) {
  return cache.has(url);
}

export function destroyCachedPdf(url) {
  if (!url) return;
  const entry = cache.get(url);
  cache.delete(url);
  const doc = entry?.doc;
  if (!doc) return;
  try {
    doc.cleanup?.();
  } catch {
    /* ignore */
  }
  try {
    doc.destroy?.();
  } catch {
    /* ignore */
  }
}

export function destroyAllCachedPdfs() {
  for (const url of [...cache.keys()]) {
    destroyCachedPdf(url);
  }
}
