/**
 * Speculative warm for a prospectus.
 *
 * IMPORTANT: Do NOT open the file through pdf.js here. Concurrent getDocument()
 * calls on the shared worker (landing warm + Flipbook load, or UG + PG) can
 * cross-wire page streams on iOS — after enough UG↔PG switches the wrong book
 * paints. We only touch the HTTP cache via a Range fetch; Flipbook always owns
 * getDocument().
 */
const inFlight = new Set();

function shouldWarm() {
  const conn = navigator.connection;
  if (!conn) return true;
  if (conn.saveData) return false;
  return !['slow-2g', '2g'].includes(conn.effectiveType);
}

export async function warmPdf(pdfSrc) {
  if (!pdfSrc || inFlight.has(pdfSrc)) return;
  if (!shouldWarm()) return;

  inFlight.add(pdfSrc);
  try {
    // Linearized header + first object stream — enough for a fast first paint
    // once Flipbook calls getDocument (browser/CDN reuses these bytes).
    await fetch(pdfSrc, {
      method: 'GET',
      headers: { Range: 'bytes=0-262143' },
      credentials: 'same-origin',
    });
  } catch {
    // Best-effort only
  } finally {
    inFlight.delete(pdfSrc);
  }
}
