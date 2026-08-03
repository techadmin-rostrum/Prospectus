/**
 * Trigger a page-flip from real book-corner coordinates.
 *
 * page-flip's flipNext/flipPrev use window-space y ≈ 1 / pageHeight, which
 * breaks when the book is vertically centered (common on mobile). That makes
 * prev/next feel different and less like a real page curl.
 */
import { syncFlipCanvases } from './syncFlipCanvases';

export function flipBook(pageFlip, direction = 'next') {
  if (!pageFlip) return;

  // Soft turns clone canvases — copy pixels before the animation starts
  syncFlipCanvases();

  const render = pageFlip.getRender?.();
  const controller = pageFlip.getFlipController?.();
  const rect = render?.getRect?.();

  if (controller && rect && typeof rect.left === 'number') {
    const inset = Math.max(10, Math.min(rect.pageWidth, rect.height) * 0.05);
    const isPortrait = render.getOrientation?.() === 'portrait';
    // Bottom corner = natural finger-flick curl (same feel for next & prev)
    const y = rect.top + rect.height - inset;

    let x;
    if (direction === 'prev') {
      // Portrait: visible leaf is the right half — hit its left (spine) edge
      // Landscape: hit the left leaf
      x = isPortrait
        ? rect.left + rect.pageWidth + inset
        : rect.left + inset;
    } else {
      x = rect.left + rect.width - inset;
    }

    controller.flip({ x, y });
    requestAnimationFrame(() => syncFlipCanvases());
    return;
  }

  if (direction === 'prev') pageFlip.flipPrev('bottom');
  else pageFlip.flipNext('bottom');
  requestAnimationFrame(() => syncFlipCanvases());
}
