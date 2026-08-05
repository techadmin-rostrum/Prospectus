/**
 * Trigger a page-flip from real book-corner coordinates.
 *
 * page-flip's flipNext/flipPrev use window-space y ≈ 1 / pageHeight, which
 * breaks when the book is vertically centered (common on mobile).
 *
 * Portrait covers are special: page-flip's hard rotateY math is landscape-
 * oriented, and it hides the back face of a hard page, so half of every cover
 * swing renders as nothing. We run our own two-faced door instead for every
 * cover transition (front open/close, back open/close).
 */
import { syncFlipCanvases, startFlipCanvasSync } from './syncFlipCanvases';

let coverAnimLock = false;
let coverAnimLockUntil = 0;
let stopSoftSync = null;
const COVER_DOOR_MS = 2600;

/** True while a cover door or soft page-turn is still running. */
export function isFlipBookBusy(pageFlip) {
  if (coverAnimLock && Date.now() < coverAnimLockUntil) return true;
  const state = pageFlip?.getState?.();
  return state === 'flipping' || state === 'user_fold';
}

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

/**
 * react-pageflip builds PageFlip once and never forwards later prop changes,
 * so disableFlipByClick still holds whatever the book mounted with. Lift it
 * for the duration of a flip we asked for ourselves.
 */
function asDeliberateFlip(pageFlip, run) {
  const settings = pageFlip?.getSettings?.();
  if (!settings) {
    run();
    return;
  }
  const guarded = settings.disableFlipByClick;
  settings.disableFlipByClick = false;
  try {
    run();
  } finally {
    settings.disableFlipByClick = guarded;
  }
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

const FACE_CSS = [
  'position:absolute',
  'left:0',
  'top:0',
  'width:100%',
  'height:100%',
  'margin:0',
  'display:block',
  'backface-visibility:hidden',
  '-webkit-backface-visibility:hidden',
].join(';');

/**
 * Swing a portrait cover like a hard board.
 *
 * Front cover hinges on the left (opens to -180°); back cover hinges on the
 * right (opens to +180°) — opposite directions, like a real book.
 *
 * `opening` reveals the target page as the cover rotates away; closing brings
 * the cover down over what's on screen and lands on the target afterwards.
 *
 * Returns:
 *   'ok'     — animation started
 *   'busy'   — another cover door is already running (caller must NOT soft-flip)
 *   'fail'   — couldn't build the door (caller should instant-turn, not soft-flip)
 */
function animateCoverDoor(pageFlip, { coverIndex, targetIndex, opening, hinge = 'left' }) {
  if (!pageFlip) return 'fail';
  if (coverAnimLock) {
    // A live door is running — swallow the click so we never soft-curl a cover.
    if (Date.now() < coverAnimLockUntil) return 'busy';
    // Stale lock (finish never ran) — clean up and continue.
    coverAnimLock = false;
    document.querySelectorAll('.cover-door-clone').forEach((el) => el.remove());
  }

  const nowIndex = pageFlip.getCurrentPageIndex?.() ?? 0;
  let coverEl;
  let measureEl;
  try {
    coverEl = pageFlip.getPage(coverIndex)?.getElement?.();
    // Closing clones a still-hidden cover, so measure the page on screen.
    measureEl = pageFlip.getPage(nowIndex)?.getElement?.();
  } catch {
    return 'fail';
  }
  const stage = measureEl?.closest?.('.flipbook-stage');
  if (!coverEl || !measureEl || !stage) return 'fail';

  const box = measureEl.getBoundingClientRect();
  if (!box.width || !box.height) return 'fail';

  const main = measureEl.closest('.flipbook-main');
  const perspectiveHost = measureEl.closest('.flipbook-perspective') || stage;
  const stageBox = stage.getBoundingClientRect();

  // Left hinge (front): closed 0 → open -180. Right hinge (back): closed 0 → open +180.
  const openAngle = hinge === 'right' ? 180 : -180;
  const startAngle = opening ? 0 : openAngle;
  const endAngle = opening ? openAngle : 0;
  const origin = hinge === 'right' ? 'right center' : 'left center';
  const shadow =
    hinge === 'right'
      ? '2px 0 10px rgba(0,0,0,0.18), -8px 12px 28px rgba(0,0,0,0.22)'
      : '-2px 0 10px rgba(0,0,0,0.18), 8px 12px 28px rgba(0,0,0,0.22)';

  // Drop any leftover clone from a prior interrupted run so we never stack doors.
  stage.querySelectorAll('.cover-door-clone').forEach((el) => el.remove());

  coverAnimLock = true;
  coverAnimLockUntil = Date.now() + COVER_DOOR_MS + 500;
  syncFlipCanvases();

  // page-flip sets hidden pages to cssText="display:none", which is fine for
  // canvas pixels, but make sure density stays hard so a later soft path can't
  // steal the cover.
  try {
    const coverPage = pageFlip.getPage(coverIndex);
    coverPage?.setDensity?.('hard');
    coverPage?.setDrawingDensity?.('hard');
  } catch {
    /* ignore */
  }

  const front = coverEl.cloneNode(true);
  front.classList.add('cover-door-face');
  front.style.cssText = FACE_CSS;
  copyCanvasPixels(coverEl, front);

  const door = document.createElement('div');
  door.className = `cover-door-clone cover-door-clone--${hinge}`;
  door.style.cssText = [
    'position:absolute',
    `left:${box.left - stageBox.left}px`,
    `top:${box.top - stageBox.top}px`,
    `width:${box.width}px`,
    `height:${box.height}px`,
    'margin:0',
    'z-index:40',
    'display:block',
    `transform-origin:${origin}`,
    'transform-style:preserve-3d',
    'transition:none',
    `transform:rotateY(${startAngle}deg)`,
    `box-shadow: ${shadow}`,
    'pointer-events:none',
  ].join(';');
  door.append(front);

  // Closing starts face-away: without a second face the board is invisible for
  // the first half of its arc (backface-hidden) and looks like it teleports in.
  if (!opening) {
    const inside = document.createElement('div');
    inside.className = 'cover-door-face cover-door-face--inside';
    inside.style.cssText = `${FACE_CSS};transform:rotateY(180deg)`;
    door.append(inside);
  }

  main?.classList.add('is-turning', 'is-cover-turning');
  stage.classList.add('is-flipping', 'cover-door-animating');
  if (perspectiveHost) {
    perspectiveHost.style.perspective = '1600px';
    perspectiveHost.style.webkitPerspective = '1600px';
  }

  stage.appendChild(door);
  pageFlip.updateState?.('flipping');
  // Opening reveals the target underneath; closing keeps the current page
  // visible and lands on the target once the board is down.
  if (opening) {
    try {
      pageFlip.turnToPage?.(targetIndex);
    } catch {
      /* keep animating — finish will still unlock */
    }
  }

  void door.offsetWidth;
  door.style.transition = `transform ${COVER_DOOR_MS}ms cubic-bezier(0.22, 0.82, 0.28, 1)`;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      door.style.transform = `rotateY(${endAngle}deg)`;
    });
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try {
      if (!opening) pageFlip.turnToPage?.(targetIndex);
    } catch {
      /* ignore */
    }
    try {
      door.remove();
    } catch {
      /* ignore */
    }
    if (perspectiveHost) {
      perspectiveHost.style.perspective = '';
      perspectiveHost.style.webkitPerspective = '';
    }
    stage.classList.remove('cover-door-animating', 'is-flipping');
    main?.classList.remove('is-turning', 'is-cover-turning');
    try {
      pageFlip.updateState?.('read');
    } catch {
      /* ignore */
    }
    coverAnimLock = false;
  };

  const onEnd = (e) => {
    if (e.target !== door) return;
    if (e.propertyName && e.propertyName !== 'transform') return;
    door.removeEventListener('transitionend', onEnd);
    finish();
  };
  door.addEventListener('transitionend', onEnd);
  setTimeout(finish, COVER_DOOR_MS + 120);
  return 'ok';
}

