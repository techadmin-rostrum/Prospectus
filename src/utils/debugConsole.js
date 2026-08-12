/**
 * Load eruda (in-page mobile console) when the URL has ?debug=1.
 * Ask an affected iPhone user to open e.g. https://…/ug?debug=1 and screenshot Console/Network.
 */
export function initDebugConsole() {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') !== '1') return;
  } catch {
    return;
  }

  import('eruda')
    .then((mod) => {
      const eruda = mod.default || mod;
      eruda.init();
      console.info('[flipbook] eruda ready — open the floating gear for Console / Network');
    })
    .catch((err) => {
      console.warn('[flipbook] failed to load eruda', err);
    });
}
