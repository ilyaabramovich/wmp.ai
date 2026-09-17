import { CORS, json, preflight } from './_shared.js';

// Streaming CORS proxy for direct audio URLs, with HTTP Range passthrough so
// the <audio> element can seek. Mirrors GET /api/proxy in server/index.js.
export default async function handler(req) {
  if (req.method === 'OPTIONS') return preflight();
  const target = new URL(req.url).searchParams.get('url') || '';
  let u;
  try {
    u = new URL(target);
    if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
  } catch {
    return json({ error: 'The address is not a valid http(s) URL.' }, 400);
  }
  // Refuse to proxy ourselves or private networks.
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/.test(u.hostname)) {
    return json({ error: 'That address cannot be proxied.' }, 400);
  }

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 5.1) WindowsMediaPlayer/9.0', 'Accept-Encoding': 'identity' };
  const range = req.headers.get('range');
  if (range) headers['Range'] = range;

  let upstream;
  try {
    upstream = await fetch(u, { headers, redirect: 'follow', signal: req.signal });
  } catch (e) {
    return json({ error: 'Windows Media Player cannot connect to the server.', detail: String(e?.message || e) }, 502);
  }
  if (!upstream.ok && upstream.status !== 206) {
    return json({ error: `The server returned HTTP ${upstream.status}.` }, 502);
  }

  const out = new Headers(CORS);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has('accept-ranges')) out.set('accept-ranges', 'bytes');
  out.set('cache-control', 'no-store');
  return new Response(req.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}
