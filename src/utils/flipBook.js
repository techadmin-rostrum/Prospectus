/**
 * Flipbook navigation and custom portrait page transitions.
 *
 * Important:
 * - The custom portrait curl is rendered by an overlay clone.
 * - The underlying PageFlip page is switched with a near-instant internal
 *   transition so it cannot compete with the custom curl.
 * - Previous-page mirroring is applied only to the host, never twice.
 * - Canvas synchronization is stopped during the custom turn and restarted
 *   after the overlay is removed.
 */

import { syncFlipCanvases, startFlipCanvasSync } from './syncFlipCanvases';
import { flipLog, nextAnimationId } from './flipDebug';
import {
  computeForwardBottomCurl,
  computeFlatRemainder,
  sampleFlipPath,
  clipPathFromPoints,
  curlFoldHighlightStyle,
  curlFoldShadeStyle,
  curlDropShadowStyle,
} from './softCurl';

let coverAnimLock = false;
let coverAnimLockUntil = 0;
let stopSoftSync = null;

// Settles the custom overlay turn that is running right now, if any. Lets a
// second tap end the current animation early instead of waiting it out.
let activeTurnFinish = null;

function finishActiveTurn() {
  const finish = activeTurnFinish;
  if (!finish) return false;

  activeTurnFinish = null;
  finish();
  return true;
}

const COVER_DOOR_MS = 2600;
const SOFT_CURL_MS = 2200;

// Tapping again mid-turn should feel like hurrying the book along rather than
// snapping it. Each tap drops the next turn onto a shorter rung — for the
// interior curl that reads as 2200ms, then ~1600, ~1200, ~840, ~600.
const TURN_SPEED_RUNGS = [1, 0.73, 0.55, 0.38, 0.27];

// A rush that goes quiet for this long relaxes back to a full-length turn.
const RUSH_IDLE_MS = 1500;

let rushRung = 0;
let lastRushAt = 0;

function relaxRushIfIdle() {
  if (rushRung && Date.now() - lastRushAt > RUSH_IDLE_MS) rushRung = 0;
}

function hurryTurns() {
  relaxRushIfIdle();
  lastRushAt = Date.now();
  rushRung = Math.min(rushRung + 1, TURN_SPEED_RUNGS.length - 1);
}

function turnDuration(baseMs) {
  relaxRushIfIdle();
  return Math.round(baseMs * TURN_SPEED_RUNGS[rushRung]);
}

export function isFlipBookBusy(pageFlip) {
  if (coverAnimLock && Date.now() < coverAnimLockUntil) return true;

  const state = pageFlip?.getState?.();
  return state === 'flipping' || state === 'user_fold';
}

/**
 * Undo whatever the library left mid-turn.
 *
 * page-flip resets the flipping page and its shadows inside the flip-animation
 * callback, and that callback starts with `if (!this.calc) return`. Interrupting
 * a turn — a queued jump landing on top of one, or a new turn starting early —
 * skips the whole block. The render loop then keeps re-drawing that page from
 * its frozen mid-turn state every frame — a rotated sliver with a diagonal
 * clip edge — and keeps painting its shadow down the gutter.
 *
 * Only safe once the book is idle; see scheduleShadowSweep.
 */
function settleFlipRender(pageFlip) {
  try {
    const render = pageFlip?.getRender?.();
    if (!render) return;

    // Order matters only in that all three must happen: drawFrame() re-draws
    // flippingPage from its frozen state on every frame it is non-null, and
    // draws the shadows for as long as both it and `shadow` are set.
    render.setFlippingPage?.(null);
    render.setBottomPage?.(null);
    render.clearShadow?.();
  } catch {
    /* render not built yet */
  }
}

/**
 * Switch the library's current page without allowing a second visible
 * native animation to compete with our custom overlay animation.
 */
