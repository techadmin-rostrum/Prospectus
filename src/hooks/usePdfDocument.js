import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { getCachedPdf, setCachedPdf, destroyCachedPdf } from '../utils/pdfCache';

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
  disableStream: false,
  disableRange: false,
  disableAutoFetch: true,
  rangeChunkSize: 131072,
};

const DEFAULT_ASPECT = 842 / 595;

/** Reject cached docs that can no longer serve page 1 (stale after iOS teardown). */
async function cachedDocIsUsable(doc) {
  if (!doc || typeof doc.getPage !== 'function') return false;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 0.05 });
    return viewport.width > 0 && viewport.height > 0;
  } catch {
    return false;
  }
}

/**
 * Hook to load and cache a PDF document via pdfjs-dist.
 */
export function usePdfDocument(pdfSrc) {
  const [pdfDocument, setPdfDocument] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const documentRef = useRef(null);

  useEffect(() => {
    if (!pdfSrc) return;

    let cancelled = false;
    let loadingTask = null;

    const applyDoc = (doc) => {
      documentRef.current = doc;
      setPdfDocument(doc);
      setNumPages(doc.numPages);
      setAspectRatio(DEFAULT_ASPECT);
      setLoading(false);
      setProgress(100);
      setError(null);
    };

    const loadFromNetwork = async () => {
      setLoading(true);
      setProgress(8);
      setError(null);
      setPdfDocument(null);
      setNumPages(0);

      loadingTask = pdfjsLib.getDocument({
        url: pdfSrc,
        ...PDF_LOAD_OPTIONS,
      });

      loadingTask.onProgress = ({ loaded, total }) => {
        if (cancelled) return;
        if (total > 0) {
          const pct = Math.min(92, Math.round((loaded / total) * 100));
          setProgress((prev) => Math.max(prev, pct));
        } else if (loaded > 0) {
          setProgress((prev) => (prev < 85 ? Math.max(prev, 20) : prev));
        }
      };

      const doc = await loadingTask.promise;
      if (cancelled) {
        try {
          doc.destroy?.();
        } catch {
          /* ignore */
        }
        return;
      }

      setCachedPdf(pdfSrc, doc);
      applyDoc(doc);

      doc.getPage(1).then((firstPage) => {
        if (cancelled) return;
        const viewport = firstPage.getViewport({ scale: 1 });
        if (viewport.width > 0 && viewport.height > 0) {
          setAspectRatio(viewport.width / viewport.height);
        }
      }).catch(() => {});
    };

    const loadPdf = async () => {
      try {
        // Warm handoff from landing — only if the doc still answers getPage(1).
        const cached = getCachedPdf(pdfSrc);
        if (cached) {
          const ok = await cachedDocIsUsable(cached);
          if (cancelled) return;
          if (ok) {
            applyDoc(cached);
            return;
          }
          // Stale after a previous Flipbook session on iOS — drop and reload.
          destroyCachedPdf(pdfSrc);
        }

        await loadFromNetwork();
      } catch (err) {
        if (!cancelled) {
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
