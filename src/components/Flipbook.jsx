import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router';
import HTMLFlipBook from 'react-pageflip';
import { motion } from 'motion/react';

import { usePdfDocument } from '../hooks/usePdfDocument';
import { usePageRenderer } from '../hooks/usePageRenderer';
import { useSound } from '../hooks/useSound';
import { trackEvent, EVENTS } from '../utils/analytics';

import PageCanvas from './PageCanvas';
import LoadingSkeleton from './LoadingSkeleton';
import Controls from './Controls';
import ThumbnailStrip from './ThumbnailStrip';

export default function Flipbook({ pdfSrc, title }) {
  const navigate = useNavigate();
  const location = useLocation();
  const bookRef = useRef(null);
  const mainRef = useRef(null);

  const { pdfDocument, numPages, loading, progress, error, aspectRatio } = usePdfDocument(pdfSrc);
  const { evictCache, clearCache } = usePageRenderer();
  const { isMuted, toggleMute, playPageTurn } = useSound();

  const [currentPage, setCurrentPage] = useState(0);
  const [isCoverView, setIsCoverView] = useState(true);
  const [isThumbnailsOpen, setIsThumbnailsOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);

      const container = mainRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const margin = mobile ? 16 : 48;
      const availableWidth = Math.max(rect.width - margin, 0);
      const availableHeight = Math.max(rect.height - margin, 0);

      const aspect = aspectRatio || (1 / 1.414);

      let pageW, pageH;

      if (mobile) {
        pageW = Math.min(availableWidth, availableHeight * aspect);
        pageH = pageW / aspect;
      } else {
        pageW = Math.min(availableWidth / 2, availableHeight * aspect);
        pageH = pageW / aspect;
      }

      setDimensions({ width: pageW, height: pageH });
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(handleResize);
    if (mainRef.current) observer.observe(mainRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [aspectRatio]);

  useEffect(() => {
    if (!bookRef.current || !bookRef.current.pageFlip) return;

    const params = new URLSearchParams(location.search);
    const pageParam = params.get('page');

    if (pageParam) {
      const targetPage = parseInt(pageParam, 10) - 1;
      if (!isNaN(targetPage) && targetPage >= 0 && targetPage < numPages && targetPage !== currentPage) {
        setTimeout(() => {
          bookRef.current.pageFlip().turnToPage(targetPage);
        }, 100);
      }
    }
  }, [location.search, numPages]);

  const updateUrlForPage = useCallback((newPageIndex) => {
    const displayPage = newPageIndex + 1;
    setCurrentPage(newPageIndex);
    evictCache(displayPage, 4);

    const params = new URLSearchParams(location.search);
    if (params.get('page') !== String(displayPage)) {
      params.set('page', displayPage);
      navigate({ search: params.toString() }, { replace: true });
    }
  }, [navigate, location.search, evictCache]);

  const onFlip = useCallback((e) => {
    updateUrlForPage(e.data);
    playPageTurn();
    trackEvent(EVENTS.PAGE_TURN, { page: e.data + 1 });
    setIsCoverView(e.data === 0);
  }, [updateUrlForPage, playPageTurn]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement?.tagName === 'INPUT') return;

      const flip = bookRef.current?.pageFlip();
      if (!flip) return;

      switch(e.key) {
        case 'ArrowRight':
          flip.flipNext();
          break;
        case 'ArrowLeft':
          flip.flipPrev();
          break;
        case '=':
        case '+':
          setZoomLevel(prev => Math.min(prev + 0.5, 3));
          break;
        case '-':
          setZoomLevel(prev => Math.max(prev - 0.5, 1));
          break;
        case '0':
          setZoomLevel(1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    return () => clearCache();
  }, [clearCache]);

  const [panState, setPanState] = useState({ isDragging: false, x: 0, y: 0, startX: 0, startY: 0 });
  const handleMouseDown = (e) => {
    if (zoomLevel <= 1) return;
    setPanState({
      isDragging: true,
      startX: e.clientX - panState.x,
      startY: e.clientY - panState.y,
      x: panState.x,
      y: panState.y
    });
  };
  const handleMouseMove = (e) => {
    if (!panState.isDragging || zoomLevel <= 1) return;
    setPanState(prev => ({
      ...prev,
      x: e.clientX - prev.startX,
      y: e.clientY - prev.startY
    }));
  };
  const handleMouseUp = () => {
    setPanState(prev => ({ ...prev, isDragging: false }));
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-slate-900 p-6">
        <div className="text-center p-8 border border-slate-200 rounded-xl max-w-md shadow-sm">
          <svg className="w-12 h-12 mx-auto text-brand-red mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-xl font-display mb-2">Failed to load Prospectus</h2>
          <p className="text-slate-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-2 bg-brand-red text-white rounded-lg font-medium hover:bg-brand-red-light transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const showAsSpread = !isMobile && !isCoverView;

  return (
    <div className="h-screen bg-white flex flex-col relative">
      <div className="w-full bg-brand-navy/5 blur-3xl  rounded-full pointer-events-none" />

      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 8 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex-shrink-0 flex justify-center items-center p-6 z-20 pointer-events-auto relative"
      >

        <h1 className="text-xl md:text-5xl font-display font-medium text-slate-900 hidden sm:block">
          {title}
        </h1>

      </motion.header>

      <main ref={mainRef} className="flex-1 flex items-center justify-center relative">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 60% 50% at 50% 45%, rgba(21,47,122,0.06), transparent 70%)',
          }}
        />
        {loading || !dimensions.width ? (
          <LoadingSkeleton progress={progress} />
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 30 }}
            animate={{ opacity: 1.7, scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="w-full h-full flex justify-center items-center relative"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div
              style={{
                transform: `translate(${panState.x}px, ${panState.y}px)`,
                cursor: zoomLevel > 1 ? 'move' : 'grab',
                transition: panState.isDragging ? 'none' : 'transform 0.3s ease-out',
              }}
            >
              {/* Mask: hidden while showing just the cover (hides the blank leaf),
                  visible once in full spread mode (so page-curl bulges never clip) */}
              <motion.div
                animate={{ width: showAsSpread ? dimensions.width * 2 * zoomLevel : dimensions.width * zoomLevel }}
                transition={{ duration: .7, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  height: dimensions.height * zoomLevel,
                  overflow: showAsSpread ? 'visible' : 'hidden',
                  filter: 'drop-shadow(0 30px 60px rgba(0,0,0,0.18)) drop-shadow(0 10px 20px rgba(0,0,0,0.1))',
                }}
              >
                <div
                  style={{
                    transform: showAsSpread || isMobile
                      ? 'translateX(0px)'
                      : `translateX(-${dimensions.width * zoomLevel}px)`,
                    transition: 'transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <HTMLFlipBook
                    width={dimensions.width * zoomLevel}
                    height={dimensions.height * zoomLevel}
                    size="fixed"
                    minWidth={315}
                    maxWidth={1000}
                    minHeight={400}
                    maxHeight={1533}
                    maxShadowOpacity={0.5}
                    showCover={true}
                    mobileScrollSupport={true}
                    className="flip-shadow"
                    ref={bookRef}
                    onFlip={onFlip}
                    usePortrait={isMobile}
                    flippingTime={
                      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
                      ? 0
                      : 1000
                    }
                  >
                    {Array.from({ length: numPages }, (_, i) => (
                      <PageCanvas
                        key={i}
                        pageNum={i + 1}
                        pdfDocument={pdfDocument}
                        width={dimensions.width * zoomLevel}
                        height={dimensions.height * zoomLevel}
                        extraScale={1}
                        priority={Math.abs(currentPage - i) <= 2}
                        shouldRender={Math.abs(currentPage - i) <= 4}
                      />
                    ))}
                  </HTMLFlipBook>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </main>

      {!loading && (
        <>
          <Controls
            pageFlip={bookRef.current?.pageFlip()}
            numPages={numPages}
            currentPage={currentPage}
            isMuted={isMuted}
            toggleMute={toggleMute}
            onOpenThumbnails={() => setIsThumbnailsOpen(true)}
            zoomLevel={zoomLevel}
            onZoomIn={() => {
              setZoomLevel(prev => Math.min(prev + 0.5, 3));
              trackEvent(EVENTS.ZOOM_USED, { level: zoomLevel + 0.5 });
            }}
            onZoomOut={() => setZoomLevel(prev => Math.max(prev - 0.5, 1))}
            onZoomReset={() => {
              setZoomLevel(1);
              setPanState({ isDragging: false, x: 0, y: 0, startX: 0, startY: 0 });
            }}
            pdfSrc={pdfSrc}
          />

          <ThumbnailStrip
            pdfDocument={pdfDocument}
            numPages={numPages}
            currentPage={currentPage}
            isOpen={isThumbnailsOpen}
            onClose={() => setIsThumbnailsOpen(false)}
            onPageSelect={(idx) => {
              bookRef.current?.pageFlip()?.turnToPage(idx);
            }}
          />
        </>
      )}
    </div>
  );
}