#!/usr/bin/env node
/*
 * Browser smoke test (requires Playwright + Chromium):
 *   node tools/e2e-smoke.cjs [page.html] [screenshot-dir]
 * Loads the synthetic demo from file://, runs every analysis through the UI and
 * fails on any page error or failed job. Defaults to index.html, no screenshots.
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const page = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
  const shots = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await browser.newPage({ viewport: { width: 1600, height: 920 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, name + '.jpg'), type: 'jpeg', quality: 82 }); };
  const job = async (sel) => {
    const n = await p.evaluate(() => MTN_UI.jobSeq);
    await p.click(sel);
    await p.waitForFunction((k) => MTN_UI.jobSeq > k, n, { timeout: 180000 });
    await p.waitForTimeout(200);
  };

  // Run a geoprocessing tool from the ribbon: open its pane, optionally set parameters, press Run.
  const rbTab = async (t) => { if (!(await p.locator(`#rbTabs [data-rbtab=${t}].on`).count())) await p.click(`#rbTabs [data-rbtab=${t}]`); };
  const gp = async (tabName, tool, setup) => {
    await rbTab(tabName);
    await p.click(`#rbBody [data-cmd="gp:${tool}"]`);
    if (setup) await setup();
    await job('#gpPane [data-run]');
    const msg = await p.textContent('#gpPane .gp-msg');
    if (/Failed/.test(msg)) throw new Error(`${tool}: ${msg}`);
  };
  await p.goto('file://' + page + '#demo');
  await p.waitForFunction(() => window.MTN_UI && MTN_UI.S.grid && MTN_UI.jobSeq >= 1, null, { timeout: 120000 });
  await p.waitForTimeout(500);
  const mode = await p.evaluate(() => MTN_UI.app.engine.mode);
  await gp('analysis', 'keyTerrain');
  await gp('analysis', 'mobility');
  await shot('mobility');
  await gp('analysis', 'hostile');
  await gp('analysis', 'avenues');
  await gp('analysis', 'posts', async () => {
    await p.click('#gpPane [data-sec="posts:Site constraints"]');
    await p.fill('#gpPane [data-k=maxSlope]', '32'); await p.press('#gpPane [data-k=maxSlope]', 'Tab');
  });
  await shot('posts');
  for (const w of ['mg3', 'baktar', 'mor81']) await gp('analysis', 'weapons', () => p.selectOption('#gpPane [data-k=weaponId]', w));
  await gp('analysis', 'mfd');
  await rbTab('map'); await p.click('#rbBody [data-cmd=attrTable]');
  await p.click('#attrTable tbody tr:nth-child(3)');
  await shot('tactical');
  await gp('analysis', 'route');
  await gp('analysis', 'picquets');
  await gp('analysis', 'helipads');
  await p.click('#rbBody [data-cmd=routeCard]');
  const cardRows = await p.locator('#cardTable tbody tr').count();
  if (cardRows < 3) throw new Error('route card empty');
  await shot('routes');
  // Contents pane: toggle a layer, open its properties
  await p.click('#toc [data-layer="dem"]', { clickCount: 2 });
  await p.waitForTimeout(300);
  await shot('props');
  await p.click('#props [data-close]');
  await p.click('#vtScene'); await p.waitForTimeout(1500);
  await shot('3d');

  const res = await p.evaluate(() => {
    const S = MTN_UI.S;
    return {
      posts: S.posts ? S.posts.posts.length : 0,
      weapons: S.weapons.map((w) => w.sites.length),
      minefields: S.mfd ? S.mfd.fields.length : 0,
      routes: S.routes ? S.routes.routes.length : 0,
      picquets: S.picquets ? S.picquets.picquets.length : 0,
      helipads: S.helipads ? S.helipads.pads.length : 0,
      failedJobs: document.querySelectorAll('#log td.err').length,
      tocLayers: document.querySelectorAll('#toc [data-layer]').length,
    };
  });
  await browser.close();
  console.log(`engine: ${mode}`, JSON.stringify(res));
  const ok = !errors.length && !res.failedJobs && res.posts && res.weapons.every(Boolean) && res.minefields && res.routes && res.picquets && res.helipads && res.tocLayers > 8;
  if (!ok) { console.error('SMOKE TEST FAILED', errors); process.exit(1); }
  console.log('smoke test passed');
})();
