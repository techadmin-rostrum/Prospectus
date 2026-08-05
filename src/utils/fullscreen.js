/**
 * Enter / exit browser fullscreen. Required for hiding the mobile Chrome
 * toolbar. Must run inside a user-gesture handler (tap/click).
 * Returns true if the request was accepted.
 */
export function enterFullscreen(el = document.documentElement) {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    return Promise.resolve(true);
  }

  const target = el || document.documentElement;
  const req =
    target.requestFullscreen?.bind(target) ||
    target.webkitRequestFullscreen?.bind(target) ||
    target.webkitRequestFullScreen?.bind(target) ||
    target.msRequestFullscreen?.bind(target);

  if (!req) return Promise.resolve(false);

  try {
    const result = req.call(target, { navigationUI: 'hide' });
    return Promise.resolve(result)
      .then(() => true)
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function exitFullscreen() {
  if (typeof document === 'undefined') return Promise.resolve(false);
  const exit =
    document.exitFullscreen?.bind(document) ||
    document.webkitExitFullscreen?.bind(document) ||
    document.msExitFullscreen?.bind(document);

  if (!exit || (!document.fullscreenElement && !document.webkitFullscreenElement)) {
    return Promise.resolve(false);
  }

  try {
    return Promise.resolve(exit()).then(() => true).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

/** True for phone-sized viewports (matches Flipbook isMobile). */
export function isPhoneViewport() {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}
