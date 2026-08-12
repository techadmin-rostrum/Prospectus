import React, { useRef, useEffect, useContext, memo } from 'react';
import { usePageRenderer } from '../hooks/usePageRenderer';
import { PageWindowContext } from './PageWindowContext';
import { releasePageResources } from '../utils/canvasMemory';
import { assertDocMatchesSrc } from '../utils/pdfSession';

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
    pdfSrc = '',
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
  const isHardCover = pageNum === 1 || (numPages > 0 && pageNum === numPages);

  const currentPage = useContext(PageWindowContext);
  const i = pageNum - 1;
  const priority =
    Math.abs(currentPage - i) <= 1 ||
    (currentPage === 0 && i <= 1) ||
    (numPages > 0 && currentPage >= numPages - 2 && i >= numPages - 2);

  const shouldRender = inWindow(currentPage, i, numPages, RENDER_RADIUS);
  const shouldHold = inWindow(currentPage, i, numPages, HOLD_RADIUS);

  // Shrink off-window canvases (iOS memory). No pdfPage.cleanup() — that was
  // blanking pages after UG↔PG reopen of the cached document.
  useEffect(() => {
    if (shouldHold) return;

    if (renderTaskRef.current) {
      clearTimeout(renderTaskRef.current);
      renderTaskRef.current = null;
    }

    releasePageResources({
      canvas: canvasRef.current,
      pageNum,
      pdfSrc,
    });
    lastReleaseAtRef.current =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    releaseGenRef.current += 1;
  }, [shouldHold, pageNum, pdfSrc]);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || !width || !height || !shouldRender) {
      return;
    }

    let cancelled = false;
    const genAtSchedule = releaseGenRef.current;

    const render = async () => {
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
        if (!assertDocMatchesSrc(pdfDocument, pdfSrc)) return;

        const page = await pdfDocument.getPage(pageNum);
        if (cancelled || genAtSchedule !== releaseGenRef.current) return;
        if (!assertDocMatchesSrc(pdfDocument, pdfSrc)) return;

        let painted = await renderPageToCanvas(
          page,
          canvasRef.current,
          width,
          height,
          extraScale,
          pdfSrc
        );

        // One retry if we still have a released/empty canvas (switch race).
        if (
          !painted &&
          !cancelled &&
          genAtSchedule === releaseGenRef.current &&
          canvasRef.current &&
          canvasRef.current.width <= 1
        ) {
          await new Promise((r) => setTimeout(r, 50));
          if (cancelled || genAtSchedule !== releaseGenRef.current) return;
          painted = await renderPageToCanvas(
            page,
            canvasRef.current,
            width,
            height,
            extraScale,
            pdfSrc
          );
        }

        if (!painted && !cancelled) {
          console.warn(`[PageCanvas] Page ${pageNum} stayed blank after render`);
        }
      } catch (err) {
        if (!cancelled && err.name !== 'RenderingCancelledException') {
          console.error(`[PageCanvas] Failed to render page ${pageNum}:`, err);
        }
      }
    };

    if (renderTaskRef.current) {
      clearTimeout(renderTaskRef.current);
    }
    renderTaskRef.current = setTimeout(render, priority ? 0 : 16);

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        clearTimeout(renderTaskRef.current);
        renderTaskRef.current = null;
      }
    };
  }, [pdfDocument, pdfSrc, pageNum, width, height, extraScale, renderPageToCanvas, priority, shouldRender]);

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
