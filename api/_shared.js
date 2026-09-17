// Helpers shared by the Vercel serverless functions in this directory.
// These functions stand in for server/index.js when the app is deployed
// statically (Vercel, Netlify-style hosts). yt-dlp is not available there.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
};

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}
