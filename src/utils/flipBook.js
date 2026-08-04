/**
 * Trigger a page-flip from real book-corner coordinates.
 *
 * page-flip's flipNext/flipPrev use window-space y ≈ 1 / pageHeight, which
 * breaks when the book is vertically centered (common on mobile).
 *
 * Portrait hard covers are special: page-flip's rotateY math is landscape-
 * oriented, so the cover image vanishes while only the shadow animates.
 * We run our own door-open for opening the front cover on portrait.
 */
import { syncFlipCanvases } from './syncFlipCanvases';

let coverAnimLock = false;
const COVER_DOOR_MS = 2600;

/**
 * page-flip sets duration = (pathLen / 1000) * flippingTime when pathLen < 1000.
 * Boost flippingTime so wall-clock ≈ targetMs on narrow pages.
 */
export function applyFlipDuration(pageFlip, targetMs) {
  const settings = pageFlip?.getSettings?.();
  if (!settings || !targetMs) return;

  const pageW = pageFlip.getRender?.()?.getRect?.()?.pageWidth || 400;
  const pathEstimate = Math.max(pageW * 2 - pageW * 0.1, 200);

  settings.flippingTime =
    pathEstimate >= 1000
      ? targetMs
      : Math.ceil(targetMs * (1000 / pathEstimate));
}

function copyCanvasPixels(fromEl, toEl) {
  const src = fromEl.querySelector?.('canvas');
  const dst = toEl.querySelector?.('canvas');
  if (!src || !dst || !src.width || !src.height) return;
  dst.width = src.width;
  dst.height = src.height;
  dst.style.width = src.style.width || `${src.width}px`;
  dst.style.height = src.style.height || `${src.height}px`;
  dst.style.background = '#ffffff';
  const ctx = dst.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dst.width, dst.height);
  ctx.drawImage(src, 0, 0);
}

/**
 * Portrait front-cover door open. Clones the cover, reveals page 1 underneath,
 * then swings the clone open like a hard cover.
 */
function animatePortraitCoverOpen(pageFlip) {
  if (coverAnimLock || !pageFlip) return;

  const cover = pageFlip.getPage?.(0);
  const el = cover?.getElement?.();
  if (!el) {
    pageFlip.flipNext?.('bottom');
    return;
  }

  const stage = el.closest('.flipbook-stage');
  const main = el.closest('.flipbook-main');
  const perspectiveHost = el.closest('.flipbook-perspective') || stage;
  if (!stage) {
    pageFlip.flipNext?.('bottom');
    return;
  }

  coverAnimLock = true;
  syncFlipCanvases();

  const elRect = el.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();

  const clone = el.cloneNode(true);
  clone.classList.add('cover-door-clone');
  copyCanvasPixels(el, clone);

  clone.style.cssText = [
    'position:absolute',
    `left:${elRect.left - stageRect.left}px`,
    `top:${elRect.top - stageRect.top}px`,
    `width:${elRect.width}px`,
    `height:${elRect.height}px`,
    'margin:0',
    'z-index:40',
    'display:block',
    'transform-origin:left center',
    'backface-visibility:hidden',
    '-webkit-backface-visibility:hidden',
    'transition:none',
    'transform:rotateY(0deg)',
    'box-shadow: -2px 0 10px rgba(0,0,0,0.18), 8px 12px 28px rgba(0,0,0,0.22)',
    'pointer-events:none',
  ].join(';');

  main?.classList.add('is-turning', 'is-cover-turning');
  stage.classList.add('is-flipping', 'cover-door-animating');
  if (perspectiveHost) {
    perspectiveHost.style.perspective = '1600px';
    perspectiveHost.style.webkitPerspective = '1600px';
  }

  stage.appendChild(clone);
  pageFlip.updateState?.('flipping');
  // Page 1 sits under the swinging cover
  pageFlip.turnToPage?.(1);

  void clone.offsetWidth;
  clone.style.transition = `transform ${COVER_DOOR_MS}ms cubic-bezier(0.22, 0.82, 0.28, 1)`;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      clone.style.transform = 'rotateY(-180deg)';
    });
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clone.remove();
    if (perspectiveHost) {
      perspectiveHost.style.perspective = '';
      perspectiveHost.style.webkitPerspective = '';
    }
    stage.classList.remove('cover-door-animating', 'is-flipping');
    main?.classList.remove('is-turning', 'is-cover-turning');
    pageFlip.updateState?.('read');
    coverAnimLock = false;
  };

  const onEnd = (e) => {
    if (e.target !== clone) return;
    if (e.propertyName && e.propertyName !== 'transform') return;
    clone.removeEventListener('transitionend', onEnd);
    finish();
  };
  clone.addEventListener('transitionend', onEnd);
  setTimeout(finish, COVER_DOOR_MS + 120);
}

export function flipBook(pageFlip, direction = 'next') {
  if (!pageFlip) return;

  syncFlipCanvases();

  const render = pageFlip.getRender?.();
  const controller = pageFlip.getFlipController?.();
  const rect = render?.getRect?.();
  const isPortrait = render?.getOrientation?.() === 'portrait';
  const idx = pageFlip.getCurrentPageIndex?.() ?? 0;

  // Portrait front cover: custom door-open (library hard-flip drops the image)
  if (isPortrait && direction === 'next' && idx === 0) {
    animatePortraitCoverOpen(pageFlip);
    return;
  }

  if (isPortrait) {
    applyFlipDuration(pageFlip, 1400);
  } else if (idx === 0) {
    applyFlipDuration(pageFlip, 1200);
  }

  if (controller && rect && typeof rect.left === 'number') {
    const inset = Math.max(10, Math.min(rect.pageWidth, rect.height) * 0.05);
    const y = rect.top + rect.height - inset;

    let x;
    if (direction === 'prev') {
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
