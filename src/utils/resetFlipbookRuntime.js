import {
  cancelAllPageRenders,
  resetLiveCanvasTracking,
} from './canvasMemory';

/** Registered by usePageRenderer so we can wipe its module Maps without cycles. */
let pageRendererReset = null;

export function registerPageRendererReset(fn) {
  pageRendererReset = fn;
}

/** Call on every Flipbook mount/unmount — drops cross-book bitmap/render state. */
export function resetFlipbookRuntime() {
  cancelAllPageRenders();
  resetLiveCanvasTracking();
  try {
    pageRendererReset?.();
  } catch {
    /* ignore */
  }
}
