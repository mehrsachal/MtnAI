#!/usr/bin/env node
/*
 * Briefing book "How each tool thinks" (Playwright + Chromium):
 *   node tools/briefing.cjs [out.pdf]
 * Runs every explained tool on the demo terrain through the UI, takes the Brief-mode map
 * of the key steps, and prints the Model view specs (diagram, steps with this run's numbers,
 * how to read, nothing-found table, brief script) to an A4 PDF — Arial 12, black only.
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const out = path.resolve(process.argv[2] || 'docs/guide/MtnEye_How_Each_Tool_Thinks.pdf');
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
  const gp = (tool, set) => p.evaluate(async ([t, s]) => {
    MTN_UI.app.runCmd('gp:' + t);
    for (const [k, v] of Object.entries(s || {})) MTN_UI.GP.set(t, k, v);
    await MTN_UI.GP.run(t);
  }, [tool, set]);
  for (const t of ['mobility', 'keyTerrain', 'hostile', 'avenues', 'posts']) await gp(t);
  await gp('weapons', { weaponId: 'mg3' });
  for (const t of ['mfd', 'route', 'picquets', 'helipads']) await gp(t);
  await gp('routeViewshed', { source: 'route' });
  await gp('sectorAll');
  // close the side panes so the map is large
  await p.evaluate(() => { for (const c of ['toggleLeft', 'toggleRight']) MTN_UI.app.runCmd(c); });
  await p.addStyleTag({ content: '#briefBar { display: none !important } #toast { display: none !important } .map-ctl { display: none !important }' });
  await p.waitForTimeout(500);

  const specs = await p.evaluate(() => MTN_UI.Explain.SPECS.map((s) => {
    const ev = MTN_UI.Explain.evaluate(s);
    return { id: s.id, has: !!ev.r, shots: ev.nodes.map((nd, i) => (nd.shot && nd.map ? { i, title: nd.t, v: nd.v } : null)).filter(Boolean) };
  }));
  const shots = {};
  for (const sp of specs) {
    if (!sp.has) { console.warn('no result for', sp.id); continue; }
    shots[sp.id] = [];
    for (const sh of sp.shots) {
      await p.evaluate(([id, i]) => MTN_UI.Explain.brief(id, i), [sp.id, sh.i]);
      await p.waitForTimeout(700);
      const buf = await p.locator('#stage').screenshot({ type: 'png' });
      // grey, scaled JPEG (black-only print, small file)
      const src = await p.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const w = Math.min(1100, img.width), h = Math.round((img.height * w) / img.width);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.filter = 'grayscale(1) contrast(1.15)'; cx.drawImage(img, 0, 0, w, h);
        return cv.toDataURL('image/jpeg', 0.78);
      }, buf.toString('base64'));
      shots[sp.id].push({ title: `Brief mode — ${sh.title}: ${sh.v}`, src });
    }
    await p.evaluate(() => MTN_UI.Explain.endBrief());
  }
  const html = await p.evaluate((sh) => MTN_UI.Explain.printable({
    shots: sh,
    intro: `<p>A senior asks: “How did the computer decide this?” This book answers that for every MtnEye tool. Each chapter has the same parts:</p>
      <ol><li><b>Question</b> — what the tool answers, in one line.</li>
      <li><b>The model</b> — a ModelBuilder-style diagram: inputs (ovals), steps (numbered boxes) and results (double ovals). Each box carries the numbers from a real run on the demo terrain, and every step that throws ground out says how much and why (lines starting with ✗).</li>
      <li><b>Step by step</b> — the same boxes in a table, in plain words.</li>
      <li><b>Pictures</b> — the map in Brief mode for the key steps: everything else is faded so only that step shows.</li>
      <li><b>How to read the result</b>, <b>If you get nothing, or it fails</b> (what you see, why, what to do) and <b>What to say when briefing</b>.</li></ol>
      <p><b>In the app.</b> After any run, press “How was this found? — Model view” in the Geoprocessing pane (or the Model tab next to Map and Scene). Click a box to read about it; press “Brief on map” and step with Next / Prev (or the arrow keys) — the map shows only that step. A failed run says which step stopped it, why, and what to change.</p>`,
  }), shots);
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(html, { waitUntil: 'load' });
  await pdfPage.pdf({ path: out, format: 'A4', printBackground: false, margin: { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-family:Arial;font-size:9pt;color:#000;width:100%;text-align:center"><span class="pageNumber"></span></div>' });
  await browser.close();
  if (errors.length) { console.error('page errors:', errors); process.exit(1); }
  console.log('wrote', out);
})();
