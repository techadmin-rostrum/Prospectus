/**
 * Vercel serverless endpoint — receives client-side crash reports from any device.
 * No Express/session stack in this repo; this is the stand-in for /api/client-error-log.
 *
 * Logs Origin, User-Agent, and flags iPhone clients. There is no session cookie
 * in this app (static SPA); we still note Cookie presence for ITP debugging.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const ua = req.headers['user-agent'] || '';
  const origin = req.headers.origin || '';
  const cookieHeader = req.headers.cookie || '';
  const isIPhone = /iPhone|iPod|iPad/i.test(ua);
  const hasCookie = cookieHeader.length > 0;

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = { raw: body };
    }
  }

  const flag =
    isIPhone && !hasCookie
      ? ' [iPhone + no Cookie header — N/A for this cookie-less SPA, but noted]'
      : isIPhone
        ? ' [iPhone]'
        : '';

  // Distinct labels so canvas events aren't conflated with PDF load failures
  const title = body?.title || '';
  const msg = body?.message || '';
  const isCanvasCap = /canvas pixel cap/i.test(title) || /canvas_pixel_cap/.test(msg);
  const isCanvasReleased = /canvas released/i.test(title) || /"kind":"canvas_released"/.test(msg) || /canvas_released/.test(msg);
  const isCleanupSkipped =
    /canvas cleanup skipped/i.test(title) || /canvas_cleanup_skipped/.test(msg);
  const isPdfFail = /PDF failed to load/i.test(title);
  const kindTag = isCanvasCap
    ? ' [kind=canvas_pixel_cap]'
    : isCleanupSkipped
      ? ' [kind=canvas_cleanup_skipped]'
      : isCanvasReleased
        ? ' [kind=canvas_released]'
        : isPdfFail
          ? ' [kind=pdf_load_failure]'
          : '';

  console.error(
    `[client-error-log]${kindTag}${flag}`,
    JSON.stringify({
      origin,
      userAgent: ua,
      hasCookie,
      url: body?.url,
      message: body?.message,
      stack: body?.stack,
      title: body?.title,
      time: new Date().toISOString(),
    })
  );

  return res.status(204).end();
}
