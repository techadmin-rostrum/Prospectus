import { useState, useRef, useCallback, useEffect } from 'react';

const MUTE_KEY = 'flipbook-muted';

/**
 * Real recorded page-turn sounds — played at natural pitch, same way.
 *
 *   /sounds/page-turn.mp3  — interior leaf
 *   /sounds/cover-turn.mp3 — cover open/close (user-provided)
 *
 * Never speed clips up to "fit" the flip (that makes paper sound sharp).
 * Cover clips are shorter than the swing — they start late so the sound
 * finishes with the cover landing (same natural pitch as page turns).
 */
export function useSound() {
  const [isMuted, setIsMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const audioCtxRef = useRef(null);
  const buffersRef = useRef({ page: null, cover: null });
  const loadPromiseRef = useRef(null);
  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }, []);

  const ensureLoaded = useCallback(async () => {
    if (buffersRef.current.page && buffersRef.current.cover) {
      return buffersRef.current;
    }
    if (loadPromiseRef.current) return loadPromiseRef.current;

    loadPromiseRef.current = (async () => {
      const ctx = getAudioContext();
      const loadOne = async (url) => {
        // Cache-bust so a replaced cover-turn.mp3 is picked up after refresh
        const res = await fetch(`${url}?v=3`);
        if (!res.ok) throw new Error(`Failed to load ${url}`);
        const raw = await res.arrayBuffer();
        return ctx.decodeAudioData(raw.slice(0));
      };

      const [page, cover] = await Promise.all([
        loadOne('/sounds/page-turn.mp3'),
        loadOne('/sounds/cover-turn.mp3'),
      ]);
      buffersRef.current = { page, cover };
      return buffersRef.current;
    })().catch((err) => {
      loadPromiseRef.current = null;
      console.warn('[useSound] Could not load page-turn samples:', err);
      return null;
    });

    return loadPromiseRef.current;
  }, [getAudioContext]);

  useEffect(() => {
    const warm = () => {
      ensureLoaded();
    };
    window.addEventListener('pointerdown', warm, { once: true });
    window.addEventListener('keydown', warm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
    };
  }, [ensureLoaded]);

  const playBuffer = useCallback(
    async (kind, durationMs) => {
      if (isMuted || prefersReducedMotion.current) return;

      try {
        const buffers = await ensureLoaded();
        if (!buffers) return;

        const buffer = kind === 'cover' ? buffers.cover : buffers.page;
        if (!buffer) return;

        const ctx = getAudioContext();
        const natural = buffer.duration || 1;
        const flipSec = Math.max(0.35, (durationMs || 900) / 1000);
        const now = ctx.currentTime;

        // Natural pitch for both — never speed up (sounds sharp).
        // Cover flips are longer than the clip: delay so the sound *ends*
        // with the cover landing, instead of finishing mid-swing.
        let startDelay = 0;
        if (kind === 'cover' && flipSec > natural) {
          startDelay = flipSec - natural;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = 1;

        const gain = ctx.createGain();
        const peak = 0.5;
        const t0 = now + startDelay;

        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.linearRampToValueAtTime(peak, t0 + 0.025);
        gain.gain.setValueAtTime(peak, t0 + Math.max(0.05, natural - 0.1));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + natural);

        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(t0);
        source.stop(t0 + natural + 0.03);
      } catch {
        // Audio not supported / autoplay blocked — ignore
      }
    },
    [isMuted, ensureLoaded, getAudioContext]
  );

  const playPageTurn = useCallback(
    (durationMs = 900) => {
      playBuffer('page', durationMs);
    },
    [playBuffer]
  );

  const playCoverTurn = useCallback(
    (durationMs = 1200) => {
      playBuffer('cover', durationMs);
    },
    [playBuffer]
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_KEY, next ? '1' : '0');
      } catch {
        /* private mode */
      }
      if (!next) {
        try {
          getAudioContext();
          // Force reload so a newly replaced cover file is used
          buffersRef.current = { page: null, cover: null };
          loadPromiseRef.current = null;
          ensureLoaded();
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, [getAudioContext, ensureLoaded]);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  return { isMuted, toggleMute, playPageTurn, playCoverTurn };
}
