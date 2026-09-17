import { json, preflight } from './_shared.js';

export default function handler(req) {
  if (req.method === 'OPTIONS') return preflight();
  return json({
    ok: true,
    serverless: true,
    ytdlp: null,
    ffmpeg: false,
    capabilities: { youtube: false, proxy: true },
    message: 'Hosted build: local files and direct audio URLs work here. YouTube links need the local server (npm run dev) with yt-dlp.',
  });
}
