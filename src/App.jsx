import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router';
import LandingPage from './components/LandingPage';
import ErrorBoundary from './components/ErrorBoundary';

// pdf.js and react-pageflip are only needed once a prospectus is opened, so
// they stay out of the landing page's bundle.
const Flipbook = lazy(() => import('./components/Flipbook'));

/** Themed backdrop so the viewer route paints instantly while its chunk loads. */
function ViewerFallback({ theme }) {
  useEffect(() => {
    // This fallback rendering is indistinguishable from a stalled chunk, and it
    // satisfies the index.html watchdog, so it has to speak up for itself.
    const timer = setTimeout(() => {
      window.__flipbookReportFatal?.(
        'The viewer never finished loading',
        'The prospectus code was still downloading after 20 seconds. This is ' +
          'usually a dropped or blocked request for one of the app files.'
      );
    }, 20000);
    return () => clearTimeout(timer);
  }, []);

  return <div className={`flipbook-shell flipbook-shell--${theme}`} />;
}

function Viewer({ pdfSrc, title, theme }) {
  return (
    <ErrorBoundary label="the prospectus viewer">
      <Suspense fallback={<ViewerFallback theme={theme} />}>
        {/* key forces a clean remount when switching UG ↔ PG */}
        <Flipbook key={`${theme}:${pdfSrc}`} pdfSrc={pdfSrc} title={title} theme={theme} />
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        <Route
          path="/ug"
          element={
            <Viewer
              pdfSrc="/pdfs/UG26.v2.pdf"
              title="Undergraduate Prospectus 2026"
              theme="ug"
            />
          }
        />

        <Route
          path="/pg"
          element={
            <Viewer
              pdfSrc="/pdfs/PG26.v2.pdf"
              title="Postgraduate Prospectus 2026"
              theme="pg"
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
