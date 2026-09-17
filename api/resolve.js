import { preflight, sendJson } from './_shared.js';

// YouTube extraction needs yt-dlp as a subprocess, which serverless hosts do
// not provide (and YouTube blocks most datacenter IPs anyway). Answer with a
// period-accurate message the client shows in an XP dialog.
export default function handler(req, res) {
  if (preflight(req, res)) return;
  sendJson(res, {
    error: 'This hosted copy of Windows Media Player cannot open YouTube addresses. YouTube extraction needs the local server with yt-dlp: clone the repository and run `npm run dev`. Local files and direct .mp3/.ogg/.wav/.m4a URLs work here.',
    code: 'YOUTUBE_UNAVAILABLE_SERVERLESS',
  }, 501);
}
