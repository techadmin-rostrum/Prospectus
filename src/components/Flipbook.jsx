import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router';
import HTMLFlipBook from 'react-pageflip';
import { motion } from 'motion/react';

import { usePdfDocument } from '../hooks/usePdfDocument';
import { usePageRenderer } from '../hooks/usePageRenderer';
import { useSound } from '../hooks/useSound';
import { trackEvent, EVENTS } from '../utils/analytics';
import { syncFlipCanvases } from '../utils/syncFlipCanvases';
import { flipBook } from '../utils/flipBook';

import PageCanvas from './PageCanvas';
import LoadingSkeleton from './LoadingSkeleton';
import Controls from './Controls';
import ThumbnailStrip from './ThumbnailStrip';

export default function Flipbook({ pdfSrc, title, theme = 'pg' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const bookRef = useRef(null);
  const mainRef = useRef(null);
  const bookStageRef = useRef(null);

  const { pdfDocument, numPages, loading, progress, error, aspectRatio } = usePdfDocument(pdfSrc);
  const { evictCache, clearCache } = usePageRenderer();
  const { isMuted, toggleMute, playPageTurn } = useSound();

  const [currentPage, setCurrentPage] = useState(0);
  const [isCoverView, setIsCoverView] = useState(true);
  const [isBackCoverView, setIsBackCoverView] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [isThumbnailsOpen, setIsThumbnailsOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [bookCenterY, setBookCenterY] = useState(
    typeof window !== 'undefined' ? window.innerHeight / 2 : 0
  );

  // Interior turns: controlled & paper-like. Cover open: a touch slower.
  // Mobile gets a bit more time so the soft curl reads clearly on a small screen.
  const PAGE_FLIP_MS = isMobile ? 1100 : 900;
  const COVER_FLIP_MS = isMobile ? 1300 : 1200;
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flipDurationMs = prefersReducedMotion ? 0 : PAGE_FLIP_MS;
  const coverTransitionMs = prefersReducedMotion ? 0 : COVER_FLIP_MS;

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const mobile = width < 768;
      setIsMobile(mobile);

      const container = mainRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      // Leave room for side arrows on larger screens; tighter on phones
      const sideGutter = mobile ? 12 : width < 1024 ? 88 : 120;
      const verticalGutter = mobile ? 8 : 24;
      const availableWidth = Math.max(rect.width - sideGutter, 0);
      const availableHeight = Math.max(rect.height - verticalGutter, 0);

      const aspect = aspectRatio || (1 / 1.414);

      let pageW;
      let pageH;

      if (mobile) {
        // Portrait single-page: fit width first, then height
        pageW = Math.min(availableWidth, availableHeight * aspect);
        pageH = pageW / aspect;
        if (pageH > availableHeight) {
          pageH = availableHeight;
          pageW = pageH * aspect;
        }
      } else {
        // Landscape spread: fit two pages
        pageW = Math.min(availableWidth / 2, availableHeight * aspect);
        pageH = pageW / aspect;
        if (pageH > availableHeight) {
          pageH = availableHeight;
          pageW = pageH * aspect;
        }
      }

      // Avoid sub-pixel thrash
      pageW = Math.floor(pageW);
      pageH = Math.floor(pageH);

      setDimensions((prev) =>
        prev.width === pageW && prev.height === pageH ? prev : { width: pageW, height: pageH }
      );
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(handleResize);
    if (mainRef.current) observer.observe(mainRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
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
    trackEvent(EVENTS.PAGE_TURN, { page: e.data + 1 });
    // Front cover (right leaf) / back cover (left leaf): center after the turn settles
    setIsCoverView(e.data === 0);
    setIsBackCoverView(numPages > 0 && e.data === numPages - 1);
  }, [updateUrlForPage, numPages]);

  // Sync flip timing + stage reveal with the live flip state.
  const onChangeState = useCallback((e) => {
    const turning =
      e.data === 'flipping' || e.data === 'user_fold' || e.data === 'fold_corner';
    // Only treat real turns as "flipping" for shadow/filter (not corner hover)
    setIsFlipping(e.data === 'flipping' || e.data === 'user_fold');

    // Un-clip the book area for the whole turn (incl. corner folds) via a DOM
    // class — setState here would re-render the book mid-fold.
    mainRef.current?.classList.toggle('is-turning', e.data !== 'read');

    // Soft flips clone the page DOM without canvas pixels — copy them now.
    if (turning) {
      syncFlipCanvases();
      requestAnimationFrame(() => syncFlipCanvases());
    }

    if (e.data === 'flipping') {
      playPageTurn();
      // Expand to spread as soon as a cover starts opening
      if (!isMobile) {
        if (currentPage === 0) setIsCoverView(false);
        if (numPages > 0 && currentPage === numPages - 1) setIsBackCoverView(false);
      }
    }
  }, [currentPage, isMobile, playPageTurn, numPages]);

  // Keep library flip duration in sync before the next turn starts.
  useEffect(() => {
    const flip = bookRef.current?.pageFlip?.();
    if (!flip || prefersReducedMotion) return;
    const atCover = currentPage === 0 || (numPages > 0 && currentPage === numPages - 1);
    flip.getSettings().flippingTime = atCover ? COVER_FLIP_MS : PAGE_FLIP_MS;
  }, [currentPage, prefersReducedMotion, loading, numPages, isMobile]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement?.tagName === 'INPUT') return;

      const flip = bookRef.current?.pageFlip();
      if (!flip) return;

      switch(e.key) {
        case 'ArrowRight':
          flipBook(flip, 'next');
          break;
        case 'ArrowLeft':
          flipBook(flip, 'prev');
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

  // Keep nav arrows vertically centered on the book stage (not the viewport)
  useEffect(() => {
    const updateBookCenter = () => {
      const el = bookStageRef.current || mainRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setBookCenterY(rect.top + rect.height / 2);
    };

    updateBookCenter();
    // Recenter after layout/animation settles
    const raf = requestAnimationFrame(updateBookCenter);
    const t = setTimeout(updateBookCenter, 100);

    window.addEventListener('resize', updateBookCenter);
    const observer = new ResizeObserver(updateBookCenter);
    if (bookStageRef.current) observer.observe(bookStageRef.current);
    else if (mainRef.current) observer.observe(mainRef.current);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener('resize', updateBookCenter);
      observer.disconnect();
    };
  }, [loading, dimensions.height, dimensions.width, isCoverView, isBackCoverView, isMobile, zoomLevel]);

  // Parent pan handlers must not steal page-drag when zoomed out.
  // Only enable pan when actually zoomed in.
  const [panState, setPanState] = useState({ isDragging: false, x: 0, y: 0, startX: 0, startY: 0 });
  const handleMouseDown = (e) => {
    if (zoomLevel <= 1) return;
    // Don't pan-drag when interacting with the book pages
    if (e.target.closest?.('.stf__parent, .stf__block, .page-canvas')) return;
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

  const pageW = dimensions.width * zoomLevel;
  const pageH = dimensions.height * zoomLevel;
  // Front cover = right leaf; back cover = left leaf. Crop to one page and center it.
  const singleCentered = !isMobile && (isCoverView || isBackCoverView);
  const singlePageOffsetX = !isMobile && isCoverView ? -pageW : 0;

  return (
    <div className={`flipbook-shell flipbook-shell--${theme} h-dvh max-h-dvh flex flex-col relative overflow-hidden`}>
      <div
        className="absolute inset-0 pointer-events-none select-none overflow-hidden z-0"
        aria-hidden="true"
      >
        <div className="flipbook-bg-glow" />
        <div className="flipbook-bg-grain" />
        <div className="flipbook-watermark-grid">
          {Array.from({ length: 120 }, (_, i) => (
            <span key={i} className="flipbook-watermark font-display font-medium tracking-tight">
              Rostrum
            </span>
          ))}
        </div>
      </div>

      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flipbook-chrome-header flex-shrink-0 z-20 pointer-events-auto relative"
      >
        <a
          href="https://rostrumedu.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="flipbook-brand-link"
          aria-label="Rostrum Education — visit website"
        >
          <img src="/Logo.svg" alt="Rostrum Education" className="flipbook-brand-logo" />
        </a>

        <div className="flipbook-title-box font-display font-medium text-white">
          {title}
        </div>

        <a
          href="https://rostrumedu.com/contact-us/"
          target="_blank"
          rel="noopener noreferrer"
          className="flipbook-contact-btn font-body"
        >
          Contact Us
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </motion.header>

      <main ref={mainRef} className="flipbook-main flex-1 min-h-0 flex items-center justify-center relative z-10 px-1 sm:px-2">
        {loading || !dimensions.width ? (
          <LoadingSkeleton progress={progress} />
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="w-full h-full flex justify-center items-center relative z-10 overflow-visible"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div
              className="overflow-visible"
              style={{
                transform: `translate(${panState.x}px, ${panState.y}px)`,
                cursor: zoomLevel > 1 ? 'move' : 'grab',
                transition: panState.isDragging ? 'none' : 'transform 0.3s ease-out',
              }}
            >
              <div className="flipbook-perspective">
              {/*
                Front cover = right leaf (offset -pageW); back cover = left leaf (offset 0).
                Crop with width + overflow so drop-shadow doesn't cancel the crop.
              */}
              <motion.div
                ref={bookStageRef}
                initial={false}
                animate={{
                  width: isMobile ? pageW : singleCentered ? pageW : pageW * 2,
                }}
                transition={{
                  duration: coverTransitionMs / 1000,
                  ease: [0.16, 1, 0.3, 1],
                }}
                style={{
                  height: pageH,
                  overflow: singleCentered && !isFlipping ? 'hidden' : 'visible',
                  zIndex: isFlipping ? 40 : 1,
                }}
                className={
                  singleCentered
                    ? 'flipbook-stage flipbook-stage--cover'
                    : `flipbook-stage flipbook-stage--spread${isFlipping ? ' is-flipping' : ''}`
                }
              >
                <motion.div
                  initial={false}
                  animate={{
                    x: singlePageOffsetX,
                  }}
                  transition={{
                    duration: coverTransitionMs / 1000,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  style={{
                    width: isMobile ? pageW : pageW * 2,
                    height: pageH,
                    position: 'relative',
                  }}
                >
                <HTMLFlipBook
                  key={`book-${isMobile ? 'm' : 'd'}-${Math.round(pageW / 8) * 8}x${Math.round(pageH / 8) * 8}`}
                  width={pageW}
                  height={pageH}
                  size="fixed"
                  minWidth={Math.min(315, pageW)}
                  maxWidth={Math.max(1000, pageW)}
                  minHeight={Math.min(400, pageH)}
                  maxHeight={Math.max(1533, pageH)}
                  drawShadow={true}
                  maxShadowOpacity={isMobile ? 0.85 : 0.7}
                  showCover={true}
                  mobileScrollSupport={true}
                  useMouseEvents={true}
                  showPageCorners={true}
                  disableFlipByClick={false}
                  swipeDistance={isMobile ? 15 : 25}
                  clickEventForward={true}
                  className={singleCentered ? 'flip-shadow flip-shadow--cover' : 'flip-shadow'}
                  ref={bookRef}
                  onFlip={onFlip}
                  onChangeState={onChangeState}
                  onInit={() => {
                    // Keep interior pages soft so turns curl instead of hard-folding
                    const flip = bookRef.current?.pageFlip?.();
                    if (!flip) return;
                    const count = flip.getPageCount();
                    for (let i = 0; i < count; i++) {
                      const page = flip.getPage(i);
                      if (!page) continue;
                      if (i === 0 || i === count - 1) {
                        page.setDensity?.('hard');
                      } else {
                        page.setDensity?.('soft');
                        page.setDrawingDensity?.('soft');
                      }
                    }
                    // Restore page after resize remount
                    const restoreTo = Math.min(Math.max(currentPage, 0), count - 1);
                    if (restoreTo > 0) {
                      flip.turnToPage(restoreTo);
                    }
                    const idx = flip.getCurrentPageIndex?.() ?? restoreTo;
                    setIsCoverView(idx === 0);
                    setIsBackCoverView(count > 0 && idx === count - 1);
                  }}
                  usePortrait={isMobile}
                  flippingTime={flipDurationMs}
                >
                  {Array.from({ length: numPages }, (_, i) => (
                    <PageCanvas
                      key={i}
                      pageNum={i + 1}
                      numPages={numPages}
                      pdfDocument={pdfDocument}
                      width={pageW}
                      height={pageH}
                      extraScale={1}
                      priority={Math.abs(currentPage - i) <= 1 || (currentPage === 0 && i <= 1)}
                      shouldRender={Math.abs(currentPage - i) <= 2 || (currentPage === 0 && i <= 2)}
                    />
                  ))}
                </HTMLFlipBook>

                {!singleCentered && !isMobile && (
                  <div className="book-depth" aria-hidden="true">
                    <div className="book-depth__gutter" />
                    <div className="book-depth__crease book-depth__crease--left" />
                    <div className="book-depth__crease book-depth__crease--right" />
                    <div className="book-depth__spine" />
                  </div>
                )}
                </motion.div>
              </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </main>

      <footer className="flipbook-chrome-footer flex-shrink-0 relative z-30 flex justify-center items-center">
        {!loading && (
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
            bookCenterY={bookCenterY}
            docked
            isMobile={isMobile}
            bookAreaRef={mainRef}
          />
        )}
      </footer>

      {!loading && (
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
      )}
    </div>
  );
}