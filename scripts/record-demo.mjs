// Records a bot-vs-bot match by capturing the game canvas with MediaRecorder in
// headless Chrome, then converts it to MP4 with ffmpeg.
// Usage: node scripts/record-demo.mjs [url] [out.mp4] [maxSeconds]
// Requires a running dev/preview server, Google Chrome (CHROME_PATH) and ffmpeg.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/?bots=0,1&seed=12&hp=60&snails=3';
const out = process.argv[3] ?? 'snails-demo.mp4';
const maxSeconds = Number(process.argv[4] ?? 150);
const chrome = process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome';

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(url, { waitUntil: 'networkidle0' });

const b64 = await page.evaluate(async (maxMs) => {
  const canvas = document.getElementById('game');
  const stream = canvas.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(1000);
  const t0 = performance.now();
  let overAt = 0;
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      const s = window.snails.state;
      if (s.phase === 'gameover' && !overAt) overAt = performance.now();
      if ((overAt && performance.now() - overAt > 3500) || performance.now() - t0 > maxMs) {
        clearInterval(iv);
        resolve();
      }
    }, 100);
  });
  rec.stop();
  await done;
  const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}, maxSeconds * 1000);

await browser.close();
const webm = out.replace(/\.mp4$/, '') + '.webm';
writeFileSync(webm, Buffer.from(b64, 'base64'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log(`wrote ${out}`);
