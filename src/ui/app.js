/*
 * MtnAI ui — application controller: state, panels, tools and rendering glue.
 */
(function (UI) {
  'use strict';
  const M = UI.M;
  const $ = (id) => document.getElementById(id);
  const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`);
  const fmtH = (h) => (h == null ? '—' : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`);
  const mils = (deg) => `${String(Math.round(M.mils(deg)) % 6400).padStart(4, '0')}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // =================================================================== state
  const S = (UI.S = {
    grid: null, L: null, stats: null, sources: null, fullGrid: null,
    base: 'relief', blend: true, sunAz: 315, sunAlt: 45, vex: 1.5,
    contours: null, interval: 0,
    overlays: {
      mobility: { name: 'Mobility (Go / No-Go)', legend: 'mobility', opacity: 1 },
      hostile: { name: 'Enemy observation', legend: 'hostile', opacity: 1 },
      avenues: { name: 'Avenue corridors', legend: 'avenues', opacity: 1 },
      cover: { name: 'Observation coverage (posts)', legend: 'cover', opacity: 1 },
      wcover: { name: 'Fields of fire (weapons)', legend: 'wcover', opacity: 1 },
      dead: { name: 'Dead ground', legend: 'dead', opacity: 1 },
      viewshed: { name: 'Viewshed', legend: 'viewshed', opacity: 1 },
    },
    markers: {}, obstacles: [], tracks: [],
    threatType: 'foot', ownEchelon: 'battalion',
    key: null, posts: null, weapons: [], mfd: null, avenues: null, routes: null, picquets: null, hostile: null, los: null, vsPoint: null,
    mobStats: {}, mobProfile: 'foot', mobStyle: 'fill', profileOverrides: {}, weaponOverrides: {}, snowLine: 0, generalize: false,
    show: { contours: true, grid: true, key: true, symbols: true, labels: true, posts: true, weapons: true, mfd: true, routes: true, avenues: true, picquets: true, hostileOps: true },
    symbolSize: 30, tool: null, draft: null, sel: null, view: '2d', baseCanvas: null, texCanvas: null,
  });

  const engine = new UI.Engine();
  let map, v3;

  // =================================================================== feedback
  let toastTimer = 0;
  const toast = (msg, err = false, ms = 4500) => {
    const t = $('toast');
    t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  };
  let busyCount = 0;
  const busy = (on, msg) => {
    busyCount = Math.max(0, busyCount + (on ? 1 : -1));
    $('busy').hidden = busyCount === 0;
    if (on) { $('busyMsg').textContent = msg || 'Working…'; $('busyBar').style.width = '0%'; }
  };
  const progress = (p, msg) => { $('busyBar').style.width = `${Math.round(p * 100)}%`; if (msg) $('busyMsg').textContent = msg; };
  /** Brief edge-light over the map: teal on success, red on error. */
  const flash = (kind) => {
    const st = $('stage');
    st.classList.remove('glow-ok', 'glow-err');
    void st.offsetWidth;
    st.classList.add(kind === 'err' ? 'glow-err' : 'glow-ok');
  };
  /** Type text into an element quickly ("streaming"). */
  const stream = (el, text) => {
    let i = 0;
    const step = () => {
      i = Math.min(text.length, i + Math.max(2, Math.ceil(text.length / 40)));
      el.textContent = text.slice(0, i);
      if (i < text.length) requestAnimationFrame(step);
    };
    step();
  };
  /** Analysis log entry: returns {done(summary), fail(message)}. */
  const logStart = (label) => {
    const el = document.createElement('div');
    el.className = 'log-e run';
    const t = new Date().toTimeString().slice(0, 8);
    el.innerHTML = `<div class="st"><span class="pulse"></span></div><div class="l1">${esc(label)}</div><div class="tm">${t}</div><div class="l2"></div>`;
    $('log').prepend(el);
    const t0 = performance.now();
    const end = (cls, icon, msg) => {
      el.className = `log-e ${cls}`;
      el.querySelector('.st').innerHTML = UI.icon(icon, 14);
      el.querySelector('.tm').textContent = `${t} · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      if (msg) stream(el.querySelector('.l2'), msg);
    };
    return { done: (msg) => end('ok', 'ok', msg), fail: (msg) => end('err', 'err', msg) };
  };
  UI.jobSeq = 0;
  /** Run an engine job with progress bar, log entry, glow and error toast. */
  const run = async (label, cmd, args, summarize) => {
    busy(true, label);
    const entry = logStart(label);
    try {
      const res = await engine.call(cmd, args, progress);
      entry.done(summarize ? summarize(res) : '');
      flash('ok');
      return res;
    } catch (e) {
      entry.fail(e.message);
      toast(e.message, true, 7000);
      flash('err');
      throw e;
    } finally { busy(false); UI.jobSeq++; }
  };
  /** Wrap async UI handlers so a failed job (already reported) never surfaces as an unhandled rejection. */
  const safe = (fn) => (...a) => Promise.resolve().then(() => fn(...a)).catch((e) => console.debug('MtnAI:', e.message));

  // =================================================================== DEM loading
  const loadGrid = async (grid, opts = {}) => {
    busy(true, 'Analysing terrain…');
    const entry = logStart(`Load DEM · ${grid.name}`);
    try {
      const meta = M.gridMeta(grid);
      const res = await engine.call('init', { grid: Object.assign({}, meta, { z: grid.z }) }, progress);
      S.grid = meta;
      S.L = { z: res.z, slope: res.slope, aspect: res.aspect, landform: res.landform, tri: res.tri, tpiL: res.tpiL, hs: res.hs };
      S.stats = res.stats;
      S.sources = opts.sources || null;
      if (opts.full) S.fullGrid = opts.full;
      // reset analysis state
      Object.assign(S, { key: null, posts: null, weapons: [], mfd: null, avenues: null, routes: null, picquets: null, hostile: null, los: null, vsPoint: null, sel: null, mobStats: {}, draft: null });
      for (const o of Object.values(S.overlays)) { o.data = null; o.rgba = null; o.visible = false; }
      if (!opts.keepPlan) { S.markers = {}; S.obstacles = []; S.tracks = opts.tracks || []; }
      if (opts.markers) for (const k in opts.markers) S.markers[k] = snapLowSlope(opts.markers[k]);
      progress(0.9, 'Contours');
      S.contours = await engine.call('contours', { interval: S.interval });
      await syncSettings();
      $('welcome').classList.add('hidden');
      $('demName').textContent = `${meta.name} · ${meta.w}×${meta.h} @ ${meta.cs} m · UTM ${meta.zone}${meta.north ? 'N' : 'S'}`;
      document.querySelectorAll('button[disabled]').forEach((b) => (b.disabled = false));
      composeBase();
      map.fit();
      if (v3.ok) { v3.setTerrain(S.grid, S.L.z); updateTexture(true); }
      renderDataInfo();
      renderAllLists();
      renderLayersPanel();
      updateMarkerButtons();
      updateLegend();
      $('btnAOIReset').disabled = !(S.sources || S.fullGrid);
      if (S.tracks.length) $('obsInfo').textContent = `${S.tracks.length} track(s) digitised.`;
      entry.done(`${meta.w}×${meta.h} @ ${meta.cs} m · ${Math.round(res.stats.elevMin)}–${Math.round(res.stats.elevMax)} m · mean slope ${res.stats.slopeMean.toFixed(0)}°`);
      flash('ok');
    } catch (e) {
      console.error(e);
      entry.fail(e.message);
      flash('err');
      toast('Could not load DEM: ' + e.message, true, 8000);
    } finally { busy(false); UI.jobSeq++; }
  };

  const loadDemo = () => {
    busy(true, 'Generating synthetic training area…');
    setTimeout(async () => {
      try {
        const syn = M.syntheticTerrain();
        await loadGrid(syn.grid, { markers: syn.markers, full: syn.grid, tracks: syn.tracks });
        toast('Synthetic training area loaded — own (blue) and enemy (red) positions pre-placed. Try the Tactical tab.');
      } finally { busy(false); }
    }, 30);
  };

  const importFiles = async (files) => {
    if (!files || !files.length) return;
    busy(true, 'Reading DEM files…');
    try {
      const zone = /^(\d{1,2})\s*([NS])?$/i.exec($('optAscZone').value.trim());
      const opts = { ascUtm: zone ? { zone: +zone[1], north: (zone[2] || 'N').toUpperCase() === 'N' } : null };
      const sources = [];
      for (const f of files) {
        progress(sources.length / files.length, `Reading ${f.name}`);
        sources.push(...(await M.parseDEMFile(f.name, await f.arrayBuffer(), opts)));
      }
      progress(0.8, 'Resampling into UTM grid');
      await new Promise((r) => setTimeout(r, 20));
      const grid = M.buildGrid(sources, { maxCells: +$('optMaxCells').value });
      await loadGrid(grid, { sources });
      toast(`Loaded ${sources.length} DEM source(s) → ${grid.w}×${grid.h} cells at ${grid.cs} m.`);
    } catch (e) {
      console.error(e);
      toast(e.message, true, 9000);
    } finally { busy(false); }
  };

  const cropAOI = async (p, q) => {
    const g = S.grid;
    const a = M.cellToEN(g, Math.min(p[1], q[1]), Math.min(p[0], q[0])), b = M.cellToEN(g, Math.max(p[1], q[1]), Math.max(p[0], q[0]));
    const aoi = { E0: a.E, N1: a.N, E1: b.E, N0: b.N };
    if (aoi.E1 - aoi.E0 < 10 * g.cs || aoi.N1 - aoi.N0 < 10 * g.cs) { toast('Area too small.', true); return; }
    const plan = savePlanObject();
    busy(true, 'Cropping area of interest…');
    try {
      let grid;
      if (S.sources) grid = M.buildGrid(S.sources, { maxCells: +$('optMaxCells').value, aoi, zone: g.zone });
      else {
        const src = S.fullGrid || Object.assign({}, g, { z: S.L.z });
        const cs = Math.max(src.cs / 2, Math.sqrt(((aoi.E1 - aoi.E0) * (aoi.N1 - aoi.N0)) / +$('optMaxCells').value));
        grid = M.resampleGrid(src, aoi.E0, aoi.N1, aoi.E1, aoi.N0, Math.ceil(cs));
      }
      await loadGrid(grid, { sources: S.sources, keepPlan: false });
      applyPlan(plan, { silent: true });
    } finally { busy(false); }
  };

  const resetAOI = async () => {
    const plan = savePlanObject();
    if (S.sources) await loadGrid(M.buildGrid(S.sources, { maxCells: +$('optMaxCells').value }), { sources: S.sources });
    else if (S.fullGrid) await loadGrid(S.fullGrid, { full: S.fullGrid });
    applyPlan(plan, { silent: true });
  };

  /** Move a marker to the gentlest cell nearby (a usable spot rather than a cliff face). */
  const snapLowSlope = (p, rad = 6) => {
    const g = S.grid;
    let best = { c: Math.round(p.c), r: Math.round(p.r) }, bs = Infinity;
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const r = Math.round(p.r) + dr, c = Math.round(p.c) + dc;
      if (!M.inGrid(g, r, c)) continue;
      const s = S.L.slope[r * g.w + c] + Math.hypot(dr, dc) * 0.8;
      if (s < bs) { bs = s; best = { c, r }; }
    }
    return best;
  };

  const syncSettings = () => engine.call('settings', {
    own: S.markers.own || null, threat: S.markers.threat || null, target: S.markers.target || null, threatProfile: S.threatType,
    obstacles: S.obstacles, tracks: S.tracks, profiles: S.profileOverrides, snowLine: S.snowLine, generalize: S.generalize,
  });

  // =================================================================== composition
  const texScale = () => Math.max(1, Math.min(3, Math.floor(4096 / Math.max(S.grid.w, S.grid.h))));
  const small = document.createElement('canvas');
  const putSmall = (rgba) => {
    const g = S.grid;
    small.width = g.w; small.height = g.h;
    small.getContext('2d').putImageData(new ImageData(rgba, g.w, g.h), 0, 0);
    return small;
  };
  const hatchPattern = (ctx, color, cross) => {
    const p = document.createElement('canvas');
    p.width = p.height = 9;
    const c = p.getContext('2d');
    c.strokeStyle = color; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(-1, 10); c.lineTo(10, -1); c.moveTo(-1, 1); c.lineTo(1, -1); c.moveTo(8, 10); c.lineTo(10, 8);
    if (cross) { c.moveTo(-1, -1); c.lineTo(10, 10); c.moveTo(8, -1); c.lineTo(10, 1); c.moveTo(-1, 8); c.lineTo(1, 10); }
    c.stroke();
    return ctx.createPattern(p, 'repeat');
  };

  const overlayRGBA = (id, o) => {
    if (o.rgba) return o.rgba;
    switch (id) {
      case 'mobility': o.rgba = UI.colorClasses(o.data, UI.MOB_COLORS); break;
      case 'hostile': o.rgba = UI.colorMask(o.data, [255, 50, 50], 0.36); break;
      case 'avenues': o.rgba = UI.colorDensity(o.data, [255, 60, 40], 0.5); break;
      case 'cover': o.rgba = UI.colorCount(o.data, [[150, 230, 140, 0.35], [60, 190, 90, 0.45], [20, 130, 60, 0.55]]); break;
      case 'wcover': o.rgba = UI.colorMask(o.data, [255, 150, 40], 0.38); break;
      case 'dead': o.rgba = UI.colorMask(o.data, [220, 60, 220], 0.5); break;
      case 'viewshed': o.rgba = UI.colorMask(o.data, [255, 226, 70], 0.42); break;
    }
    return o.rgba;
  };

  const composeBase = () => {
    const g = S.grid;
    if (!g) return;
    const k = texScale();
    const tex = S.baseCanvas || document.createElement('canvas');
    tex.width = g.w * k; tex.height = g.h * k;
    const ctx = tex.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(putSmall(UI.colorBase(S.base, S.L, S.stats, S.blend)), 0, 0, tex.width, tex.height);
    const tmp = document.createElement('canvas');
    tmp.width = tex.width; tmp.height = tex.height;
    const tctx = tmp.getContext('2d');
    for (const id of ['mobility', 'hostile', 'avenues', 'cover', 'wcover', 'dead', 'viewshed']) {
      const o = S.overlays[id];
      if (!o.visible || !o.data) continue;
      ctx.globalAlpha = o.opacity;
      if (id === 'mobility' && S.mobStyle === 'hatch') {
        for (const [klass, color, cross] of [[1, 'rgba(240,170,30,0.95)', false], [2, 'rgba(225,45,40,0.95)', true]]) {
          const mask = new Uint8ClampedArray(o.data.length * 4);
          for (let i = 0; i < o.data.length; i++) if (o.data[i] === klass) mask[i * 4 + 3] = 255;
          tctx.globalCompositeOperation = 'source-over';
          tctx.clearRect(0, 0, tmp.width, tmp.height);
          tctx.imageSmoothingEnabled = false;
          tctx.drawImage(putSmall(mask), 0, 0, tmp.width, tmp.height);
          tctx.globalCompositeOperation = 'source-in';
          tctx.fillStyle = hatchPattern(tctx, color, cross);
          tctx.fillRect(0, 0, tmp.width, tmp.height);
          ctx.drawImage(tmp, 0, 0);
        }
        tctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.drawImage(putSmall(overlayRGBA(id, o)), 0, 0, tex.width, tex.height);
      }
      ctx.globalAlpha = 1;
    }
    if (S.show.contours) UI.drawContours(ctx, S.contours, { xy: (c, r) => [(c + 0.5) * k, (r + 0.5) * k], lw: Math.max(1, k * 0.55) });
    S.baseCanvas = tex;
    S.texDirty = true;
  };

  let texTimer = 0;
  const updateTexture = (now) => {
    if (!v3 || !v3.ok || !S.grid) return;
    if (S.view !== '3d' && !now) { S.texDirty = true; return; }
    clearTimeout(texTimer);
    const build = () => {
      const k = texScale();
      const t = S.texCanvas || document.createElement('canvas');
      t.width = S.baseCanvas.width; t.height = S.baseCanvas.height;
      const ctx = t.getContext('2d');
      ctx.drawImage(S.baseCanvas, 0, 0);
      const P = { xy: (c, r) => [(c + 0.5) * k, (r + 0.5) * k], ppc: k, lw: k * 0.85, cs: S.grid.cs };
      if (S.show.grid) UI.drawGridLines(ctx, S.grid, P, [-0.5, -0.5, S.grid.w, S.grid.h], false);
      UI.drawFeatures(ctx, S, P);
      S.texCanvas = t;
      S.texDirty = false;
      v3.setTexture(t);
    };
    if (now) build(); else texTimer = setTimeout(build, 80);
  };

  /** Re-render after a state change. base: recompose rasters first. */
  const refresh = (opts = {}) => {
    if (!S.grid) return;
    if (opts.base) composeBase();
    map.render();
    if (S.view === '3d') { updateTexture(); v3.render(); } else S.texDirty = true;
    if (opts.legend !== false) updateLegend();
  };
  UI.onSymbolReady(() => { map && map.render(); if (S.view === '3d') { v3.render(); updateTexture(); } });

  // =================================================================== legend
  const updateLegend = () => {
    const el = $('legend');
    if (!S.grid) return;
    const blocks = [];
    const baseInfo = { min: S.stats.elevMin, max: S.stats.elevMax };
    if (S.base === 'tri') baseInfo.max = UI.percentile(S.L.tri, 0.98);
    if (S.base !== 'relief') blocks.push(UI.legendHTML(S.base, baseInfo));
    for (const [id, o] of Object.entries(S.overlays)) {
      if (!o.visible || !o.data) continue;
      blocks.push(UI.legendHTML(o.legend, o.info || {}));
    }
    el.innerHTML = blocks.length ? blocks.map((b) => `<div class="blk">${b}</div>`).join('') : '<p class="hint">Shaded relief only — no analysis layer shown.</p>';
  };

  // =================================================================== status bar / hover
  const app = {
    S,
    onHover(c, r) {
      const g = S.grid;
      if (!g || c === null || c === undefined || c < -0.5 || r < -0.5 || c > g.w - 0.5 || r > g.h - 0.5) {
        for (const id of ['stMGRS', 'stLL', 'stZ', 'stSlope', 'stAspect', 'stLF', 'stMob']) $(id).textContent = '—';
        return;
      }
      const ci = Math.round(c), ri = Math.round(r), i = ri * g.w + ci;
      const ll = M.cellToLatLon(g, r, c);
      $('stMGRS').textContent = M.utmToMGRS(g.x0 + (c + 0.5) * g.cs, g.y0 - (r + 0.5) * g.cs, g.zone, M.latBand(ll.lat) || 'N', 5);
      $('stLL').textContent = M.toDMS(ll.lat, ll.lon);
      $('stZ').textContent = `${Math.round(M.sample(g, S.L.z, r, c))} m`;
      $('stSlope').textContent = `${S.L.slope[i].toFixed(1)}°`;
      const a = S.L.aspect[i];
      $('stAspect').textContent = a < 0 ? 'flat' : `${M.ASPECT_NAMES[M.aspectClass(a)]} ${mils(a)} mils`;
      $('stLF').textContent = M.LANDFORMS[S.L.landform[i]].name.split(' (')[0];
      const mob = S.overlays.mobility.data;
      $('stMob').textContent = mob ? `${M.CLASS_NAMES[mob[i]]} (${M.MOVEMENT_PROFILES[S.overlays.mobility.profile].name.split(' (')[0]})` : '—';
      if (S.draft) { S.draft.hover = [c, r]; map.render(); }
    },
    onClick(c, r, ev) { safe(handleClick)(c, r, ev); },
    onDblClick(c, r) { if (S.draft && (S.draft.kind === 'poly' || S.draft.kind === 'line')) finishDraft(); else if (S.view === '2d' && !S.tool) map.zoomAt(...map.toScreen(c, r), 2); },
  };

  // =================================================================== tools
  const TOOL_HINTS = {
    own: 'Click own position (defended locality / HQ)', threat: 'Click the enemy position / direction of threat',
    target: 'Click the target area for indirect fire', a: 'Click route start (A)', b: 'Click route end (B)',
    poly: 'Click to add No-Go area vertices · double-click to finish · Esc cancels', line: 'Click to add track vertices · double-click to finish · Esc cancels',
    los: 'Click observer, then target', vs: 'Click observer position', measure: 'Click start, then end point', aoi: 'Click two opposite corners of the area of interest',
  };
  const TOOL_BTN = { own: 'btnOwn', threat: 'btnThreat', target: 'btnTarget', a: 'btnA', b: 'btnB', poly: 'btnObstacle', line: 'btnTrack', los: 'btnLOS', vs: 'btnVS', measure: 'btnMeasure', aoi: 'btnAOI' };

  const setTool = (tool) => {
    if (S.tool === tool) tool = null;
    S.tool = tool;
    S.draft = tool && ['poly', 'line', 'los', 'measure', 'aoi'].includes(tool) ? { kind: tool, pts: [] } : null;
    for (const [t, id] of Object.entries(TOOL_BTN)) $(id).classList.toggle('active', t === tool);
    $('stage').classList.toggle('tool', !!tool);
    $('toolHint').hidden = !tool;
    if (tool) $('toolHint').textContent = TOOL_HINTS[tool];
    map.render();
  };

  const finishDraft = () => {
    const d = S.draft;
    if (!d) return;
    const pts = d.pts.filter((p, k) => k === 0 || Math.hypot(p[0] - d.pts[k - 1][0], p[1] - d.pts[k - 1][1]) > 0.5);
    if (d.kind === 'poly' && pts.length >= 3) S.obstacles.push(pts);
    else if (d.kind === 'line' && pts.length >= 2) S.tracks.push(pts);
    else { toast('Not enough vertices.', true); setTool(null); return; }
    setTool(null);
    onObstaclesChanged();
  };

  const onObstaclesChanged = async () => {
    $('obsInfo').textContent = `${S.obstacles.length} No-Go area(s), ${S.tracks.length} track(s). Mobility and routes now respect them.`;
    await syncSettings();
    if (S.overlays.mobility.data) await computeMobility(true);
    refresh();
  };

  const nearestSymbol = (x, y) => {
    let best = null, bd = 18;
    const items = UI.symbolItems(S).filter((it) => it.ref);
    for (const it of items) {
      let p;
      if (S.view === '3d') { const w = [v3.wx(it.c), v3.hAt(it.c, it.r) + 2, v3.wz(it.r)]; p = v3.project(w); if (p) p.y -= 26; }
      else { const [sx, sy] = map.toScreen(it.c, it.r); p = { x: sx, y: sy }; }
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = it.ref; }
    }
    return best;
  };

  const handleClick = async (c, r, ev) => {
    const g = S.grid;
    if (!g) return;
    const inside = c >= -0.5 && r >= -0.5 && c <= g.w - 0.5 && r <= g.h - 0.5;
    const tool = S.tool;
    if (!tool) {
      const ref = nearestSymbol(ev.x, ev.y);
      if (ref) { select(ref, false); return; }
      if (S.mfd && inside) {
        const k = S.mfd.fields.findIndex((f) => M.pointInPoly(c, r, f.poly));
        if (k >= 0) { select({ kind: 'mfd', idx: k }, false); return; }
      }
      if (S.sel) { S.sel = null; renderAllLists(); renderSelection(); refresh({ legend: false }); }
      return;
    }
    if (!inside) return;
    const cell = { c: Math.round(c), r: Math.round(r) };
    if (['own', 'threat', 'target', 'a', 'b'].includes(tool)) {
      S.markers[tool] = cell;
      setTool(null);
      if (tool === 'own' || tool === 'threat') { S.avenues = null; S.hostile = null; clearOverlay('hostile'); clearOverlay('avenues'); }
      updateMarkerButtons();
      await syncSettings();
      renderSituation();
      refresh({ base: true });
      return;
    }
    if (tool === 'poly' || tool === 'line') { S.draft.pts.push([c, r]); map.render(); return; }
    if (tool === 'aoi' || tool === 'measure' || tool === 'los') {
      S.draft.pts.push([c, r]);
      if (S.draft.pts.length < 2) { map.render(); return; }
      const [p, q] = S.draft.pts;
      setTool(null);
      if (tool === 'aoi') return cropAOI(p, q);
      if (tool === 'measure') return showMeasure(p, q);
      return runLOS({ c: Math.round(p[0]), r: Math.round(p[1]) }, { c: Math.round(q[0]), r: Math.round(q[1]) });
    }
    if (tool === 'vs') { setTool(null); return runViewshed(cell); }
  };

  const showMeasure = (p, q) => {
    const g = S.grid;
    const dc = q[0] - p[0], dr = q[1] - p[1];
    const d = Math.hypot(dc, dr) * g.cs;
    const brg = M.bearing(dc, -dr);
    const z1 = M.sample(g, S.L.z, p[1], p[0]), z2 = M.sample(g, S.L.z, q[1], q[0]);
    $('measureInfo').innerHTML = `Distance <b>${fmtKm(d)}</b> · grid bearing <b>${mils(brg)} mils</b> (${brg.toFixed(1)}°)<br>` +
      `Height difference ${z2 - z1 >= 0 ? '+' : ''}${Math.round(z2 - z1)} m · mean gradient ${M.deg(Math.atan(Math.abs(z2 - z1) / Math.max(1, d))).toFixed(1)}°<br>` +
      `From <code>${M.cellMGRS(g, p[1], p[0], 4)}</code> to <code>${M.cellMGRS(g, q[1], q[0], 4)}</code>`;
    S.draft = { kind: 'measure', pts: [p, q] };
    map.render();
    S.draft = null;
    setTimeout(() => { S.draft = { kind: 'measure', pts: [p, q], keep: true }; map.render(); }, 0);
  };

  // =================================================================== analyses
  const clearOverlay = (id) => { const o = S.overlays[id]; o.data = null; o.rgba = null; o.visible = false; };
  /** Store an overlay; by default it becomes the only visible analysis layer (others stay in Layers). */
  const setOverlay = (id, data, info, keepOthers) => {
    const o = S.overlays[id];
    if (!keepOthers) for (const [k, x] of Object.entries(S.overlays)) if (k !== id) x.visible = false;
    o.data = data; o.rgba = null; o.visible = !!data; o.info = info || o.info;
    renderLayersPanel();
  };

  const profileFor = (id) => Object.assign({}, M.MOVEMENT_PROFILES[id], S.profileOverrides[id] || {});

  const computeMobility = async (quiet) => {
    const id = $('mobProfile').value;
    S.mobProfile = id;
    await syncSettings();
    const res = await run(`Go / No-Go · ${M.MOVEMENT_PROFILES[id].name}`, 'mobility', { profile: id },
      (r) => `GO ${(r.stats.go * 100).toFixed(0)}% · SLOW ${(r.stats.slow * 100).toFixed(0)}% · NO-GO ${(r.stats.nogo * 100).toFixed(0)}%`);
    S.mobStats[id] = res.stats;
    S.overlays.mobility.profile = id;
    setOverlay('mobility', res.cls, Object.assign({ name: res.profile.name }, res.profile));
    const s = res.stats, area = S.stats.areaKm2;
    $('mobStats').innerHTML = `<div class="bar3"><i style="width:${s.go * 100}%;background:var(--go)"></i><i style="width:${s.slow * 100}%;background:var(--slow)"></i><i style="width:${s.nogo * 100}%;background:var(--nogo)"></i></div>
      <div class="legend-row"><span style="--c:var(--go)">GO ${(s.go * 100).toFixed(0)}% (${(s.go * area).toFixed(0)} km²)</span><span style="--c:var(--slow)">SLOW-GO ${(s.slow * 100).toFixed(0)}%</span><span style="--c:var(--nogo)">NO-GO ${(s.nogo * 100).toFixed(0)}%</span></div>`;
    refresh({ base: true });
    if (!quiet) toast(`${res.profile.name}: ${(s.go * 100).toFixed(0)}% GO, ${(s.slow * 100).toFixed(0)}% SLOW-GO, ${(s.nogo * 100).toFixed(0)}% NO-GO.`);
  };

  const needMarkers = (...keys) => {
    const names = { own: 'Own position', threat: 'Enemy', a: 'Route start (A)', b: 'Route end (B)' };
    const miss = keys.filter((k) => !S.markers[k]);
    if (miss.length) { toast(`Place ${miss.map((k) => names[k]).join(' and ')} first.`, true); return false; }
    return true;
  };

  const runKey = async () => {
    S.key = await run('Key terrain', 'keyTerrain', {}, (r) => `${r.peaks.length} dominating heights · ${r.passes.length} passes`);
    S.show.key = true;
    renderKeyList();
    refresh();
  };

  const runHostile = async () => {
    if (!needMarkers('threat')) return;
    await syncSettings();
    const res = await run('Enemy observation', 'hostileObservation', {}, (r) => `${r.observers.length - 1} likely enemy OPs + enemy position`);
    S.hostile = { observers: res.observers };
    setOverlay('hostile', res.count);
    let seen = 0;
    for (const v of res.count) if (v) seen++;
    $('sitInfo').innerHTML = `Likely enemy OPs: ${res.observers.length - 1} high points near the enemy. They overlook <b>${((seen / res.count.length) * 100).toFixed(0)}%</b> of the area (red). Unshaded ground is in defilade from enemy view.`;
    refresh({ base: true });
  };

  const runAvenues = async () => {
    if (!needMarkers('own', 'threat')) return;
    await syncSettings();
    const res = await run('Avenues of approach', 'avenues', { profile: S.threatType },
      (r) => r.routes.map((x, k) => `AA${k + 1} ${fmtKm(x.lengthM)} / ${fmtH(x.timeH)}`).join('\n'));
    S.avenues = { routes: res.routes };
    setOverlay('avenues', res.density);
    $('sitInfo').innerHTML = `Avenues of approach (${M.MOVEMENT_PROFILES[S.threatType].name}): ` +
      res.routes.map((r, k) => `AA ${k + 1}: ${fmtKm(r.lengthM)} / ${fmtH(r.timeH)}`).join(' · ');
    refresh({ base: true });
  };

  const runPosts = async () => {
    await syncSettings();
    const mode = $('postType').value, echelon = $('postEchelon').value;
    const res = await run(`Suggest ${mode === 'op' ? 'OPs' : 'posts'}`, 'posts', {
      count: +$('postCount').value, rangeM: +$('postRange').value, minSepM: +$('postSep').value, maxDistOwnM: +$('postMaxOwn').value, mode,
    }, (r) => `${r.posts.length} sites · ${(r.coverageShare * 100).toFixed(0)}% of approach ground observed · ${r.links.length} intervisible pairs`);
    S.posts = Object.assign(res, { mode, echelon });
    setOverlay('cover', res.cover);
    setOverlay('dead', res.dead, null, true);
    renderPostList();
    refresh({ base: true });
    if (res.accessRelaxed) toast('No post site is reachable on foot from own position — access constraint relaxed. Check obstacles / own position.', true, 7000);
  };

  const selectedWeapon = () => M.weapon($('wpnSelect').value, S.weaponOverrides[$('wpnSelect').value]);

  const runWeapons = async () => {
    const w = selectedWeapon();
    if (w.cat === 'indirect' && !S.markers.threat && !S.markers.target) { toast('Place the enemy or a target area first — indirect fire needs a target.', true); return; }
    await syncSettings();
    const res = await run(`Weapon sites · ${w.short}`, 'weapons', {
      weaponId: w.id, weaponOverrides: S.weaponOverrides[w.id], count: +$('wpnCount').value, defRadiusM: +$('wpnRadius').value,
    }, (r) => r.sites.map((x) => `${x.id} ${M.cellMGRS(S.grid, x.r, x.c, 4)}`).join('\n') + (r.accessRelaxed ? '\naccess relaxed' : ''));
    const entry = Object.assign(res, { weapon: w });
    const k = S.weapons.findIndex((x) => x.weapon.id === w.id);
    if (k >= 0) S.weapons[k] = entry; else S.weapons.push(entry);
    updateWeaponCover();
    renderWeaponList();
    refresh({ base: true });
    if (res.accessRelaxed) toast(`No site is reachable by ${M.MOVEMENT_PROFILES[res.accessProfile].name.toLowerCase()} from own position — access relaxed; digitise a track to enforce it.`, true, 8000);
  };

  const updateWeaponCover = () => {
    const covers = S.weapons.map((w) => w.cover).filter(Boolean);
    if (!covers.length) { clearOverlay('wcover'); renderLayersPanel(); return; }
    const u = new Uint8Array(covers[0].length);
    for (const cv of covers) for (let i = 0; i < u.length; i++) if (cv[i]) u[i] = 1;
    setOverlay('wcover', u);
  };

  const runMfd = async () => {
    if (!needMarkers('own', 'threat')) return;
    await syncSettings();
    let cover = null;
    const parts = [S.overlays.cover.data, S.overlays.wcover.data].filter(Boolean);
    if (parts.length) { cover = new Uint8Array(parts[0].length); for (const p of parts) for (let i = 0; i < p.length; i++) if (p[i]) cover[i] = 1; }
    const type = $('mfdType').value;
    const res = await run(`Minefields · ${type}`, 'minefields', {
      type, count: +$('mfdCount').value, maxGapM: +$('mfdGap').value, depthM: +$('mfdDepth').value,
      densityPerM: +$('mfdDensity').value, maxDistOwnM: +$('mfdMaxOwn').value, cover,
    }, (r) => r.fields.map((f) => `${f.id} gap ${Math.round(f.gapM)} m · ≈${f.estMines} mines`).join('\n'));
    S.mfd = res;
    if (!S.avenues) S.avenues = { routes: res.avenues };
    renderMfdList();
    refresh();
  };

  const runRoute = async () => {
    if (!needMarkers('a', 'b')) return;
    const mode = $('routeMode').value;
    if (mode !== 'fastest' && !S.markers.threat) toast('No enemy position set — the route avoids skylines but cannot assess enemy observation.', false, 6000);
    await syncSettings();
    const profile = $('routeProfile').value;
    const res = await run(`Route A→B · ${mode}`, 'route', {
      a: S.markers.a, b: S.markers.b, profile, mode, alternatives: +$('routeAlt').value, cpEveryM: +$('routeCP').value,
    }, (r) => r.routes.map((x, k) => `R${k + 1} ${fmtKm(x.lengthM)} · ${fmtH(x.timeH)} · ↑${Math.round(x.ascentM)} m`).join('\n'));
    S.routes = { routes: res.routes, sel: 0, profile, mode };
    S.picquets = null;
    renderRouteList();
    showRouteProfile();
    refresh();
  };

  const runPicquets = async () => {
    if (!S.routes) { toast('Find a route first.', true); return; }
    const rt = S.routes.routes[S.routes.sel || 0];
    const res = await run('Picquets', 'picquets', {
      path: Array.from(rt.path), rangeM: +$('pqRange').value, count: +$('pqCount').value || 0,
    }, (r) => `${r.picquets.length} picquets · ${Math.round(r.routeCoverage * 100)}% of route observed`);
    S.picquets = res;
    renderPicquetList();
    refresh();
  };

  const runLOS = async (a, b) => {
    const res = await run('Line of sight', 'los', { a, b, obsH: +$('losObs').value, tgtH: +$('losTgt').value },
      (r) => `${r.visible ? 'VISIBLE' : 'MASKED'} · ${fmtKm(r.distance)}`);
    S.los = { a, b, res };
    const blk = res.blockIndex >= 0 ? res.profile[res.blockIndex] : null;
    $('losInfo').innerHTML = (res.visible ? '<b style="color:#3ddc66">VISIBLE</b>' : `<b style="color:#ff6b5f">MASKED</b> by ground at ${fmtKm(blk.d)} (${M.cellMGRS(S.grid, blk.r, blk.c, 4)})`) +
      ` · range ${fmtKm(res.distance)} · ${res.visible ? `min clearance ${res.clearance.toFixed(0)} m` : ''}`;
    openDrawer(`Line of sight — ${res.visible ? 'visible' : 'masked'} · ${fmtKm(res.distance)}`, { profile: res.profile, blockIndex: res.blockIndex });
    refresh();
  };

  const runViewshed = async (p) => {
    const res = await run('Viewshed', 'viewshed', { p, obsH: +$('vsObs').value, tgtH: +$('vsTgt').value, radiusM: +$('vsRadius').value },
      (r) => `${r.visibleKm2.toFixed(1)} km² visible from ${M.cellMGRS(S.grid, p.r, p.c, 4)}`);
    S.vsPoint = p;
    setOverlay('viewshed', res.mask);
    $('vsInfo').innerHTML = `Visible area <b>${res.visibleKm2.toFixed(1)} km²</b> within ${fmtKm(+$('vsRadius').value)} of <code>${M.cellMGRS(S.grid, p.r, p.c, 4)}</code>.`;
    refresh({ base: true });
  };

  // =================================================================== selection & lists
  const select = (ref, fromList) => {
    S.sel = ref;
    renderAllLists();
    renderSelection();
    const pos = posOf(ref);
    if (fromList && pos) {
      if (S.view === '3d') v3.lookAtCell(pos.c, pos.r);
      else map.centerOn(pos.c, pos.r, Math.max(map.view.scale, 2));
    }
    const el = document.querySelector('.item.sel');
    if (el && !fromList) {
      const panel = el.closest('.panel');
      if (panel) showTab(panel.dataset.panel);
      el.scrollIntoView({ block: 'nearest' });
    }
    refresh({ legend: false });
  };
  const posOf = (ref) => {
    switch (ref.kind) {
      case 'post': return S.posts && S.posts.posts[ref.idx];
      case 'weapon': return S.weapons[ref.idx] && S.weapons[ref.idx].sites[ref.sub];
      case 'mfd': return S.mfd && S.mfd.fields[ref.idx];
      case 'picquet': return S.picquets && S.picquets.picquets[ref.idx];
      case 'key': return S.key && (ref.sub === 'pass' ? S.key.passes : S.key.peaks)[ref.idx];
      default: return null;
    }
  };
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    toast(`Copied: ${text.length > 60 ? text.slice(0, 60) + '…' : text}`, false, 2200);
  };

  /** Right pane: metadata of the selected feature with copy / zoom / viewshed actions. */
  const renderSelection = () => {
    const el = $('selBody');
    const ref = S.sel;
    const p = ref && posOf(ref);
    if (!p || !S.grid) { el.innerHTML = '<p class="hint">Click a symbol on the map or an item in a list.</p>'; return; }
    const g = S.grid;
    const ll = M.cellToLatLon(g, p.r, p.c);
    const mgrs = M.cellMGRS(g, p.r, p.c, 5);
    let icon = '', title = '', sub = '';
    const rows = [['MGRS', mgrs], ['Lat / Lon', M.toDMS(ll.lat, ll.lon)], ['Elevation', `${Math.round(M.sample(g, S.L.z, p.r, p.c))} m`]];
    if (ref.kind === 'post') {
      const P = S.posts;
      icon = UI.symbolHTML(P.mode === 'op' ? UI.SYM.op() : UI.SYM.post(P.echelon), 30);
      title = p.id; sub = P.mode === 'op' ? 'Observation post (planned)' : `Defended post — ${P.echelon} (planned)`;
      const mates = P.links.filter((l) => l[0] === ref.idx || l[1] === ref.idx).map((l) => P.posts[l[0] === ref.idx ? l[1] : l[0]].id);
      rows.push(['Landform', p.landform.split(' (')[0]], ['Visible area', `${p.visibleKm2.toFixed(1)} km²`], ['Approach coverage', `${(p.valueShare * 100).toFixed(1)} %`],
        ['Access on foot', fmtH(p.accessH)], ['Intervisible with', mates.join(', ') || 'none']);
    } else if (ref.kind === 'weapon') {
      const res = S.weapons[ref.idx];
      icon = UI.symbolHTML(UI.SYM.weapon(res.weapon), 30);
      title = p.id; sub = res.weapon.name;
      if (p.cat === 'indirect') {
        rows.push(['Range to target', fmtKm(p.rangeToTargetM)], ['Bearing', `${mils(p.bearingDeg)} mils`], ['Quadrant elevation', p.qeDeg === null ? '—' : `${mils(p.qeDeg)} mils (${p.qeDeg.toFixed(1)}°)`],
          ['Trajectory', p.angleMode || '—'], ['Crest clearance', `${Math.round(p.clearShare * 100)} % of target area`],
          ['Enemy observation', p.hidden ? 'hidden (defilade)' : `seen by ${p.hostileCount} OP(s)`], ['Range band', `${p.minR}–${p.maxR} m`]);
      } else {
        rows.push(['Arc of fire', `${mils(p.sector.left)} – ${mils(p.sector.right)} mils`], ['Principal direction', `${mils(p.sector.mean)} mils`],
          ['Mean range', fmtKm(p.meanRangeM)], ['Target ground covered', `${(p.valueShare * 100).toFixed(1)} %`], ['Range band', `${p.minR}–${p.maxR} m`]);
      }
      rows.push(['Landform', p.landform.split(' (')[0]], ['Access', fmtH(p.accessH)]);
    } else if (ref.kind === 'mfd') {
      icon = UI.symbolHTML(UI.SYM.mine(p.type), 26);
      title = p.id; sub = `${p.type === 'AT' ? 'Anti-tank' : 'Anti-personnel'} minefield (planned)`;
      rows.push(['Gap at defile', `${Math.round(p.gapM)} m`], ['Front × depth', `${Math.round(p.frontM)} × ${Math.round(p.depthM)} m`],
        ['Orientation', `${mils(p.orientationDeg)} mils`], ['Est. mines', `≈ ${p.estMines}`], ['On avenues', p.onAvenues.length ? 'AA ' + p.onAvenues.join(', ') : '—'],
        ['Observed / covered', p.covered ? 'yes' : 'NO — site OP or weapon']);
    } else if (ref.kind === 'picquet') {
      icon = UI.symbolHTML(UI.SYM.picquet(), 30);
      title = p.id; sub = 'Route picquet (section, planned)';
      rows.push(['Protects route', p.routeFromKm === null ? '—' : `km ${p.routeFromKm.toFixed(1)} – ${p.routeToKm.toFixed(1)}`], ['Climb from route', fmtH(p.climbH)]);
    } else if (ref.kind === 'key') {
      icon = ref.sub === 'pass' ? '<b style="font:700 18px Georgia;color:var(--accent)">)(</b>' : '<b style="font-size:18px;color:var(--accent)">▲</b>';
      title = ref.sub === 'pass' ? `Col ${ref.idx + 1}` : `H${ref.idx + 1}`;
      sub = ref.sub === 'pass' ? 'Pass / saddle — likely crossing point' : 'Dominating height';
      if (p.prominence) rows.push(['Local dominance', `+${Math.round(p.prominence)} m`]);
    }
    el.innerHTML = `<div class="sel-head">${icon}<div><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div></div>
      <div class="sel-kv">${rows.map(([k, v]) => `<b>${k}</b><span>${esc(v)}</span>`).join('')}</div>
      <div class="sel-actions"><button class="btn" data-act="copy"><i data-icon="copy"></i>Copy grid</button>
      <button class="btn" data-act="zoom"><i data-icon="zoom"></i>Zoom</button>
      <button class="btn" data-act="vs"><i data-icon="eye"></i>Viewshed</button></div>`;
    UI.applyIcons(el);
    el.querySelector('[data-act=copy]').onclick = () => copyText(mgrs);
    el.querySelector('[data-act=zoom]').onclick = () => (S.view === '3d' ? v3.lookAtCell(p.c, p.r, 3500) : map.centerOn(p.c, p.r, Math.max(map.view.scale, 3)));
    el.querySelector('[data-act=vs]').onclick = safe(() => runViewshed({ c: Math.round(p.c), r: Math.round(p.r) }));
  };

  const isSel = (kind, idx, sub) => S.sel && S.sel.kind === kind && S.sel.idx === idx && (sub === undefined || S.sel.sub === sub);
  const item = (icon, title, right, detail, attrs, sel) =>
    `<div class="item${sel ? ' sel' : ''}" ${attrs}><div class="ic">${icon}</div><div><div class="t"><span>${title}</span><i>${right}</i></div></div><div class="d">${detail}</div></div>`;
  const bindList = (el) => el.querySelectorAll('.item[data-kind]').forEach((n) => n.addEventListener('click', () => {
    const ref = { kind: n.dataset.kind, idx: +n.dataset.idx };
    if (n.dataset.sub !== undefined) ref.sub = isNaN(+n.dataset.sub) ? n.dataset.sub : +n.dataset.sub;
    select(ref, true);
  }));

  const renderKeyList = () => {
    const el = $('keyList');
    if (!S.key) { el.innerHTML = ''; return; }
    const g = S.grid;
    el.innerHTML = S.key.peaks.slice(0, 10).map((p, k) => item('<b style="font-size:16px">▲</b>', `H${k + 1} · ${Math.round(p.z)} m`, M.cellMGRS(g, p.r, p.c, 4),
      `Dominates surroundings by +${Math.round(p.prominence)} m`, `data-kind="key" data-idx="${k}" data-sub="peak"`, isSel('key', k, 'peak'))).join('') +
      S.key.passes.map((p, k) => item('<b style="font-size:15px;font-family:Georgia">)(</b>', `Col ${k + 1} · ${Math.round(p.z)} m`, M.cellMGRS(g, p.r, p.c, 4),
        'Pass / saddle — likely crossing point', `data-kind="key" data-idx="${k}" data-sub="pass"`, isSel('key', k, 'pass'))).join('');
    bindList(el);
  };

  const renderPostList = () => {
    const el = $('postList');
    if (!S.posts) { el.innerHTML = ''; return; }
    const P = S.posts, g = S.grid;
    el.innerHTML = `<div class="hint">Coverage of likely enemy movement ground: <b>${(P.coverageShare * 100).toFixed(0)}%</b> · intervisible pairs: ${P.links.length}</div>` +
      P.posts.map((p, k) => item(UI.symbolHTML(P.mode === 'op' ? UI.SYM.op() : UI.SYM.post(P.echelon), 26), `${p.id} · ${Math.round(p.z)} m`, M.cellMGRS(g, p.r, p.c, 4),
        `Sees ${p.visibleKm2.toFixed(1)} km² · ${(p.valueShare * 100).toFixed(1)}% of approaches · ${esc(p.landform.split(' (')[0])}${p.accessH !== null ? ` · ${fmtH(p.accessH)} on foot` : ''}`,
        `data-kind="post" data-idx="${k}"`, isSel('post', k))).join('');
    bindList(el);
  };

  const renderWeaponList = () => {
    const el = $('wpnList');
    const g = S.grid;
    el.innerHTML = S.weapons.map((res, wi) => `<div class="hint"><b>${esc(res.weapon.name)}</b>${res.accessRelaxed ? ' <span class="warn">(access relaxed)</span>' : ''}</div>` +
      res.sites.map((s, k) => {
        const d = s.cat === 'indirect'
          ? `Range ${fmtKm(s.rangeToTargetM)} @ ${mils(s.bearingDeg)} mils · QE ${s.qeDeg === null ? '—' : mils(s.qeDeg)} mils (${s.angleMode}) · crest clear ${Math.round(s.clearShare * 100)}% · ${s.hidden ? 'hidden from enemy OPs' : `<span class="warn">seen by ${s.hostileCount} enemy OP(s)</span>`}`
          : `Arc ${mils(s.sector.left)}–${mils(s.sector.right)} mils · PDF ${mils(s.sector.mean)} · mean range ${fmtKm(s.meanRangeM)} · covers ${(s.valueShare * 100).toFixed(1)}%`;
        return item(UI.symbolHTML(UI.SYM.weapon(res.weapon), 24), `${s.id} · ${Math.round(s.z)} m`, M.cellMGRS(g, s.r, s.c, 4), d,
          `data-kind="weapon" data-idx="${wi}" data-sub="${k}"`, isSel('weapon', wi, k));
      }).join('')).join('');
    bindList(el);
  };

  const renderMfdList = () => {
    const el = $('mfdList');
    if (!S.mfd) { el.innerHTML = ''; return; }
    const g = S.grid;
    el.innerHTML = S.mfd.fields.map((f, k) => item(UI.symbolHTML(UI.SYM.mine(f.type), 22), `${f.id} · ${f.type}`, M.cellMGRS(g, f.r, f.c, 4),
      `Gap ${Math.round(f.gapM)} m · front ${Math.round(f.frontM)} × ${Math.round(f.depthM)} m · ≈${f.estMines} mines · ${f.onAvenues.length ? 'AA ' + f.onAvenues.join(',') : 'off avenue'} · ${f.covered ? 'observed' : '<span class="warn">not observed — site an OP / weapon</span>'}`,
      `data-kind="mfd" data-idx="${k}"`, isSel('mfd', k))).join('');
    bindList(el);
  };

  const renderRouteList = () => {
    const el = $('routeList');
    if (!S.routes) { el.innerHTML = ''; return; }
    el.innerHTML = S.routes.routes.map((rt, k) => item(`<b style="color:#27d3ff;font-size:14px">R${k + 1}</b>`, `${fmtKm(rt.lengthM)} · ${fmtH(rt.timeH)}`, k === (S.routes.sel || 0) ? 'selected' : '',
      `↑${Math.round(rt.ascentM)} m ↓${Math.round(rt.descentM)} m · max grade ${rt.maxGradeDeg.toFixed(0)}° · slow-go ${Math.round(rt.slowFrac * 100)}% · exposed ${Math.round(rt.exposedFrac * 100)}% · top ${Math.round(rt.highestM)} m · ${rt.checkpoints.length} CKP`,
      `data-route="${k}"`, k === (S.routes.sel || 0))).join('');
    el.querySelectorAll('[data-route]').forEach((n) => n.addEventListener('click', () => {
      S.routes.sel = +n.dataset.route; S.picquets = null; renderRouteList(); renderPicquetList(); showRouteProfile(); refresh();
    }));
  };

  const renderPicquetList = () => {
    const el = $('pqList');
    if (!S.picquets) { el.innerHTML = ''; return; }
    const g = S.grid;
    el.innerHTML = `<div class="hint">Route under observation: <b>${Math.round(S.picquets.routeCoverage * 100)}%</b></div>` +
      S.picquets.picquets.map((p, k) => item(UI.symbolHTML(UI.SYM.picquet(), 24), `${p.id} · ${Math.round(p.z)} m`, M.cellMGRS(g, p.r, p.c, 4),
        `Protects km ${p.routeFromKm === null ? '—' : `${p.routeFromKm.toFixed(1)}–${p.routeToKm.toFixed(1)}`} · climb ${fmtH(p.climbH)}`,
        `data-kind="picquet" data-idx="${k}"`, isSel('picquet', k))).join('');
    bindList(el);
  };

  const renderAllLists = () => { renderKeyList(); renderPostList(); renderWeaponList(); renderMfdList(); renderRouteList(); renderPicquetList(); };

  const renderSituation = () => {
    const g = S.grid, mk = S.markers;
    const parts = [];
    if (mk.own) parts.push(`Own <code>${M.cellMGRS(g, mk.own.r, mk.own.c, 4)}</code>`);
    if (mk.threat) parts.push(`Enemy <code>${M.cellMGRS(g, mk.threat.r, mk.threat.c, 4)}</code>`);
    if (mk.own && mk.threat) {
      const dc = mk.threat.c - mk.own.c, dr = mk.threat.r - mk.own.r;
      parts.push(`threat at ${fmtKm(Math.hypot(dc, dr) * g.cs)}, ${mils(M.bearing(dc, -dr))} mils`);
    }
    $('sitInfo').innerHTML = parts.join(' · ');
  };

  const showRouteProfile = () => {
    if (!S.routes) return;
    const rt = S.routes.routes[S.routes.sel || 0];
    const markers = rt.checkpoints.map((c, k) => ({ d: c.d, label: `CKP ${k + 1}` }));
    openDrawer(`Route R${(S.routes.sel || 0) + 1} — ${M.MOVEMENT_PROFILES[S.routes.profile].name} · ${fmtKm(rt.lengthM)} · ${fmtH(rt.timeH)}`,
      { profile: rt.profile, gradeColors: true, markers });
  };

  const openDrawer = (title, data) => {
    $('drawer').hidden = false;
    $('drawerTitle').textContent = title;
    UI.drawProfile($('chart'), data);
    S.drawerData = data;
  };

  // =================================================================== panels
  const showTab = (name) => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === name));
  };

  const renderDataInfo = () => {
    const g = S.grid, st = S.stats;
    const kv = (k, v) => `<b>${k}</b><span>${v}</span>`;
    $('demInfo').innerHTML = [
      kv('Name', esc(g.name)), kv('Projection', `WGS 84 / UTM ${g.zone}${g.north ? 'N' : 'S'}`), kv('Cell size', `${g.cs} m`),
      kv('Grid', `${g.w} × ${g.h}`), kv('Extent', `${st.widthKm.toFixed(1)} × ${st.heightKm.toFixed(1)} km`), kv('Area', `${st.areaKm2.toFixed(0)} km²`),
      kv('NW corner', M.cellMGRS(g, 0, 0, 4)), kv('SE corner', M.cellMGRS(g, g.h - 1, g.w - 1, 4)),
      kv('Elevation', `${Math.round(st.elevMin)} – ${Math.round(st.elevMax)} m`), kv('Mean / relief', `${Math.round(st.elevMean)} / ${Math.round(st.relief)} m`),
      kv('Slope mean / max', `${st.slopeMean.toFixed(1)}° / ${st.slopeMax.toFixed(0)}°`),
    ].join('');
    const box = $('demCharts');
    box.innerHTML = '<canvas id="chHyp"></canvas><canvas id="chSlope"></canvas><canvas id="chRose"></canvas>';
    const hb = st.hypsometry.bins;
    UI.drawBars($('chHyp'), `Hypsometry (${Math.round(st.elevMin)}–${Math.round(st.elevMax)} m)`, hb.map((v, k) => ({ v, color: '#b08a58', label: k % 6 === 0 ? String(Math.round(st.elevMin + (k / hb.length) * st.relief)) : '' })));
    const cl = M.SLOPE_CLASSES;
    UI.drawBars($('chSlope'), 'Slope classes (share of area)', st.slopeHist.map((v, k) => ({ v, color: UI.SLOPE_COLORS[k], label: k === cl.length - 2 ? `>${cl[k]}°` : `${cl[k]}–${cl[k + 1]}` })));
    UI.drawRose($('chRose'), st.aspectRose);
  };

  const renderLayersPanel = () => {
    const ol = $('overlayList');
    ol.innerHTML = Object.entries(S.overlays).map(([id, o]) => `<div class="lrow${o.data ? '' : ' dis'}">
      <label><input type="checkbox" data-ov="${id}" ${o.visible ? 'checked' : ''} ${o.data ? '' : 'disabled'}> ${o.name}</label>
      <input type="range" min="0.1" max="1" step="0.05" value="${o.opacity}" data-op="${id}" ${o.data ? '' : 'disabled'}></div>`).join('');
    ol.querySelectorAll('[data-ov]').forEach((n) => n.addEventListener('change', () => { S.overlays[n.dataset.ov].visible = n.checked; refresh({ base: true }); }));
    ol.querySelectorAll('[data-op]').forEach((n) => n.addEventListener('input', () => { S.overlays[n.dataset.op].opacity = +n.value; refresh({ base: true, legend: false }); }));
    const feats = [['symbols', 'NATO symbols'], ['key', 'Key terrain (heights, passes)'], ['posts', 'Posts / OPs'], ['weapons', 'Weapon sites & arcs'], ['mfd', 'Minefields'],
      ['routes', 'Routes'], ['avenues', 'Enemy avenues'], ['picquets', 'Picquets'], ['hostileOps', 'Likely enemy OPs']];
    const fl = $('featureList');
    fl.innerHTML = feats.map(([k, n]) => `<div class="lrow"><label><input type="checkbox" data-f="${k}" ${S.show[k] ? 'checked' : ''}> ${n}</label><span></span></div>`).join('');
    fl.querySelectorAll('[data-f]').forEach((n) => n.addEventListener('change', () => { S.show[n.dataset.f] = n.checked; refresh(); }));
  };

  const updateMarkerButtons = () => {
    for (const [k, id] of [['own', 'btnOwn'], ['threat', 'btnThreat'], ['target', 'btnTarget'], ['a', 'btnA'], ['b', 'btnB']]) $(id).classList.toggle('set', !!S.markers[k]);
    $('symOwn').innerHTML = UI.symbolHTML(UI.SYM.own(S.ownEchelon), 18);
    $('symThreat').innerHTML = UI.symbolHTML(UI.SYM.threat(S.threatType), 16);
    $('symTarget').innerHTML = UI.symbolHTML(UI.SYM.target(), 18);
    $('symA').innerHTML = UI.symbolHTML(UI.SYM.sp(), 13);
    $('symB').innerHTML = UI.symbolHTML(UI.SYM.rp(), 13);
  };

  const fillProfileInputs = () => {
    const p = profileFor($('mobProfile').value);
    $('mobGo').value = p.go; $('mobSlow').value = p.slow;
  };

  const renderWeaponParams = () => {
    const w = selectedWeapon();
    $('wpnParams').innerHTML = `<label>Min range (m)<input type="number" id="wpMin" value="${w.minR}" step="50" min="0"></label>
      <label>Max / effective range (m)<input type="number" id="wpMax" value="${w.maxR}" step="100" min="100"></label>
      <label>Max site slope (deg)<input type="number" id="wpSlope" value="${w.siteSlope}" step="1" min="1" max="45"></label>
      <label>Access needed<input value="${M.MOVEMENT_PROFILES[w.access].name.split(' (')[0]}" disabled></label>`;
    for (const [id, key] of [['wpMin', 'minR'], ['wpMax', 'maxR'], ['wpSlope', 'siteSlope']]) {
      $(id).addEventListener('change', (e) => {
        const o = (S.weaponOverrides[w.id] = S.weaponOverrides[w.id] || {});
        o[key] = +e.target.value;
      });
    }
  };

  // =================================================================== view switching
  const setView = (v) => {
    if (v === '3d' && !v3.ok) { toast('WebGL2 is not available in this browser — 3D view disabled.', true); return; }
    S.view = v;
    $('btn2d').classList.toggle('on', v === '2d'); $('btn3d').classList.toggle('on', v === '3d');
    $('map2d').hidden = v !== '2d'; $('gl3d').hidden = v !== '3d'; $('ovl3d').hidden = v !== '3d';
    v3.visible = v === '3d';
    if (v === '3d') {
      v3.resize();
      if (S.texDirty) updateTexture(true);
      v3.render();
    } else { v3.stopFly(); map.resize(); }
  };

  // =================================================================== plan save / load
  const savePlanObject = () => {
    if (!S.grid) return null;
    const strip = (o, keys) => { if (!o) return null; const c = Object.assign({}, o); for (const k of keys) delete c[k]; return c; };
    return {
      format: 'mtnai-plan', version: M.VERSION, created: new Date().toISOString(), grid: M.gridMeta(S.grid),
      markers: S.markers, obstacles: S.obstacles, tracks: S.tracks, threatType: S.threatType, ownEchelon: S.ownEchelon,
      profileOverrides: S.profileOverrides, weaponOverrides: S.weaponOverrides, snowLine: S.snowLine,
      key: S.key, posts: strip(S.posts, ['cover', 'dead']), weapons: S.weapons.map((w) => strip(w, ['cover'])),
      mfd: S.mfd, avenues: S.avenues,
      routes: S.routes && Object.assign({}, S.routes, { routes: S.routes.routes.map((r) => strip(r, ['path'])) }),
      picquets: S.picquets,
    };
  };

  const applyPlan = async (plan, opts = {}) => {
    if (!plan || !S.grid) return;
    if (plan.format !== 'mtnai-plan') { toast('Not an MtnAI plan file.', true); return; }
    const p = UI.remapPlan(plan, plan.grid, S.grid);
    const inGrid = (m) => m && m.c >= 0 && m.r >= 0 && m.c < S.grid.w && m.r < S.grid.h;
    S.markers = {};
    for (const k in p.markers || {}) if (inGrid(p.markers[k])) S.markers[k] = { c: Math.round(p.markers[k].c), r: Math.round(p.markers[k].r) };
    Object.assign(S, {
      obstacles: p.obstacles || [], tracks: p.tracks || [], threatType: p.threatType || 'foot', ownEchelon: p.ownEchelon || 'battalion',
      profileOverrides: p.profileOverrides || {}, weaponOverrides: p.weaponOverrides || {}, snowLine: p.snowLine || 0,
    });
    if (!opts.silent || plan.grid.name === S.grid.name) {
      Object.assign(S, { key: p.key || null, posts: p.posts || null, mfd: p.mfd || null, avenues: p.avenues || null, picquets: p.picquets || null });
      S.weapons = (p.weapons || []).map((w) => Object.assign(w, { weapon: M.weapon(w.weapon.id, S.weaponOverrides[w.weapon.id]) }));
      S.routes = p.routes ? Object.assign(p.routes, { routes: p.routes.routes.map((r) => Object.assign(r, { path: null, profile: null })) }) : null;
      if (S.routes) {
        const routes = S.routes.routes;
        const pr = await Promise.all(routes.map((r) => engine.call('profile', { pts: r.line })));
        routes.forEach((r, k) => { r.profile = pr[k].profile; r.path = linePath(r.line); });
      }
    }
    $('threatType').value = S.threatType; $('ownEchelon').value = S.ownEchelon; $('mobSnow').value = S.snowLine;
    await syncSettings();
    updateMarkerButtons(); renderSituation(); renderAllLists();
    $('obsInfo').textContent = S.obstacles.length || S.tracks.length ? `${S.obstacles.length} No-Go area(s), ${S.tracks.length} track(s).` : '';
    refresh({ base: true });
    if (!opts.silent) toast('Plan loaded.');
  };
  /** Rasterise a polyline into a cell-index path (for picquets after loading a plan). */
  const linePath = (line) => {
    const g = S.grid, out = [];
    for (let k = 1; k < line.length; k++) {
      const [c0, r0] = line[k - 1], [c1, r1] = line[k];
      const n = Math.max(1, Math.ceil(Math.hypot(c1 - c0, r1 - r0)));
      for (let s = 0; s <= n; s++) {
        const c = Math.round(c0 + ((c1 - c0) * s) / n), r = Math.round(r0 + ((r1 - r0) * s) / n);
        if (!M.inGrid(g, r, c)) continue;
        const i = r * g.w + c;
        if (out[out.length - 1] !== i) out.push(i);
      }
    }
    return Int32Array.from(out);
  };

  // =================================================================== export
  const snapshot2D = () => {
    const old = Object.assign({}, map.view);
    map.fit(); map.draw();
    const url = $('map2d').toDataURL('image/png');
    map.view = old; map.draw();
    return url;
  };
  const snapshot3D = () => {
    if (!v3.ok || !v3.mesh) return null;
    const wasVisible = v3.visible, cam = JSON.parse(JSON.stringify(v3.cam));
    const gl = $('gl3d');
    const hidden = gl.hidden;
    gl.hidden = false; $('ovl3d').hidden = false;
    v3.visible = true; v3.resize();
    if (S.texDirty) { updateTexture(true); }
    v3.home(); v3.draw();
    const c = document.createElement('canvas');
    c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1b2430'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(gl, 0, 0); ctx.drawImage($('ovl3d'), 0, 0);
    const url = c.toDataURL('image/png');
    v3.cam = cam; v3.visible = wasVisible; gl.hidden = hidden; $('ovl3d').hidden = hidden;
    if (wasVisible) v3.draw();
    return url;
  };

  const doExport = async (kind) => {
    $('exportMenu').classList.remove('open');
    if (!S.grid) { toast('Load a DEM first.', true); return; }
    const base = (S.grid.name || 'mtnai').replace(/[^\w.-]+/g, '_').slice(0, 40);
    if (kind === 'geojson') {
      UI.download(`${base}_plan.geojson`, JSON.stringify(UI.toGeoJSON(S), null, 1), 'application/geo+json');
    } else if (kind === 'asc') {
      const mob = S.overlays.mobility;
      let arr, name, dec = 2;
      if (mob.visible && mob.data) { arr = mob.data; name = `mobility_${mob.profile}`; dec = 0; }
      else {
        const pick = { relief: ['z', 'elevation'], elevation: ['z', 'elevation'], slope: ['slope', 'slope_deg'], aspect: ['aspect', 'aspect_deg'], landform: ['landform', 'landform_class'], tri: ['tri', 'ruggedness_m'] }[S.base];
        arr = S.L[pick[0]]; name = pick[1]; dec = pick[0] === 'landform' ? 0 : 2;
      }
      UI.download(`${base}_${name}.asc`, UI.toASC(S.grid, arr, dec), 'text/plain');
      setTimeout(() => UI.download(`${base}_${name}.prj`, M.utmWKT(S.grid.zone, S.grid.north), 'text/plain'), 300);
      toast(`Exported ${name} as ESRI ASCII grid + .prj (WGS 84 / UTM ${S.grid.zone}).`);
    } else if (kind === 'png') {
      const url = S.view === '3d' ? snapshot3D() : $('map2d').toDataURL('image/png');
      const blob = await (await fetch(url)).blob();
      UI.download(`${base}_${S.view}.png`, blob, 'image/png');
    } else if (kind === 'plan') {
      UI.download(`${base}.mtnai.json`, JSON.stringify(savePlanObject()), 'application/json');
    } else if (kind === 'report') {
      const imgs = [snapshot2D()];
      const i3 = snapshot3D();
      if (i3) imgs.push(i3);
      const html = UI.reportHTML(S, imgs);
      const w = window.open('', '_blank');
      if (!w) { UI.download(`${base}_report.html`, html, 'text/html'); toast('Pop-up blocked — report downloaded as HTML instead.'); return; }
      w.document.open(); w.document.write(html); w.document.close();
    }
  };

  // =================================================================== command palette
  const COMMANDS = [
    ['Load demo terrain', 'data', () => loadDemo()],
    ['Open DEM files…', 'data', () => $('demFiles').click()],
    ['Crop to area of interest', 'data', 'btnAOI'],
    ['Switch to 2D map', 'view', () => setView('2d')],
    ['Switch to 3D terrain', 'view', () => setView('3d')],
    ['Detect key terrain — heights & passes', 'terrain', 'btnKey'],
    ['Compute Go / No-Go mobility', 'mobility', 'btnMob'],
    ['Draw No-Go area (obstacle)', 'mobility', 'btnObstacle'],
    ['Draw track / road', 'mobility', 'btnTrack'],
    ['Place own position', 'tactical', 'btnOwn'],
    ['Place enemy position', 'tactical', 'btnThreat'],
    ['Place target area', 'tactical', 'btnTarget'],
    ['Enemy observation (defilade)', 'tactical', 'btnHostile'],
    ['Enemy avenues of approach', 'tactical', 'btnAvenues'],
    ['Suggest posts / OPs', 'tactical', 'btnPosts'],
    ['Suggest weapon sites', 'tactical', 'btnWeapons'],
    ['Suggest minefields (Mfd)', 'tactical', 'btnMfd'],
    ['Place route start A', 'routes', 'btnA'],
    ['Place route end B', 'routes', 'btnB'],
    ['Find route A → B', 'routes', 'btnRoute'],
    ['Suggest picquets for route', 'routes', 'btnPicquets'],
    ['Fly route in 3D', 'routes', 'btnFly'],
    ['Line of sight', 'tools', 'btnLOS'],
    ['Viewshed from a point', 'tools', 'btnVS'],
    ['Measure distance & bearing', 'tools', 'btnMeasure'],
    ['Export features → GeoJSON', 'export', () => doExport('geojson')],
    ['Export terrain assessment report', 'export', () => doExport('report')],
    ['Export view → PNG', 'export', () => doExport('png')],
    ['Export raster → ASCII grid', 'export', () => doExport('asc')],
    ['Save plan', 'export', () => doExport('plan')],
    ['Toggle output pane', 'view', () => $('btnRight').click()],
    ['Help & doctrine notes', 'help', () => $('btnHelp').click()],
  ];
  let palSel = 0, palItems = [];
  const openPalette = () => {
    $('palette').hidden = false;
    $('palInput').value = '';
    renderPalette();
    $('palInput').focus();
  };
  const closePalette = () => { $('palette').hidden = true; };
  const renderPalette = () => {
    const q = $('palInput').value.toLowerCase().split(/\s+/).filter(Boolean);
    palItems = COMMANDS.filter(([n, grp]) => q.every((w) => (n + ' ' + grp).toLowerCase().includes(w)));
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    $('palList').innerHTML = palItems.map(([n, grp, act], k) => {
      const dis = typeof act === 'string' && $(act).disabled;
      return `<div class="pal-i${k === palSel ? ' on' : ''}${dis ? ' dis' : ''}" data-k="${k}">${UI.icon(grp === 'export' ? 'download' : grp === 'view' ? 'fit' : grp === 'help' ? 'help' : { data: 'data', terrain: 'terrain', mobility: 'mobility', tactical: 'tactical', routes: 'route', tools: 'tools' }[grp], 15)}<span>${n}</span><small>${grp}</small></div>`;
    }).join('') || '<div class="pal-i dis">No matching command</div>';
    $('palList').querySelectorAll('[data-k]').forEach((n) => n.addEventListener('click', () => execCommand(+n.dataset.k)));
    const on = $('palList').querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const execCommand = (k) => {
    const c = palItems[k];
    if (!c) return;
    closePalette();
    const act = c[2];
    if (typeof act === 'function') { act(); return; }
    const b = $(act);
    if (b.disabled) { toast('Load an elevation model first.', true); return; }
    const panel = b.closest('.panel');
    if (panel) showTab(panel.dataset.panel);
    const det = b.closest('details');
    if (det) det.open = true;
    b.click();
  };

  // =================================================================== wiring
  const init = () => {
    UI.applyIcons();
    map = new UI.Map2D($('map2d'), app);
    v3 = new UI.View3D($('gl3d'), $('ovl3d'), app);
    UI.app = { map, v3, S, engine, loadDemo, importFiles, setView, setTool, doExport };
    map.resize();

    // profiles & weapons selects
    const profOpts = Object.values(M.MOVEMENT_PROFILES).map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    $('mobProfile').innerHTML = profOpts; $('routeProfile').innerHTML = profOpts;
    $('wpnSelect').innerHTML = M.WEAPON_GROUPS.map((g) => `<optgroup label="${g.name}">${g.ids.map((id) => `<option value="${id}">${M.WEAPONS[id].name}</option>`).join('')}</optgroup>`).join('');
    fillProfileInputs(); renderWeaponParams(); updateMarkerButtons(); renderLayersPanel();

    // tabs
    document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    // header
    $('btn2d').onclick = () => setView('2d');
    $('btn3d').onclick = () => setView('3d');
    $('btnExport').onclick = (e) => { e.stopPropagation(); $('exportMenu').classList.toggle('open'); };
    document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) $('exportMenu').classList.remove('open'); });
    $('exportMenu').querySelectorAll('[data-export]').forEach((b) => (b.onclick = () => doExport(b.dataset.export)));
    $('planFile').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      $('exportMenu').classList.remove('open');
      if (!f) return;
      if (!S.grid) { toast('Load the DEM first, then the plan.', true); return; }
      try { await applyPlan(JSON.parse(await f.text())); } catch (err) { toast('Could not read plan: ' + err.message, true); }
    };
    $('btnHelp').onclick = () => { $('helpBody').innerHTML = UI.helpHTML(); $('help').showModal(); };
    $('btnPalette').onclick = openPalette;
    $('palette').addEventListener('mousedown', (e) => { if (e.target === $('palette')) closePalette(); });
    $('palInput').addEventListener('input', () => { palSel = 0; renderPalette(); });
    $('palInput').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { palSel = Math.min(palItems.length - 1, palSel + 1); renderPalette(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); renderPalette(); e.preventDefault(); }
      else if (e.key === 'Enter') execCommand(palSel);
      else if (e.key === 'Escape') closePalette();
    });
    // right (output) pane
    $('btnRight').onclick = () => {
      const hide = !$('app').classList.contains('no-right');
      $('app').classList.toggle('no-right', hide);
      $('btnRight').classList.toggle('on', !hide);
      setTimeout(() => { map.resize(); if (S.view === '3d') v3.resize(); }, 240);
    };
    document.querySelectorAll('.rsec > header').forEach((h) => h.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const sec = h.parentElement;
      sec.dataset.open = sec.dataset.open === '1' ? '0' : '1';
    }));
    $('logClear').onclick = () => { $('log').innerHTML = ''; };

    // data
    for (const id of ['demFiles', 'demFiles2']) $(id).onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };
    $('btnDemo').onclick = loadDemo; $('btnDemo2').onclick = loadDemo;
    $('btnAOI').onclick = () => setTool('aoi');
    $('btnAOIReset').onclick = resetAOI;
    const stage = $('stage');
    stage.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    stage.addEventListener('drop', (e) => { e.preventDefault(); importFiles([...e.dataTransfer.files]); });

    // terrain
    document.querySelectorAll('input[name=base]').forEach((n) => n.addEventListener('change', () => { S.base = n.value; refresh({ base: true }); }));
    $('optBlend').onchange = (e) => { S.blend = e.target.checked; refresh({ base: true }); };
    let hsTimer = 0;
    const updSun = () => {
      S.sunAz = +$('optAz').value; S.sunAlt = +$('optAlt').value;
      $('azOut').textContent = `${S.sunAz}°`; $('altOut').textContent = `${S.sunAlt}°`;
      clearTimeout(hsTimer);
      hsTimer = setTimeout(async () => {
        if (!S.grid) return;
        const res = await engine.call('hillshade', { azimuth: S.sunAz, altitude: S.sunAlt, multi: true });
        S.L.hs = res.hs; refresh({ base: true });
      }, 120);
    };
    $('optAz').oninput = updSun; $('optAlt').oninput = updSun;
    $('optVex').oninput = (e) => { S.vex = +e.target.value; $('vexOut').textContent = `${S.vex.toFixed(1)}×`; v3.setExaggeration(S.vex); };
    $('optContours').onchange = (e) => { S.show.contours = e.target.checked; refresh({ base: true }); };
    $('optInterval').onchange = safe(async (e) => {
      S.interval = +e.target.value;
      if (!S.grid) return;
      S.contours = await run('Contours', 'contours', { interval: S.interval }, (r) => `interval ${r.interval} m`);
      refresh({ base: true });
    });
    $('optGrid').onchange = (e) => { S.show.grid = e.target.checked; refresh(); };
    $('optSpot').onchange = (e) => { S.show.key = e.target.checked; refresh(); };
    $('btnKey').onclick = safe(runKey);

    // mobility
    $('mobProfile').onchange = fillProfileInputs;
    const updProfile = () => {
      const id = $('mobProfile').value;
      S.profileOverrides[id] = { go: +$('mobGo').value, slow: Math.max(+$('mobGo').value + 1, +$('mobSlow').value) };
    };
    $('mobGo').onchange = updProfile; $('mobSlow').onchange = updProfile;
    $('mobSnow').onchange = (e) => { S.snowLine = +e.target.value; };
    $('mobGeneral').onchange = (e) => { S.generalize = e.target.checked; };
    $('mobStyle').onchange = (e) => { S.mobStyle = e.target.value; refresh({ base: true }); };
    $('btnMob').onclick = safe(() => computeMobility(false));
    $('btnObstacle').onclick = () => setTool('poly');
    $('btnTrack').onclick = () => setTool('line');
    $('btnClearObs').onclick = safe(() => { S.obstacles = []; S.tracks = []; return onObstaclesChanged(); });

    // tactical
    $('btnOwn').onclick = () => setTool('own');
    $('btnThreat').onclick = () => setTool('threat');
    $('btnTarget').onclick = () => setTool('target');
    $('threatType').onchange = async (e) => { S.threatType = e.target.value; S.avenues = null; clearOverlay('avenues'); updateMarkerButtons(); await syncSettings(); refresh({ base: true }); };
    $('ownEchelon').onchange = (e) => { S.ownEchelon = e.target.value; updateMarkerButtons(); refresh(); };
    $('btnHostile').onclick = safe(runHostile);
    $('btnAvenues').onclick = safe(runAvenues);
    $('btnPosts').onclick = safe(runPosts);
    $('wpnSelect').onchange = renderWeaponParams;
    $('btnWeapons').onclick = safe(runWeapons);
    $('btnClearWeapons').onclick = () => { S.weapons = []; updateWeaponCover(); renderWeaponList(); refresh({ base: true }); };
    $('mfdType').onchange = (e) => {
      const at = e.target.value === 'AT';
      $('mfdGap').value = at ? 600 : 300; $('mfdDepth').value = at ? 100 : 40; $('mfdDensity').value = at ? 1 : 3;
    };
    $('btnMfd').onclick = safe(runMfd);

    // routes
    $('btnA').onclick = () => setTool('a');
    $('btnB').onclick = () => setTool('b');
    $('btnSwapAB').onclick = async () => { [S.markers.a, S.markers.b] = [S.markers.b, S.markers.a]; updateMarkerButtons(); refresh(); };
    $('btnRoute').onclick = safe(runRoute);
    $('btnPicquets').onclick = safe(runPicquets);
    $('btnFly').onclick = () => {
      if (!S.routes) { toast('Find a route first.', true); return; }
      setView('3d');
      if (!v3.ok) return;
      toast('Fly-through — Esc or click to stop.');
      v3.fly(S.routes.routes[S.routes.sel || 0].line);
    };

    // tools
    $('btnLOS').onclick = () => setTool('los');
    $('btnVS').onclick = () => setTool('vs');
    $('btnMeasure').onclick = () => setTool('measure');
    $('btnGoto').onclick = () => {
      const u = M.parseMGRS($('gotoMGRS').value);
      if (!u) { toast('Unrecognised MGRS reference (e.g. 43S DV 1950 5100).', true); return; }
      let { E, N } = u;
      if (u.zone !== S.grid.zone) { const ll = M.fromUTM(E, N, u.zone, u.north); const v = M.toUTM(ll.lat, ll.lon, S.grid.zone); E = v.E; N = v.N; }
      const p = M.enToCell(S.grid, E, N);
      if (!M.inGrid(S.grid, Math.round(p.r), Math.round(p.c))) { toast('That grid reference is outside the loaded DEM.', true); return; }
      S.vsPoint = { c: p.c, r: p.r };
      if (S.view === '3d') v3.lookAtCell(p.c, p.r, 4000); else map.centerOn(p.c, p.r, Math.max(map.view.scale, 3));
      refresh();
    };

    // layers
    $('optSymSize').oninput = (e) => { S.symbolSize = +e.target.value; $('symOut').textContent = `${S.symbolSize} px`; refresh({ legend: false }); };
    $('optLabels').onchange = (e) => { S.show.labels = e.target.checked; refresh(); };

    // map controls & drawer
    $('zoomIn').onclick = () => (S.view === '3d' ? ((v3.cam.dist *= 0.7), v3.render()) : map.zoomAt(map.W / 2, map.H / 2, 1.5));
    $('zoomOut').onclick = () => (S.view === '3d' ? ((v3.cam.dist /= 0.7), v3.render()) : map.zoomAt(map.W / 2, map.H / 2, 1 / 1.5));
    $('zoomFit').onclick = () => (S.view === '3d' ? v3.home() : map.fit());
    $('drawerClose').onclick = () => { $('drawer').hidden = true; };
    new ResizeObserver(() => { if (!$('drawer').hidden && S.drawerData) UI.drawProfile($('chart'), S.drawerData); }).observe($('drawer'));

    // keyboard
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); $('palette').hidden ? openPalette() : closePalette(); return; }
      if (e.target.matches('input, select, textarea')) return;
      if (e.key === '/') { e.preventDefault(); openPalette(); return; }
      if (e.key === 'Escape') { if (v3._flying) v3.stopFly(); if (S.tool) setTool(null); else if (S.draft) { S.draft = null; map.render(); } }
      else if (e.key === '2') setView('2d');
      else if (e.key === '3') setView('3d');
      else if (e.key === 'f' || e.key === 'F') (S.view === '3d' ? v3.home() : map.fit());
      else if (e.key === '?') $('btnHelp').click();
    });
    // auto-load the demo when requested (#demo)
    if (location.hash === '#demo') loadDemo();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
