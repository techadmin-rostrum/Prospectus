/**
 * Fullscreen / immersive helpers.
 *
 * Android Chrome: real Fullscreen API + orientation.lock work.
 * iOS Safari: those APIs are unavailable for web pages — we approximate
 * with visualViewport sizing + a scroll trick to minimize the browser chrome.
 */

export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as Mac with touch
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export function canUseFullscreenAPI() {
  if (typeof document === 'undefined') return false;
  // iOS Safari exposes webkitEnterFullscreen only on <video>, not on html/body
  if (isIOS()) return false;
  const el = document.documentElement;
  return !!(
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    el.webkitRequestFullScreen ||
    el.msRequestFullscreen
  );
}

export function isPhoneViewport() {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

/** Sync layout height to the *visible* viewport (critical on iOS Safari). */
export function syncAppHeight() {
  if (typeof window === 'undefined') return;
  const vv = window.visualViewport;
  const h = Math.round(vv?.height || window.innerHeight);
  const w = Math.round(vv?.width || window.innerWidth);
  document.documentElement.style.setProperty('--app-height', `${h}px`);
  document.documentElement.style.setProperty('--app-width', `${w}px`);
}

/**
 * Enter / exit browser fullscreen. Required for hiding the mobile Chrome
 * toolbar. Must run inside a user-gesture handler (tap/click).
 * Returns true if the request was accepted.
 */
export function enterFullscreen(el = document.documentElement) {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (!canUseFullscreenAPI()) return Promise.resolve(false);
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
  if (typeof document === 'undefined') return false;
  if (document.fullscreenElement || document.webkitFullscreenElement) return true;
  // iOS "immersive" stand-in
  return document.documentElement.classList.contains('flipbook-immersive');
}

/**
 * Best-effort maximize on the current platform.
 * Android → real fullscreen. iOS → immersive layout (no API available).
 */
export async function enterImmersive() {
  if (canUseFullscreenAPI()) {
    const ok = await enterFullscreen();
    if (ok) return 'fullscreen';
  }

  // iOS / unsupported: pin height to visual viewport & nudge Safari chrome up
  document.documentElement.classList.add('flipbook-immersive');
  document.body.classList.add('flipbook-immersive');
  syncAppHeight();
  try {
    window.scrollTo(0, 1);
  } catch {
    /* ignore */
  }
  // Second tick after Safari settles
  requestAnimationFrame(() => {
    syncAppHeight();
    try {
      window.scrollTo(0, 1);
    } catch {
      /* ignore */
    }
  });
  return 'immersive';
}

export async function exitImmersive() {
  if (canUseFullscreenAPI() && (document.fullscreenElement || document.webkitFullscreenElement)) {
    await exitFullscreen();
  }
  document.documentElement.classList.remove('flipbook-immersive');
  document.body.classList.remove('flipbook-immersive');
  syncAppHeight();
  return true;
}

export async function toggleImmersive() {
  if (isFullscreenActive()) {
    await exitImmersive();
    return false;
  }
  await enterImmersive();
  return true;
}

/**
 * Ask the device to switch to landscape.
 * Android (fullscreen): orientation.lock often works.
 * iOS: lock is unsupported — returns false so UI can nudge the user.
 */
export async function lockLandscape() {
  if (typeof screen === 'undefined') return false;

  // Always try immersive first so the layout uses max space
  await enterImmersive();

  if (isIOS()) return false;

  const orientation = screen.orientation;
  const lock =
    orientation?.lock?.bind(orientation) ||
    screen.lockOrientation?.bind(screen) ||
    screen.mozLockOrientation?.bind(screen) ||
    screen.msLockOrientation?.bind(screen);

  if (!lock) return false;

  try {
    await Promise.resolve(lock('landscape'));
    return true;
  } catch {
    try {
      await Promise.resolve(lock('landscape-primary'));
      return true;
    } catch {
      return false;
    }
  }
}
