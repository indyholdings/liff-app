// Globallink brand + real-estate profile smoke test.
// Builds the brand (dist/globallink), serves it with the mock API in PROFILE=real_estate mode and
// drives the branded panel and mobile page. Saves screenshots to extension/dev/shots-gbl/.
//
//   node extension/dev/smoke-gbl.mjs
//
// Exits non-zero on any failed assertion, page error, or console error.

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startMockServer, DEMO_TOKEN } from './mock-api.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DIST = path.join(ROOT, 'dist', 'globallink');
const SHOTS = path.join(HERE, 'shots-gbl');
fs.mkdirSync(SHOTS, { recursive: true });

const FOREST = 'rgb(25, 62, 36)';
const CORAL = 'rgb(221, 99, 58)';
const IVORY = 'rgb(245, 242, 233)';

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
async function assertClean(locator, label) {
  const text = await locator.innerText();
  for (const bad of ['[object', 'undefined', 'NaN']) assert(!text.includes(bad), label + ' shows "' + bad + '"');
  assert(!/(^|\s)null(\s|$)/.test(text), label + ' shows "null"');
}
function watch(page, label) {
  page.on('pageerror', (err) => problems.push(`[${label}] page error: ${err.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${label}] console error: ${m.text()}`); });
  page.on('requestfailed', (r) => problems.push(`[${label}] request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`[${label}] HTTP ${r.status()}: ${r.url()}`); });
}
/** Nothing in the scrolling area may be wider than the area itself. */
async function assertNoOverflow(scope, label) {
  const o = await scope.locator('.sc-main').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  assert(o.sw <= o.cw + 1, `${label}: content is ${o.sw}px wide in a ${o.cw}px column`);
}

// ------------------------------------------------------------------ build + serve
const built = spawnSync(process.execPath, ['scripts/build-brand.mjs', 'globallink'], { cwd: ROOT, encoding: 'utf8' });
if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1); }
console.log(built.stdout.trim().split('\n')[0]);

const server = await startMockServer(0, { profile: 'real_estate', root: DIST });
const BASE = server.url;
const apiGet = async (p) => (await fetch(BASE + p, { headers: { Authorization: 'Bearer ' + DEMO_TOKEN } })).json();
const config = { sidecarApiUrl: BASE, sidecarToken: DEMO_TOKEN };
const seedConfig = (cfg) => {
  for (const k of Object.keys(cfg)) window.localStorage.setItem(k, JSON.stringify(cfg[k]));
};

const browser = await chromium.launch();
let failed = null;

try {
  // ====================================================================== 1. first run: branded setup screen
  console.log('panel (Globallink build beside the stand-in chat page)');
  const desk = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, locale: 'th-TH' });
  await desk.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await desk.newPage();
  watch(page, 'panel');
  await page.goto(BASE + '/Ufakegbl/chat/U3001');
  const panel = page.frameLocator('#sidecar-host iframe');
  const composer = page.locator('#composer');

  await panel.locator('[data-sc="config"]').waitFor();
  const setupLogo = panel.locator('[data-sc="brand-head"] img');
  await waitFor(async () => (await setupLogo.evaluate((img) => img.complete && img.naturalWidth)) > 0, 'landscape logo loads on the setup screen');
  assert((await setupLogo.getAttribute('src')).includes('logo-landscape-colored'), 'setup screen uses the coloured landscape logo on a light surface');
  const setupText = await panel.locator('[data-sc="config"]').innerText();
  assert(setupText.includes('Link to a Better Life'), 'tagline shown on the setup screen');
  assert(setupText.includes('เชื่อมต่อ Globallink Connect'), 'setup screen names the brand');
  assert(await panel.locator('html').getAttribute('data-theme') === 'globallink', 'theme attribute set before sign-in');
  assert(await page.frames().find((f) => f.url().includes('panel.html')).title() === 'Globallink Connect', 'panel document title uses the brand name');
  assert((await page.locator('#sidecar-toggle img').getAttribute('src')).includes('logo-mark-colored'), 'collapse tab on the host page carries the logo mark');
  await page.screenshot({ path: path.join(SHOTS, '06-setup.png') });
  await panel.locator('[data-sc="cfg-url"]').fill(BASE);
  await panel.locator('[data-sc="cfg-token"]').fill(DEMO_TOKEN);
  await panel.locator('[data-sc="cfg-save"]').click();
  await panel.locator('[data-sc="lead-name"]').waitFor();
  log('first run: setup screen with the Globallink logo and tagline, then the open chat loads');

  // ====================================================================== 2. brand + theme
  assert((await panel.locator('[data-sc="lead-name"]').textContent()).includes('Mint'), 'panel shows the lead of the open chat');
  const mint = (await apiGet('/api/leads/by-chat/U3001')).lead;
  const topbar = panel.locator('.sc-topbar');
  assert(await topbar.evaluate((el) => getComputedStyle(el).backgroundColor) === FOREST, 'top bar is Forest');
  const mark = topbar.locator('img.sc-brand-mark');
  await waitFor(async () => (await mark.evaluate((img) => img.complete && img.naturalWidth)) > 0, 'logo mark loads in the top bar');
  assert((await mark.getAttribute('src')).includes('logo-mark-white'), 'top bar uses the light logo mark on Forest');
  assert((await topbar.locator('[data-sc="brand"] b').textContent()) === 'Globallink Connect', 'top bar names the brand');
  assert(await topbar.locator('[data-sc="brand"] b').evaluate((el) => getComputedStyle(el).color) === IVORY, 'brand name is Ivory on Forest');
  assert(await panel.locator('.sc-root').evaluate((el) => getComputedStyle(el).backgroundColor) === IVORY, 'page background is Ivory');
  const fonts = await panel.locator('.sc-root').evaluate(async (el) => {
    await document.fonts.ready;
    await Promise.all([document.fonts.load('400 14px Sarabun', 'กขค'), document.fonts.load('600 14px Sarabun', 'abc')]);
    return {
      family: getComputedStyle(el).fontFamily,
      thai: document.fonts.check('400 14px Sarabun', 'กขค'),
      latin: document.fonts.check('600 14px Sarabun', 'abc'),
      loaded: [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Sarabun' && f.status === 'loaded').length,
    };
  });
  assert(/^"?Sarabun"?/.test(fonts.family), 'text is set in Sarabun (' + fonts.family + ')');
  assert(fonts.thai && fonts.latin && fonts.loaded >= 2, 'bundled Sarabun faces load for Thai and Latin (' + fonts.loaded + ' loaded)');
  log('Forest top bar with the ivory logo, Ivory page, Sarabun loaded from the build (' + fonts.loaded + ' faces in use)');

  // one coral action in the view
  const ctas = panel.locator('.sc-cta:visible');
  assert(await ctas.count() === 1, 'exactly one coral action in the lead view (found ' + (await ctas.count()) + ')');
  const cta = await ctas.first().evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color, sc: el.dataset.sc }));
  assert(cta.bg === CORAL && cta.ink === 'rgb(11, 26, 16)', 'the main action is Coral with forest-black text (' + JSON.stringify(cta) + ')');
  assert(cta.sc === 'reply-insert', 'the coral action is "insert the draft reply"');
  const save = await panel.locator('[data-sc="note-add"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  assert(save === FOREST, 'section buttons are Forest, not Coral (' + save + ')');
  log('Coral marks one action (insert the draft reply); section buttons are Forest');

  // ====================================================================== 3. profile: stages, requirement card
  const stageOrder = await panel.locator('[data-sc="stages"] [data-stage]').evaluateAll((els) => els.map((el) => el.dataset.stage + ':' + el.textContent));
  assert(stageOrder.join('|') === 'new:ใหม่|interested:รู้ความต้องการ|quoted:ส่งทรัพย์แล้ว|booked:นัดดูทรัพย์|awaiting_payment:รอมัดจำ|paid:วางมัดจำแล้ว|won:ปิดดีล|lost:หลุด|spam:สแปม',
    'stage chips follow the real-estate profile (' + stageOrder.join('|') + ')');
  assert(await panel.locator('[data-stage="booked"].sc-on').count() === 1, 'current stage is highlighted');
  log('stage chips use the real-estate labels and order');
  await page.screenshot({ path: path.join(SHOTS, '01-panel-light.png') });
  await assertClean(panel.locator('#app'), 'panel lead view');
  await assertNoOverflow(panel, 'panel lead view');

  const details = panel.locator('[data-sc="details"]');
  await details.scrollIntoViewIfNeeded();
  assert(await details.isVisible(), 'requirement card is shown');
  assert((await panel.locator('#sc-d-intent').inputValue()) === 'rent' && (await panel.locator('#sc-d-location').inputValue()) === 'Kave Town Colony', 'requirement card shows the lead details');
  assert(await panel.locator('[data-lock="details.budget"]').isHidden(), 'budget starts unlocked');
  const budget = panel.locator('#sc-d-budget');
  await budget.fill('ไม่เกิน 11,500/เดือน');
  await budget.press('Enter');
  await waitFor(async () => (await apiGet('/api/leads/' + mint.id)).lead.details.budget === 'ไม่เกิน 11,500/เดือน', 'budget saved');
  await waitFor(async () => panel.locator('[data-lock="details.budget"]').isVisible(), 'lock mark appears on the edited field');
  await panel.locator('#sc-d-intent').selectOption('buy');
  await waitFor(async () => (await apiGet('/api/leads/' + mint.id)).lead.details.intent === 'buy', 'intent saved');
  await panel.locator('#sc-d-intent').selectOption('rent');
  await waitFor(async () => (await apiGet('/api/leads/' + mint.id)).lead.details.intent === 'rent', 'intent changed back');
  await waitFor(async () => panel.locator('[data-lock="details.intent"]').isVisible(), 'lock mark appears on intent');
  log('requirement card: budget edited, intent changed, both show the lock mark');

  await panel.locator('[data-lock="details.move_in"]').click();
  await waitFor(async () => !(await apiGet('/api/leads/' + mint.id)).lead.locked_fields.includes('details.move_in'), 'field unlocked on the server');
  await waitFor(async () => panel.locator('[data-lock="details.move_in"]').isHidden(), 'lock mark removed');
  const unit = panel.locator('#sc-d-unit_type');
  await unit.fill('');
  await unit.press('Enter');
  await waitFor(async () => !('unit_type' in (await apiGet('/api/leads/' + mint.id)).lead.details), 'emptied field removed from details');
  await unit.fill('Studio');
  await unit.press('Enter');
  await waitFor(async () => (await apiGet('/api/leads/' + mint.id)).lead.details.unit_type === 'Studio', 'field filled again');
  log('lock mark unlocks a field; an emptied field is removed');

  // ====================================================================== 4. offer with a deposit → summary → composer
  const order = panel.locator('[data-sc="order"]');
  await order.scrollIntoViewIfNeeded();
  assert((await order.locator('.sc-sec-title').textContent()) === 'ข้อเสนอ/การจอง', 'order section is titled for the profile');
  assert((await panel.locator('[data-sc="order-status"]').textContent()) === 'ยังไม่มีข้อเสนอ', 'empty offer label');
  assert(await panel.locator('[data-sc="order-payment"]').count() === 0, 'payment selector is hidden when there is one way to pay');
  assert((await panel.locator('[data-sc="product-search"]').getAttribute('placeholder')) === 'ค้นหาทรัพย์เพื่อเพิ่ม…', 'search placeholder comes from the profile');
  await panel.locator('[data-sc="product-search"]').fill('Kave');
  await panel.locator('[data-sc="product-results"] .sc-search-item').first().click();
  assert(await panel.locator('[data-sc="order-items"] .sc-item').count() === 1, 'unit added to the offer');
  await panel.locator('[data-sc="order-deposit"]').fill('5000');
  await waitFor(async () => (await panel.locator('[data-sc="total"]').textContent()).includes('11,000'), 'live total 11,000');
  await panel.locator('[data-sc="order-save"]').click();
  const saved = await waitFor(async () => { const o = (await apiGet('/api/leads/' + mint.id)).order; return o && o.total === 11000 ? o : null; }, 'offer saved');
  assert(saved.deposit_amount === 5000 && saved.payment_method === 'transfer', 'deposit 5,000 and the single payment method saved');
  await panel.locator('[data-sc="summary"]').click();
  await panel.locator('[data-sc="summary-text"]').waitFor();
  const summary = await panel.locator('[data-sc="summary-text"]').textContent();
  assert(summary.includes('5,000') && summary.includes('11,000') && summary.includes('มัดจำ'), 'summary carries the price and the deposit');
  await panel.locator('[data-sc="summary-insert"]').click();
  await waitFor(async () => (await composer.inputValue()).includes('มัดจำ 5,000'), 'summary inserted into the chat composer');
  assert(await panel.locator('.sc-cta:visible').count() === 1, 'still one coral action with the summary open');
  await panel.locator('[data-sc="summary-text"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, '02-offer-summary.png') });
  log('unit added, 5,000 deposit, offer saved; summary built and inserted into the composer');

  // ====================================================================== 5. album labels
  const album = panel.locator('[data-sc="album"]');
  await album.scrollIntoViewIfNeeded();
  const filters = await panel.locator('[data-sc="album-filters"]').innerText();
  for (const label of ['รูปทรัพย์', 'สภาพห้อง', 'เอกสาร']) assert(filters.includes(label), 'album filter "' + label + '"');
  await panel.locator('[data-sc="album-filters"] [data-cat="product"]').click();
  assert(await panel.locator('[data-sc="album-grid"] .sc-thumb').count() === 2, 'unit photo filter leaves two images');
  await panel.locator('[data-sc="album-grid"] .sc-thumb').first().click();
  await panel.locator('[data-sc="lightbox"]').waitFor();
  const cats = await panel.locator('[data-sc="media-category"] option').allTextContents();
  assert(cats.join('|') === 'สลิป|รูปทรัพย์|สภาพห้อง|เอกสาร|อื่น ๆ', 'category picker uses the profile labels (' + cats.join('|') + ')');
  await panel.locator('.sc-lb-close').click();
  await waitFor(async () => (await panel.locator('[data-sc="lightbox"]').count()) === 0, 'lightbox closed');
  await assertClean(panel.locator('#app'), 'panel after edits');
  log('album filters and the category picker use the real-estate labels');

  // unknown chat → link by hand
  await page.locator('[data-chat="Cgbl7777"]').click();
  await panel.locator('[data-sc="unknown-chat"]').waitFor();
  assert((await panel.locator('[data-sc="unknown-chat"]').innerText()).includes('เชื่อม Globallink Connect กับ LINE OA'), 'unknown-chat text names the brand');
  await waitFor(async () => (await panel.locator('[data-sc="candidates"]').textContent()).includes('น้ำ'), 'candidate listed by name');
  await panel.locator('[data-sc="link-chat"]').first().click();
  await waitFor(async () => (await panel.locator('[data-sc="lead-name"]').count()) && (await panel.locator('[data-sc="lead-name"]').textContent()).includes('น้ำ'), 'linked lead shown');
  log('unknown chat links to a lead in the branded panel');

  // settings screen wording
  await panel.locator('[data-sc="open-settings"]').click();
  await panel.locator('[data-sc="set-pay"]').waitFor();
  const settingsText = await panel.locator('[data-sc="settings"]').innerText();
  assert(settingsText.includes('ทรัพย์') && !settingsText.includes('สินค้า'), 'settings talk about units, not products');
  log('settings screen uses the profile wording');
  await desk.close();

  // ====================================================================== 6. mobile staff page
  console.log('staff.html (390px, Globallink build)');
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
  await phoneCtx.addInitScript(seedConfig, config);
  const mob = await phoneCtx.newPage();
  watch(mob, 'staff');
  await mob.goto(BASE + '/staff.html');
  await mob.locator('[data-sc="inbox-list"] .sc-row').first().waitFor();
  assert(await mob.title() === 'Globallink Connect — ทีมงาน', 'page title uses the brand name (' + (await mob.title()) + ')');
  assert((await mob.locator('meta[name="theme-color"]').getAttribute('content')) === '#193e24', 'browser chrome colour is Forest');
  const mintRow = mob.locator('[data-sc="inbox-list"] .sc-row', { hasText: 'Mint 🌿' });
  assert((await mintRow.locator('[data-sc="row-meta"]').textContent()) === 'หาเช่า · Kave Town Colony', 'inbox row shows intent and location');
  assert(await mob.locator('[data-sc="inbox-list"] .sc-row', { hasText: 'รับยิงแอด' }).locator('[data-sc="row-meta"]').count() === 0, 'rows without details have no extra line');
  const tabs = await mob.locator('[data-sc="inbox-tabs"] [data-tab]').evaluateAll((els) => els.map((el) => el.dataset.tab));
  assert(tabs.join('|') === 'all|due|new|interested|quoted|booked|awaiting_payment|paid|won|lost|spam', 'inbox tabs follow the profile order');
  assert((await mob.locator('[data-tab="booked"]').textContent()).includes('นัดดูทรัพย์'), 'inbox tab label from the profile');
  assert(await mob.locator('[data-tab="all"].sc-on').evaluate((el) => getComputedStyle(el).backgroundColor) === FOREST, 'active tab is Forest');
  await mob.screenshot({ path: path.join(SHOTS, '03-mobile-inbox.png') });
  await assertClean(mob.locator('#app'), 'mobile inbox');
  await assertNoOverflow(mob, 'mobile inbox');
  log('mobile inbox: intent · location line, profile tabs, Forest active tab');

  await mintRow.click();
  await mob.locator('[data-sc="lead-page"] [data-sc="lead-name"]').waitFor();
  assert(await mob.locator('.sc-cta:visible').count() === 1, 'one coral action on the mobile lead view');
  await mob.locator('[data-sc="details"]').scrollIntoViewIfNeeded();
  await mob.evaluate(() => { const m = document.querySelector('.sc-main'); const d = document.querySelector('[data-sc="details"]'); m.scrollTop += d.getBoundingClientRect().top - m.getBoundingClientRect().top - 150; });
  await mob.screenshot({ path: path.join(SHOTS, '04-mobile-lead-requirements.png') });
  await assertClean(mob.locator('#app'), 'mobile lead view');
  await assertNoOverflow(mob, 'mobile lead view');
  log('mobile lead view shows the requirement card');
  await phoneCtx.close();

  // 360px: the narrowest phone width the layout has to hold
  const narrowCtx = await browser.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
  await narrowCtx.addInitScript(seedConfig, config);
  const narrow = await narrowCtx.newPage();
  watch(narrow, 'staff-360');
  await narrow.goto(BASE + '/staff.html');
  await narrow.locator('[data-sc="inbox-list"] .sc-row').first().waitFor();
  await assertNoOverflow(narrow, 'inbox at 360px');
  await narrow.locator('[data-sc="inbox-list"] .sc-row', { hasText: 'Mint 🌿' }).click();
  await narrow.locator('[data-sc="lead-page"] [data-sc="lead-name"]').waitFor();
  await assertNoOverflow(narrow, 'lead view at 360px');
  const clipped = await narrow.locator('.sc-main').evaluate((main) => {
    const limit = main.getBoundingClientRect().right + 0.5;
    return [...main.querySelectorAll('button, input, select, textarea, .sc-chip, .sc-card')]
      .filter((el) => el.offsetParent && el.getBoundingClientRect().right > limit)
      .map((el) => el.dataset.sc || el.className).slice(0, 5);
  });
  assert(clipped.length === 0, 'nothing sticks out of the column at 360px (' + clipped.join(', ') + ')');
  await narrow.screenshot({ path: path.join(SHOTS, '08-mobile-360.png') });
  log('nothing is clipped at 360px');
  await narrowCtx.close();

  // ====================================================================== 7. dark scheme
  const dark = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'th-TH' });
  await dark.addInitScript(seedConfig, config);
  const dpage = await dark.newPage();
  watch(dpage, 'panel-dark');
  await dpage.goto(BASE + '/Ufakegbl/chat/U3002');
  const dpanel = dpage.frameLocator('#sidecar-host iframe');
  await dpanel.locator('[data-sc="lead-name"]').waitFor();
  assert(await dpanel.locator('.sc-topbar').evaluate((el) => getComputedStyle(el).backgroundColor) === FOREST, 'top bar stays Forest in dark');
  assert(await dpanel.locator('.sc-root').evaluate((el) => getComputedStyle(el).backgroundColor) === 'rgb(12, 20, 15)', 'dark page is forest-black');
  assert(await dpanel.locator('.sc-root').evaluate((el) => getComputedStyle(el).color) === IVORY, 'dark text is Ivory');
  assert(await dpanel.locator('.sc-cta:visible').first().evaluate((el) => getComputedStyle(el).backgroundColor) === CORAL, 'Coral accent in dark');
  await dpanel.locator('.sc-topbar img.sc-brand-mark').evaluate((img) => img.decode());
  await dpage.screenshot({ path: path.join(SHOTS, '05-panel-dark.png') });
  log('dark scheme: forest-black surfaces, Ivory text, Coral action');
  await dark.close();

  // ====================================================================== 8. options page
  console.log('options.html (Globallink build)');
  const optCtx = await browser.newContext({ viewport: { width: 520, height: 680 }, deviceScaleFactor: 2, locale: 'th-TH' });
  const opt = await optCtx.newPage();
  watch(opt, 'options');
  await opt.goto(BASE + '/extension/options.html');
  await waitFor(async () => (await opt.locator('#brandHead img').evaluate((img) => img.complete && img.naturalWidth)) > 0, 'logo on the options page');
  assert(await opt.title() === 'Globallink Connect — ตั้งค่า', 'options title uses the brand name');
  assert((await opt.locator('#optTitle').textContent()) === 'ตั้งค่า Globallink Connect', 'options heading names the brand');
  assert(!(await opt.locator('body').innerText()).includes('Sidecar'), 'no neutral brand name left on the options page');
  await opt.locator('#apiUrl').fill(BASE);
  await opt.locator('#token').fill(DEMO_TOKEN);
  await opt.locator('#test').click();
  await waitFor(async () => (await opt.locator('#result').textContent()).includes('token ใช้ได้'), 'connection test passes');
  await opt.screenshot({ path: path.join(SHOTS, '07-options.png') });
  log('options page: logo, tagline, brand name, connection test');
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
console.log('\nSMOKE GBL OK — ' + step + ' checks, screenshots in ' + path.relative(process.cwd(), SHOTS));
