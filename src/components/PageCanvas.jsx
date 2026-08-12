import React, { useRef, useEffect, useContext, memo } from 'react';
import { usePageRenderer } from '../hooks/usePageRenderer';
import { PageWindowContext } from './PageWindowContext';
import { releasePageResources } from '../utils/canvasMemory';

/** Paint live pixels inside this radius of the current page. */
const RENDER_RADIUS = 3;
/**
 * Hysteresis band: keep backing store until the page leaves ±HOLD_RADIUS.
 * Stops release→immediate-realloc churn when flipping near the window edge.
 */
const HOLD_RADIUS = 4;
/** After a release, wait before reallocating — WebKit reclaim is not sync. */
const REENTER_DELAY_MS = 80;

function inWindow(currentPage, pageIndex, numPages, radius) {
  return (
    Math.abs(currentPage - pageIndex) <= radius ||
    (currentPage === 0 && pageIndex <= radius) ||
    (numPages > 0 &&
      currentPage >= numPages - radius &&
      pageIndex >= numPages - 1 - radius)
  );
}

const PageCanvas = React.forwardRef(function PageCanvas(
  {
    pageNum,
    numPages = 0,
    pdfDocument,
    width,
    height,
    extraScale = 1,
  },
  ref
) {
  const canvasRef = useRef(null);
  const { renderPageToCanvas } = usePageRenderer();
  const renderTaskRef = useRef(null);
  const lastReleaseAtRef = useRef(0);
  const releaseGenRef = useRef(0);
  const pageProxyRef = useRef(null);
  const isHardCover = pageNum === 1 || (numPages > 0 && pageNum === numPages);

  // Read the window here rather than take it as a prop — see PageWindowContext.
  const currentPage = useContext(PageWindowContext);
  const i = pageNum - 1;
  const priority =
    Math.abs(currentPage - i) <= 1 ||
    (currentPage === 0 && i <= 1) ||
    (numPages > 0 && currentPage >= numPages - 2 && i >= numPages - 2);

  // Live paint window (±3). All PageCanvas nodes stay mounted (react-pageflip
  // requires a stable children list).
  const shouldRender = inWindow(currentPage, i, numPages, RENDER_RADIUS);
  // Wider hold window (±4): only release once outside this band.
  const shouldHold = inWindow(currentPage, i, numPages, HOLD_RADIUS);

  // Release only after leaving the hold band — never in the same tick as a
  // shouldRender re-entry from the inner edge of the paint window.
  useEffect(() => {
    if (shouldHold) return;

    if (renderTaskRef.current) {
      clearTimeout(renderTaskRef.current);
      renderTaskRef.current = null;
    }

    releasePageResources({
      canvas: canvasRef.current,
      pageNum,
      pdfPage: pageProxyRef.current,
    });
    pageProxyRef.current = null;
    lastReleaseAtRef.current =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    releaseGenRef.current += 1;
  }, [shouldHold, pageNum]);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || !width || !height || !shouldRender) {
      return;
    }

    let cancelled = false;
    const genAtSchedule = releaseGenRef.current;

    const render = async () => {
      // If a release just ran, wait so WebKit can reclaim before we realloc.
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = now - lastReleaseAtRef.current;
      const wait = Math.max(0, REENTER_DELAY_MS - elapsed);
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }
      if (cancelled || genAtSchedule !== releaseGenRef.current) return;
      if (!canvasRef.current) return;

      try {
        const page = await pdfDocument.getPage(pageNum);
        if (cancelled || genAtSchedule !== releaseGenRef.current) return;
        pageProxyRef.current = page;
        await renderPageToCanvas(page, canvasRef.current, width, height, extraScale);
      } catch (err) {
        if (!cancelled && err.name !== 'RenderingCancelledException') {
          console.error(`[PageCanvas] Failed to render page ${pageNum}:`, err);
        }
      }
    };

    if (renderTaskRef.current) {
      clearTimeout(renderTaskRef.current);
    }
    // Priority pages still go first, but never sooner than the re-enter delay
    // path inside `render` after a recent release.
    renderTaskRef.current = setTimeout(render, priority ? 0 : 16);

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        clearTimeout(renderTaskRef.current);
        renderTaskRef.current = null;
      }
    };
  }, [pdfDocument, pageNum, width, height, extraScale, renderPageToCanvas, priority, shouldRender]);

  // With showCover: page 1 = cover; then even = left leaf, odd = right leaf
  const isLeftPage = pageNum > 1 && pageNum % 2 === 0;
  const isRightPage = pageNum > 1 && pageNum % 2 === 1;
  const sideClass = isLeftPage
    ? 'page-canvas--left'
    : isRightPage
      ? 'page-canvas--right'
      : '';

  return (
    <div
      ref={ref}
      className={`page-canvas ${isHardCover ? 'page-canvas--hard' : 'page-canvas--soft'} ${sideClass}`.trim()}
      data-density={isHardCover ? 'hard' : 'soft'}
      data-page={pageNum}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        overflow: 'hidden',
        background: '#ffffff',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: `${width}px`,
          height: `${height}px`,
          background: '#ffffff',
        }}
      />
    </div>
  );
});

export default memo(PageCanvas);
