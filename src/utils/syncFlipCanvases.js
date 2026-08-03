/**
 * Soft page-turns in page-flip clone the DOM with cloneNode(), which does NOT
 * copy canvas pixel data — so the turning leaf looks transparent/empty.
 * Copy rendered pixels from each original page onto any temporary clones.
 */
export function syncFlipCanvases(root = document) {
  const stage = root.querySelector?.('.flipbook-stage') || root;
  const pages = stage.querySelectorAll?.('.page-canvas[data-page]');
  if (!pages?.length) return;

  const byPage = new Map();
  pages.forEach((el) => {
    const key = el.getAttribute('data-page');
    if (!key) return;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(el);
  });

  byPage.forEach((els) => {
    if (els.length < 2) return;

    // Original is first in DOM; page-flip appends the temporary clone after it
    const sourceCanvas = els[0].querySelector('canvas');
    if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) return;

    for (let i = 1; i < els.length; i++) {
      const dest = els[i].querySelector('canvas');
      if (!dest) continue;

      if (dest.width !== sourceCanvas.width || dest.height !== sourceCanvas.height) {
        dest.width = sourceCanvas.width;
        dest.height = sourceCanvas.height;
      }
      dest.style.width = sourceCanvas.style.width || `${sourceCanvas.width}px`;
      dest.style.height = sourceCanvas.style.height || `${sourceCanvas.height}px`;
      dest.style.background = '#ffffff';

      const ctx = dest.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dest.width, dest.height);
      ctx.drawImage(sourceCanvas, 0, 0);
    }
  });
}
