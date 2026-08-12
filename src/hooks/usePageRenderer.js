import { useRef, useCallback, useEffect } from 'react';
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
import { registerPageRendererReset } from '../utils/resetFlipbookRuntime';

/**
 * Cache keys include pdfSrc AND a per-mount sessionId so a previous book's
 * in-flight render can never paint into the next visit's canvases.
 */

export const MAX_CANVAS_PIXELS = 16_000_000;

const globalCache = new Map();
const inflightRenders = new Map();
let cacheGeneration = 0;
const capHitLogged = new Set();

function wipePageRendererState() {
  cacheGeneration += 1;
  cancelAllPageRenders();
  resetLiveCanvasTracking();
  inflightRenders.clear();
  for (const [, value] of globalCache.entries()) {
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
  globalCache.clear();
}

registerPageRendererReset(wipePageRendererState);

function makeCacheKey(sessionId, pdfSrc, pageNum, renderScale) {
  return `${sessionId || ''}::${pdfSrc || ''}::${pageNum}::${renderScale.toFixed(2)}`;
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

function allocCanvasSize(canvas, width, height) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  canvas.width = w;
  canvas.height = h;
  return canvas.width === w && canvas.height === h;
}

function paintCachedToCanvas(cached, canvas, viewport, containerWidth, containerHeight) {
  if (!allocCanvasSize(canvas, viewport.width, viewport.height)) {
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

  useEffect(() => {
    registerPageRendererReset(wipePageRendererState);
  }, []);

  const renderPageToCanvas = useCallback(async (
    page,
    canvas,
    containerWidth,
    containerHeight,
    extraScale = 1,
    pdfSrc = '',
    sessionId = ''
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
      const key = `${sessionId}:${pdfSrc}:${pageNum}:${Math.round(rawPixels)}`;
      if (!capHitLogged.has(key)) {
        capHitLogged.add(key);
        logCanvasPixelCap({
          pageNum,
          pdfSrc,
          sessionId,
          rawPixels: Math.round(rawPixels),
          safePixels: Math.round(viewport.width * viewport.height),
          maxCanvasPixels: MAX_CANVAS_PIXELS,
          desiredScale: Number(desiredScale.toFixed(4)),
          safeScale: Number(renderScale.toFixed(4)),
          liveCanvasCount: getLiveCanvasCount(),
        });
      }
    }

    const cacheKey = makeCacheKey(sessionId, pdfSrc, pageNum, renderScale);

    for (let attempt = 0; attempt < 2; attempt++) {
      const generationAtStart = cacheGeneration;

      const cached = cacheRef.current.get(cacheKey);
      if (
        cacheEntryUsable(cached) &&
        cached.pdfSrc === pdfSrc &&
        cached.sessionId === sessionId
      ) {
        if (paintCachedToCanvas(cached, canvas, viewport, containerWidth, containerHeight)) {
          markCanvasLive(pageNum);
          return true;
        }
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
          /* ignore */
        }
        if (generationAtStart !== cacheGeneration) return false;
        const ready = cacheRef.current.get(cacheKey);
        if (
          cacheEntryUsable(ready) &&
          ready.pdfSrc === pdfSrc &&
          ready.sessionId === sessionId
        ) {
          if (paintCachedToCanvas(ready, canvas, viewport, containerWidth, containerHeight)) {
            markCanvasLive(pageNum);
            return true;
          }
        }
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
          if (!allocCanvasSize(tempCanvas, viewport.width * 0.5, viewport.height * 0.5)) {
            resolveInflight();
            return false;
          }
        }
        const ctx = tempCanvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        const scaleForAlloc = tempCanvas.width / unscaledViewport.width;
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
          /* ignore */
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
          sessionId,
        };
        cacheRef.current.set(cacheKey, entry);

        let painted = false;
        if (canvas.isConnected !== false) {
          painted = paintCachedToCanvas(
            entry,
            canvas,
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

  const evictCache = useCallback((currentPage, windowSize = 4, pdfSrc = '', sessionId = '') => {
    const cache = cacheRef.current;
    for (const [key, value] of cache.entries()) {
      if (sessionId && value.sessionId && value.sessionId !== sessionId) continue;
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
    wipePageRendererState();
  }, []);

  return { renderPageToCanvas, evictCache, clearCache };
}
