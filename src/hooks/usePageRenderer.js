import { useRef, useCallback } from 'react';

/**
 * Hook for rendering PDF pages to canvas with high-DPI support and caching.
 * 
 * Implements a "render on demand + cache" strategy:
 * - Renders pages at devicePixelRatio scale for retina crispness
 * - Caches rendered bitmaps to avoid re-rendering
 * - Evicts pages outside a ±4 window to prevent OOM
 * - Supports re-rendering at higher scale for zoom
 */
const globalCache = new Map();
const globalRendering = new Set();

export function usePageRenderer() {
  // Use global cache to share across all PageCanvas instances
  const cacheRef = useRef(globalCache);
  const renderingRef = useRef(globalRendering);

  /**
   * Render a PDF page onto a canvas element at the specified scale.
   * Uses devicePixelRatio for HiDPI rendering.
   * 
   * @param {PDFPageProxy} page - PDF.js page object
   * @param {HTMLCanvasElement} canvas - Target canvas element
   * @param {number} containerWidth - Desired display width in CSS pixels
   * @param {number} containerHeight - Desired display height in CSS pixels  
   * @param {number} [extraScale=1] - Additional scale multiplier (for zoom)
   * @returns {Promise<void>}
   */
  const renderPageToCanvas = useCallback(async (page, canvas, containerWidth, containerHeight, extraScale = 1) => {
    if (!page || !canvas) return;

    const pageNum = page.pageNumber;
    const dpr = window.devicePixelRatio || 1;

    // Calculate the viewport scale to fit the page within the container
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scaleX = containerWidth / unscaledViewport.width;
    const scaleY = containerHeight / unscaledViewport.height;
    const baseScale = Math.min(scaleX, scaleY);

    // Final render scale: base fit × DPR × any extra zoom
    const renderScale = baseScale * dpr * extraScale;
    const cacheKey = `${pageNum}-${renderScale.toFixed(2)}`;

    // Check if already rendering this exact configuration
    if (renderingRef.current.has(cacheKey)) return;

    // Check cache
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      // Draw cached bitmap to canvas
      const viewport = page.getViewport({ scale: renderScale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${containerHeight}px`;

      const ctx = canvas.getContext('2d');
      if (cached.bitmap) {
        ctx.drawImage(cached.bitmap, 0, 0);
      }
      return;
    }

      renderingRef.current.add(cacheKey);

      try {
        const viewport = page.getViewport({ scale: renderScale });
        
        // Render to an offscreen/temp canvas first so we don't clear the visible canvas
        // while the slow rendering process happens (prevents flashing blank/blurry).
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        const ctx = tempCanvas.getContext('2d', { alpha: false });

        await page.render({
          canvasContext: ctx,
          viewport,
        }).promise;

        let bitmap = null;
        try {
          bitmap = await createImageBitmap(tempCanvas);
        } catch {
          // Fallback if ImageBitmap is not supported
        }

        cacheRef.current.set(cacheKey, { bitmap, scale: renderScale });

        // Now draw to the real canvas
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${containerWidth}px`;
        canvas.style.height = `${containerHeight}px`;
        
        const realCtx = canvas.getContext('2d', { alpha: false });
        if (bitmap) {
          realCtx.drawImage(bitmap, 0, 0);
        } else {
          realCtx.drawImage(tempCanvas, 0, 0);
        }
      } catch (err) {
        if (err.name !== 'RenderingCancelledException') {
          console.error(`[usePageRenderer] Error rendering page ${pageNum}:`, err);
        }
      } finally {
        renderingRef.current.delete(cacheKey);
      }
  }, []);

  /**
   * Evict cache entries for pages outside the active window.
   * Call this when the current page changes.
   * 
   * @param {number} currentPage - Currently displayed page number
   * @param {number} windowSize - Number of pages to keep on each side (default: 4)
   */
  const evictCache = useCallback((currentPage, windowSize = 4) => {
    const cache = cacheRef.current;
    for (const [key, value] of cache.entries()) {
      const pageNum = parseInt(key.split('-')[0], 10);
      if (Math.abs(pageNum - currentPage) > windowSize) {
        if (value.bitmap) {
          value.bitmap.close(); // Free ImageBitmap memory
        }
        cache.delete(key);
      }
    }
  }, []);

  /**
   * Clear the entire cache (e.g., when PDF source changes).
   */
  const clearCache = useCallback(() => {
    const cache = cacheRef.current;
    for (const [, value] of cache.entries()) {
      if (value.bitmap) {
        value.bitmap.close();
      }
    }
    cache.clear();
  }, []);

  return { renderPageToCanvas, evictCache, clearCache };
}
