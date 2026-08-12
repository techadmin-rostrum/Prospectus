import { useState, useEffect, useRef, useCallback } from 'react';
import {
  openPdfDocument,
  closePdfDocument,
  assertDocMatchesSrc,
} from '../utils/pdfSession';
import { setCachedPdf, destroyCachedPdf } from '../utils/pdfCache';

// Re-export for warmPdf / callers that imported options from here
export { PDF_LOAD_OPTIONS } from '../utils/pdfSession';

const DEFAULT_ASPECT = 842 / 595;

/**
 * Load exactly one prospectus. Each open gets its own PDFWorker; destroy is
 * awaited on the session gate before any later open can start.
 */
export function usePdfDocument(pdfSrc) {
  const [pdfDocument, setPdfDocument] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const documentRef = useRef(null);
  const loadIdRef = useRef(0);

  useEffect(() => {
    if (!pdfSrc) return;

    const loadId = ++loadIdRef.current;
    let cancelled = false;

    setLoading(true);
    setProgress(8);
    setError(null);
    setPdfDocument(null);
    setNumPages(0);
    documentRef.current = null;

    const session = openPdfDocument(pdfSrc, {
      onProgress: ({ loaded, total }) => {
        if (cancelled || loadId !== loadIdRef.current) return;
        if (total > 0) {
          const pct = Math.min(92, Math.round((loaded / total) * 100));
          setProgress((prev) => Math.max(prev, pct));
        } else if (loaded > 0) {
          setProgress((prev) => (prev < 85 ? Math.max(prev, 20) : prev));
        }
      },
    });

    (async () => {
      try {
        const result = await session.promise;
        if (cancelled || loadId !== loadIdRef.current) {
          if (result?.doc) await closePdfDocument(result.doc);
          return;
        }
        if (!result?.doc) return;

        const { doc } = result;
        if (!assertDocMatchesSrc(doc, pdfSrc)) {
          await closePdfDocument(doc);
          setError('PDF source mismatch');
          setLoading(false);
          return;
        }

        setCachedPdf(pdfSrc, doc);
        documentRef.current = doc;
        setPdfDocument(doc);
        setNumPages(doc.numPages);
        setAspectRatio(DEFAULT_ASPECT);
        setLoading(false);
        setProgress(100);
        setError(null);

        doc.getPage(1).then((firstPage) => {
          if (cancelled || loadId !== loadIdRef.current) return;
          const viewport = firstPage.getViewport({ scale: 1 });
          if (viewport.width > 0 && viewport.height > 0) {
            setAspectRatio(viewport.width / viewport.height);
          }
        }).catch(() => {});
      } catch (err) {
        if (cancelled || loadId !== loadIdRef.current) return;
        console.error('[usePdfDocument] Failed to load PDF:', err);
        setError(err.message || 'Failed to load PDF');
        setLoading(false);
        try {
          window.__flipbookReportFatal?.(
            'PDF failed to load',
            `${pdfSrc}: ${err.message || err}`,
            err.stack
          );
        } catch {
          /* ignore */
        }
      }
    })();

    return () => {
      cancelled = true;
      session.cancel();
      documentRef.current = null;
      setPdfDocument(null);
      // Clear tracker then await-destroy on the session gate (next open waits).
      const doc = destroyCachedPdf(pdfSrc);
      closePdfDocument(doc);
    };
  }, [pdfSrc]);

  const getPage = useCallback(async (pageNum) => {
    if (!pdfDocument || pageNum < 1 || pageNum > numPages) return null;
    if (!assertDocMatchesSrc(pdfDocument, pdfDocument.__flipbookSrc)) return null;
    return pdfDocument.getPage(pageNum);
  }, [pdfDocument, numPages]);

  return { pdfDocument, numPages, aspectRatio, loading, progress, error, getPage };
}
