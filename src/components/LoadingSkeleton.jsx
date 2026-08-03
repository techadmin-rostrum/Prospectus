import { motion } from 'motion/react';

export default function LoadingSkeleton({ progress = 0 }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="flex gap-0 relative"
        style={{ filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.12))' }}
      >
        <div
          className="shimmer rounded-l-lg border border-slate-200"
          style={{
            width: 'min(40vw, 400px)',
            height: 'min(56vw, 560px)',
            background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
            boxShadow: 'inset -8px 0 16px -8px rgba(0,0,0,0.15)',
          }}
        />
        <div
          className="shimmer rounded-r-lg border border-slate-200 border-l-0"
          style={{
            width: 'min(40vw, 400px)',
            height: 'min(56vw, 560px)',
            background: 'linear-gradient(135deg, #e2e8f0 0%, #f1f5f9 100%)',
            boxShadow: 'inset 8px 0 16px -8px rgba(0,0,0,0.15)',
          }}
        />
      </motion.div>

      <div className="w-64 max-w-[80vw]">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-white/70 font-body">
            Opening prospectus…
          </span>
          <span className="text-sm text-white/50 font-mono">
            {progress}%
          </span>
        </div>
        <div className="h-1 bg-white/15 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, #CE1D47, #2F4DA4)' }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>
      </div>
    </div>
  );
}