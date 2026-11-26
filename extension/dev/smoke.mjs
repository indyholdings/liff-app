// Sidecar UI smoke test: drives the panel (beside a stand-in chat page) and the mobile staff page
// against the in-memory mock API, and saves screenshots to extension/dev/shots/.
//
//   node extension/dev/smoke.mjs
//
// Exits non-zero on any failed assertion, page error, or console error.

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startMockServer, DEMO_TOKEN } from './mock-api.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const problems = [];
let step = 0;
const log = (msg) => console.log(`  ✓ ${String(++step).padStart(2, '0')} ${msg}`);
function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + msg);
}
async function waitFor(fn, msg, timeout = 6000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (err) { last = err; }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('timed out: ' + msg + (last instanceof Error ? ' (' + last.message + ')' : ''));
}

// Rendering slips (an element or null written as text) show up as these strings.
async function assertClean(locator, label) {
  const text = await locator.innerText();
  for (const bad of ['[object', 'undefined', 'NaN']) assert(!text.includes(bad), label + ' shows "' + bad + '"');
  assert(!/(^|\s)null(\s|$)/.test(text), label + ' shows "null"');
}

function watch(page, label, allow) {
  page.on('pageerror', (err) => problems.push(`[${label}] page error: ${err.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (allow && allow.some((re) => re.test(text))) return;
    problems.push(`[${label}] console error: ${text}`);
  });
}

/** Lets running CSS animations (panel fade, menu pop) finish, so a screenshot is not caught half-way. */
const settle = (scope) => scope.locator('.sc-root').evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
/** The lead tab panels that are in the layout right now. */
const shownPanels = (scope) => scope.locator('.sc-panel').evaluateAll((els) => els.filter((el) => !el.hidden && el.getClientRects().length).map((el) => el.dataset.panel));
const stageMenuClosed = async (scope) => (await scope.locator('.sc-stage-menu').count()) === 0 && (await scope.locator('[data-stage]').count()) === 0;
const openTab = async (scope, tab) => {
  await scope.locator('[data-tab-view="' + tab + '"]').click();
  assert((await shownPanels(scope)).join() === tab, 'tab "' + tab + '" shows its panel and hides the others');
};

const server = await startMockServer(0);
const BASE = server.url;
const apiGet = async (p) => (await fetch(BASE + p, { headers: { Authorization: 'Bearer ' + DEMO_TOKEN } })).json();
const config = { sidecarApiUrl: BASE, sidecarToken: DEMO_TOKEN };
const seedConfig = (cfg) => {
  for (const k of Object.keys(cfg)) window.localStorage.setItem(k, JSON.stringify(cfg[k]));
};

const browser = await chromium.launch();
let failed = null;

try {
  // ====================================================================== 1. panel beside the chat
  console.log('panel (extension shell on the stand-in chat page)');
  const desk = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, locale: 'th-TH' });
  await desk.addInitScript(seedConfig, config);
  await desk.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await desk.newPage();
  watch(page, 'panel');
  await page.goto(BASE + '/Ufakeoa/chat/U1001');
  const panel = page.frameLocator('#sidecar-host iframe');
  const composer = page.locator('#composer');

  await panel.locator('[data-sc="lead-name"]').waitFor();
  assert((await panel.locator('[data-sc="lead-name"]').textContent()).includes('Ploy'), 'panel shows the lead of the open chat');
  const ploy = (await apiGet('/api/leads/by-chat/U1001')).lead;
  log('panel loads the lead by chat id (' + ploy.display_name + ')');
  await panel.locator('[data-sc="same-phone"]').waitFor();
  log('returning-customer notice shown for a shared phone number');
  await settle(panel);
  await page.screenshot({ path: path.join(SHOTS, '01-panel-lead.png') });
  await assertClean(panel.locator('#app'), 'panel lead view');

  // one primary action; tabs
  assert(await panel.locator('.sc-btn.sc-primary:visible').count() === 1, 'exactly one primary button in the lead view');
  assert((await shownPanels(panel)).join() === 'overview' && await panel.locator('.sc-panel').count() === 4, 'four panels, the overview shown first');
  assert(await panel.locator('[data-tab-view="order"] .sc-tabdot').count() === 1, 'order tab carries a dot for a lead with an open order');
  assert(await panel.locator('[data-tab-view="order"]').evaluate((el) => el.childNodes[0].textContent) === 'ออเดอร์', 'order tab uses the retail label');
  log('lead view opens on the overview tab; the order tab is dotted for the open order');

  // stage
  const pill = panel.locator('[data-sc="stage-toggle"]');
  const pipe = await panel.locator('[data-sc="stages"] .sc-pipe').evaluate((el) => ({ steps: el.querySelectorAll('i').length, cur: el.querySelectorAll('i.sc-cur').length }));
  assert(pipe.steps === 7 && pipe.cur === 1, 'pipe has 7 steps with one current step (' + JSON.stringify(pipe) + ')');
  assert(await pill.getAttribute('aria-expanded') === 'false' && await stageMenuClosed(panel), 'stage menu starts closed, with no items in the DOM');
  await pill.click();
  await panel.locator('.sc-stage-menu').waitFor();
  assert(await pill.getAttribute('aria-expanded') === 'true' && await panel.locator('.sc-stage-menu [data-stage]').count() === 9, 'stage menu opens with the nine stages');
  await pill.press('Escape');
  await waitFor(() => stageMenuClosed(panel), 'Escape closes the stage menu');
  await pill.click();
  await panel.locator('[data-stage="quoted"]').click();
  await waitFor(async () => (await apiGet('/api/leads/' + ploy.id)).lead.stage === 'quoted', 'stage saved');
  await waitFor(() => stageMenuClosed(panel), 'choosing a stage closes the menu');
  assert(await pill.getAttribute('data-stage-key') === 'quoted' && (await pill.innerText()).includes('เสนอราคาแล้ว'), 'pill shows the new stage');
  assert((await panel.locator('.sc-pipe-step').textContent()) === '3/7', 'pipe moves to step 3 of 7');
  await pill.click();
  assert(await panel.locator('[data-stage="quoted"].sc-on').count() === 1, 'the new stage is the one marked in the menu');
  await panel.locator('[data-sc="lead-name"]').click();
  await waitFor(() => stageMenuClosed(panel), 'a click outside closes the stage menu');
  log('stage menu opens and closes; stage changed from the menu and saved');

  // phone
  const phone = panel.locator('#sc-f-phone');
  await phone.fill('089-999-0000');
  await phone.press('Enter');
  await waitFor(async () => (await apiGet('/api/leads/' + ploy.id)).lead.phone === '0899990000', 'phone saved');
  await waitFor(async () => (await phone.inputValue()) === '0899990000', 'phone field shows the normalised number');
  log('phone edited inline, saved on Enter, normalised by the server');

  // note
  const noteText = 'ทดสอบโน้ตจาก smoke test';
  await openTab(panel, 'notes');
  const notesBefore = Number(await panel.locator('[data-tab-view="notes"] .sc-count').textContent());
  await panel.locator('[data-sc="note-input"]').fill(noteText);
  await panel.locator('[data-sc="note-input"]').press('Control+Enter');
  await waitFor(async () => (await panel.locator('[data-sc="notes-list"]').textContent()).includes(noteText), 'note listed');
  assert((await apiGet('/api/leads/' + ploy.id)).notes.some((n) => n.body === noteText && n.kind === 'staff'), 'note stored');
  assert(Number(await panel.locator('[data-tab-view="notes"] .sc-count').textContent()) === notesBefore + 1, 'notes tab count follows');
  log('note added with Ctrl+Enter');

  // order
  await openTab(panel, 'order');
  await panel.locator('[data-sc="product-search"]').fill('AirPods');
  await panel.locator('[data-sc="product-results"] .sc-search-item').first().click();
  assert(await panel.locator('[data-sc="order-items"] .sc-item').count() === 3, 'product added as a third line');
  await panel.locator('[data-sc="order-discount"]').fill('500');
  await waitFor(async () => (await panel.locator('[data-sc="total"]').textContent()).includes('38,680'), 'live total 38,680');
  await panel.locator('[data-sc="order-save"]').click();
  await waitFor(async () => (await apiGet('/api/leads/' + ploy.id)).order.total === 38680, 'order saved with total 38680');
  log('order built from product search; live total matches the saved total (฿38,680)');

  // summary → composer
  await panel.locator('[data-sc="summary"]').click();
  await panel.locator('[data-sc="summary-text"]').waitFor();
  const summary = await panel.locator('[data-sc="summary-text"]').textContent();
  assert(summary.includes('38,680'), 'summary carries the saved total');
  assert(await panel.locator('.sc-btn.sc-primary:visible').count() === 1, 'one primary button with the summary open');
  await panel.locator('[data-sc="summary-insert"]').click();
  await waitFor(async () => (await composer.inputValue()).includes('38,680'), 'summary inserted into the chat composer');
  log('order summary drafted and inserted into the chat composer');
  await panel.locator('[data-sc="summary-text"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, '02-panel-order-summary.png') });

  await panel.locator('[data-sc="summary-copy"]').click();
  await waitFor(async () => (await page.evaluate(() => navigator.clipboard.readText())).includes('38,680'), 'summary copied to clipboard');
  log('copy button puts the summary on the clipboard');

  // album
  await openTab(panel, 'album');
  await panel.locator('[data-sc="album-filters"] [data-cat="slip"]').click();
  assert(await panel.locator('[data-sc="album-grid"] .sc-thumb').count() === 1, 'slip filter leaves one image');
  await panel.locator('[data-sc="album-grid"] .sc-thumb').first().click();
  await panel.locator('[data-sc="lightbox"]').waitFor();
  assert((await panel.locator('[data-sc="slip-match"]').textContent()).includes('ยอดตรง'), 'slip match shown');
  assert((await panel.locator('[data-sc="lightbox"]').textContent()).includes('ไม่ได้ยืนยันว่าเงินเข้า'), 'slip disclaimer shown');
  await page.screenshot({ path: path.join(SHOTS, '03-panel-lightbox.png') });
  await panel.locator('[data-sc="media-category"]').selectOption('document');
  await waitFor(async () => (await apiGet('/api/leads/' + ploy.id)).media.filter((m) => m.category === 'slip').length === 0, 'media category saved');
  await panel.locator('.sc-lb-close').click({ trial: false }).catch(() => {});
  await waitFor(async () => (await panel.locator('[data-sc="lightbox"]').count()) === 0, 'lightbox closed');
  log('album filter, lightbox, slip details and category change');

  // follow-up
  await openTab(panel, 'overview');
  await panel.locator('[data-sc="follow-tomorrow"]').click();
  await waitFor(async () => { const f = (await apiGet('/api/leads/' + ploy.id)).lead.follow_up_at; return f && new Date(f).getTime() > Date.now(); }, 'follow-up saved');
  log('follow-up set to tomorrow 10:00');

  // confirm dialog before "paid"
  await openTab(panel, 'order');
  await panel.locator('[data-sc="order-paid"]').click();
  await panel.locator('[data-sc="confirm"]').waitFor();
  await panel.locator('[data-sc="confirm-cancel"]').click();
  assert((await apiGet('/api/leads/' + ploy.id)).order.status === 'awaiting_payment', 'cancelled confirm leaves the order unpaid');
  await panel.locator('[data-sc="order-paid"]').click();
  await panel.locator('[data-sc="confirm-ok"]').click();
  await waitFor(async () => (await apiGet('/api/leads/' + ploy.id)).order.status === 'paid', 'order marked paid');
  await waitFor(async () => (await panel.locator('[data-tab-view="order"] .sc-tabdot').count()) === 0, 'order tab dot clears once the order is paid');
  assert(await panel.locator('[data-sc="order-status"]').getAttribute('data-stage-key') === 'paid', 'order status names the stage it mirrors');
  log('marking paid asks for confirmation first');

  // suggested reply for another chat
  await page.locator('[data-chat="U1002"]').click();
  await waitFor(async () => (await panel.locator('[data-sc="lead-name"]').textContent()).includes('Bank'), 'panel follows the chat switch');
  await panel.locator('[data-sc="reply-insert"]').click();
  await waitFor(async () => (await composer.inputValue()).includes('iPhone 14'), 'draft reply inserted');
  log('panel follows a chat switch; draft reply inserted into the composer');
  await panel.locator('[data-sc="analyze"]').click();
  await waitFor(async () => (await panel.locator('[data-sc="ai-summary"]').textContent()).includes('วิเคราะห์ใหม่'), 're-analysis shown');
  log('re-analyse refreshes the agent box');
  assert((await shownPanels(panel)).join() === 'overview', 'a lead not seen before opens on the overview');
  await page.locator('[data-chat="U1001"]').click();
  await waitFor(async () => (await panel.locator('[data-sc="lead-name"]').textContent()).includes('Ploy'), 'panel returns to the first chat');
  assert((await shownPanels(panel)).join() === 'order', 'the tab a lead was left on is remembered');
  log('each lead remembers its tab');

  // unknown chat → link by hand
  await page.locator('[data-chat="Cchat9999"]').click();
  await panel.locator('[data-sc="unknown-chat"]').waitFor();
  await waitFor(async () => (await panel.locator('[data-sc="candidates"]').textContent()).includes('น้ำฝน'), 'candidate listed by name');
  await page.screenshot({ path: path.join(SHOTS, '04-panel-unknown-chat.png') });
  await panel.locator('[data-sc="link-chat"]').first().click();
  await waitFor(async () => (await panel.locator('[data-sc="lead-name"]').count()) && (await panel.locator('[data-sc="lead-name"]').textContent()).includes('น้ำฝน'), 'linked lead shown');
  assert((await apiGet('/api/leads/by-chat/Cchat9999')).lead, 'chat id linked on the server');
  log('unknown chat lists candidates and links to the chosen lead');

  // unknown chat with nobody to link
  await page.locator('[data-chat="Unobody"]').click();
  await panel.locator('[data-sc="unknown-chat"]').waitFor();
  await waitFor(async () => (await panel.locator('[data-sc="candidates"]').textContent()).includes('ไม่พบ'), 'no candidates message');
  log('unknown chat with no match explains why');

  // follow-up list inside the panel
  await panel.locator('[data-sc="open-due"]').click();
  await panel.locator('[data-sc="inbox-list"] .sc-row').first().waitFor();
  await page.screenshot({ path: path.join(SHOTS, '05-panel-due-list.png') });
  await assertClean(panel.locator('#app'), 'panel due list');
  await panel.locator('[data-sc="inbox-list"] .sc-row').first().click();
  await panel.locator('[data-sc="lead-page"] [data-sc="lead-name"]').waitFor();
  log('follow-up list opens inside the panel and drills into a lead');

  // collapse / reopen
  await page.locator('#sidecar-toggle').click();
  assert(!(await page.locator('#sidecar-host').isVisible()), 'panel collapses');
  await page.locator('#sidecar-toggle').click();
  assert(await page.locator('#sidecar-host').isVisible(), 'panel reopens');
  log('panel collapses and reopens');
  await desk.close();

  // dark scheme
  const dark = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'th-TH' });
  await dark.addInitScript(seedConfig, config);
  const dpage = await dark.newPage();
  watch(dpage, 'panel-dark');
  await dpage.goto(BASE + '/Ufakeoa/chat/U1003');
  await dpage.frameLocator('#sidecar-host iframe').locator('[data-sc="lead-name"]').waitFor();
  await settle(dpage.frameLocator('#sidecar-host iframe'));
  await dpage.screenshot({ path: path.join(SHOTS, '06-panel-dark.png') });
  log('panel renders in dark scheme');
  await dark.close();

  // not configured → config screen inside the panel
  const fresh = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1, locale: 'th-TH' });
  const fpage = await fresh.newPage();
  watch(fpage, 'panel-setup');
  await fpage.goto(BASE + '/Ufakeoa/chat/U1001');
  const fpanel = fpage.frameLocator('#sidecar-host iframe');
  await fpanel.locator('[data-sc="config"]').waitFor();
  await fpanel.locator('[data-sc="cfg-url"]').fill(BASE);
  await fpanel.locator('[data-sc="cfg-token"]').fill(DEMO_TOKEN);
  await fpanel.locator('[data-sc="cfg-save"]').click();
  await fpanel.locator('[data-sc="lead-name"]').waitFor();
  log('first run: config screen in the panel, then the open chat loads');
  await fresh.close();

  // ====================================================================== 2. mobile staff page
  console.log('staff.html (390px)');
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
  await phoneCtx.addInitScript(seedConfig, config);
  const mob = await phoneCtx.newPage();
  watch(mob, 'staff');
  await mob.goto(BASE + '/staff.html');
  await mob.locator('[data-sc="inbox-list"] .sc-row').first().waitFor();
  const rows = await mob.locator('[data-sc="inbox-list"] .sc-row').count();
  assert(rows >= 8, 'inbox lists the leads (' + rows + ')');
  assert((await mob.locator('[data-tab="due"] .sc-badge').textContent()).trim() !== '', 'due badge shown');
  await mob.screenshot({ path: path.join(SHOTS, '07-mobile-inbox.png') });
  await assertClean(mob.locator('#app'), 'mobile inbox');
  assert(await mob.locator('[data-sc="inbox-tabs"] [data-tab]').count() === 11, 'all, due and nine stage tabs are rendered');
  log('inbox lists leads with stage tabs and a due badge');

  await mob.locator('[data-tab="due"]').click();
  await waitFor(async () => { const n = await mob.locator('[data-sc="inbox-list"] .sc-row').count(); return n > 0 && n < rows; }, 'due tab filters');
  await mob.locator('[data-tab="all"]').click();
  await mob.locator('[data-sc="inbox-search"]').fill('มายด์');
  await waitFor(async () => (await mob.locator('[data-sc="inbox-list"] .sc-row').count()) === 1, 'search narrows to one lead');
  await mob.locator('[data-sc="inbox-search"]').fill('');
  await waitFor(async () => (await mob.locator('[data-sc="inbox-list"] .sc-row').count()) === rows, 'search cleared');
  log('due tab and search filter the list');

  await mob.locator('[data-sc="inbox-list"] .sc-row', { hasText: 'มายด์' }).click();
  await mob.locator('[data-sc="lead-page"] [data-sc="lead-name"]').waitFor();
  assert((await mob.locator('[data-sc="reply-insert"]').count()) === 0, 'no "insert into chat" button outside the panel');
  await settle(mob);
  await mob.screenshot({ path: path.join(SHOTS, '08-mobile-lead.png') });
  await assertClean(mob.locator('#app'), 'mobile lead view');
  await openTab(mob, 'order');
  await mob.locator('[data-sc="order"]').scrollIntoViewIfNeeded();
  await mob.locator('[data-sc="product-search"]').fill('MacBook');
  await mob.locator('[data-sc="product-results"] .sc-search-item').first().click();
  await mob.locator('[data-sc="order-save"]').click();
  await waitFor(async () => (await mob.locator('[data-sc="order-status"]').textContent()).includes('ร่าง'), 'draft order saved on mobile');
  await mob.locator('[data-sc="order"]').scrollIntoViewIfNeeded();
  await mob.screenshot({ path: path.join(SHOTS, '09-mobile-order.png') });
  await mob.locator('[data-sc="back"]').click();
  await mob.locator('[data-sc="inbox-list"] .sc-row').first().waitFor();
  log('lead opens from the inbox; order saved on a phone; back returns to the list');

  await mob.locator('[data-sc="open-settings"]').click();
  await mob.locator('[data-sc="set-pay"]').waitFor();
  await mob.screenshot({ path: path.join(SHOTS, '10-mobile-settings.png') });
  await assertClean(mob.locator('#app'), 'mobile settings');
  log('settings screen (shop, payment text, products)');
  await phoneCtx.close();

  // first run on mobile: setup form, wrong token, then right token
  const setupCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
  const setup = await setupCtx.newPage();
  watch(setup, 'staff-setup', [/401/]); // the wrong-token attempt is expected to log a 401
  await setup.goto(BASE + '/staff.html');
  await setup.locator('[data-sc="config"]').waitFor();
  await setup.locator('[data-sc="cfg-url"]').fill(BASE);
  await setup.locator('[data-sc="cfg-token"]').fill('wrong-token');
  await setup.locator('[data-sc="cfg-save"]').click();
  await waitFor(async () => (await setup.locator('[data-sc="cfg-msg"]').isVisible()), 'wrong token rejected with a message');
  await setup.screenshot({ path: path.join(SHOTS, '11-mobile-setup.png') });
  await setup.locator('[data-sc="cfg-token"]').fill(DEMO_TOKEN);
  await setup.locator('[data-sc="cfg-save"]').click();
  await setup.locator('[data-sc="inbox-list"] .sc-row').first().waitFor();
  log('first run on mobile: wrong token rejected, right token opens the inbox');
  await setupCtx.close();

  // ====================================================================== 3. options page
  console.log('options.html');
  const optCtx = await browser.newContext({ viewport: { width: 520, height: 560 }, deviceScaleFactor: 2, locale: 'th-TH' });
  const opt = await optCtx.newPage();
  watch(opt, 'options');
  await opt.goto(BASE + '/extension/options.html');
  await opt.locator('#apiUrl').fill(BASE);
  await opt.locator('#token').fill(DEMO_TOKEN);
  await opt.locator('#test').click();
  await waitFor(async () => (await opt.locator('#result').textContent()).includes('token ใช้ได้'), 'connection test passes');
  await opt.locator('#save').click();
  await waitFor(async () => (await opt.locator('#result').textContent()).includes('บันทึกแล้ว'), 'options saved');
  await opt.screenshot({ path: path.join(SHOTS, '12-options.png') });
  log('options page: connection test and save');
  await optCtx.close();
} catch (err) {
  failed = err;
} finally {
  await browser.close();
  await server.close();
}

if (failed) console.error('\n✗ ' + failed.message);
if (problems.length) {
  console.error('\nconsole / page errors:');
  for (const p of problems) console.error('  ' + p);
}
if (failed || problems.length) process.exit(1);
console.log('\nSMOKE OK — ' + step + ' checks, screenshots in ' + path.relative(process.cwd(), SHOTS));
