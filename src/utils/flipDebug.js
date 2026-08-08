/**
 * Temporary navigation instrumentation.
 *
 * Off unless the URL carries `?debug=flip`, so it costs nothing normally:
 *   http://localhost:5173/pg?debug=flip
 *
 * The interesting line is `call:updateFromHtml` — that is StPageFlip tearing
 * down and rebuilding every Page object. It is invisible from the React side
 * and should only ever appear on load or on a resize, never on a page turn.
 */

let enabled = null;
let seq = 0;

export function flipDebugEnabled() {
  if (enabled === null) {
    enabled =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debug') === 'flip';
  }
  return enabled;
}

export function nextAnimationId(prefix = 'turn') {
  seq += 1;
  return `${prefix}#${seq}`;
}

export function flipLog(event, pageFlip, extra = {}) {
  if (!flipDebugEnabled()) return;

  let currentIndex = null;
  let pageFlipState = null;
  try {
    currentIndex = pageFlip?.getCurrentPageIndex?.() ?? null;
    pageFlipState = pageFlip?.getState?.() ?? null;
  } catch {
    /* instance torn down mid-call */
  }

  console.log('[flip]', {
    event,
    currentIndex,
    pageFlipState,
    timestamp: Math.round(performance.now()),
    ...extra,
  });
}

/**
 * Shadows the instance methods that move the book so every navigation shows up
 * in order, including the ones React triggers behind our back.
 */
export function instrumentPageFlip(pageFlip) {
  if (!flipDebugEnabled() || !pageFlip || pageFlip.__flipInstrumented) return;
  pageFlip.__flipInstrumented = true;

  ['updateFromHtml', 'turnToPage', 'flipNext', 'flipPrev', 'flip', 'updateState']
    .forEach((name) => {
      const original = pageFlip[name];
      if (typeof original !== 'function') return;

      pageFlip[name] = function instrumented(...args) {
        flipLog(`call:${name}`, pageFlip, {
          args: args.map((a) => (typeof a === 'object' ? '<obj>' : a)),
        });
        return original.apply(this, args);
      };
    });
}