function turnToPageInstant(pageFlip, targetIndex) {
  if (!pageFlip?.turnToPage) return;

  const settings = pageFlip.getSettings?.();
  if (!settings) {
    pageFlip.turnToPage(targetIndex);
    settleFlipRender(pageFlip);
    return;
  }

  const previousFlippingTime = settings.flippingTime;

  try {
    // PageFlip calculates duration from this setting. A very small value
    // makes the underlying page settle immediately beneath our overlay.
    settings.flippingTime = 1;
    pageFlip.turnToPage(targetIndex);
  } finally {
    settings.flippingTime = previousFlippingTime;
  }

  // An instant jump bypasses the animation callback entirely, so nothing
  // would otherwise take down the shadow from the turn it interrupted.
  settleFlipRender(pageFlip);
}

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
  const src = fromEl?.querySelector?.('canvas');
  const dst = toEl?.querySelector?.('canvas');
  if (!src || !dst || !src.width || !src.height) return;

  dst.width = src.width;
  dst.height = src.height;
  dst.style.width = src.style.width || `${src.width}px`;
  dst.style.height = src.style.height || `${src.height}px`;
  dst.style.background = '#ffffff';

  const ctx = dst.getContext('2d', { alpha: false });
  if (!ctx) return;

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

function clearTransitionOverlays(stage) {
  stage?.querySelectorAll?.(
    '.portrait-soft-mirror, .portrait-soft-leaf, .portrait-prev-mirror, ' +
    '.portrait-prev-leaf, .portrait-prev-shadow, .cover-door-clone'
  ).forEach((el) => el.remove());
}

function animateCoverDoor(
  pageFlip,
  { coverIndex, targetIndex, opening, hinge = 'left' }
) {
  if (!pageFlip) return 'fail';

  if (coverAnimLock) {
    if (Date.now() < coverAnimLockUntil) return 'busy';
    coverAnimLock = false;
    document.querySelectorAll('.cover-door-clone').forEach((el) => el.remove());
  }

  const nowIndex = pageFlip.getCurrentPageIndex?.() ?? 0;
  let coverEl;
  let measureEl;

  try {
    coverEl = pageFlip.getPage(coverIndex)?.getElement?.();
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

  const openAngle = hinge === 'right' ? 180 : -180;
  const startAngle = opening ? 0 : openAngle;
  const endAngle = opening ? openAngle : 0;
  const origin = hinge === 'right' ? 'right center' : 'left center';
  const shadow = hinge === 'right'
    ? '2px 0 10px rgba(0,0,0,0.18), -8px 12px 28px rgba(0,0,0,0.22)'
    : '-2px 0 10px rgba(0,0,0,0.18), 8px 12px 28px rgba(0,0,0,0.22)';

  stage.querySelectorAll('.cover-door-clone').forEach((el) => el.remove());

  const doorMs = turnDuration(COVER_DOOR_MS);
  const animationId = nextAnimationId('door');
  flipLog('door:start', pageFlip, {
    animationId, coverIndex, targetIndex, opening, hinge, doorMs,
  });

  coverAnimLock = true;
  coverAnimLockUntil = Date.now() + doorMs + 500;

  stopSoftSync?.();
  stopSoftSync = null;
  syncFlipCanvases();

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
    `box-shadow:${shadow}`,
    'pointer-events:none',
  ].join(';');

  door.append(front);

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

  // Switch the underlying page instantly while the cloned cover is already
  // visible above it. This prevents a visible native page jump.
  if (opening) {
    try {
      turnToPageInstant(pageFlip, targetIndex);
    } catch {
      /* finish still unlocks the book */
    }
  }

  void door.offsetWidth;
  door.style.transition =
    `transform ${doorMs}ms cubic-bezier(0.22,0.82,0.28,1)`;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      door.style.transform = `rotateY(${endAngle}deg)`;
    });
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (activeTurnFinish === finish) activeTurnFinish = null;

    if (!opening) {
      try {
        turnToPageInstant(pageFlip, targetIndex);
      } catch {
        /* ignore */
      }
    }

    door.remove();

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
    stopSoftSync = startFlipCanvasSync(document);
    flipLog('door:finish', pageFlip, { animationId, targetIndex });
  };

  const onEnd = (event) => {
    if (event.target !== door) return;
    if (event.propertyName && event.propertyName !== 'transform') return;
    door.removeEventListener('transitionend', onEnd);
    finish();
  };

  door.addEventListener('transitionend', onEnd);
  setTimeout(finish, doorMs + 120);
  activeTurnFinish = finish;

  return 'ok';
}

