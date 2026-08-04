/**
 * Speculatively open a prospectus so clicking through feels instant.
 *
 * This used to be a `<link rel="prefetch" as="fetch">`, which pulled the whole
 * 27–36 MB file — bytes pdf.js then couldn't reuse, because it fetches the
 * document through Range requests. Opening it through pdf.js instead warms the
 * exact same cache the viewer reads from, and only pulls the first-page ranges.
 */
import { getCachedPdf, setCachedPdf } from './pdfCache';

const inFlight = new Set();

/** Skip speculative work on metered or very slow connections. */
function shouldWarm() {
  const conn = navigator.connection;
  if (!conn) return true;
  if (conn.saveData) return false;
  return !['slow-2g', '2g'].includes(conn.effectiveType);
}

export async function warmPdf(pdfSrc) {
  if (!pdfSrc || getCachedPdf(pdfSrc) || inFlight.has(pdfSrc)) return;
  if (!shouldWarm()) return;

  inFlight.add(pdfSrc);
  try {
    const [pdfjsLib, { PDF_LOAD_OPTIONS }] = await Promise.all([
      import('pdfjs-dist'),
      import('../hooks/usePdfDocument'),
    ]);

    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs-dist/build/pdf.worker.min.mjs';

    const doc = await pdfjsLib.getDocument({ url: pdfSrc, ...PDF_LOAD_OPTIONS }).promise;
    setCachedPdf(pdfSrc, doc);
  } catch {
    // Warming is best-effort — the viewer will just load it normally.
  } finally {
    inFlight.delete(pdfSrc);
  }
}
