#!/usr/bin/env node
/*
 * Screenshots for the user guide (requires Playwright + Chromium):
 *   node tools/doc-shots.cjs <out-dir>
 * Light theme, demo terrain, every tool run once through the UI. Images are
 * grayscale so the printed guide stays black-only.
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const out = path.resolve(process.argv[2] || 'docs/guide/img');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1.5 });
  await p.addInitScript(() => {
    localStorage.setItem('mtnai.settings.v1', JSON.stringify({ 'ui.theme': 'light', 'ui.toastSec': 0.1 }));
    localStorage.setItem('mtnai.layout.v2', JSON.stringify({ dockClosed: true }));
  });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const gray = () => p.addStyleTag({ content: 'html { filter: grayscale(1) } #toast { display: none !important }' });
  const shot = async (name, clip) => { await p.waitForTimeout(250); await p.screenshot({ path: path.join(out, name + '.png'), clip }); };
  const job = async (sel) => {
    const n = await p.evaluate(() => MTN_UI.jobSeq);
    await p.click(sel);
    await p.waitForFunction((k) => MTN_UI.jobSeq > k, n, { timeout: 180000 });
    await p.waitForTimeout(300);
  };
  const rbTab = async (t) => { if (!(await p.locator(`#rbTabs [data-rbtab=${t}].on`).count())) await p.click(`#rbTabs [data-rbtab=${t}]`); };
  const gp = async (tab, tool, setup) => {
    await rbTab(tab);
    await p.click(`#rbBody [data-cmd="gp:${tool}"]`);
    if (setup) await setup();
    await job('#gpPane [data-run]');
  };
  const fit = () => p.evaluate(() => MTN_UI.app.map.fit());

  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await gray();
  await shot('01_welcome');
  await p.click('#welcome [data-cmd="gp:downloadDEM"]');
  await shot('03_download');
  await p.click('#welcome [data-cmd=demo]');
  await p.waitForFunction(() => MTN_UI.S.grid && MTN_UI.jobSeq >= 1, null, { timeout: 120000 });
  await p.waitForTimeout(800);
  await gp('analysis', 'mobility');
  await fit();
  await shot('05_mobility');
  await shot('04_ribbon', { x: 0, y: 0, width: 1440, height: 150 });
  await gp('analysis', 'keyTerrain');
  await shot('06_key');
  await gp('analysis', 'hostile');
  await gp('analysis', 'avenues');
  await shot('07_hostile');
  await gp('analysis', 'posts');
  await shot('08_posts');
  await shot('02_workspace');
  for (const w of ['mg3', 'mor81']) await gp('analysis', 'weapons', () => p.selectOption('#gpPane [data-k=weaponId]', w));
  await p.evaluate(() => {
    const S = MTN_UI.S, wi = S.weapons.findIndex((w) => w.weapon.id === 'mg3');
    MTN_UI.app.select({ kind: 'weapon', idx: wi, sub: 0 }, false, true);
    const s = S.weapons[wi].sites[0]; MTN_UI.app.map.centerOn(s.c, s.r, 1.6);
  });
  await shot('09_weapons');
  await gp('analysis', 'mfd');
  await fit();
  await shot('10_mfd');
  await gp('analysis', 'route');
  await p.click('#rbBody [data-cmd=routeCard]');
  await fit();
  await shot('11_route');
  await gp('analysis', 'picquets');
  await shot('12_picquets');
  await gp('analysis', 'helipads');
  await shot('13_helipads');
  await p.evaluate(() => MTN_UI.app.openLayerProps('dem'));
  await shot('14_props');
  await p.click('#props [data-close]');
  await p.evaluate(() => MTN_UI.Settings.open('crs'));
  await shot('15_settings');
  await p.click('#settings .dlg-foot [data-close]');
  await p.evaluate(() => MTN_UI.app.runCmd('doctrine'));
  await shot('17_doctrine');
  await p.click('#help [data-close]');
  await p.evaluate(() => { const S = MTN_UI.S; const a = S.markers.own, b = S.markers.threat; MTN_UI.app.showMeasure([a.c, a.r], [b.c, b.r]); });
  await shot('18_measure');
  await p.click('#vtScene');
  await p.waitForTimeout(2500);
  await shot('16_scene');
  await browser.close();
  if (errors.length) { console.error('page errors:', errors); process.exit(1); }
  console.log('screenshots written to', out);
})();
