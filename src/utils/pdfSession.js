/**
 * Legacy build, not the default modern one. pdf.js 6 calls very new stdlib APIs
 * (e.g. Map.prototype.getOrInsertComputed inside page.render) that iOS Safari
 * below 18.4 lacks, which threw "getOrInsertComputed is not a function" on every
 * page. Only the legacy bundles carry the polyfills. Main thread and worker each
 * need their own copy — a worker has a separate global scope.
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  '/pdfjs-dist/legacy/build/pdf.worker.min.mjs';

export const PDF_LOAD_OPTIONS = {
  cMapUrl: '/pdfjs-dist/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs-dist/standard_fonts/',
  wasmUrl: '/pdfjs-dist/wasm/',
  iccUrl: '/pdfjs-dist/iccs/',
  enableXfa: true,
  disableStream: false,
  disableRange: false,
  disableAutoFetch: true,
  rangeChunkSize: 131072,
};

/**
 * One-at-a-time gate: never getDocument() while another doc/worker is still
 * destroying. Shared-worker teardown races were painting UG pages into PG
 * (and vice versa) on iPhone after a single switch.
 */
let sessionGate = Promise.resolve();

function enqueue(fn) {
  const run = sessionGate.then(fn);
  sessionGate = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Open a PDF on an isolated PDFWorker bound to this url only.
 * @returns {{ doc: PDFDocumentProxy, worker: PDFWorker, loadingTask: PDFDocumentLoadingTask }}
 */
export function openPdfDocument(pdfSrc, { onProgress } = {}) {
  let cancelled = false;
  let loadingTask = null;
  let worker = null;

  const promise = enqueue(async () => {
    if (cancelled) return null;

    worker = pdfjsLib.PDFWorker.create({
      name: `flipbook:${pdfSrc}:${Math.random().toString(36).slice(2, 8)}`,
    });

    loadingTask = pdfjsLib.getDocument({
      url: pdfSrc,
      ...PDF_LOAD_OPTIONS,
      worker,
    });

    if (onProgress) {
      loadingTask.onProgress = onProgress;
    }

    try {
      const doc = await loadingTask.promise;
      if (cancelled) {
        await safeDestroyDoc(doc, worker);
        return null;
      }
      // Identity stamp — PageCanvas refuses to paint if this doesn't match pdfSrc
      doc.__flipbookSrc = pdfSrc;
      doc.__flipbookWorker = worker;
      return { doc, worker, loadingTask };
    } catch (err) {
      await safeDestroyDoc(null, worker);
      worker = null;
      if (cancelled) return null;
      throw err;
    }
  });

  return {
    promise,
    cancel() {
      cancelled = true;
      try {
        loadingTask?.destroy?.();
      } catch {
        /* ignore */
      }
    },
  };
}

async function safeDestroyDoc(doc, worker) {
  try {
    if (doc) await Promise.resolve(doc.destroy?.());
  } catch {
    /* ignore */
  }
  try {
    worker?.destroy?.();
  } catch {
    /* ignore */
  }
}

/** Destroy a session doc + its private worker, serialized on the gate. */
export function closePdfDocument(doc) {
  if (!doc) return Promise.resolve();
  const worker = doc.__flipbookWorker || null;
  doc.__flipbookWorker = null;
  return enqueue(() => safeDestroyDoc(doc, worker));
}

export function assertDocMatchesSrc(doc, pdfSrc) {
  if (!doc || !pdfSrc) return false;
  const stamp = doc.__flipbookSrc;
  if (stamp && stamp !== pdfSrc) {
    console.error(
      `[flipbook] PDF mismatch: canvas wants ${pdfSrc} but doc is ${stamp}`
    );
    return false;
  }
  return true;
}
