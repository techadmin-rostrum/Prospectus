/**
 * Straight corner-fold shading (not cylindrical).
 * Crease is a straight tilted line; shade/cast strips lock to that line.
 */

import { clipPathFromPoints } from './curl-geometry.js';

export { clipPathFromPoints };
export {
  computeForwardBottomCurl,
  sampleFlipPath,
} from './curl-geometry.js';

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** Kept for API compat — returns points unchanged (straight crease). */
export function roundClipPoints(points) {
  return points;
}

function foldStripMetrics(a, b, thickness) {
  const mx = (a.x + b.x) * 0.5;
  const my = (a.y + b.y) * 0.5;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  return {
    left: mx,
    top: my,
    width: Math.max(24, len + 8),
    height: thickness,
    angle: ang,
  };
}

/** Nudge a fold segment toward a point. */
function offsetFoldToward(a, b, toward, amount) {
  const mx = (a.x + b.x) * 0.5;
  const my = (a.y + b.y) * 0.5;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (nx * (toward.x - mx) + ny * (toward.y - my) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    a: { x: a.x + nx * amount, y: a.y + ny * amount },
    b: { x: b.x + nx * amount, y: b.y + ny * amount },
  };
}

function foldStripStyle(a, b, thickness, background, opacity, extra = {}) {
  if (!a || !b) return { opacity: '0' };
  const m = foldStripMetrics(a, b, thickness);
  return {
    position: 'absolute',
    left: `${m.left}px`,
    top: `${m.top}px`,
    width: `${m.width}px`,
    height: `${m.height}px`,
    marginLeft: `${-m.width / 2}px`,
    marginTop: `${-m.height / 2}px`,
    pointerEvents: 'none',
    opacity: String(opacity),
    background,
    transform: `rotate(${m.angle}rad)`,
    transformOrigin: '50% 50%',
    ...extra,
  };
}

function clipCentroid(curl) {
  if (!curl.clipLocal?.length) return { x: 0, y: 0 };
  return {
    x: curl.clipLocal.reduce((s, pt) => s + pt.x, 0) / curl.clipLocal.length,
    y: curl.clipLocal.reduce((s, pt) => s + pt.y, 0) / curl.clipLocal.length,
  };
}

/**
 * Thin highlight along the straight crease (leaf-local).
 */
export function curlFoldHighlightStyle(curl, opts = {}) {
  if (!curl?.foldLocal) return { opacity: '0' };
  const { intensity = 0.35 } = opts;
  const p = clamp(curl.progress / 100, 0, 1);
  const o = intensity * clamp(Math.sin(p * Math.PI), 0.15, 1);
  const thickness = 10 + p * 6;
  const { a, b } = offsetFoldToward(
    curl.foldLocal.a,
    curl.foldLocal.b,
    clipCentroid(curl),
    thickness * 0.25
  );

  return foldStripStyle(
    a,
    b,
    thickness,
    `linear-gradient(to bottom,
      rgba(255,255,255,0) 0%,
      rgba(255,255,255,${o.toFixed(3)}) 50%,
      rgba(255,255,255,0) 100%)`,
    1
  );
}

/**
 * Thin dark band on the curling sheet along the straight crease.
 */
export function curlFoldShadeStyle(curl, opts = {}) {
  if (!curl?.foldLocal) return { opacity: '0' };
  const { intensity = 0.42 } = opts;
  const p = clamp(curl.progress / 100, 0, 1);
  const o = intensity * clamp(Math.sin(p * Math.PI), 0.15, 1);
  const thickness = 12 + p * 8;
  const { a, b } = offsetFoldToward(
    curl.foldLocal.a,
    curl.foldLocal.b,
    clipCentroid(curl),
    thickness * 0.3
  );

  return foldStripStyle(
    a,
    b,
    thickness,
    `linear-gradient(to bottom,
      rgba(0,0,0,0) 0%,
      rgba(0,0,0,${(o * 0.7).toFixed(3)}) 40%,
      rgba(0,0,0,${o.toFixed(3)}) 55%,
      rgba(0,0,0,0) 100%)`,
    1
  );
}

export function curlShadingGradient() {
  return 'none';
}

export function curlPageSideShadow() {
  return 'none';
}

export function curlLeafDropShadow() {
  return 'none';
}

/**
 * Cast shadow on the flat page — locked ON the crease (tiny offset only).
 */
export function curlDropShadowStyle(curl, pageW, pageH, opts = {}) {
  if (!curl?.foldPage) return { opacity: '0' };
  const { maxOpacity = 0.38, blur = 5 } = opts;

  const opacity = clamp((curl.shadowOpacity ?? 0) * maxOpacity, 0, maxOpacity);
  if (opacity < 0.02) return { opacity: '0' };

  const p = clamp(curl.progress / 100, 0, 1);
  // Thin early; slightly wider mid; taper again as crease stands up at the end.
  const thickness = Math.max(10, Math.min(pageW, pageH) * (0.028 + Math.sin(p * Math.PI) * 0.02));

  const flatToward = {
    x: pageW * 0.5,
    y: pageH * 0.5,
  };
  // Keep cast almost on the crease — gap was the main “misaligned” look.
  const { a, b } = offsetFoldToward(
    curl.foldPage.a,
    curl.foldPage.b,
    flatToward,
    thickness * 0.15
  );

  return foldStripStyle(
    a,
    b,
    thickness,
    `linear-gradient(to bottom,
      rgba(0,0,0,0) 0%,
      rgba(0,0,0,0.42) 45%,
      rgba(0,0,0,0.28) 70%,
      rgba(0,0,0,0) 100%)`,
    opacity,
    { filter: `blur(${blur}px)`, zIndex: '1' }
  );
}
