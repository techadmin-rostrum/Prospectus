import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { setCachedPdf, destroyCachedPdf, destroyAllCachedPdfs } from '../utils/pdfCache';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs-dist/build/pdf.worker.min.mjs';

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

/**
 * Serialize getDocument across the app. Overlapping opens of UG + PG on the
 * single shared worker were cross-painting prospectuses after several switches.
 */
let loadChain = Promise.resolve();

function enqueueDocumentLoad(pdfSrc) {
  let loadingTask = null;
  let cancelled = false;

  const promise = new Promise((resolve, reject) => {
    loadChain = loadChain
      .catch(() => {})
      .then(async () => {
        if (cancelled) {
          resolve(null);
          return;
        }
        loadingTask = pdfjsLib.getDocument({
          url: pdfSrc,
          ...PDF_LOAD_OPTIONS,
        });
        try {
          const doc = await loadingTask.promise;
          if (cancelled) {
            try {
              doc.destroy?.();
            } catch {
              /* ignore */
            }
            resolve(null);
            return;
          }
          resolve(doc);
        } catch (err) {
          if (!cancelled) reject(err);
          else resolve(null);
        }
      });
  });

  return {
    promise,
    onProgress(handler) {
      const tryAttach = () => {
        if (loadingTask) {
          loadingTask.onProgress = handler;
          return;
        }
        if (!cancelled) queueMicrotask(tryAttach);
      };
      tryAttach();
    },
    destroy() {
      cancelled = true;
      try {
        loadingTask?.destroy?.();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Always fresh getDocument for this pdfSrc — never reopen a prior session's
 * PDFDocumentProxy (that caused white pages / wrong-book leaks on iOS).
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

    destroyAllCachedPdfs();

    const loadId = ++loadIdRef.current;
    let cancelled = false;
    const task = enqueueDocumentLoad(pdfSrc);

    setLoading(true);
    setProgress(8);
    setError(null);
    setPdfDocument(null);
    setNumPages(0);
    documentRef.current = null;

    task.onProgress(({ loaded, total }) => {
      if (cancelled || loadId !== loadIdRef.current) return;
      if (total > 0) {
        const pct = Math.min(92, Math.round((loaded / total) * 100));
        setProgress((prev) => Math.max(prev, pct));
      } else if (loaded > 0) {
        setProgress((prev) => (prev < 85 ? Math.max(prev, 20) : prev));
      }
    });

    (async () => {
      try {
        const doc = await task.promise;
        if (cancelled || loadId !== loadIdRef.current || !doc) {
          if (doc && (cancelled || loadId !== loadIdRef.current)) {
            try {
              doc.destroy?.();
            } catch {
              /* ignore */
            }
          }
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
      task.destroy();
      documentRef.current = null;
      destroyCachedPdf(pdfSrc);
    };
  }, [pdfSrc]);

  const getPage = useCallback(async (pageNum) => {
    if (!pdfDocument || pageNum < 1 || pageNum > numPages) return null;
    return pdfDocument.getPage(pageNum);
  }, [pdfDocument, numPages]);

  return { pdfDocument, numPages, aspectRatio, loading, progress, error, getPage };
}
