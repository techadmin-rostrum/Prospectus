import React, { useRef, useEffect, memo } from 'react';
import { usePageRenderer } from '../hooks/usePageRenderer';

const PageCanvas = React.forwardRef(function PageCanvas(
  {
    pageNum,
    numPages = 0,
    pdfDocument,
    width,
    height,
    extraScale = 1,
    priority = false,
    shouldRender = true,
  },
  ref
) {
  const canvasRef = useRef(null);
  const { renderPageToCanvas } = usePageRenderer();
  const renderTaskRef = useRef(null);
  const isHardCover = pageNum === 1 || (numPages > 0 && pageNum === numPages);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || !width || !height || !shouldRender) return;

    let cancelled = false;

    const render = async () => {
      try {
        const page = await pdfDocument.getPage(pageNum);
        if (cancelled) return;
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
    renderTaskRef.current = setTimeout(render, priority ? 0 : 16);

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        clearTimeout(renderTaskRef.current);
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
        isolation: 'isolate',
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