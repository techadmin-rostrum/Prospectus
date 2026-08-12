import { useRef, useCallback } from 'react';
import {
  cancelAllPageRenders,
  getLiveCanvasCount,
  logCanvasPixelCap,
  markCanvasLive,
  releaseCanvasElement,
  resetLiveCanvasTracking,
  trackRenderTask,
  untrackRenderTask,
} from '../utils/canvasMemory';

/**
 * Hook for rendering PDF pages to canvas with high-DPI support and caching.
 *
 * Cache keys ALWAYS include pdfSrc so UG/PG never share bitmaps.
 * A generation counter invalidates in-flight renders after clearCache()
 * (stops a late UG paint from repopulating the cache after you open PG).
 */

/** Safety margin under WebKit's 16,777,216 hard canvas-pixel ceiling. */
export const MAX_CANVAS_PIXELS = 16_000_000;

const globalCache = new Map();
/** cacheKey → Promise that resolves when that render finishes (success or fail). */
const inflightRenders = new Map();
/** Bumped on every clearCache — in-flight work must not write after a bump. */
let cacheGeneration = 0;
const capHitLogged = new Set();

function makeCacheKey(pdfSrc, pageNum, renderScale) {
  return `${pdfSrc || ''}::${pageNum}::${renderScale.toFixed(2)}`;
}

function pageNumFromCacheKey(key) {
  // `${pdfSrc}::${pageNum}::${scale}` — pageNum is the second-to-last segment
  const parts = String(key).split('::');
  return parseInt(parts[parts.length - 2], 10);
}

function cacheEntryUsable(cached) {
  if (!cached) return false;
  if (cached.bitmap) {
    // Closed ImageBitmaps throw / no-op on draw — treat as miss.
    try {
      if (cached.bitmap.width === 0 && cached.bitmap.height === 0) return false;
    } catch {
      return false;
    }
    return true;
  }
  return !!(cached.canvas && cached.canvas.width > 1 && cached.canvas.height > 1);
}

/**
 * Fit `desiredScale` so width×height of the PDF viewport stays under MAX_CANVAS_PIXELS.
 */
export function clampRenderScale(page, desiredScale) {
  let scale = desiredScale;
  let viewport = page.getViewport({ scale });
  const rawPixels = viewport.width * viewport.height;

  if (rawPixels <= MAX_CANVAS_PIXELS || rawPixels <= 0) {
    return { scale, viewport, rawPixels, capped: false };
  }

  scale = desiredScale * Math.sqrt(MAX_CANVAS_PIXELS / rawPixels);
  viewport = page.getViewport({ scale });
  return { scale, viewport, rawPixels, capped: true };
}

function paintCachedToCanvas(cached, canvas, viewport, containerWidth, containerHeight) {
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${containerWidth}px`;
  canvas.style.height = `${containerHeight}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (cached.bitmap) {
    ctx.drawImage(cached.bitmap, 0, 0);
  } else if (cached.canvas) {
    ctx.drawImage(cached.canvas, 0, 0);
  }
}

