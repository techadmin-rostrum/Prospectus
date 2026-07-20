import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';

// Ensure worker is loaded for the landing page thumbnails too
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs-dist/build/pdf.worker.min.mjs';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="h-screen w-full bg-white flex flex-col items-center justify-center relative overflow-hidden px-4 py-6">

      {/* Logo pinned top-left */}
      <div className="absolute top-4 left-4 md:top-6 md:left-8 z-20">
        <img
          src="/Logo.svg"
          alt="Rostrum Education"
          className="h-8 md:h-10"
        />
      </div>

      {/* Background gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-15%] left-[-10%] w-[40vw] h-[40vw] max-w-[400px] max-h-[400px] bg-brand-navy/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[40vw] h-[40vw] max-w-[400px] max-h-[400px] bg-brand-crimson/10 rounded-full blur-[100px]" />
      </div>

      <header
        className="z-10 text-center max-w-3xl"
        style={{ marginBottom: '2.5rem' }}
      >
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-3xl md:text-4xl lg:text-5xl font-display font-medium text-slate-900 tracking-tight"
          style={{ marginBottom: '0.75rem' }}
        >
          Explore Our Prospectus
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-base md:text-lg text-slate-500 max-w-2xl mx-auto font-light"
        >
          Discover your future with Rostrum Education. Select a programme below to view the interactive flipbook.
        </motion.p>
      </header>

      <div
        className="flex flex-row w-full max-w-4xl z-10 relative justify-center"
        style={{ gap: '2rem', height: '50vh' }}
      >
        <ProspectusCard
          title="Undergraduate"
          subtitle="2026 Entry"
          pdfSrc="/pdfs/UG26.pdf"
          delay={0.4}
          onClick={() => navigate('/ug')}
          colorClass="hover:border-blue-400"
        />

        <ProspectusCard
          title="Postgraduate"
          subtitle="2026 Entry"
          pdfSrc="/pdfs/PG26.pdf"
          delay={0.5}
          onClick={() => navigate('/pg')}
          colorClass="hover:border-red-400"
        />
      </div>
    </div>
  );
}

function ProspectusCard({ title, subtitle, pdfSrc, onClick, delay, colorClass }) {
  const [thumbnailUrl, setThumbnailUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const generateThumbnail = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({
          url: pdfSrc,
          cMapUrl: '/pdfjs-dist/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs-dist/standard_fonts/',
          wasmUrl: '/pdfjs-dist/wasm/',
          enableXfa: true,
        });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const page = await pdf.getPage(1);
        if (cancelled) return;

        const canvas = document.createElement('canvas');
        const viewport = page.getViewport({ scale: 0.5 });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;

        if (!cancelled) {
          setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.8));
        }
      } catch (err) {
        console.error(`Failed to generate thumbnail for ${pdfSrc}:`, err);
      }
    };

    generateThumbnail();
    return () => { cancelled = true; };
  }, [pdfSrc]);

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      className={`
        h-full flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden
        shadow-sm transition-all duration-300 group hover:-translate-y-1 hover:shadow-xl ${colorClass} text-left
      `}
      style={{ width: 'min(45vw, 280px)' }}
    >
      <div className="w-full relative flex-1 min-h-0 bg-slate-100 overflow-hidden">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`${title} Cover`}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full animate-pulse bg-slate-200" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div
            className="bg-white text-slate-900 shadow-lg rounded-full text-sm font-medium flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-all duration-300"
            style={{ paddingLeft: '1.5rem', paddingRight: '1.5rem', paddingTop: '0.75rem', paddingBottom: '0.75rem' }}
          >
            Read Book
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>
        </div>
      </div>

      <div
        className="flex-shrink-0"
        style={{ padding: '1.5rem' }}
      >
        <h2
          className="text-xs font-semibold text-slate-400 uppercase tracking-wider"
          style={{ marginBottom: '0.5rem' }}
        >
          {subtitle}
        </h2>
        <h3 className="text-lg font-display font-medium text-slate-900 group-hover:text-slate-700 transition-colors">
          {title} Prospectus
        </h3>
      </div>
    </motion.button>
  );
}