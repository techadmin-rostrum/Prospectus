import { describeError, reportClientError } from './clientErrorLog';

/** Pages with a non-released (large) DOM canvas backing store. */
const livePages = new Set();

/**
 * In-flight pdf.js RenderTasks keyed by `${pdfSrc}::${pageNum}` so UG/PG
 * page 1 never cancel each other across a fast book switch.
 */
const activeRenderTasks = new Map();

let releaseLogAt = 0;
const RELEASE_LOG_INTERVAL_MS = 4000;

export function renderTaskKey(pdfSrc, pageNum) {
  return `${pdfSrc || ''}::${pageNum}`;
}

export function getLiveCanvasCount() {
  return livePages.size;
}

export function markCanvasLive(pageNum) {
  if (pageNum != null) livePages.add(pageNum);
}

export function markCanvasReleased(pageNum) {
  if (pageNum != null) livePages.delete(pageNum);
}

export function trackRenderTask(pdfSrc, pageNum, task) {
  if (pageNum == null || !task) return;
  activeRenderTasks.set(renderTaskKey(pdfSrc, pageNum), task);
}

export function untrackRenderTask(pdfSrc, pageNum, task) {
  if (pageNum == null) return;
  const key = renderTaskKey(pdfSrc, pageNum);
  if (activeRenderTasks.get(key) === task) {
    activeRenderTasks.delete(key);
  }
}

/** Cancel any in-flight pdf.js render for this page before freeing the canvas. */
export function cancelPageRender(pdfSrc, pageNum) {
  const key = renderTaskKey(pdfSrc, pageNum);
  const task = activeRenderTasks.get(key);
  if (!task) return;
  try {
    task.cancel();
  } catch {
    /* ignore */
  }
  activeRenderTasks.delete(key);
}

/** Cancel every in-flight render (document switch / full cache clear). */
export function cancelAllPageRenders() {
  for (const task of activeRenderTasks.values()) {
    try {
      task.cancel();
    } catch {
      /* ignore */
    }
  }
  activeRenderTasks.clear();
}

/** Drop live-page bookkeeping when leaving a flipbook. */
export function resetLiveCanvasTracking() {
  livePages.clear();
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
 * Free DOM canvas backing store + cancel any in-flight render for this page.
 *
 * Intentionally does NOT call pdfPage.cleanup(). That API frees worker image/font
 * objects, but with documents kept alive in pdfCache across UG↔PG switches it
 * left pages unable to paint on reopen (white flipbook). Canvas 1×1 + bitmap
 * cache eviction is enough for the iOS memory ceiling; page.cleanup remains a
 * last-resort if liveCanvasCount stays flat but sessions still die after hours.
 */
export function releasePageResources({ canvas, pageNum, pdfSrc } = {}) {
  cancelPageRender(pdfSrc, pageNum);
  releaseCanvasElement(canvas);
  markCanvasReleased(pageNum);
  logCanvasReleased(pageNum, { pageCleanupRan: null });
}

function canvasTelemetryExtras(pageNum, extra = {}) {
  return {
    pageNum,
    devicePixelRatio:
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : null,
    liveCanvasCount: getLiveCanvasCount(),
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : '',
    ...deviceCapabilities(),
    ...extra,
  };
}

/** Enough to tell one failing iPhone apart from a working one in the logs. */
function deviceCapabilities() {
  if (typeof window === 'undefined') return {};
  return {
    screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    deviceMemory: navigator.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    hasCreateImageBitmap: typeof window.createImageBitmap === 'function',
    hasOffscreenCanvas: typeof window.OffscreenCanvas === 'function',
    hasWasm: typeof WebAssembly === 'object',
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
 * WebKit hands back a null 2D context once the process-wide canvas budget is
 * gone. Report it as its own event so it is distinguishable from a pdf.js fault.
 */
export function logCanvasContextUnavailable(fields) {
  reportClientError({
    title: 'Canvas 2D context unavailable',
    message: JSON.stringify({
      kind: 'canvas_context_unavailable',
      ...fields,
      ...canvasTelemetryExtras(fields.pageNum),
    }),
  });
}

/** Render reported success paths but the canvas has no pixels. */
export function logPageBlank(fields) {
  reportClientError({
    title: 'Page stayed blank',
    message: JSON.stringify({
      kind: 'page_blank',
      ...fields,
      ...canvasTelemetryExtras(fields.pageNum),
    }),
  });
}

/** One-shot notice that the session dropped to a lower resolution budget. */
export function logRenderDegraded(fields) {
  reportClientError({
    title: 'Render degraded to low resolution',
    message: JSON.stringify({
      kind: 'render_degraded',
      ...fields,
      ...canvasTelemetryExtras(fields.pageNum),
    }),
  });
}

export function logPageRenderError(err, fields) {
  reportClientError({
    title: 'Page render failed',
    message: JSON.stringify({
      kind: 'page_render_error',
      error: describeError(err),
      errorName: err?.name || '',
      ...fields,
      ...canvasTelemetryExtras(fields.pageNum),
    }),
    stack: err?.stack,
  });
}

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
