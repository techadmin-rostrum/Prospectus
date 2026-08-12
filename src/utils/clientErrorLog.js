/**
 * POST runtime failures to /api/client-error-log so iPhone crashes show up in
 * Vercel function logs without Safari Web Inspector.
 */
const ENDPOINT = '/api/client-error-log';
const recent = new Set();

function fingerprint(title, message) {
  return `${title}|${String(message).slice(0, 200)}`;
}

export function reportClientError({ title, message, stack, url } = {}) {
  const key = fingerprint(title || 'error', message || '');
  if (recent.has(key)) return;
  recent.add(key);
  setTimeout(() => recent.delete(key), 30_000);

  const payload = JSON.stringify({
    title: title || 'Client error',
    message: message != null ? String(message) : '',
    stack: stack != null ? String(stack) : '',
    url: url || (typeof location !== 'undefined' ? location.href : ''),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    time: new Date().toISOString(),
  });

  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
  } catch {
    /* fall through */
  }

  try {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Wire global handlers (in addition to the fatal overlay in index.html). */
export function installClientErrorReporting() {
  if (typeof window === 'undefined') return;
  if (window.__flipbookClientErrorReporting) return;
  window.__flipbookClientErrorReporting = true;

  window.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (t && t !== window && (t.src || t.href)) {
        reportClientError({
          title: 'Resource load failed',
          message: `${t.tagName}: ${t.src || t.href}`,
        });
        return;
      }
      reportClientError({
        title: 'Script error',
        message: e.message || 'Unknown error',
        stack: e.error?.stack,
      });
    },
    true
  );

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    reportClientError({
      title: 'Unhandled promise rejection',
      message: (r && (r.message || String(r))) || 'Unknown reason',
      stack: r?.stack,
    });
  });

  // Bridge the early ES5 fatal overlay in index.html → same endpoint
  const prev = window.__flipbookReportFatal;
  window.__flipbookReportFatal = function (title, message, stack) {
    reportClientError({ title, message, stack });
    if (typeof prev === 'function') prev(title, message, stack);
  };
}
