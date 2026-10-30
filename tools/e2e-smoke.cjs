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

  const tab = async (t) => { if (!(await p.locator(`#rail button[data-tab=${t}].on`).count())) await p.click(`#rail button[data-tab=${t}]`); };
  await p.goto('file://' + page + '#demo');
  await p.waitForFunction(() => window.MTN_UI && MTN_UI.S.grid && MTN_UI.jobSeq >= 1, null, { timeout: 120000 });
  await p.waitForTimeout(500);
  const mode = await p.evaluate(() => MTN_UI.app.engine.mode);
  await tab('terrain'); await job('.panel [data-cmd=key]');
  await tab('mobility'); await job('.panel [data-cmd=mobility]');
  await shot('mobility');
  await tab('tactical');
  await job('.panel [data-cmd=hostile]'); await job('.panel [data-cmd=avenues]'); await job('.panel [data-cmd=posts]');
  await shot('posts');
  for (const w of ['mg3', 'baktar', 'mor81']) { await p.selectOption('#wpnSelect', w); await job('.panel [data-cmd=weapons]'); }
  await job('.panel [data-cmd=mfd]');
  await p.click('.item[data-kind=weapon]');
  await shot('tactical');
  await tab('routes');
  await job('.panel [data-cmd=route]'); await job('.panel [data-cmd=picquets]');
  await shot('routes');
  await p.click('#btn3d'); await p.waitForTimeout(1500);
  await shot('3d');

  const res = await p.evaluate(() => {
    const S = MTN_UI.S;
    return {
      posts: S.posts ? S.posts.posts.length : 0,
      weapons: S.weapons.map((w) => w.sites.length),
      minefields: S.mfd ? S.mfd.fields.length : 0,
      routes: S.routes ? S.routes.routes.length : 0,
      picquets: S.picquets ? S.picquets.picquets.length : 0,
      failedJobs: document.querySelectorAll('.log-e.err').length,
    };
  });
  await browser.close();
  console.log(`engine: ${mode}`, JSON.stringify(res));
  const ok = !errors.length && !res.failedJobs && res.posts && res.weapons.every(Boolean) && res.minefields && res.routes && res.picquets;
  if (!ok) { console.error('SMOKE TEST FAILED', errors); process.exit(1); }
  console.log('smoke test passed');
})();
