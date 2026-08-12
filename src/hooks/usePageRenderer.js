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
 * A generation counter invalidates in-flight writes after clearCache()
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
  const parts = String(key).split('::');
  return parseInt(parts[parts.length - 2], 10);
}

function cacheEntryUsable(cached) {
  if (!cached) return false;
  if (cached.bitmap) {
    try {
      if (cached.bitmap.width === 0 && cached.bitmap.height === 0) return false;
    } catch {
      return false;
    }
    return true;
  }
  return !!(cached.canvas && cached.canvas.width > 1 && cached.canvas.height > 1);
}

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

/** WebKit can silently refuse large allocations — verify size stuck. */
function allocCanvasSize(canvas, width, height) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  canvas.width = w;
  canvas.height = h;
  return canvas.width === w && canvas.height === h;
}

function paintCachedToCanvas(cached, canvas, viewport, containerWidth, containerHeight) {
  if (!allocCanvasSize(canvas, viewport.width, viewport.height)) {
    // Retry at half resolution once (iOS memory pressure).
    const ok = allocCanvasSize(canvas, viewport.width * 0.5, viewport.height * 0.5);
    if (!ok) return false;
  }
  canvas.style.width = `${containerWidth}px`;
  canvas.style.height = `${containerHeight}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  try {
    if (cached.bitmap) {
      ctx.drawImage(cached.bitmap, 0, 0, canvas.width, canvas.height);
    } else if (cached.canvas) {
      ctx.drawImage(cached.canvas, 0, 0, canvas.width, canvas.height);
    } else {
      return false;
    }
  } catch {
    return false;
  }
  return canvas.width > 1 && canvas.height > 1;
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
    if (!page || !canvas) return false;

    const pageNum = page.pageNumber;
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

    // Up to 2 attempts: wait-for-inflight may leave no usable cache (cancelled
    // during UG↔PG switch) — fall through and render ourselves instead of
    // returning with a blank canvas.
    for (let attempt = 0; attempt < 2; attempt++) {
      const generationAtStart = cacheGeneration;

      const cached = cacheRef.current.get(cacheKey);
      if (cacheEntryUsable(cached)) {
        if (paintCachedToCanvas(cached, canvas, viewport, containerWidth, containerHeight)) {
          markCanvasLive(pageNum);
          return true;
        }
        // Paint failed (closed bitmap / alloc) — drop entry and continue.
        try {
          cached.bitmap?.close?.();
        } catch {
          /* ignore */
        }
        if (cached.canvas) releaseCanvasElement(cached.canvas);
        cacheRef.current.delete(cacheKey);
      } else if (cached) {
        try {
          cached.bitmap?.close?.();
        } catch {
          /* ignore */
        }
        if (cached.canvas) releaseCanvasElement(cached.canvas);
        cacheRef.current.delete(cacheKey);
      }

      const existing = inflightRenders.get(cacheKey);
      if (existing) {
        try {
          await existing;
        } catch {
          /* owner logged failure */
        }
        if (generationAtStart !== cacheGeneration) return false;
        const ready = cacheRef.current.get(cacheKey);
        if (cacheEntryUsable(ready)) {
          if (paintCachedToCanvas(ready, canvas, viewport, containerWidth, containerHeight)) {
            markCanvasLive(pageNum);
            return true;
          }
        }
        // No usable cache after wait — loop and become the renderer.
        continue;
      }

      let resolveInflight;
      let rejectInflight;
      const inflightPromise = new Promise((resolve, reject) => {
        resolveInflight = resolve;
        rejectInflight = reject;
      });
      inflightPromise.catch(() => {});
      inflightRenders.set(cacheKey, inflightPromise);

      let tempCanvas = null;
      try {
        tempCanvas = document.createElement('canvas');
        if (!allocCanvasSize(tempCanvas, viewport.width, viewport.height)) {
          // Half-res fallback under memory pressure
          if (!allocCanvasSize(tempCanvas, viewport.width * 0.5, viewport.height * 0.5)) {
            resolveInflight();
            return false;
          }
        }
        const ctx = tempCanvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Match pdf.js viewport to the canvas we actually allocated
        const scaleForAlloc =
          (tempCanvas.width / unscaledViewport.width);
        const paintViewport =
          Math.abs(scaleForAlloc - renderScale) > 0.01
            ? page.getViewport({ scale: scaleForAlloc })
            : viewport;

        const renderTask = page.render({
          canvasContext: ctx,
          viewport: paintViewport,
          background: 'rgb(255,255,255)',
        });
        trackRenderTask(pdfSrc, pageNum, renderTask);
        try {
          await renderTask.promise;
        } finally {
          untrackRenderTask(pdfSrc, pageNum, renderTask);
        }

        if (generationAtStart !== cacheGeneration) {
          resolveInflight();
          return false;
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
          return false;
        }

        let canvasCopy = null;
        if (!bitmap) {
          canvasCopy = document.createElement('canvas');
          allocCanvasSize(canvasCopy, tempCanvas.width, tempCanvas.height);
          canvasCopy.getContext('2d', { alpha: false }).drawImage(tempCanvas, 0, 0);
        }

        const entry = {
          bitmap,
          canvas: canvasCopy,
          scale: renderScale,
          pdfSrc,
        };
        cacheRef.current.set(cacheKey, entry);

        let painted = false;
        if (canvas.isConnected !== false) {
          painted = paintCachedToCanvas(
            entry,
            canvas,
            // Use allocated temp size as the source viewport for draw sizing
            { width: tempCanvas.width, height: tempCanvas.height },
            containerWidth,
            containerHeight
          );
          if (painted) markCanvasLive(pageNum);
        }
        resolveInflight();
        return painted;
      } catch (err) {
        rejectInflight(err);
        if (err?.name !== 'RenderingCancelledException') {
          console.error(`[usePageRenderer] Error rendering page ${pageNum}:`, err);
        }
        return false;
      } finally {
        inflightRenders.delete(cacheKey);
        if (tempCanvas) releaseCanvasElement(tempCanvas);
      }
    }

    return false;
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
