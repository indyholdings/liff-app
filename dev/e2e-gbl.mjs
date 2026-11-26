// End-to-end check for the Globallink build: the branded staff UI from
// dist/globallink against the real backend router running the real_estate profile.
//
//   node dev/e2e-gbl.mjs
//
// Builds the brand, starts dev/server.ts with PROFILE=real_estate (PGlite, fake brain,
// fake LINE), then drives the panel beside a stand-in chat page and the mobile staff
// page. A simulated LINE message goes through the signed webhook, so this covers
// customer message → agent fills the requirement card → staff see it in the branded
// panel → offer with a deposit → slip matched to the deposit. Exits non-zero on any
// failed assertion, page error or console error.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'globallink');
const SHOTS = path.join(ROOT, 'dev', 'shots');
mkdirSync(SHOTS, { recursive: true });
const PORT = 8792;
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

const built = spawnSync(process.execPath, ['scripts/build-brand.mjs', 'globallink'], { cwd: ROOT, encoding: 'utf8' });
if (built.status !== 0) {
  console.error('brand build failed:\n' + built.stdout + built.stderr);
  process.exit(1);
}

const server = spawn(process.execPath, ['dev/server.ts'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), PROFILE: 'real_estate' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};
// The dev server serves the repository as it is. Serve the Globallink build in its
// place for the UI files, and the stand-in chat page for any /<oa>/chat/<id> URL.
async function useBuild(context) {
  const fakeChat = readFileSync(path.join(ROOT, 'extension/dev/fake-chat.html'), 'utf8');
  await context.route(/\/U[^/]*\/chat\/[^/]+$/, (route) => route.fulfill({ contentType: TYPES['.html'], body: fakeChat }));
  await context.route((url) => url.origin === BASE && (url.pathname === '/staff.html' || (url.pathname.startsWith('/extension/') && !url.pathname.startsWith('/extension/dev/'))), (route) => {
    const file = path.join(DIST, decodeURIComponent(new URL(route.request().url()).pathname));
    if (!file.startsWith(DIST) || !existsSync(file)) return route.fulfill({ status: 404, body: 'not in the build' });
    return route.fulfill({ contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: readFileSync(file) });
  });
}

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
  const health = await (await fetch(BASE + '/health')).json();
  assert(health.profile === 'real_estate', 'backend runs the real_estate profile');
  browser = await chromium.launch();

  // ------------------------------------------------------------ branded panel beside the chat
  console.log('Globallink panel on the stand-in chat page, real backend (real_estate)');
  const desk = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, locale: 'th-TH' });
  await desk.addInitScript(seedConfig, config);
  await useBuild(desk);
  const page = await desk.newPage();
  watch(page, 'panel');
  const panel = page.frameLocator('#sidecar-host iframe');

  await page.goto(BASE + '/Ugblbot/chat/Ugbl0001');
  await panel.locator('[data-sc="lead-name"]').waitFor();
  assert((await panel.locator('[data-sc="lead-name"]').textContent()).includes('Ploy'), 'panel shows the seeded lead');
  assert(await panel.locator('html').getAttribute('data-theme') === 'globallink', 'Globallink theme is applied');
  const pipe = await panel.locator('[data-sc="stages"] .sc-pipe').evaluate((el) => ({ steps: el.querySelectorAll('i').length, cur: el.querySelectorAll('i.sc-cur').length }));
  assert(pipe.steps === 7 && pipe.cur === 1, 'pipe has 7 steps with one current step (' + JSON.stringify(pipe) + ')');
  assert(await stageMenuClosed(panel), 'stage menu starts closed');
  await panel.locator('[data-sc="stage-toggle"]').click();
  await panel.locator('.sc-stage-menu').waitFor();
  assert((await panel.locator('.sc-stage-menu').innerText()).includes('รอมัดจำ'), 'stage menu uses the labels served by /api/config');
  await panel.locator('[data-sc="stage-toggle"]').press('Escape');
  await waitFor(() => stageMenuClosed(panel), 'stage menu closes on Escape');
  assert((await shownPanels(panel)).join() === 'overview', 'lead view opens on the overview tab');
  assert(await panel.locator('[data-sc="details"]').isVisible(), 'requirement card is shown');
  log('branded panel loads a lead; stage labels and the requirement card come from the real /api/config');

  // A brand-new customer writes in on LINE.
  const sent = await lineMessage({
    userId: 'Ue2egbl01', displayName: 'ลูกค้า E2E',
    text: 'สวัสดีค่ะ หาเช่าห้อง Studio ที่ Kave Town Colony งบ 12,000 ชื่อ สมใจ ทดสอบ เบอร์ 086-555-0199',
  });
  assert(sent.ok !== false, 'simulated LINE message accepted: ' + JSON.stringify(sent));
  const lead = await waitFor(async () => {
    const b = await api('GET', '/api/leads/by-chat/Ue2egbl01');
    return b.lead && b.lead.phone === '0865550199' && b.lead.details && b.lead.details.intent === 'rent' ? b.lead : null;
  }, 'agent fills phone and intent from the customer message');
  assert(lead.details.budget, 'agent filled the budget (' + JSON.stringify(lead.details) + ')');
  log('LINE message → signed webhook → agent filled the card (intent ' + lead.details.intent + ', budget ' + lead.details.budget + ')');

  await page.goto(BASE + '/Ugblbot/chat/Ue2egbl01');
  await panel.locator('[data-sc="lead-name"]').waitFor();
  await waitFor(async () => (await panel.locator('#sc-d-intent').inputValue()) === 'rent', 'panel shows the intent the agent read');
  await waitFor(async () => (await panel.locator('#sc-d-budget').inputValue()) === lead.details.budget, 'panel shows the budget the agent read');
  log('panel shows the new customer with the agent-filled requirement card');

  // Staff correct a field; the agent must not overwrite it afterwards.
  await panel.locator('#sc-d-move_in').fill('1 ธ.ค.');
  await panel.locator('#sc-d-move_in').press('Enter');
  await waitFor(async () => {
    const l = (await api('GET', '/api/leads/' + lead.id)).lead;
    return l.details.move_in === '1 ธ.ค.' && l.locked_fields.includes('details.move_in');
  }, 'staff edit saved and locked');
  log('staff edit of a requirement field is saved and locked against the agent');

  // Offer with a deposit, summary into the composer.
  assert(await panel.locator('[data-tab-view="order"] .sc-tabdot').count() === 0, 'no dot on the order tab before there is an offer');
  await openTab(panel, 'order');
  await panel.locator('[data-sc="order"]').scrollIntoViewIfNeeded();
  await panel.locator('[data-sc="product-search"]').fill('Kave');
  await panel.locator('[data-sc="product-results"] .sc-search-item').first().click();
  await panel.locator('[data-sc="order-deposit"]').fill('5000');
  await panel.locator('[data-sc="order-save"]').click();
  const order = await waitFor(async () => {
    const o = (await api('GET', '/api/leads/' + lead.id)).order;
    return o && o.items.length > 0 && o.deposit_amount === 5000 ? o : null;
  }, 'offer saved with the deposit');
  await panel.locator('[data-sc="summary"]').click();
  await panel.locator('[data-sc="summary-text"]').waitFor();
  const summary = await panel.locator('[data-sc="summary-text"]').textContent();
  assert(summary.includes('มัดจำ') && summary.includes('5,000') && summary.includes(order.total.toLocaleString('en-US')), 'summary carries price and deposit from the server');
  await panel.locator('[data-sc="summary-insert"]').click();
  await waitFor(async () => (await page.locator('#composer').inputValue()).includes('5,000'), 'summary inserted into the composer');
  log('offer saved (฿' + order.total.toLocaleString('en-US') + ', deposit ฿5,000); server-built summary inserted into the composer');

  // The customer sends a slip for the deposit.
  await api('POST', '/api/orders/' + order.id + '/status', { status: 'awaiting_payment' });
  await lineMessage({ userId: 'Ue2egbl01', image: { kind: 'slip', amount: 5000 } });
  const after = await waitFor(async () => {
    const b = await api('GET', '/api/leads/' + lead.id);
    return b.media.find((m) => m.category === 'slip') ? b : null;
  }, 'slip filed in the album');
  assert(after.media.find((m) => m.category === 'slip').slip.matches_order === true, 'slip amount matches the deposit');
  assert(after.order.status === 'awaiting_payment', 'nothing is marked paid until staff confirm');
  await page.reload();
  await panel.locator('[data-sc="lead-name"]').waitFor();
  assert(await panel.locator('[data-tab-view="order"] .sc-tabdot').count() === 1, 'order tab is dotted: an open offer with a slip waiting to be confirmed');
  await openTab(panel, 'album');
  await panel.locator('[data-sc="album-grid"]').waitFor();
  await waitFor(async () => (await panel.locator('[data-sc="album-grid"] img').count()) >= 1, 'slip shows in the album');
  await openTab(panel, 'overview');
  await panel.locator('[data-sc="details"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'e2e-gbl-panel.png') });
  log('slip for the deposit → album, matched, offer still awaiting staff confirmation');
  await desk.close();

  // ------------------------------------------------------------ branded mobile staff page
  console.log('Globallink staff.html at 390px, real backend');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
  await phone.addInitScript(seedConfig, config);
  await useBuild(phone);
  const mob = await phone.newPage();
  watch(mob, 'staff');
  await mob.goto(BASE + '/staff.html');
  await mob.locator('[data-sc="inbox-list"] .sc-row').first().waitFor();
  assert(await mob.locator('html').getAttribute('data-theme') === 'globallink', 'mobile page uses the Globallink theme');
  const row = mob.locator('[data-sc="inbox-list"] .sc-row', { hasText: 'ลูกค้า E2E' });
  await row.waitFor();
  assert((await row.locator('[data-sc="row-meta"]').innerText()).includes('หาเช่า'), 'inbox row shows the intent label');
  await mob.screenshot({ path: path.join(SHOTS, 'e2e-gbl-mobile.png') });
  await row.click();
  await mob.locator('[data-sc="lead-page"] [data-sc="lead-name"]').waitFor();
  await waitFor(async () => (await mob.locator('#sc-d-move_in').inputValue()) === '1 ธ.ค.', 'mobile lead view shows the requirement card');
  log('mobile inbox lists the new customer with intent; lead view shows the same card');
  await phone.close();

  if (problems.length) throw new Error('browser problems:\n  ' + problems.join('\n  '));
  console.log(`E2E GBL OK — ${step} checks`);
} catch (err) {
  failed = err;
  console.error('E2E GBL FAILED:', err.message);
  if (problems.length) console.error('  ' + problems.join('\n  '));
  console.error('--- dev server log (tail) ---\n' + serverLog.split('\n').slice(-25).join('\n'));
} finally {
  if (browser) await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
