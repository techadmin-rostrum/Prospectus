import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker — load from our structured static copy
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs-dist/build/pdf.worker.min.mjs';

/**
 * Hook to load and cache a PDF document via pdfjs-dist.
 * Returns the document proxy, page count, loading state, and download progress.
 * 
 * @param {string} pdfSrc - URL path to the PDF file (e.g., '/pdfs/UG26.pdf')
 * @returns {{ pdfDocument, numPages, loading, progress, error }}
 */
export function usePdfDocument(pdfSrc) {
  const [pdfDocument, setPdfDocument] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(1 / 1.414);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  // Cache ref to avoid re-loading the same PDF
  const loadedSrcRef = useRef(null);
  const documentRef = useRef(null);

  useEffect(() => {
    if (!pdfSrc) return;

    // Skip if we've already loaded this exact PDF
    if (loadedSrcRef.current === pdfSrc && documentRef.current) {
      setPdfDocument(documentRef.current);
      setNumPages(documentRef.current.numPages);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadPdf = async () => {
      setLoading(true);
      setProgress(0);
      setError(null);

      try {
        const loadingTask = pdfjsLib.getDocument({
          url: pdfSrc,
          // Point to local copies of assets to fix image rendering and missing font issues
          cMapUrl: '/pdfjs-dist/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs-dist/standard_fonts/',
          wasmUrl: '/pdfjs-dist/wasm/',
          enableXfa: true,
        });

        // Track download progress
        loadingTask.onProgress = ({ loaded, total }) => {
          if (total > 0 && !cancelled) {
            setProgress(Math.round((loaded / total) * 100));
          }
        };

        const doc = await loadingTask.promise;
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
          setProgress(100);
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
    };
  }, [pdfSrc]);

  /**
   * Get a single page proxy (cached internally by PDF.js).
   * @param {number} pageNum - 1-indexed page number
   */
  const getPage = useCallback(async (pageNum) => {
    if (!pdfDocument || pageNum < 1 || pageNum > numPages) return null;
    return pdfDocument.getPage(pageNum);
  }, [pdfDocument, numPages]);

  return { pdfDocument, numPages, aspectRatio, loading, progress, error, getPage };
}
