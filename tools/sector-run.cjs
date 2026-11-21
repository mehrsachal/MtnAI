#!/usr/bin/env node
/*
 * Sector planning end-to-end run (Playwright + Chromium):
 *   node tools/sector-run.cjs <out-dir> [sector-spec.json]
 * Without a spec it uses the demo terrain (its notional border and sector).
 * A spec downloads a DEM and sets the border / sector from lat-lon points:
 *   { "name": "...", "center": "34.62, 73.96", "widthKm": 16, "heightKm": 16, "zoom": 12,
 *     "border": [[lat, lon], ...], "sector": [[lat, lon], ...] (optional), "mode": "normal" }
 * Runs Sector Assessment (run all) through the UI, then exports Shapefiles and the report,
 * screenshots the result and writes a JSON summary.
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const out = path.resolve(process.argv[2] || 'sector-out');
  const spec = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : null;
  fs.mkdirSync(out, { recursive: true });
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ proxy, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, ignoreHTTPSErrors: true, acceptDownloads: true });
  await ctx.addInitScript((mode) => {
    localStorage.setItem('mtnai.settings.v1', JSON.stringify({ 'ui.theme': 'light', 'ui.toastSec': 0.1 }));
    localStorage.setItem('mtnai.gp.v1', JSON.stringify({ sectorAll: { mode } }));
  }, (spec && spec.mode) || 'normal');
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const downloads = [];
  p.on('download', async (d) => { const f = path.join(out, d.suggestedFilename()); await d.saveAs(f); downloads.push(f); });
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  const waitJobs = async (n0) => p.waitForFunction((k) => MTN_UI.jobSeq > k && !document.body.classList.contains('busy'), n0, { timeout: 600000 });

  if (!spec) {
    await p.click('#welcome [data-cmd=demo]');
    await p.waitForFunction(() => MTN_UI.S.grid && MTN_UI.jobSeq >= 1, null, { timeout: 120000 });
  } else {
    await p.click('#welcome [data-cmd="gp:downloadDEM"]');
    await p.selectOption('#gpPane [data-k=zoom]', String(spec.zoom || 12));
    for (const [k, v] of [['center', spec.center], ['widthKm', spec.widthKm], ['heightKm', spec.heightKm]]) { await p.fill(`#gpPane [data-k=${k}]`, String(v)); await p.press(`#gpPane [data-k=${k}]`, 'Tab'); }
    await p.click('#gpPane [data-k=saveCopy]');
    const n0 = await p.evaluate(() => MTN_UI.jobSeq);
    await p.click('#gpPane [data-run]');
    await waitJobs(n0 + 1);
    const err = await p.evaluate(() => (document.querySelector('#gpPane .gp-msg.err') || {}).textContent);
    if (err) throw new Error(err);
    // border / sector from lat-lon, through the same path as drawing them
    await p.evaluate(async (sp) => {
      const S = MTN_UI.S, M = MTN_UI.M;
      const cell = ([lat, lon]) => { const q = M.latLonToCell(S.grid, lat, lon); return [q.c, q.r]; };
      S.border = sp.border.map(cell);
      S.sector = sp.sector ? sp.sector.map(cell) : null;
      if (sp.own) { const q = M.latLonToCell(S.grid, sp.own[0], sp.own[1]); S.markers.own = { c: Math.round(q.c), r: Math.round(q.r) }; }
    }, spec);
  }
  await p.waitForTimeout(500);
  await p.click('#rbTabs [data-rbtab=sector]');
  await p.click('#rbBody [data-cmd="gp:sectorAll"]');
  const n1 = await p.evaluate(() => MTN_UI.jobSeq);
  await p.click('#gpPane [data-run]');
  await p.waitForFunction(() => { const m = document.querySelector('#gpPane .gp-msg'); return m && !m.classList.contains('run'); }, null, { timeout: 900000 });
  const msg = await p.textContent('#gpPane .gp-msg');
  await p.evaluate(() => MTN_UI.app.map.fit());
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(out, 'sector_map.png') });
  // a cleaner map: hide rasters and enemy options, show plan
  await p.evaluate(() => { const S = MTN_UI.S; S.overlays.dominance.visible = false; S.overlays.firecov.visible = false; S.show.eopts = false; S.show.infil = false; MTN_UI.app.runCmd('fit'); });
  await p.evaluate(() => MTN_UI.app.select && MTN_UI.app.showRightTab('attr'));
  await p.click('#rbTabs [data-rbtab=map]'); await p.evaluate(() => MTN_UI.app.runCmd('attrTable'));
  await p.selectOption('#attrLayer', 'plan').catch(() => {});
  await p.evaluate(() => { const S = MTN_UI.S; S.overlays.dominance.visible = false; MTN_UI.app.map.render(); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(out, 'sector_plan.png') });
  await p.evaluate(() => { const S = MTN_UI.S; S.show.eopts = true; S.show.plan = false; S.show.itgs = true; S.show.eappr = false; S.overlays.firecov.visible = false; MTN_UI.app.map.render(); });
  await p.selectOption('#attrLayer', 'eopts').catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(out, 'sector_enemy.png') });
  // exports
  await p.evaluate(() => MTN_UI.app.doExport('shp'));
  await p.evaluate(() => MTN_UI.app.doExport('geojson'));
  await p.waitForTimeout(1500);
  const summary = await p.evaluate(() => {
    const S = MTN_UI.S, X = S.sec, items = MTN_UI._secItems ? MTN_UI._secItems() : [];
    const cnt = {}; items.forEach((x) => { if (x.rating) cnt[x.rating] = (cnt[x.rating] || 0) + 1; });
    return {
      dem: S.grid.name, cells: `${S.grid.w}x${S.grid.h}@${S.grid.cs}m`, ratings: cnt,
      ridges: X.terr && X.terr.ridges.length, nullahs: X.terr && X.terr.nullahs.length,
      itgs: X.itg && X.itg.itgs.map((q) => `${q.id} ${Math.round(q.z)}m ${q.areaHa.toFixed(1)}ha ${q.force.echelon} ${q.rating}`),
      plan: X.plan && { mode: X.plan.modeName, borderPosts: X.plan.borderPosts.length, platoons: X.plan.platoons.length, companies: X.plan.companies.length, troops: X.plan.troops, notes: X.plan.notes },
      border: X.watch && { observed: Math.round(X.watch.observedShare * 100), rating: X.watch.rating, gaps: X.watch.gaps.length, extraOPs: X.watch.extraOPs.length },
      approaches: X.appr && X.appr.approaches.map((a) => `${a.id}->${a.objective} ${a.type} ${(a.lengthM / 1000).toFixed(1)}km ${Math.round(a.exposure * 100)}% watched ${a.threat}`),
      infiltration: X.infil && X.infil.routes.map((a) => `${a.id} ${a.type} ${Math.round(a.detectShare * 100)}% watched ${a.threat}`),
      fire: X.fire && { gaps: X.fire.gaps.length, interlocking: X.fire.postCover.map((q) => q.coveredBy).join(',') },
      options: X.opts && X.opts.options.map((o) => `${o.id} [${o.label}] ${o.threat}: ${o.summary}`),
    };
  });
  summary.message = msg; summary.downloads = downloads.map((f) => path.basename(f)); summary.errors = errors;
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  await browser.close();
  console.log(JSON.stringify(summary, null, 1));
  if (errors.length || /Failed/.test(msg)) process.exit(1);
})();
