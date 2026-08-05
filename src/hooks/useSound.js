import { useState, useRef, useCallback, useEffect } from 'react';

const MUTE_KEY = 'flipbook-muted';

let sharedPageAudio = null;
let sharedCoverAudio = null;
let sharedUnlocked = false;

function getSharedAudio() {
  if (typeof Audio === 'undefined') return { page: null, cover: null };
  if (!sharedPageAudio) {
    sharedPageAudio = new Audio('/sounds/page-turn.mp3?v=4');
    sharedPageAudio.preload = 'auto';
    sharedPageAudio.setAttribute('playsinline', '');
    try {
      sharedPageAudio.load();
    } catch {
      /* ignore */
    }
  }
  if (!sharedCoverAudio) {
    sharedCoverAudio = new Audio('/sounds/cover-turn.mp3?v=4');
    sharedCoverAudio.preload = 'auto';
    sharedCoverAudio.setAttribute('playsinline', '');
    try {
      sharedCoverAudio.load();
    } catch {
      /* ignore */
    }
  }
  return { page: sharedPageAudio, cover: sharedCoverAudio };
}

/**
 * Call from any user gesture (landing tap, first touch). Unlocks iOS Safari
 * so later page-flip play() calls succeed without a fresh gesture.
 */
export function unlockFlipbookAudio() {
  if (sharedUnlocked || typeof window === 'undefined') return;
  const { page, cover } = getSharedAudio();

  const kick = (el) => {
    if (!el) return Promise.resolve();
    el.muted = true;
    el.volume = 0;
    const p = el.play();
    if (p && typeof p.then === 'function') {
      return p
        .then(() => {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
          el.volume = 1;
        })
        .catch(() => {
          el.muted = false;
          el.volume = 1;
        });
    }
    el.pause();
    el.currentTime = 0;
    el.muted = false;
    el.volume = 1;
    return Promise.resolve();
  };

  Promise.all([kick(page), kick(cover)]).then(() => {
    sharedUnlocked = true;
  });
}

/**
 * Page / cover turn sounds via HTMLAudioElement.
 *
 * iOS Safari blocks audio until a gesture. HTMLAudio + early unlock on first
 * tap is reliable on both iPhone and Android (Web Audio + await was silent).
 */
export function useSound() {
  const [isMuted, setIsMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const coverTimerRef = useRef(null);
  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const unlockAudio = useCallback(() => {
    unlockFlipbookAudio();
  }, []);

  useEffect(() => {
    // Warm elements early; unlock still needs a gesture
    getSharedAudio();
    const warm = () => unlockFlipbookAudio();
    window.addEventListener('pointerdown', warm, { once: true, passive: true });
    window.addEventListener('touchstart', warm, { once: true, passive: true });
    window.addEventListener('keydown', warm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('touchstart', warm);
      window.removeEventListener('keydown', warm);
    };
  }, []);

  const playClip = useCallback(
    (kind, durationMs) => {
      if (isMuted || prefersReducedMotion.current) return;

      unlockFlipbookAudio();
      const { page, cover } = getSharedAudio();
      const el = kind === 'cover' ? cover : page;
      if (!el) return;

      if (coverTimerRef.current) {
        clearTimeout(coverTimerRef.current);
        coverTimerRef.current = null;
      }

      const natural =
        el.duration && Number.isFinite(el.duration)
          ? el.duration
          : kind === 'cover'
            ? 0.7
            : 1.2;
      const flipSec = Math.max(0.35, (durationMs || 900) / 1000);

      let delayMs = 0;
      if (kind === 'cover' && flipSec > natural) {
        delayMs = Math.round((flipSec - natural) * 1000);
      }

      const start = () => {
        try {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
          el.volume = kind === 'cover' ? 0.85 : 0.75;
          const p = el.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch {
          /* ignore */
        }
      };

      if (delayMs > 0) {
        coverTimerRef.current = setTimeout(start, delayMs);
      } else {
        start();
      }
    },
    [isMuted]
  );

  const playPageTurn = useCallback(
    (durationMs = 900) => playClip('page', durationMs),
    [playClip]
  );

  const playCoverTurn = useCallback(
    (durationMs = 1200) => playClip('cover', durationMs),
    [playClip]
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_KEY, next ? '1' : '0');
      } catch {
        /* private mode */
      }
      if (!next) unlockFlipbookAudio();
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (coverTimerRef.current) clearTimeout(coverTimerRef.current);
    };
  }, []);

  return { isMuted, toggleMute, playPageTurn, playCoverTurn, unlockAudio };
}
