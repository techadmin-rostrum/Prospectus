import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { warmPdf } from '../utils/warmPdf';
import { enterImmersive, isPhoneViewport, syncAppHeight } from '../utils/fullscreen';
import { unlockFlipbookAudio } from '../hooks/useSound';

const COVER_RATIO = 842 / 595;

export default function LandingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    syncAppHeight();
    const onResize = () => syncAppHeight();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);

  const openProspectus = (path) => {
    // Same user gesture: unlock iOS audio + maximize layout, then navigate.
    unlockFlipbookAudio();
    if (isPhoneViewport()) {
      enterImmersive();
    }
    navigate(path);
  };

  return (
    <div className="landing-page min-h-dvh w-full flex flex-col items-center relative overflow-x-hidden overflow-y-auto px-3 sm:px-4 pb-8 sm:pb-8">

      <div className="absolute top-3 left-3 sm:top-5 sm:left-6 md:top-6 md:left-8 z-20">
        <a
          href="https://rostrumedu.com/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Rostrum Education — visit website"
          className="landing-brand-link inline-flex"
        >
          <img
            src="/Logo.svg"
            alt="Rostrum Education"
            className="h-6 sm:h-8 md:h-10 w-auto"
          />
        </a>
      </div>

      <a
        href="https://rostrumedu.com/contact-us/"
        target="_blank"
        rel="noopener noreferrer"
        className="landing-contact-btn font-body absolute top-3 right-3 sm:top-5 sm:right-6 md:top-6 md:right-8 z-20"
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

      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 select-none" aria-hidden="true">
        <div className="landing-bg-glow" />
        <div className="landing-bg-grain" />
        <div className="landing-watermark-field">
          {Array.from({ length: 5 }, (_, col) => {
            const words = Array.from({ length: 32 }, () => 'Rostrum');
            return (
              <div
                key={col}
                className={`landing-watermark-col${col % 2 === 1 ? ' is-reverse' : ''}`}
              >
                <div className="landing-watermark-col-track">
                  {[...words, ...words].map((word, i) => (
                    <span key={i} className="landing-watermark font-display font-medium tracking-tight">
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="landing-content z-10 flex flex-col items-center w-full flex-1">
        <header className="landing-hero flex flex-col items-center text-center w-full max-w-3xl px-2 sm:px-4 flex-shrink-0">
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="landing-hero-title font-display font-medium text-white tracking-tight mb-2 sm:mb-2.5 whitespace-nowrap"
          >
            Explore Our Prospectus
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="landing-subtitle text-sm sm:text-base md:text-lg text-white/70 max-w-2xl mx-auto font-light px-1"
          >
            <span>Discover your future with Rostrum Education.</span>
            <span>Select a programme below to view the interactive flipbook.</span>
          </motion.p>
        </header>

        <div
          className="
            landing-books
            flex flex-col sm:flex-row w-full max-w-[95vw]
            justify-center items-center
            gap-5 sm:gap-8 md:gap-12
          "
        >
          <ProspectusCard
            title="Undergraduate"
            subtitle="2026 Entry"
            pdfSrc="/pdfs/UG26.v2.pdf"
            coverSrc="/covers/ug-cover.jpg"
            delay={0.4}
            onClick={() => openProspectus('/ug')}
          />

          <ProspectusCard
            title="Postgraduate"
            subtitle="2026 Entry"
            pdfSrc="/pdfs/PG26.v2.pdf"
            coverSrc="/covers/pg-cover.jpg"
            delay={0.5}
            onClick={() => openProspectus('/pg')}
          />
        </div>
      </div>
    </div>
  );
}

function ProspectusCard({ title, subtitle, pdfSrc, coverSrc, onClick, delay }) {
  // Covers are pre-rendered (scripts/make-covers.py) — the landing page never
  // touches the PDFs, so nothing competes with the viewer for bandwidth.
  // Showing intent pulls the viewer chunk and the document ahead of the click.
  const prefetch = () => {
    import('./Flipbook');
    warmPdf(pdfSrc);
  };

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      className="landing-book group text-left flex-none flex flex-col items-center gap-3 sm:gap-4"
    >
      <div
        className="landing-book__cover relative w-full overflow-visible"
        style={{ aspectRatio: `${COVER_RATIO}` }}
      >
        <div className="landing-book__face absolute inset-0 overflow-hidden bg-slate-200">
          <img
            src={coverSrc}
            alt={`${title} Cover`}
            width={1100}
            height={778}
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover object-center"
            draggable={false}
          />

          <div className="book-cover-depth" aria-hidden="true">
            <div className="book-cover-depth__spine" />
            <div className="book-cover-depth__sheen" />
          </div>

          <div className="absolute inset-0 z-30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/25">
            <span className="landing-book__cta">
              Read Book
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </span>
          </div>
        </div>
      </div>

      <div className="landing-book__label w-full text-center px-1">
        <h2 className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider mb-1">
          {subtitle}
        </h2>
        <h3 className="text-base sm:text-lg font-display font-medium transition-colors">
          {title} Prospectus
        </h3>
      </div>
    </motion.button>
  );
}
