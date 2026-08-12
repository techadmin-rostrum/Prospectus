/**
 * Shared in-memory PDF document cache.
 * Landing-page warm → Flipbook handoff only. Documents must NOT survive Flipbook
 * unmount on iOS — reusing a PDFDocumentProxy after the viewer tears down its
 * renders leaves blank canvases on the next open (seen as UG→PG→UG white).
 */
const cache = new Map();

export function getCachedPdf(url) {
  return cache.get(url) || null;
}

export function setCachedPdf(url, doc) {
  if (!url || !doc) return;
  const prev = cache.get(url);
  if (prev && prev !== doc) {
    try {
      prev.destroy?.();
    } catch {
      /* ignore */
    }
  }
  cache.set(url, doc);
}

export function peekCachedPdf(url) {
  return cache.has(url);
}

/**
 * Drop and destroy a cached document. Call when leaving the Flipbook so the
 * next visit always gets a fresh getDocument() (HTTP cache still helps).
 */
export function destroyCachedPdf(url) {
  if (!url) return;
  const doc = cache.get(url);
  cache.delete(url);
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
