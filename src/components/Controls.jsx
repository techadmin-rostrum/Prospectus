import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { trackEvent, EVENTS } from '../utils/analytics';
import { flipBook, isFlipBookBusy } from '../utils/flipBook';
import { toggleImmersive, isFullscreenActive } from '../utils/fullscreen';

const ARROW_IDLE_MS = 5000;

export default function Controls({
  pageFlip,
  getPageFlip,
  numPages,
  currentPage,
  isMuted,
  toggleMute,
  onOpenThumbnails,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  pdfSrc,
  bookCenterY,
  docked = false,
  isMobile = false,
  isShortLandscape = false,
  bookAreaRef,
  isFlipping = false,
}) {
  const resolveFlip = () => getPageFlip?.() || pageFlip;
  // Bottom dock only on portrait phones — short landscape uses side arrows
  const useDockedArrows = isMobile && !isShortLandscape;
  const [barVisible, setBarVisible] = useState(true);
  const [arrowsVisible, setArrowsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(() => isFullscreenActive());
  const [pageInput, setPageInput] = useState('');
  const barHideTimerRef = useRef(null);
  const arrowIdleTimerRef = useRef(null);
  const overArrowRef = useRef(false);

  const clearArrowIdle = useCallback(() => {
    if (arrowIdleTimerRef.current) {
      clearTimeout(arrowIdleTimerRef.current);
      arrowIdleTimerRef.current = null;
    }
  }, []);

  const startArrowIdle = useCallback(() => {
    clearArrowIdle();
    if (overArrowRef.current || isMobile) return;
    arrowIdleTimerRef.current = setTimeout(() => {
      setArrowsVisible(false);
    }, ARROW_IDLE_MS);
  }, [clearArrowIdle, isMobile]);

  const revealArrows = useCallback(() => {
    setArrowsVisible(true);
    startArrowIdle();
  }, [startArrowIdle]);

  // Bottom bar: show on activity, hide after idle
  useEffect(() => {
    const showBar = () => {
      setBarVisible(true);
      if (barHideTimerRef.current) clearTimeout(barHideTimerRef.current);
      if (document.activeElement?.tagName === 'INPUT') return;
      barHideTimerRef.current = setTimeout(() => setBarVisible(false), 3000);
    };

    window.addEventListener('mousemove', showBar);
    window.addEventListener('touchstart', showBar, { passive: true });
    showBar();

    return () => {
      window.removeEventListener('mousemove', showBar);
      window.removeEventListener('touchstart', showBar);
      if (barHideTimerRef.current) clearTimeout(barHideTimerRef.current);
    };
  }, []);

  // Arrows: hide after 5s idle while pointer is on the book
  useEffect(() => {
    const book = bookAreaRef?.current;
    if (!book) return;

    const onBookPointer = () => {
      if (overArrowRef.current) return;
      revealArrows();
    };

    const onBookLeave = () => {
      // Leaving the book cancels the idle hide; arrows stay until next book idle
      clearArrowIdle();
    };

    const onTouch = () => {
      setArrowsVisible(true);
      clearArrowIdle();
      // On touch devices, hide again after 5s
      arrowIdleTimerRef.current = setTimeout(() => setArrowsVisible(false), ARROW_IDLE_MS);
    };

    book.addEventListener('mousemove', onBookPointer);
    book.addEventListener('mouseenter', onBookPointer);
    book.addEventListener('mouseleave', onBookLeave);
    book.addEventListener('touchstart', onTouch, { passive: true });

    // Start idle countdown once mounted if pointer may already be over the book
    startArrowIdle();

    return () => {
      book.removeEventListener('mousemove', onBookPointer);
      book.removeEventListener('mouseenter', onBookPointer);
      book.removeEventListener('mouseleave', onBookLeave);
      book.removeEventListener('touchstart', onTouch);
      clearArrowIdle();
    };
  }, [bookAreaRef, revealArrows, clearArrowIdle, startArrowIdle]);

  useEffect(() => {
    setPageInput(String(currentPage + 1));
  }, [currentPage]);

  const toggleFullscreen = () => {
    const entering = !isFullscreenActive();
    toggleImmersive().then((active) => {
      setIsFullscreen(active);
      trackEvent(EVENTS.FULLSCREEN_TOGGLE, {
        state: active ? 'enter' : 'exit',
        // iOS uses immersive layout; Android uses real fullscreen
        mode: entering && active ? 'maximize' : 'restore',
      });
    });
  };

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(isFullscreenActive());
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handlePageJump = (e) => {
    e.preventDefault();
    const target = parseInt(pageInput, 10);
    if (!isNaN(target) && target >= 1 && target <= numPages) {
      resolveFlip()?.turnToPage(target - 1);
    } else {
      setPageInput(String(currentPage + 1));
    }
  };

  const handleDownload = () => {
    trackEvent(EVENTS.DOWNLOAD_CLICK, { file: pdfSrc });
    const link = document.createElement('a');
    link.href = pdfSrc;
    link.download = pdfSrc.split('/').pop() || 'prospectus.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isFirstPage = currentPage === 0;
  const isLastPage = currentPage >= numPages - 1;
  const navLocked = isFlipping;

  const goPrev = () => {
    const flip = resolveFlip();
    if (!flip || isFlipBookBusy(flip)) return;
    flipBook(flip, 'prev');
  };

  const goNext = () => {
    const flip = resolveFlip();
    if (!flip || isFlipBookBusy(flip)) return;
    flipBook(flip, 'next');
  };

  const onArrowEnter = () => {
    overArrowRef.current = true;
    clearArrowIdle();
    setArrowsVisible(true);
  };

  const onArrowLeave = () => {
    overArrowRef.current = false;
    startArrowIdle();
  };

  return (
    <>
      <AnimatePresence>
        {arrowsVisible && (
          useDockedArrows ? (
            <motion.div
              key="mobile-nav-dock"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flipbook-mobile-nav-dock"
            >
              <NavArrow
                direction="prev"
                onClick={goPrev}
                disabled={isFirstPage || navLocked}
                isMobile
                docked
                onMouseEnter={onArrowEnter}
                onMouseLeave={onArrowLeave}
              />
              <NavArrow
                direction="next"
                onClick={goNext}
                disabled={isLastPage || navLocked}
                isMobile
                docked
                onMouseEnter={onArrowEnter}
                onMouseLeave={onArrowLeave}
              />
            </motion.div>
          ) : (
            <>
              <NavArrow
                direction="prev"
                onClick={goPrev}
                disabled={isFirstPage || navLocked}
                bookCenterY={bookCenterY}
                isMobile={isMobile}
                onMouseEnter={onArrowEnter}
                onMouseLeave={onArrowLeave}
              />
              <NavArrow
                direction="next"
                onClick={goNext}
                disabled={isLastPage || navLocked}
                bookCenterY={bookCenterY}
                isMobile={isMobile}
                onMouseEnter={onArrowEnter}
                onMouseLeave={onArrowLeave}
              />
            </>
          )
        )}
      </AnimatePresence>

      <AnimatePresence>
        {barVisible && (
          <motion.div
            key="bottom-bar"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className={
              docked
                ? 'flipbook-controls-bar relative z-30 flex items-center rounded-full'
                : 'flipbook-controls-bar fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center rounded-full'
            }
            style={{
              background: 'rgba(255,255,255,0.9)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: '1px solid rgba(15,23,42,0.08)',
              boxShadow: '0 8px 30px rgba(15,23,42,0.12), 0 2px 8px rgba(15,23,42,0.06)',
              boxSizing: 'border-box',
            }}
            onMouseEnter={() => {
              setBarVisible(true);
              if (barHideTimerRef.current) clearTimeout(barHideTimerRef.current);
            }}
            onMouseLeave={() => {
              if (barHideTimerRef.current) clearTimeout(barHideTimerRef.current);
              barHideTimerRef.current = setTimeout(() => setBarVisible(false), 2000);
            }}
          >
            <IconButton
              icon={<IconGrid />}
              label="Thumbnails"
              onClick={() => { trackEvent(EVENTS.THUMBNAIL_OPEN); onOpenThumbnails(); }}
            />

            <Divider />

            <form onSubmit={handlePageJump} className="flipbook-page-form flex items-center">
              <input
                type="text"
                inputMode="numeric"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                className="flipbook-page-input bg-slate-100 border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:border-brand-red focus:bg-white transition-colors font-mono"
                style={{ textAlign: 'center', boxSizing: 'border-box' }}
              />
              <span className="flipbook-page-total text-slate-400 font-mono">
                / {numPages}
              </span>
            </form>

            <Divider />

            <IconButton
              icon={isMuted ? <IconVolumeOff /> : <IconVolume2 />}
              label={isMuted ? 'Unmute sound' : 'Mute sound'}
              onClick={() => { toggleMute(); trackEvent(EVENTS.SOUND_TOGGLE, { muted: !isMuted }); }}
            />
            <IconButton
              icon={<IconDownload />}
              label="Download PDF"
              onClick={handleDownload}
            />
            <IconButton
              icon={isFullscreen ? <IconMinimize /> : <IconMaximize />}
              label={isFullscreen ? 'Exit maximize' : 'Maximize'}
              onClick={toggleFullscreen}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function NavArrow({
  direction,
  onClick,
  disabled,
  bookCenterY,
  isMobile,
  docked = false,
  onMouseEnter,
  onMouseLeave,
}) {
  const isPrev = direction === 'prev';
  const top = !docked && typeof bookCenterY === 'number' && bookCenterY > 0
    ? bookCenterY
    : !docked
      ? '50%'
      : undefined;

  return (
    <motion.button
      key={`${direction}-arrow`}
      type="button"
      initial={docked ? { opacity: 0 } : { opacity: 0, x: isPrev ? -12 : 12 }}
      animate={{ opacity: disabled ? 0.35 : 1, ...(docked ? {} : { x: 0 }) }}
      exit={docked ? { opacity: 0 } : { opacity: 0, x: isPrev ? -12 : 12 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      whileHover={disabled || isMobile ? {} : { scale: 1.08 }}
      whileTap={disabled ? {} : { scale: 0.92 }}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      aria-label={isPrev ? 'Previous Page' : 'Next Page'}
      className={`
        flipbook-nav-arrow ${isPrev ? '' : 'flipbook-nav-arrow--next'}
        ${docked ? 'flipbook-nav-arrow--docked' : 'fixed -translate-y-1/2'}
        group z-30
        rounded-full flex items-center justify-center
        ${disabled ? 'pointer-events-none' : 'cursor-pointer'}
        transition-[opacity,transform] duration-200
      `}
      style={{
        ...(top != null ? { top } : {}),
        padding: 0,
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(15,23,42,0.06)',
        boxShadow: '0 10px 40px rgba(15,23,42,0.10), 0 2px 10px rgba(15,23,42,0.05), inset 0 0 0 1px rgba(255,255,255,0.4)',
      }}
    >
      <span className="flex items-center justify-center w-full h-full rounded-full text-slate-700 group-hover:text-brand-red transition-colors duration-200">
        {isPrev ? <IconChevronLeft /> : <IconChevronRight />}
      </span>
    </motion.button>
  );
}

function Divider() {
  return <div className="flipbook-divider" aria-hidden="true" />;
}

function IconButton({ icon, label, onClick, disabled }) {
  return (
    <motion.button
      type="button"
      whileHover={disabled ? {} : { scale: 1.08 }}
      whileTap={disabled ? {} : { scale: 0.92 }}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`
        flipbook-icon-btn rounded-full flex items-center justify-center transition-colors flex-shrink-0
        ${disabled
          ? 'opacity-30 cursor-not-allowed text-slate-400'
          : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer'
        }
      `}
    >
      {icon}
    </motion.button>
  );
}

const IconGrid = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>;
const IconChevronLeft = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>;
const IconChevronRight = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>;
const IconVolume2 = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>;
const IconVolumeOff = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>;
const IconDownload = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>;
const IconMaximize = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>;
const IconMinimize = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>;
