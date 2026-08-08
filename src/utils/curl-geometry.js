/**
 * Soft-curl geometry (FORWARD + bottom corner) — paper peel math.
 * Used by softCurl.js shading helpers and flipBook portrait animation.
 */

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function rotatedPoint(point, origin, angle) {
  return {
    x: point.x * Math.cos(angle) + point.y * Math.sin(angle) + origin.x,
    y: point.y * Math.cos(angle) - point.x * Math.sin(angle) + origin.y,
  };
}

function limitToCircle(center, radius, point) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= radius || dist < 1e-6) return point;
  const k = radius / dist;
  return { x: center.x + dx * k, y: center.y + dy * k };
}

function intersectSegments(a1, a2, b1, b2) {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-6) return null;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Clip an infinite-ish segment to the page rect; returns endpoints on/inside bounds. */
function clampSegmentToRect(a, b, pageW, pageH) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (
    clip(-dx, a.x) &&
    clip(dx, pageW - a.x) &&
    clip(-dy, a.y) &&
    clip(dy, pageH - a.y) &&
    t0 <= t1
  ) {
    return {
      a: { x: a.x + t0 * dx, y: a.y + t0 * dy },
      b: { x: a.x + t1 * dx, y: a.y + t1 * dy },
    };
  }
  return null;
}

/**
 * @returns {{
 *   angle: number,
 *   activeCorner: {x:number,y:number},
 *   clipLocal: {x:number,y:number}[],
 *   progress: number,
 *   shadowPos: {x:number,y:number},
 *   shadowAngle: number,
 *   shadowOpacity: number,
 *   foldPage: {a:{x:number,y:number},b:{x:number,y:number}},
 *   foldLocal: {a:{x:number,y:number},b:{x:number,y:number}},
 * } | null}
 */
export function computeForwardBottomCurl(pageW, pageH, localPos, t = null) {
  let pos = { x: localPos.x, y: localPos.y };

  pos = limitToCircle({ x: 0, y: pageH }, pageW, pos);

  const left = pageW - pos.x + 1;
  const top = pageH - pos.y;
  const hyp = Math.sqrt(top * top + left * left);
  if (hyp < 1) return null;

  const ratio = clamp(left / hyp, -1, 1);

  let rawAngle = 2 * Math.acos(ratio);
  if (top < 0) rawAngle = -rawAngle;
  const da = Math.PI - rawAngle;
  if (!Number.isFinite(rawAngle) || (da >= 0 && da < 0.003)) return null;
  rawAngle = -rawAngle;

  const base = [
    { x: 0, y: -pageH },
    { x: pageW, y: -pageH },
    { x: 0, y: 0 },
    { x: pageW, y: 0 },
  ];
  const rect = {
    topLeft: rotatedPoint(base[0], pos, rawAngle),
    topRight: rotatedPoint(base[1], pos, rawAngle),
    bottomLeft: rotatedPoint(base[2], pos, rawAngle),
    bottomRight: rotatedPoint(base[3], pos, rawAngle),
  };

  let topIntersect = intersectSegments(rect.topLeft, rect.topRight, { x: 0, y: 0 }, { x: pageW, y: 0 });
  let sideIntersect = intersectSegments(pos, rect.topLeft, { x: pageW, y: 0 }, { x: pageW, y: pageH });
  let bottomIntersect = intersectSegments(
    rect.bottomLeft,
    rect.bottomRight,
    { x: 0, y: pageH },
    { x: pageW, y: pageH }
  );

  const ok = (p) => p && p.x >= -2 && p.x <= pageW + 2 && p.y >= -2 && p.y <= pageH + 2;
  if (!ok(topIntersect)) topIntersect = null;
  if (!ok(sideIntersect)) sideIntersect = null;
  if (!ok(bottomIntersect)) bottomIntersect = null;

  const area = [];
  area.push(rect.topLeft);
  if (topIntersect) area.push(topIntersect);
  if (sideIntersect) area.push(sideIntersect);
  if (bottomIntersect) area.push(bottomIntersect);
  area.push(rect.bottomLeft);

  const drawAngle = -rawAngle;
  const activeCorner = rect.topLeft;

  const clipLocal = area.filter(Boolean).map((p) => {
    const g = { x: p.x - activeCorner.x, y: p.y - activeCorner.y };
    return rotatedPoint(g, { x: 0, y: 0 }, drawAngle);
  });

  const progress =
    t !== null && t !== undefined
      ? clamp(t, 0, 1) * 100
      : Math.abs(((pos.x - pageW) / (2 * pageW)) * 100);

  // Crease = straight segment through the page-edge intersections.
  // Prefer top↔bottom when both exist (upright finish); else first↔last hit.
  let foldA = null;
  let foldB = null;
  if (topIntersect && bottomIntersect) {
    foldA = topIntersect;
    foldB = bottomIntersect;
  } else if (sideIntersect && bottomIntersect) {
    foldA = sideIntersect;
    foldB = bottomIntersect;
  } else if (topIntersect && sideIntersect) {
    foldA = topIntersect;
    foldB = sideIntersect;
  } else {
    const foldPoints = [topIntersect, sideIntersect, bottomIntersect].filter(Boolean);
    foldA = foldPoints[0] || null;
    foldB = foldPoints.length > 1 ? foldPoints[foldPoints.length - 1] : null;
  }

  // If only one hit, extend along the fold direction (perpendicular bisector angle).
  if (foldA && !foldB) {
    const dirX = Math.cos(Math.PI / 2 + drawAngle);
    const dirY = Math.sin(Math.PI / 2 + drawAngle);
    const span = Math.hypot(pageW, pageH);
    foldB = { x: foldA.x + dirX * span, y: foldA.y + dirY * span };
    foldA = { x: foldA.x - dirX * span, y: foldA.y - dirY * span };
  }

  if (!foldA || !foldB) return null;

  // Clamp crease segment to the page so shade/cast don't float off-canvas.
  const crease = clampSegmentToRect(foldA, foldB, pageW, pageH);
  if (crease) {
    foldA = crease.a;
    foldB = crease.b;
  }

  const shadowPos = {
    x: (foldA.x + foldB.x) * 0.5,
    y: (foldA.y + foldB.y) * 0.5,
  };
  const shadowAngle = Math.atan2(foldB.y - foldA.y, foldB.x - foldA.x);
  const p = progress / 100;
  // Fade shadow out as the page finishes leaving (end used to look muddy).
  const shadowOpacity = clamp(Math.sin(p * Math.PI) * (p < 0.85 ? 1 : (1 - p) / 0.15), 0, 1);

  const toLocal = (pt) => {
    const g = { x: pt.x - activeCorner.x, y: pt.y - activeCorner.y };
    return rotatedPoint(g, { x: 0, y: 0 }, drawAngle);
  };

  return {
    angle: drawAngle,
    activeCorner,
    clipLocal,
    progress,
    shadowPos,
    shadowAngle,
    shadowOpacity,
    foldPage: { a: foldA, b: foldB },
    foldLocal: { a: toLocal(foldA), b: toLocal(foldB) },
  };
}

