import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook for page-turn sound effect using Web Audio API.
 *
 * Generates a paper-rustle that tracks a full page turn.
 * Can be muted/unmuted. Respects prefers-reduced-motion.
 */
export function useSound() {
  const [isMuted, setIsMuted] = useState(true);
  const audioCtxRef = useRef(null);
  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtxRef.current;
  }, []);

  /**
   * Play a page-turn rustle timed to span most of the flip animation.
   */
  const playPageTurn = useCallback(() => {
    if (isMuted || prefersReducedMotion.current) return;

    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      // Match interior flip duration (~900ms) so sound rides with the turn
      const duration = 0.85;
      const now = ctx.currentTime;

      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      let last = 0;
      for (let i = 0; i < bufferSize; i++) {
        const t = i / bufferSize;
        // Brown-ish noise (smoother than white) for paper texture
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        // Louder in the middle of the turn, softer at start/end
        const envelope = Math.sin(Math.PI * t);
        data[i] = last * 3.2 * envelope;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(1200, now);
      band.frequency.exponentialRampToValueAtTime(2800, now + 0.22);
      band.frequency.exponentialRampToValueAtTime(1600, now + duration);
      band.Q.value = 0.55;

      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 4000;
      high.gain.value = -6;

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.055, now + 0.05);
      gainNode.gain.linearRampToValueAtTime(0.07, now + 0.28);
      gainNode.gain.linearRampToValueAtTime(0.035, now + 0.55);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

      source.connect(band);
      band.connect(high);
      high.connect(gainNode);
      gainNode.connect(ctx.destination);

      source.start(now);
      source.stop(now + duration);
    } catch {
      // Audio not supported — silently ignore
    }
  }, [isMuted, getAudioContext]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  return { isMuted, toggleMute, playPageTurn };
}
