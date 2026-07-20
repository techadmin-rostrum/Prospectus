import React, { useRef, useEffect, memo } from 'react';
import { usePageRenderer } from '../hooks/usePageRenderer';

const PageCanvas = React.forwardRef(function PageCanvas(
  { pageNum, pdfDocument, width, height, extraScale = 1, priority = false, shouldRender = true },
  ref
) {
  const canvasRef = useRef(null);
  const { renderPageToCanvas } = usePageRenderer();
  const renderTaskRef = useRef(null);

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
  }, [pdfDocument, pageNum, width, height, extraScale, renderPageToCanvas, priority]);

  return (
    <div
      ref={ref}
      className="page-canvas"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: `${width}px`,
          height: `${height}px`,
        }}
      />
    </div>
  );
});

export default memo(PageCanvas);