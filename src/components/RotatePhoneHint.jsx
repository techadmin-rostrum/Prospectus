import { motion } from 'motion/react';
import { lockLandscape } from '../utils/fullscreen';
import { trackEvent, EVENTS } from '../utils/analytics';

/**
 * Portrait-only hint: tap to request landscape (fullscreen + orientation lock).
 * Matches the doodle rotate icon — big tilted phone, small outer arcs, no text.
 */
export default function RotatePhoneHint({ visible }) {
  if (!visible) return null;

  const onRotate = async () => {
    trackEvent(EVENTS.ROTATE_PROMPT_CLICK);
    await lockLandscape();
  };

  return (
    <motion.button
      type="button"
      className="flipbook-rotate-hint"
      aria-label="Rotate your phone to landscape"
      title="Rotate your phone"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      whileTap={{ scale: 0.94 }}
      onClick={onRotate}
    >
      <span className="flipbook-rotate-hint__swing" aria-hidden="true">
        <svg
          className="flipbook-rotate-hint__svg"
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
        >
          {/*
            Arrows sit on the long sides of the tilted phone (not the short ends).
            Phone at -45°: long sides face upper-right & lower-left.
          */}
          {/* Upper-right long side — clockwise */}
          <path
            d="M 58 12 C 78 14, 94 30, 92 50"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <path
            d="M 97 44 L 92 56 L 84 48"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Lower-left long side — clockwise */}
          <path
            d="M 42 88 C 22 86, 6 70, 8 50"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <path
            d="M 3 56 L 8 44 L 16 52"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Large phone — ~45°, outline only */}
          <rect
            x="35"
            y="20"
            width="30"
            height="60"
            rx="2"
            ry="2"
            transform="rotate(-45 50 50)"
            stroke="currentColor"
            strokeWidth="3.4"
          />
        </svg>
      </span>
    </motion.button>
  );
}
