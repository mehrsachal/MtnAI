/*
 * MtnAI ui — application controller: state, commands, menus, panels, docks and
 * settings application.
 */
(function (UI) {
  'use strict';
  const M = UI.M, cfg = UI.cfg, Settings = UI.Settings, F = UI.F;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;

  // =================================================================== state
  const S = (UI.S = {
    grid: null, L: null, stats: null, sources: null, fullGrid: null,
    base: cfg('map.base'), contours: null,
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
    key: null, posts: null, weapons: [], mfd: null, avenues: null, routes: null, picquets: null, hostile: null, los: null, vsPoint: null, gotoMark: null,
    mobStats: {}, snowLine: 0, generalize: false,
    show: { symbols: true, labels: true, key: true, posts: true, weapons: true, mfd: true, routes: true, avenues: true, picquets: true, hostileOps: true },
    tool: null, draft: null, sel: null, view: '2d', baseCanvas: null, texCanvas: null, texDirty: true,
    sort: { col: 'type', desc: false },
  });
  const engine = new UI.Engine();
  let map, v3;

  // =================================================================== feedback
  let toastTimer = 0;
  const toast = (msg, err = false) => {
    const t = $('toast');
    t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), (err ? 1.6 : 1) * +cfg('ui.toastSec') * 1000);
  };
  let busyCount = 0;
  const busy = (on, msg) => {
    busyCount = Math.max(0, busyCount + (on ? 1 : -1));
    const b = busyCount > 0;
    document.body.classList.toggle('busy', b);
    $('stageBar').hidden = !b;
    if (on) { $('busyMsg').textContent = msg || 'Working…'; progress(0); }
    if (!b) { $('busyMsg').textContent = 'Ready'; $('busyBar').style.width = '0%'; }
  };
  const progress = (p, msg) => {
    const w = `${Math.round(Math.min(1, p || 0) * 100)}%`;
    $('busyBar').style.width = w; $('stageBarFill').style.width = w;
    if (msg) $('busyMsg').textContent = msg;
  };
  /** Activity table row: returns {done(detail), fail(message)}. */
  const logStart = (label) => {
    const tr = document.createElement('tr');
    const t = new Date().toTimeString().slice(0, 8);
    tr.innerHTML = `<td>${t}</td><td>${esc(label)}<small></small></td><td>…</td><td class="run">running</td>`;
    $('log').tBodies[0].prepend(tr);
    const t0 = performance.now();
    const end = (cls, txt, detail) => {
      tr.cells[2].textContent = `${((performance.now() - t0) / 1000).toFixed(1)}s`;
      tr.cells[3].className = cls; tr.cells[3].textContent = txt;
      if (detail) tr.cells[1].querySelector('small').textContent = detail;
    };
    return { done: (d) => end('ok', 'done', d), fail: (d) => end('err', 'failed', d) };
  };
  UI.jobSeq = 0;
  const run = async (label, cmd, args, summarize) => {
    busy(true, label);
    const entry = logStart(label);
    try {
      const res = await engine.call(cmd, args, progress);
      entry.done(summarize ? summarize(res) : '');
      return res;
    } catch (e) {
      entry.fail(e.message);
      toast(e.message, true);
      throw e;
    } finally { busy(false); UI.jobSeq++; }
  };
  const safe = (fn) => (...a) => Promise.resolve().then(() => fn(...a)).catch((e) => console.debug('MtnAI:', e.message));

  // =================================================================== settings → engine
  const analysisConfig = () => ({
    curvature: cfg('an.curvature'), refraction: +cfg('an.refraction'), altStart: +cfg('an.altStart'), altRate: +cfg('an.altRate') / 100,
    routeNeighbours: +cfg('an.routeNeighbours'), altSepM: +cfg('an.altSepM'), expBalanced: +cfg('an.expBalanced'), expCovered: +cfg('an.expCovered'),
    skyCovered: +cfg('an.skyCovered'), hostileCount: +cfg('an.hostileCount'), hostileSearchM: +cfg('an.hostileSearchM'),
    hostileRangeM: +cfg('an.hostileRangeM'), hostileObsH: +cfg('an.hostileObsH'), mfdTieM: +cfg('an.mfdTieM'),
    tpiSmallM: +cfg('an.tpiSmallM'), tpiLargeM: +cfg('an.tpiLargeM'),
  });
  const pushConfig = () => { const c = analysisConfig(); M.setConfig(c); return engine.call('config', c); };
  const syncSettings = () => engine.call('settings', {
    own: S.markers.own || null, threat: S.markers.threat || null, target: S.markers.target || null, threatProfile: S.threatType,
    obstacles: S.obstacles, tracks: S.tracks, profiles: cfg('profiles') || {}, snowLine: S.snowLine, generalize: S.generalize,
  });
  const weaponOf = (id) => M.weapon(id, (cfg('weapons') || {})[id]);
  const profileOf = (id) => Object.assign({}, M.MOVEMENT_PROFILES[id], (cfg('profiles') || {})[id] || {});

  // =================================================================== DEM loading
  const loadGrid = async (grid, opts = {}) => {
    busy(true, 'Analysing terrain…');
    const entry = logStart(`Load DEM — ${grid.name}`);
    try {
      await pushConfig();
      const meta = M.gridMeta(grid);
      const res = await engine.call('init', { grid: Object.assign({}, meta, { z: grid.z }) }, progress);
      S.grid = meta;
      S.L = { z: res.z, slope: res.slope, aspect: res.aspect, landform: res.landform, tri: res.tri, tpiL: res.tpiL, hs: res.hs };
      S.stats = res.stats;
      S.sources = opts.sources || null;
      if (opts.full) S.fullGrid = opts.full;
      Object.assign(S, { key: null, posts: null, weapons: [], mfd: null, avenues: null, routes: null, picquets: null, hostile: null, los: null, vsPoint: null, gotoMark: null, sel: null, mobStats: {}, draft: null });
      for (const o of Object.values(S.overlays)) { o.data = null; o.rgba = null; o.visible = false; }
      if (!opts.keepPlan) { S.markers = {}; S.obstacles = []; S.tracks = opts.tracks || []; }
      if (opts.markers) for (const k in opts.markers) S.markers[k] = snapLowSlope(opts.markers[k]);
      await recomputeHillshade(true);
      progress(0.9, 'Contours');
      S.contours = await engine.call('contours', { interval: +cfg('map.contourInterval'), majorEvery: +cfg('map.contourIndex') });
      await syncSettings();
      $('welcome').hidden = true;
      $('demName').textContent = `${meta.name} — ${meta.w} × ${meta.h} cells @ ${meta.cs} m`;
      document.querySelectorAll('[data-need]').forEach((b) => (b.disabled = false));
      $('gotoBox').disabled = false;
      $('btnAOIReset').disabled = !(S.sources || S.fullGrid);
      composeBase();
      map.fit();
      if (v3.ok) { v3.setTerrain(S.grid, S.L.z); v3.setExaggeration(+cfg('v3.vex')); updateTexture(true); }
      renderAll();
      if (S.tracks.length) $('obsInfo').textContent = `${S.tracks.length} track(s) digitised.`;
      entry.done(`${meta.w}×${meta.h} @ ${meta.cs} m · ${F.analysisCRSName()} · ${F.elev(res.stats.elevMin)}–${F.elev(res.stats.elevMax)}`);
    } catch (e) {
      console.error(e);
      entry.fail(e.message);
      toast('Could not load DEM: ' + e.message, true);
    } finally { busy(false); UI.jobSeq++; }
  };

  const loadDemo = () => {
    busy(true, 'Generating synthetic training area…');
    setTimeout(async () => {
      try {
        const syn = M.syntheticTerrain();
        await loadGrid(syn.grid, { markers: syn.markers, full: syn.grid, tracks: syn.tracks });
        toast('Synthetic training area loaded (fictional terrain, UTM 43N). Own, enemy and target positions are pre-placed.');
      } finally { busy(false); }
    }, 20);
  };

  const importOpts = (aoi) => {
    const z = cfg('crs.zone');
    return {
      maxCells: +cfg('data.maxCells'), resample: cfg('data.resample'), cs: +cfg('data.cellSize') || undefined, aoi,
      zone: z === 'auto' ? (aoi && S.grid ? S.grid.zone : undefined) : +z,
    };
  };
  /** Apply the hemisphere setting to a freshly built grid (northings are unchanged for N; S adds the false northing). */
  const withHemisphere = (g) => {
    const h = cfg('crs.hemisphere');
    if (h === 'auto' || (h === 'N') === g.north) return g;
    return Object.assign(g, { north: h === 'N', y0: g.y0 + (h === 'S' ? 10000000 : -10000000) });
  };

  const importFiles = async (files) => {
    if (!files || !files.length) return;
    busy(true, 'Reading DEM files…');
    try {
      const zone = /^(\d{1,2})\s*([NS])?$/i.exec(String(cfg('data.ascZone')).trim());
      const opts = { ascUtm: zone ? { zone: +zone[1], north: (zone[2] || 'N').toUpperCase() === 'N' } : null };
      const sources = [];
      for (const f of files) {
        progress(sources.length / files.length, `Reading ${f.name}`);
        sources.push(...(await M.parseDEMFile(f.name, await f.arrayBuffer(), opts)));
      }
      progress(0.8, 'Resampling into the analysis grid');
      await new Promise((r) => setTimeout(r, 20));
      const grid = withHemisphere(M.buildGrid(sources, importOpts()));
      await loadGrid(grid, { sources });
      toast(`Loaded ${sources.length} source(s) → ${grid.w} × ${grid.h} cells at ${grid.cs} m (${F.analysisCRSName()}).`);
    } catch (e) {
      console.error(e);
      toast(e.message, true);
    } finally { busy(false); }
  };

  const cropAOI = async (p, q) => {
    const g = S.grid;
    const a = M.cellToEN(g, Math.min(p[1], q[1]), Math.min(p[0], q[0])), b = M.cellToEN(g, Math.max(p[1], q[1]), Math.max(p[0], q[0]));
    const aoi = { E0: a.E, N1: a.N, E1: b.E, N0: b.N };
    if (aoi.E1 - aoi.E0 < 10 * g.cs || aoi.N1 - aoi.N0 < 10 * g.cs) { toast('Area too small.', true); return; }
    const plan = savePlanObject();
    let grid;
    if (S.sources) grid = M.buildGrid(S.sources, Object.assign(importOpts(aoi), { zone: g.zone }));
    else {
      const src = S.fullGrid || Object.assign({}, g, { z: S.L.z });
      const cs = Math.max(src.cs / 2, Math.sqrt(((aoi.E1 - aoi.E0) * (aoi.N1 - aoi.N0)) / +cfg('data.maxCells')));
      grid = M.resampleGrid(src, aoi.E0, aoi.N1, aoi.E1, aoi.N0, Math.ceil(cs));
    }
    await loadGrid(grid, { sources: S.sources });
    await applyPlan(plan, { silent: true });
  };

  const resetAOI = async () => {
    const plan = savePlanObject();
    if (S.sources) await loadGrid(withHemisphere(M.buildGrid(S.sources, importOpts())), { sources: S.sources });
    else if (S.fullGrid) await loadGrid(S.fullGrid, { full: S.fullGrid });
    await applyPlan(plan, { silent: true });
  };

  /** Rebuild the grid (new analysis zone or terrain scales) keeping the plan. */
  const reloadTerrain = async (why) => {
    if (!S.grid) return;
    const plan = savePlanObject();
    if (S.sources) await loadGrid(withHemisphere(M.buildGrid(S.sources, importOpts())), { sources: S.sources });
    else await loadGrid(Object.assign({}, S.grid, { z: S.L.z }), { full: S.fullGrid });
    await applyPlan(plan, { silent: true });
    toast(`Terrain re-analysed (${why}).`);
  };

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

  const recomputeHillshade = async (quiet) => {
    if (!S.grid) return;
    const res = await engine.call('hillshade', { azimuth: +cfg('map.hsAzimuth'), altitude: +cfg('map.hsAltitude'), zFactor: +cfg('map.hsZ'), multi: cfg('map.hsMulti') });
    S.L.hs = res.hs;
    if (!quiet) refresh({ base: true });
  };

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
    const rgb = (k) => UI.hexRGB(cfg(k));
    switch (id) {
      case 'mobility': o.rgba = UI.colorClasses(o.data, UI.mobPalette()); break;
      case 'hostile': o.rgba = UI.colorMask(o.data, rgb('ovl.hostileColor'), 0.36); break;
      case 'avenues': o.rgba = UI.colorDensity(o.data, rgb('sym.avenueColor'), 0.5); break;
      case 'cover': o.rgba = UI.colorCount(o.data, [[150, 230, 140, 0.35], [60, 190, 90, 0.45], [20, 130, 60, 0.55]]); break;
      case 'wcover': o.rgba = UI.colorMask(o.data, rgb('ovl.fireColor'), 0.38); break;
      case 'dead': o.rgba = UI.colorMask(o.data, rgb('ovl.deadColor'), 0.5); break;
      case 'viewshed': o.rgba = UI.colorMask(o.data, rgb('ovl.viewshedColor'), 0.42); break;
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
    ctx.drawImage(putSmall(UI.colorBase(S.base, S.L, S.stats, +cfg('map.blend'))), 0, 0, tex.width, tex.height);
    const tmp = document.createElement('canvas');
    tmp.width = tex.width; tmp.height = tex.height;
    const tctx = tmp.getContext('2d');
    for (const id of ['mobility', 'hostile', 'avenues', 'cover', 'wcover', 'dead', 'viewshed']) {
      const o = S.overlays[id];
      if (!o.visible || !o.data) continue;
      ctx.globalAlpha = o.opacity;
      if (id === 'mobility' && cfg('ovl.mobStyle') === 'hatch') {
        const pal = UI.mobPalette();
        for (const klass of [1, 2]) {
          const mask = new Uint8ClampedArray(o.data.length * 4);
          for (let i = 0; i < o.data.length; i++) if (o.data[i] === klass) mask[i * 4 + 3] = 255;
          tctx.globalCompositeOperation = 'source-over';
          tctx.clearRect(0, 0, tmp.width, tmp.height);
          tctx.imageSmoothingEnabled = false;
          tctx.drawImage(putSmall(mask), 0, 0, tmp.width, tmp.height);
          tctx.globalCompositeOperation = 'source-in';
          tctx.fillStyle = hatchPattern(tctx, `rgba(${pal[klass][0]},${pal[klass][1]},${pal[klass][2]},0.95)`, klass === 2);
          tctx.fillRect(0, 0, tmp.width, tmp.height);
          ctx.drawImage(tmp, 0, 0);
        }
        tctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.drawImage(putSmall(overlayRGBA(id, o)), 0, 0, tex.width, tex.height);
      }
      ctx.globalAlpha = 1;
    }
    if (cfg('map.contours')) UI.drawContours(ctx, S.contours, { xy: (c, r) => [(c + 0.5) * k, (r + 0.5) * k], lw: Math.max(1, k * 0.55) });
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
      if (cfg('grid.in3d')) UI.drawGrids(ctx, S.grid, P, [-0.5, -0.5, S.grid.w, S.grid.h], { labels: false });
      UI.drawFeatures(ctx, S, P);
      S.texCanvas = t;
      S.texDirty = false;
      v3.setTexture(t);
    };
    if (now) build(); else texTimer = setTimeout(build, 80);
  };
  const refresh = (opts = {}) => {
    if (!S.grid) return;
    if (opts.base) composeBase();
    map.render();
    if (S.view === '3d') { updateTexture(); v3.render(); } else S.texDirty = true;
    updateLegend();
    renderAttrTable();
  };
  UI.onSymbolReady(() => { map && map.render(); if (S.view === '3d') { v3.render(); updateTexture(); } });

  // =================================================================== legend
  const updateLegend = () => {
    const el = $('legend');
    if (!S.grid) { el.innerHTML = '<p class="hint">No dataset.</p>'; return; }
    const blocks = [];
    const baseInfo = { min: F.elevNum(S.stats.elevMin), max: F.elevNum(S.stats.elevMax) };
    if (S.base === 'tri') baseInfo.max = UI.percentile(S.L.tri, 0.98);
    blocks.push(S.base === 'relief' ? UI.legendHTML('relief') : UI.legendHTML(S.base, baseInfo));
    for (const o of Object.values(S.overlays)) if (o.visible && o.data) blocks.push(UI.legendHTML(o.legend, o.info || {}));
    const grids = [];
    if (cfg('grid.mgrs')) grids.push([cfg('grid.mgrsColor'), `MGRS / UTM ${S.grid.zone}${S.grid.north ? 'N' : 'S'} grid`]);
    if (cfg('grid.graticule')) grids.push([cfg('grid.graticuleColor'), 'Graticule (WGS 84)']);
    const crs = F.secondaryCRS();
    if (cfg('grid.secondary') && crs) grids.push([cfg('grid.secondaryColor'), crs.name]);
    if (grids.length) blocks.push(`<h4>Grids</h4><div class="sw">${grids.map(([c, t]) => `<i style="background:${c}"></i><span>${esc(t)}</span>`).join('')}</div>`);
    el.innerHTML = blocks.map((b) => `<div class="blk">${b}</div>`).join('');
  };

  // =================================================================== status bar / hover
  const app = {
    S,
    onHover(c, r) {
      const g = S.grid;
      const ids = ['stRef', 'stSec', 'stZ', 'stSlope', 'stAspect', 'stLF', 'stMob'];
      if (!g || c == null || c < -0.5 || r < -0.5 || c > g.w - 0.5 || r > g.h - 0.5) { ids.forEach((id) => ($(id).textContent = '—')); return; }
      const i = Math.round(r) * g.w + Math.round(c);
      $('stRef').textContent = F.refCell(r, c);
      $('stSec').textContent = cfg('ref.secondaryReadout') ? F.secondaryCell(r, c) : '';
      $('stZ').textContent = F.elev(M.sample(g, S.L.z, r, c));
      $('stSlope').textContent = `${S.L.slope[i].toFixed(1)}°`;
      const a = S.L.aspect[i];
      $('stAspect').textContent = a < 0 ? 'flat' : `${M.ASPECT_NAMES[M.aspectClass(a)]} ${F.bearing(a, r, c)}`;
      $('stLF').textContent = M.LANDFORMS[S.L.landform[i]].name.split(' (')[0];
      const mob = S.overlays.mobility.data;
      $('stMob').textContent = mob ? `${M.CLASS_NAMES[mob[i]]} — ${M.MOVEMENT_PROFILES[S.overlays.mobility.profile].name.split(' (')[0]}` : '—';
      if (S.draft) { S.draft.hover = [c, r]; redrawDraft(); }
    },
    onClick(c, r, ev) { safe(handleClick)(c, r, ev); },
    onDblClick(c, r) { if (S.draft && (S.draft.kind === 'poly' || S.draft.kind === 'line')) finishDraft(); else if (S.view === '2d' && !S.tool) map.zoomAt(...map.toScreen(c, r), 2); },
  };
  const updateStatusStatic = () => {
    $('stRefLabel').textContent = F.refName();
    const crs = F.secondaryCRS();
    const showSec = cfg('ref.secondaryReadout') && crs;
    $('stSecLabel').textContent = showSec ? crs.name.replace(/^Kalianpur 1962 \//, 'Kal62').replace(/ — geographic$/, '') : '';
    document.querySelector('.st-sec').hidden = !showSec;
    $('stCRS').textContent = F.analysisCRSName();
    $('crsBadge').textContent = F.analysisCRSName() + (crs ? ` · ${crs.name}` : '');
  };
  const updateScale = () => { $('stScale').textContent = S.grid ? (S.view === '3d' ? '3D view' : `1:${Math.round(map.scaleDenominator() / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')) : ''; };

  // =================================================================== tools
  const TOOL_HINTS = {
    own: 'Click own position (defended locality / HQ) · Esc to cancel', threat: 'Click the enemy position · Esc to cancel',
    target: 'Click the target area for indirect fire', a: 'Click route start (A)', b: 'Click route end (B)',
    poly: 'No-Go area — click vertices · double-click or Enter to finish · Backspace undo · Esc cancel', line: 'Track — click vertices · double-click or Enter to finish · Backspace undo · Esc cancel',
    los: 'Click observer, then target', vs: 'Click the observer position', measure: 'Click start, then end point', aoi: 'Click two opposite corners of the area of interest',
  };
  const setTool = (tool) => {
    if (!S.grid) return;
    if (S.tool === tool) tool = null;
    S.tool = tool;
    S.draft = tool && ['poly', 'line', 'los', 'measure', 'aoi'].includes(tool) ? { kind: tool, pts: [] } : null;
    document.querySelectorAll('[data-cmd^="tool:"]').forEach((b) => b.classList.toggle('active', b.dataset.cmd === 'tool:' + tool));
    $('stage').classList.toggle('tool', !!tool);
    $('toolHint').hidden = !tool;
    if (tool) $('toolHint').textContent = TOOL_HINTS[tool];
    map.render();
    if (S.view === '3d') v3.render();
  };
  /** Redraw the in-progress draft in whichever view is active and update the tool hint. */
  const redrawDraft = () => {
    map.render();
    if (S.view === '3d') v3.render();
    const m = UI.draftMetrics(S);
    if (!m || !S.tool) return;
    if (S.tool === 'poly') $('toolHint').textContent = `No-Go area — ${m.n} vertices · perimeter ${F.dist(m.len)} · area ${F.area(m.area)} — double-click or Enter to finish · Backspace undo · Esc cancel`;
    else if (S.tool === 'line') $('toolHint').textContent = `Track — ${m.n} vertices · length ${F.dist(m.len)} — double-click or Enter to finish · Backspace undo · Esc cancel`;
  };
  const finishDraft = () => {
    const d = S.draft;
    if (!d) return;
    const pts = d.pts.filter((p, k) => k === 0 || Math.hypot(p[0] - d.pts[k - 1][0], p[1] - d.pts[k - 1][1]) > 0.5);
    if (d.kind === 'poly' && pts.length >= 3) S.obstacles.push(pts);
    else if (d.kind === 'line' && pts.length >= 2) S.tracks.push(pts);
    else { toast('Not enough vertices.', true); setTool(null); return; }
    setTool(null);
    safe(onObstaclesChanged)();
  };
  const onObstaclesChanged = async () => {
    $('obsInfo').textContent = `${S.obstacles.length} No-Go area(s), ${S.tracks.length} track(s). Mobility, access and routes respect them.`;
    await syncSettings();
    if (S.overlays.mobility.data) await computeMobility(true);
    refresh();
  };
  const nearestSymbol = (x, y) => {
    let best = null, bd = 18;
    for (const it of UI.symbolItems(S).filter((i) => i.ref)) {
      let p;
      if (S.view === '3d') { p = v3.project([v3.wx(it.c), v3.hAt(it.c, it.r) + 2, v3.wz(it.r)]); if (p) p.y -= +cfg('v3.lift'); }
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
      if (inside) select({ kind: 'point', c, r }, false);
      return;
    }
    if (!inside) return;
    const cell = { c: Math.round(c), r: Math.round(r) };
    if (['own', 'threat', 'target', 'a', 'b'].includes(tool)) {
      S.markers[tool] = cell;
      setTool(null);
      if (tool === 'own' || tool === 'threat') { S.avenues = null; S.hostile = null; clearOverlay('hostile'); clearOverlay('avenues'); }
      await syncSettings();
      renderAll();
      refresh({ base: true });
      return;
    }
    if (tool === 'poly' || tool === 'line') { S.draft.pts.push([c, r]); redrawDraft(); return; }
    if (tool === 'aoi' || tool === 'measure' || tool === 'los') {
      S.draft.pts.push([c, r]);
      if (S.draft.pts.length < 2) { redrawDraft(); return; }
      const [p, q] = S.draft.pts;
      setTool(null);
      if (tool === 'aoi') return cropAOI(p, q);
      if (tool === 'measure') return showMeasure(p, q);
      return runLOS({ c: Math.round(p[0]), r: Math.round(p[1]) }, { c: Math.round(q[0]), r: Math.round(q[1]) });
    }
    if (tool === 'vs') { setTool(null); return runViewshed(cell); }
  };
  const pgrid = (rows) => rows.map(([k, v]) => (v === null ? `<tr class="sub"><td colspan="2">${esc(k)}</td></tr>` : `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)).join('');
  const showMeasure = (p, q) => {
    const g = S.grid;
    const dc = q[0] - p[0], dr = q[1] - p[1];
    const d = Math.hypot(dc, dr) * g.cs;
    const gb = M.bearing(dc, -dr);
    const z1 = M.sample(g, S.L.z, p[1], p[0]), z2 = M.sample(g, S.L.z, q[1], q[0]);
    const conv = F.convergence(p[1], p[0]), decl = F.declination();
    $('measureInfo').innerHTML = pgrid([
      ['From', F.refCell(p[1], p[0], { digits: cfg('ref.listDigits') })], ['To', F.refCell(q[1], q[0], { digits: cfg('ref.listDigits') })],
      ['Distance (grid)', F.dist(d)], ['Slope distance', F.dist(Math.hypot(d, z2 - z1))],
      ['Bearing — grid', F.angle(gb)], ['Bearing — true', F.angle(gb + conv)], ['Bearing — magnetic', F.angle(gb + conv - decl)],
      ['Back bearing', F.bearing(gb + 180, p[1], p[0])],
      ['Height difference', F.height(z2 - z1)], ['Mean gradient', `${M.deg(Math.atan(Math.abs(z2 - z1) / Math.max(1, d))).toFixed(1)}°`],
    ]);
    showTab('tools');
    S.draft = { kind: 'measure', pts: [p, q] };
    map.render();
  };

  // =================================================================== analyses
  const clearOverlay = (id) => { const o = S.overlays[id]; o.data = null; o.rgba = null; o.visible = false; };
  const setOverlay = (id, data, info, keepOthers) => {
    const o = S.overlays[id];
    if (!keepOthers && cfg('ovl.exclusive')) for (const [k, x] of Object.entries(S.overlays)) if (k !== id) x.visible = false;
    o.data = data; o.rgba = null; o.visible = !!data; o.info = info || o.info;
    renderLayersPanel();
  };
  const needMarkers = (...keys) => {
    const names = { own: 'own position', threat: 'enemy position', a: 'route start (A)', b: 'route end (B)' };
    const miss = keys.filter((k) => !S.markers[k]);
    if (miss.length) { toast(`Place the ${miss.map((k) => names[k]).join(' and ')} first.`, true); return false; }
    return true;
  };

  const computeMobility = async (quiet) => {
    const id = $('mobProfile').value;
    await syncSettings();
    const res = await run(`Go / No-Go — ${M.MOVEMENT_PROFILES[id].name}`, 'mobility', { profile: id },
      (r) => `GO ${pct(r.stats.go)} · SLOW ${pct(r.stats.slow)} · NO-GO ${pct(r.stats.nogo)}`);
    S.mobStats[id] = res.stats;
    S.overlays.mobility.profile = id;
    setOverlay('mobility', res.cls, Object.assign({ name: res.profile.name }, res.profile));
    const s = res.stats, area = S.stats.areaKm2;
    const pal = UI.mobPalette().map((p) => `rgb(${p[0]},${p[1]},${p[2]})`);
    $('mobStats').innerHTML = `<div class="bar3"><i style="width:${s.go * 100}%;background:${pal[0]}"></i><i style="width:${s.slow * 100}%;background:${pal[1]}"></i><i style="width:${s.nogo * 100}%;background:${pal[2]}"></i></div>
      <table class="pgrid">${pgrid([['GO', `${pct(s.go)} · ${F.area(s.go * area)}`], ['SLOW-GO', `${pct(s.slow)} · ${F.area(s.slow * area)}`], ['NO-GO', `${pct(s.nogo)} · ${F.area(s.nogo * area)}`]])}</table>`;
    refresh({ base: true });
    if (!quiet) toast(`${res.profile.name}: ${pct(s.go)} GO, ${pct(s.slow)} SLOW-GO, ${pct(s.nogo)} NO-GO.`);
  };
  const runKey = async () => {
    S.key = await run('Key terrain', 'keyTerrain', {}, (r) => `${r.peaks.length} heights · ${r.passes.length} passes`);
    S.show.key = true;
    renderAll(); refresh();
  };
  const runHostile = async () => {
    if (!needMarkers('threat')) return;
    await syncSettings();
    const res = await run('Enemy observation', 'hostileObservation', {}, (r) => `${r.observers.length - 1} likely enemy OPs`);
    S.hostile = { observers: res.observers };
    setOverlay('hostile', res.count);
    let seen = 0;
    for (const v of res.count) if (v) seen++;
    $('sitInfo').innerHTML = `Likely enemy OPs overlook <b>${pct(seen / res.count.length)}</b> of the area (shaded). Unshaded ground is in defilade from enemy view.`;
    refresh({ base: true });
  };
  const runAvenues = async () => {
    if (!needMarkers('own', 'threat')) return;
    await syncSettings();
    const res = await run('Avenues of approach', 'avenues', { profile: S.threatType },
      (r) => r.routes.map((x, k) => `AA${k + 1} ${F.dist(x.lengthM)} / ${F.time(x.timeH)}`).join('\n'));
    S.avenues = { routes: res.routes };
    setOverlay('avenues', res.density);
    $('sitInfo').innerHTML = `Avenues of approach (${esc(M.MOVEMENT_PROFILES[S.threatType].name)}): ` + res.routes.map((r, k) => `AA${k + 1} ${F.dist(r.lengthM)} / ${F.time(r.timeH)}`).join(' · ');
    renderAll(); refresh({ base: true });
  };
  const runPosts = async () => {
    await syncSettings();
    const mode = $('postType').value, echelon = $('postEchelon').value;
    const res = await run(mode === 'op' ? 'Suggest OPs' : 'Suggest posts', 'posts', {
      count: +$('postCount').value, rangeM: +$('postRange').value, minSepM: +$('postSep').value, maxDistOwnM: +$('postMaxOwn').value, mode,
      obsH: +cfg('an.obsH'), tgtH: +cfg('an.tgtH'),
    }, (r) => `${r.posts.length} sites · ${pct(r.coverageShare)} of approach ground observed`);
    S.posts = Object.assign(res, { mode, echelon });
    setOverlay('cover', res.cover);
    setOverlay('dead', res.dead, null, true);
    renderAll(); refresh({ base: true });
    if (res.accessRelaxed) toast('No site is reachable on foot from own position — access constraint relaxed.', true);
  };
  const runWeapons = async () => {
    const w = weaponOf($('wpnSelect').value);
    if (w.cat === 'indirect' && !S.markers.threat && !S.markers.target) { toast('Place the enemy or a target area first — indirect fire needs a target.', true); return; }
    await syncSettings();
    const res = await run(`Weapon sites — ${w.short}`, 'weapons', {
      weaponId: w.id, weaponOverrides: (cfg('weapons') || {})[w.id], count: +$('wpnCount').value, defRadiusM: +$('wpnRadius').value,
    }, (r) => r.sites.map((x) => `${x.id} ${F.listRef(x.r, x.c)}`).join('\n') + (r.accessRelaxed ? '\naccess relaxed' : ''));
    const entry = Object.assign(res, { weapon: w });
    const k = S.weapons.findIndex((x) => x.weapon.id === w.id);
    if (k >= 0) S.weapons[k] = entry; else S.weapons.push(entry);
    updateWeaponCover();
    renderAll(); refresh({ base: true });
    if (res.accessRelaxed) toast(`No site is reachable by ${M.MOVEMENT_PROFILES[res.accessProfile].name.toLowerCase()} — access relaxed; digitise a track to enforce it.`, true);
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
    const res = await run(`Minefields — ${type}`, 'minefields', {
      type, count: +$('mfdCount').value, maxGapM: +$('mfdGap').value, depthM: +$('mfdDepth').value,
      densityPerM: +$('mfdDensity').value, maxDistOwnM: +$('mfdMaxOwn').value, cover,
    }, (r) => r.fields.map((f) => `${f.id} gap ${F.dist(f.gapM)} · ≈${f.estMines} mines`).join('\n'));
    S.mfd = res;
    if (!S.avenues) S.avenues = { routes: res.avenues };
    renderAll(); refresh();
  };
  const runRoute = async () => {
    if (!needMarkers('a', 'b')) return;
    const mode = $('routeMode').value;
    if (mode !== 'fastest' && !S.markers.threat) toast('No enemy position set — the route avoids skylines but cannot assess enemy observation.');
    await syncSettings();
    const profile = $('routeProfile').value;
    const res = await run(`Route A→B (${mode})`, 'route', {
      a: S.markers.a, b: S.markers.b, profile, mode, alternatives: +$('routeAlt').value, cpEveryM: +$('routeCP').value,
    }, (r) => r.routes.map((x, k) => `R${k + 1} ${F.dist(x.lengthM)} · ${F.time(x.timeH)}`).join('\n'));
    S.routes = { routes: res.routes, sel: 0, profile, mode };
    S.picquets = null;
    renderAll(); showRouteProfile(); refresh();
  };
  const runPicquets = async () => {
    if (!S.routes) { toast('Find a route first.', true); return; }
    const rt = S.routes.routes[S.routes.sel || 0];
    S.picquets = await run('Picquets', 'picquets', { path: Array.from(rt.path), rangeM: +$('pqRange').value, count: +$('pqCount').value || 0 },
      (r) => `${r.picquets.length} picquets · ${pct(r.routeCoverage)} of route observed`);
    renderAll(); refresh();
  };
  const runLOS = async (a, b) => {
    const res = await run('Line of sight', 'los', { a, b, obsH: +$('losObs').value, tgtH: +$('losTgt').value }, (r) => `${r.visible ? 'visible' : 'masked'} · ${F.dist(r.distance)}`);
    S.los = { a, b, res };
    const blk = res.blockIndex >= 0 ? res.profile[res.blockIndex] : null;
    $('losInfo').innerHTML = (res.visible ? '<b>VISIBLE</b>' : `<b class="err">MASKED</b> by ground at ${F.dist(blk.d)} (${esc(F.listRef(blk.r, blk.c))})`) +
      ` · range ${F.dist(res.distance)}${res.visible ? ` · min clearance ${F.height(res.clearance)}` : ''}`;
    openProfile(`Line of sight — ${res.visible ? 'visible' : 'masked'} — ${F.dist(res.distance)}`, { profile: res.profile, blockIndex: res.blockIndex });
    refresh();
  };
  const runViewshed = async (p) => {
    const res = await run('Viewshed', 'viewshed', { p, obsH: +$('vsObs').value, tgtH: +$('vsTgt').value, radiusM: +$('vsRadius').value },
      (r) => `${F.area(r.visibleKm2)} visible`);
    S.vsPoint = p;
    setOverlay('viewshed', res.mask);
    $('vsInfo').innerHTML = `Visible area <b>${F.area(res.visibleKm2)}</b> within ${F.dist(+$('vsRadius').value)} of <code>${esc(F.listRef(p.r, p.c))}</code>.`;
    refresh({ base: true });
  };

  // =================================================================== selection & properties
  const posOf = (ref) => {
    if (!ref) return null;
    switch (ref.kind) {
      case 'post': return S.posts && S.posts.posts[ref.idx];
      case 'weapon': return S.weapons[ref.idx] && S.weapons[ref.idx].sites[ref.sub];
      case 'mfd': return S.mfd && S.mfd.fields[ref.idx];
      case 'picquet': return S.picquets && S.picquets.picquets[ref.idx];
      case 'key': return S.key && (ref.sub === 'pass' ? S.key.passes : S.key.peaks)[ref.idx];
      case 'marker': return S.markers[ref.idx];
      case 'route': return S.routes && S.routes.routes[ref.idx] && { c: S.routes.routes[ref.idx].line[0][0], r: S.routes.routes[ref.idx].line[0][1] };
      case 'avenue': return S.avenues && S.avenues.routes[ref.idx] && { c: S.avenues.routes[ref.idx].line[0][0], r: S.avenues.routes[ref.idx].line[0][1] };
      case 'cp': return S.routes && S.routes.routes[S.routes.sel || 0].checkpoints[ref.idx];
      case 'point': return { c: ref.c, r: ref.r };
      default: return null;
    }
  };
  const select = (ref, zoom) => {
    if (ref && ref.kind === 'route') { S.routes.sel = ref.idx; S.picquets = null; showRouteProfile(); }
    S.sel = ref;
    renderAll();
    const pos = posOf(ref);
    if (zoom && pos) {
      if (S.view === '3d') v3.lookAtCell(pos.c, pos.r);
      else map.centerOn(pos.c, pos.r, Math.max(map.view.scale, 2));
    }
    refresh();
  };
  const isSel = (kind, idx, sub) => S.sel && S.sel.kind === kind && S.sel.idx === idx && (sub === undefined || S.sel.sub === sub);

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast(`Copied: ${text}`);
  };

  /** Position block of the property grid (all reference systems). */
  const positionRows = (r, c) => {
    const g = S.grid;
    const ll = M.cellToLatLon(g, r, c);
    const rows = [['Position', null], [F.refName(), F.listRef(r, c)]];
    if (cfg('ref.primary') !== 'mgrs') rows.push(['MGRS', F.ref(ll.lat, ll.lon, { kind: 'mgrs', digits: cfg('ref.listDigits') })]);
    rows.push(['Lat / Lon', F.ref(ll.lat, ll.lon, { kind: 'dms' })]);
    const crs = F.secondaryCRS();
    if (crs) rows.push([crs.name, F.secondaryCell(r, c)]);
    rows.push(['Elevation', `${F.elev(M.sample(g, S.L.z, r, c))} (${F.vdatum()})`]);
    const i = Math.round(r) * g.w + Math.round(c);
    if (i >= 0 && i < S.L.slope.length) rows.push(['Slope / aspect', `${S.L.slope[i].toFixed(1)}° / ${S.L.aspect[i] < 0 ? 'flat' : F.bearing(S.L.aspect[i], r, c)}`]);
    rows.push(['Grid convergence', `${F.convergence(r, c).toFixed(3)}°`]);
    return rows;
  };

  const renderSelection = () => {
    const el = $('selBody');
    const ref = S.sel;
    const p = posOf(ref);
    if (!p || !S.grid) { el.innerHTML = '<p class="hint">Select a feature on the map, in a list or in the attribute table. Click empty ground to inspect a location.</p>'; return; }
    let icon = '', title = '', sub = '';
    const rows = [];
    const mk = { own: ['Own position', UI.SYM.own(S.ownEchelon)], threat: ['Enemy', UI.SYM.threat(S.threatType)], target: ['Target area', UI.SYM.target()], a: ['Route start (SP)', UI.SYM.sp()], b: ['Route end (RP)', UI.SYM.rp()] };
    switch (ref.kind) {
      case 'post': {
        const P = S.posts;
        icon = UI.symbolHTML(P.mode === 'op' ? UI.SYM.op() : UI.SYM.post(P.echelon), 26);
        title = p.id; sub = P.mode === 'op' ? 'Observation post (planned)' : `Defended post — ${P.echelon} (planned)`;
        const mates = P.links.filter((l) => l[0] === ref.idx || l[1] === ref.idx).map((l) => P.posts[l[0] === ref.idx ? l[1] : l[0]].id);
        rows.push(['Assessment', null], ['Landform', p.landform.split(' (')[0]], ['Visible area', F.area(p.visibleKm2)], ['Approach coverage', pct(p.valueShare, 1)],
          ['Access on foot', F.time(p.accessH)], ['Intervisible with', mates.join(', ') || 'none']);
        break;
      }
      case 'weapon': {
        const res = S.weapons[ref.idx];
        icon = UI.symbolHTML(UI.SYM.weapon(res.weapon), 26); title = p.id; sub = res.weapon.name;
        rows.push(['Fire', null]);
        if (p.cat === 'indirect') {
          rows.push(['Range to target', F.dist(p.rangeToTargetM)], ['Bearing to target', F.bearing(p.bearingDeg, p.r, p.c)],
            ['Quadrant elevation', p.qeDeg === null ? '—' : `${F.angle(p.qeDeg)} (${p.qeDeg.toFixed(1)}°)`], ['Trajectory', p.angleMode || '—'],
            ['Crest clearance', `${pct(p.clearShare)} of target area`], ['Enemy observation', p.hidden ? 'hidden (defilade)' : `seen by ${p.hostileCount} OP(s)`]);
        } else {
          rows.push(['Left of arc', F.bearing(p.sector.left, p.r, p.c)], ['Right of arc', F.bearing(p.sector.right, p.r, p.c)], ['Principal direction', F.bearing(p.sector.mean, p.r, p.c)],
            ['Mean range', F.dist(p.meanRangeM)], ['Target ground covered', pct(p.valueShare, 1)]);
        }
        rows.push(['Range band', `${F.dist(p.minR)} – ${F.dist(p.maxR)}`], ['Landform', p.landform.split(' (')[0]], ['Access', F.time(p.accessH)]);
        break;
      }
      case 'mfd':
        icon = UI.symbolHTML(UI.SYM.mine(p.type), 22); title = p.id; sub = `${p.type === 'AT' ? 'Anti-tank' : 'Anti-personnel'} minefield (planned)`;
        rows.push(['Obstacle', null], ['Gap at defile', F.dist(p.gapM)], ['Front × depth', `${F.dist(p.frontM)} × ${F.dist(p.depthM)}`], ['Orientation', F.bearing(p.orientationDeg, p.r, p.c)],
          ['Est. mines', `≈ ${p.estMines}`], ['On avenues', p.onAvenues.length ? 'AA ' + p.onAvenues.join(', ') : '—'], ['Observed / covered', p.covered ? 'yes' : 'NO — site an OP or weapon']);
        break;
      case 'picquet':
        icon = UI.symbolHTML(UI.SYM.picquet(), 26); title = p.id; sub = 'Route picquet (planned)';
        rows.push(['Route protection', null], ['Protects route', p.routeFromKm === null ? '—' : `km ${p.routeFromKm.toFixed(1)} – ${p.routeToKm.toFixed(1)}`], ['Climb from route', F.time(p.climbH)]);
        break;
      case 'key':
        title = ref.sub === 'pass' ? `Col ${ref.idx + 1}` : `H${ref.idx + 1}`; sub = ref.sub === 'pass' ? 'Pass / saddle' : 'Dominating height';
        if (p.prominence) rows.push(['Terrain', null], ['Local dominance', F.height(p.prominence)]);
        break;
      case 'marker': icon = UI.symbolHTML(mk[ref.idx][1], 22); title = mk[ref.idx][0]; break;
      case 'route': {
        const rt = S.routes.routes[ref.idx];
        title = `Route R${ref.idx + 1}`; sub = M.MOVEMENT_PROFILES[S.routes.profile].name;
        rows.push(['Route', null], ['Length', F.dist(rt.lengthM)], ['Time', F.time(rt.timeH)], ['Ascent / descent', `${F.height(rt.ascentM)} / ${F.height(-rt.descentM)}`],
          ['Max grade', `${rt.maxGradeDeg.toFixed(0)}°`], ['Slow-Go', pct(rt.slowFrac)], ['Exposed', pct(rt.exposedFrac)], ['Highest point', F.elev(rt.highestM)]);
        break;
      }
      case 'point': title = 'Location'; sub = 'Inspected point'; break;
      default: title = ref.kind;
    }
    el.innerHTML = `<div class="sel-head">${icon}<div><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div></div>
      <table class="pgrid">${pgrid(rows.concat(positionRows(p.r, p.c)))}</table>
      <div class="sel-actions"><button class="btn sm" data-act="copy">Copy reference</button><button class="btn sm" data-act="zoom">Zoom to</button><button class="btn sm" data-act="vs">Viewshed</button></div>`;
    el.querySelector('[data-act=copy]').onclick = () => copyText(F.listRef(p.r, p.c));
    el.querySelector('[data-act=zoom]').onclick = () => (S.view === '3d' ? v3.lookAtCell(p.c, p.r, 3500) : map.centerOn(p.c, p.r, Math.max(map.view.scale, 3)));
    el.querySelector('[data-act=vs]').onclick = safe(() => runViewshed({ c: Math.round(p.c), r: Math.round(p.r) }));
  };

  // =================================================================== lists (panels)
  const item = (icon, title, right, detail, attrs, sel) =>
    `<div class="item${sel ? ' sel' : ''}" ${attrs}><div class="ic">${icon}</div><div><div class="t"><span>${title}</span><i>${right}</i></div></div><div class="d">${detail}</div></div>`;
  const bindList = (el) => el.querySelectorAll('.item[data-kind]').forEach((n) => n.addEventListener('click', () => {
    const ref = { kind: n.dataset.kind, idx: isNaN(+n.dataset.idx) ? n.dataset.idx : +n.dataset.idx };
    if (n.dataset.sub !== undefined) ref.sub = isNaN(+n.dataset.sub) ? n.dataset.sub : +n.dataset.sub;
    select(ref, true);
  }));
  const renderKeyList = () => {
    const el = $('keyList');
    if (!S.key) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="lh">${S.key.peaks.length} dominating heights · ${S.key.passes.length} passes</div>` +
      S.key.peaks.slice(0, 10).map((p, k) => item('<b>▲</b>', `H${k + 1} · ${F.elev(p.z)}`, esc(F.listRef(p.r, p.c)), `Dominates surroundings by ${F.height(p.prominence)}`, `data-kind="key" data-idx="${k}" data-sub="peak"`, isSel('key', k, 'peak'))).join('') +
      S.key.passes.map((p, k) => item('<b style="font-family:Georgia">)(</b>', `Col ${k + 1} · ${F.elev(p.z)}`, esc(F.listRef(p.r, p.c)), 'Pass / saddle — likely crossing point', `data-kind="key" data-idx="${k}" data-sub="pass"`, isSel('key', k, 'pass'))).join('');
    bindList(el);
  };
  const renderPostList = () => {
    const el = $('postList');
    if (!S.posts) { el.innerHTML = ''; return; }
    const P = S.posts;
    el.innerHTML = `<div class="lh">Approach ground observed ${pct(P.coverageShare)} · intervisible pairs ${P.links.length}</div>` +
      P.posts.map((p, k) => item(UI.symbolHTML(P.mode === 'op' ? UI.SYM.op() : UI.SYM.post(P.echelon), 24), `${p.id} · ${F.elev(p.z)}`, esc(F.listRef(p.r, p.c)),
        `Sees ${F.area(p.visibleKm2)} · ${pct(p.valueShare, 1)} of approaches · ${esc(p.landform.split(' (')[0])}${p.accessH !== null ? ` · ${F.time(p.accessH)} on foot` : ''}`,
        `data-kind="post" data-idx="${k}"`, isSel('post', k))).join('');
    bindList(el);
  };
  const renderWeaponList = () => {
    const el = $('wpnList');
    el.innerHTML = S.weapons.map((res, wi) => `<div class="lh">${esc(res.weapon.name)}${res.accessRelaxed ? ' — <span class="warn">access relaxed</span>' : ''}</div>` +
      res.sites.map((s, k) => {
        const d = s.cat === 'indirect'
          ? `${F.dist(s.rangeToTargetM)} @ ${F.bearing(s.bearingDeg, s.r, s.c)} · QE ${s.qeDeg === null ? '—' : F.angle(s.qeDeg)} (${s.angleMode}) · crest clear ${pct(s.clearShare)} · ${s.hidden ? 'hidden from enemy OPs' : `<span class="warn">seen by ${s.hostileCount} OP(s)</span>`}`
          : `Arc ${F.bearing(s.sector.left, s.r, s.c, true)} – ${F.bearing(s.sector.right, s.r, s.c)} · mean range ${F.dist(s.meanRangeM)} · covers ${pct(s.valueShare, 1)}`;
        return item(UI.symbolHTML(UI.SYM.weapon(res.weapon), 22), `${s.id} · ${F.elev(s.z)}`, esc(F.listRef(s.r, s.c)), d, `data-kind="weapon" data-idx="${wi}" data-sub="${k}"`, isSel('weapon', wi, k));
      }).join('')).join('');
    bindList(el);
  };
  const renderMfdList = () => {
    const el = $('mfdList');
    if (!S.mfd) { el.innerHTML = ''; return; }
    el.innerHTML = S.mfd.fields.map((f, k) => item(UI.symbolHTML(UI.SYM.mine(f.type), 20), `${f.id} · ${f.type}`, esc(F.listRef(f.r, f.c)),
      `Gap ${F.dist(f.gapM)} · front ${F.dist(f.frontM)} × ${F.dist(f.depthM)} · ≈${f.estMines} mines · ${f.onAvenues.length ? 'AA ' + f.onAvenues.join(',') : 'off avenue'} · ${f.covered ? 'observed' : '<span class="warn">not observed</span>'}`,
      `data-kind="mfd" data-idx="${k}"`, isSel('mfd', k))).join('');
    bindList(el);
  };
  const renderRouteList = () => {
    const el = $('routeList');
    if (!S.routes) { el.innerHTML = ''; return; }
    el.innerHTML = S.routes.routes.map((rt, k) => item(`<b>R${k + 1}</b>`, `${F.dist(rt.lengthM)} · ${F.time(rt.timeH)}`, k === (S.routes.sel || 0) ? 'selected' : '',
      `${F.height(rt.ascentM)} / ${F.height(-rt.descentM)} · max grade ${rt.maxGradeDeg.toFixed(0)}° · slow-go ${pct(rt.slowFrac)} · exposed ${pct(rt.exposedFrac)} · top ${F.elev(rt.highestM)} · ${rt.checkpoints.length} CKP`,
      `data-kind="route" data-idx="${k}"`, k === (S.routes.sel || 0))).join('');
    bindList(el);
  };
  const renderPicquetList = () => {
    const el = $('pqList');
    if (!S.picquets) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="lh">Route under observation ${pct(S.picquets.routeCoverage)}</div>` +
      S.picquets.picquets.map((p, k) => item(UI.symbolHTML(UI.SYM.picquet(), 22), `${p.id} · ${F.elev(p.z)}`, esc(F.listRef(p.r, p.c)),
        `Protects km ${p.routeFromKm === null ? '—' : `${p.routeFromKm.toFixed(1)}–${p.routeToKm.toFixed(1)}`} · climb ${F.time(p.climbH)}`, `data-kind="picquet" data-idx="${k}"`, isSel('picquet', k))).join('');
    bindList(el);
  };
  const renderSituation = () => {
    const mk = S.markers, rows = [];
    const add = (k, label) => rows.push([label, mk[k] ? F.listRef(mk[k].r, mk[k].c) : 'not placed']);
    add('own', 'Own position'); add('threat', 'Enemy'); add('target', 'Target area');
    if (mk.own && mk.threat) {
      const dc = mk.threat.c - mk.own.c, dr = mk.threat.r - mk.own.r;
      rows.push(['Threat distance / bearing', `${F.dist(Math.hypot(dc, dr) * S.grid.cs)} @ ${F.bearing(M.bearing(dc, -dr), mk.own.r, mk.own.c)}`]);
    }
    $('sitTable').innerHTML = pgrid(rows);
    const re = [['Start A', mk.a ? F.listRef(mk.a.r, mk.a.c) : 'not placed'], ['End B', mk.b ? F.listRef(mk.b.r, mk.b.c) : 'not placed']];
    if (mk.a && mk.b) re.push(['Straight-line', F.dist(Math.hypot(mk.b.c - mk.a.c, mk.b.r - mk.a.r) * S.grid.cs)]);
    $('routeEnds').innerHTML = pgrid(re);
  };
  const renderDataInfo = () => {
    const g = S.grid, st = S.stats;
    const crs = F.secondaryCRS();
    $('demInfo').innerHTML = pgrid([
      ['Name', g.name], ['Source', S.sources ? `${S.sources.length} file(s)` : g.synthetic ? 'synthetic' : 'resampled'],
      ['Analysis CRS', F.analysisCRSName()], ['Secondary CRS', crs ? crs.name : 'none'], ['Vertical datum', F.vdatum()],
      ['Cell size', `${g.cs} m`], ['Grid', `${g.w} × ${g.h}`], ['Extent', `${F.dist(g.w * g.cs)} × ${F.dist(g.h * g.cs)}`], ['Area', F.area(st.areaKm2)],
      ['NW corner', F.listRef(0, 0)], ['SE corner', F.listRef(g.h - 1, g.w - 1)],
      ['Elevation', `${F.elev(st.elevMin)} – ${F.elev(st.elevMax)}`], ['Mean / relief', `${F.elev(st.elevMean)} / ${F.height(st.relief)}`],
      ['Slope mean / max', `${st.slopeMean.toFixed(1)}° / ${st.slopeMax.toFixed(0)}°`],
    ]);
    const box = $('demCharts');
    box.innerHTML = '<canvas id="chHyp"></canvas><canvas id="chSlope"></canvas><canvas id="chRose"></canvas>';
    const hb = st.hypsometry.bins;
    UI.drawBars($('chHyp'), `Hypsometry (${F.elev(st.elevMin)} – ${F.elev(st.elevMax)})`, hb.map((v, k) => ({ v, color: '#b08a58', label: k % 6 === 0 ? String(F.elevNum(st.elevMin + (k / hb.length) * st.relief)) : '' })));
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
    ol.querySelectorAll('[data-op]').forEach((n) => n.addEventListener('input', () => { S.overlays[n.dataset.op].opacity = +n.value; refresh({ base: true }); }));
    const feats = [['symbols', 'NATO symbols'], ['labels', 'Labels'], ['key', 'Key terrain (heights, passes)'], ['posts', 'Posts / OPs'], ['weapons', 'Weapon sites & arcs'], ['mfd', 'Minefields'],
      ['routes', 'Routes & checkpoints'], ['avenues', 'Enemy avenues'], ['picquets', 'Picquets'], ['hostileOps', 'Likely enemy OPs']];
    const fl = $('featureList');
    fl.innerHTML = feats.map(([k, n]) => `<div class="lrow"><label><input type="checkbox" data-f="${k}" ${S.show[k] ? 'checked' : ''}> ${n}</label><span></span></div>`).join('');
    fl.querySelectorAll('[data-f]').forEach((n) => n.addEventListener('change', () => { S.show[n.dataset.f] = n.checked; refresh(); }));
  };
  const updateMarkerButtons = () => {
    const syms = { tbOwn: UI.SYM.own(S.ownEchelon), tbThreat: UI.SYM.threat(S.threatType), tbTarget: UI.SYM.target(), tbA: UI.SYM.sp(), tbB: UI.SYM.rp() };
    const size = { tbOwn: 15, tbThreat: 13, tbTarget: 14, tbA: 10, tbB: 10 };
    for (const [id, spec] of Object.entries(syms)) $(id).innerHTML = UI.symbolHTML(spec, size[id]);
    for (const [k, cmd] of [['own', 'tool:own'], ['threat', 'tool:threat'], ['target', 'tool:target'], ['a', 'tool:a'], ['b', 'tool:b']]) {
      const b = document.querySelector(`.tb[data-cmd="${cmd}"]`);
      if (b) b.classList.toggle('set', !!S.markers[k]);
    }
  };
  const renderWeaponParams = () => {
    const w = weaponOf($('wpnSelect').value);
    $('wpnParams').innerHTML = `Range ${F.dist(w.minR)} – ${F.dist(w.maxR)} · site slope ≤ ${w.siteSlope}° · access: ${esc(M.MOVEMENT_PROFILES[w.access].name.split(' (')[0])}` +
      ((cfg('weapons') || {})[w.id] ? ' · <b>edited</b>' : '');
  };
  const renderAll = () => {
    if (!S.grid) return;
    renderKeyList(); renderPostList(); renderWeaponList(); renderMfdList(); renderRouteList(); renderPicquetList();
    renderSituation(); renderSelection(); renderLayersPanel(); updateMarkerButtons(); renderWeaponParams(); renderDataInfo();
    renderAttrTable(); updateLegend(); updateStatusStatic(); updateScale();
  };

  // =================================================================== attribute table
  const attrRows = () => {
    const rows = [];
    const add = (sym, type, id, p, detail, ref, z) => rows.push({ sym, type, id, r: p.r, c: p.c, z: z ?? M.sample(S.grid, S.L.z, p.r, p.c), detail, ref });
    const mk = S.markers;
    if (mk.own) add(UI.SYM.own(S.ownEchelon), 'Own position', 'OWN', mk.own, S.ownEchelon, { kind: 'marker', idx: 'own' });
    if (mk.threat) add(UI.SYM.threat(S.threatType), 'Enemy', 'ENY', mk.threat, M.MOVEMENT_PROFILES[S.threatType].name, { kind: 'marker', idx: 'threat' });
    if (mk.target) add(UI.SYM.target(), 'Target area', 'TGT', mk.target, '', { kind: 'marker', idx: 'target' });
    if (mk.a) add(UI.SYM.sp(), 'Route start', 'A / SP', mk.a, '', { kind: 'marker', idx: 'a' });
    if (mk.b) add(UI.SYM.rp(), 'Route end', 'B / RP', mk.b, '', { kind: 'marker', idx: 'b' });
    if (S.key) {
      S.key.peaks.forEach((p, k) => add(null, 'Dominating height', `H${k + 1}`, p, `dominance ${F.height(p.prominence)}`, { kind: 'key', idx: k, sub: 'peak' }, p.z));
      S.key.passes.forEach((p, k) => add(null, 'Pass / col', `Col ${k + 1}`, p, '', { kind: 'key', idx: k, sub: 'pass' }, p.z));
    }
    if (S.posts) S.posts.posts.forEach((p, k) => add(S.posts.mode === 'op' ? UI.SYM.op() : UI.SYM.post(S.posts.echelon), S.posts.mode === 'op' ? 'Observation post' : 'Defended post', p.id, p,
      `sees ${F.area(p.visibleKm2)} · ${pct(p.valueShare, 1)} of approaches`, { kind: 'post', idx: k }, p.z));
    S.weapons.forEach((res, wi) => res.sites.forEach((s, k) => add(UI.SYM.weapon(res.weapon), `Weapon — ${res.weapon.short}`, s.id, s,
      s.cat === 'indirect' ? `${F.dist(s.rangeToTargetM)} to target · QE ${s.qeDeg === null ? '—' : F.angle(s.qeDeg)} · crest ${pct(s.clearShare)}`
        : `arc ${F.bearing(s.sector.left, s.r, s.c, true)}–${F.bearing(s.sector.right, s.r, s.c)} · ${pct(s.valueShare, 1)}`, { kind: 'weapon', idx: wi, sub: k }, s.z)));
    if (S.mfd) S.mfd.fields.forEach((f, k) => add(UI.SYM.mine(f.type), `Minefield ${f.type}`, f.id, f, `gap ${F.dist(f.gapM)} · front ${F.dist(f.frontM)} · ≈${f.estMines} mines`, { kind: 'mfd', idx: k }, f.z));
    if (S.avenues) S.avenues.routes.forEach((rt, k) => add(null, 'Enemy avenue', `AA${k + 1}`, { c: rt.line[0][0], r: rt.line[0][1] }, `${F.dist(rt.lengthM)} · ${F.time(rt.timeH)}`, { kind: 'avenue', idx: k }));
    if (S.routes) {
      S.routes.routes.forEach((rt, k) => add(null, 'Route', `R${k + 1}`, { c: rt.line[0][0], r: rt.line[0][1] }, `${F.dist(rt.lengthM)} · ${F.time(rt.timeH)} · ${F.height(rt.ascentM)}`, { kind: 'route', idx: k }));
      S.routes.routes[S.routes.sel || 0].checkpoints.forEach((cp, k) => add(UI.SYM.cp(k + 1), 'Checkpoint', `CKP ${k + 1}`, cp, `km ${(cp.d / 1000).toFixed(1)}`, { kind: 'cp', idx: k }));
    }
    if (S.picquets) S.picquets.picquets.forEach((p, k) => add(UI.SYM.picquet(), 'Picquet', p.id, p, `km ${p.routeFromKm === null ? '—' : p.routeFromKm.toFixed(1) + '–' + p.routeToKm.toFixed(1)} · climb ${F.time(p.climbH)}`, { kind: 'picquet', idx: k }, p.z));
    return rows;
  };
  const ATTR_COLS = [
    { k: 'sym', t: '' }, { k: 'type', t: 'Type' }, { k: 'id', t: 'ID' }, { k: 'ref', t: () => F.refName() }, { k: 'sec', t: () => (F.secondaryCRS() ? F.secondaryCRS().name : '') },
    { k: 'z', t: () => `Elev (${F.elevUnit()})` }, { k: 'detail', t: 'Details' },
  ];
  const attrValue = (row, k) => {
    if (k === 'ref') return F.listRef(row.r, row.c);
    if (k === 'sec') return F.secondaryCell(row.r, row.c);
    if (k === 'z') return F.elevNum(row.z);
    return row[k];
  };
  const renderAttrTable = () => {
    const tbl = $('attrTable');
    if (!S.grid) { tbl.innerHTML = ''; $('attrCount').textContent = ''; return; }
    let rows = attrRows();
    const q = $('attrFilter').value.trim().toLowerCase();
    if (q) rows = rows.filter((r) => ATTR_COLS.some((c) => c.k !== 'sym' && String(attrValue(r, c.k)).toLowerCase().includes(q)));
    const sc = S.sort;
    rows.sort((a, b) => {
      const va = attrValue(a, sc.col), vb = attrValue(b, sc.col);
      const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sc.desc ? -d : d;
    });
    const cols = ATTR_COLS.filter((c) => c.k !== 'sec' || F.secondaryCRS());
    $('attrCount').textContent = `(${rows.length})`;
    tbl.innerHTML = `<thead><tr>${cols.map((c) => `<th data-col="${c.k}" class="${sc.col === c.k ? 'sort' + (sc.desc ? ' desc' : '') : ''}">${esc(typeof c.t === 'function' ? c.t() : c.t)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-i="${i}" class="${S.sel && r.ref && JSON.stringify(S.sel) === JSON.stringify(r.ref) ? 'sel' : ''}">${cols.map((c) => c.k === 'sym'
        ? `<td>${r.sym ? UI.symbolHTML(r.sym, 12) : ''}</td>` : `<td class="${['ref', 'sec', 'z'].includes(c.k) ? 'm' : c.k === 'detail' ? 'wrap' : ''}">${esc(attrValue(r, c.k))}</td>`).join('')}</tr>`).join('')}</tbody>`;
    tbl.querySelectorAll('th[data-col]').forEach((th) => th.addEventListener('click', () => {
      if (th.dataset.col === 'sym') return;
      S.sort = { col: th.dataset.col, desc: S.sort.col === th.dataset.col ? !S.sort.desc : false };
      renderAttrTable();
    }));
    tbl.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => { const r = rows[+tr.dataset.i]; if (r.ref) select(r.ref, true); }));
    UI._attrRows = rows;
  };
  const exportCSV = () => {
    const rows = UI._attrRows || attrRows();
    const crs = F.secondaryCRS();
    const head = ['type', 'id', `ref_${cfg('ref.primary')}`, 'mgrs', 'lat', 'lon'].concat(crs ? [crs.name] : [], [`elev_${F.elevUnit()}`, 'details']);
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.map(q).join(',')].concat(rows.map((r) => {
      const ll = M.cellToLatLon(S.grid, r.r, r.c);
      return [r.type, r.id, F.listRef(r.r, r.c), F.ref(ll.lat, ll.lon, { kind: 'mgrs', digits: 5 }), ll.lat.toFixed(7), ll.lon.toFixed(7)]
        .concat(crs ? [F.secondaryCell(r.r, r.c)] : [], [F.elevNum(r.z), r.detail]).map(q).join(',');
    }));
    UI.download(fileName('features.csv'), '﻿' + lines.join('\r\n'), 'text/csv');
  };

  // =================================================================== dock / profile
  const showDockTab = (tab) => {
    document.querySelectorAll('.dock-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.dock === tab));
    document.querySelectorAll('[data-dockpanel]').forEach((p) => (p.hidden = p.dataset.dockpanel !== tab));
    document.querySelector('[data-dockpanel-tools]').hidden = tab !== 'table';
    if (tab === 'profile' && S.drawerData) UI.drawProfile($('chart'), S.drawerData);
  };
  const setDock = (open) => { $('dock').classList.toggle('collapsed', !open); $('dockToggle').textContent = open ? '▾' : '▴'; saveLayout(); };
  const openProfile = (title, data) => {
    S.drawerData = data;
    $('profileTitle').textContent = title;
    setDock(true);
    showDockTab('profile');
  };
  const showRouteProfile = () => {
    if (!S.routes) return;
    const rt = S.routes.routes[S.routes.sel || 0];
    openProfile(`Route R${(S.routes.sel || 0) + 1} — ${M.MOVEMENT_PROFILES[S.routes.profile].name} — ${F.dist(rt.lengthM)} — ${F.time(rt.timeH)}`,
      { profile: rt.profile, gradeColors: true, markers: rt.checkpoints.map((c, k) => ({ d: c.d, label: `CKP ${k + 1}` })) });
  };

  // =================================================================== panels & layout
  const TITLES = { data: 'Data', terrain: 'Terrain', mobility: 'Mobility', tactical: 'Tactical', routes: 'Routes', tools: 'Tools', layers: 'Layers' };
  const showTab = (name) => {
    document.querySelectorAll('#rail button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === name));
    $('sideTitle').textContent = TITLES[name];
    if ($('app').classList.contains('no-left')) { $('app').classList.remove('no-left'); saveLayout(); }
  };
  const LAYOUT_KEY = 'mtnai.layout.v1';
  const saveLayout = () => {
    try {
      const st = document.documentElement.style;
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({
        left: st.getPropertyValue('--left-w'), right: st.getPropertyValue('--right-w'), dock: st.getPropertyValue('--dock-h'),
        noLeft: $('app').classList.contains('no-left'), noRight: $('app').classList.contains('no-right'), dockClosed: $('dock').classList.contains('collapsed'),
      }));
    } catch (e) { /* storage unavailable */ }
  };
  const loadLayout = () => {
    let l = {};
    try { l = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}; } catch (e) { l = {}; }
    const st = document.documentElement.style;
    if (l.left) st.setProperty('--left-w', l.left);
    if (l.right) st.setProperty('--right-w', l.right);
    if (l.dock) st.setProperty('--dock-h', l.dock);
    $('app').classList.toggle('no-left', !!l.noLeft);
    $('app').classList.toggle('no-right', !!l.noRight);
    $('dock').classList.toggle('collapsed', l.dockClosed !== false);
    $('dockToggle').textContent = $('dock').classList.contains('collapsed') ? '▴' : '▾';
  };
  const initSplitters = () => {
    document.querySelectorAll('.splitter').forEach((sp) => sp.addEventListener('mousedown', (e) => {
      e.preventDefault();
      sp.classList.add('drag');
      const kind = sp.dataset.split;
      const st = document.documentElement.style;
      const move = (ev) => {
        if (kind === 'left') st.setProperty('--left-w', `${Math.max(220, Math.min(620, ev.clientX - $('rail').getBoundingClientRect().right))}px`);
        else if (kind === 'right') st.setProperty('--right-w', `${Math.max(220, Math.min(620, window.innerWidth - ev.clientX))}px`);
        else { $('dock').classList.remove('collapsed'); st.setProperty('--dock-h', `${Math.max(90, Math.min(window.innerHeight * 0.7, $('center').getBoundingClientRect().bottom - ev.clientY))}px`); }
      };
      const up = () => {
        sp.classList.remove('drag');
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        saveLayout();
        if (S.drawerData) UI.drawProfile($('chart'), S.drawerData);
      };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    }));
  };
  const applyTheme = () => {
    document.body.dataset.theme = cfg('ui.theme');
    document.body.dataset.density = cfg('ui.density');
    document.documentElement.style.setProperty('--fs', `${cfg('ui.fontSize')}px`);
  };

  /** Inputs inside panels bound directly to a setting (data-setting="key"). */
  const bindSettingInputs = () => {
    document.querySelectorAll('[data-setting]').forEach((el) => {
      const key = el.dataset.setting, it = Settings.ITEMS[key];
      if (el.tagName === 'SELECT' && !el.options.length) {
        const opts = typeof it.options === 'function' ? it.options() : it.options;
        el.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
      }
      if (it.min !== undefined) el.min = it.min;
      if (it.max !== undefined) el.max = it.max;
      el.addEventListener('change', () => Settings.set(key, el.type === 'checkbox' ? el.checked : el.value));
    });
    syncSettingInputs();
  };
  const syncSettingInputs = () => {
    document.querySelectorAll('[data-setting]').forEach((el) => {
      const v = cfg(el.dataset.setting);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    document.querySelectorAll('input[name=base]').forEach((n) => (n.checked = n.value === S.base));
    const p = profileOf($('mobProfile').value);
    $('mobGo').value = p.go; $('mobSlow').value = p.slow;
  };

  /** React to settings changes according to their apply tags. */
  const onSettings = async (keys) => {
    const tags = Settings.tags(keys);
    syncSettingInputs();
    if (tags.has('ui')) applyTheme();
    if (tags.has('sym')) UI.symbolCacheClear();
    if (tags.has('ovl')) for (const o of Object.values(S.overlays)) o.rgba = null;
    if (keys.includes('map.base')) S.base = cfg('map.base');
    if (!S.grid) { updateStatusStatic(); return; }
    try {
      if (tags.has('analysis')) { await pushConfig(); await syncSettings(); }
      if (keys.includes('weapons')) renderWeaponParams();
      if (tags.has('reanalyse')) { await reloadTerrain('landform scales changed'); return; }
      if (tags.has('zone')) {
        if (S.sources) { await reloadTerrain(`analysis projection ${cfg('crs.zone') === 'auto' ? 'automatic' : 'UTM zone ' + cfg('crs.zone')}`); return; }
        toast('The synthetic training area is defined in UTM zone 43N; the projection setting applies to imported DEMs.');
      }
      if (tags.has('hs')) await recomputeHillshade(true);
      if (tags.has('contours')) S.contours = await engine.call('contours', { interval: +cfg('map.contourInterval'), majorEvery: +cfg('map.contourIndex') });
      if (tags.has('mesh') && v3.ok) { v3.setTerrain(S.grid, S.L.z); S.texDirty = true; }
      if (tags.has('3d') && v3.ok) v3.setExaggeration(+cfg('v3.vex'));
      if (keys.includes('profiles') && S.overlays.mobility.data) await computeMobility(true);
    } catch (e) { toast(e.message, true); }
    refresh({ base: ['base', 'hs', 'contours', 'ovl', 'sym', 'reanalyse'].some((t) => tags.has(t)) });
    renderAll();
    if (S.view === '3d') updateTexture(true);
  };

  // =================================================================== view switching
  const setView = (v) => {
    if (v === '3d' && !v3.ok) { toast('WebGL2 is not available — 3D view disabled.', true); return; }
    if (!S.grid && v === '3d') return;
    S.view = v;
    $('btn2d').classList.toggle('on', v === '2d'); $('btn3d').classList.toggle('on', v === '3d');
    $('map2d').hidden = v !== '2d'; $('gl3d').hidden = v !== '3d'; $('ovl3d').hidden = v !== '3d';
    v3.visible = v === '3d';
    if (v === '3d') { v3.resize(); if (S.texDirty) updateTexture(true); v3.render(); } else { v3.stopFly(); map.resize(); }
    updateScale();
  };

  // =================================================================== plan save / load
  const savePlanObject = () => {
    if (!S.grid) return null;
    const strip = (o, keys) => { if (!o) return null; const c = Object.assign({}, o); for (const k of keys) delete c[k]; return c; };
    return {
      format: 'mtnai-plan', version: M.VERSION, created: new Date().toISOString(), grid: M.gridMeta(S.grid),
      markers: S.markers, obstacles: S.obstacles, tracks: S.tracks, threatType: S.threatType, ownEchelon: S.ownEchelon, snowLine: S.snowLine,
      key: S.key, posts: strip(S.posts, ['cover', 'dead']), weapons: S.weapons.map((w) => strip(w, ['cover'])),
      mfd: S.mfd, avenues: S.avenues, routes: S.routes && Object.assign({}, S.routes, { routes: S.routes.routes.map((r) => strip(r, ['path', 'profile'])) }), picquets: S.picquets,
    };
  };
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
  const applyPlan = async (plan, opts = {}) => {
    if (!plan || !S.grid) return;
    if (plan.format !== 'mtnai-plan') { toast('Not an MtnAI plan file.', true); return; }
    const p = UI.remapPlan(plan, plan.grid, S.grid);
    const inGrid = (m) => m && m.c >= 0 && m.r >= 0 && m.c < S.grid.w && m.r < S.grid.h;
    S.markers = {};
    for (const k in p.markers || {}) if (inGrid(p.markers[k])) S.markers[k] = { c: Math.round(p.markers[k].c), r: Math.round(p.markers[k].r) };
    Object.assign(S, { obstacles: p.obstacles || [], tracks: p.tracks || [], threatType: p.threatType || 'foot', ownEchelon: p.ownEchelon || 'battalion', snowLine: p.snowLine || 0 });
    if (!opts.silent || plan.grid.name === S.grid.name) {
      Object.assign(S, { key: p.key || null, posts: p.posts || null, mfd: p.mfd || null, avenues: p.avenues || null, picquets: p.picquets || null });
      S.weapons = (p.weapons || []).map((w) => Object.assign(w, { weapon: weaponOf(w.weapon.id) }));
      S.routes = p.routes || null;
      if (S.routes) {
        const pr = await Promise.all(S.routes.routes.map((r) => engine.call('profile', { pts: r.line })));
        S.routes.routes.forEach((r, k) => { r.profile = pr[k].profile; r.path = linePath(r.line); });
      }
    }
    $('threatType').value = S.threatType; $('ownEchelon').value = S.ownEchelon; $('mobSnow').value = S.snowLine;
    await syncSettings();
    $('obsInfo').textContent = S.obstacles.length || S.tracks.length ? `${S.obstacles.length} No-Go area(s), ${S.tracks.length} track(s).` : '';
    renderAll(); refresh({ base: true });
    if (!opts.silent) toast('Plan loaded.');
  };

  // =================================================================== export
  const fileName = (suffix) => `${cfg('rep.prefix') || ''}${(S.grid.name || 'mtnai').replace(/[^\w.-]+/g, '_').slice(0, 40)}_${suffix}`;
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
    const gl = $('gl3d'), hidden = gl.hidden;
    gl.hidden = false; $('ovl3d').hidden = false;
    v3.visible = true; v3.resize();
    if (S.texDirty) updateTexture(true);
    v3.home(); v3.draw();
    const c = document.createElement('canvas');
    c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(gl, 0, 0); ctx.drawImage($('ovl3d'), 0, 0);
    const url = c.toDataURL('image/png');
    v3.cam = cam; v3.visible = wasVisible; gl.hidden = hidden; $('ovl3d').hidden = hidden;
    if (wasVisible) v3.draw();
    return url;
  };
  const doExport = async (kind) => {
    if (!S.grid) { toast('Load a DEM first.', true); return; }
    if (kind === 'geojson') UI.download(fileName('features.geojson'), JSON.stringify(UI.toGeoJSON(S), null, 1), 'application/geo+json');
    else if (kind === 'csv') exportCSV();
    else if (kind === 'asc') {
      const mob = S.overlays.mobility;
      let arr, name, dec = 2;
      if (mob.visible && mob.data) { arr = mob.data; name = `mobility_${mob.profile}`; dec = 0; }
      else {
        const pick = { relief: ['z', 'elevation_m'], elevation: ['z', 'elevation_m'], slope: ['slope', 'slope_deg'], aspect: ['aspect', 'aspect_deg'], landform: ['landform', 'landform_class'], tri: ['tri', 'ruggedness_m'] }[S.base];
        arr = S.L[pick[0]]; name = pick[1]; dec = pick[0] === 'landform' ? 0 : 2;
      }
      UI.download(fileName(`${name}.asc`), UI.toASC(S.grid, arr, dec), 'text/plain');
      setTimeout(() => UI.download(fileName(`${name}.prj`), M.utmWKT(S.grid.zone, S.grid.north), 'text/plain'), 300);
      toast(`Exported ${name} as ESRI ASCII grid + .prj (${F.analysisCRSName()}).`);
    } else if (kind === 'png') {
      const url = S.view === '3d' ? snapshot3D() : $('map2d').toDataURL('image/png');
      UI.download(fileName(`${S.view}.png`), await (await fetch(url)).blob(), 'image/png');
    } else if (kind === 'plan') UI.download(fileName('plan.mtnai.json'), JSON.stringify(savePlanObject()), 'application/json');
    else if (kind === 'report') {
      const imgs = [];
      if (cfg('rep.map2d')) imgs.push(snapshot2D());
      if (cfg('rep.map3d')) { const i3 = snapshot3D(); if (i3) imgs.push(i3); }
      const html = UI.reportHTML(S, imgs);
      const w = window.open('', '_blank');
      if (!w) { UI.download(fileName('report.html'), html, 'text/html'); toast('Pop-up blocked — report downloaded as HTML.'); return; }
      w.document.open(); w.document.write(html); w.document.close();
    }
  };

  // =================================================================== go-to / conversion
  const gotoRef = (text) => {
    const box = document.querySelector('.tb-goto');
    const ll = F.parse(text);
    if (!ll || !S.grid) { box.classList.add('bad'); toast('Unrecognised reference. Accepted: MGRS, UTM, lat/lon (DD/DM/DMS), GARS, GEOREF or secondary-CRS E/N.', true); return; }
    box.classList.remove('bad');
    const p = M.latLonToCell(S.grid, ll.lat, ll.lon);
    if (!M.inGrid(S.grid, Math.round(p.r), Math.round(p.c))) { toast(`${F.ref(ll.lat, ll.lon)} is outside the loaded DEM.`, true); return; }
    S.gotoMark = { c: p.c, r: p.r };
    if (S.view === '3d') v3.lookAtCell(p.c, p.r, 4000); else map.centerOn(p.c, p.r, Math.max(map.view.scale, 3));
    select({ kind: 'point', c: p.c, r: p.r }, false);
  };
  const convert = () => {
    const ll = F.parse($('convIn').value);
    if (!ll) { $('convOut').innerHTML = pgrid([['Input', 'not recognised']]); return; }
    const crs = F.secondaryCRS();
    const zone = S.grid ? S.grid.zone : undefined;
    const rows = [
      ['MGRS (10-fig)', M.toMGRS(ll.lat, ll.lon, 5)], ['UTM', M.formatRef('utm', ll.lat, ll.lon)],
      ['Lat / Lon DMS', M.formatLatLon(ll.lat, ll.lon, 'dms', 2)], ['Lat / Lon DM', M.formatLatLon(ll.lat, ll.lon, 'dm', 4)], ['Lat / Lon DD', M.formatLatLon(ll.lat, ll.lon, 'dd', 6)],
      ['GARS', M.toGARS(ll.lat, ll.lon, 5)], ['GEOREF', M.toGEOREF(ll.lat, ll.lon, 3)],
    ];
    if (zone && M.utmZoneFor(ll.lat, ll.lon) !== zone) rows.splice(2, 0, [`UTM (zone ${zone})`, M.formatRef('utm', ll.lat, ll.lon, { zone })]);
    if (crs) rows.push([crs.name, M.formatRef('proj', ll.lat, ll.lon, { crs, geoStyle: 'dms', decimals: 2 })]);
    if (S.grid) {
      const p = M.latLonToCell(S.grid, ll.lat, ll.lon);
      rows.push(['In loaded DEM', M.inGrid(S.grid, Math.round(p.r), Math.round(p.c)) ? `yes — ${F.elev(M.sample(S.grid, S.L.z, p.r, p.c))}` : 'no']);
    }
    $('convOut').innerHTML = pgrid(rows);
  };

  // =================================================================== commands, menus, palette
  const need = () => !!S.grid;
  const CMD = {
    open: { t: 'Open elevation model…', k: 'Ctrl+O', run: () => $('demFiles').click() },
    demo: { t: 'Load demo terrain', run: loadDemo },
    fullExtent: { t: 'Full extent of DEM', need, run: safe(resetAOI) },
    reproject: { t: 'Re-analyse terrain (apply projection / scale settings)', need, run: safe(() => reloadTerrain('manual')) },
    loadPlan: { t: 'Open plan…', need, run: () => $('planFile').click() },
    savePlan: { t: 'Save plan', k: 'Ctrl+S', need, run: () => doExport('plan') },
    geojson: { t: 'Export features — GeoJSON', need, run: () => doExport('geojson') },
    csv: { t: 'Export attribute table — CSV', need, run: () => doExport('csv') },
    asc: { t: 'Export raster — ESRI ASCII grid', need, run: () => doExport('asc') },
    png: { t: 'Export view — PNG', need, run: () => doExport('png') },
    report: { t: 'Terrain assessment report', k: 'Ctrl+P', need, run: () => doExport('report') },
    settings: { t: 'Settings…', k: 'Ctrl+,', run: () => Settings.open() },
    view2d: { t: '2D map', k: '2', run: () => setView('2d'), on: () => S.view === '2d' },
    view3d: { t: '3D terrain', k: '3', need, run: () => setView('3d'), on: () => S.view === '3d' },
    fit: { t: 'Zoom to full extent', k: 'F', need, run: () => (S.view === '3d' ? v3.home() : map.fit()) },
    zoomIn: { t: 'Zoom in', k: '+', need, run: () => (S.view === '3d' ? ((v3.cam.dist *= 0.7), v3.render()) : map.zoomAt(map.W / 2, map.H / 2, 1.5)) },
    zoomOut: { t: 'Zoom out', k: '−', need, run: () => (S.view === '3d' ? ((v3.cam.dist /= 0.7), v3.render()) : map.zoomAt(map.W / 2, map.H / 2, 1 / 1.5)) },
    toggleLeft: { t: 'Side panel', k: 'Ctrl+B', run: () => { $('app').classList.toggle('no-left'); saveLayout(); }, on: () => !$('app').classList.contains('no-left') },
    toggleRight: { t: 'Properties / legend / activity pane', run: () => { $('app').classList.toggle('no-right'); saveLayout(); }, on: () => !$('app').classList.contains('no-right') },
    toggleDock: { t: 'Attribute table / profile dock', k: 'Ctrl+J', run: () => setDock($('dock').classList.contains('collapsed')), on: () => !$('dock').classList.contains('collapsed') },
    gridMgrs: { t: 'MGRS / UTM grid', run: () => Settings.set('grid.mgrs', !cfg('grid.mgrs')), on: () => cfg('grid.mgrs') },
    gridGrat: { t: 'Lat / lon graticule', run: () => Settings.set('grid.graticule', !cfg('grid.graticule')), on: () => cfg('grid.graticule') },
    gridSec: { t: 'Secondary CRS grid', run: () => Settings.set('grid.secondary', !cfg('grid.secondary')), on: () => cfg('grid.secondary') },
    contours: { t: 'Contours', run: () => Settings.set('map.contours', !cfg('map.contours')), on: () => cfg('map.contours') },
    labels: { t: 'Labels', run: () => Settings.set('sym.labels', !cfg('sym.labels')), on: () => cfg('sym.labels') },
    key: { t: 'Detect key terrain', need, run: safe(runKey) },
    mobility: { t: 'Compute Go / No-Go', need, run: safe(() => computeMobility(false)) },
    hostile: { t: 'Enemy observation (defilade)', need, run: safe(runHostile) },
    avenues: { t: 'Enemy avenues of approach', need, run: safe(runAvenues) },
    posts: { t: 'Suggest posts / OPs', need, run: () => { showTab('tactical'); safe(runPosts)(); } },
    weapons: { t: 'Suggest weapon sites', need, run: () => { showTab('tactical'); safe(runWeapons)(); } },
    clearWeapons: { t: 'Clear weapon sites', need, run: () => { S.weapons = []; updateWeaponCover(); renderAll(); refresh({ base: true }); } },
    mfd: { t: 'Suggest minefields (Mfd)', need, run: () => { showTab('tactical'); safe(runMfd)(); } },
    route: { t: 'Find route A → B', need, run: () => { showTab('routes'); safe(runRoute)(); } },
    picquets: { t: 'Suggest picquets for route', need, run: safe(runPicquets) },
    fly: { t: 'Fly route in 3D', need, run: () => { if (!S.routes) { toast('Find a route first.', true); return; } setView('3d'); if (v3.ok) v3.fly(S.routes.routes[S.routes.sel || 0].line); } },
    swapAB: { t: 'Swap route start and end', need, run: () => { [S.markers.a, S.markers.b] = [S.markers.b, S.markers.a]; renderAll(); refresh(); } },
    clearObstacles: { t: 'Clear digitised obstacles and tracks', need, run: () => { S.obstacles = []; S.tracks = []; safe(onObstaclesChanged)(); } },
    goto: { t: 'Go to coordinate…', k: 'Ctrl+G', need, run: () => $('gotoBox').focus() },
    convert: { t: 'Convert coordinate', run: () => { showTab('tools'); convert(); } },
    palette: { t: 'Command palette', k: 'Ctrl+K', run: () => openPalette() },
    help: { t: 'User guide', k: 'F1', run: () => openHelp('guide') },
    shortcuts: { t: 'Keyboard shortcuts', run: () => openHelp('keys') },
    about: { t: 'About MtnAI', run: () => openHelp('about') },
  };
  for (const [t, label, k] of [['own', 'Place own position'], ['threat', 'Place enemy position'], ['target', 'Place target area'], ['a', 'Place route start A'], ['b', 'Place route end B'],
    ['measure', 'Measure distance & bearing', 'M'], ['los', 'Line of sight', 'L'], ['vs', 'Viewshed', 'V'], ['poly', 'Digitise No-Go area'], ['line', 'Digitise track / road'], ['aoi', 'Crop to area of interest']]) {
    CMD['tool:' + t] = { t: label, k, need, run: () => setTool(t), on: () => S.tool === t };
  }
  for (const th of ['dark', 'light', 'contrast', 'night']) CMD['theme:' + th] = { t: { dark: 'Dark', light: 'Light', contrast: 'High contrast', night: 'Night (red)' }[th], run: () => Settings.set('ui.theme', th), on: () => cfg('ui.theme') === th };
  for (const sec of Settings.SCHEMA) CMD['settings:' + sec.id] = { t: `Settings — ${sec.title}`, run: () => Settings.open(sec.id) };
  const runCmd = (name) => {
    const c = CMD[name];
    if (!c) return;
    if (c.need && !c.need()) { toast('Load an elevation model first.', true); return; }
    closeMenus();
    c.run();
  };

  const MENUS = [
    ['File', ['open', 'demo', '-', 'tool:aoi', 'fullExtent', 'reproject', '-', 'loadPlan', 'savePlan', '-', 'geojson', 'csv', 'asc', 'png', 'report', '-', 'settings']],
    ['View', ['view2d', 'view3d', 'fit', '-', 'toggleLeft', 'toggleRight', 'toggleDock', '-', 'gridMgrs', 'gridGrat', 'gridSec', 'contours', 'labels', '-', '#Theme', 'theme:dark', 'theme:light', 'theme:contrast', 'theme:night']],
    ['Analysis', ['key', 'mobility', '-', 'hostile', 'avenues', '-', 'posts', 'weapons', 'mfd', '-', 'route', 'picquets', 'fly']],
    ['Tools', ['tool:own', 'tool:threat', 'tool:target', 'tool:a', 'tool:b', '-', 'tool:measure', 'tool:los', 'tool:vs', '-', 'tool:poly', 'tool:line', 'clearObstacles', '-', 'goto', 'convert', 'palette']],
    ['Settings', ['settings:crs', 'settings:refs', 'settings:north', 'settings:units', 'settings:grid', '-', 'settings:map', 'settings:sym', 'settings:ovl', 'settings:v3', '-', 'settings:an', 'settings:mov', 'settings:wpn', '-', 'settings:data', 'settings:rep', 'settings:ui']],
    ['Help', ['help', 'shortcuts', 'about']],
  ];
  let openMenu = null;
  const closeMenus = () => { $('menuLayer').innerHTML = ''; document.querySelectorAll('#menubar > button').forEach((b) => b.classList.remove('open')); openMenu = null; };
  const showMenu = (idx) => {
    closeMenus();
    openMenu = idx;
    const btn = document.querySelectorAll('#menubar > button')[idx];
    btn.classList.add('open');
    const r = btn.getBoundingClientRect();
    const m = document.createElement('div');
    m.className = 'menu';
    m.style.left = `${r.left}px`; m.style.top = `${r.bottom}px`;
    m.innerHTML = MENUS[idx][1].map((name) => {
      if (name === '-') return '<div class="sep"></div>';
      if (name[0] === '#') return `<div class="grp">${esc(name.slice(1))}</div>`;
      const c = CMD[name];
      const dis = c.need && !c.need();
      return `<button class="mi" data-mcmd="${name}" ${dis ? 'disabled' : ''}><span class="ck">${c.on && c.on() ? '✓' : ''}</span><span class="lb">${esc(c.t)}</span><span class="kb">${c.k || ''}</span></button>`;
    }).join('');
    m.querySelectorAll('[data-mcmd]').forEach((b) => b.addEventListener('click', () => runCmd(b.dataset.mcmd)));
    $('menuLayer').appendChild(m);
  };
  const initMenus = () => {
    $('menubar').innerHTML = MENUS.map(([t]) => `<button>${t}</button>`).join('');
    document.querySelectorAll('#menubar > button').forEach((b, i) => {
      b.addEventListener('mousedown', (e) => { e.stopPropagation(); if (openMenu === i) closeMenus(); else showMenu(i); });
      b.addEventListener('mouseenter', () => { if (openMenu !== null && openMenu !== i) showMenu(i); });
    });
    document.addEventListener('mousedown', (e) => { if (openMenu !== null && !e.target.closest('.menu') && !e.target.closest('#menubar')) closeMenus(); });
  };

  let palSel = 0, palItems = [];
  const openPalette = () => { $('palette').hidden = false; $('palInput').value = ''; palSel = 0; renderPalette(); $('palInput').focus(); };
  const closePalette = () => { $('palette').hidden = true; };
  const renderPalette = () => {
    const q = $('palInput').value.toLowerCase().split(/\s+/).filter(Boolean);
    palItems = Object.entries(CMD).filter(([n, c]) => q.every((w) => (c.t + ' ' + n).toLowerCase().includes(w)));
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    $('palList').innerHTML = palItems.map(([n, c], k) => `<div class="pal-i${k === palSel ? ' on' : ''}${c.need && !c.need() ? ' dis' : ''}" data-k="${k}"><span>${esc(c.t)}</span><small>${c.k || ''}</small></div>`).join('') || '<div class="pal-i dis">No matching command</div>';
    $('palList').querySelectorAll('[data-k]').forEach((n) => n.addEventListener('click', () => { closePalette(); runCmd(palItems[+n.dataset.k][0]); }));
    const on = $('palList').querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const openHelp = (section) => {
    const h = UI.helpHTML(section);
    $('helpTitle').textContent = h.title;
    $('helpBody').innerHTML = h.html;
    if (!$('help').open) $('help').showModal();
  };

  // =================================================================== init
  const init = () => {
    applyTheme();
    UI.applyIcons();
    loadLayout();
    map = new UI.Map2D($('map2d'), app);
    map.onRender = updateScale;
    v3 = new UI.View3D($('gl3d'), $('ovl3d'), app);
    UI.app = { map, v3, S, engine, loadDemo, importFiles, setView, setTool, doExport, runCmd };
    map.resize();
    initMenus();
    initSplitters();

    const profOpts = Object.values(M.MOVEMENT_PROFILES).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    $('mobProfile').innerHTML = profOpts; $('routeProfile').innerHTML = profOpts;
    $('wpnSelect').innerHTML = M.WEAPON_GROUPS.map((g) => `<optgroup label="${esc(g.name)}">${g.ids.map((id) => `<option value="${id}">${esc(M.WEAPONS[id].name)}</option>`).join('')}</optgroup>`).join('');
    for (const [id, k] of [['losObs', 'an.obsH'], ['losTgt', 'an.tgtH'], ['vsObs', 'an.obsH'], ['vsTgt', 'an.tgtH']]) $(id).value = cfg(k);
    bindSettingInputs();
    renderWeaponParams(); updateMarkerButtons(); renderLayersPanel(); updateStatusStatic(); renderSelection(); updateLegend();
    Settings.on((keys) => safe(onSettings)(keys));

    // command buttons anywhere
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (b && !b.disabled && !b.matches('label')) runCmd(b.dataset.cmd);
    });
    $('crsBadge').onclick = () => Settings.open('crs');
    document.querySelectorAll('#rail button').forEach((b) => b.addEventListener('click', () => {
      if (b.classList.contains('on') && !$('app').classList.contains('no-left')) { $('app').classList.add('no-left'); saveLayout(); return; }
      showTab(b.dataset.tab);
    }));
    $('sideCollapse').onclick = () => { $('app').classList.add('no-left'); saveLayout(); };
    document.querySelectorAll('.rsec > header').forEach((h) => h.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      h.parentElement.dataset.open = h.parentElement.dataset.open === '1' ? '0' : '1';
    }));
    $('logClear').onclick = () => { $('log').tBodies[0].innerHTML = ''; };
    document.querySelectorAll('.dock-tabs button').forEach((b) => b.addEventListener('click', () => { setDock(true); showDockTab(b.dataset.dock); }));
    $('dockToggle').onclick = () => setDock($('dock').classList.contains('collapsed'));
    $('attrFilter').addEventListener('input', renderAttrTable);
    new ResizeObserver(() => { if (!$('dock').classList.contains('collapsed') && S.drawerData && !document.querySelector('[data-dockpanel=profile]').hidden) UI.drawProfile($('chart'), S.drawerData); }).observe($('dock'));

    // data
    for (const id of ['demFiles', 'demFiles2', 'demFiles3']) $(id).onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };
    const stage = $('stage');
    stage.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    stage.addEventListener('drop', (e) => { e.preventDefault(); importFiles([...e.dataTransfer.files]); });
    const planInput = document.createElement('input');
    planInput.type = 'file'; planInput.accept = '.json'; planInput.id = 'planFile'; planInput.hidden = true;
    document.body.appendChild(planInput);
    planInput.onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f || !S.grid) return;
      try { await applyPlan(JSON.parse(await f.text())); } catch (err) { toast('Could not read plan: ' + err.message, true); }
    };

    // panels
    document.querySelectorAll('input[name=base]').forEach((n) => n.addEventListener('change', () => { S.base = n.value; refresh({ base: true }); }));
    $('mobProfile').onchange = syncSettingInputs;
    const updProfile = () => {
      const id = $('mobProfile').value;
      const o = JSON.parse(JSON.stringify(cfg('profiles') || {}));
      o[id] = Object.assign(o[id] || {}, { go: +$('mobGo').value, slow: Math.max(+$('mobGo').value + 1, +$('mobSlow').value) });
      Settings.set('profiles', o);
    };
    $('mobGo').onchange = updProfile; $('mobSlow').onchange = updProfile;
    $('mobSnow').onchange = (e) => { S.snowLine = +e.target.value; };
    $('mobGeneral').onchange = (e) => { S.generalize = e.target.checked; };
    $('threatType').onchange = async (e) => { S.threatType = e.target.value; S.avenues = null; clearOverlay('avenues'); await syncSettings(); renderAll(); refresh({ base: true }); };
    $('ownEchelon').onchange = (e) => { S.ownEchelon = e.target.value; renderAll(); refresh(); };
    $('wpnSelect').onchange = renderWeaponParams;
    $('mfdType').onchange = (e) => {
      const at = e.target.value === 'AT';
      $('mfdGap').value = at ? 600 : 300; $('mfdDepth').value = at ? 100 : 40; $('mfdDensity').value = at ? 1 : 3;
    };
    $('convIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') convert(); });
    $('gotoBox').addEventListener('keydown', (e) => { if (e.key === 'Enter') gotoRef(e.target.value); if (e.key === 'Escape') e.target.blur(); });
    $('gotoBox').addEventListener('input', () => document.querySelector('.tb-goto').classList.remove('bad'));

    // settings dialog
    const sd = $('settings');
    sd.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => sd.close()));
    $('help').querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => $('help').close()));
    $('setSearch').addEventListener('input', () => Settings.render());
    $('setExport').onclick = () => UI.download('mtnai-settings.json', Settings.exportJSON(), 'application/json');
    $('setImport').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try { Settings.importJSON(await f.text()); Settings.render(); toast('Settings imported.'); } catch (err) { toast(err.message, true); }
    };
    $('setResetAll').onclick = () => { if (confirm('Restore all settings to their defaults?')) { Settings.reset(); Settings.render(); } };

    // palette
    $('palette').addEventListener('mousedown', (e) => { if (e.target === $('palette')) closePalette(); });
    $('palInput').addEventListener('input', () => { palSel = 0; renderPalette(); });
    $('palInput').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { palSel = Math.min(palItems.length - 1, palSel + 1); renderPalette(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); renderPalette(); e.preventDefault(); }
      else if (e.key === 'Enter' && palItems[palSel]) { closePalette(); runCmd(palItems[palSel][0]); }
      else if (e.key === 'Escape') closePalette();
    });

    // keyboard
    window.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const combos = { o: 'open', s: 'savePlan', p: 'report', ',': 'settings', k: 'palette', g: 'goto', b: 'toggleLeft', j: 'toggleDock' };
      if (ctrl && combos[k]) { e.preventDefault(); runCmd(combos[k]); return; }
      if (e.key === 'F1') { e.preventDefault(); runCmd('help'); return; }
      if (e.target.matches('input, select, textarea') || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') { closeMenus(); if (v3._flying) v3.stopFly(); if (S.tool) setTool(null); else if (S.draft) { S.draft = null; map.render(); v3.render(); } return; }
      if (S.draft && (S.draft.kind === 'poly' || S.draft.kind === 'line')) {
        if (e.key === 'Enter') { e.preventDefault(); finishDraft(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); S.draft.pts.pop(); redrawDraft(); return; }
      }
      const keys = { 2: 'view2d', 3: 'view3d', f: 'fit', m: 'tool:measure', l: 'tool:los', v: 'tool:vs', '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', '/': 'palette' };
      if (!ctrl && keys[k] && (S.grid || k === '/')) { e.preventDefault(); runCmd(keys[k]); }
    });

    if (location.hash === '#demo' || cfg('ui.startup') === 'demo') loadDemo();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
