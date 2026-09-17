import { Readable } from 'node:stream';
import { applyCors, preflight, sendJson } from './_shared.js';

// Streaming CORS proxy for direct audio URLs, with HTTP Range passthrough so
// the <audio> element can seek. Mirrors GET /api/proxy in server/index.js.
export const config = { supportsResponseStreaming: true };

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  const target = new URL(req.url, 'http://localhost').searchParams.get('url') || '';
  let u;
  try {
    u = new URL(target);
    if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
  } catch {
    return sendJson(res, { error: 'The address is not a valid http(s) URL.' }, 400);
  }
  // Refuse to proxy loopback / private networks.
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/.test(u.hostname)) {
    return sendJson(res, { error: 'That address cannot be proxied.' }, 400);
  }

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 5.1) WindowsMediaPlayer/9.0', 'Accept-Encoding': 'identity' };
  if (req.headers.range) headers['Range'] = req.headers.range;

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  let upstream;
  try {
    upstream = await fetch(u, { headers, redirect: 'follow', signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) return;
    return sendJson(res, { error: 'Windows Media Player cannot connect to the server.', detail: String(e?.message || e) }, 502);
  }
  if (!upstream.ok && upstream.status !== 206) {
    return sendJson(res, { error: `The server returned HTTP ${upstream.status}.` }, 502);
  }

  applyCors(res);
  res.statusCode = upstream.status;
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'HEAD' || !upstream.body) return res.end();
  const stream = Readable.fromWeb(upstream.body);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
