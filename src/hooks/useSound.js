import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook for page-turn sound effect using Web Audio API.
 * 
 * Generates a subtle paper-rustling sound programmatically
 * (no external audio file needed). Can be muted/unmuted.
 * Respects prefers-reduced-motion.
 */
export function useSound() {
  const [isMuted, setIsMuted] = useState(true); // Start muted by default
  const audioCtxRef = useRef(null);
  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  // Initialize AudioContext lazily (requires user gesture)
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtxRef.current;
  }, []);

  /**
   * Play a subtle page-turn sound effect.
   * Synthesized using filtered noise — sounds like paper rustling.
   */
  const playPageTurn = useCallback(() => {
    if (isMuted || prefersReducedMotion.current) return;

    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const duration = 0.25;
      const now = ctx.currentTime;

      // Create noise buffer (white noise filtered to sound like paper)
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.3;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      // Bandpass filter to shape it like paper
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 3000;
      filter.Q.value = 0.5;

      // Envelope — quick attack, fast decay
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

      source.connect(filter);
      filter.connect(gainNode);
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

  // Cleanup audio context on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  return { isMuted, toggleMute, playPageTurn };
}