function animatePortraitSoftCurl(pageFlip, direction = 'next') {
  if (!pageFlip) return 'fail';

  if (coverAnimLock) {
    if (Date.now() < coverAnimLockUntil) return 'busy';
    coverAnimLock = false;
    document.querySelectorAll(
      '.portrait-soft-mirror, .portrait-soft-leaf, .portrait-prev-mirror, .portrait-prev-leaf'
    ).forEach((el) => el.remove());
  }

  const idx = pageFlip.getCurrentPageIndex?.() ?? 0;
  const lastIndex = (pageFlip.getPageCount?.() ?? 1) - 1;
  const goingPrev = direction === 'prev';
  const targetIndex = goingPrev ? idx - 1 : idx + 1;

  if (targetIndex < 0 || targetIndex > lastIndex) return 'fail';

  let currEl;
  try {
    currEl = pageFlip.getPage(idx)?.getElement?.();
  } catch {
    return 'fail';
  }

  const stage = currEl?.closest?.('.flipbook-stage');
  if (!currEl || !stage) return 'fail';

  const box = currEl.getBoundingClientRect();
  if (!box.width || !box.height) return 'fail';

  const animationId = nextAnimationId('curl');
  flipLog('curl:start', pageFlip, {
    animationId, direction, targetIndex, coverAnimLock,
  });

  const stageBox = stage.getBoundingClientRect();
  const main = currEl.closest('.flipbook-main');
  const w = box.width;
  const h = box.height;
  const left = box.left - stageBox.left;
  const top = box.top - stageBox.top;

  clearTransitionOverlays(stage);

  const curlMs = turnDuration(SOFT_CURL_MS);

  coverAnimLock = true;
  coverAnimLockUntil = Date.now() + curlMs + 500;

  // Stop all background canvas copying while the old page is being cloned.
  stopSoftSync?.();
  stopSoftSync = null;
  syncFlipCanvases();

  // Both directions run the same turn: the current page peels away and the
  // target is revealed underneath. prev only differs by mirroring the host, so
  // the peel runs from the opposite edge.
  const sheetEl = currEl;

  // The host is mirrored for prev so the peel runs from the opposite edge;
  // counter-mirror the artwork so the page itself still reads the right way.
  const cloneCss = [
    'display:block',
    'width:100%',
    'height:100%',
    goingPrev ? 'transform:scaleX(-1)' : 'transform:none',
    'transform-origin:center',
    'background:#fff',
  ].join(';');

  const pageClone = sheetEl.cloneNode(true);
  pageClone.className = 'portrait-soft-page';
  pageClone.style.cssText = cloneCss;
  copyCanvasPixels(sheetEl, pageClone);

  // Second copy of the same sheet, clipped to the part that has not lifted.
  // Without it the book underneath is visible from frame one, which reads as
  // the page changing instantly on click and then curling to reveal itself.
  const flatClone = sheetEl.cloneNode(true);
  flatClone.className = 'portrait-soft-page';
  flatClone.style.cssText = cloneCss;
  copyCanvasPixels(sheetEl, flatClone);

  const flat = document.createElement('div');
  flat.className = 'portrait-soft-flat';
  flat.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    `width:${w}px`,
    `height:${h}px`,
    'margin:0',
    'pointer-events:none',
    'background:#fff',
    'overflow:hidden',
    'z-index:1',
  ].join(';');
  flat.append(flatClone);

  const shade = document.createElement('div');
  shade.className = 'portrait-soft-shade';
  shade.style.cssText =
    'position:absolute;pointer-events:none;z-index:2;opacity:0';

  const pageShade = document.createElement('div');
  pageShade.className = 'portrait-soft-page-shade';
  pageShade.style.cssText =
    'position:absolute;pointer-events:none;z-index:3;opacity:0';

  const leaf = document.createElement('div');
  leaf.className = 'portrait-soft-leaf';
  leaf.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    `width:${w}px`,
    `height:${h}px`,
    'margin:0',
    'transform-origin:0 0',
    'pointer-events:none',
    'background:#fff',
    'overflow:visible',
    'z-index:3',
  ].join(';');
  leaf.append(pageClone, shade, pageShade);

  const castShadow = document.createElement('div');
  castShadow.className = 'portrait-soft-cast';
  castShadow.style.cssText =
    'position:absolute;left:0;top:0;pointer-events:none;opacity:0;z-index:2';

  const host = document.createElement('div');
  host.className = 'portrait-soft-mirror';
  host.style.cssText = [
    'position:absolute',
    `left:${left}px`,
    `top:${top}px`,
    `width:${w}px`,
    `height:${h}px`,
    'margin:0',
    'z-index:41',
    'overflow:visible',
    goingPrev ? 'transform:scaleX(-1)' : 'transform:none',
    'transform-origin:center',
    'pointer-events:none',
  ].join(';');
  host.append(flat, castShadow, leaf);

  main?.classList.add('is-turning', 'is-soft-curling');
  stage.classList.add('is-flipping', 'is-soft-curling');

  const html = document.documentElement;
  const body = document.body;
  const previousHtmlOverflow = html.style.overflow;
  const previousBodyOverflow = body.style.overflow;

  html.classList.add('flipbook-soft-curling');
  body.classList.add('flipbook-soft-curling');
  html.style.overflow = 'hidden';
  body.style.overflow = 'hidden';

  // Cover the book with the sheet before touching the library index, so the
  // instant switch underneath is never visible. The first paint() below runs
  // in this same task, so the browser cannot render an unclipped frame.
  stage.append(host);
  void host.offsetWidth;
  pageFlip.updateState?.('flipping');

  try {
    turnToPageInstant(pageFlip, targetIndex);
  } catch {
    /* keep the custom overlay running */
  }

  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
  const T_START = 0.18;
  const T_END = 0.995;

  const applyShadowStyles = (styles) => {
    Object.assign(castShadow.style, styles);
  };

  const paint = (tCurl, fade = 1) => {
    const t = Math.max(T_START * 0.85, tCurl);
    const localPos = sampleFlipPath(w, h, t);
    const curl = computeForwardBottomCurl(
      w,
      h,
      { x: localPos.x, y: localPos.y },
      localPos.t ?? t
    );

    if (!curl || curl.clipLocal.length < 3 || (localPos.t ?? t) > 0.999) {
      // Sheet fully gone: uncover the book completely.
      leaf.style.opacity = '0';
      flat.style.opacity = '0';
      shade.style.opacity = '0';
      pageShade.style.opacity = '0';
      castShadow.style.opacity = '0';
      return;
    }

    leaf.style.opacity = String(fade);

    // The still-flat half of the sheet keeps hiding the book underneath.
    const remainder = computeFlatRemainder(w, h, curl);
    if (remainder.length >= 3) {
      const flatClip = clipPathFromPoints(remainder);
      flat.style.clipPath = flatClip;
      flat.style.webkitClipPath = flatClip;
      flat.style.opacity = String(fade);
    } else {
      flat.style.opacity = '0';
    }

    const clip = clipPathFromPoints(curl.clipLocal);
    leaf.style.clipPath = clip;
    leaf.style.webkitClipPath = clip;
    leaf.style.transform =
      `translate3d(${curl.activeCorner.x}px,${curl.activeCorner.y}px,0) ` +
      `rotate(${curl.angle}rad)`;
    leaf.style.filter = 'none';

    Object.assign(shade.style, curlFoldHighlightStyle(curl));
    Object.assign(pageShade.style, curlFoldShadeStyle(curl, { intensity: 0.4 }));
    applyShadowStyles(curlDropShadowStyle(curl, w, h));
    castShadow.style.opacity = String((parseFloat(castShadow.style.opacity) || 0) * fade);
  };

  // The peel path asymptotes: a sliver of the sheet is still on the page when
  // time runs out. Dissolve it over the last stretch instead of cutting it,
  // which is what made the next page appear with no transition.
  const FADE_FROM = 0.88;
  const fadeAt = (u) =>
    (u <= FADE_FROM ? 1 : Math.max(0, 1 - (u - FADE_FROM) / (1 - FADE_FROM)));

  paint(T_START, fadeAt(0));

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (activeTurnFinish === finish) activeTurnFinish = null;

    host.remove();
    stage.classList.remove('is-flipping', 'is-soft-curling');
    main?.classList.remove('is-turning', 'is-soft-curling');
    html.classList.remove('flipbook-soft-curling');
    body.classList.remove('flipbook-soft-curling');
    html.style.overflow = previousHtmlOverflow;
    body.style.overflow = previousBodyOverflow;

    try {
      pageFlip.updateState?.('read');
    } catch {
      /* ignore */
    }

    coverAnimLock = false;
    stopSoftSync = startFlipCanvasSync(document);
    flipLog('curl:finish', pageFlip, { animationId, targetIndex });
  };

  const start = performance.now();

  const tick = (now) => {
    if (finished) return;

    const u = Math.min(1, (now - start) / curlMs);
    paint(T_START + (T_END - T_START) * ease(u), fadeAt(u));

    if (u < 1) requestAnimationFrame(tick);
    else finish();
  };

  activeTurnFinish = finish;
  requestAnimationFrame(tick);
  return 'ok';
}