export function usePageRenderer() {
  const cacheRef = useRef(globalCache);

  const renderPageToCanvas = useCallback(async (
    page,
    canvas,
    containerWidth,
    containerHeight,
    extraScale = 1,
    pdfSrc = ''
  ) => {
    if (!page || !canvas) return;

    const pageNum = page.pageNumber;
    const generationAtStart = cacheGeneration;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const unscaledViewport = page.getViewport({ scale: 1 });
    const scaleX = containerWidth / unscaledViewport.width;
    const scaleY = containerHeight / unscaledViewport.height;
    const baseScale = Math.min(scaleX, scaleY);

    const desiredScale = baseScale * dpr * extraScale;
    const { scale: renderScale, viewport, rawPixels, capped } = clampRenderScale(
      page,
      desiredScale
    );

    if (capped) {
      const key = `${pdfSrc}:${pageNum}:${Math.round(rawPixels)}`;
      if (!capHitLogged.has(key)) {
        capHitLogged.add(key);
        logCanvasPixelCap({
          pageNum,
          pdfSrc,
          rawPixels: Math.round(rawPixels),
          safePixels: Math.round(viewport.width * viewport.height),
          maxCanvasPixels: MAX_CANVAS_PIXELS,
          desiredScale: Number(desiredScale.toFixed(4)),
          safeScale: Number(renderScale.toFixed(4)),
          liveCanvasCount: getLiveCanvasCount(),
        });
      }
    }

    const cacheKey = makeCacheKey(pdfSrc, pageNum, renderScale);

    // Cache hit — paint this canvas (don't no-op just because another render runs)
    const cached = cacheRef.current.get(cacheKey);
    if (cacheEntryUsable(cached)) {
      paintCachedToCanvas(cached, canvas, viewport, containerWidth, containerHeight);
      markCanvasLive(pageNum);
      return;
    }
    if (cached) {
      // Stale/closed entry — drop and re-render
      try {
        cached.bitmap?.close?.();
      } catch {
        /* ignore */
      }
      if (cached.canvas) releaseCanvasElement(cached.canvas);
      cacheRef.current.delete(cacheKey);
    }

    // Another caller already rendering this key: wait, then paint FROM CACHE
    // onto *this* canvas. The old early `return` left the second canvas blank.
    const existing = inflightRenders.get(cacheKey);
    if (existing) {
      try {
        await existing;
      } catch {
        /* render failure handled by owner */
      }
      if (generationAtStart !== cacheGeneration) return;
      const ready = cacheRef.current.get(cacheKey);
      if (cacheEntryUsable(ready) && canvas.isConnected !== false) {
        paintCachedToCanvas(ready, canvas, viewport, containerWidth, containerHeight);
        markCanvasLive(pageNum);
      }
      return;
    }

    let resolveInflight;
    let rejectInflight;
    const inflightPromise = new Promise((resolve, reject) => {
      resolveInflight = resolve;
      rejectInflight = reject;
    });
    // Prevent unhandled rejection if nobody awaits failure
    inflightPromise.catch(() => {});
    inflightRenders.set(cacheKey, inflightPromise);

    let tempCanvas = null;
    try {
      tempCanvas = document.createElement('canvas');
      tempCanvas.width = viewport.width;
      tempCanvas.height = viewport.height;
      const ctx = tempCanvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
        background: 'rgb(255,255,255)',
      });
      trackRenderTask(pdfSrc, pageNum, renderTask);
      try {
        await renderTask.promise;
      } finally {
        untrackRenderTask(pdfSrc, pageNum, renderTask);
      }

      // Document switched / cache cleared while we were rendering — discard.
      if (generationAtStart !== cacheGeneration) {
        resolveInflight();
        return;
      }

      let bitmap = null;
      try {
        bitmap = await createImageBitmap(tempCanvas);
      } catch {
        /* ImageBitmap unavailable */
      }

      if (generationAtStart !== cacheGeneration) {
        try {
          bitmap?.close?.();
        } catch {
          /* ignore */
        }
        resolveInflight();
        return;
      }

      let canvasCopy = null;
      if (!bitmap) {
        canvasCopy = document.createElement('canvas');
        canvasCopy.width = tempCanvas.width;
        canvasCopy.height = tempCanvas.height;
        canvasCopy.getContext('2d', { alpha: false }).drawImage(tempCanvas, 0, 0);
      }

      cacheRef.current.set(cacheKey, {
        bitmap,
        canvas: canvasCopy,
        scale: renderScale,
        pdfSrc,
      });

      // Only paint if this canvas is still in the document
      if (canvas.isConnected !== false) {
        paintCachedToCanvas(
          { bitmap, canvas: canvasCopy },
          canvas,
          viewport,
          containerWidth,
          containerHeight
        );
        markCanvasLive(pageNum);
      }
      resolveInflight();
    } catch (err) {
      rejectInflight(err);
      if (err.name !== 'RenderingCancelledException') {
        console.error(`[usePageRenderer] Error rendering page ${pageNum}:`, err);
      }
    } finally {
      inflightRenders.delete(cacheKey);
      if (tempCanvas) releaseCanvasElement(tempCanvas);
    }
  }, []);

  const evictCache = useCallback((currentPage, windowSize = 4, pdfSrc = '') => {
    const cache = cacheRef.current;
    for (const [key, value] of cache.entries()) {
      if (pdfSrc && value.pdfSrc && value.pdfSrc !== pdfSrc) continue;
      const pageNum = pageNumFromCacheKey(key);
      if (!Number.isFinite(pageNum)) continue;
      if (Math.abs(pageNum - currentPage) > windowSize) {
        try {
          value.bitmap?.close?.();
        } catch {
          /* ignore */
        }
        if (value.canvas) {
          releaseCanvasElement(value.canvas);
          value.canvas = null;
        }
        cache.delete(key);
      }
    }
  }, []);

  /**
   * Clear the entire bitmap cache and invalidate in-flight renders.
   * Call on Flipbook unmount AND whenever pdfSrc changes.
   */
  const clearCache = useCallback(() => {
    cacheGeneration += 1;
    cancelAllPageRenders();
    resetLiveCanvasTracking();
    inflightRenders.clear();

    const cache = cacheRef.current;
    for (const [, value] of cache.entries()) {
      try {
        value.bitmap?.close?.();
      } catch {
        /* ignore */
      }
      if (value.canvas) {
        releaseCanvasElement(value.canvas);
        value.canvas = null;
      }
    }
    cache.clear();
  }, []);

  return { renderPageToCanvas, evictCache, clearCache };
}