/**
 * Which cover swing, if any, this move represents in portrait.
 * Returns null for ordinary interior turns.
 */
function coverDoorFor(idx, lastIndex, direction) {
  if (direction === 'next') {
    // Front cover opening — hinge left
    if (idx === 0) {
      return { coverIndex: 0, targetIndex: 1, opening: true, hinge: 'left' };
    }
    // Back cover closing onto the last page — hinge right (opposite)
    if (idx === lastIndex - 1) {
      return { coverIndex: lastIndex, targetIndex: lastIndex, opening: false, hinge: 'right' };
    }
  } else {
    // Front cover closing — hinge left
    if (idx === 1) {
      return { coverIndex: 0, targetIndex: 0, opening: false, hinge: 'left' };
    }
    // Back cover opening (leaving the last page) — hinge right
    if (idx === lastIndex) {
      return { coverIndex: lastIndex, targetIndex: lastIndex - 1, opening: true, hinge: 'right' };
    }
  }
  return null;
}

export function flipBook(pageFlip, direction = 'next') {
  if (!pageFlip) return;

  // Rapid next/prev taps: page-flip calls finishAnimation() and starts another
  // soft flip mid-turn. On mobile that soft-curls the back cover onto screen,
  // then a later cover-door close shows the same end page twice. Swallow taps
  // until the current turn (or cover door) has fully settled.
  if (isFlipBookBusy(pageFlip)) return;

  syncFlipCanvases();

  const render = pageFlip.getRender?.();
  const controller = pageFlip.getFlipController?.();
  const rect = render?.getRect?.();
  const isPortrait = render?.getOrientation?.() === 'portrait';
  const idx = pageFlip.getCurrentPageIndex?.() ?? 0;
  const lastIndex = (pageFlip.getPageCount?.() ?? 1) - 1;

  if (isPortrait && lastIndex >= 1) {
    const door = coverDoorFor(idx, lastIndex, direction);
    if (door) {
      const result = animateCoverDoor(pageFlip, door);
      // Cover transitions must never soft-curl. If a door is already running,
      // ignore the click; if we couldn't build one, jump instantly.
      if (result === 'ok' || result === 'busy') return;
      try {
        pageFlip.turnToPage?.(door.targetIndex);
      } catch {
        /* ignore */
      }
      return;
    }

    // Safety net: never soft-flip onto/off the back cover if coverDoorFor missed
    if (direction === 'next' && idx === lastIndex - 1) {
      const result = animateCoverDoor(pageFlip, {
        coverIndex: lastIndex,
        targetIndex: lastIndex,
        opening: false,
        hinge: 'right',
      });
      if (result === 'ok' || result === 'busy') return;
      try {
        pageFlip.turnToPage?.(lastIndex);
      } catch {
        /* ignore */
      }
      return;
    }
  }

  if (isPortrait) {
    applyFlipDuration(pageFlip, 1400);
  } else if (idx === 0 || idx >= lastIndex - 1) {
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

    asDeliberateFlip(pageFlip, () => controller.flip({ x, y }));
    stopSoftSync?.();
    stopSoftSync = startFlipCanvasSync(document);
    return;
  }

  asDeliberateFlip(pageFlip, () => {
    if (direction === 'prev') pageFlip.flipPrev('bottom');
    else pageFlip.flipNext('bottom');
  });
  stopSoftSync?.();
  stopSoftSync = startFlipCanvasSync(document);
}
