#!/usr/bin/env node
/* Screenshot the app with the demo and a typical set of results: node tools/ui-shot.cjs <out.png> [light|dark] [page] */
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const out = path.resolve(process.argv[2] || 'ui.png');
  const theme = process.argv[3] || 'dark';
  const page = path.resolve(process.argv[4] || path.join(__dirname, '..', 'index.html'));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await p.addInitScript((t) => localStorage.setItem('mtnai.settings.v1', JSON.stringify({ 'ui.theme': t, 'ui.toastSec': 0.1 })), theme);
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('file://' + page + '#demo');
  await p.waitForFunction(() => window.MTN_UI && MTN_UI.S.grid && MTN_UI.jobSeq >= 1, null, { timeout: 120000 });
  const gp = async (tool) => {
    const n = await p.evaluate(() => MTN_UI.jobSeq);
    await p.evaluate((t) => { MTN_UI.app.runCmd('gp:' + t); }, tool);
    await p.click('#gpPane [data-run]');
    await p.waitForFunction((k) => MTN_UI.jobSeq > k && !document.body.classList.contains('busy'), n, { timeout: 120000 });
  };
  for (const t of ['keyTerrain', 'mobility', 'posts', 'route']) await gp(t);
  await p.evaluate(() => MTN_UI.app.runCmd('fit'));
  await p.waitForTimeout(600);
  await p.screenshot({ path: out });
  await browser.close();
  if (errors.length) { console.error(errors); process.exit(1); }
  console.log('wrote', out);
})();
