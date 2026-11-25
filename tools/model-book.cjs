#!/usr/bin/env node
/*
 * ModelBuilder book (Playwright + Chromium):
 *   node tools/model-book.cjs [out.pdf]
 * Opens every ready-made model on the demo terrain in ModelBuilder, runs it, puts its key
 * intermediate and final results on the map, and prints: how ModelBuilder works, the toolbox,
 * and per model the diagram, the values used, each tool with its inputs and this run's output,
 * the map pictures and the result tables. A4, Arial 12, black only.
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

// results to picture per model: [caption, [variable ids to show], raster id to draw]
const SHOTS = {
  gonogo: [['Go / No-Go raster: GO, SLOW-GO and NO-GO ground for infantry', ['gonogo'], 'gonogo']],
  route: [['Cost raster: 1 on GO, 1.43 on SLOW-GO, higher where the enemy sees; dark = NoData (cannot be crossed)', ['cost'], 'cost'],
    ['Path Distance from A (hours) and the Cost Path to B, traced back along the backlink', ['pd', 'route'], 'pd']],
  approaches: [['Entry points behind the border (E) and objectives (dominating heights on our side)', ['entries', 'obj'], null],
    ['Time from the nearest entry point (hours); dark cells cannot be reached', ['pd', 'entries'], 'pd'],
    ['Enemy approaches: Cost Path from each objective back to the entry point nearest in time (shading = which entry is nearest)', ['appr', 'entries', 'obj'], 'al']],
  infiltration: [['Cost raster: ground our OP sees costs 7 times as much', ['cost'], 'cost'], ['Hidden route over the time raster', ['route'], 'pd']],
  ops: [['OP candidates: dominating heights on usable ground', ['cand'], 'ok'], ['Chosen OPs and their combined coverage', ['ops'], 'cov']],
};

(async () => {
  const out = path.resolve(process.argv[2] || 'docs/guide/MtnEye_ModelBuilder.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  await p.addInitScript(() => {
    localStorage.setItem('mtnai.settings.v1', JSON.stringify({ 'ui.toastSec': 0.1 }));
    localStorage.setItem('mtnai.layout.v2', JSON.stringify({ dockClosed: true }));
  });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html') + '#demo');
  await p.waitForFunction(() => window.MTN_UI && MTN_UI.S.grid && MTN_UI.jobSeq >= 1, null, { timeout: 120000 });
  await p.evaluate(() => { for (const c of ['toggleLeft', 'toggleRight']) MTN_UI.app.runCmd(c); });
  await p.addStyleTag({ content: '#toast { display: none !important } .map-ctl { display: none !important }' });

  const sections = [];
  for (const id of Object.keys(SHOTS)) {
    await p.evaluate((t) => MTN_UI.MB.open(t), id);
    await p.waitForTimeout(300);
    await p.evaluate(() => MTN_UI.MB.run());
    await p.waitForFunction(() => !MTN_UI.MB.running && MTN_UI.MB.rep, null, { timeout: 300000 });
    if (await p.evaluate(() => MTN_UI.MB.rep.failed)) throw new Error(`model ${id} failed`);
    const shots = [];
    for (const [title, ids, ras] of SHOTS[id]) {
      await p.evaluate(async ([v, r]) => { await MTN_UI.MB.showOnly(v, r); MTN_UI.app.setView('2d'); MTN_UI.app.map.fit(); }, [ids, ras]);
      await p.waitForTimeout(800);
      const buf = await p.locator('#stage').screenshot({ type: 'png' });
      const src = await p.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const w = Math.min(1100, img.width), h = Math.round((img.height * w) / img.width);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.filter = 'grayscale(1) contrast(1.1)'; cx.drawImage(img, 0, 0, w, h);
        return cv.toDataURL('image/jpeg', 0.8);
      }, buf.toString('base64'));
      shots.push({ title, src });
    }
    await p.evaluate(() => MTN_UI.app.setView('model'));
    sections.push(await p.evaluate((sh) => MTN_UI.MB.reportHTML({ shots: sh }), shots));
  }
  const toolbox = await p.evaluate(() => Object.values(MTN_UI.M.GPT).map((d) => ({ name: d.name, arc: d.arc, help: d.help,
    params: d.params.map((x) => `${x.dir === 'out' ? '→ ' : ''}${x.label}${x.optional ? ' (optional)' : ''}`) })));
  const css = await p.evaluate(() => MTN_UI.MB.REPORT_CSS);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const names = sections.map((s) => s.match(/<h2>(.*?)<\/h2>/)[1]);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>MtnEye ModelBuilder</title><style>${css}</style></head><body>
    <h1>MtnEye ModelBuilder</h1>
    <p>Each MtnEye analysis is a chain of ordinary GIS tools — Slope, Reclassify, Raster Calculator, Viewshed, Path Distance, Cost Path — built as it would be in ArcGIS ModelBuilder. This book prints the ready-made models after a real run on the demo terrain: the diagram, every value used, every tool with its inputs and output, pictures of the intermediate rasters, and the result tables.</p>
    <h3>How ModelBuilder works</h3>
    <table><tr><th style="width:26%">Element</th><th>Meaning</th></tr>
      <tr><td>Input data (oval)</td><td>Data the model starts from, e.g. the DEM.</td></tr>
      <tr><td>Value variable (oval; dashed in print)</td><td>A number, text, point, line or movement class a tool uses. Click it to change it. <b>P</b> = model parameter (listed at the top of the side panel).</td></tr>
      <tr><td>Tool (rounded box)</td><td>One geoprocessing step. Click it to see what it does and its ArcGIS equivalent, and to choose each input: a model variable or a typed value. “Expose as variable” turns a typed value into an oval on the model.</td></tr>
      <tr><td>Derived data (double oval)</td><td>The output of a tool, used by the next tool. Click it for statistics; tick “Add to display” to put it on the map.</td></tr>
      <tr><td>States</td><td>Grey = not ready (an input is missing). Coloured = ready to run. Drop shadow = has been run. Red outline = failed; the message under the tool says why.</td></tr>
      <tr><td>Running</td><td>▶ Run runs the whole model in dependency order. A tool whose inputs have not changed is not run again. Right-click a tool ▸ Run runs it and whatever it needs.</td></tr>
      <tr><td>Raster Calculator</td><td>A formula over rasters in quotes and values in percent signs, e.g. <code>Con("Go / No-Go" == 2, NoData, 1 + %Exposure weight% * ("Enemy view" &gt; 0))</code>. Con(test, a, b) = a where the test is true, else b. Path Distance cannot cross NoData cells.</td></tr>
    </table>
    <p><b>In the app:</b> the ModelBuilder tab next to Map and Scene (also Analysis ▸ Model and Sector ▸ Model), or “Open as a model” after running a tool. Build your own models with Add tool and Add variable; Export and Import save them as files.</p>
    <h3>Models in this book</h3><ol>${names.map((n) => `<li>${n}</li>`).join('')}</ol>
    <section><h2>Toolbox</h2><table><tr><th style="width:22%">Tool</th><th>What it does</th><th style="width:30%">Parameters (→ output)</th></tr>
      ${toolbox.map((t) => `<tr><td><b>${esc(t.name)}</b><br><span class="small">${esc(t.arc)}</span></td><td>${esc(t.help)}</td><td class="small">${t.params.map(esc).join('<br>')}</td></tr>`).join('')}</table>
      <h3>When a model produces nothing</h3><table><tr><th>Message</th><th>Meaning</th><th>What to do</th></tr>
      <tr><td>Not ready: … has no value</td><td>An input oval is empty (e.g. no point picked).</td><td>Click the oval and set it, or pick it on the map.</td></tr>
      <tr><td>Every source sits on NoData cost cells</td><td>The start is on ground the cost raster blocks (NO-GO).</td><td>Move the point, or change Reclassify / Raster Calculator so that ground is passable.</td></tr>
      <tr><td>No path: … cannot be reached (NoData time)</td><td>NO-GO ground cuts the destination off from every source.</td><td>That is the answer for this movement class. Try foot, or snap the point to the nearest reachable cell.</td></tr>
      <tr><td>No valid cell within … m</td><td>Snap Points found no passable or reached cell near a point.</td><td>Raise the search distance, or accept that the point is unreachable.</td></tr>
      <tr><td>No height found</td><td>The mask leaves no ground to search, or the radius is too big.</td><td>Check the mask raster (e.g. own side); reduce the search radius.</td></tr>
      </table></section>
    ${sections.map((s) => `<section>${s}</section>`).join('')}
  </body></html>`;
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(html, { waitUntil: 'load' });
  await pdfPage.pdf({ path: out, format: 'A4', printBackground: false, margin: { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-family:Arial;font-size:9pt;color:#000;width:100%;text-align:center"><span class="pageNumber"></span></div>' });
  await browser.close();
  if (errors.length) { console.error('page errors:', errors); process.exit(1); }
  console.log('wrote', out);
})();
