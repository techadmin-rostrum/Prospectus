import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { trackEvent, EVENTS } from '../utils/analytics';

export default function Controls({
  pageFlip,
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
}) {
  const [isVisible, setIsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pageInput, setPageInput] = useState('');
  const hideTimerRef = useRef(null);

  useEffect(() => {
    const showControls = () => {
      setIsVisible(true);
      resetHideTimer();
    };

    const resetHideTimer = () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (document.activeElement?.tagName === 'INPUT') return;
      hideTimerRef.current = setTimeout(() => setIsVisible(false), 3000);
    };

    window.addEventListener('mousemove', showControls);
    window.addEventListener('touchstart', showControls);
    resetHideTimer();

    return () => {
      window.removeEventListener('mousemove', showControls);
      window.removeEventListener('touchstart', showControls);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setPageInput(String(currentPage + 1));
  }, [currentPage]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
      trackEvent(EVENTS.FULLSCREEN_TOGGLE, { state: 'enter' });
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
      trackEvent(EVENTS.FULLSCREEN_TOGGLE, { state: 'exit' });
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handlePageJump = (e) => {
    e.preventDefault();
    const target = parseInt(pageInput, 10);
    if (!isNaN(target) && target >= 1 && target <= numPages) {
      pageFlip?.turnToPage(target - 1);
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

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          <NavArrow
            direction="prev"
            onClick={() => pageFlip?.flipPrev()}
            disabled={isFirstPage}
          />
          <NavArrow
            direction="next"
            onClick={() => pageFlip?.flipNext()}
            disabled={isLastPage}
          />

          {/* Minimal bottom bar — only essential controls */}
          <motion.div
            key="bottom-bar"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center rounded-full"
            style={{
              padding: '6px',
              background: 'rgba(255,255,255,0.9)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: '1px solid rgba(15,23,42,0.08)',
              boxShadow: '0 8px 30px rgba(15,23,42,0.12), 0 2px 8px rgba(15,23,42,0.06)',
              boxSizing: 'border-box',
            }}
            onMouseEnter={() => {
              setIsVisible(true);
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            }}
            onMouseLeave={() => {
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
              hideTimerRef.current = setTimeout(() => setIsVisible(false), 2000);
            }}
          >
            <IconButton icon={<IconGrid />} label="Thumbnails" onClick={() => { trackEvent(EVENTS.THUMBNAIL_OPEN); onOpenThumbnails(); }} />

            <Divider />

            <form onSubmit={handlePageJump} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px' }}>
              <input
                type="text"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                style={{
                  width: '48px',
                  textAlign: 'center',
                  padding: '6px 8px',
                  boxSizing: 'border-box',
                }}
                className="bg-slate-100 border border-slate-200 rounded-lg text-sm font-medium text-slate-900 focus:outline-none focus:border-brand-red focus:bg-white transition-colors font-mono"
              />
              <span className="text-sm text-slate-400 font-mono">/ {numPages}</span>
            </form>

            <Divider />

            <IconButton icon={isMuted ? <IconVolumeOff /> : <IconVolume2 />} label={isMuted ? 'Unmute sound' : 'Mute sound'} onClick={() => { toggleMute(); trackEvent(EVENTS.SOUND_TOGGLE, { muted: !isMuted }); }} />
            <IconButton icon={<IconDownload />} label="Download PDF" onClick={handleDownload} />
            <IconButton icon={isFullscreen ? <IconMinimize /> : <IconMaximize />} label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'} onClick={toggleFullscreen} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Premium carousel-style navigation arrow, vertically centered on screen edge */
function NavArrow({ direction, onClick, disabled }) {
  const isPrev = direction === 'prev';

  return (
    <motion.button
      key={`${direction}-arrow`}
      initial={{ opacity: 0, x: isPrev ? -12 : 12 }}
      animate={{ opacity: disabled ? 0 : 1, x: 0 }}
      exit={{ opacity: 0, x: isPrev ? -12 : 12 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      whileHover={disabled ? {} : { scale: 1.06 }}
      whileTap={disabled ? {} : { scale: 0.92 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={isPrev ? 'Previous Page' : 'Next Page'}
      className={`
        group fixed top-1/2 -translate-y-1/2 z-30
        ${isPrev ? 'left-5 md:left-10' : 'right-5 md:right-10'}
        w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center
        ${disabled ? 'pointer-events-none' : 'cursor-pointer'}
      `}
      style={{
        padding: 0,
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(15,23,42,0.06)',
        boxShadow: '0 10px 40px rgba(15,23,42,0.10), 0 2px 10px rgba(15,23,42,0.05), inset 0 0 0 1px rgba(255,255,255,0.4)',
      }}
    >
      <motion.span
        className="flex items-center justify-center w-full h-full rounded-full text-slate-700 group-hover:text-brand-red transition-colors duration-300"
        animate={{ x: 0 }}
        whileHover={disabled ? {} : { x: isPrev ? -3 : 3 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        {isPrev ? <IconChevronLeft size={26} /> : <IconChevronRight size={26} />}
      </motion.span>
    </motion.button>
  );
}

function Divider() {
  return <div style={{ width: '1px', height: '28px', margin: '0 6px' }} className="bg-slate-200 flex-shrink-0" />;
}

function IconButton({ icon, label, onClick, disabled }) {
  return (
    <motion.button
      type="button"
      whileHover={disabled ? {} : { scale: 1.1 }}
      whileTap={disabled ? {} : { scale: 0.92 }}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{ padding: '12px', boxSizing: 'border-box' }}
      className={`
        rounded-full flex items-center justify-center transition-colors
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

const IconGrid = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>;
const IconChevronLeft = ({ size = 22 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>;
const IconChevronRight = ({ size = 22 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>;
const IconVolume2 = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>;
const IconVolumeOff = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>;
const IconDownload = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>;
const IconMaximize = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>;
const IconMinimize = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>;