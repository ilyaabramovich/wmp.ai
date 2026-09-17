// Helpers shared by the Vercel serverless functions in this directory.
// These functions stand in for server/index.js when the app is deployed
// statically. yt-dlp is not available there. Handlers use the Node.js
// (req, res) signature, which Vercel's Node runtime supports unambiguously.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
};

export function applyCors(res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

export function sendJson(res, body, status = 200) {
  applyCors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Returns true (and ends the response) for CORS preflight. */
export function preflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  applyCors(res);
  res.statusCode = 204;
  res.end();
  return true;
}
