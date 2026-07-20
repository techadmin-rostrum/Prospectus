import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * ThumbnailStrip — Slide-up grid of PDF page thumbnails for quick navigation.
 * 
 * Lazy-renders thumbnails using IntersectionObserver — only renders
 * pages that are visible in the grid viewport.
 * 
 * @param {object} pdfDocument - PDF.js document proxy
 * @param {number} numPages - Total page count
 * @param {number} currentPage - Currently displayed page (0-indexed for StPageFlip)
 * @param {function} onPageSelect - Callback when a thumbnail is clicked
 * @param {boolean} isOpen - Whether the thumbnail panel is visible
 * @param {function} onClose - Callback to close the panel
 */
function ThumbnailStrip({ pdfDocument, numPages, currentPage, onPageSelect, isOpen, onClose }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 glass-strong rounded-t-2xl"
            style={{ maxHeight: '60vh' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
              <h3 className="text-lg font-semibold font-display text-text-primary">
                Page Navigator
              </h3>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors text-text-secondary hover:text-text-primary"
                aria-label="Close thumbnails"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Grid */}
            <div
              className="overflow-y-auto p-4"
              style={{ maxHeight: 'calc(60vh - 64px)' }}
            >
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                {Array.from({ length: numPages }, (_, i) => (
                  <ThumbnailItem
                    key={i}
                    pageNum={i + 1}
                    pdfDocument={pdfDocument}
                    isActive={i === currentPage}
                    onClick={() => {
                      onPageSelect(i);
                      onClose();
                    }}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Single thumbnail item — lazy-rendered via IntersectionObserver.
 */
const ThumbnailItem = memo(function ThumbnailItem({ pageNum, pdfDocument, isActive, onClick }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  // Intersection Observer for lazy rendering
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Render thumbnail when visible
  useEffect(() => {
    if (!isVisible || !pdfDocument || !canvasRef.current || rendered) return;

    let cancelled = false;

    const renderThumb = async () => {
      try {
        const page = await pdfDocument.getPage(pageNum);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 0.2 });
        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext('2d', { alpha: false });
        await page.render({ canvasContext: ctx, viewport }).promise;

        if (!cancelled) setRendered(true);
      } catch (err) {
        if (!cancelled) console.error(`[Thumbnail] Failed page ${pageNum}:`, err);
      }
    };

    renderThumb();
    return () => { cancelled = true; };
  }, [isVisible, pdfDocument, pageNum, rendered]);

  return (
    <button
      ref={containerRef}
      onClick={onClick}
      className={`
        relative group cursor-pointer rounded-lg overflow-hidden
        transition-all duration-200 
        ${isActive
          ? 'ring-2 ring-brand-red scale-105 shadow-lg'
          : 'ring-1 ring-border-subtle hover:ring-brand-blue hover:scale-102'
        }
      `}
      aria-label={`Go to page ${pageNum}`}
      style={{ aspectRatio: '0.707' }}
    >
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full object-cover"
        style={{ display: rendered ? 'block' : 'none' }}
      />

      {/* Placeholder shimmer */}
      {!rendered && (
        <div className="w-full h-full shimmer bg-surface-elevated" />
      )}

      {/* Page number label */}
      <div className={`
        absolute bottom-0 inset-x-0 py-1 text-center text-xs font-medium
        ${isActive ? 'bg-brand-red text-white' : 'bg-black/70 text-text-secondary group-hover:text-white'}
        transition-colors
      `}>
        {pageNum}
      </div>
    </button>
  );
});

export default memo(ThumbnailStrip);
