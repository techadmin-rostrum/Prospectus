import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker — load from our structured static copy
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs-dist/build/pdf.worker.min.mjs';

/**
 * Progressive PDF load options.
 * PDFs are linearized — with range requests + disableAutoFetch, pdf.js can
 * open after the first chunks and only fetch bytes for pages you render.
 */
export const PDF_LOAD_OPTIONS = {
  cMapUrl: '/pdfjs-dist/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs-dist/standard_fonts/',
  wasmUrl: '/pdfjs-dist/wasm/',
  enableXfa: true,
  // Stream + HTTP Range (requires Accept-Ranges from the host)
  disableStream: false,
  disableRange: false,
  // Don't download the rest of the file until pages are requested
  disableAutoFetch: true,
  // Smaller first chunks → faster time-to-first-page on slow networks
  rangeChunkSize: 65536,
};

/**
 * Hook to load and cache a PDF document via pdfjs-dist.
 * Returns the document proxy, page count, loading state, and download progress.
 *
 * @param {string} pdfSrc - URL path to the PDF file (e.g., '/pdfs/UG26.pdf')
 */
export function usePdfDocument(pdfSrc) {
  const [pdfDocument, setPdfDocument] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(1 / 1.414);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const loadedSrcRef = useRef(null);
  const documentRef = useRef(null);

  useEffect(() => {
    if (!pdfSrc) return;

    if (loadedSrcRef.current === pdfSrc && documentRef.current) {
      setPdfDocument(documentRef.current);
      setNumPages(documentRef.current.numPages);
      setLoading(false);
      setProgress(100);
      return;
    }

    let cancelled = false;
    let loadingTask = null;

    const loadPdf = async () => {
      setLoading(true);
      setProgress(0);
      setError(null);
      setPdfDocument(null);
      setNumPages(0);

      try {
        loadingTask = pdfjsLib.getDocument({
          url: pdfSrc,
          ...PDF_LOAD_OPTIONS,
        });

        loadingTask.onProgress = ({ loaded, total }) => {
          if (cancelled) return;
          if (total > 0) {
            // With range/auto-fetch off, "total" is file size but loaded is
            // only what we've pulled so far — cap UI so it doesn't look stuck.
            const pct = Math.min(95, Math.round((loaded / total) * 100));
            setProgress((prev) => Math.max(prev, pct));
          } else if (loaded > 0) {
            setProgress((prev) => (prev < 90 ? Math.max(prev, 15) : prev));
          }
        };

        const doc = await loadingTask.promise;
        if (cancelled) {
          doc.destroy?.();
          return;
        }

        // First page metadata is enough to size the book and paint the cover
        let aspect = 1 / 1.414;
        try {
          const firstPage = await doc.getPage(1);
          const viewport = firstPage.getViewport({ scale: 1 });
          aspect = viewport.width / viewport.height;
        } catch (e) {
          console.warn('Failed to get page 1 aspect ratio', e);
        }

        if (!cancelled) {
          loadedSrcRef.current = pdfSrc;
          documentRef.current = doc;
          setPdfDocument(doc);
          setNumPages(doc.numPages);
          setAspectRatio(aspect);
          setLoading(false);
          setProgress((prev) => Math.max(prev, 100));
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[usePdfDocument] Failed to load PDF:', err);
          setError(err.message || 'Failed to load PDF');
          setLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      try {
        loadingTask?.destroy?.();
      } catch {
        // ignore
      }
    };
  }, [pdfSrc]);

  const getPage = useCallback(async (pageNum) => {
    if (!pdfDocument || pageNum < 1 || pageNum > numPages) return null;
    return pdfDocument.getPage(pageNum);
  }, [pdfDocument, numPages]);

  return { pdfDocument, numPages, aspectRatio, loading, progress, error, getPage };
}
