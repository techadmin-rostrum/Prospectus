/**
 * Soft page-turns in page-flip clone the DOM with cloneNode(), which does NOT
 * copy canvas pixel data — so the turning leaf looks transparent/empty.
 *
 * Only paint temporary clones. Never touch the static (--simple) source canvas,
 * and never resize/repaint every frame (that fights WebKit compositing and
 * makes the curl MORE see-through).
 */
export function syncFlipCanvases(root = document) {
  const stage = root.querySelector?.('.flipbook-stage') || root;
  const pages = stage.querySelectorAll?.('.page-canvas[data-page]');
  if (!pages?.length) return false;

  const byPage = new Map();
  pages.forEach((el) => {
    const key = el.getAttribute('data-page');
    if (!key) return;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(el);
  });

  let painted = false;

  byPage.forEach((els) => {
    if (els.length < 2) return;

    // Source = the live page (preferably --simple). Never use a flipping clone.
    let sourceEl = els.find((el) => el.classList.contains('--simple'));
    if (!sourceEl) sourceEl = els[0];
    const sourceCanvas = sourceEl?.querySelector('canvas');
    if (!sourceCanvas || sourceCanvas.width < 2 || sourceCanvas.height < 2) return;

    for (const el of els) {
      if (el === sourceEl) continue;
      // Only fill temporary copies / non-static leaves
      if (el.classList.contains('--simple')) continue;

      const dest = el.querySelector('canvas');
      if (!dest) continue;

      const needsResize =
        dest.width !== sourceCanvas.width || dest.height !== sourceCanvas.height;
      if (needsResize) {
        dest.width = sourceCanvas.width;
        dest.height = sourceCanvas.height;
      }
      dest.style.width = sourceCanvas.style.width || `${sourceCanvas.width}px`;
      dest.style.height = sourceCanvas.style.height || `${sourceCanvas.height}px`;
      dest.style.background = '#ffffff';

      const ctx = dest.getContext('2d', { alpha: false });
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dest.width, dest.height);
      try {
        ctx.drawImage(sourceCanvas, 0, 0);
        painted = true;
        dest.dataset.flipSynced = '1';
      } catch {
        /* keep white fill */
      }
    }
  });

  return painted;
}

/**
 * A few short syncs after the clone appears — not a continuous rAF loop.
 * Repainting the curling canvas every frame blanks the compositor layer on
 * mobile WebKit and makes the page look more transparent.
 */
export function startFlipCanvasSync(root = document) {
  const timers = [0, 0, 16, 32, 64, 120].map((ms) =>
    setTimeout(() => syncFlipCanvases(root), ms)
  );

  return () => {
    timers.forEach(clearTimeout);
  };
}
