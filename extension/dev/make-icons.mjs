// Renders the extension icons (16/48/128 px PNG) with the pre-installed Playwright.
//   node extension/dev/make-icons.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../icons');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#1b1f24"/>
  <rect x="18" y="26" width="58" height="76" rx="12" fill="#3a424d"/>
  <rect x="28" y="40" width="38" height="8" rx="4" fill="#8a94a1"/>
  <rect x="28" y="56" width="28" height="8" rx="4" fill="#8a94a1"/>
  <rect x="84" y="26" width="26" height="76" rx="10" fill="#06c755"/>
</svg>`;

const browser = await chromium.launch();
for (const size of [16, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join(out, `icon${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written to', out);
