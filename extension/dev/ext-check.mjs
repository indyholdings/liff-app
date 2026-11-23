// Loads the real unpacked extension in Chromium and checks the MV3 shell end to end:
// manifest, content-script injection on https://chat.line.biz/*, the chrome-extension:// panel iframe,
// chrome.storage, API calls from the extension origin, and composer insertion.
// chat.line.biz itself is not contacted: requests to it are answered with the stand-in page.
//
//   node extension/dev/ext-check.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startMockServer, DEMO_TOKEN } from './mock-api.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

const server = await startMockServer(0);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-ext-'));
const errors = [];
let ctx;
let ok = false;

try {
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', // full Chromium in new headless mode, which can load extensions
    headless: true,
    viewport: { width: 1360, height: 860 },
    deviceScaleFactor: 2,
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT],
  });

  // Serve the stand-in page for chat.line.biz, minus the tags that load content.js and the chrome shim:
  // here the real extension injects content.js itself.
  const html = fs.readFileSync(path.join(HERE, 'fake-chat.html'), 'utf8')
    .replace('<script src="/extension/content.js"></script>', '');
  const chatJs = fs.readFileSync(path.join(HERE, 'fake-chat.js'), 'utf8').split('// ---- tiny single-page chat console ----')[1];
  await ctx.route('https://chat.line.biz/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/extension/dev/fake-chat.js') return route.fulfill({ contentType: 'text/javascript', body: '// ----' + chatJs });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console error: ' + m.text()); });
  await page.goto('https://chat.line.biz/Ufakeoa/chat/U1001');

  await page.locator('#sidecar-host iframe').waitFor({ timeout: 10000 });
  const src = await page.locator('#sidecar-host iframe').getAttribute('src');
  if (!/^chrome-extension:\/\/[a-p]{32}\/panel\.html$/.test(src || '')) throw new Error('panel iframe src is ' + src);
  console.log('  ✓ content script injected; panel iframe is ' + src.replace(/\/\/[a-p]{32}/, '//<extension-id>'));

  const panel = page.frameLocator('#sidecar-host iframe');
  await panel.locator('[data-sc="config"]').waitFor({ timeout: 10000 });
  await panel.locator('[data-sc="cfg-url"]').fill(server.url);
  await panel.locator('[data-sc="cfg-token"]').fill(DEMO_TOKEN);
  await panel.locator('[data-sc="cfg-save"]').click();
  await panel.locator('[data-sc="lead-name"]').waitFor({ timeout: 10000 });
  const name = await panel.locator('[data-sc="lead-name"]').textContent();
  if (!name.includes('Ploy')) throw new Error('unexpected lead: ' + name);
  console.log('  ✓ config saved to chrome.storage; API reached from the extension origin; lead "' + name + '" loaded for the open chat');

  await panel.locator('[data-sc="reply-insert"]').click();
  await page.waitForFunction(() => document.getElementById('composer').value.includes('3,000'), null, { timeout: 5000 });
  console.log('  ✓ draft reply inserted into the page composer through postMessage');

  await page.locator('[data-chat="U1002"]').click();
  await panel.locator('[data-sc="lead-name"]', { hasText: 'Bank' }).waitFor({ timeout: 10000 });
  console.log('  ✓ panel follows the chat switch (SPA URL change)');

  await page.reload();
  await panel.locator('[data-sc="lead-name"]').waitFor({ timeout: 10000 });
  console.log('  ✓ config survives a reload (no setup screen the second time)');

  await page.screenshot({ path: path.join(HERE, 'shots', '13-real-extension.png') });
  ok = true;
} catch (err) {
  console.error('\n✗ ' + err.message);
} finally {
  if (ctx) await ctx.close();
  await server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

if (errors.length) { console.error('\nerrors:'); for (const e of errors) console.error('  ' + e); }
if (!ok || errors.length) process.exit(1);
console.log('\nEXTENSION CHECK OK');