/** t: 0 flat → 1 gone.
 *  Early: tilted dog-ear from bottom-right.
 *  Late: crease stands up (near-vertical) and the corner exits off the left.
 */
export function sampleFlipPath(pageW, pageH, t) {
  const margin = Math.max(6, Math.min(pageW, pageH) * 0.03);
  const start = { x: pageW - margin, y: pageH - margin };
  // Tilted peel through the lower-middle of the page.
  const mid = { x: pageW * 0.28, y: pageH * 0.62 };
  // Finish: off-left, near bottom so the crease becomes upright then leaves.
  const end = { x: -pageW * 0.95, y: pageH * 0.92 };

  const tt = easeInOutCubic(clamp(t, 0, 1));
  const omt = 1 - tt;

  return {
    x: omt * omt * start.x + 2 * omt * tt * mid.x + tt * tt * end.x,
    y: omt * omt * start.y + 2 * omt * tt * mid.y + tt * tt * end.y,
    t: tt,
  };
}

/**
 * The part of the sheet that has NOT peeled yet, in page coordinates.
 *
 * `computeForwardBottomCurl` only describes the folded flap. Anything that
 * draws the turning sheet needs this half too, otherwise whatever sits under
 * the sheet shows through from the very first frame.
 *
 * The crease splits the page into two half-planes; the remainder is the page
 * rect clipped to the half the lifted corner is not on.
 */
export function computeFlatRemainder(pageW, pageH, curl) {
  if (!curl?.foldPage) return [];

  const { a, b } = curl.foldPage;
  const nx = -(b.y - a.y);
  const ny = b.x - a.x;
  const side = (p) => (p.x - a.x) * nx + (p.y - a.y) * ny;

  // Anchor on the page's own bottom-right corner: it is the corner being
  // lifted, so it stays on the folded side for the whole peel. curl.activeCorner
  // is a vertex of the flap polygon, so it sits *on* the crease and its sign
  // flips partway through — which swaps the two halves mid-animation.
  const peelSide = side({ x: pageW, y: pageH });
  if (Math.abs(peelSide) < 1e-9) return [];
  const sign = peelSide > 0 ? -1 : 1;
  const inside = (p) => side(p) * sign >= 0;

  const crossing = (p, q) => {
    const sp = side(p);
    const d = sp - side(q);
    if (Math.abs(d) < 1e-9) return p;
    const tt = sp / d;
    return { x: p.x + (q.x - p.x) * tt, y: p.y + (q.y - p.y) * tt };
  };

  // Sutherland–Hodgman against the single crease edge.
  const poly = [
    { x: 0, y: 0 },
    { x: pageW, y: 0 },
    { x: pageW, y: pageH },
    { x: 0, y: pageH },
  ];

  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);

    if (curIn) {
      if (!prevIn) out.push(crossing(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(crossing(prev, cur));
    }
  }

  return out;
}

export function clipPathFromPoints(points) {
  if (!points?.length) return 'polygon(0% 0%, 0% 0%, 0% 0%)';
  return `polygon(${points.map((p) => `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(', ')})`;
}
