/*
 * MtnEye ui — ModelBuilder. A model is a diagram of geoprocessing tools (yellow boxes) joined by
 * variables: input data (blue ovals), values you can change (light-blue ovals) and derived data
 * (green ovals). Change any value on the diagram, run the model (or one tool), and add any
 * intermediate or final result to the map.
 *
 * Element states follow ArcGIS ModelBuilder: grey = not ready (an input is missing), coloured =
 * ready to run, drop shadow = has been run, red outline = failed.
 */
(function (UI) {
  'use strict';
  const MB = (UI.MB = {});
  const M = UI.M, F = UI.F;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'mtnai.model.v1';
  const CW = 178, RH = 92, X0 = 30, Y0 = 30;
  const SIZE = { tool: [138, 46], var: [146, 50] };

  MB.model = null;      // { template, name, question, nodes }
  MB.rep = null;        // last run report
  MB.sel = null;
  MB.view = { x: 0, y: 0, k: 1 };
  MB.display = {};      // varId -> true (shown on the map)
  MB.running = false;

  // ---------------------------------------------------------------- model helpers
  const nodes = () => MB.model.nodes;
  const node = (id) => nodes().find((n) => n.id === id);
  const isVar = (n) => n.kind !== 'tool';
  const graph = () => { try { return M.modelGraph(MB.model); } catch (e) { return null; } };
  const ctxNow = () => { const S = UI.S; return { own: S.markers.own, threat: S.markers.threat, a: S.markers.a, b: S.markers.b, border: S.border }; };
  const place = (n) => { if (n.x === undefined) { n.x = X0 + n.col * CW; n.y = Y0 + n.row * RH; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ model: MB.model, display: MB.display })); } catch (e) { /* storage off */ } };

  MB.load = (templateId) => {
    const t = M.MODEL_TEMPLATES[templateId];
    const m = t.build(ctxNow());
    MB.model = { template: templateId, name: t.name, question: t.question, nodes: m.nodes };
    MB.model.nodes.forEach(place);
    MB.rep = null; MB.sel = null; MB.display = {};
    MB.model.nodes.forEach((n) => { if (n.display) MB.display[n.id] = true; });
    clearMap();
    MB.fit();
    save();
  };
  const restore = () => {
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && o.model && o.model.nodes) { MB.model = o.model; MB.display = o.display || {}; MB.model.nodes.forEach(place); return true; }
    } catch (e) { /* ignore */ }
    return false;
  };

  /** Variables that feed a tool (explicit parameters and names used in a Raster Calculator expression). */
  const edges = () => {
    const out = [];
    const G = graph();
    if (!G) return out;
    for (const t of nodes().filter((n) => n.kind === 'tool')) {
      for (const v of G.reads(t)) out.push([v, t.id]);
      for (const v of Object.values(t.outputs || {})) out.push([t.id, v]);
    }
    return out;
  };

  /** ArcGIS-style element state. */
  const stateOf = (n) => {
    const r = MB.rep;
    if (n.kind === 'tool') {
      const s = r && r.tools[n.id];
      if (s && s.state === 'failed') return 'failed';
      if (s && (s.state === 'done' || s.state === 'cached')) return 'run';
      return readyTool(n) ? 'ready' : 'notready';
    }
    if (n.kind === 'derived') return r && r.vars[n.id] ? 'run' : (producerReady(n) ? 'ready' : 'notready');
    return hasValue(n) ? 'ready' : 'notready';
  };
  const hasValue = (n) => n.src === 'dem' ? !!UI.S.grid : n.value !== undefined && n.value !== null && n.value !== '' && !(Array.isArray(n.value) && !n.value.length);
  const readyTool = (t) => {
    const def = M.GPT[t.tool];
    if (!def) return false;
    for (const pd of def.params) {
      if (pd.dir === 'out' || pd.optional) continue;
      const vid = t.inputs && t.inputs[pd.k];
      if (vid) { const v = node(vid); if (!v) return false; if (v.kind !== 'derived' && !hasValue(v)) return false; if (v.kind === 'derived' && !producerReady(v)) return false; continue; }
      const val = t.values && pd.k in t.values ? t.values[pd.k] : pd.def;
      if (val === undefined || val === null || val === '') return false;
    }
    return true;
  };
  const producerReady = (v, seen = new Set()) => {
    const t = nodes().find((n) => n.kind === 'tool' && Object.values(n.outputs || {}).includes(v.id));
    if (!t || seen.has(t.id)) return false;
    seen.add(t.id);
    return readyTool(t);
  };

  // ---------------------------------------------------------------- short texts on the diagram
  const valueText = (n) => {
    const v = n.value;
    if (n.src === 'dem') return UI.S.grid ? `${UI.S.grid.w}×${UI.S.grid.h} @ ${UI.S.grid.cs} m` : 'no DEM';
    if (v === undefined || v === null || v === '') return '(not set)';
    if (n.dt === 'point') return F.listRef(v.r, v.c);
    if (n.dt === 'line') return `${v.length} vertices`;
    if (n.dt === 'profile') return (M.MOVEMENT_PROFILES[v] || {}).name ? M.MOVEMENT_PROFILES[v].name.split(' (')[0] : v;
    if (n.dt === 'remap') return M.parseRemap(v).map((r) => `≤${r.hi}°→${r.name || r.v}`).join(' ');
    return String(v);
  };
  const resultText = (n) => {
    const s = MB.rep && MB.rep.vars[n.id];
    if (!s) return '';
    if (s.dt === 'raster') {
      if (s.kind === 'backlink') return 'step-back directions';
      if (s.kind === 'class' && s.classes) return Object.entries(s.counts || {}).map(([k, f]) => `${s.classes[k] || k} ${Math.round(f * 100)}%`).join(' · ');
      if (s.kind === 'count') return `seen: ${Math.round(s.share * 100)}% of map`;
      if (s.min === null) return 'all NoData';
      const fmt = (x) => (Math.abs(x) >= 100 ? Math.round(x) : x.toFixed(x < 10 ? 2 : 1));
      return `${fmt(s.min)}–${fmt(s.max)} ${s.unit || ''}${s.nodata > 0.005 ? ` · NoData ${Math.round(s.nodata * 100)}%` : ''}`;
    }
    if (s.dt === 'points') return `${s.n} point${s.n === 1 ? '' : 's'}${s.dropped && s.dropped.length ? ` (${s.dropped.length} dropped)` : ''}`;
    if (s.dt === 'lines') return s.lines.map((l) => `${l.label} ${l.attrs && l.attrs.timeH != null ? F.time(l.attrs.timeH) : ''}`).join(' · ') + (s.skipped && s.skipped.length ? ` · ${s.skipped.length} unreachable` : '');
    if (s.dt === 'table') return `${s.rows.length} row${s.rows.length === 1 ? '' : 's'}`;
    return '';
  };

  // ---------------------------------------------------------------- diagram
  const wrapT = (s, max) => { const o = []; let l = ''; for (const w of String(s).split(/\s+/)) { if (l && (l + ' ' + w).length > max) { o.push(l); l = w; } else l = l ? l + ' ' + w : w; } if (l) o.push(l); return o; };
  const COL = {
    data: ['#a9c8f5', '#2f5fb8'], value: ['#dbe8fb', '#3b6fe0'], derived: ['#b9e4ac', '#2f8a3b'], tool: ['#ffe08a', '#b88a00'],
    notready: ['#eceef1', '#9aa1ab'], failed: '#d0342c', sel: '#e0662b',
  };
  let POS = null; // print layout override: id -> {x, y}
  const at = (n) => (POS ? POS[n.id] : n);
  const center = (n) => { const [w, h] = n.kind === 'tool' ? SIZE.tool : SIZE.var; const q = at(n); return [q.x + w / 2, q.y + h / 2, w, h]; };
  MB.svg = (opts = {}) => {
    const P = !!opts.print, VERT = !!opts.vertical;
    // vertical (print) layout: the diagram turned so it flows top to bottom and fits a page
    POS = VERT ? Object.fromEntries(nodes().map((n) => [n.id, { x: X0 + ((n.y - Y0) / RH) * 165, y: Y0 + ((n.x - X0) / CW) * 74 }])) : null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes().forEach((n) => { const [, , w, h] = center(n), q = at(n); minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x + w); maxY = Math.max(maxY, q.y + h + (VERT ? 4 : 30)); });
    let s = '';
    // connectors
    for (const [a, b] of edges()) {
      const A = node(a), B = node(b);
      if (!A || !B) continue;
      const [ax, ay, aw] = center(A), [bx, by, bw] = center(B);
      const x1 = ax + aw / 2, x2 = bx - bw / 2;
      const back = x2 < x1 + 10;
      const y1v = ay + 25, y2v = by - 25;
      const d = VERT ? (y2v > y1v + 4 ? `M${ax},${y1v} C${ax},${(y1v + y2v) / 2} ${bx},${(y1v + y2v) / 2} ${bx},${y2v - 3}` : `M${ax + aw / 2},${ay} C${ax + aw / 2 + 60},${ay} ${bx + bw / 2 + 60},${by} ${bx + bw / 2 + 3},${by}`) : back ? `M${ax},${ay + 20} C${ax},${ay + 70} ${bx},${by + 70} ${bx},${by + 22}` : `M${x1},${ay} C${(x1 + x2) / 2},${ay} ${(x1 + x2) / 2},${by} ${x2 - 3},${by}`;
      const isVal = A.kind === 'value';
      s += `<path d="${d}" fill="none" stroke="${P ? '#000' : isVal ? '#7a8aa6' : '#4b5563'}" stroke-width="${isVal ? 1.1 : 1.5}"${isVal ? ' stroke-dasharray="4 3"' : ''} marker-end="url(#mbArr${P ? 'P' : ''})"/>`;
    }
    for (const n0 of nodes()) {
      const n = Object.assign({}, n0, at(n0));
      const st = stateOf(n0), [cx, cy, w, h] = center(n0);
      const shadow = st === 'run' && !P ? ' filter="url(#mbShadow)"' : '';
      let [fill, stroke] = n.kind === 'tool' ? COL.tool : COL[n.kind];
      if (st === 'notready' && !P) [fill, stroke] = COL.notready;
      if (P) { fill = '#fff'; stroke = '#000'; }
      const sw = MB.sel === n.id && !P ? 3 : st === 'failed' ? 2.6 : 1.4;
      const sk = MB.sel === n.id && !P ? COL.sel : st === 'failed' ? COL.failed : stroke;
      s += `<g class="mb-n" data-id="${n.id}"${shadow}>`;
      if (n.kind === 'tool') s += `<rect x="${n.x}" y="${n.y}" width="${w}" height="${h}" rx="9" fill="${fill}" stroke="${sk}" stroke-width="${sw}"/>`;
      else {
        s += `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${sk}" stroke-width="${sw}"/>`;
        if (P && n.kind === 'derived') s += `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2 - 4}" ry="${h / 2 - 4}" fill="none" stroke="#000" stroke-width="0.8"/>`;
        if (P && n.kind === 'value') s += `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="none" stroke="#000" stroke-width="1" stroke-dasharray="3 2"/>`;
      }
      const title = wrapT(n.name, n.kind === 'tool' ? 18 : 19);
      const sub = n.kind === 'value' || n.kind === 'data' ? valueText(n) : '';
      const lines = title.slice(0, 2).map((t) => [t, 'b']).concat(sub ? [[sub.length > 24 ? sub.slice(0, 23) + '…' : sub, 'v']] : []);
      let ty = cy - ((lines.length - 1) * 13) / 2 + 4;
      for (const [t, k] of lines) { s += `<text x="${cx}" y="${ty}" text-anchor="middle" font-size="${(k === 'b' ? 11.5 : 10.5) + (VERT ? 1.5 : 0)}" ${k === 'b' ? 'font-weight="600"' : 'fill-opacity="0.8"'} fill="#111">${esc(t)}</text>`; ty += 13; }
      if (n.P) s += `<text x="${n.x + w - (n.kind === 'tool' ? 8 : 14)}" y="${n.y + 11}" font-size="11" font-weight="700" fill="${P ? '#000' : '#1d4ed8'}">P</text>`;
      if (n.kind === 'derived' && MB.display[n.id] && !P) s += `<text x="${n.x + 10}" y="${n.y + 11}" font-size="10" font-weight="700" fill="#1f6b2c">D</text>`;
      if (n.kind === 'tool' && MB.rep && MB.rep.tools[n.id] && MB.rep.tools[n.id].ms !== undefined && !P) s += `<text x="${n.x + w - 4}" y="${n.y + h - 4}" text-anchor="end" font-size="9" fill="#6b4f00">${MB.rep.tools[n.id].state === 'cached' ? 'cached' : `${MB.rep.tools[n.id].ms} ms`}</text>`;
      if (n.kind === 'tool') { const num = MB.rep ? MB.rep.order.indexOf(n.id) + 1 : 0; if (num) s += `<text x="${n.x + 6}" y="${n.y + 12}" font-size="9.5" fill="#6b4f00">${num}</text>`; }
      const res = n.kind === 'derived' ? resultText(n) : n.kind === 'tool' && MB.rep && MB.rep.tools[n.id] && MB.rep.tools[n.id].state === 'failed' ? MB.rep.tools[n.id].msg : '';
      if (res && !VERT) wrapT(res, 34).slice(0, 2).forEach((t, k) => { s += `<text x="${cx}" y="${n.y + h + 13 + k * 12}" text-anchor="middle" font-size="10" fill="${n.kind === 'tool' ? (P ? '#000' : '#b3261e') : P ? '#000' : '#1f5130'}"${P && n.kind === 'tool' ? ' font-style="italic"' : ''}>${esc(t)}</text>`; });
      s += '</g>';
    }
    POS = null;
    const W = maxX - minX + 60, H = maxY - minY + 50;
    const defs = `<defs><marker id="mbArr${P ? 'P' : ''}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="${P ? '#000' : '#4b5563'}"/></marker>
      <filter id="mbShadow" x="-20%" y="-20%" width="150%" height="160%"><feDropShadow dx="3" dy="3" stdDeviation="1.5" flood-color="#000" flood-opacity="0.35"/></filter></defs>`;
    return { inner: defs + s, box: [minX - 30, minY - 25, W, H] };
  };

  // ---------------------------------------------------------------- view
  MB.visible = false;
  MB.show = (on) => {
    MB.visible = on;
    if (on && MB.briefing) MB.endBrief();
    const el = $('modelView');
    if (!el) return;
    el.hidden = !on;
    if (on) { if (!MB.model && !restore()) MB.load('route'); buildShell(); MB.render(); }
  };
  MB.open = (templateId) => {
    if (templateId) MB.load(templateId); // fresh, with the current own / enemy / A / B points and border
    UI.app.setView('model');
  };
  MB.fit = () => {
    const el = $('mbCanvas');
    if (!el || !MB.model) return;
    const b = MB.svg().box, W = el.clientWidth || 900, H = el.clientHeight || 500;
    // readable first: never below 0.7 — a wide model starts at its inputs (left) and is panned
    const k = Math.max(0.7, Math.min(1.2, W / b[2], H / b[3]));
    MB.view = { k, x: b[2] * k <= W ? (W - b[2] * k) / 2 - b[0] * k : 16 - b[0] * k, y: b[3] * k <= H ? (H - b[3] * k) / 2 - b[1] * k : 16 - b[1] * k };
  };

  const buildShell = () => {
    const el = $('modelView');
    if (el.dataset.built) return;
    el.dataset.built = '1';
    const tpl = Object.entries(M.MODEL_TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join('');
    const cats = {};
    Object.entries(M.GPT).forEach(([k, d]) => (cats[d.cat] = cats[d.cat] || []).push([k, d]));
    el.innerHTML = `<div class="mb-bar">
        <label class="mb-lbl">Model</label><select id="mbTpl">${tpl}</select>
        <button class="btn primary" data-mb="run" title="Run the whole model (F5)">▶ Run</button>
        <button class="btn" data-mb="validate" title="Check every element is ready">Validate</button>
        <span class="mb-sep"></span>
        <select id="mbAddTool"><option value="">Add tool…</option>${Object.entries(cats).map(([c, l]) => `<optgroup label="${esc(c)}">${l.map(([k, d]) => `<option value="${k}">${esc(d.name)}</option>`).join('')}</optgroup>`).join('')}</select>
        <select id="mbAddVar"><option value="">Add variable…</option><option value="number">Number</option><option value="string">Text</option><option value="point">Point</option><option value="line">Line (border)</option><option value="profile">Movement class</option></select>
        <button class="btn" data-mb="layout" title="Auto layout">Auto layout</button><button class="btn" data-mb="fit" title="Fit to window">Fit</button>
        <span class="mb-sep"></span>
        <button class="btn" data-mb="reset" title="Reload this model with the current own / enemy / A / B points and border">Reset</button>
        <button class="btn" data-mb="export">Export</button><label class="btn file">Import<input type="file" id="mbImport" accept=".json"></label>
        <button class="btn" data-mb="brief" title="Step through the model on the map, one tool at a time">▶ Brief on map</button>
        <button class="btn" data-mb="report">Report</button>
        <span class="mb-status" id="mbStatus"></span></div>
      <div class="mb-q" id="mbQ"></div>
      <div class="mb-body"><div id="mbCanvas" class="mb-canvas"><svg id="mbSvg"><g id="mbG"></g></svg>
        <div class="mb-legend"><span class="k data">Input data</span><span class="k value">Value (editable)</span><span class="k tool">Tool</span><span class="k derived">Derived data</span><span class="k nr">Not ready</span><span class="k run">Has run (shadow)</span><span>P = model parameter · D = added to map</span></div></div>
        <div class="mb-side" id="mbSide"></div></div>`;
    $('mbTpl').onchange = (e) => { MB.load(e.target.value); MB.render(); };
    el.querySelector('[data-mb=run]').onclick = () => MB.run();
    el.querySelector('[data-mb=validate]').onclick = () => validate();
    el.querySelector('[data-mb=layout]').onclick = () => { autoLayout(); MB.fit(); MB.render(); save(); };
    el.querySelector('[data-mb=fit]').onclick = () => { MB.fit(); MB.render(); };
    el.querySelector('[data-mb=reset]').onclick = () => { MB.load(MB.model.template); MB.render(); };
    el.querySelector('[data-mb=export]').onclick = () => exportModel();
    el.querySelector('[data-mb=report]').onclick = () => MB.print();
    el.querySelector('[data-mb=brief]').onclick = () => MB.brief();
    $('mbImport').onchange = (e) => importModel(e.target.files[0]);
    $('mbAddTool').onchange = (e) => { if (e.target.value) addTool(e.target.value); e.target.value = ''; };
    $('mbAddVar').onchange = (e) => { if (e.target.value) addVar(e.target.value); e.target.value = ''; };
    // pan / zoom / drag
    const svg = $('mbSvg');
    let drag = null;
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0015), k = Math.max(0.25, Math.min(2.5, MB.view.k * f));
      MB.view.x = mx - ((mx - MB.view.x) * k) / MB.view.k; MB.view.y = my - ((my - MB.view.y) * k) / MB.view.k; MB.view.k = k;
      applyView();
    }, { passive: false });
    svg.addEventListener('mousedown', (e) => {
      const g = e.target.closest('.mb-n');
      if (e.button !== 0) return;
      if (g) { const n = node(g.dataset.id); drag = { n, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, moved: false }; }
      else drag = { pan: true, sx: e.clientX, sy: e.clientY, x: MB.view.x, y: MB.view.y };
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (drag.pan) { MB.view.x = drag.x + dx; MB.view.y = drag.y + dy; applyView(); return; }
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) { drag.n.x = drag.x + dx / MB.view.k; drag.n.y = drag.y + dy / MB.view.k; drawDiagram(); }
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      if (drag.n && !drag.moved) { MB.sel = drag.n.id; MB.render(); } else if (drag.n) save();
      else if (!drag.moved && Math.abs(MB.view.x - drag.x) + Math.abs(MB.view.y - drag.y) < 3) { MB.sel = null; MB.render(); }
      drag = null;
    });
    svg.addEventListener('dblclick', (e) => {
      const g = e.target.closest('.mb-n');
      if (!g) return;
      MB.sel = g.dataset.id; MB.render();
      const f = $('mbSide').querySelector('input, textarea, select');
      if (f) f.focus();
    });
    svg.addEventListener('contextmenu', (e) => {
      const g = e.target.closest('.mb-n');
      if (!g) return;
      e.preventDefault();
      MB.sel = g.dataset.id; MB.render();
      ctxMenu(node(g.dataset.id), e.clientX, e.clientY);
    });
    document.addEventListener('keydown', (e) => {
      if (!MB.visible || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'F5') { e.preventDefault(); MB.run(); }
      if (e.key === 'Delete' && MB.sel) { delNode(MB.sel); }
    });
    new ResizeObserver(() => { if (MB.visible) applyView(); }).observe($('mbCanvas'));
  };
  const applyView = () => { const g = $('mbG'); if (g) g.setAttribute('transform', `translate(${MB.view.x},${MB.view.y}) scale(${MB.view.k})`); };
  const drawDiagram = () => { const g = $('mbG'); if (!g) return; g.innerHTML = MB.svg().inner; applyView(); };

  MB.render = () => {
    if (!MB.visible || !MB.model) return;
    $('mbTpl').value = MB.model.template in M.MODEL_TEMPLATES ? MB.model.template : '';
    $('mbQ').innerHTML = `<b>${esc(MB.model.name)}</b> — ${esc(MB.model.question || '')}`;
    drawDiagram();
    renderSide();
    status();
  };
  const status = (txt) => {
    const el = $('mbStatus');
    if (!el) return;
    if (txt) { el.textContent = txt; return; }
    const r = MB.rep;
    if (!r) { el.textContent = 'Not run yet'; el.className = 'mb-status'; return; }
    const t = Object.values(r.tools);
    el.textContent = r.failed ? 'Run failed — see the red tool' : `Ran ${t.filter((x) => x.state === 'done').length} tool(s), ${t.filter((x) => x.state === 'cached').length} unchanged`;
    el.className = 'mb-status ' + (r.failed ? 'err' : 'ok');
  };

  // ---------------------------------------------------------------- side panel
  const COMPAT = { raster: ['raster'], points: ['points', 'point'], lines: ['lines'], line: ['line', 'lines'], point: ['point'], number: ['number'], string: ['string'], profile: ['profile'], remap: ['remap', 'string'], expr: ['string', 'expr'] };
  const editor = (dt, val, attrs) => {
    if (dt === 'profile') return `<select ${attrs}>${Object.entries(M.MOVEMENT_PROFILES).map(([k, p]) => `<option value="${k}"${k === val ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
    if (dt === 'remap' || dt === 'expr') return `<textarea rows="${dt === 'expr' ? 4 : 3}" spellcheck="false" ${attrs}>${esc(val)}</textarea>`;
    if (dt === 'number') return `<input type="number" step="any" value="${esc(val)}" ${attrs}>`;
    return `<input type="text" value="${esc(val)}" ${attrs}>`;
  };
  const parseVal = (dt, s) => (dt === 'number' ? (s === '' ? null : +s) : s);
  const pointEditor = (n) => `<div class="mb-pt"><code>${n.value ? esc(F.listRef(n.value.r, n.value.c)) : '(not set)'}</code>
      <button class="btn" data-pick>Pick on map</button>${['own', 'threat', 'a', 'b', 'target'].filter((k) => UI.S.markers[k]).map((k) => `<button class="btn" data-use="${k}">${{ own: 'Own', threat: 'Enemy', a: 'A', b: 'B', target: 'Target' }[k]}</button>`).join('')}</div>`;

  const renderSide = () => {
    const el = $('mbSide');
    const n = MB.sel && node(MB.sel);
    if (!n) { el.innerHTML = modelPanel(); bindModelPanel(el); return; }
    if (n.kind === 'tool') { el.innerHTML = toolPanel(n); bindToolPanel(el, n); return; }
    el.innerHTML = varPanel(n); bindVarPanel(el, n);
  };

  const steps = () => {
    const G = graph();
    if (!G) return [];
    return G.tools.map((t) => {
      const ins = G.reads(t).map((v) => node(v)).filter(Boolean).map((v) => v.name);
      const outs = Object.values(t.outputs || {}).map((v) => node(v)).filter(Boolean).map((v) => v.name);
      return { t, ins, outs };
    });
  };
  const modelPanel = () => {
    const r = MB.rep;
    const params = nodes().filter((n) => n.P);
    return `<h3>${esc(MB.model.name)}</h3><p class="mb-help">${esc(MB.model.question || '')}</p>
      <h4>Model parameters</h4><p class="mb-help">The values you are most likely to change. Click one (or any oval) to edit it, then Run.</p>
      <div class="mb-params">${params.map((n) => `<div class="mb-prow" data-go="${n.id}"><span>${esc(n.name)}</span><b>${esc(valueText(n))}</b></div>`).join('')}</div>
      <h4>Processing order</h4><ol class="mb-steps">${steps().map(({ t, ins, outs }) => {
        const s = r && r.tools[t.id];
        return `<li data-go="${t.id}"><b>${esc(t.name)}</b> <span class="mb-help">(${esc(ins.join(', '))} → ${esc(outs.join(', '))})</span>${s ? `<div class="mb-msg ${s.state}">${s.state === 'failed' ? esc(s.msg) : s.state === 'notrun' ? 'not run' : s.state === 'cached' ? 'unchanged (cached)' : `done in ${s.ms} ms`}</div>` : ''}</li>`;
      }).join('')}</ol>
      <p class="mb-help">Tip: right-click an element for Run, Add to Display, Model Parameter, Rename and Delete. Drag to move; wheel to zoom; drag the background to pan.</p>`;
  };
  const bindModelPanel = (el) => el.querySelectorAll('[data-go]').forEach((x) => (x.onclick = () => { MB.sel = x.dataset.go; MB.render(); }));

  const toolPanel = (t) => {
    const def = M.GPT[t.tool];
    const s = MB.rep && MB.rep.tools[t.id];
    const vars = nodes().filter(isVar);
    let h = `<div class="mb-kind tool">Tool</div><h3><input class="mb-name" data-name value="${esc(t.name)}"></h3><p class="mb-arc">${esc(def.arc)}</p><p class="mb-help">${esc(def.help)}</p>`;
    if (s) h += `<div class="mb-msg ${s.state}">${s.state === 'failed' ? `<b>Failed:</b> ${esc(s.msg)}` : s.state === 'notrun' ? 'Not run — an earlier tool failed.' : s.state === 'cached' ? 'Has been run (inputs unchanged).' : `Has been run — ${s.ms} ms.`}</div>`;
    h += '<h4>Parameters</h4>';
    for (const pd of def.params) {
      if (pd.dir === 'out') {
        const vid = t.outputs && t.outputs[pd.k];
        const v = vid && node(vid);
        h += `<div class="mb-par out"><label>${esc(pd.label)}</label>${v ? `<div class="mb-link" data-go="${v.id}">→ ${esc(v.name)}</div>` : `<button class="btn" data-mkout="${pd.k}">Create output</button>`}</div>`;
        continue;
      }
      const vid = t.inputs && t.inputs[pd.k];
      const ok = vars.filter((v) => (COMPAT[pd.dt] || [pd.dt]).includes(v.dt));
      const lit = t.values && pd.k in t.values ? t.values[pd.k] : pd.def;
      const literalOK = !['raster', 'points', 'lines', 'line', 'point'].includes(pd.dt);
      h += `<div class="mb-par"><label>${esc(pd.label)}${pd.optional ? ' <i>(optional)</i>' : ''}</label>
        <select data-src="${pd.k}">${literalOK ? `<option value="">${pd.dt === 'expr' ? 'Expression (below)' : 'Value (below)'}</option>` : '<option value="">— not set —</option>'}${ok.map((v) => `<option value="${v.id}"${v.id === vid ? ' selected' : ''}>${v.kind === 'derived' ? '◉' : '○'} ${esc(v.name)}</option>`).join('')}</select>
        ${!vid && literalOK ? editor(pd.dt, lit === undefined ? '' : lit, `data-lit="${pd.k}"`) + `<button class="btn mb-expose" data-expose="${pd.k}" title="Create a variable (oval) for this value so it can be edited on the model">Expose as variable</button>` : ''}</div>`;
      if (pd.dt === 'expr' && !vid) {
        const ras = vars.filter((v) => v.dt === 'raster'), vals = vars.filter((v) => v.kind === 'value' && v.dt === 'number');
        h += `<div class="mb-ins">Insert: ${ras.map((v) => `<button class="chip" data-ins='"${esc(v.name)}"'>"${esc(v.name)}"</button>`).join('')}${vals.map((v) => `<button class="chip" data-ins="%${esc(v.name)}%">%${esc(v.name)}%</button>`).join('')}
          ${['Con( , , )', 'NoData', '==', '>', '&', '|'].map((x) => `<button class="chip" data-ins="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
      }
    }
    h += `<div class="mb-actions"><button class="btn primary" data-act="run">▶ Run this tool</button><button class="btn" data-act="brief">Show this step on the map</button><button class="btn" data-act="del">Delete</button></div>`;
    return h;
  };
  const bindToolPanel = (el, t) => {
    const def = M.GPT[t.tool];
    el.querySelector('[data-name]').onchange = (e) => { t.name = e.target.value; changed(); };
    el.querySelectorAll('[data-go]').forEach((x) => (x.onclick = () => { MB.sel = x.dataset.go; MB.render(); }));
    el.querySelectorAll('[data-src]').forEach((s) => (s.onchange = () => {
      t.inputs = t.inputs || {};
      if (s.value) t.inputs[s.dataset.src] = s.value; else delete t.inputs[s.dataset.src];
      changed(); MB.render();
    }));
    el.querySelectorAll('[data-lit]').forEach((f) => (f.onchange = () => {
      const pd = def.params.find((x) => x.k === f.dataset.lit);
      t.values = t.values || {};
      t.values[pd.k] = parseVal(pd.dt, f.value);
      changed(); MB.render();
    }));
    el.querySelectorAll('[data-ins]').forEach((b) => (b.onclick = () => {
      const ta = el.querySelector('[data-lit=expr]');
      if (!ta) return;
      const p0 = ta.selectionStart, p1 = ta.selectionEnd;
      ta.value = ta.value.slice(0, p0) + b.dataset.ins + ta.value.slice(p1);
      ta.dispatchEvent(new Event('change'));
    }));
    el.querySelectorAll('[data-expose]').forEach((b) => (b.onclick = () => {
      const pd = def.params.find((x) => x.k === b.dataset.expose);
      const id = uid('v');
      const val = t.values && pd.k in t.values ? t.values[pd.k] : pd.def;
      nodes().push({ id, kind: 'value', name: pd.label.replace(/\s*\(.*?\)\s*$/, '').replace(/^Input |^Output /, ''), dt: pd.dt === 'expr' ? 'string' : pd.dt, value: val, x: t.x - 20, y: t.y - 80 });
      t.inputs = t.inputs || {}; t.inputs[pd.k] = id;
      if (t.values) delete t.values[pd.k];
      MB.sel = id; changed(); MB.render();
    }));
    el.querySelectorAll('[data-mkout]').forEach((b) => (b.onclick = () => {
      const pd = def.params.find((x) => x.k === b.dataset.mkout);
      const id = uid('d');
      nodes().push({ id, kind: 'derived', name: `${t.name} ${pd.label.replace(/^Output /, '')}`, dt: pd.dt, x: t.x + CW, y: t.y });
      t.outputs = t.outputs || {}; t.outputs[pd.k] = id;
      changed(); MB.render();
    }));
    el.querySelector('[data-act=run]').onclick = () => MB.run(t.id);
    el.querySelector('[data-act=brief]').onclick = () => MB.brief(t.id);
    el.querySelector('[data-act=del]').onclick = () => delNode(t.id);
  };

  const varPanel = (n) => {
    const kind = { data: 'Input data', value: 'Value variable', derived: 'Derived data' }[n.kind];
    let h = `<div class="mb-kind ${n.kind}">${kind}</div><h3><input class="mb-name" data-name value="${esc(n.name)}"></h3>`;
    if (n.note) h += `<p class="mb-help">${esc(n.note)}</p>`;
    const users = nodes().filter((t) => t.kind === 'tool' && (graph() ? graph().reads(t) : []).includes(n.id));
    if (n.kind === 'value') {
      h += '<h4>Value</h4>';
      if (n.dt === 'point') h += pointEditor(n);
      else if (n.dt === 'line') h += `<div class="mb-pt"><code>${n.value ? `${n.value.length} vertices` : '(not set)'}</code><button class="btn" data-useborder ${UI.S.border ? '' : 'disabled'}>Use the border line</button>${UI.S.tracks.length ? '<button class="btn" data-usetrack>Use the last drawn track</button>' : ''}</div>`;
      else h += editor(n.dt, n.value === undefined || n.value === null ? '' : n.value, 'data-val');
      if (n.dt === 'remap') h += '<p class="mb-help">One range per entry: <code>low high : new value name</code>, separated by “;”. Write NoData as the new value to block cells.</p>';
      h += `<label class="mb-chk"><input type="checkbox" data-p ${n.P ? 'checked' : ''}> Model parameter (P)</label>`;
    } else if (n.kind === 'data') {
      h += `<p>${esc(valueText(n))}</p><p class="mb-help">${n.src === 'dem' ? 'The elevation model loaded in the map.' : ''}</p>`;
    } else {
      const s = MB.rep && MB.rep.vars[n.id];
      const prod = nodes().find((t) => t.kind === 'tool' && Object.values(t.outputs || {}).includes(n.id));
      h += `<p class="mb-help">Made by <a href="#" data-go="${prod ? prod.id : ''}">${esc(prod ? prod.name : '?')}</a>.</p>`;
      if (!s) h += '<p class="mb-help">No value yet — run the model.</p>';
      else h += summaryHTML(n, s);
      if (s && s.dt !== 'table' && s.kind !== 'backlink') h += `<label class="mb-chk"><input type="checkbox" data-disp ${MB.display[n.id] ? 'checked' : ''}> Add to display (show on the map)</label>`;
      if (s && s.dt !== 'table' && s.kind !== 'backlink') h += '<button class="btn" data-showmap>Show on map ▸</button>';
    }
    if (users.length) h += `<h4>Used by</h4>${users.map((t) => `<div class="mb-link" data-go="${t.id}">→ ${esc(t.name)}</div>`).join('')}`;
    h += `<div class="mb-actions"><button class="btn" data-act="del"${n.src === 'dem' ? ' disabled' : ''}>Delete</button></div>`;
    return h;
  };
  const summaryHTML = (n, s) => {
    if (s.dt === 'raster') {
      if (s.kind === 'backlink') return '<p>For every reached cell: which neighbour to step back to on the least-time way to the source. Cost Path follows it.</p>';
      let h = `<table class="mb-tbl"><tr><td>Minimum</td><td>${s.min === null ? '—' : s.min.toFixed(2)} ${esc(s.unit)}</td></tr><tr><td>Maximum</td><td>${s.max === null ? '—' : s.max.toFixed(2)} ${esc(s.unit)}</td></tr><tr><td>Mean</td><td>${s.mean === null ? '—' : s.mean.toFixed(2)}</td></tr><tr><td>NoData</td><td>${Math.round(s.nodata * 100)}% of cells</td></tr></table>`;
      if (s.counts) h += `<table class="mb-tbl"><tr><th>Class</th><th>Share</th></tr>${Object.entries(s.counts).map(([k, f]) => `<tr><td>${esc((s.classes || {})[k] || k)}</td><td>${(f * 100).toFixed(1)}%</td></tr>`).join('')}</table>`;
      return h;
    }
    if (s.dt === 'points') return `<table class="mb-tbl"><tr><th>Point</th><th>Grid ref</th></tr>${s.pts.map((q) => `<tr><td>${esc(q.label)}</td><td>${esc(F.listRef(q.r, q.c))}${q.movedM ? ` <i>(moved ${q.movedM} m)</i>` : ''}</td></tr>`).join('')}</table>${s.dropped && s.dropped.length ? `<p class="mb-help">Dropped (no valid cell near): ${esc(s.dropped.join(', '))}</p>` : ''}${s.coverShare !== undefined ? `<p>Together they see <b>${Math.round(s.coverShare * 100)}%</b> of the demand.</p>` : ''}`;
    if (s.dt === 'lines') return `<table class="mb-tbl"><tr><th>Path</th><th>From</th><th>Time</th></tr>${s.lines.map((l) => `<tr><td>${esc(l.label)}</td><td>${esc(l.from || '')}</td><td>${l.attrs && l.attrs.timeH != null ? F.time(l.attrs.timeH) : ''}</td></tr>`).join('')}</table>${s.skipped && s.skipped.length ? `<p class="mb-help">Not reached: ${esc(s.skipped.join('; '))}</p>` : ''}`;
    if (s.dt === 'table') return `<table class="mb-tbl">${'<tr>' + s.cols.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr>'}${s.rows.map((r) => '<tr>' + s.cols.map((c) => `<td>${esc(r[c])}</td>`).join('') + '</tr>').join('')}</table>`;
    return '';
  };
  const bindVarPanel = (el, n) => {
    el.querySelector('[data-name]').onchange = (e) => { renameVar(n, e.target.value); };
    el.querySelectorAll('[data-go]').forEach((x) => (x.onclick = (e) => { e.preventDefault(); if (x.dataset.go) { MB.sel = x.dataset.go; MB.render(); } }));
    const f = el.querySelector('[data-val]');
    if (f) f.onchange = () => { n.value = parseVal(n.dt, f.value); changed(); MB.render(); };
    const p = el.querySelector('[data-p]');
    if (p) p.onchange = () => { n.P = p.checked; changed(); MB.render(); };
    el.querySelectorAll('[data-use]').forEach((b) => (b.onclick = () => { const q = UI.S.markers[b.dataset.use]; n.value = { r: Math.round(q.r), c: Math.round(q.c), label: n.value && n.value.label || n.name }; changed(); MB.render(); }));
    const pk = el.querySelector('[data-pick]');
    if (pk) pk.onclick = () => {
      UI.app.setView('2d');
      UI.app.pickPoint(n.name, (cell) => { n.value = { r: Math.round(cell.r), c: Math.round(cell.c), label: n.value && n.value.label || n.name }; changed(); UI.app.setView('model'); });
    };
    const ub = el.querySelector('[data-useborder]');
    if (ub) ub.onclick = () => { n.value = UI.S.border.map((q) => q.slice()); changed(); MB.render(); };
    const ut = el.querySelector('[data-usetrack]');
    if (ut) ut.onclick = () => { n.value = UI.S.tracks[UI.S.tracks.length - 1].map((q) => q.slice()); changed(); MB.render(); };
    const d = el.querySelector('[data-disp]');
    if (d) d.onchange = async () => { MB.display[n.id] = d.checked; if (!d.checked) delete MB.display[n.id]; save(); await syncMap(); MB.render(); };
    const sm = el.querySelector('[data-showmap]');
    if (sm) sm.onclick = async () => { MB.display[n.id] = true; save(); await syncMap(n.id); UI.app.setView('2d'); zoomTo(n.id); };
    el.querySelector('[data-act=del]').onclick = () => delNode(n.id);
  };

  // ---------------------------------------------------------------- editing
  let uidN = 0;
  const uid = (p) => { let id; do { id = `${p}${++uidN}`; } while (node(id)); return id; };
  const changed = () => { MB.rep = MB.rep ? Object.assign({}, MB.rep, { stale: true }) : null; save(); };
  const renameVar = (n, name) => {
    const old = n.name;
    if (!name || name === old) return;
    if (nodes().some((x) => x !== n && isVar(x) && x.name === name)) { alert('Another variable already has that name.'); MB.render(); return; }
    n.name = name;
    // keep Raster Calculator expressions pointing at the renamed variable
    nodes().filter((t) => t.tool === 'rasterCalc' && t.values && t.values.expr).forEach((t) => {
      t.values.expr = t.values.expr.split(`"${old}"`).join(`"${name}"`).split(`%${old}%`).join(`%${name}%`);
    });
    changed(); MB.render();
  };
  const addTool = (tool) => {
    const def = M.GPT[tool];
    const el = $('mbCanvas');
    const x = (el.clientWidth / 2 - MB.view.x) / MB.view.k, y = (el.clientHeight / 2 - MB.view.y) / MB.view.k;
    const id = uid('t');
    const t = { id, kind: 'tool', tool, name: def.name, x, y, inputs: {}, values: {}, outputs: {} };
    def.params.filter((pd) => pd.dir === 'out' && !pd.optional).forEach((pd, k) => {
      const vid = uid('d');
      let nm = `${def.name} ${pd.label.replace(/^Output /, '')}`;
      while (nodes().some((v) => v.name === nm)) nm += '+';
      nodes().push({ id: vid, kind: 'derived', name: nm, dt: pd.dt, x: x + CW, y: y + k * 70 });
      t.outputs[pd.k] = vid;
    });
    nodes().push(t);
    MB.sel = id; changed(); MB.render();
  };
  const addVar = (dt) => {
    const el = $('mbCanvas');
    const id = uid('v');
    let name = { number: 'Number', string: 'Text', point: 'Point', line: 'Line', profile: 'Movement class' }[dt];
    while (nodes().some((v) => v.name === name)) name += '+';
    nodes().push({ id, kind: 'value', name, dt, value: dt === 'number' ? 0 : dt === 'profile' ? 'foot' : dt === 'line' ? UI.S.border : null, x: (40 - MB.view.x) / MB.view.k, y: (el.clientHeight / 2 - MB.view.y) / MB.view.k });
    MB.sel = id; changed(); MB.render();
  };
  const delNode = (id) => {
    const n = node(id);
    if (!n || n.src === 'dem') return;
    MB.model.nodes = nodes().filter((x) => x.id !== id);
    nodes().filter((t) => t.kind === 'tool').forEach((t) => {
      for (const k of Object.keys(t.inputs || {})) if (t.inputs[k] === id) delete t.inputs[k];
      for (const k of Object.keys(t.outputs || {})) if (t.outputs[k] === id) delete t.outputs[k];
    });
    if (n.kind === 'tool') Object.values(n.outputs || {}).forEach((v) => { MB.model.nodes = nodes().filter((x) => x.id !== v); delete MB.display[v]; });
    delete MB.display[id];
    MB.sel = null; changed(); syncMap(); MB.render();
  };
  const ctxMenu = (n, x, y) => {
    const items = [];
    if (n.kind === 'tool') items.push(['▶ Run', () => MB.run(n.id)], ['Brief on map from here', () => MB.brief(n.id)]);
    if (n.kind === 'derived') items.push([MB.display[n.id] ? 'Remove from display' : 'Add to display', async () => { if (MB.display[n.id]) delete MB.display[n.id]; else MB.display[n.id] = true; save(); await syncMap(); MB.render(); }]);
    if (n.kind === 'value') items.push([n.P ? 'Clear model parameter' : 'Model parameter', () => { n.P = !n.P; changed(); MB.render(); }]);
    items.push(['Rename', () => { const s = prompt('New name', n.name); if (s) { if (isVar(n)) renameVar(n, s); else { n.name = s; changed(); MB.render(); } } }]);
    if (n.src !== 'dem') items.push(['Delete', () => delNode(n.id)]);
    let m = $('mbMenu');
    if (!m) { m = document.createElement('div'); m.id = 'mbMenu'; m.className = 'mb-menu'; document.body.appendChild(m); }
    m.innerHTML = items.map(([t], k) => `<button data-k="${k}">${esc(t)}</button>`).join('');
    m.style.left = `${x}px`; m.style.top = `${y}px`; m.hidden = false;
    m.querySelectorAll('button').forEach((b) => (b.onclick = () => { m.hidden = true; items[+b.dataset.k][1](); }));
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.hidden = true; document.removeEventListener('mousedown', off); } }), 0);
  };
  /** Left-to-right layout by dependency depth (variables sit just before the tool that uses them). */
  const autoLayout = () => {
    const G = graph();
    if (!G) return;
    const depth = {};
    G.tools.forEach((t) => { let d = 0; for (const v of G.reads(t)) { const p = G.producer[v]; if (p) d = Math.max(d, depth[p] + 1); } depth[t.id] = d; });
    const colOf = {};
    G.tools.forEach((t) => { colOf[t.id] = 1 + depth[t.id] * 2; Object.values(t.outputs || {}).forEach((v) => (colOf[v] = colOf[t.id] + 1)); });
    nodes().filter(isVar).forEach((v) => { if (colOf[v.id] === undefined) { const us = G.tools.filter((t) => G.reads(t).includes(v.id)); colOf[v.id] = us.length ? Math.max(0, Math.min(...us.map((t) => colOf[t.id])) - 1) : 0; } });
    const rows = {};
    const order = nodes().slice().sort((a, b) => (a.y || 0) - (b.y || 0));
    order.forEach((n) => { const c = colOf[n.id] || 0; rows[c] = (rows[c] || 0) + 1; n.x = X0 + c * CW * 0.92; n.y = Y0 + (rows[c] - 1) * RH; });
  };
  const validate = () => {
    const bad = nodes().filter((n) => n.kind === 'tool' && !readyTool(n));
    status(bad.length ? `Not ready: ${bad.map((t) => t.name).join(', ')} — select it to see which input is missing.` : 'Valid — every tool is ready to run.');
    MB.render(); status(bad.length ? `Not ready: ${bad.map((t) => t.name).join(', ')}` : 'Valid — every tool is ready to run.');
  };

  // ---------------------------------------------------------------- run
  MB.run = async (upTo) => {
    if (MB.running) return;
    if (!UI.S.grid) { status('Load a DEM first.'); return; }
    MB.running = true;
    status(upTo ? `Running ${node(upTo).name}…` : 'Running model…');
    try {
      MB.rep = await UI.app.engine.call('modelRun', { model: { nodes: nodes().map((n) => Object.assign({}, n)) }, upTo }, (p, m) => status(`Running… ${Math.round(p * 100)}% ${m || ''}`));
      if (upTo && MB.repAll) MB.rep = merge(MB.repAll, MB.rep);
      MB.repAll = MB.rep;
    } catch (e) { status(e.message); MB.running = false; return; }
    MB.running = false;
    await syncMap();
    MB.render();
  };
  const merge = (a, b) => ({ tools: Object.assign({}, a.tools, b.tools), vars: Object.assign({}, a.vars, b.vars), order: b.order, failed: b.failed });

  // ---------------------------------------------------------------- map display
  MB.layers = [];   // vector layers shown: { id, name, dt, pts | lines }
  MB.rasterId = null;
  const clearMap = () => {
    MB.layers = []; MB.rasterId = null;
    const o = UI.S.overlays && UI.S.overlays.model;
    if (o) { o.data = null; o.rgba = null; o.visible = false; }
  };
  const syncMap = async (prefer) => {
    const S = UI.S;
    if (!MB.rep) return;
    MB.layers = [];
    let ras = null;
    for (const id of Object.keys(MB.display)) {
      const n = node(id), s = MB.rep.vars[id];
      if (!n || !s) continue;
      if (s.dt === 'points') MB.layers.push({ id, name: n.name, dt: 'points', pts: s.pts });
      else if (s.dt === 'lines') MB.layers.push({ id, name: n.name, dt: 'lines', lines: s.lines });
      else if (s.dt === 'raster' && s.kind !== 'backlink') ras = prefer && MB.display[prefer] && node(prefer) && MB.rep.vars[prefer] && MB.rep.vars[prefer].dt === 'raster' ? prefer : ras || id;
    }
    if (MB.briefing && MB.briefing.inputs) MB.layers.push(...MB.briefing.inputs);
    const o = S.overlays.model;
    if (ras) {
      const r = await UI.app.engine.call('modelRaster', { id: ras });
      MB.rasterId = ras;
      o.data = r.a; o.info = Object.assign({}, r, { a: null, name: node(ras).name }); o.rgba = null; o.visible = true; o.name = `Model — ${node(ras).name}`;
      o.info.html = legendFor(r, MB.rep.vars[ras]);
    } else { o.data = null; o.rgba = null; o.visible = false; MB.rasterId = null; }
    UI.app.refresh({ base: true });
  };
  /** Show exactly these results on the map (raster: the one to draw). */
  MB.showOnly = async (ids, raster) => { MB.display = Object.fromEntries(ids.map((i) => [i, true])); await syncMap(raster); };
  MB.zoomTo = (id) => zoomTo(id);
  const zoomTo = (id) => {
    const L = MB.layers.find((l) => l.id === id);
    if (!L) { UI.app.map.fit(); return; }
    const P = L.dt === 'points' ? L.pts.map((q) => [q.c, q.r]) : [].concat(...L.lines.map((l) => l.line));
    if (!P.length) return;
    const cs = P.map((p) => p[0]), rs = P.map((p) => p[1]);
    const c0 = Math.min(...cs) - 30, c1 = Math.max(...cs) + 30, r0 = Math.min(...rs) - 30, r1 = Math.max(...rs) + 30;
    const map = UI.app.map;
    map.centerOn((c0 + c1) / 2, (r0 + r1) / 2, Math.max(0.3, Math.min(5, map.W / (c1 - c0), map.H / (r1 - r0)) * 0.9));
  };
  const stretch = (t) => { // light yellow -> orange -> dark purple
    const s = [[255, 247, 188], [254, 196, 79], [236, 112, 20], [153, 52, 4], [76, 20, 80]];
    const x = Math.max(0, Math.min(0.9999, t)) * (s.length - 1), k = Math.floor(x), f = x - k;
    return s[k].map((v, j) => Math.round(v + (s[k + 1][j] - v) * f));
  };
  const CLASS_PAL = { 0: [46, 160, 67], 1: [240, 190, 30], 2: [210, 50, 40], 3: [70, 120, 220], 4: [150, 80, 200], 5: [30, 170, 170] };
  MB.rgba = (o) => {
    const a = o.data, info = o.info || {}, out = new Uint8ClampedArray(a.length * 4);
    if (info.kind === 'class') {
      const keys = Object.keys(info.classes || {}).map(Number);
      const two = keys.length === 2 && keys.includes(0) && keys.includes(1);
      for (let i = 0; i < a.length; i++) {
        const v = a[i];
        if (v !== v) continue;
        const c = two ? (v ? [46, 160, 67] : [210, 50, 40]) : CLASS_PAL[v] || CLASS_PAL[((v % 6) + 6) % 6] || [120, 120, 120];
        out.set([c[0], c[1], c[2], 150], i * 4);
      }
      return out;
    }
    if (info.kind === 'count') { for (let i = 0; i < a.length; i++) if (a[i] > 0) out.set([40, 110, 230, Math.min(200, 90 + 40 * a[i])], i * 4); return out; }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    const span = hi - lo || 1;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (v !== v) { out.set([60, 60, 60, 90], i * 4); continue; } const c = stretch((v - lo) / span); out.set([c[0], c[1], c[2], 165], i * 4); }
    return out;
  };
  const legendFor = (r, s) => {
    if (r.kind === 'class') {
      const keys = Object.keys(r.classes || {});
      const two = keys.length === 2 && keys.includes('0') && keys.includes('1');
      return `<div class="lg">${keys.map((k) => { const c = two ? (+k ? [46, 160, 67] : [210, 50, 40]) : CLASS_PAL[k] || [120, 120, 120]; return `<div><span class="lg-poly" style="background:rgba(${c},.6)"></span><span>${esc(r.classes[k])}</span></div>`; }).join('')}</div>`;
    }
    if (r.kind === 'count') return '<div class="lg"><div><span class="lg-poly" style="background:rgba(40,110,230,.6)"></span><span>Seen (darker = by more observers)</span></div></div>';
    return `<div class="mb-ramp"></div><div class="mb-ramp-l"><span>${s && s.min !== null ? s.min.toFixed(2) : ''} ${esc(r.unit || '')}</span><span>${s && s.max !== null ? s.max.toFixed(2) : ''}</span></div>${s && s.nodata > 0.005 ? '<div class="lg"><div><span class="lg-poly" style="background:rgba(60,60,60,.4)"></span><span>NoData (blocked)</span></div></div>' : ''}`;
  };
  /** Contents pane entries for model results. */
  MB.tocLayers = () => MB.layers.map((L) => ({
    id: 'mb:' + L.id, name: `Model — ${L.name}`, count: L.dt === 'points' ? L.pts.length : L.lines.length,
    legend: `<div class="lg"><div><span class="lg-line" style="border-top:3px solid ${L.dt === 'lines' ? '#d0342c' : '#1d4ed8'}"></span><span>${L.dt === 'lines' ? 'Path' : 'Point'}</span></div></div>`,
    visible: () => !L.hidden, setVisible: (v) => { L.hidden = !v; UI.app.map.render(); },
    remove: () => { delete MB.display[L.id]; save(); syncMap(); },
  }));
  UI.drawModelLayers = (ctx, P) => {
    for (const L of MB.layers) {
      if (L.hidden) continue;
      if (L.dt === 'lines') for (const l of L.lines) {
        if (!l.line || l.line.length < 2) continue;
        ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath(); l.line.forEach(([c, r], k) => { const [x, y] = P.xy(c, r); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 6; ctx.stroke();
        if (L.input) ctx.setLineDash([9, 5]);
        ctx.strokeStyle = L.input ? '#6d28d9' : '#d0342c'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
        const m = l.line[Math.floor(l.line.length * 0.6)], [x, y] = P.xy(m[0], m[1]);
        UI.haloText(ctx, `${l.label}${l.attrs && l.attrs.timeH != null ? ' ' + F.time(l.attrs.timeH) : ''}`, x + 8, y - 6, { now: true, color: '#9b1c1c', size: 12, bold: true });
      }
      if (L.dt === 'points') for (const q of L.pts) {
        const [x, y] = P.xy(q.c, q.r);
        ctx.save(); ctx.beginPath();
        if (L.input) { ctx.rect(x - 6, y - 6, 12, 12); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#6d28d9'; ctx.lineWidth = 3; } else { ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fillStyle = '#1d4ed8'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; }
        ctx.fill(); ctx.stroke(); ctx.restore();
        UI.haloText(ctx, q.label || L.name, x + 9, y - 7, { now: true, color: L.input ? '#4c1d95' : '#1d3a8a', size: 11.5, bold: true });
      }
    }
  };

  // ---------------------------------------------------------------- Brief on map
  /*
   * Steps through the model in run order on the map: first the inputs, then each tool with its
   * inputs (purple squares / dashed lines for points and lines you set, the input raster drawn when
   * the tool makes no raster itself) and its outputs, then the results. A caption says what the
   * tool does, the values it used and what it produced in this run.
   */
  MB.briefing = null;
  const briefSteps = () => {
    const G = graph();
    const ins = nodes().filter((n) => n.kind !== 'derived' && n.kind !== 'tool');
    const steps = [{ kind: 'inputs', vars: ins }];
    G.tools.forEach((t, k) => steps.push({ kind: 'tool', t, num: k + 1, reads: G.reads(t).map(node).filter(Boolean), outs: Object.values(t.outputs || {}).map(node).filter(Boolean) }));
    steps.push({ kind: 'result', outs: nodes().filter((n) => n.kind === 'derived' && (n.display || MB.display[n.id] || (MB.rep.vars[n.id] && MB.rep.vars[n.id].dt === 'table'))) });
    return steps;
  };
  const inputLayers = (vars) => vars.filter((v) => v.value && (v.dt === 'point' || v.dt === 'line' || v.dt === 'points')).map((v) => (v.dt === 'line'
    ? { id: 'in:' + v.id, name: v.name, dt: 'lines', input: true, lines: [{ label: v.name, line: v.value }] }
    : { id: 'in:' + v.id, name: v.name, dt: 'points', input: true, pts: (Array.isArray(v.value) ? v.value : [v.value]).map((q) => Object.assign({ label: v.name }, q)) }));
  MB.brief = async (fromTool) => {
    if (!MB.rep || MB.rep.stale || MB.rep.failed === undefined) await MB.run();
    if (!MB.rep) return;
    const steps = briefSteps();
    let k = fromTool ? steps.findIndex((s) => s.t && s.t.id === fromTool) : 0;
    const S = UI.S;
    MB.briefing = { steps, k: Math.max(0, k), saved: Object.assign({}, MB.display), show: Object.assign({}, S.show),
      ovl: Object.fromEntries(Object.entries(S.overlays).map(([id, o]) => [id, o.visible])) };
    // only the model step on the map: keep the situation symbols and the border, hide every other layer
    const keep = new Set(['symbols', 'labels', 'markers', 'secArea']);
    Object.keys(S.show).forEach((k) => { if (!keep.has(k)) S.show[k] = false; });
    Object.entries(S.overlays).forEach(([id, o]) => { if (id !== 'model') o.visible = false; });
    UI.app.setView('2d');
    await applyBrief();
    // whole map below the caption
    const map = UI.app.map, g = S.grid, bar = ($('briefBar') || {}).offsetHeight || 0;
    const sc = Math.min((map.W - 40) / g.w, (map.H - bar - 50) / g.h);
    map.centerOn(g.w / 2, g.h / 2 - (bar + 20) / 2 / sc, sc);
  };
  const applyBrief = async () => {
    const B = MB.briefing;
    if (!B) return;
    const st = B.steps[B.k], vars = MB.rep.vars;
    const show = [];
    let ras = null, inVars = [];
    const isRas = (v) => vars[v.id] && vars[v.id].dt === 'raster' && vars[v.id].kind !== 'backlink';
    if (st.kind === 'inputs') inVars = st.vars;
    else if (st.kind === 'tool') {
      inVars = st.reads.filter((v) => v.kind !== 'derived');
      st.reads.filter((v) => v.kind === 'derived' && vars[v.id] && vars[v.id].dt !== 'raster').forEach((v) => show.push(v.id));
      st.outs.forEach((v) => { if (vars[v.id]) show.push(v.id); });
      const outR = st.outs.find(isRas), inR = st.reads.filter((v) => v.kind === 'derived').find(isRas);
      ras = outR ? outR.id : inR ? inR.id : null;
      if (ras && !show.includes(ras)) show.push(ras);
    } else {
      st.outs.forEach((v) => { if (vars[v.id] && vars[v.id].dt !== 'table') show.push(v.id); });
      const r = st.outs.find(isRas); ras = r ? r.id : null;
      inVars = nodes().filter((n) => n.kind === 'value' && (n.dt === 'point' || n.dt === 'line'));
    }
    B.inputs = inputLayers(inVars);
    MB.display = Object.fromEntries(show.map((i) => [i, true]));
    await syncMap(ras);
    renderBriefBar();
  };
  const settingsOf = (t) => {
    const def = M.GPT[t.tool], out = [];
    for (const pd of def.params) {
      if (pd.dir === 'out') continue;
      const vid = t.inputs && t.inputs[pd.k];
      const v = vid && node(vid);
      if (v && v.kind === 'value') out.push(`${pd.label.replace(/\s*\(.*?\)$/, '')} = ${valueText(v)}`);
      else if (!v && pd.dt !== 'raster' && pd.dt !== 'points' && pd.dt !== 'lines') { const val = t.values && pd.k in t.values ? t.values[pd.k] : pd.def; if (val !== undefined && val !== null && val !== '') out.push(`${pd.label.replace(/\s*\(.*?\)$/, '')} = ${pd.dt === 'profile' ? (M.MOVEMENT_PROFILES[val] || {}).name || val : val}`); }
    }
    return out;
  };
  const renderBriefBar = () => {
    const B = MB.briefing, bar = $('briefBar');
    if (!bar) return;
    if (!B) { bar.hidden = true; return; }
    const st = B.steps[B.k], N = B.steps.length;
    let tag, title, body = '';
    if (st.kind === 'inputs') {
      tag = 'Inputs'; title = `${MB.model.name} — what we start from`;
      body = `<div class="bb-desc">${esc(MB.model.question || '')}</div><div class="bb-list">${st.vars.map((v) => `<span><b>${esc(v.name)}</b> ${esc(valueText(v))}</span>`).join('')}</div>`;
    } else if (st.kind === 'tool') {
      const def = M.GPT[st.t.tool], s = MB.rep.tools[st.t.id] || {};
      tag = `Step ${st.num} of ${N - 2}`; title = `${st.t.name}: ${st.reads.map((v) => v.name).join(', ')} → ${st.outs.map((v) => v.name).join(', ')}`;
      const set = settingsOf(st.t);
      body = `<div class="bb-desc">${esc(def.help)}</div>${st.t.tool === 'rasterCalc' ? `<div class="bb-expr"><code>${esc(st.t.values.expr)}</code></div>` : ''}${set.length ? `<div class="bb-list">${set.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        <div class="bb-res">${s.state === 'failed' ? `<b class="bad">Failed:</b> ${esc(s.msg)}` : st.outs.map((v) => `<b>${esc(v.name)}:</b> ${esc(resultText(v) || '—')}`).join(' · ')}</div>`;
    } else {
      tag = 'Result'; title = MB.model.name;
      const tbl = st.outs.filter((v) => MB.rep.vars[v.id] && MB.rep.vars[v.id].dt === 'table');
      body = `<div class="bb-res">${st.outs.filter((v) => MB.rep.vars[v.id] && MB.rep.vars[v.id].dt !== 'table').map((v) => `<b>${esc(v.name)}:</b> ${esc(resultText(v))}`).join(' · ')}</div>${tbl.map((v) => summaryHTML(v, MB.rep.vars[v.id])).join('')}`;
    }
    const onMap = MB.layers.map((L) => L.name).concat(MB.rasterId ? [node(MB.rasterId).name + ' (colour)'] : []);
    bar.hidden = false;
    bar.innerHTML = `<div class="bb-top"><span class="bb-tool">ModelBuilder brief</span><span class="bb-n">${B.k + 1} / ${N}</span></div>
      <div class="bb-main"><span class="bb-tag">${esc(tag)}</span><b>${esc(title)}</b></div>${body}
      ${onMap.length ? `<div class="bb-map">On the map: ${esc(onMap.join(' · '))}</div>` : ''}
      <div class="bb-ctl"><button class="btn" data-b="prev"${B.k ? '' : ' disabled'}>◀ Prev</button><button class="btn primary" data-b="next"${B.k < N - 1 ? '' : ' disabled'}>Next ▶</button><button class="btn" data-b="model">Back to model</button><button class="btn" data-b="exit">Exit</button></div>`;
    bar.querySelector('[data-b=prev]').onclick = () => MB.briefStep(-1);
    bar.querySelector('[data-b=next]').onclick = () => MB.briefStep(1);
    bar.querySelector('[data-b=model]').onclick = () => { const t = st.t; MB.endBrief(); if (t) MB.sel = t.id; UI.app.setView('model'); };
    bar.querySelector('[data-b=exit]').onclick = () => MB.endBrief();
  };
  MB.briefStep = async (d) => {
    const B = MB.briefing;
    if (!B) return;
    B.k = Math.max(0, Math.min(B.steps.length - 1, B.k + d));
    await applyBrief();
  };
  MB.endBrief = async () => {
    const B = MB.briefing;
    if (!B) return;
    MB.briefing = null;
    MB.display = B.saved;
    Object.assign(UI.S.show, B.show);
    Object.entries(B.ovl).forEach(([id, v]) => { if (id !== 'model' && UI.S.overlays[id]) UI.S.overlays[id].visible = v; });
    renderBriefBar();
    await syncMap();
  };
  document.addEventListener('keydown', (e) => {
    if (!MB.briefing || /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { MB.briefStep(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { MB.briefStep(-1); e.preventDefault(); }
    else if (e.key === 'Escape') { MB.endBrief(); e.preventDefault(); }
  }, true);

  // ---------------------------------------------------------------- import / export / report
  const exportModel = () => {
    const blob = new Blob([JSON.stringify(MB.model, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${MB.model.name.replace(/[^\w]+/g, '_')}.model.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importModel = async (f) => {
    if (!f) return;
    try {
      const m = JSON.parse(await f.text());
      if (!m.nodes) throw new Error('Not a MtnEye model file.');
      MB.model = m; MB.model.nodes.forEach(place); MB.rep = null; MB.sel = null; MB.display = {};
      clearMap(); MB.fit(); save(); MB.render();
    } catch (e) { status(e.message); }
  };

  /** Printable report of the current model (Arial 12, black). opts: { shots: [{ title, src }], intro } */
  MB.reportHTML = (opts = {}) => {
    const d = MB.svg({ print: true, vertical: true });
    const G = graph();
    const vars = nodes().filter(isVar);
    const rows = (G ? G.tools : []).map((t, k) => {
      const def = M.GPT[t.tool];
      const ins = def.params.filter((pd) => pd.dir === 'in').map((pd) => {
        const vid = t.inputs && t.inputs[pd.k];
        const v = vid ? `<b>${esc(node(vid).name)}</b>` : esc(String(t.values && pd.k in t.values ? t.values[pd.k] : pd.def === undefined ? '—' : pd.def));
        return `${esc(pd.label)}: ${v}`;
      });
      if (t.tool === 'rasterCalc') ins.push('Uses: ' + (G.reads(t).map((v) => `<b>${esc(node(v).name)}</b>`).join(', ') || '—'));
      const outs = Object.values(t.outputs || {}).map((v) => node(v)).filter(Boolean);
      const s = MB.rep && MB.rep.tools[t.id];
      return `<tr><td>${k + 1}</td><td><b>${esc(t.name)}</b><br><span class="small">${esc(def.arc)}</span></td><td>${esc(def.help)}</td><td class="small">${ins.join('<br>')}</td>
        <td class="small">${outs.map((v) => `<b>${esc(v.name)}</b>${resultText(v) ? `: ${esc(resultText(v))}` : ''}`).join('<br>')}${s && s.state === 'failed' ? `<br><i>Failed: ${esc(s.msg)}</i>` : ''}</td></tr>`;
    }).join('');
    const params = vars.filter((v) => v.kind === 'value');
    const tables = vars.filter((v) => v.kind === 'derived' && MB.rep && MB.rep.vars[v.id] && MB.rep.vars[v.id].dt === 'table');
    return `<h2>${esc(MB.model.name)}</h2><p><b>Question.</b> ${esc(MB.model.question || '')}</p>
      <h3>The model</h3><div class="dia"><svg xmlns="http://www.w3.org/2000/svg" viewBox="${d.box.join(' ')}" width="${d.box[2]}" font-family="Arial, Helvetica, sans-serif">${d.inner}</svg></div>
      <p class="small">The model flows from top to bottom. Plain ovals: input data. Dashed ovals: values you can change (P = model parameter). Rounded boxes: tools. Double ovals: derived data. Text under an element: its result in this run.</p>
      <h3>Values used</h3><table><tr><th>Variable</th><th>Value</th><th>Note</th></tr>${params.map((v) => `<tr><td><b>${esc(v.name)}</b>${v.P ? ' (P)' : ''}</td><td>${esc(v.dt === 'remap' ? v.value : valueText(v))}</td><td class="small">${esc(v.note || '')}</td></tr>`).join('')}</table>
      <h3>Tools in the order they run</h3><table><tr><th>#</th><th style="width:18%">Tool</th><th>What it does</th><th style="width:24%">Inputs</th><th style="width:22%">Output (this run)</th></tr>${rows}</table>
      ${(opts.shots || []).map((sh) => `<figure><img src="${sh.src}"><figcaption>${esc(sh.title)}</figcaption></figure>`).join('')}
      ${tables.map((v) => `<h3>${esc(v.name)}</h3>${summaryHTML(v, MB.rep.vars[v.id]).replace(/class="mb-tbl"/g, '')}`).join('')}
      ${opts.after || ''}`;
  };
  MB.REPORT_CSS = `@page { size: A4; margin: 16mm 15mm; } body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; color: #000; background: #fff; line-height: 1.35; }
    h1 { font-size: 20pt; margin: 0 0 8pt; } h2 { font-size: 15pt; margin: 0 0 6pt; border-bottom: 1px solid #000; padding-bottom: 3pt; } h3 { font-size: 12.5pt; margin: 12pt 0 4pt; }
    p, li { margin: 3pt 0; } .small { font-size: 10pt; } section { page-break-before: always; } table { border-collapse: collapse; width: 100%; margin: 4pt 0; font-size: 10.5pt; }
    th, td { border: 1px solid #000; padding: 3pt 5pt; vertical-align: top; text-align: left; } tr { page-break-inside: avoid; }
    .dia { text-align: center; } .dia svg { max-width: 100%; height: auto; max-height: 235mm; } figure { margin: 8pt 0; page-break-inside: avoid; } figure img { width: 100%; border: 1px solid #000; } figcaption { font-size: 10pt; font-style: italic; }`;
  MB.print = () => {
    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to print the model report.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(MB.model.name)}</title><style>${MB.REPORT_CSS}</style></head><body>${MB.reportHTML()}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
