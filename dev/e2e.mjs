// End-to-end check: the real staff UI against the real backend router.
//
//   node dev/e2e.mjs
//
// Starts dev/server.ts (PGlite, fake brain, fake LINE), then drives the extension
// panel beside a stand-in chat page and the mobile staff page. A simulated LINE
// message goes through the signed webhook, so this covers customer message →
// agent fills the card → staff see it in the panel. Exits non-zero on any failed
// assertion, page error or console error.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'dev', 'shots');
mkdirSync(SHOTS, { recursive: true });
const PORT = 8791;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'dev-staff-token';

let step = 0;
const log = (msg) => console.log(`  ✓ ${String(++step).padStart(2, '0')} ${msg}`);
const assert = (cond, msg) => { if (!cond) throw new Error('assertion failed: ' + msg); };
async function waitFor(fn, msg, timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (err) { last = err; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out: ' + msg + (last instanceof Error ? ' (' + last.message + ')' : ''));
}

const api = async (method, p, body) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};
const lineMessage = (body) => fetch(BASE + '/dev/line-message', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

/** The lead tab panels that are in the layout right now. */
const shownPanels = (scope) => scope.locator('.sc-panel').evaluateAll((els) => els.filter((el) => !el.hidden && el.getClientRects().length).map((el) => el.dataset.panel));
const stageMenuClosed = async (scope) => (await scope.locator('.sc-stage-menu').count()) === 0 && (await scope.locator('[data-stage]').count()) === 0;
const openTab = async (scope, tab) => {
  await scope.locator('[data-tab-view="' + tab + '"]').click();
  assert((await shownPanels(scope)).join() === tab, 'tab "' + tab + '" shows its panel and hides the others');
};

const server = spawn(process.execPath, ['dev/server.ts'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const problems = [];
function watch(page, label) {
  page.on('pageerror', (err) => problems.push(`[${label}] page error: ${err.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${label}] console error: ${m.text()}`); });
}
const seedConfig = (cfg) => {
  for (const k of Object.keys(cfg)) window.localStorage.setItem(k, JSON.stringify(cfg[k]));
};
const config = { sidecarApiUrl: BASE, sidecarToken: TOKEN };

let browser;
let failed = null;
try {
  await waitFor(async () => (await fetch(BASE + '/health')).ok, 'dev server up', 20000);
  browser = await chromium.launch();

  // ------------------------------------------------------------ panel beside the chat
  console.log('panel on the stand-in chat page, real backend');
  const desk = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, locale: 'th-TH' });
  await desk.addInitScript(seedConfig, config);
  // The dev server has no chat page; serve the stand-in for any /<oa>/chat/<id> URL.
  const fakeChat = readFileSync(path.join(ROOT, 'extension/dev/fake-chat.html'), 'utf8');
  await desk.route(/\/U[^/]*\/chat\/[^/]+$/, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fakeChat }));
  const page = await desk.newPage();
  watch(page, 'panel');
  const panel = page.frameLocator('#sidecar-host iframe');

  await page.goto(BASE + '/Udevbot/chat/Udemo0008');
  await panel.locator('[data-sc="lead-name"]').waitFor();
  assert((await panel.locator('[data-sc="lead-name"]').textContent()).includes('น้ำฝน'), 'panel shows the seeded lead for the open chat');
  log('panel loads a lead from the real API by chat id');

  // A brand-new customer writes in on LINE.
  const sent = await lineMessage({
    userId: 'Ue2e0001', displayName: 'ลูกค้า E2E',
    text: 'สนใจ iPhone 13 ค่ะ ชื่อ สมหญิง ใจดี เบอร์ 089-123-4567',
  });
  assert(sent.ok !== false, 'simulated LINE message accepted: ' + JSON.stringify(sent));
  const lead = await waitFor(async () => {
    const b = await api('GET', '/api/leads/by-chat/Ue2e0001');
    return b.lead && b.lead.phone === '0891234567' ? b.lead : null;
  }, 'agent fills the phone number from the customer message');
  log('LINE message → signed webhook → agent filled the card (phone ' + lead.phone + ', stage ' + lead.stage + ')');

  await page.goto(BASE + '/Udevbot/chat/Ue2e0001');
  await panel.locator('[data-sc="lead-name"]').waitFor();
  await waitFor(async () => (await panel.locator('#sc-f-phone').inputValue()) === '0891234567', 'panel shows the phone the agent read');
  assert((await panel.locator('[data-sc="notes-list"]').textContent()).trim() !== '', 'agent note is listed');
  log('panel shows the new customer with the agent-filled card and note');

  // Staff work the lead.
  const pipe = await panel.locator('[data-sc="stages"] .sc-pipe').evaluate((el) => ({ steps: el.querySelectorAll('i').length, cur: el.querySelectorAll('i.sc-cur').length }));
  assert(pipe.steps === 7 && pipe.cur === 1, 'pipe has 7 steps with one current step (' + JSON.stringify(pipe) + ')');
  assert(await stageMenuClosed(panel), 'stage menu starts closed');
  await panel.locator('[data-sc="stage-toggle"]').click();
  await panel.locator('.sc-stage-menu').waitFor();
  await panel.locator('[data-stage="quoted"]').click();
  await waitFor(async () => (await api('GET', '/api/leads/' + lead.id)).lead.stage === 'quoted', 'stage saved');
  await waitFor(() => stageMenuClosed(panel), 'stage menu closes after the choice');
  assert(await panel.locator('[data-sc="stage-toggle"]').getAttribute('data-stage-key') === 'quoted', 'pill shows the new stage');
  assert(await panel.locator('[data-tab-view="order"] .sc-tabdot').count() === 0, 'no dot on the order tab before there is an order');
  await openTab(panel, 'notes');
  await panel.locator('[data-sc="note-input"]').fill('ลูกค้าขอสีดำ');
  await panel.locator('[data-sc="note-input"]').press('Control+Enter');
  await waitFor(async () => (await api('GET', '/api/leads/' + lead.id)).notes.some((n) => n.body === 'ลูกค้าขอสีดำ' && n.kind === 'staff'), 'note stored');
  log('stage change and staff note saved through the real API');

  await openTab(panel, 'order');
  await panel.locator('[data-sc="product-search"]').fill('iPhone');
  await panel.locator('[data-sc="product-results"] .sc-search-item').first().click();
  await panel.locator('[data-sc="order-save"]').click();
  const order = await waitFor(async () => {
    const o = (await api('GET', '/api/leads/' + lead.id)).order;
    return o && o.items.length > 0 && o.total > 0 ? o : null;
  }, 'order saved');
  const totalText = order.total.toLocaleString('en-US');
  await waitFor(async () => (await panel.locator('[data-sc="total"]').textContent()).includes(totalText), 'panel total equals the server total');
  log('order saved; panel total equals server total (฿' + totalText + ')');

  await panel.locator('[data-sc="summary"]').click();
  await panel.locator('[data-sc="summary-text"]').waitFor();
  assert((await panel.locator('[data-sc="summary-text"]').textContent()).includes(totalText), 'summary carries the server total');
  await panel.locator('[data-sc="summary-insert"]').click();
  await waitFor(async () => (await page.locator('#composer').inputValue()).includes(totalText), 'summary inserted into the composer');
  log('order summary built by the server and inserted into the chat composer');

  // The customer sends a slip for the order total.
  await api('POST', '/api/orders/' + order.id + '/status', { status: 'awaiting_payment' });
  await lineMessage({ userId: 'Ue2e0001', image: { kind: 'slip', amount: order.total } });
  const slip = await waitFor(async () => {
    const b = await api('GET', '/api/leads/' + lead.id);
    return b.media.find((m) => m.category === 'slip') ? b : null;
  }, 'slip filed in the album');
  const slipMedia = slip.media.find((m) => m.category === 'slip');
  assert(slipMedia.slip && slipMedia.slip.matches_order === true, 'slip amount matches the order');
  assert(slip.order.status === 'awaiting_payment', 'nothing is marked paid until staff confirm');
  await page.reload();
  await panel.locator('[data-sc="lead-name"]').waitFor();
  assert((await shownPanels(panel)).join() === 'overview', 'a fresh page opens the lead on the overview');
  assert(await panel.locator('[data-tab-view="order"] .sc-tabdot').count() === 1, 'order tab is dotted: an open order with a slip waiting to be confirmed');
  await openTab(panel, 'album');
  await panel.locator('[data-sc="album-grid"]').waitFor();
  await waitFor(async () => (await panel.locator('[data-sc="album-grid"] img').count()) >= 1, 'slip shows in the album');
  await panel.locator('[data-sc="album"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'e2e-panel.png') });
  log('slip image → album, amount matched to the order, order still awaiting staff confirmation');
  await desk.close();

  // ------------------------------------------------------------ mobile staff page
  console.log('staff.html at 390px, real backend');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
  await phone.addInitScript(seedConfig, config);
  const mob = await phone.newPage();
  watch(mob, 'staff');
  await mob.goto(BASE + '/staff.html');
  await mob.locator('[data-sc="inbox-list"] .sc-row').first().waitFor();
  assert((await mob.locator('[data-sc="inbox-list"]').textContent()).includes('ลูกค้า E2E'), 'new customer is in the inbox');
  await mob.locator('[data-sc="inbox-list"] .sc-row', { hasText: 'ลูกค้า E2E' }).click();
  await mob.locator('[data-sc="lead-page"] [data-sc="lead-name"]').waitFor();
  await waitFor(async () => (await mob.locator('#sc-f-phone').inputValue()) === '0891234567', 'mobile lead view shows the card');
  await mob.screenshot({ path: path.join(SHOTS, 'e2e-mobile.png') });
  log('mobile inbox lists the new customer and opens the same card');
  await phone.close();

  if (problems.length) throw new Error('browser problems:\n  ' + problems.join('\n  '));
  console.log(`E2E OK — ${step} checks`);
} catch (err) {
  failed = err;
  console.error('E2E FAILED:', err.message);
  if (problems.length) console.error('  ' + problems.join('\n  '));
  console.error('--- dev server log (tail) ---\n' + serverLog.split('\n').slice(-25).join('\n'));
} finally {
  if (browser) await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