function coverDoorFor(idx, lastIndex, direction) {
  if (direction === 'next') {
    if (idx === 0) {
      return { coverIndex: 0, targetIndex: 1, opening: true, hinge: 'left' };
    }

    if (idx === lastIndex - 1) {
      return {
        coverIndex: lastIndex,
        targetIndex: lastIndex,
        opening: false,
        hinge: 'right',
      };
    }
  } else {
    if (idx === 1) {
      return { coverIndex: 0, targetIndex: 0, opening: false, hinge: 'left' };
    }

    if (idx === lastIndex) {
      return {
        coverIndex: lastIndex,
        targetIndex: lastIndex - 1,
        opening: true,
        hinge: 'right',
      };
    }
  }

  return null;
}

export function flipBook(pageFlip, direction = 'next') {
  if (!pageFlip) return;
  flipLog('flipBook:enter', pageFlip, { direction, coverAnimLock });
  if (isFlipBookBusy(pageFlip)) return;

  // Start every turn from a clean slate — the previous one may have been cut
  // short before the library got to tidy up — and sweep again once it settles.
  settleFlipRender(pageFlip);
  scheduleShadowSweep(pageFlip);

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
      if (result === 'ok' || result === 'busy') return;

      try {
        turnToPageInstant(pageFlip, door.targetIndex);
      } catch {
        /* ignore */
      }
      return;
    }

    if (direction === 'next' && idx === lastIndex - 1) {
      const result = animateCoverDoor(pageFlip, {
        coverIndex: lastIndex,
        targetIndex: lastIndex,
        opening: false,
        hinge: 'right',
      });

      if (result === 'ok' || result === 'busy') return;

      try {
        turnToPageInstant(pageFlip, lastIndex);
      } catch {
        /* ignore */
      }
      return;
    }

    if (direction === 'next' || direction === 'prev') {
      const result = animatePortraitSoftCurl(pageFlip, direction);
      if (result === 'ok' || result === 'busy') return;

      try {
        turnToPageInstant(
          pageFlip,
          direction === 'prev' ? idx - 1 : idx + 1
        );
      } catch {
        /* ignore */
      }
      return;
    }
  }

  if (isPortrait) {
    applyFlipDuration(pageFlip, 2200);
  } else if (idx === 0 || idx >= lastIndex - 1) {
    applyFlipDuration(pageFlip, 1200);
  }

  try {
    if (idx > 0 && idx < lastIndex) {
      pageFlip.getPage(idx)?.setDrawingDensity?.('soft');
    }

    const other = direction === 'prev' ? idx - 1 : idx + 1;
    if (other > 0 && other < lastIndex) {
      pageFlip.getPage(other)?.setDrawingDensity?.('soft');
    }
  } catch {
    /* ignore */
  }

  if (controller && rect && typeof rect.left === 'number') {
    const inset = Math.max(10, Math.min(rect.pageWidth, rect.height) * 0.05);
    const y = rect.top + rect.height - inset;

    const x = direction === 'prev'
      ? isPortrait
        ? rect.left + rect.pageWidth + inset
        : rect.left + inset
      : rect.left + rect.width - inset;

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

/* ---------------------------------------------------------------------------
   Turn queue

   A turn cannot be interrupted — the custom cover/curl animations own the DOM
   until they finish. So instead of ignoring clicks made mid-turn, we remember
   them and act once the book is free.
--------------------------------------------------------------------------- */

let queuedTurns = 0;
let queueRaf = 0;
let queueDeadline = 0;

// If a turn never reports 'read' (interrupted animation, backgrounded tab),
// drop the backlog rather than flipping long after the user stopped clicking.
const QUEUE_MAX_WAIT_MS = 6000;

let sweepRaf = 0;
let sweepDeadline = 0;

/**
 * Once the book stops moving, take down any shadow that outlived its turn.
 * Clicking again is not required — the band would otherwise sit there.
 */
function scheduleShadowSweep(pageFlip) {
  if (sweepRaf) return;
  sweepDeadline = Date.now() + 8000;

  const step = () => {
    const state = pageFlip?.getState?.();
    const settling =
      isFlipBookBusy(pageFlip) || state === 'fold_corner' || queuedTurns !== 0;

    if (settling && Date.now() < sweepDeadline) {
      sweepRaf = requestAnimationFrame(step);
      return;
    }

    sweepRaf = 0;
    settleFlipRender(pageFlip);
  };

  sweepRaf = requestAnimationFrame(step);
}

export function cancelQueuedFlips() {
  queuedTurns = 0;
  rushRung = 0;
  if (sweepRaf) cancelAnimationFrame(sweepRaf);
  sweepRaf = 0;
  activeTurnFinish = null;
  if (queueRaf) cancelAnimationFrame(queueRaf);
  queueRaf = 0;
}

function flushQueue(pageFlip) {
  const pending = queuedTurns;
  queuedTurns = 0;
  if (!pending) return;

  // A single queued turn still gets the full page-curl animation.
  if (Math.abs(pending) === 1) {
    flipBook(pageFlip, pending > 0 ? 'next' : 'prev');
    return;
  }

  // Several clicks stacked up: the reader wants to get there, not to watch one
  // animation per click. Count in spreads, not pages — a landscape turn moves
  // two pages at once, so one click is not one page index.
  const count = pageFlip.getPageCount?.() ?? 0;
  const spreads = pageFlip.getPageCollection?.();
  if (!count || !spreads) return;

  const spreadOf = (page) => spreads.getSpreadIndexByPage?.(page);
  const currentSpread = spreads.getCurrentSpreadIndex?.() ?? 0;
  const lastSpread = spreadOf(count - 1);
  if (typeof lastSpread !== 'number') return;

  const targetSpread = Math.max(0, Math.min(lastSpread, currentSpread + pending));
  if (targetSpread === currentSpread) return;

  for (let page = 0; page < count; page += 1) {
    if (spreadOf(page) === targetSpread) {
      turnToPageInstant(pageFlip, page);
      return;
    }
  }
}

function pumpQueue(pageFlip) {
  if (queueRaf) return;

  const step = () => {
    queueRaf = 0;
    if (!queuedTurns) return;

    if (Date.now() > queueDeadline) {
      queuedTurns = 0;
      return;
    }

    if (isFlipBookBusy(pageFlip)) {
      queueRaf = requestAnimationFrame(step);
      return;
    }

    flushQueue(pageFlip);
  };

  queueRaf = requestAnimationFrame(step);
}

/**
 * Page turn that never drops a click. Turns requested while the book is busy
 * are queued, so clicking faster moves through the book faster.
 */
export function requestFlip(pageFlip, direction = 'next') {
  if (!pageFlip) return;
  flipLog('requestFlip', pageFlip, {
    direction, queuedTurns, busy: isFlipBookBusy(pageFlip),
  });

  if (!isFlipBookBusy(pageFlip)) {
    flipBook(pageFlip, direction);
    return;
  }

  queuedTurns += direction === 'prev' ? -1 : 1;
  queueDeadline = Date.now() + QUEUE_MAX_WAIT_MS;
  hurryTurns();

  // Phone turns are custom overlay animations running 2.2-2.6s, far longer
  // than a desktop flip. Sitting through one makes every extra tap look
  // ignored, so settle the running turn now and act on the tap immediately.
  if (finishActiveTurn() && !isFlipBookBusy(pageFlip)) {
    flushQueue(pageFlip);
    return;
  }

  pumpQueue(pageFlip);
}