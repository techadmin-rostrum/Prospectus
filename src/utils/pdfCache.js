/**
 * Tracks the Flipbook's current PDFDocumentProxy for teardown only.
 * Never used to reopen a previous visit (that caused iOS blank/wrong-book bugs).
 */
let current = null;

export function setCachedPdf(url, doc) {
  if (!url || !doc) return;
  current = { url, doc };
}

export function getCachedPdf(url) {
  if (!current || current.url !== url) return null;
  return current.doc;
}

export function peekCachedPdf(url) {
  return !!(current && current.url === url);
}

export function destroyCachedPdf(url) {
  if (!current) return null;
  if (url && current.url !== url) return null;
  const doc = current.doc;
  current = null;
  return doc; // caller should closePdfDocument(doc)
}

export function destroyAllCachedPdfs() {
  const doc = current?.doc || null;
  current = null;
  return doc;
}
