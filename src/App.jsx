import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router';
import LandingPage from './components/LandingPage';

// pdf.js and react-pageflip are only needed once a prospectus is opened, so
// they stay out of the landing page's bundle.
const Flipbook = lazy(() => import('./components/Flipbook'));

/** Themed backdrop so the viewer route paints instantly while its chunk loads. */
function ViewerFallback({ theme }) {
  return <div className={`flipbook-shell flipbook-shell--${theme}`} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        <Route
          path="/ug"
          element={
            <Suspense fallback={<ViewerFallback theme="ug" />}>
              <Flipbook
                pdfSrc="/pdfs/UG26.v2.pdf"
                title="Undergraduate Prospectus 2026"
                theme="ug"
              />
            </Suspense>
          }
        />

        <Route
          path="/pg"
          element={
            <Suspense fallback={<ViewerFallback theme="pg" />}>
              <Flipbook
                pdfSrc="/pdfs/PG26.v2.pdf"
                title="Postgraduate Prospectus 2026"
                theme="pg"
              />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
