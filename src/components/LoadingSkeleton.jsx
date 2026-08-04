import { motion } from 'motion/react';

/**
 * Placeholder for the closed cover. Sized from the same measurements the real
 * book uses so it can't overflow the stage or collide with the title, and so
 * there's no jump when the PDF finishes loading.
 */
export default function LoadingSkeleton({ progress = 0, width = 0, height = 0 }) {
  const hasSize = width > 0 && height > 0;

  return (
    <div className="flipbook-skeleton">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="flipbook-skeleton__page shimmer"
        style={
          hasSize
            ? { width: `${width}px`, height: `${height}px` }
            : { width: 'min(72vw, 620px)', aspectRatio: '842 / 595' }
        }
      >
        <div className="flipbook-skeleton__spine" aria-hidden="true" />

        <div className="flipbook-skeleton__progress">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs sm:text-sm text-slate-500 font-body">
              Opening prospectus…
            </span>
            <span className="text-xs sm:text-sm text-slate-400 font-mono">
              {progress}%
            </span>
          </div>
          <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #CE1D47, #2F4DA4)' }}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
