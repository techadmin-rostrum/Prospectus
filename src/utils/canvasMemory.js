import { reportClientError } from './clientErrorLog';

/** Pages with a non-released (large) DOM canvas backing store. */
const livePages = new Set();

/** In-flight pdf.js RenderTasks keyed by page number — cancelled on release. */
const activeRenderTasks = new Map();

let releaseLogAt = 0;
const RELEASE_LOG_INTERVAL_MS = 4000;

/** Delay before retrying page.cleanup() when the first call returns false. */
const CLEANUP_RETRY_MS = 50;

export function getLiveCanvasCount() {
  return livePages.size;
}

export function markCanvasLive(pageNum) {
  if (pageNum != null) livePages.add(pageNum);
}

export function markCanvasReleased(pageNum) {
  if (pageNum != null) livePages.delete(pageNum);
}

export function trackRenderTask(pageNum, task) {
  if (pageNum == null || !task) return;
  activeRenderTasks.set(pageNum, task);
}

export function untrackRenderTask(pageNum, task) {
  if (pageNum == null) return;
  if (activeRenderTasks.get(pageNum) === task) {
    activeRenderTasks.delete(pageNum);
  }
}

/** Cancel any in-flight pdf.js render for this page before freeing the canvas. */
export function cancelPageRender(pageNum) {
  const task = activeRenderTasks.get(pageNum);
  if (!task) return;
  try {
    task.cancel();
  } catch {
    /* ignore */
  }
  activeRenderTasks.delete(pageNum);
}

/**
 * WebKit does not reliably reclaim canvas GPU memory via GC.
 * 1×1 + clearRect is the durable pattern (0×0 is inconsistent across Safari builds).
 */
export function releaseCanvasElement(canvas) {
  if (!canvas) return;
  try {
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, 1, 1);
  } catch {
    /* ignore */
  }
}

/**
 * Attempt PDFPageProxy.cleanup() (pdfjs-dist 6.1.200).
 * Returns true if cleanup ran, false if deferred/no-op, null if no proxy.
 *
 * NOTE: This frees image/font objects for the page, but does NOT remove the
 * page proxy from the document transport's #pageCache / #pagePromises — only
 * doc.destroy() does that. Proxy metadata is tiny (KB); canvas memory is the
 * real budget. If liveCanvasCount stays flat but a very long session still
 * degrades, that residual pageCache is the next place to look.
 */
function tryPageCleanup(pdfPage) {
  if (!pdfPage || typeof pdfPage.cleanup !== 'function') return null;
  try {
    return !!pdfPage.cleanup();
  } catch {
    return false;
  }
}

/**
 * Free DOM canvas + cancel worker render + drop pdf.js page operator/cache
 * resources (PDFPageProxy.cleanup in pdfjs-dist 6.1.200).
 */
export function releasePageResources({ canvas, pageNum, pdfPage } = {}) {
  cancelPageRender(pageNum);
  releaseCanvasElement(canvas);

  // DOM canvas is shrunk regardless — check cleanup() so logs can tell apart
  // "canvas released cleanly" vs "canvas shrunk but worker cleanup skipped".
  let pageCleanupRan = tryPageCleanup(pdfPage);

  if (pageCleanupRan === false && pdfPage) {
    const capturedPage = pdfPage;
    const capturedNum = pageNum;
    setTimeout(() => {
      const retried = tryPageCleanup(capturedPage);
      if (retried) return;
      // Still skipped after retry — distinct beacon (not conflated with clean release)
      logCanvasCleanupSkipped(capturedNum, { retried: true });
    }, CLEANUP_RETRY_MS);
  }

  markCanvasReleased(pageNum);
  logCanvasReleased(pageNum, { pageCleanupRan });
}

function canvasTelemetryExtras(pageNum, extra = {}) {
  return {
    pageNum,
    devicePixelRatio:
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : null,
    liveCanvasCount: getLiveCanvasCount(),
    // UA is also attached by reportClientError — duplicated in message for
    // easy JSON grepping in Vercel logs.
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : '',
    ...extra,
  };
}

export function logCanvasPixelCap(fields) {
  reportClientError({
    title: 'Canvas pixel cap applied',
    message: JSON.stringify({
      kind: 'canvas_pixel_cap',
      ...fields,
      ...canvasTelemetryExtras(fields.pageNum),
    }),
  });
}

/**
 * Throttled clean-path release beacon.
 * `pageCleanupRan`: true | false | null (null = no page proxy on release).
 */
export function logCanvasReleased(pageNum, { pageCleanupRan } = {}) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - releaseLogAt < RELEASE_LOG_INTERVAL_MS) return;
  releaseLogAt = now;

  reportClientError({
    title: 'Canvas released',
    message: JSON.stringify({
      kind: 'canvas_released',
      ...canvasTelemetryExtras(pageNum, { pageCleanupRan }),
    }),
  });
}

/**
 * Always logged (not throttled with clean releases): canvas was shrunk but
 * PDFPageProxy.cleanup() returned false even after one deferred retry.
 */
export function logCanvasCleanupSkipped(pageNum, { retried = false } = {}) {
  reportClientError({
    title: 'Canvas cleanup skipped',
    message: JSON.stringify({
      kind: 'canvas_cleanup_skipped',
      retried,
      ...canvasTelemetryExtras(pageNum, { pageCleanupRan: false }),
    }),
  });
}
