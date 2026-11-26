/*
 * MtnEye ui — application controller (ArcGIS Pro-style shell): state, ribbon, Contents
 * pane, geoprocessing tool handlers, Attributes pane, attribute table and settings.
 */
(function (UI) {
  'use strict';
  const M = UI.M, cfg = UI.cfg, Settings = UI.Settings, F = UI.F, GP = UI.GP;
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
      cover: { name: 'Observation coverage', legend: 'cover', opacity: 1 },
      wcover: { name: 'Fields of fire', legend: 'wcover', opacity: 1 },
      dead: { name: 'Dead ground', legend: 'dead', opacity: 1 },
      viewshed: { name: 'Viewshed', legend: 'viewshed', opacity: 1 },
      dominance: { name: 'Terrain value (dominance)', legend: 'dominance', opacity: 0.8 },
      firecov: { name: 'Fire coverage (weapons per square)', legend: 'firecov', opacity: 0.9 },
      routevs: { name: 'Route viewshed', legend: 'routevs', opacity: 0.9 },
      model: { name: 'Model result', legend: 'model', opacity: 0.85 },
    },
    sector: null, border: null, sec: {}, rvs: null, rvsLine: null,
    markers: {}, obstacles: [], tracks: [],
    threatType: 'foot', ownEchelon: 'battalion',
    key: null, posts: null, weapons: [], mfd: null, avenues: null, routes: null, picquets: null, helipads: null, hostile: null, los: null, vsPoint: null, gotoMark: null,
    mobStats: {}, snowLine: 0, generalize: false, relief: false,
    show: { symbols: true, labels: true, markers: true, obstacles: true, key: true, posts: true, weapons: true, mfd: true, routes: true, avenues: true, picquets: true, helipads: true, hostileOps: true,
      secArea: true, ridges: true, nullahs: true, itgs: true, plan: true, eappr: true, infil: true, eopts: true, bwatch: true, firegaps: true },
    tool: null, draft: null, sel: null, view: '2d', baseCanvas: null, texCanvas: null, texDirty: true,
    sort: { col: 'type', desc: false }, tocSel: null, tocCollapsed: {},
    // hybrid basemap ground layer, provenance of every engine run, user overlay order, symbol options
    imagery: { status: 'none', canvas: null, message: 'not requested yet' },
    runs: [], lastRun: {}, overlayOrder: null, explainTopic: null, hiddenRoutes: {}, markerOrigin: {}, ws: 'default', routePanelKey: null,
    symOpts: { own: { planned: false, designation: 'OWN', isHQ: false, affil: 'F', func: '', hqDesignation: '', size: 1 }, threat: { echelon: 'battalion', planned: false, designation: 'ENY', isHQ: false, affil: 'H', func: '', hqDesignation: '', size: 1 } },
    bm: { imagery: true, hillshade: true, terrain: true },
  });
  /** Marker symbol from the editable symbol options (echelon, HQ status, affiliation, function, status). */
  UI.markerSpec = (k) => {
    const o = S.symOpts[k] || {};
    const ech = k === 'own' ? S.ownEchelon : o.echelon || 'battalion';
    const icon = o.func || (k === 'threat' ? UI.SYM.threat(S.threatType).icon : 'inf');
    const spec = { set: 'unit', affil: o.affil || (k === 'own' ? 'F' : 'H'), icon, mods: icon === 'inf' && k === 'own' ? ['mountain'] : [], echelon: ech, planned: !!o.planned };
    if (o.isHQ) Object.assign(spec, { isHQ: true, hqText: o.hqDesignation || UI.HQ_TEXT[ech] || 'HQ' });
    return spec;
  };
  UI.ownSpec = () => UI.markerSpec('own');
  UI.threatSpec = () => UI.markerSpec('threat');
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
    GP.progress(Math.min(1, p || 0));
    if (msg) $('busyMsg').textContent = msg;
  };
  /** Geoprocessing history row: returns {done(detail), fail(message)}. */
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
  UI.runSeq = 0;
  /** Plain copy of job arguments for the processing record (large arrays / typed arrays dropped). */
  const sanitizeArgs = (a, depth = 0) => {
    if (a === null || a === undefined || depth > 4) return a;
    if (ArrayBuffer.isView(a)) return `[${a.length} values]`;
    if (Array.isArray(a)) return a.length > 24 ? `[${a.length} items]` : a.map((x) => sanitizeArgs(x, depth + 1));
    if (typeof a === 'object') { const o = {}; for (const [k, v] of Object.entries(a)) if (k !== 'path' && k !== 'cover') o[k] = sanitizeArgs(v, depth + 1); return o; }
    return a;
  };
  /** Records how a result was produced (shown by Explain This and kept with the plan file). */
  const recordRun = (label, cmd, args, t0, ok, summary) => {
    const r = { id: `RUN-${String(++UI.runSeq).padStart(4, '0')}`, label, cmd, args: sanitizeArgs(args), t: Date.now(), dur: performance.now() - t0, ok, summary: summary || '',
      engine: engine.mode === 'local' ? 'main thread (Web Worker unavailable)' : 'Web Worker', grid: S.grid ? `${S.grid.name} · ${S.grid.w}×${S.grid.h} @ ${S.grid.cs} m` : '' };
    S.runs.push(r);
    if (S.runs.length > 200) S.runs.shift();
    if (ok) S.lastRun[cmd] = r;
    return r;
  };
  const run = async (label, cmd, args, summarize) => {
    busy(true, label);
    const entry = logStart(label);
    const t0 = performance.now();
    try {
      const res = await engine.call(cmd, args, progress);
      const sum = summarize ? summarize(res) : '';
      const rr = recordRun(label, cmd, args, t0, true, sum);
      entry.done(`${rr.id} · ${sum}`);
      return res;
    } catch (e) {
      entry.fail(e.message);
      recordRun(label, cmd, args, t0, false, e.message);
      throw e;
    } finally { busy(false); UI.jobSeq++; }
  };
  const safe = (fn) => (...a) => Promise.resolve().then(() => fn(...a)).catch((e) => { toast(e.message, true); console.debug('MtnEye:', e.message); });

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
    obstacles: S.obstacles, tracks: S.tracks, profiles: cfg('profiles') || {}, snowLine: S.snowLine, generalize: S.generalize, relief: S.relief,
    sector: S.sector, border: S.border,
  });
  const weaponOf = (id) => M.weapon(id, (cfg('weapons') || {})[id]);
  const profileOf = (id) => Object.assign({}, M.MOVEMENT_PROFILES[id], (cfg('profiles') || {})[id] || {});
  /** Edit one field of a weapon / movement profile (stored in Settings); field null = restore defaults. */
  const setWeaponField = (id, field, val) => {
    const o = JSON.parse(JSON.stringify(cfg('weapons') || {}));
    if (field === null) delete o[id];
    else o[id] = Object.assign(o[id] || {}, { [field]: val === '' || val === null ? null : typeof M.WEAPONS[id][field] === 'number' || ['aimUp', 'aimDown'].includes(field) ? +val : val });
    Settings.set('weapons', o);
  };
  const setProfileField = (id, field, val) => {
    const o = JSON.parse(JSON.stringify(cfg('profiles') || {}));
    if (field === null) delete o[id];
    else o[id] = Object.assign(o[id] || {}, { [field]: +val });
    Settings.set('profiles', o);
  };

  // =================================================================== DEM loading
  const loadGrid = async (grid, opts = {}) => {
    busy(true, 'Analysing terrain…');
    const entry = logStart(`Add Data — ${grid.name}`);
    try {
      await pushConfig();
      const meta = M.gridMeta(grid);
      const res = await engine.call('init', { grid: Object.assign({}, meta, { z: grid.z }) }, progress);
      S.grid = meta;
      S.L = { z: res.z, slope: res.slope, aspect: res.aspect, landform: res.landform, tri: res.tri, tpiL: res.tpiL, hs: res.hs };
      S.stats = res.stats;
      S.filledCells = res.filled;
      S.sources = opts.sources || null;
      S.imagery = { status: 'none', canvas: null, message: 'not requested yet' };
      imageryGen++;
      S.lastRun = {}; // results of the previous DEM are cleared below; their records stay in S.runs
      S.drawerData = null; $('profileTitle').textContent = ''; { const cv = $('chart'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); } // profile of the previous DEM (bug in 1.0.0: it stayed on screen)
      if (opts.full) S.fullGrid = opts.full;
      Object.assign(S, { key: null, posts: null, weapons: [], mfd: null, avenues: null, routes: null, picquets: null, helipads: null, hostile: null, los: null, vsPoint: null, gotoMark: null, sel: null, mobStats: {}, draft: null });
      for (const o of Object.values(S.overlays)) { o.data = null; o.rgba = null; o.visible = false; }
      S.sec = {};
      if (!opts.keepPlan) { S.markers = {}; S.obstacles = []; S.tracks = opts.tracks || []; S.sector = opts.sector || null; S.border = opts.border || null; }
      if (!opts.keepPlan) S.markerOrigin = {};
      if (opts.markers) for (const k in opts.markers) { S.markers[k] = snapLowSlope(opts.markers[k]); S.markerOrigin[k] = 'demo generator'; }
      S.hiddenRoutes = {}; S.routePanelKey = null; undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
      await recomputeHillshade(true);
      progress(0.9, 'Contours');
      S.contours = await engine.call('contours', { interval: +cfg('map.contourInterval'), majorEvery: +cfg('map.contourIndex') });
      await syncSettings();
      $('welcome').hidden = true;
      document.body.classList.add('has-grid');
      $('mapCtl').hidden = false; $('srcChip').hidden = false;
      $('demName').textContent = `${meta.name} — ${meta.w} × ${meta.h} cells @ ${meta.cs} m`;
      updateEnabled();
      composeBase();
      map.fit();
      if (v3.ok) { v3.setTerrain(S.grid, S.L.z); v3.setExaggeration(+cfg('v3.vex')); updateTexture(true); }
      renderAll();
      const sum = `${meta.w}×${meta.h} @ ${meta.cs} m · ${F.analysisCRSName()} · ${F.elev(res.stats.elevMin)}–${F.elev(res.stats.elevMax)}`;
      entry.done(sum);
      recordRun(`Add Data — ${meta.name}`, 'init', { tpiSmallM: +cfg('an.tpiSmallM'), tpiLargeM: +cfg('an.tpiLargeM'), hillshadeAzimuth: +cfg('map.hsAzimuth'), hillshadeAltitude: +cfg('map.hsAltitude'), multiDirectional: cfg('map.hsMulti'), resample: cfg('data.resample') }, performance.now(), true, sum);
      requestImagery();
    } catch (e) {
      console.error(e);
      entry.fail(e.message);
      toast('Could not load DEM: ' + e.message, true);
      throw e;
    } finally { busy(false); UI.jobSeq++; }
  };

  const loadDemo = () => {
    busy(true, 'Generating synthetic training area…');
    setTimeout(async () => {
      try {
        const syn = M.syntheticTerrain();
        await loadGrid(syn.grid, { markers: syn.markers, full: syn.grid, tracks: syn.tracks, sector: syn.sector, border: syn.border });
        toast('Synthetic training area loaded (fictional terrain, UTM 43N). Own, enemy and target positions are pre-placed.');
      } catch (e) { /* reported */ } finally { busy(false); }
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

  // =================================================================== DEM download / raster export
  /** Browser PNG decoder for Terrarium tiles: raw RGBA without colour management. */
  const decodePNG = async (blob) => {
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  };
  /** Bounding box (lat/lon) from the Download DEM extent parameters. */
  const downloadBBox = (v) => {
    const fromCells = (r0, c0, r1, c1) => {
      const pts = [[r0, c0], [r0, c1], [r1, c0], [r1, c1]].map(([r, c]) => M.cellToLatLon(S.grid, r, c));
      return { west: Math.min(...pts.map((p) => p.lon)), east: Math.max(...pts.map((p) => p.lon)), south: Math.min(...pts.map((p) => p.lat)), north: Math.max(...pts.map((p) => p.lat)) };
    };
    if (v.extent === 'bbox') return { west: +v.west, south: +v.south, east: +v.east, north: +v.north };
    if (v.extent === 'dem' || v.extent === 'view') {
      if (!S.grid) throw new Error('No DEM is loaded — use a centre point or a bounding box.');
      if (v.extent === 'dem') return fromCells(0, 0, S.grid.h - 1, S.grid.w - 1);
      const [c0, r0] = map.toCell(0, 0), [c1, r1] = map.toCell(map.W, map.H);
      return fromCells(r0, c0, r1, c1);
    }
    const ll = F.parse(v.center);
    if (!ll) throw new Error('Centre reference not recognised (MGRS, UTM, lat/lon, GARS, GEOREF or secondary-CRS E/N).');
    const dLat = (+v.heightKm * 1000) / 2 / 110574, dLon = (+v.widthKm * 1000) / 2 / (111320 * Math.cos(M.rad(ll.lat)));
    return { west: ll.lon - dLon, east: ll.lon + dLon, south: ll.lat - dLat, north: ll.lat + dLat };
  };
  const tifName = (name) => `${(name || 'dem').replace(/[^\w.-]+/g, '_').slice(0, 50)}.tif`;
  const gpDownloadDEM = async (v) => {
    const bbox = downloadBBox(v);
    const areaKm2 = (bbox.east - bbox.west) * 111.32 * Math.cos(M.rad((bbox.north + bbox.south) / 2)) * (bbox.north - bbox.south) * 110.57;
    if (areaKm2 > 40000) throw new Error(`Extent is ${Math.round(areaKm2).toLocaleString()} km² — limit 40,000 km².`);
    busy(true, 'Downloading DEM…');
    const entry = logStart(`Download DEM — ${M.DEM_SOURCES[v.source].name.split(' (')[0].split(' —')[0]}`);
    try {
      const sources = await M.downloadDEM({ source: v.source, bbox, zoom: +v.zoom, dem: v.dem, apiKey: v.apiKey }, { fetch: (u) => fetch(u), decodePNG }, progress);
      const ras = sources[0];
      if (v.saveCopy) UI.download(tifName(ras.name), new Blob([M.writeGeoTIFF(ras)], { type: 'image/tiff' }), 'image/tiff');
      entry.done(`${ras.w} × ${ras.h} px · ${bbox.south.toFixed(3)}…${bbox.north.toFixed(3)}°N ${bbox.west.toFixed(3)}…${bbox.east.toFixed(3)}°E`);
      if (v.load) {
        const grid = withHemisphere(M.buildGrid(sources, importOpts()));
        await loadGrid(grid, { sources });
        return `${ras.name}\n${ras.w} × ${ras.h} source pixels → ${grid.w} × ${grid.h} cells @ ${grid.cs} m (${F.analysisCRSName()})${v.saveCopy ? '\nGeoTIFF copy saved — add it with Add Data to work offline.' : ''}`;
      }
      return `${ras.name} — ${ras.w} × ${ras.h} pixels${v.saveCopy ? ' saved as GeoTIFF.' : '.'}`;
    } catch (e) {
      entry.fail(e.message);
      throw new Error(/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Network unavailable — the DEM server could not be reached. Download needs internet access; analysis does not.' : e.message);
    } finally { busy(false); UI.jobSeq++; }
  };
  const gpExportRaster = async (v) => {
    needGrid();
    let arr, name;
    if (v.layer.startsWith('ovl:')) {
      const o = S.overlays[v.layer.slice(4)];
      if (!o || !o.data) throw new Error('That analysis raster has not been computed.');
      arr = o.data; name = v.layer.slice(4) + (v.layer === 'ovl:mobility' ? `_${o.profile}` : '');
    } else {
      arr = S.L[v.layer];
      name = { z: 'elevation_m', slope: 'slope_deg', aspect: 'aspect_deg', landform: 'landform_class', tri: 'ruggedness_m', hs: 'hillshade' }[v.layer];
    }
    if (v.format === 'tif') {
      const ras = M.gridRaster(S.grid, arr);
      UI.download(fileName(`${name}.tif`), new Blob([M.writeGeoTIFF(ras)], { type: 'image/tiff' }), 'image/tiff');
    } else {
      const dec = arr instanceof Float32Array || arr instanceof Float64Array ? 2 : 0;
      UI.download(fileName(`${name}.asc`), UI.toASC(S.grid, arr, dec), 'text/plain');
      setTimeout(() => UI.download(fileName(`${name}.prj`), M.utmWKT(S.grid.zone, S.grid.north), 'text/plain'), 300);
    }
    return `${name} written (${S.grid.w} × ${S.grid.h}, ${S.grid.cs} m, ${F.analysisCRSName()}).`;
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
      case 'dominance': o.rgba = UI.colorDominance(o.data); break;
      case 'routevs': o.rgba = UI.colorCount(o.data, [[120, 190, 255, 0.3], [70, 130, 240, 0.42], [40, 60, 200, 0.55]]); break;
      case 'model': o.rgba = UI.MB.rgba(o); break;
      case 'firecov': o.rgba = UI.colorCount(o.data, [[255, 214, 110, 0.32], [245, 150, 40, 0.42], [210, 70, 20, 0.5]]); break;
    }
    return o.rgba;
  };
  const OVERLAY_ORDER = ['dominance', 'mobility', 'hostile', 'avenues', 'cover', 'wcover', 'dead', 'firecov', 'routevs', 'model', 'viewshed'];
  /** Drawing order of analysis rasters (bottom first); the user can reorder them in Contents. */
  const overlayOrder = () => {
    if (!S.overlayOrder || S.overlayOrder.length !== OVERLAY_ORDER.length) S.overlayOrder = OVERLAY_ORDER.slice();
    return S.overlayOrder;
  };
  const moveOverlay = (id, dir) => {
    const o = overlayOrder(), i = o.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    refresh({ base: true });
  };
  const basemapMode = () => cfg('map.mode') || 'hybrid';

  // ---------------------------------------------------------------- hybrid basemap ground layer
  let imageryGen = 0;
  /** Simulated terrain colouring at grid resolution (offline / synthetic fallback — never called imagery). */
  const simCanvas = () => {
    const g = S.grid;
    if (S._sim && S._sim.hs === S.L.hs && S._sim.w === g.w && S._sim.h === g.h) return S._sim.cv;
    const cv = document.createElement('canvas');
    cv.width = g.w; cv.height = g.h;
    cv.getContext('2d').putImageData(new ImageData(UI.simulatedGround(S.L, S.stats), g.w, g.h), 0, 0);
    S._sim = { cv, hs: S.L.hs, w: g.w, h: g.h };
    return cv;
  };
  const hsCanvas = () => {
    const g = S.grid;
    if (S._hsc && S._hsc.hs === S.L.hs) return S._hsc.cv;
    const n = g.w * g.h, rgba = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { const v = S.L.hs[i]; rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; }
    const cv = document.createElement('canvas');
    cv.width = g.w; cv.height = g.h;
    cv.getContext('2d').putImageData(new ImageData(rgba, g.w, g.h), 0, 0);
    S._hsc = { cv, hs: S.L.hs };
    return cv;
  };
  const imageryReady = () => S.imagery.status === 'ready' && S.imagery.canvas;
  const updateSourceChip = () => {
    const chip = $('srcChip'), at = $('attrib');
    if (!chip || !S.grid) return;
    const im = S.imagery, mode = basemapMode();
    let cls = 'ok', txt, attr = '';
    if (mode === 'topo') { txt = `Topographic basemap · ${BASE_NAMES[S.base]} (offline)`; }
    else if (im.status === 'loading') { cls = 'load'; txt = `Loading satellite imagery… ${Math.round((im.progress || 0) * 100)}%`; attr = 'Simulated terrain colouring shown until imagery arrives'; }
    else if (imageryReady()) { txt = `${mode === 'hybrid' ? 'Hybrid' : 'Imagery'} · ${UI.IMAGERY_SOURCES[im.sourceId].name} · z${im.z}${im.failed ? ` · ${im.failed} tiles missing` : ''}`; attr = UI.IMAGERY_SOURCES[im.sourceId].attribution; if (im.failed) cls = 'warn'; }
    else { cls = 'warn'; txt = im.status === 'synthetic' ? `${mode === 'hybrid' ? 'Hybrid' : 'Ground'} · simulated terrain colouring (synthetic DEM — not imagery)` : `Imagery unavailable — simulated terrain colouring (${im.status === 'off' ? 'imagery off' : 'offline / blocked'})`; attr = 'Ground colouring is simulated from the DEM — not imagery'; }
    chip.className = cls;
    $('srcText').textContent = txt;
    chip.title = `${im.message || ''}\nClick for data source and methodology.`;
    at.textContent = attr; at.hidden = !attr || !S.bm.imagery || mode === 'topo' || !imageryReady(); // attribution is required for real imagery; the chip flags simulated colouring
  };
  /** Fetch imagery for the loaded DEM (only network use besides DEM download). */
  const requestImagery = async () => {
    const g = S.grid;
    if (!g) return;
    const my = ++imageryGen;
    const src = cfg('map.imagerySource');
    const set = (o) => { S.imagery = Object.assign({ canvas: null }, o); updateSourceChip(); };
    if (basemapMode() === 'topo') { set({ status: 'none', message: 'Topographic basemap selected — imagery not requested.' }); renderTOC(); return; }
    if (g.synthetic) { set({ status: 'synthetic', message: 'Synthetic (fictional) terrain: real imagery would not match the ground, so a simulated terrain colouring is shown instead.' }); renderTOC(); refresh({ base: true }); return; }
    if (src === 'none') { set({ status: 'off', message: 'Imagery source is set to None (Settings ▸ Map display).' }); renderTOC(); refresh({ base: true }); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { set({ status: 'unavailable', sourceId: src, message: 'The browser reports no network connection — imagery is unavailable offline.' }); renderTOC(); refresh({ base: true }); return; }
    const k = texScale();
    const cv = document.createElement('canvas');
    cv.width = g.w * k; cv.height = g.h * k;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.drawImage(simCanvas(), 0, 0, cv.width, cv.height);
    set({ status: 'loading', sourceId: src, progress: 0, message: 'Requesting imagery tiles…' });
    renderTOC();
    const entry = logStart(`Basemap imagery — ${(UI.IMAGERY_SOURCES[src] || {}).name || src}`);
    const t0 = performance.now();
    let res = null, err = null;
    try {
      res = await UI.buildImagery(cv, g, k, src, { customUrl: cfg('map.imageryUrl') }, (p) => { if (my === imageryGen && S.imagery.status === 'loading') { S.imagery.progress = p; updateSourceChip(); } });
      if (res.loaded) cx.getImageData(0, 0, 1, 1); // throws if the server's tiles tainted the canvas
    } catch (e) { err = e; }
    if (my !== imageryGen) return; // superseded by a newer request
    if (err || !res || !res.loaded) {
      const why = err ? err.message : res && res.errors.length ? res.errors[0] : 'no tiles returned';
      set({ status: 'unavailable', sourceId: src, message: `${(UI.IMAGERY_SOURCES[src] || {}).name || 'Imagery server'} could not be used (${/fetch|network|abort/i.test(why) ? 'network unavailable, blocked or no CORS' : why}). A simulated terrain colouring is shown instead.` });
      entry.fail(S.imagery.message);
      recordRun('Basemap imagery', 'imagery', { source: src, zoom: res && res.z }, t0, false, S.imagery.message);
    } else {
      set({ status: 'ready', canvas: cv, sourceId: src, url: res.source.url, z: res.z, resM: res.resM, tiles: res.tiles, loaded: res.loaded, failed: res.failed,
        message: `${res.loaded} of ${res.tiles} tiles at zoom ${res.z} (≈ ${res.resM.toFixed(1)} m / px).` });
      entry.done(S.imagery.message);
      recordRun('Basemap imagery', 'imagery', { source: src, zoom: res.z, tiles: res.tiles }, t0, true, S.imagery.message);
    }
    renderTOC();
    refresh({ base: true });
  };

  const composeBase = () => {
    const g = S.grid;
    if (!g) return;
    const k = texScale();
    const tex = S.baseCanvas || document.createElement('canvas');
    tex.width = g.w * k; tex.height = g.h * k;
    const ctx = tex.getContext('2d');
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const mode = basemapMode();
    if (mode === 'topo') {
      ctx.drawImage(putSmall(UI.colorBase(S.base, S.L, S.stats, +cfg('map.blend'))), 0, 0, tex.width, tex.height);
    } else {
      // 1 ground: satellite imagery, or the labelled simulated colouring when imagery is unavailable
      ctx.fillStyle = cfg('map.background'); ctx.fillRect(0, 0, tex.width, tex.height);
      if (S.bm.imagery) {
        ctx.globalAlpha = Math.max(0, Math.min(1, +cfg('map.imageryOpacity')));
        ctx.drawImage(imageryReady() ? S.imagery.canvas : simCanvas(), 0, 0, tex.width, tex.height);
        ctx.globalAlpha = 1;
      }
      if (mode === 'hybrid') {
        // 2 relief: hillshade blended (overlay) so slopes read on top of photo texture
        const hsA = +cfg('map.hybridHillshade');
        if (S.bm.hillshade && hsA > 0) {
          ctx.globalCompositeOperation = S.bm.imagery ? 'overlay' : 'source-over';
          ctx.globalAlpha = hsA;
          ctx.drawImage(hsCanvas(), 0, 0, tex.width, tex.height);
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        }
        // 3 terrain symbology (slope, aspect, landforms, ruggedness, elevation) as a translucent layer
        const tA = +cfg('map.terrainOverlay');
        if (S.bm.terrain && S.base !== 'relief' && tA > 0) {
          ctx.globalAlpha = tA;
          ctx.drawImage(putSmall(UI.colorBase(S.base, S.L, S.stats, 0)), 0, 0, tex.width, tex.height);
          ctx.globalAlpha = 1;
        }
      }
    }
    // display-only high-altitude tint (Settings ▸ Map display ▸ snow tint)
    const snowM = +cfg('map.snowLineM');
    if (snowM > 0) {
      const n = g.w * g.h, rgba = new Uint8ClampedArray(n * 4);
      for (let i = 0; i < n; i++) if (S.L.z[i] >= snowM) { rgba[i * 4] = 226; rgba[i * 4 + 1] = 247; rgba[i * 4 + 2] = 250; rgba[i * 4 + 3] = 110; }
      ctx.drawImage(putSmall(rgba), 0, 0, tex.width, tex.height);
    }
    const tmp = document.createElement('canvas');
    tmp.width = tex.width; tmp.height = tex.height;
    const tctx = tmp.getContext('2d');
    for (const id of overlayOrder()) {
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
    if (cfg('map.contours')) {
      const onImagery = mode !== 'topo' && S.bm.imagery;
      UI.drawContours(ctx, S.contours, { xy: (c, r) => [(c + 0.5) * k, (r + 0.5) * k], lw: Math.max(1, k * 0.55), cased: onImagery, contourColor: onImagery ? cfg('map.contourHybridColor') : null });
    }
    S.baseCanvas = tex;
    S.texDirty = true;
    updateSourceChip();
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
      if (UI.drawRouteMarks) UI.drawRouteMarks(ctx, S, P, { labels: false });
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
    renderTOC();
    renderAttrTable();
  };
  UI.onSymbolReady(() => { map && map.render(); if (S.view === '3d') { v3.render(); updateTexture(); } });

  // =================================================================== Contents pane (layer tree)
  const symSw = (spec, size = 14) => `<span class="lg-sym">${UI.symbolHTML(spec, size)}</span>`;
  const lineSw = (color, dash) => `<span class="lg-line" style="border-top:3px ${dash ? 'dashed' : 'solid'} ${color}"></span>`;
  const polySw = (fill, line) => `<span class="lg-poly" style="background:${fill};border-color:${line}"></span>`;
  const swatches = (rows) => `<div class="lg">${rows.map(([sw, t]) => `<div>${sw}<span>${esc(t)}</span></div>`).join('')}</div>`;
  const rasterLegend = (kind, info) => (UI.legendHTML(kind, info || {}) || '').replace(/^<h4>[\s\S]*?<\/h4>/, '');
  const baseInfo = () => {
    const i = { min: F.elevNum(S.stats.elevMin), max: F.elevNum(S.stats.elevMax) };
    if (S.base === 'tri') i.max = UI.percentile(S.L.tri, 0.98);
    return i;
  };
  const BASE_NAMES = { relief: 'Shaded relief', elevation: 'Elevation (hypsometric)', slope: 'Slope', aspect: 'Aspect', landform: 'Landforms (TPI)', tri: 'Ruggedness (TRI)' };
  const showFlag = (k) => ({ visible: () => S.show[k] !== false, setVisible: (v) => { S.show[k] = v; refresh(); } });
  const settingFlag = (k) => ({ visible: () => !!cfg(k), setVisible: (v) => Settings.set(k, v) });
  const bmFlag = (k) => ({ visible: () => S.bm[k] !== false, setVisible: (v) => { S.bm[k] = v; refresh({ base: true }); } });

  /** The layer model behind the Contents pane, attribute table and context menu. */
  const tocModel = () => {
    if (!S.grid) return [];
    const mk = S.markers;
    const feat = [];
    const nMk = Object.keys(mk).filter((k) => mk[k]).length;
    if (nMk) feat.push(Object.assign({ id: 'markers', name: 'Situation', count: nMk, table: true, legend: swatches([[symSw(UI.ownSpec()), 'Own position'], [symSw(UI.threatSpec()), 'Enemy'], [symSw(UI.SYM.target()), 'Target area'], [symSw(UI.SYM.sp(), 12), 'Route start (SP) / end (RP)']]),
      remove: () => { S.markers = {}; safe(syncSettings)(); } }, showFlag('markers')));
    if (S.obstacles.length || S.tracks.length) feat.push(Object.assign({ id: 'obstacles', name: 'Obstacles & tracks', count: S.obstacles.length + S.tracks.length,
      legend: swatches([[polySw('rgba(217,58,50,0.35)', '#ff5b4f'), `No-Go areas (${S.obstacles.length})`], [lineSw('#c8955c', true), `Tracks (${S.tracks.length})`]]),
      remove: () => { S.obstacles = []; S.tracks = []; safe(onObstaclesChanged)(); } }, showFlag('obstacles')));
    if (S.rvs) feat.push(Object.assign({ id: 'rvs', name: `Route viewshed — ${S.rvs.label}`, count: S.rvs.watch.length, table: true,
      legend: swatches([[lineSw('#3b6fe0'), 'Route'], [symSw(UI.SYM.op(), 12), 'Best watch point']]), remove: () => { S.rvs = null; clearOverlay('routevs'); } }, showFlag('rvs')));
    if (S.helipads) feat.push(Object.assign({ id: 'helipads', name: 'Helipad sites (HLS)', count: S.helipads.pads.length, table: true, legend: swatches([['<span class="lg-txt">Ⓗ</span>', `${S.helipads.pads[0] ? S.helipads.pads[0].use : ''} — ≤ ${S.helipads.params.use === 'regular' ? 4 : S.helipads.params.use === 'light' ? 10 : 20}°`]]), remove: () => { S.helipads = null; } }, showFlag('helipads')));
    if (S.picquets) feat.push(Object.assign({ id: 'picquets', name: 'Route picquets', count: S.picquets.picquets.length, table: true, legend: swatches([[symSw(UI.SYM.picquet()), 'Picquet (planned)']]), remove: () => { S.picquets = null; } }, showFlag('picquets')));
    if (S.routes) feat.push(Object.assign({ id: 'routes', name: `Routes — ${M.MOVEMENT_PROFILES[S.routes.profile].name.split(' (')[0]}`, count: S.routes.routes.length, table: true,
      legend: swatches([[lineSw(cfg('sym.routeColor')), 'Selected route'], [lineSw(cfg('sym.routeColor'), true), 'Alternative'], [symSw(UI.SYM.cp(1), 12), 'Checkpoint']]), remove: () => { S.routes = null; S.picquets = null; } }, showFlag('routes')));
    if (S.mfd) feat.push(Object.assign({ id: 'mfd', name: 'Minefields', count: S.mfd.fields.length, table: true, legend: swatches([[symSw(UI.SYM.mine('AT'), 12), 'Anti-tank (planned)'], [symSw(UI.SYM.mine('AP'), 12), 'Anti-personnel (planned)']]), remove: () => { S.mfd = null; } }, showFlag('mfd')));
    S.weapons.forEach((res, wi) => feat.push({ id: 'weapons:' + wi, name: `Weapon sites — ${res.weapon.short}`, count: res.sites.length, table: true,
      legend: swatches([[symSw(UI.SYM.weapon(res.weapon)), res.weapon.name]].concat(res.weapon.cat !== 'indirect' ? [[lineSw(cfg('sym.sectorColor'), true), 'Arc of fire']] : [])),
      visible: () => S.show.weapons && !res.hidden, setVisible: (v) => { res.hidden = !v; if (v) S.show.weapons = true; refresh(); },
      remove: () => { S.weapons.splice(wi, 1); updateWeaponCover(); } }));
    if (S.posts) feat.push(Object.assign({ id: 'posts', name: S.posts.mode === 'op' ? 'Observation posts' : 'Defended posts', count: S.posts.posts.length, table: true,
      legend: swatches([[symSw(S.posts.mode === 'op' ? UI.SYM.op() : UI.SYM.post(S.posts.echelon)), S.posts.mode === 'op' ? 'OP (planned)' : `Post — ${S.posts.echelon} (planned)`], [lineSw('rgba(128,224,255,0.85)', true), 'Intervisibility']]),
      remove: () => { S.posts = null; clearOverlay('cover'); clearOverlay('dead'); } }, showFlag('posts')));
    if (S.hostile) feat.push(Object.assign({ id: 'hostileOps', name: 'Likely enemy OPs', count: S.hostile.observers.filter((o) => !o.isThreat).length, legend: swatches([[symSw(UI.SYM.hostileOP(), 12), 'Likely enemy OP']]), remove: () => { S.hostile = null; } }, showFlag('hostileOps')));
    if (S.avenues) feat.push(Object.assign({ id: 'avenues', name: 'Enemy avenues of approach', count: S.avenues.routes.length, table: true, legend: swatches([[lineSw(cfg('sym.avenueColor'), true), 'Avenue (least-time)']]), remove: () => { S.avenues = null; clearOverlay('avenues'); } }, showFlag('avenues')));
    if (S.key) feat.push(Object.assign({ id: 'key', name: 'Key terrain', count: S.key.peaks.length + S.key.passes.length, table: true, legend: swatches([['<span class="lg-txt">▲</span>', `Dominating heights (${S.key.peaks.length})`], ['<span class="lg-txt" style="font-family:Georgia">)(</span>', `Passes / cols (${S.key.passes.length})`]]), remove: () => { S.key = null; } }, showFlag('key')));
    if (S.los) feat.push({ id: 'los', name: 'Line of sight', legend: swatches([[lineSw('#3ddc66'), 'Visible'], [lineSw('#ff4136'), 'Masked']]), visible: () => true, setVisible: () => {}, remove: () => { S.los = null; } });

    const ras = overlayOrder().slice().reverse().filter((id) => S.overlays[id].data).map((id) => {
      const o = S.overlays[id];
      return { id: 'ovl:' + id, name: id === 'mobility' && o.info ? `Mobility — ${o.info.name.split(' (')[0]}` : o.name, raster: true, legend: rasterLegend(o.legend, o.info),
        visible: () => o.visible, setVisible: (v) => { o.visible = v; refresh({ base: true }); },
        opacity: () => o.opacity, setOpacity: (v) => { o.opacity = v; refresh({ base: true }); },
        remove: () => { clearOverlay(id); if (id === 'viewshed') S.vsPoint = null; refresh({ base: true }); } };
    });
    const crs = F.secondaryCRS();
    const grids = [
      Object.assign({ id: 'g:mgrs', name: `MGRS / UTM ${S.grid.zone}${S.grid.north ? 'N' : 'S'} grid`, legend: swatches([[lineSw(cfg('grid.mgrsColor')), `${F.dist(+cfg('grid.mgrsInterval') || 1000)} squares`]]), settings: 'grid' }, settingFlag('grid.mgrs')),
      Object.assign({ id: 'g:grat', name: 'Graticule (WGS 84)', legend: swatches([[lineSw(cfg('grid.graticuleColor')), 'Lat / lon lines']]), settings: 'grid' }, settingFlag('grid.graticule')),
      ...(crs ? [Object.assign({ id: 'g:sec', name: `${crs.name} grid`, legend: swatches([[lineSw(cfg('grid.secondaryColor')), 'Secondary CRS']]), settings: 'grid' }, settingFlag('grid.secondary'))] : []),
      Object.assign({ id: 'g:contours', name: `Contours (${+cfg('map.contourInterval') ? `${cfg('map.contourInterval')} m` : 'auto'})`, legend: swatches([[lineSw(cfg('map.contourColor')), 'Index / intermediate']]), settings: 'map' }, settingFlag('map.contours')),
      Object.assign({ id: 'g:labels', name: 'Labels', settings: 'sym' }, settingFlag('sym.labels')),
    ];
    const mode = basemapMode(), im = S.imagery;
    const imStatus = () => {
      if (im.status === 'loading') return ['load', `Loading tiles… ${Math.round((im.progress || 0) * 100)}%`];
      if (imageryReady()) return [im.failed ? 'warn' : 'ok', `${im.loaded}/${im.tiles} tiles · zoom ${im.z} · ≈ ${im.resM.toFixed(1)} m/px · internet`];
      return ['warn', im.status === 'synthetic' ? 'Synthetic DEM — simulated colouring, not imagery' : im.status === 'off' ? 'Imagery off — simulated colouring, not imagery' : 'Unavailable (offline / blocked) — simulated colouring, not imagery'];
    };
    const base = mode === 'topo' ? [{ id: 'dem', name: S.grid.name, sub: `${BASE_NAMES[S.base]} · topographic basemap (offline)`, legend: rasterLegend(S.base, baseInfo()), raster: true, isBase: true,
      visible: () => true, setVisible: () => {}, settings: 'map' }] : [
      ...(mode === 'hybrid' ? [Object.assign({ id: 'bm:terrain', name: `Terrain symbology — ${BASE_NAMES[S.base]}`, sub: S.base === 'relief' ? 'Relief is shown by the hillshade layer; pick slope / aspect / landforms… from Basemap' : null,
        legend: S.base === 'relief' ? '' : rasterLegend(S.base, baseInfo()), raster: true, isBm: true, settings: 'map',
        opacity: () => +cfg('map.terrainOverlay'), setOpacity: (v) => Settings.set('map.terrainOverlay', +v.toFixed(2)) }, bmFlag('terrain')),
      Object.assign({ id: 'bm:hillshade', name: 'Hillshade (relief)', raster: true, isBm: true, settings: 'map', legend: rasterLegend('relief'),
        opacity: () => +cfg('map.hybridHillshade'), setOpacity: (v) => Settings.set('map.hybridHillshade', +v.toFixed(2)) }, bmFlag('hillshade'))] : []),
      Object.assign({ id: 'bm:imagery', name: imageryReady() ? `Satellite imagery — ${UI.IMAGERY_SOURCES[im.sourceId].name}` : 'Ground colouring — SIMULATED (not imagery)', status: imStatus(), raster: true, isBm: true, settings: 'map',
        opacity: () => +cfg('map.imageryOpacity'), setOpacity: (v) => Settings.set('map.imageryOpacity', +v.toFixed(2)) }, bmFlag('imagery')),
      { id: 'dem', name: S.grid.name, sub: `Elevation model · ${S.grid.cs} m cells`, raster: true, isBase: true, visible: () => true, setVisible: () => {}, settings: 'map' },
    ];
    const X = S.sec, secL = [];
    const sl = (id, name, count, legend, remove) => secL.push(Object.assign({ id, name, count, table: true, legend, remove }, showFlag(id)));
    if (X.opts) sl('eopts', 'Enemy courses of action', X.opts.options.length, swatches([[lineSw('#c00000'), 'Main thrust'], [lineSw('#c00000', true), 'Supporting thrust']]), () => { delete X.opts; });
    if (X.infil) sl('infil', 'Infiltration routes', X.infil.routes.length, swatches([[lineSw('#8b0000', true), 'Hidden route (threat)']]), () => { delete X.infil; });
    if (X.appr) sl('eappr', 'Enemy approaches (across the border)', X.appr.approaches.length, swatches([[lineSw('#ff4136', true), 'Approach to an ITG']]), () => { delete X.appr; delete X.opts; });
    if (X.watch) sl('bwatch', `Border watch — ${Math.round(X.watch.observedShare * 100)}% observed`, X.watch.gaps.length + X.watch.extraOPs.length, swatches([[lineSw('#ff00ff'), 'Unwatched stretch'], [symSw(UI.SYM.op(), 12), 'Extra OP (suggested)']]), () => { delete X.watch; });
    if (X.fire) sl('firegaps', 'Fire gaps on approaches', X.fire.gaps.length, swatches([['<span class="lg-txt">◇</span>', 'Under-covered stretch']]), () => { delete X.fire; clearOverlay('firecov'); });
    if (X.plan) sl('plan', `Deployment — ${X.plan.modeName}`, X.plan.platoons.length + X.plan.borderPosts.length + X.plan.companies.length + 1,
      swatches([[symSw(UI.SYM.post('platoon')), 'Platoon post'], [symSw(UI.SYM.op(), 12), 'Border post'], [symSw(UI.SYM.hq('company'), 12), 'Company / Bn HQ (HQ square)'], [symSw(UI.SYM.weapon(M.WEAPONS.mor60), 12), 'Mortar']]), () => { delete X.plan; delete X.fire; delete X.watch; clearOverlay('firecov'); });
    if (X.itg) sl('itgs', 'ITGs (Important Terrain Grounds)', X.itg.itgs.length, swatches([[polySw('rgba(255,255,255,0.25)', '#000'), 'ITG extent — label shows rating']]), () => { delete X.itg; delete X.plan; });
    if (X.terr) {
      sl('ridges', 'Ridgelines', X.terr.ridges.length, swatches([[lineSw('#5b3a1a'), 'Ridgeline (thicker = higher value)']]), () => { X.terr.ridges = []; });
      secL.push(Object.assign({ id: 'nullahs', name: 'Nullahs and valleys', count: X.terr.nullahs.length, legend: swatches([[lineSw('#1f6fd1'), 'Valley'], [lineSw('#5fa8ff'), 'Nullah']]), remove: () => { X.terr.nullahs = []; } }, showFlag('nullahs')));
    }
    if (S.sector || S.border) secL.push(Object.assign({ id: 'secArea', name: 'Sector boundary & border line', legend: swatches([[polySw('transparent', '#000'), 'Sector (area of interest)'], [lineSw('#d00000'), 'Border line (LoC)']]),
      remove: () => { S.sector = null; S.border = null; safe(onSectorChanged)(); } }, showFlag('secArea')));
    return [
      { id: 'grpModel', name: 'ModelBuilder results', layers: UI.MB ? UI.MB.tocLayers() : [] },
      { id: 'grpSector', name: 'Sector plan', layers: secL },
      { id: 'grpFeat', name: 'Situation & plan', layers: feat },
      { id: 'grpModel', name: 'ModelBuilder results', layers: UI.MB ? UI.MB.tocLayers() : [] },
      { id: 'grpRas', name: 'Analysis rasters', layers: ras },
      { id: 'grpGrid', name: 'Map grids & annotation', layers: grids },
      { id: 'grpBase', name: mode === 'topo' ? 'Basemap — topographic' : mode === 'hybrid' ? 'Basemap — hybrid satellite + topographic' : 'Basemap — imagery', layers: base },
    ];
  };
  const findLayer = (id) => { for (const g of tocModel()) for (const l of g.layers) if (l.id === id) return l; return null; };

  const renderTOC = () => {
    const el = $('toc');
    if (!S.grid) { el.innerHTML = '<p class="hint pad">Add an elevation model to start: Map ▸ Add Data, Download DEM, or the demo terrain.</p>'; return; }
    const q = ($('tocFilter').value || '').trim().toLowerCase();
    const groups = tocModel();
    el.innerHTML = `<div class="toc-map"><span class="tw">▾</span>${UI.icon('data', 14)}<b>Map</b><span class="toc-crs">${esc(F.analysisCRSName())}</span></div>` + groups.map((g) => {
      const layers = g.layers.filter((l) => !q || l.name.toLowerCase().includes(q));
      if (!layers.length) return '';
      const col = !!S.tocCollapsed[g.id];
      return `<div class="toc-grp${col ? ' col' : ''}"><div class="toc-gh" data-grp="${g.id}"><span class="tw">${col ? '▸' : '▾'}</span>${esc(g.name)}</div>
        ${layers.map((l) => {
          const lc = l.id in S.tocCollapsed ? !!S.tocCollapsed[l.id] : !l.isBase;
          return `<div class="toc-l${S.tocSel === l.id ? ' sel' : ''}${l.visible() ? '' : ' off'}" data-layer="${esc(l.id)}">
            <div class="toc-lh"><span class="tw" data-tw="${esc(l.id)}">${l.legend ? (lc ? '▸' : '▾') : ''}</span><input type="checkbox" data-vis="${esc(l.id)}" ${l.visible() ? 'checked' : ''} ${l.isBase || l.id === 'los' ? 'disabled' : ''}>
            <span class="toc-n" title="${esc(l.name)}">${esc(l.name)}</span>${l.count !== undefined ? `<i class="toc-c">${l.count}</i>` : ''}${UI.explainTopicForLayer(l.id, S) ? `<button class="toc-x" data-x="${esc(l.id)}" title="Explain this layer — data, method, parameters">${UI.icon('info', 13)}</button>` : ''}</div>
            ${l.sub ? `<div class="toc-sub">${esc(l.sub)}</div>` : ''}${l.status ? `<div class="toc-st ${l.status[0]}">${esc(l.status[1])}</div>` : ''}
            ${l.setOpacity && S.tocSel === l.id ? `<div class="toc-op">Transparency <input type="range" min="0" max="0.95" step="0.05" value="${(1 - l.opacity()).toFixed(2)}" data-op="${esc(l.id)}"><span>${pct(1 - l.opacity())}</span></div>` : ''}
            ${l.legend && !lc ? `<div class="toc-lg">${l.legend}</div>` : ''}</div>`;
        }).join('')}</div>`;
    }).join('');
    el.querySelectorAll('[data-grp]').forEach((h) => h.addEventListener('click', () => { S.tocCollapsed[h.dataset.grp] = !S.tocCollapsed[h.dataset.grp]; renderTOC(); }));
    el.querySelectorAll('[data-tw]').forEach((h) => h.addEventListener('click', (e) => { e.stopPropagation(); const l = findLayer(h.dataset.tw); const cur = h.dataset.tw in S.tocCollapsed ? !!S.tocCollapsed[h.dataset.tw] : !(l && l.isBase); S.tocCollapsed[h.dataset.tw] = !cur; renderTOC(); }));
    el.querySelectorAll('[data-vis]').forEach((cb) => cb.addEventListener('change', (e) => { e.stopPropagation(); const l = findLayer(cb.dataset.vis); if (l) l.setVisible(cb.checked); renderTOC(); }));
    el.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); explainLayer(b.dataset.x); }));
    el.querySelectorAll('[data-op]').forEach((r) => {
      r.addEventListener('click', (e) => e.stopPropagation());
      r.addEventListener('input', () => { r.nextElementSibling.textContent = pct(+r.value); });
      r.addEventListener('change', () => { const l = findLayer(r.dataset.op); if (l) l.setOpacity(1 - +r.value); });
    });
    el.querySelectorAll('[data-layer]').forEach((n) => {
      n.addEventListener('click', (e) => { if (e.target.matches('input')) return; S.tocSel = n.dataset.layer; renderTOC(); });
      n.addEventListener('dblclick', (e) => { if (e.target.matches('input')) return; openLayerProps(n.dataset.layer); });
      n.addEventListener('contextmenu', (e) => { e.preventDefault(); S.tocSel = n.dataset.layer; renderTOC(); layerMenu(n.dataset.layer, e.clientX, e.clientY); });
    });
  };

  // ---------------------------------------------------------------- context menu
  const closeMenus = () => { $('menuLayer').innerHTML = ''; };
  const popupMenu = (x, y, items) => {
    closeMenus();
    const m = document.createElement('div');
    m.className = 'menu';
    m.innerHTML = items.map((it, k) => (it === '-' ? '<div class="sep"></div>' : it.head ? `<div class="mh">${esc(it.head)}</div>`
      : `<button class="mi" data-mi="${k}" ${it.disabled ? 'disabled' : ''}><span class="ck">${it.checked ? '✓' : it.icon ? UI.icon(it.icon, 13) : ''}</span><span class="lb">${esc(it.t)}</span><span class="kb">${it.k || ''}</span></button>`)).join('');
    m.querySelectorAll('[data-mi]').forEach((b) => b.addEventListener('click', () => { closeMenus(); items[+b.dataset.mi].run(); }));
    $('menuLayer').appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
    m.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  };
  const layerExtent = (id) => {
    const pts = [];
    const add = (p) => p && pts.push([p.c, p.r]);
    const lines = (ls) => ls.forEach((l) => l.forEach(([c, r]) => pts.push([c, r])));
    if (id === 'markers') Object.values(S.markers).forEach(add);
    else if (id === 'obstacles') { lines(S.obstacles); lines(S.tracks); }
    else if (id === 'picquets') S.picquets.picquets.forEach(add);
    else if (id === 'helipads') S.helipads.pads.forEach(add);
    else if (id === 'routes') lines(S.routes.routes.map((r) => r.line));
    else if (id === 'mfd') S.mfd.fields.forEach(add);
    else if (id.startsWith('weapons:')) S.weapons[+id.slice(8)].sites.forEach(add);
    else if (id === 'posts') S.posts.posts.forEach(add);
    else if (id === 'hostileOps') S.hostile.observers.forEach(add);
    else if (id === 'avenues') lines(S.avenues.routes.map((r) => r.line));
    else if (id === 'key') { S.key.peaks.forEach(add); S.key.passes.forEach(add); }
    else if (id === 'los') { add(S.los.a); add(S.los.b); }
    else if (id === 'secArea') { lines([S.sector || [], S.border || []]); }
    else if (id === 'nullahs' || id === 'ridges') lines((S.sec.terr[id] || []).slice(0, 30).map((x) => x.line));
    else secItems().filter((x) => x.layer === id).forEach(add);
    return pts.length ? pts : null;
  };
  const zoomToLayer = (id) => {
    const pts = layerExtent(id);
    if (!pts) { runCmd('fit'); return; }
    const cs = pts.map((p) => p[0]), rs = pts.map((p) => p[1]);
    const c0 = Math.min(...cs), c1 = Math.max(...cs), r0 = Math.min(...rs), r1 = Math.max(...rs);
    const span = Math.max(c1 - c0, r1 - r0, 40) * 1.3;
    if (S.view === '3d') v3.lookAtCell((c0 + c1) / 2, (r0 + r1) / 2, span * S.grid.cs * 1.4);
    else map.centerOn((c0 + c1) / 2, (r0 + r1) / 2, Math.min(map.W, map.H) / span);
  };
  const layerMenu = (id, x, y) => {
    const l = findLayer(id);
    if (!l) return;
    const items = [
      { t: 'Zoom To Layer', icon: 'fit', run: () => zoomToLayer(id), disabled: l.raster || id.startsWith('g:') },
      { t: 'Attribute Table', icon: 'log', k: 'Ctrl+T', run: () => openAttrTable(id), disabled: !l.table },
      '-',
      { t: 'Visible', checked: l.visible(), run: () => { l.setVisible(!l.visible()); renderTOC(); }, disabled: l.isBase || id === 'los' },
    ];
    if (l.setOpacity) items.push({ t: 'Transparency…', run: () => openLayerProps(id) });
    if (id.startsWith('ovl:')) {
      const o = overlayOrder(), i = o.indexOf(id.slice(4));
      items.push({ t: 'Move Up (draw above)', run: () => moveOverlay(id.slice(4), +1), disabled: i >= o.length - 1 }, { t: 'Move Down (draw below)', run: () => moveOverlay(id.slice(4), -1), disabled: i <= 0 });
    }
    if (l.isBase || l.isBm) items.push('-', ...basemapMenu());
    if (UI.explainTopicForLayer(id, S)) items.unshift({ t: 'Explain This Layer…', icon: 'help', k: 'E', run: () => explainLayer(id) }, '-');
    items.push('-');
    if (l.remove) items.push({ t: 'Remove', icon: 'minus', run: () => { if (['markers', 'obstacles', 'secArea'].includes(id)) pushUndo(`Remove ${l.name}`); l.remove(); if (S.tocSel === id) S.tocSel = null; S.sel = null; renderAll(); refresh({ base: true }); } });
    if (l.settings) items.push({ t: 'Symbology settings…', icon: 'gear', run: () => Settings.open(l.settings) });
    items.push({ t: 'Properties…', icon: 'doc', run: () => openLayerProps(id) });
    popupMenu(x, y, items);
  };
  const setBase = (k) => { S.base = k; S.bm.terrain = true; Settings.set('map.base', k); };
  const MODE_NAMES = { hybrid: 'Hybrid — satellite + topographic', imagery: 'Satellite imagery only', topo: 'Topographic / analysis (offline)' };
  const SRC_NAMES = { esri: 'Imagery: Esri World Imagery', eox: 'Imagery: Sentinel-2 cloudless (EOX)', custom: 'Imagery: custom tile server', none: 'Imagery: none (offline)' };
  /** Basemap menu: mode, imagery source, terrain symbology. */
  const basemapMenu = () => [
    ...Object.entries(MODE_NAMES).map(([k, n]) => ({ t: n, checked: basemapMode() === k, run: () => Settings.set('map.mode', k) })), '-',
    ...Object.entries(SRC_NAMES).map(([k, n]) => ({ t: n, checked: cfg('map.imagerySource') === k, disabled: basemapMode() === 'topo', run: () => Settings.set('map.imagerySource', k) })),
    { t: 'Reload imagery', icon: 'download', disabled: basemapMode() === 'topo' || !S.grid, run: () => requestImagery() }, '-',
    ...Object.entries(BASE_NAMES).map(([k, n]) => ({ t: `Terrain: ${n}`, checked: S.base === k, run: () => setBase(k) })), '-',
    { t: 'Explain basemap data source…', icon: 'help', run: () => openExplain(basemapMode() === 'topo' ? (S.base === 'relief' ? 'hillshade' : S.base) : 'imagery') },
  ];

  // ---------------------------------------------------------------- layer properties dialog
  const pgrid = (rows) => rows.map(([k, v]) => (v === null ? `<tr class="sub"><td colspan="2">${esc(k)}</td></tr>` : `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)).join('');
  const demRows = () => {
    const g = S.grid, st = S.stats, crs = F.secondaryCRS();
    return [
      ['Dataset', null], ['Name', g.name], ['Source', S.sources ? S.sources.map((s) => s.name).join(', ').slice(0, 120) : g.synthetic ? 'synthetic training area' : 'resampled grid'],
      ['Spatial reference', null], ['Analysis CRS', F.analysisCRSName()], ['Secondary CRS', crs ? crs.name : 'none'], ['Vertical datum', F.vdatum()],
      ['Raster', null], ['Cell size', `${g.cs} m`], ['Columns × rows', `${g.w} × ${g.h}`], ['Pixel type', 'Float32 elevation'], ['Resampling', cfg('data.resample')],
      ['Extent', null], ['Width × height', `${F.dist(g.w * g.cs)} × ${F.dist(g.h * g.cs)}`], ['Area', F.area(st.areaKm2)], ['NW corner', F.listRef(0, 0)], ['SE corner', F.listRef(g.h - 1, g.w - 1)],
      ['Statistics', null], ['Elevation', `${F.elev(st.elevMin)} – ${F.elev(st.elevMax)}`], ['Mean / relief', `${F.elev(st.elevMean)} / ${F.height(st.relief)}`],
      ['Slope mean / max', `${st.slopeMean.toFixed(1)}° / ${st.slopeMax.toFixed(0)}°`],
    ];
  };
  const openLayerProps = (id) => {
    const l = findLayer(id);
    if (!l) return;
    const body = $('propsBody');
    $('propsTitle').textContent = `Layer Properties: ${l.name}`;
    let html = '<div class="props-main">';
    if (l.isBase) {
      html += `<h4>Symbology</h4><div class="props-row"><label>Primary symbology</label><select id="propBase">${Object.entries(BASE_NAMES).map(([k, n]) => `<option value="${k}" ${S.base === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="props-row"><label>Hillshade blend</label><input type="range" id="propBlend" min="0" max="1" step="0.05" value="${cfg('map.blend')}"><span id="propBlendV">${pct(+cfg('map.blend'))}</span></div>
        <div class="props-row"><label></label><button class="btn sm" id="propHs">Hillshade settings…</button></div>
        <table class="pgrid">${pgrid(demRows())}</table><h4>Histograms</h4><div class="charts"><canvas id="chHyp"></canvas><canvas id="chSlope"></canvas><canvas id="chRose"></canvas></div>`;
    } else {
      const rows = [['General', null], ['Name', l.name], ['Type', l.raster ? 'Raster (analysis grid)' : id.startsWith('g:') ? 'Map grid / annotation' : 'Feature layer']];
      if (l.count !== undefined) rows.push(['Features', String(l.count)]);
      if (l.raster) rows.push(['Cell size', `${S.grid.cs} m`], ['Columns × rows', `${S.grid.w} × ${S.grid.h}`], ['Spatial reference', F.analysisCRSName()]);
      else rows.push(['Spatial reference', F.analysisCRSName()]);
      const o = id.startsWith('ovl:') ? S.overlays[id.slice(4)] : null;
      if (o && o.data) {
        let n = 0;
        for (const v of o.data) if (v) n++;
        rows.push(['Statistics', null], ['Non-zero cells', `${n.toLocaleString()} (${pct(n / o.data.length, 1)})`], ['Area', F.area((n * S.grid.cs * S.grid.cs) / 1e6)]);
        if (id === 'ovl:mobility' && o.info) rows.push(['Movement class', o.info.name], ['GO / NO-GO slope limits', `GO < ${o.info.go}° · SLOW-GO ${o.info.go}–${o.info.slow}° · NO-GO ≥ ${o.info.slow}° (${o.info.src || ''})`]);
      }
      const p = id === 'posts' ? S.posts && S.posts.params : id.startsWith('weapons:') ? S.weapons[+id.slice(8)] && S.weapons[+id.slice(8)].params : null;
      if (p) rows.push(['Tool parameters used', null], ...Object.entries(p).filter(([, v]) => typeof v !== 'object' || Array.isArray(v)).slice(0, 30).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]));
      if (l.setOpacity) html += `<h4>Display</h4><div class="props-row"><label>Transparency</label><input type="range" id="propOp" min="0" max="0.9" step="0.05" value="${(1 - l.opacity()).toFixed(2)}"><span id="propOpV">${pct(1 - l.opacity())}</span></div>`;
      if (l.legend) html += `<h4>Legend</h4><div class="toc-lg">${l.legend}</div>`;
      html += `<table class="pgrid">${pgrid(rows)}</table>`;
    }
    body.innerHTML = html + '</div>';
    if (l.isBase) {
      $('propBase').onchange = (e) => setBase(e.target.value);
      $('propBlend').oninput = (e) => { $('propBlendV').textContent = pct(+e.target.value); };
      $('propBlend').onchange = (e) => Settings.set('map.blend', +e.target.value);
      $('propHs').onclick = () => { $('props').close(); Settings.open('map'); };
    }
    if ($('propOp')) $('propOp').oninput = (e) => { $('propOpV').textContent = pct(+e.target.value); l.setOpacity(1 - +e.target.value); };
    if (!$('props').open) $('props').showModal();
    if (l.isBase) drawDemCharts();
  };
  const drawDemCharts = () => {
    const st = S.stats;
    const hb = st.hypsometry.bins;
    UI.drawBars($('chHyp'), `Hypsometry (${F.elev(st.elevMin)} – ${F.elev(st.elevMax)})`, hb.map((v, k) => ({ v, color: '#b08a58', label: k % 6 === 0 ? String(F.elevNum(st.elevMin + (k / hb.length) * st.relief)) : '' })));
    const cl = M.SLOPE_CLASSES;
    UI.drawBars($('chSlope'), 'Slope classes (share of area)', st.slopeHist.map((v, k) => ({ v, color: UI.SLOPE_COLORS[k], label: k === cl.length - 2 ? `>${cl[k]}°` : `${cl[k]}–${cl[k + 1]}` })));
    UI.drawRose($('chRose'), st.aspectRose);
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
    $('vtCRS').textContent = F.analysisCRSName() + (crs ? ` · ${crs.name}` : '');
  };
  const updateScale = () => { $('stScale').textContent = S.grid ? (S.view === '3d' ? 'Scene' : `1:${Math.round(map.scaleDenominator() / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')) : ''; };

  // =================================================================== map tools
  const TOOL_HINTS = {
    rvsline: 'Route for viewshed — click along the route · double-click or Enter to finish · Backspace undo · Esc cancel',
    sector: 'Sector boundary — click the corners of your area of interest · double-click or Enter to finish · Backspace undo · Esc cancel',
    border: 'Border line (LoC) — click along the line from one end to the other · double-click or Enter to finish · Backspace undo · Esc cancel',
    own: 'Click own position (defended locality / HQ) · Esc to cancel', threat: 'Click the enemy position · Esc to cancel',
    target: 'Click the target area for indirect fire · Esc to cancel', a: 'Click route start (A) · Esc to cancel', b: 'Click route end (B) · Esc to cancel',
    poly: 'No-Go area — click vertices · double-click or Enter to finish · Backspace undo · Esc cancel', line: 'Track — click vertices · double-click or Enter to finish · Backspace undo · Esc cancel',
    los: 'Line of sight — click observer, then target · Esc cancel', vs: 'Viewshed — click the observer position · Esc cancel', measure: 'Measure — click start, then end point · Esc cancel',
    aoi: 'Crop — click two opposite corners of the area of interest · Esc cancel',
  };
  let pickCb = null;
  const setTool = (tool, hint) => {
    if (!S.grid) return;
    if (S.tool === tool && tool !== 'pick') tool = null;
    if (tool !== 'pick') pickCb = null;
    S.tool = tool;
    S.draft = tool && ['poly', 'line', 'los', 'measure', 'aoi'].includes(tool) ? { kind: tool, pts: [] }
      : tool === 'rvsline' ? { kind: 'line', purpose: 'rvsline', pts: [] }
      : tool === 'sector' ? { kind: 'poly', purpose: 'sector', pts: [] } : tool === 'border' ? { kind: 'line', purpose: 'border', pts: [] } : null;
    document.querySelectorAll('[data-cmd^="tool:"]').forEach((b) => b.classList.toggle('active', b.dataset.cmd === 'tool:' + tool));
    document.querySelectorAll('[data-cmd="explore"]').forEach((b) => b.classList.toggle('active', !tool));
    $('stage').classList.toggle('tool', !!tool);
    $('toolHint').hidden = !tool;
    if (tool) $('toolHint').textContent = hint || TOOL_HINTS[tool];
    map.render();
    if (S.view === '3d') v3.render();
  };
  /** Let a geoprocessing parameter pick a point on the map. */
  const pickPoint = (label, cb) => {
    if (!S.grid) { toast('Load an elevation model first.', true); return; }
    setTool('pick', `Click the ${label.toLowerCase()} on the map · Esc to cancel`);
    pickCb = cb;
  };
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
    if (d.purpose === 'rvsline' && pts.length >= 2) { S.rvsLine = pts; setTool(null); GP.set('routeViewshed', 'source', 'drawn'); GP.open('routeViewshed'); GP.run('routeViewshed'); return; }
    if ((d.purpose && pts.length >= (d.purpose === 'sector' ? 3 : 2)) || (!d.purpose && pts.length >= (d.kind === 'poly' ? 3 : 2))) pushUndo(d.purpose === 'sector' ? 'Sector boundary' : d.purpose === 'border' ? 'Border line' : d.kind === 'poly' ? 'No-Go area' : 'Track');
    if (d.purpose === 'sector' && pts.length >= 3) { S.sector = pts; setTool(null); safe(onSectorChanged)(); return; }
    if (d.purpose === 'border' && pts.length >= 2) { S.border = pts; setTool(null); safe(onSectorChanged)(); return; }
    if (d.purpose) { toast('Not enough vertices.', true); setTool(null); return; }
    if (d.kind === 'poly' && pts.length >= 3) S.obstacles.push(pts);
    else if (d.kind === 'line' && pts.length >= 2) S.tracks.push(pts);
    else { toast('Not enough vertices.', true); setTool(null); return; }
    setTool(null);
    safe(onObstaclesChanged)();
  };
  /** Sector or border redrawn: earlier sector results no longer apply. */
  const onSectorChanged = async () => {
    S.sec = {};
    clearOverlay('dominance'); clearOverlay('firecov');
    await syncSettings();
    renderAll(); refresh({ base: true });
    if (GP.current()) GP.render();
    toast(S.border ? 'Sector updated — run Sector tools (Sector tab).' : 'Sector boundary set. Draw the border line (LoC) next.');
  };
  const onObstaclesChanged = async () => {
    await syncSettings();
    if (S.overlays.mobility.data) await computeMobility(GP.values('mobility'), true);
    renderAll();
    refresh({ base: true });
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
  const placeMarker = async (k, cell) => {
    pushUndo(`Place ${MARKER_LABEL[k] || k}`);
    S.markers[k] = cell;
    S.markerOrigin[k] = 'user';
    if (k === 'own' || k === 'threat') { S.avenues = null; S.hostile = null; clearOverlay('hostile'); clearOverlay('avenues'); }
    await syncSettings();
    renderAll();
    refresh({ base: true });
    if (GP.current()) GP.render();
  };
  const handleClick = async (c, r, ev) => {
    const g = S.grid;
    if (!g) return;
    const inside = c >= -0.5 && r >= -0.5 && c <= g.w - 0.5 && r <= g.h - 0.5;
    const tool = S.tool;
    if (!tool) {
      // vertices of the inspected generated line first, then symbols, then lines (with a chooser when they overlap)
      const vh = S.view === '2d' ? vertexHit(ev.x, ev.y) : null;
      if (vh) { selectVertex(vh.key, vh.v); return; }
      const ref = nearestSymbol(ev.x, ev.y);
      if (ref) { select(ref, false, true); return; }
      const hits = S.view === '2d' ? routeHits(ev.x, ev.y) : [];
      if (hits.length === 1) { selectRoute(hits[0].key); return; }
      if (hits.length > 1) {
        const rc = $('map2d').getBoundingClientRect();
        popupMenu(rc.left + ev.x + 6, rc.top + ev.y + 6, [{ head: `${hits.length} overlapping features — choose one` }, ...hits.map((r) => ({ t: `${r.id} — ${RCAT[r.cat].short}`, icon: 'route', run: () => selectRoute(r.key) }))]);
        return;
      }
      if (S.helipads && S.show.helipads !== false) {
        const k = S.helipads.pads.findIndex((q) => { const [sx, sy] = S.view === '3d' ? [-1e9, -1e9] : map.toScreen(q.c, q.r); return Math.hypot(sx - ev.x, sy - ev.y) < 14; });
        if (k >= 0) { select({ kind: 'hls', idx: k }, false, true); return; }
      }
      if (S.mfd && inside && S.show.mfd) {
        const k = S.mfd.fields.findIndex((f) => M.pointInPoly(c, r, f.poly));
        if (k >= 0) { select({ kind: 'mfd', idx: k }, false, true); return; }
      }
      if (inside) select({ kind: 'point', c, r }, false, true);
      return;
    }
    if (!inside) return;
    const cell = { c: Math.round(c), r: Math.round(r) };
    if (tool === 'pick') { const cb = pickCb; setTool(null); if (cb) cb(cell); return; }
    if (['own', 'threat', 'target', 'a', 'b'].includes(tool)) { setTool(null); await placeMarker(tool, cell); return; }
    if (tool === 'poly' || tool === 'line' || tool === 'sector' || tool === 'border' || tool === 'rvsline') { S.draft.pts.push([c, r]); redrawDraft(); return; }
    if (tool === 'aoi' || tool === 'measure' || tool === 'los') {
      S.draft.pts.push([c, r]);
      if (S.draft.pts.length < 2) { redrawDraft(); return; }
      const [p, q] = S.draft.pts;
      setTool(null);
      if (tool === 'aoi') return cropAOI(p, q);
      if (tool === 'measure') return showMeasure(p, q);
      GP.set('los', 'from', { c: Math.round(p[0]), r: Math.round(p[1]) });
      GP.set('los', 'to', { c: Math.round(q[0]), r: Math.round(q[1]) });
      GP.open('los');
      return GP.run('los');
    }
    if (tool === 'vs') { setTool(null); GP.set('viewshed', 'observer', cell); GP.open('viewshed'); return GP.run('viewshed'); }
  };
  const showMeasure = (p, q) => {
    const g = S.grid;
    const dc = q[0] - p[0], dr = q[1] - p[1];
    const d = Math.hypot(dc, dr) * g.cs;
    const gb = M.bearing(dc, -dr);
    const z1 = M.sample(g, S.L.z, p[1], p[0]), z2 = M.sample(g, S.L.z, q[1], q[0]);
    const conv = F.convergence(p[1], p[0]), decl = F.declination();
    S.sel = null;
    $('selBody').innerHTML = `<div class="sel-head">${UI.icon('ruler', 20)}<div><div class="t">Measure</div><div class="s">Distance and bearing</div></div></div><table class="pgrid">${pgrid([
      ['From', F.refCell(p[1], p[0], { digits: cfg('ref.listDigits') })], ['To', F.refCell(q[1], q[0], { digits: cfg('ref.listDigits') })],
      ['Distance (grid)', F.dist(d)], ['Slope distance', F.dist(Math.hypot(d, z2 - z1))],
      ['Bearing — grid', F.angle(gb)], ['Bearing — true', F.angle(gb + conv)], ['Bearing — magnetic', F.angle(gb + conv - decl)],
      ['Back bearing', F.bearing(gb + 180, p[1], p[0])],
      ['Height difference', F.height(z2 - z1)], ['Mean gradient', `${M.deg(Math.atan(Math.abs(z2 - z1) / Math.max(1, d))).toFixed(1)}°`],
      ['GSP march time — day', gspRange(M.gspMarchTime(d, Math.max(0, z2 - z1), Math.max(0, z1 - z2)))],
      ['GSP march time — night', gspRange(M.gspMarchTime(d, Math.max(0, z2 - z1), Math.max(0, z1 - z2), { night: true }))],
      ['Off-map distance (map + ⅓)', F.dist(d * 4 / 3)],
    ])}</table><p class="hint pad">GSP: distance is measured in time. Straight-line legs; use Least-Time Route for the real path.</p>`;
    showRightTab('attr');
    S.draft = { kind: 'measure', pts: [p, q] };
    map.render();
  };

  // =================================================================== geoprocessing tool handlers
  const needGrid = () => { if (!S.grid) throw new Error('Load an elevation model first (Map ▸ Add Data).'); };
  const MARKER_LABEL = { own: 'own position', threat: 'enemy position', a: 'route start (A)', b: 'route end (B)' };
  const needMarkers = (...keys) => {
    needGrid();
    const miss = keys.filter((k) => !S.markers[k]);
    if (miss.length) throw new Error(`Place the ${miss.map((k) => MARKER_LABEL[k]).join(' and ')} first (Map ▸ Situation).`);
  };
  const clearOverlay = (id) => { const o = S.overlays[id]; o.data = null; o.rgba = null; o.visible = false; };
  const setOverlay = (id, data, info, keepOthers) => {
    const o = S.overlays[id];
    if (!keepOthers && cfg('ovl.exclusive')) for (const [k, x] of Object.entries(S.overlays)) if (k !== id) x.visible = false;
    o.data = data; o.rgba = null; o.visible = !!data; o.info = info || o.info;
  };
  const gspRange = (t) => `${F.time(t.minH)}–${F.time(t.maxH)}`;
  const refLines = (items, fmt) => items.map((x) => `${x.id}  ${F.listRef(x.r, x.c)}${fmt ? '  ' + fmt(x) : ''}`).join('\n');

  const computeMobility = async (v, quiet) => {
    needGrid();
    const id = v.profile;
    S.snowLine = +v.snowLine || 0; S.generalize = !!v.generalize; S.relief = !!v.relief;
    await syncSettings();
    const res = await run(`Go / No-Go — ${M.MOVEMENT_PROFILES[id].name}`, 'mobility', { profile: id },
      (r) => `GO ${pct(r.stats.go)} · SLOW ${pct(r.stats.slow)} · NO-GO ${pct(r.stats.nogo)}`);
    S.mobStats[id] = res.stats;
    S.overlays.mobility.profile = id;
    setOverlay('mobility', res.cls, Object.assign({ name: res.profile.name }, res.profile));
    renderAll(); refresh({ base: true });
    const s = res.stats, area = S.stats.areaKm2;
    if (!quiet) toast(`${res.profile.name}: ${pct(s.go)} GO, ${pct(s.slow)} SLOW-GO, ${pct(s.nogo)} NO-GO.`);
    return `${res.profile.name} (GO < ${res.profile.go}°, NO-GO ≥ ${res.profile.slow}°${res.profile.src ? ' — ' + res.profile.src : ''})\nGO ${pct(s.go)} · ${F.area(s.go * area)}\nSLOW-GO ${pct(s.slow)} · ${F.area(s.slow * area)}\nNO-GO ${pct(s.nogo)} · ${F.area(s.nogo * area)}`;
  };
  const H = {};
  H.downloadDEM = gpDownloadDEM;
  H.exportRaster = gpExportRaster;
  H.mobility = (v) => computeMobility(v, true);
  H.keyTerrain = async (v) => {
    needGrid();
    S.key = await run('Key Terrain', 'keyTerrain', Object.assign({}, v, { passReliefM: +v.passReliefM || undefined }), (r) => `${r.peaks.length} heights · ${r.passes.length} passes`);
    S.show.key = true;
    renderAll(); refresh();
    return `${S.key.peaks.length} dominating heights, ${S.key.passes.length} passes / cols.\n` + S.key.peaks.slice(0, 5).map((p, k) => `H${k + 1}  ${F.listRef(p.r, p.c)}  ${F.elev(p.z)}`).join('\n');
  };
  H.viewshed = async (v) => {
    needGrid();
    if (!v.observer) throw new Error('Set the observer point (Pick, or type a reference).');
    const p = v.observer;
    const res = await run('Viewshed', 'viewshed', { p, obsH: +v.obsH, tgtH: +v.tgtH, radiusM: +v.radiusM }, (r) => `${F.area(r.visibleKm2)} visible`);
    S.vsPoint = p;
    setOverlay('viewshed', res.mask, { name: 'Viewshed' });
    renderAll(); refresh({ base: true });
    return `Visible ${F.area(res.visibleKm2)} within ${F.dist(+v.radiusM)} of ${F.listRef(p.r, p.c)}.`;
  };
  H.los = async (v) => {
    needGrid();
    if (!v.from || !v.to) throw new Error('Set both the observer and target points.');
    const res = await run('Line of Sight', 'los', { a: v.from, b: v.to, obsH: +v.obsH, tgtH: +v.tgtH }, (r) => `${r.visible ? 'visible' : 'masked'} · ${F.dist(r.distance)}`);
    S.los = { a: v.from, b: v.to, res };
    const blk = res.blockIndex >= 0 ? res.profile[res.blockIndex] : null;
    openProfile(`Line of sight — ${res.visible ? 'visible' : 'masked'} — ${F.dist(res.distance)}`, { profile: res.profile, blockIndex: res.blockIndex });
    renderAll(); refresh();
    const pa = res.profile[0], pb = res.profile[res.profile.length - 1];
    const ang = M.deg(Math.atan2((pb.z + +v.tgtH) - (pa.z + +v.obsH), Math.max(1, res.distance)));
    const fire = `\nAngle of sight ${ang.toFixed(1)}° · slant ${F.dist(Math.hypot(res.distance, (pb.z + +v.tgtH) - (pa.z + +v.obsH)))} · set sight to slant ÷ ${M.sightFactor(ang).toFixed(2)} (GSP Sec 18)`;
    return (res.visible ? `VISIBLE · range ${F.dist(res.distance)} · minimum clearance ${F.height(res.clearance)}`
      : `MASKED by ground at ${F.dist(blk.d)} (${F.listRef(blk.r, blk.c)}) · range ${F.dist(res.distance)}`) + fire;
  };
  /** Routes a route viewshed can use: [key, label]. */
  const routeSources = () => {
    const out = [];
    if (S.routes) S.routes.routes.forEach((r, k) => out.push([`route:${k}`, `Least-time route R${k + 1}${k === (S.routes.sel || 0) ? ' (selected)' : ''}`]));
    if (S.avenues) S.avenues.routes.forEach((r, k) => out.push([`avenue:${k}`, `Enemy avenue AA${k + 1}`]));
    if (S.sec.appr) S.sec.appr.approaches.forEach((a, k) => out.push([`eappr:${k}`, `Enemy approach ${a.id}`]));
    if (S.sec.infil) S.sec.infil.routes.forEach((a, k) => out.push([`infil:${k}`, `Infiltration route ${a.id}`]));
    if (S.tracks.length) S.tracks.forEach((t, k) => out.push([`track:${k}`, `Drawn track ${k + 1}`]));
    out.push(['drawn', S.rvsLine ? 'Line drawn for this tool' : 'Draw a line on the map…']);
    if (S.routes) out.unshift(['route', 'Selected least-time route']);
    return out;
  };
  const routeLine = (src) => {
    const [kind, k] = String(src).split(':');
    if (kind === 'route') return S.routes && (k === undefined ? S.routes.routes[S.routes.sel || 0] : S.routes.routes[+k]) && (k === undefined ? S.routes.routes[S.routes.sel || 0] : S.routes.routes[+k]).line;
    if (kind === 'avenue') return S.avenues && S.avenues.routes[+k] && S.avenues.routes[+k].line;
    if (kind === 'eappr') return S.sec.appr && S.sec.appr.approaches[+k] && S.sec.appr.approaches[+k].line;
    if (kind === 'infil') return S.sec.infil && S.sec.infil.routes[+k] && S.sec.infil.routes[+k].line;
    if (kind === 'track') return S.tracks[+k];
    if (kind === 'drawn') return S.rvsLine;
    return null;
  };
  H.routeViewshed = async (v) => {
    needGrid();
    const line = routeLine(v.source);
    if (!line) {
      if (v.source === 'drawn' || v.source === 'route') { setTool('rvsline'); throw new Error('No route yet — click along the route on the map and double-click to finish; the tool then runs.'); }
      throw new Error('That route no longer exists — choose another.');
    }
    const label = (routeSources().find(([k]) => k === v.source) || [, 'route'])[1];
    const r = await run(`Route Viewshed — ${label}`, 'routeViewshed', Object.assign({}, v, { line }), (x) => `${F.area(x.visibleKm2)} · ${x.stations.length} stations`);
    S.rvs = { line, label, mode: r.mode, watch: r.watch, stations: r.stations.length, visibleKm2: r.visibleKm2, areaShare: r.areaShare };
    setOverlay('routevs', r.count, { name: 'Route viewshed', mode: r.mode, n: r.stations.length });
    S.show.rvs = true;
    renderAll(); refresh({ base: true });
    const what = r.mode === 'exposure' ? 'Ground from which the route can be seen' : 'Ground the column on the route can see';
    return `${what}: ${F.area(r.visibleKm2)} (${Math.round(r.areaShare * 100)}% of the map), from ${r.stations.length} stations every ${F.dist(+v.stepM)}.\nDarker = seen from / sees more of the route.\n` +
      (r.watch.length ? `Best points to watch the route${r.mode === 'exposure' ? ' (picquets — or likely enemy OPs)' : ''}:\n` + r.watch.map((w, k) => `W${k + 1}  ${F.listRef(w.r, w.c)}  ${F.elev(w.z)} · sees ${Math.round(w.share * 100)}% of the route`).join('\n') : '');
  };
  H.hostile = async (v) => {
    needMarkers('threat');
    await syncSettings();
    const res = await run('Enemy Observation', 'hostileObservation', v, (r) => `${r.observers.filter((o) => !o.isThreat).length} likely enemy OPs`);
    S.hostile = { observers: res.observers };
    setOverlay('hostile', res.count);
    let seen = 0;
    for (const x of res.count) if (x) seen++;
    renderAll(); refresh({ base: true });
    return `${res.observers.filter((o) => !o.isThreat).length} likely enemy OPs overlook ${pct(seen / res.count.length)} of the area (shaded). Unshaded ground is in defilade from enemy view.\n` +
      res.observers.filter((o) => !o.isThreat).map((o, k) => `EOP${k + 1}  ${F.listRef(o.r, o.c)}`).join('\n');
  };
  H.avenues = async (v) => {
    needMarkers('own', 'threat');
    S.threatType = v.threatType;
    syncRibbonInputs();
    await syncSettings();
    const res = await run('Avenues of Approach', 'avenues', { profile: v.threatType, k: +v.k, separationM: +v.separationM, bufferM: +v.bufferM },
      (r) => r.routes.map((x, k) => `AA${k + 1} ${F.dist(x.lengthM)} / ${F.time(x.timeH)}`).join('\n'));
    S.avenues = { routes: res.routes, src: 'avenues', from: S.markers.threat, to: S.markers.own };
    annotateRun('avenues', runContext());
    setOverlay('avenues', res.density);
    renderAll(); refresh({ base: true });
    return `${M.MOVEMENT_PROFILES[v.threatType].name}:\n` + res.routes.map((r, k) => `AA${k + 1}  ${F.dist(r.lengthM)} · ${F.time(r.timeH)} · slow-go ${pct(r.slowFrac)}`).join('\n');
  };
  H.posts = async (v) => {
    needGrid();
    await syncSettings();
    const { echelon } = v;
    const opts = Object.assign({}, v);
    delete opts.echelon;
    const res = await run(v.mode === 'op' ? 'Suggest OPs' : 'Suggest Posts', 'posts', opts, (r) => `${r.posts.length} sites · ${pct(r.coverageShare)} of approach ground observed`);
    S.posts = Object.assign(res, { mode: v.mode, echelon });
    setOverlay('cover', res.cover);
    setOverlay('dead', res.dead, null, true);
    renderAll(); refresh({ base: true });
    return `${res.posts.length} sites observe ${pct(res.coverageShare)} of likely enemy movement ground · ${res.links.length} intervisible pairs${res.accessRelaxed ? '\nWARNING: no site reachable from own position — access constraint relaxed.' : ''}\n` +
      refLines(res.posts, (p) => `${F.elev(p.z)} · ${pct(p.valueShare, 1)}`);
  };
  const updateWeaponCover = () => {
    const covers = S.weapons.filter((w) => !w.hidden).map((w) => w.cover).filter(Boolean);
    if (!covers.length) { clearOverlay('wcover'); return; }
    const u = new Uint8Array(covers[0].length);
    for (const cv of covers) for (let i = 0; i < u.length; i++) if (cv[i]) u[i] = 1;
    setOverlay('wcover', u, null, true);
  };
  H.weapons = async (v) => {
    needGrid();
    const w = weaponOf(v.weaponId);
    if (w.cat === 'indirect' && !S.markers.threat && !S.markers.target) throw new Error('Place the enemy or a target area first — indirect fire needs a target.');
    await syncSettings();
    const base = { count: +v.count, minSepM: +v.minSepM, requireAccess: v.requireAccess, maxAccessH: +v.maxAccessH, candidates: +v.candidates, defRadiusM: +v.defRadiusM };
    let opts;
    if (w.cat === 'indirect') opts = Object.assign(base, v.indirect);
    else if (w.cat === 'ad') opts = Object.assign(base, { overlapKeep: v.direct.overlapKeep, rangeDecay: v.direct.rangeDecay }, v.ad);
    else opts = Object.assign(base, v.direct, { value: v.value });
    Object.assign(opts, { weaponId: w.id, weaponOverrides: (cfg('weapons') || {})[w.id] });
    const res = await run(`Weapon Sites — ${w.short}`, 'weapons', opts, (r) => r.sites.map((x) => `${x.id} ${F.listRef(x.r, x.c)}`).join('\n') + (r.accessRelaxed ? '\naccess relaxed' : ''));
    const entry = Object.assign(res, { weapon: w });
    const k = S.weapons.findIndex((x) => x.weapon.id === w.id);
    if (k >= 0) S.weapons[k] = entry; else S.weapons.push(entry);
    updateWeaponCover();
    renderAll(); refresh({ base: true });
    return `${w.name}: ${res.sites.length} sites${res.accessRelaxed ? `\nWARNING: no site reachable by ${M.MOVEMENT_PROFILES[res.accessProfile || w.access].name.toLowerCase()} — access relaxed; digitise a track to enforce it.` : ''}\n` +
      refLines(res.sites, (s) => (s.cat === 'indirect' ? `${F.dist(s.rangeToTargetM)} to target · crest clear ${pct(s.clearShare)}${s.hidden ? ' · hidden' : ''}` : `arc ${F.bearing(s.sector.left, s.r, s.c, true)}–${F.bearing(s.sector.right, s.r, s.c)}`));
  };
  H.mfd = async (v) => {
    needMarkers('own', 'threat');
    await syncSettings();
    let cover = null;
    const parts = [S.overlays.cover.data, S.overlays.wcover.data].filter(Boolean);
    if (parts.length) { cover = new Uint8Array(parts[0].length); for (const p of parts) for (let i = 0; i < p.length; i++) if (p[i]) cover[i] = 1; }
    const protect = (S.posts ? S.posts.posts : []).concat(...S.weapons.map((w) => w.sites)).map((q) => ({ r: q.r, c: q.c }));
    const opts = Object.assign({}, v, { profile: v.profile === 'auto' ? undefined : v.profile, cover, protect });
    const res = await run(`Minefields — ${v.type}`, 'minefields', opts, (r) => `${r.fields.length} fields · enemy +${Math.round(r.totalDelayMin)} min`);
    S.mfd = res;
    if (!S.avenues) S.avenues = { routes: res.avenues, src: 'minefields' };
    S.show.mfd = true;
    renderAll(); refresh();
    const head = res.purpose === 'barrier'
      ? `${res.fields.length} AT fields (barrier). Enemy's best time to own position: ${F.time(res.enemyBefore.timeH)} → ${F.time(res.enemyAfter.timeH)} (+${Math.round(res.totalDelayMin)} min). ${res.tested} defiles tested.`
      : `${res.fields.length} AP fields (protective, in front of own troops). ${res.tested} sites tested.`;
    return `${head}${res.outOfBand ? `\nWARNING: no suitable defile within ${F.dist(res.params.minDistOwnM)}–${F.dist(res.params.maxDistOwnM)} of own troops — fields placed farther out; widen the band or the maximum gap.` : ''}${cover ? '' : '\nNo posts / weapons sited yet — fire cover judged from own position only.'}\n` +
      res.fields.map((f) => `${f.id}  ${F.listRef(f.r, f.c)}  ${f.rating} · ${f.reasons[0]}${f.covered ? '' : ' · NOT observed'}`).join('\n');
  };
  H.route = async (v) => {
    needMarkers('a', 'b');
    if (v.mode !== 'fastest' && !S.markers.threat) toast('No enemy position set — the route avoids skylines but cannot assess enemy observation.');
    await syncSettings();
    const res = await run(`Route A→B (${v.mode})`, 'route', {
      a: S.markers.a, b: S.markers.b, profile: v.profile, mode: v.mode, alternatives: +v.alternatives, cpEveryM: +v.cpEveryM,
      exposureW: +v.exposureW, skylineW: +v.skylineW, separationM: +v.separationM, nullahW: +v.nullahW, legEveryM: +v.legEveryM, night: !!v.night,
    }, (r) => r.routes.map((x, k) => `R${k + 1} ${F.dist(x.lengthM)} · ${F.time(x.timeH)}`).join('\n'));
    S.routes = { routes: res.routes, sel: 0, profile: v.profile, mode: v.mode, night: !!v.night };
    S.picquets = null;
    annotateRun('route', runContext());
    renderAll(); showRouteProfile(); refresh();
    renderRouteCard();
    return `${M.MOVEMENT_PROFILES[v.profile].name} · ${v.mode}\n` + res.routes.map((r, k) => `R${k + 1}  ${F.dist(r.lengthM)} · model ${F.time(r.timeH)} · GSP ${gspRange(v.night ? r.gspNight : r.gspDay)} · ↑${F.height(r.ascentM)} ↓${F.height(r.descentM)} · exposed ${pct(r.exposedFrac)}`).join('\n') +
      '\nRoute card: bottom dock ▸ Route card.';
  };
  H.picquets = async (v) => {
    if (!S.routes) throw new Error('Run Least-Time Route first — picquets protect the selected route.');
    const rt = S.routes.routes[S.routes.sel || 0];
    S.picquets = await run('Route Picquets', 'picquets', Object.assign({}, v, { path: Array.from(rt.path) }), (r) => `${r.picquets.length} picquets · ${pct(r.routeCoverage)} of route observed`);
    renderAll(); refresh();
    return `${S.picquets.picquets.length} picquets keep ${pct(S.picquets.routeCoverage)} of route R${(S.routes.sel || 0) + 1} under observation.\n` + refLines(S.picquets.picquets, (p) => `climb ${F.time(p.climbH)}`);
  };
  H.helipads = async (v) => {
    needGrid();
    await syncSettings();
    const res = await run('Helipad Sites', 'helipads', v, (r) => `${r.pads.length} sites`);
    S.helipads = res;
    S.show.helipads = true;
    renderAll(); refresh();
    return `${res.pads.length} sites (${v.use}, ≤ ${res.pads[0] ? res.pads[0].slopeLimitDeg : '–'}°)${res.accessRelaxed ? '\nWARNING: access constraint relaxed.' : ''}\n` +
      refLines(res.pads, (q) => `${q.meanSlopeDeg.toFixed(1)}° · ${q.hidden ? 'hidden' : 'SEEN by enemy'}${q.distOwnM !== null ? ` · ${F.dist(q.distOwnM)} from own` : ''}`);
  };
  H.fly = async (v) => {
    if (!S.routes) throw new Error('Run Least-Time Route first.');
    if (!v3.ok) throw new Error('WebGL2 is not available — Scene view disabled.');
    Settings.set('v3.flySpeed', +v.speed); Settings.set('v3.flyHeight', +v.height);
    setView('3d');
    v3.fly(S.routes.routes[S.routes.sel || 0].line);
    return 'Flying the selected route — Esc stops.';
  };
  H.convert = async (v) => {
    const ll = F.parse(v.input);
    if (!ll) throw new Error('Reference not recognised. Accepted: MGRS, UTM, lat/lon (DD / DM / DMS), GARS, GEOREF or secondary-CRS E/N.');
    const crs = F.secondaryCRS();
    const zone = S.grid ? S.grid.zone : undefined;
    const rows = [
      ['MGRS', M.toMGRS(ll.lat, ll.lon, 5)], ['UTM', M.formatRef('utm', ll.lat, ll.lon)],
      ['DMS', M.formatLatLon(ll.lat, ll.lon, 'dms', 2)], ['DM', M.formatLatLon(ll.lat, ll.lon, 'dm', 4)], ['DD', M.formatLatLon(ll.lat, ll.lon, 'dd', 6)],
      ['GARS', M.toGARS(ll.lat, ll.lon, 5)], ['GEOREF', M.toGEOREF(ll.lat, ll.lon, 3)],
    ];
    if (zone && M.utmZoneFor(ll.lat, ll.lon) !== zone) rows.splice(2, 0, [`UTM ${zone}`, M.formatRef('utm', ll.lat, ll.lon, { zone })]);
    if (crs) rows.push([crs.name, M.formatRef('proj', ll.lat, ll.lon, { crs, geoStyle: 'dms', decimals: 2 })]);
    if (S.grid) {
      const p = M.latLonToCell(S.grid, ll.lat, ll.lon);
      const inside = M.inGrid(S.grid, Math.round(p.r), Math.round(p.c));
      rows.push(['In DEM', inside ? `yes — ${F.elev(M.sample(S.grid, S.L.z, p.r, p.c))}` : 'no']);
      if (inside) { S.gotoMark = { c: p.c, r: p.r }; refresh(); }
    }
    return rows.map(([k, x]) => `${k}: ${x}`).join('\n');
  };
  // ---------------------------------------------------------------- sector planning
  const needBorder = () => { needGrid(); if (!S.border) throw new Error('Draw the border line (LoC) first: Sector tab ▸ Border Line.'); };
  const rateCount = (items) => { const c = { Good: 0, Marginal: 0, 'Not good': 0 }; items.forEach((x) => x.rating && c[x.rating]++); return `${c.Good} Good · ${c.Marginal} Marginal · ${c['Not good']} Not good`; };
  const secDone = (layers, base) => { Object.assign(S.show, layers); renderAll(); refresh({ base: !!base }); };
  H.sectorTerrain = async (v) => {
    needGrid();
    await syncSettings();
    const r = await run('Terrain Value & Ridgelines', 'sectorTerrain', v, (x) => `${x.ridges.length} ridgelines · ${x.nullahs.length} nullahs / valleys`);
    S.sec = { terr: { ridges: r.ridges, nullahs: r.nullahs } };
    setOverlay('dominance', r.dominance, { name: 'Terrain value' });
    secDone({ ridges: true, nullahs: true }, true);
    const v2 = r.nullahs.filter((x) => x.type === 'valley').length;
    return `${r.ridges.length} ridgelines, ${r.nullahs.length - v2} nullahs, ${v2} valley segments.\nBest ridgelines: ` + r.ridges.slice(0, 4).map((x) => `${x.id} ${F.dist(x.lengthM)} (value ${Math.round(x.meanDominance)})`).join(', ') + (r.hasBorder ? '' : '\nTip: draw the border line (LoC) so own / enemy sides are known.');
  };
  H.itgs = async (v) => {
    needGrid();
    await syncSettings();
    const r = await run('ITGs', 'itgs', v, (x) => `${x.itgs.length} ITGs`);
    S.sec.itg = r; delete S.sec.plan; delete S.sec.fire; delete S.sec.watch;
    secDone({ itgs: true });
    return `${r.itgs.length} ITGs — ${rateCount(r.itgs)}\n` + r.itgs.map((x) => `${x.id}  ${F.listRef(x.r, x.c)}  ${F.elev(x.z)} · ${x.areaHa.toFixed(1)} ha · needs ${x.force.echelon} · ${x.rating}`).join('\n');
  };
  H.deploy = async (v) => {
    needGrid();
    await syncSettings();
    const r = await run(`Deployment Plan — ${M.DEPLOY_MODES[v.mode].name}`, 'deploy', v, (x) => `${x.platoons.length} platoons · ${x.borderPosts.length} border posts`);
    S.sec.plan = r; delete S.sec.fire; delete S.sec.watch; clearOverlay('firecov');
    if (!S.sec.itg) S.sec.itg = await engine.call('itgs', null);
    secDone({ plan: true, itgs: true }, true);
    const all = r.platoons.concat(r.borderPosts, r.companies.map((c) => c.hq), r.companies.map((c) => c.mortar).filter(Boolean), [r.bnHq, r.bnMortar].filter(Boolean));
    return `${r.modeName}: ${r.borderPosts.length} border posts, ${r.platoons.length} platoon posts, ${r.companies.length} company HQs, Bn HQ, ${r.companies.filter((c) => c.mortar).length + (r.bnMortar ? 1 : 0)} mortar positions — about ${r.troops} troops.\nRatings: ${rateCount(all)}\n` + r.notes.join('\n');
  };
  H.enemyApproaches = async (v) => {
    needBorder();
    await syncSettings();
    const ctxNow = runContext();
    const r = await run('Enemy Approaches', 'enemyApproaches', v, (x) => `${x.approaches.length} approaches`);
    annotateRun('enemyApproaches', Object.assign(ctxNow, { entryPoints: r.entries.length, defaultsApplied: r.params }));
    S.sec.appr = r; delete S.sec.opts;
    if (!S.sec.itg) S.sec.itg = await engine.call('itgs', null);
    secDone({ eappr: true });
    return `${r.approaches.length} approaches from ${r.entries.length} entry points.\n` + r.approaches.map((a) => `${a.id} → ${a.objective}: ${a.type}, ${F.dist(a.lengthM)}, ${F.time(a.timeH)}, ${Math.round(a.exposure * 100)}% watched · threat ${a.threat}`).join('\n');
  };
  H.infiltration = async (v) => {
    needBorder();
    await syncSettings();
    const ctxNow = runContext();
    const r = await run('Infiltration Routes', 'infiltration', v, (x) => `${x.routes.length} routes`);
    annotateRun('infiltration', Object.assign(ctxNow, { defaultsApplied: r.params, targets: S.sec.plan ? 'deployment-plan HQs (Bn HQ + company HQs)' : 'the 3 ITGs farthest from the border' }));
    S.sec.infil = r;
    secDone({ infil: true });
    return r.routes.map((a) => `${a.id}: ${a.type} to ${a.target} · ${F.dist(a.lengthM)}, ${F.time(a.timeH)} · ${Math.round(a.detectShare * 100)}% watched · threat ${a.threat}`).join('\n') + (S.sec.plan ? '' : '\nTip: run Deployment Plan first — routes are then judged against your posts.');
  };
  H.fireCoverage = async (v) => {
    needGrid();
    const extra = v.useWeaponSites ? S.weapons.flatMap((res) => res.sites.map((x) => ({ r: x.r, c: x.c, id: x.id, kind: res.weapon.cat === 'indirect' ? 'mortar' : 'direct', obsH: res.weapon.obsH || 1, tgtH: 1, maxR: x.maxR, minR: x.minR || 0 }))) : [];
    const r = await run('Fire Coverage & Interlocking', 'fireCoverage', { opts: v, extraWeapons: extra }, (x) => `${x.weapons.length} weapons · ${x.gaps.length} gaps`);
    S.sec.fire = { postCover: r.postCover, gaps: r.gaps, weapons: r.weapons, approachCover: r.approachCover };
    setOverlay('firecov', r.count, { name: 'Fire coverage' }, true);
    secDone({ firegaps: true }, true);
    return `${r.weapons.length} weapons. Interlocking: ${rateCount(r.postCover)}.\n` + (r.approachCover.length ? 'Approaches under fire (own side + 1 km): ' + r.approachCover.map((a) => `${a.id} ${Math.round(a.share * 100)}%`).join(', ') + '\n' : '') +
      (r.gaps.length ? `${r.gaps.length} fire gaps: ` + r.gaps.map((x) => `${x.id} on ${x.approach} ${F.dist(x.lengthM)}`).join(', ') : 'No fire gaps on the approaches.');
  };
  H.borderWatch = async (v) => {
    needBorder();
    const extra = v.includePosts && S.posts ? S.posts.posts.map((q) => ({ r: q.r, c: q.c })) : [];
    const r = await run('Border Surveillance', 'borderWatch', { opts: v, extraObservers: extra }, (x) => `${Math.round(x.observedShare * 100)}% observed`);
    S.sec.watch = { observedShare: r.observedShare, lengthM: r.lengthM, rating: r.rating, gaps: r.gaps, extraOPs: r.extraOPs };
    secDone({ bwatch: true });
    return `${Math.round(r.observedShare * 100)}% of ${F.dist(r.lengthM)} of border observed — ${r.rating}.\n${r.gaps.length} gaps: ` + r.gaps.map((x) => `${x.id} ${F.dist(x.lengthM)}`).join(', ') +
      (r.extraOPs.length ? '\nExtra OPs: ' + r.extraOPs.map((x) => `${x.id} ${F.listRef(x.r, x.c)} (${x.reasons[0]})`).join('; ') : '');
  };
  H.enemyOptions = async (v) => {
    needBorder();
    if (!S.sec.appr) await H.enemyApproaches(GP.values('enemyApproaches'));
    const ctxNow = runContext();
    const r = await run('Enemy Courses of Action', 'enemyOptions', v, (x) => `${x.options.length} options`);
    annotateRun('enemyOptions', ctxNow);
    S.sec.opts = r;
    secDone({ eopts: true });
    return r.options.map((o) => `${o.id}${o.label ? ` (${o.label})` : ''} — threat ${o.threat}\n  ${o.summary}\n  Recommendation: ${o.recommendation}`).join('\n');
  };
  H.sectorAll = async (v) => {
    needBorder();
    const steps = [];
    const st = (t) => steps.push(t.split('\n')[0]);
    st(await H.sectorTerrain(GP.values('sectorTerrain')));
    st(await H.itgs(GP.values('itgs')));
    st(await H.deploy(Object.assign(GP.values('deploy'), { mode: v.mode, companies: v.companies, platoonsPerCompany: v.platoonsPerCompany })));
    st(await H.enemyApproaches(Object.assign(GP.values('enemyApproaches'), { profile: v.profile })));
    st(await H.infiltration(GP.values('infiltration')));
    st(await H.fireCoverage(GP.values('fireCoverage')));
    st(await H.borderWatch(GP.values('borderWatch')));
    st(await H.enemyOptions(GP.values('enemyOptions')));
    // keep the map readable: plan, ITGs, approaches and border gaps on; the rest one tick away in Contents
    Object.assign(S.show, { ridges: false, nullahs: false, infil: false, eopts: false, firegaps: false, itgs: true, plan: true, eappr: true, bwatch: true });
    S.overlays.dominance.visible = false; S.overlays.firecov.visible = false;
    refresh({ base: true });
    const items = secItems().filter((x) => x.rating);
    return `Sector assessment complete — ${rateCount(items)} across ${items.length} items.\n` + steps.map((x, k) => `${k + 1}. ${x}`).join('\n') + '\nOther layers (infiltration routes, enemy options, ridgelines, nullahs, fire gaps) are one tick away in Contents ▸ Sector plan. Ratings: attribute table; full write-up: Share ▸ Report.';
  };

  /** Every rated sector item, for the Contents pane, attribute table, Attributes pane and report. */
  const secItems = () => {
    const X = S.sec, out = [];
    const add = (layer, idx, o) => out.push(Object.assign({ layer, idx }, o));
    if (X.itg) X.itg.itgs.forEach((q, k) => add('itgs', k, { id: q.id, type: 'ITG', r: q.r, c: q.c, z: q.z, rating: q.rating, reasons: q.reasons,
      detail: `${q.areaHa.toFixed(1)} ha · perimeter ${F.dist(q.perimeterM)} · needs ${q.force.echelon} (~${q.force.troops}) · score ${q.score.toFixed(2)}`,
      fields: [['Dominance', `${Math.round(q.dominance)}/100`], ['Area', `${q.areaHa.toFixed(1)} ha`], ['Perimeter', F.dist(q.perimeterM)], ['Force to hold', `${q.force.echelon} (~${q.force.troops} all ranks)`],
        ['Observation over approaches', `${Math.round(q.obsShare * 100)}%`], ['Distance from border', q.borderDistM == null ? '—' : F.dist(q.borderDistM)], ['Mean slope', `${q.meanSlope.toFixed(0)}°`], ['Score', q.score.toFixed(2)]] }));
    if (X.plan) {
      const P = X.plan;
      P.borderPosts.forEach((q, k) => add('plan', `bp${k}`, { id: q.id, type: 'Border post', sym: UI.SYM.op(), r: q.r, c: q.c, z: q.z, rating: q.rating, reasons: q.reasons, detail: q.reasons.join(' · ') }));
      P.platoons.forEach((q, k) => add('plan', `pl${k}`, { id: q.id, type: `Platoon post (${q.role})`, sym: UI.SYM.post('platoon'), r: q.r, c: q.c, z: q.z, rating: q.rating, reasons: q.reasons, detail: q.reasons.join(' · ') }));
      P.companies.forEach((co, k) => {
        add('plan', `hq${k}`, { id: co.hq.id, type: 'Company HQ', sym: UI.SYM.hq('company'), r: co.hq.r, c: co.hq.c, z: co.hq.z, rating: co.hq.rating, reasons: co.hq.reasons, detail: `${co.platoons.map((q) => q.id).join(', ')} · ${co.hq.reasons[0]}` });
        if (co.mortar) add('plan', `mo${k}`, { id: co.mortar.id, type: '60 mm mortar', sym: UI.SYM.weapon(M.WEAPONS.mor60), r: co.mortar.r, c: co.mortar.c, z: co.mortar.z, rating: co.mortar.rating, reasons: co.mortar.reasons, detail: co.mortar.reasons[0] });
      });
      if (P.bnHq) add('plan', 'bn', { id: 'Bn HQ', type: 'Battalion HQ', sym: UI.SYM.hq('battalion'), r: P.bnHq.r, c: P.bnHq.c, z: P.bnHq.z, rating: P.bnHq.rating, reasons: P.bnHq.reasons, detail: P.bnHq.reasons[0] });
      if (P.bnMortar) add('plan', 'bnm', { id: P.bnMortar.id, type: '81 mm mortar', sym: UI.SYM.weapon(M.WEAPONS.mor81), r: P.bnMortar.r, c: P.bnMortar.c, z: P.bnMortar.z, rating: P.bnMortar.rating, reasons: P.bnMortar.reasons, detail: P.bnMortar.reasons[0] });
    }
    if (X.fire) {
      X.fire.postCover.forEach((q) => { const it = out.find((x) => x.id === q.id && x.layer === 'plan'); if (it) { it.reasons = it.reasons.concat(q.reasons); if (q.rating === 'Not good' && it.rating === 'Good') it.rating = 'Marginal'; } });
      X.fire.gaps.forEach((q, k) => add('firegaps', k, { id: q.id, type: 'Fire gap', r: q.r, c: q.c, rating: q.rating, reasons: q.reasons, detail: q.reasons[0] }));
    }
    if (X.watch) {
      X.watch.gaps.forEach((q, k) => add('bwatch', `g${k}`, { id: q.id, type: 'Border gap', r: q.r, c: q.c, rating: q.rating, reasons: q.reasons, detail: q.reasons[0] }));
      X.watch.extraOPs.forEach((q, k) => add('bwatch', `x${k}`, { id: q.id, type: 'Extra OP (suggested)', sym: UI.SYM.op(), r: q.r, c: q.c, z: q.z, rating: q.rating, reasons: q.reasons, detail: q.reasons[0] }));
    }
    const lineRef = (a) => ({ r: a.line[Math.floor(a.line.length / 2)][1], c: a.line[Math.floor(a.line.length / 2)][0] });
    if (X.appr) X.appr.approaches.forEach((a, k) => add('eappr', k, Object.assign(lineRef(a), { id: a.id, type: `Enemy approach (${a.type})`, rating: a.rating, reasons: a.reasons.concat([`threat ${a.threat}`]),
      detail: `→ ${a.objective} · ${F.dist(a.lengthM)} · ${F.time(a.timeH)} · ${Math.round(a.exposure * 100)}% watched · threat ${a.threat}`,
      fields: [['Objective', a.objective], ['Type', a.type], ['Length', F.dist(a.lengthM)], ['Time', F.time(a.timeH)], ['Climb', F.height(a.ascentM)], ['Watched by own posts', `${Math.round(a.exposure * 100)}%`], ['Threat', a.threat]] })));
    if (X.infil) X.infil.routes.forEach((a, k) => add('infil', k, Object.assign(lineRef(a), { id: a.id, type: `Infiltration route (${a.type})`, rating: a.rating, reasons: a.reasons, detail: a.reasons.slice(0, 3).join(' · '),
      fields: [['Target', a.target], ['Length', F.dist(a.lengthM)], ['Time on foot', F.time(a.timeH)], ['Watched (own side)', `${Math.round(a.detectShare * 100)}%`], ['In nullahs / dead ground', `${Math.round(a.nullahShare * 100)}%`], ['Threat', a.threat]] })));
    if (X.opts) X.opts.options.forEach((o, k) => add('eopts', k, { id: o.id, type: `Enemy option${o.label ? ` — ${o.label}` : ''}`, r: o.objectiveRef.r, c: o.objectiveRef.c, rating: o.rating,
      reasons: [o.summary, `Recommendation: ${o.recommendation}`], detail: `${o.summary} Threat ${o.threat}.`,
      fields: [['Objective', o.objective], ['Main approach', o.main], ['Supporting', o.support || '—'], ['Threat', o.threat], ['Score', o.score.toFixed(2)]] }));
    if (S.rvs) S.rvs.watch.forEach((q, k) => add('rvs', k, { id: `W${k + 1}`, type: 'Route watch point', sym: UI.SYM.op(), r: q.r, c: q.c, z: q.z,
      rating: q.share >= 0.6 ? 'Good' : q.share >= 0.3 ? 'Marginal' : 'Not good', reasons: [`sees ${Math.round(q.share * 100)}% of ${S.rvs.label}`],
      detail: `sees ${Math.round(q.share * 100)}% of ${S.rvs.label}`, fields: [['Route', S.rvs.label], ['Share of route seen', `${Math.round(q.share * 100)}%`]] }));
    if (X.terr) X.terr.ridges.slice(0, 15).forEach((q, k) => add('ridges', k, Object.assign(lineRef(q), { id: q.id, type: 'Ridgeline', rating: q.rating, reasons: [`mean terrain value ${Math.round(q.meanDominance)}`, `${q.side} side`],
      detail: `${F.dist(q.lengthM)} · value ${Math.round(q.meanDominance)} · ${q.side} side` })));
    return out;
  };
  UI._secItems = secItems;

  for (const [id, fn] of Object.entries(H)) GP.handle(id, fn);

  // =================================================================== selection & Attributes pane
  const posOf = (ref) => {
    if (!ref) return null;
    switch (ref.kind) {
      case 'post': return S.posts && S.posts.posts[ref.idx];
      case 'weapon': return S.weapons[ref.idx] && S.weapons[ref.idx].sites[ref.sub];
      case 'mfd': return S.mfd && S.mfd.fields[ref.idx];
      case 'picquet': return S.picquets && S.picquets.picquets[ref.idx];
      case 'hls': return S.helipads && S.helipads.pads[ref.idx];
      case 'key': return S.key && (ref.sub === 'pass' ? S.key.passes : S.key.peaks)[ref.idx];
      case 'marker': return S.markers[ref.idx];
      case 'route': return S.routes && S.routes.routes[ref.idx] && { c: S.routes.routes[ref.idx].line[0][0], r: S.routes.routes[ref.idx].line[0][1] };
      case 'avenue': return S.avenues && S.avenues.routes[ref.idx] && { c: S.avenues.routes[ref.idx].line[0][0], r: S.avenues.routes[ref.idx].line[0][1] };
      case 'cp': return S.routes && S.routes.routes[S.routes.sel || 0].checkpoints[ref.idx];
      case 'point': return { c: ref.c, r: ref.r };
      case 'rline': { const rr = recByKey(ref.key); return rr ? { c: rr.line[0][0], r: rr.line[0][1] } : null; }
      case 'rvertex': { const rr = recByKey(ref.key); return rr && rr.line[ref.v] ? { c: rr.line[ref.v][0], r: rr.line[ref.v][1] } : null; }
      case 'sec': return secItems().find((x) => x.layer === ref.layer && x.idx === ref.idx) || null;
      default: return null;
    }
  };
  const select = (ref, zoom, fromMap) => {
    if (ref && ref.kind === 'route') { S.routes.sel = ref.idx; S.picquets = null; showRouteProfile(); renderRouteCard(); }
    S.sel = ref;
    renderAll();
    const pos = posOf(ref);
    if (zoom && pos) {
      if (S.view === '3d') v3.lookAtCell(pos.c, pos.r);
      else map.centerOn(pos.c, pos.r, Math.max(map.view.scale, 2));
    }
    if (fromMap || zoom) showRightTab('attr');
    refresh();
  };
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast(`Copied: ${text}`);
  };
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
    if (i >= 0 && i < S.L.slope.length) {
      rows.push(['Slope / aspect', `${S.L.slope[i].toFixed(1)}° / ${S.L.aspect[i] < 0 ? 'flat' : F.bearing(S.L.aspect[i], r, c)}`]);
      rows.push(['Landform', M.LANDFORMS[S.L.landform[i]].name.split(' (')[0]]);
      const mob = S.overlays.mobility.data;
      if (mob) rows.push(['Mobility', `${M.CLASS_NAMES[mob[i]]} (${M.MOVEMENT_PROFILES[S.overlays.mobility.profile].name.split(' (')[0]})`]);
    }
    rows.push(['Grid convergence', `${F.convergence(r, c).toFixed(3)}°`]);
    return rows;
  };
  const renderSelection = () => {
    const el = $('selBody');
    const ref = S.sel;
    const p = posOf(ref);
    if (!p || !S.grid) { el.innerHTML = '<p class="hint pad">Select a feature on the map or in the attribute table. Click empty ground to inspect a location.</p>'; return; }
    let icon = '', title = '', sub = '';
    const rows = [];
    const mk = { own: ['Own position', UI.ownSpec()], threat: ['Enemy', UI.threatSpec()], target: ['Target area', UI.SYM.target()], a: ['Route start (SP)', UI.SYM.sp()], b: ['Route end (RP)', UI.SYM.rp()] };
    switch (ref.kind) {
      case 'post': {
        const P = S.posts;
        icon = UI.symbolHTML(P.mode === 'op' ? UI.SYM.op() : UI.SYM.post(P.echelon), 26);
        title = p.id; sub = P.mode === 'op' ? 'Observation post (planned)' : `Defended post — ${P.echelon} (planned)`;
        const mates = P.links.filter((l) => l[0] === ref.idx || l[1] === ref.idx).map((l) => P.posts[l[0] === ref.idx ? l[1] : l[0]].id);
        if (p.strongPoint) sub += ' — STRONG POINT (most dominating)';
        rows.push(['Assessment', null], ['Defence tier (GSP)', p.tier || '—'], ['Landform', p.landform.split(' (')[0]], ['Visible area', F.area(p.visibleKm2)], ['Approach coverage', pct(p.valueShare, 1)],
          ['Access', p.accessH === null ? '—' : F.time(p.accessH)], ['Intervisible with', mates.join(', ') || 'none']);
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
          if (p.sightFactor) rows.push(['Mean angle of sight', `${p.meanAngleDeg.toFixed(1)}°`], ['Sight setting (GSP Sec 18)', `slant range ÷ ${p.sightFactor.toFixed(2)}`],
            ['Dead to mount limits', pct(p.plungeDeadShare || 0, 1) + ' of target ground']);
        }
        rows.push(['Range band', `${F.dist(p.minR)} – ${F.dist(p.maxR)}`], ['Landform', p.landform.split(' (')[0]], ['Access', p.accessH === null ? '—' : F.time(p.accessH)]);
        break;
      }
      case 'mfd':
        icon = UI.symbolHTML(UI.SYM.mine(p.type), 22); title = p.id; sub = `${p.type === 'AT' ? 'Anti-tank' : 'Anti-personnel'} minefield (planned)`;
        rows.push(['Assessment', null], ['Rating', p.rating || '—'], ...(p.reasons || []).map((x, k) => [k ? '' : 'Why', x]),
          ['Delay imposed', p.delayMin === undefined ? '—' : `${Math.round(p.delayMin)} min (${p.forcesBreach ? 'must breach' : 'detour'})`]);
        rows.push(['Obstacle', null], ['Gap at defile', p.gapM == null ? 'none — not tied in' : F.dist(p.gapM)], ['Front × depth', `${F.dist(p.frontM)} × ${F.dist(p.depthM)}`], ['Orientation', F.bearing(p.orientationDeg, p.r, p.c)],
          ['Est. mines', `≈ ${p.estMines}`], ['Site slope', p.siteSlopeDeg === undefined ? '—' : `${p.siteSlopeDeg.toFixed(0)}°`], ['Ground note (GSP)', p.note || 'suitable'], ['On avenues', p.onAvenues.length ? 'AA ' + p.onAvenues.join(', ') : '—'], ['Observed / covered', p.covered ? 'yes' : 'NO — site an OP or weapon']);
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
          ['GSP time — day', rt.gspDay ? gspRange(rt.gspDay) : '—'], ['GSP time — night', rt.gspNight ? gspRange(rt.gspNight) : '—'], ['Max grade', `${rt.maxGradeDeg.toFixed(0)}°`], ['Slow-Go', pct(rt.slowFrac)], ['Exposed', pct(rt.exposedFrac)], ['Highest point', F.elev(rt.highestM)]);
        break;
      }
      case 'avenue': {
        const rt = S.avenues.routes[ref.idx];
        title = `AA${ref.idx + 1}`; sub = 'Enemy avenue of approach';
        rows.push(['Avenue', null], ['Length', F.dist(rt.lengthM)], ['Time', F.time(rt.timeH)], ['Slow-Go', pct(rt.slowFrac || 0)]);
        break;
      }
      case 'hls':
        title = p.id; sub = `Helipad / landing site — ${p.use}`;
        rows.push(['Landing site', null], ['Mean slope', `${p.meanSlopeDeg.toFixed(1)}° (limit ${p.slopeLimitDeg}°)`], ['Enemy observation', p.hidden ? 'hidden' : 'SEEN'],
          ['Landform', p.landform.split(' (')[0]], ['From own position', p.distOwnM === null ? '—' : F.dist(p.distOwnM)], ['Access', p.accessH === null ? '—' : F.time(p.accessH)]);
        break;
      case 'cp': icon = UI.symbolHTML(UI.SYM.cp(ref.idx + 1), 20); title = `CKP ${ref.idx + 1}`; sub = `Checkpoint — km ${(p.d / 1000).toFixed(1)}`; break;
      case 'point': title = 'Location'; sub = 'Inspected point'; break;
      case 'rline': {
        const rr = recByKey(ref.key);
        icon = UI.icon('route', 22); title = rr.id; sub = `${RCAT[rr.cat].name} — model output, not a prediction`;
        rows.push(['Generated line', null], ['Run', rr.run ? `${rr.run.id} · ${rr.run.label}` : NR], ['Vertices', String(rr.line.length)], ['Length', rr.src.lengthM !== undefined ? F.dist(rr.src.lengthM) : NR],
          ['Start origin', endpointOrigin(rr, 0)[0]], ['End origin', endpointOrigin(rr, 1)[0]], ['Full provenance', 'Side pane ▸ Routes (audit trail, parameters, vertices)']);
        break;
      }
      case 'rvertex': {
        const vr = vertexRows(ref);
        icon = UI.icon('target', 22); title = `${vr.r.id} — ${vr.role}`; sub = 'Point of a generated line (model output)';
        rows.push(...vr.rows);
        break;
      }
      case 'sec':
        icon = p.sym ? UI.symbolHTML(p.sym, 24) : ''; title = p.id; sub = p.type;
        rows.push(['Assessment', null], ['Rating', p.rating || '—'], ...(p.reasons || []).map((x, k) => [k ? '' : 'Why', x]));
        if (p.fields) rows.push(['Details', null], ...p.fields);
        break;
      default: title = ref.kind;
    }
    const topic = UI.explainTopicForRef(ref);
    const routeBlock = ref.kind === 'route' || ref.kind === 'cp' ? routeInfoHTML(ref.kind === 'route' ? ref.idx : S.routes.sel || 0) : '';
    el.innerHTML = `<div class="sel-head">${icon}<div><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div></div>
      ${routeBlock}
      <table class="pgrid${ref.kind === 'rline' || ref.kind === 'rvertex' ? ' ex-t' : ''}">${pgrid(rows.concat(positionRows(p.r, p.c)))}</table>
      <div class="sel-actions">${topic ? '<button class="btn sm ex-go" data-act="explain">Explain this result</button>' : ''}<button class="btn sm" data-act="copy">Copy reference</button><button class="btn sm" data-act="zoom">Zoom to</button><button class="btn sm" data-act="vs">Viewshed from here</button></div>
      ${ref.kind === 'weapon' ? weaponObjectHTML(ref, p) : ''}${symbolPanelHTML(ref, p)}`;
    if (topic) el.querySelector('[data-act=explain]').onclick = () => openExplain(topic, { ref });
    wireSymbolPanel(el, ref, p);
    el.querySelector('[data-act=copy]').onclick = () => copyText(F.listRef(p.r, p.c));
    el.querySelector('[data-act=zoom]').onclick = () => (S.view === '3d' ? v3.lookAtCell(p.c, p.r, 3500) : map.centerOn(p.c, p.r, Math.max(map.view.scale, 3)));
    el.querySelector('[data-act=vs]').onclick = () => { GP.set('viewshed', 'observer', { c: Math.round(p.c), r: Math.round(p.r) }); GP.open('viewshed'); GP.run('viewshed'); };
  };

  // =================================================================== route information, object & symbol inspectors
  /** Recorded inputs and processing history of a generated route (no recommendation implied). */
  const routeInfoHTML = (idx) => {
    if (!S.routes) return '';
    const rt = S.routes.routes[idx];
    if (!rt) return '';
    const run = S.lastRun.route;
    const prof = profileOf(S.routes.profile);
    const mk = S.markers;
    const modeName = S.routes.mode === 'custom' ? 'Custom weights' : (M.ROUTE_MODES[S.routes.mode] || {}).name || S.routes.mode;
    const rows = [
      ['Route information', null],
      ['Selected start (A)', mk.a ? F.listRef(mk.a.r, mk.a.c) : '—'], ['Selected destination (B)', mk.b ? F.listRef(mk.b.r, mk.b.c) : '—'],
      ['Distance (plan / along slope)', `${F.dist(rt.lengthM)} / ${F.dist(rt.length3dM || rt.lengthM)}`], ['Elevation profile', 'Bottom dock ▸ Elevation profile'],
      ['Terrain datasets used', `${S.grid.name} (${S.grid.cs} m) → slope (Horn) → mobility classes${S.obstacles.length || S.tracks.length ? ` + ${S.obstacles.length} No-Go areas, ${S.tracks.length} tracks` : ''}`],
      ['Processing method', `A* least-cost search, ${cfg('an.routeNeighbours') === 8 ? 8 : 16}-connected; cost = modelled travel time${S.routes.mode !== 'fastest' ? ' × weighted penalties' : ''}`],
      ['Movement class', `${prof.name} — GO < ${prof.go}°, NO-GO ≥ ${prof.slow}°, ${prof.speed} km/h level`], ['Cost mode', modeName],
      ['Run recorded', run ? `${new Date(run.t).toLocaleTimeString()} · ${(run.dur / 1000).toFixed(1)} s · ${run.engine}` : 'not recorded in this session (loaded from a plan file?)'],
    ];
    return `<div class="ex-banner">Generated by the terrain cost model for the parameters recorded below. It is <b>not</b> a verified or recommended real-world route — confirm by reconnaissance.</div>
      <table class="pgrid">${pgrid(rows)}</table>`;
  };

  const ECH_NAMES = { 11: 'Team / crew', 12: 'Squad', 13: 'Section', 14: 'Platoon / detachment', 15: 'Company / battery', 16: 'Battalion', 17: 'Regiment / group', 18: 'Brigade' };
  /** Field-by-field reading of a 20-digit 2525D / APP-6D SIDC as generated by MtnEye. */
  const decodeSIDC = (s) => [
    ['Version', s.slice(0, 2)], ['Context', { 0: 'Reality', 1: 'Exercise', 2: 'Simulation' }[s[2]] || s[2]],
    ['Standard identity', { 0: 'Pending', 1: 'Unknown', 2: 'Assumed friend', 3: 'Friend', 4: 'Neutral', 5: 'Suspect', 6: 'Hostile' }[s[3]] || s[3]],
    ['Symbol set', { 10: 'Land unit', 15: 'Land equipment', 25: 'Control measure' }[s.slice(4, 6)] || s.slice(4, 6)],
    ['Status', s[6] === '1' ? 'Planned / anticipated' : 'Present'], ['HQ / task force / dummy', s[7]],
    ['Amplifier (echelon / mobility)', ECH_NAMES[s.slice(8, 10)] || s.slice(8, 10)], ['Entity · type · subtype', `${s.slice(10, 12)} · ${s.slice(12, 14)} · ${s.slice(14, 16)}`],
    ['Sector 1 / sector 2 modifier', `${s.slice(16, 18)} / ${s.slice(18, 20)}`],
  ];
  const ICON_NAMES = { inf: 'Infantry', armr: 'Armour', mech: 'Mechanised infantry', at: 'Anti-tank', recce: 'Reconnaissance', arty: 'Artillery', ad: 'Air defence', engr: 'Engineer',
    mg: 'Machine gun', atrl: 'Anti-tank rocket launcher', rcl: 'Recoilless gun', atgm: 'Anti-tank missile launcher', mortar: 'Mortar', how: 'Howitzer / gun', sam: 'Air defence missile launcher', adgun: 'Air defence gun',
    op: 'Observation post', fo: 'Forward observer', cp: 'Checkpoint', sp: 'Start point', rp: 'Release point', trp: 'Target reference point', atmine: 'Anti-tank mine', apmine: 'Anti-personnel mine' };
  /** SIDC for a symbol spec, using the export module's builder (null when the export has no code for it). */
  const sidcForSpec = (spec) => UI.sidcForSpec(spec);
  /** Symbol spec of the selected item (null when it has no map symbol). */
  const specOf = (ref, p) => {
    switch (ref.kind) {
      case 'marker': return { own: UI.ownSpec(), threat: UI.threatSpec(), target: UI.SYM.target(), a: UI.SYM.sp(), b: UI.SYM.rp() }[ref.idx];
      case 'post': return S.posts.mode === 'op' ? UI.SYM.op() : UI.SYM.post(S.posts.echelon);
      case 'weapon': return UI.SYM.weapon(S.weapons[ref.idx].weapon);
      case 'picquet': return UI.SYM.picquet();
      case 'cp': return UI.SYM.cp(ref.idx + 1);
      case 'mfd': return UI.SYM.mine(p.type);
      case 'sec': return p.sym || null;
      default: return null;
    }
  };
  const FUNC_OPTS = [['', 'Automatic'], ['inf', 'Infantry'], ['armr', 'Armour'], ['mech', 'Mechanised infantry'], ['recce', 'Reconnaissance'], ['at', 'Anti-tank'], ['arty', 'Artillery'], ['ad', 'Air defence'], ['engr', 'Engineer']];
  const symbolPanelHTML = (ref, p) => {
    const spec = specOf(ref, p);
    if (!spec) return '';
    const sidc = sidcForSpec(spec);
    const fk = UI.frameKindOf(spec);
    const editable = ref.kind === 'marker' && (ref.idx === 'own' || ref.idx === 'threat');
    const o = editable ? S.symOpts[ref.idx] : null;
    const ech = editable ? (ref.idx === 'own' ? S.ownEchelon : o.echelon) : spec.echelon;
    const custom = cfg('sym.unitConvention') !== 'app6';
    const attrs = [
      ['Symbol', null], ['Standard', 'APP-6(D) / MIL-STD-2525D (MtnEye renderer subset)'],
      ['Symbol set', { unit: 'Land unit', equip: 'Land equipment', cm: 'Control measure (point)' }[spec.set]],
      ['Affiliation', { F: 'Friend', H: 'Hostile', N: 'Neutral', U: 'Unknown' }[spec.affil || 'F']],
      ['Status', spec.planned ? 'Planned / anticipated (dashed)' : 'Present (solid)'],
      ['Function icon', ICON_NAMES[spec.icon] || spec.icon],
    ];
    if (spec.set === 'unit') attrs.push(['Echelon amplifier', ech ? ech[0].toUpperCase() + ech.slice(1) : '—'], ['Headquarters (isHQ)', spec.isHQ === true ? `yes — “${spec.hqText || 'HQ'}”` : 'no (formation)'],
      ['Frame', UI.FRAME_NAMES[fk] + (custom && (fk === 'hq' || fk === 'goose') ? ' — custom cartographic convention, not an official APP-6(D) frame' : '')],
      ['Frame rule', spec.isHQ ? 'HQ status overrides the formation frame' : UI.GOOSE_ECHELONS.includes(ech) ? 'Platoon / company / battalion formation' : 'Other echelons keep the standard frame'],
      ['Modifiers', (spec.mods || []).includes('mountain') ? 'Mountain (sector 2)' : 'none']);
    if (spec.rng) attrs.push(['Range amplifier', `${spec.rng} bar(s) (light / medium / heavy)`]);
    attrs.push(['Display', `${cfg('sym.size')} px${editable && +o.size !== 1 ? ` × ${o.size}` : ''} · ${cfg('sym.colorMode')} colours · ${cfg('sym.filled') ? 'filled' : 'unfilled'} frames`]);
    const sel = (k, opts, v) => `<select data-sym-k="${k}">${opts.map(([x, n]) => `<option value="${x}" ${String(x) === String(v) ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    const edit = editable ? `<div class="sel-edit">
        <label>Formation echelon${sel('echelon', ['team', 'squad', 'section', 'platoon', 'company', 'battalion', 'regiment', 'brigade'].map((e) => [e, e[0].toUpperCase() + e.slice(1)]), ech)}</label>
        <label class="chk" style="margin-top:14px"><input type="checkbox" data-sym-k="isHQ" ${o.isHQ ? 'checked' : ''}> Headquarters (square frame)</label>
        <label>Affiliation${sel('affil', [['F', 'Friend'], ['H', 'Hostile'], ['N', 'Neutral'], ['U', 'Unknown']], o.affil || (ref.idx === 'own' ? 'F' : 'H'))}</label>
        <label>Unit function${sel('func', FUNC_OPTS, o.func || '')}</label>
        <label>Status${sel('planned', [['0', 'Present'], ['1', 'Planned / anticipated']], o.planned ? '1' : '0')}</label>
        <label>Display size${sel('size', [['0.75', '75 %'], ['1', '100 %'], ['1.25', '125 %'], ['1.5', '150 %']], String(o.size || 1))}</label>
        <label>Unit designation (label)<input type="text" data-sym-k="designation" value="${esc(o.designation || '')}" maxlength="24" spellcheck="false"></label>
        <label>HQ designation<input type="text" data-sym-k="hqDesignation" value="${esc(o.hqDesignation || '')}" placeholder="${esc(UI.HQ_TEXT[ech] || 'HQ')}" maxlength="16" spellcheck="false" ${o.isHQ ? '' : 'disabled'}></label>
        ${ref.idx === 'threat' ? `<label class="wide">Enemy movement type (analysis)${sel('type', [['foot', 'Infantry'], ['jeep', 'Wheeled / mech'], ['tracked', 'Armour'], ['mule', 'Animal transport'], ['truck', 'Trucks']], S.threatType)}</label>` : ''}
      </div><p class="sel-note">HQ status is stored separately from the echelon: a battalion formation and a battalion HQ are different symbols. The global frame convention (Settings ▸ Symbology) never turns an HQ into a goose egg. Edits apply to the 2D map, 3D scene, legends, attribute table, GeoJSON (SIDC, frame fields), plan file and PNG export, which all use the same renderer.</p>`
      : '<p class="sel-note">Tool outputs carry the symbol set by the tool (suggestions are drawn as planned; sector-plan HQs are explicit headquarters). Size, colour mode and frame convention: Settings ▸ Symbology.</p>';
    return `<h5 class="subh">${UI.icon('tactical', 13)} Symbol properties & editor</h5>
      <div class="sym-prev">${UI.symbolHTML(spec, 46)}</div>${edit}
      <table class="pgrid">${pgrid(attrs)}</table>
      ${sidc ? `<table class="pgrid"><tr class="sub"><td colspan="2">Symbol identification code (export)</td></tr><tr><td>SIDC</td><td class="sidc"><b>${sidc.slice(0, 4)}</b>${sidc.slice(4, 10)}<b>${sidc.slice(10, 16)}</b>${sidc.slice(16)}</td></tr>${pgrid(decodeSIDC(sidc))}</table>
        <p class="sel-note">Field layout per the 2525D / APP-6D 20-digit SIDC. Entity, modifier and HQ codes are those generated by MtnEye and have <b>not</b> been independently verified against the standard tables. The goose egg / HQ square are display conventions and are not encoded in the SIDC.</p>` : '<p class="sel-note">Not available — MtnEye has no verified SIDC entity code for this function, so none is generated.</p>'}
      <div class="sel-actions"><button class="btn sm" data-act="symExplain">About the symbology</button><button class="btn sm" data-act="symMatrix">Frame matrix…</button><button class="btn sm" data-act="symSettings">Symbology settings…</button></div>`;
  };
  const wireSymbolPanel = (el, ref, p) => {
    const b1 = el.querySelector('[data-act=symExplain]'), b2 = el.querySelector('[data-act=symSettings]'), b3 = el.querySelector('[data-act=symMatrix]');
    if (b1) b1.onclick = () => openExplain('symbols', { ref });
    if (b2) b2.onclick = () => Settings.open('sym');
    if (b3) b3.onclick = () => openSymbolMatrix();
    el.querySelectorAll('[data-sym-k]').forEach((inp) => inp.addEventListener('change', async () => {
      const k = inp.dataset.symK, v = inp.type === 'checkbox' ? inp.checked : inp.value, o = S.symOpts[ref.idx];
      pushUndo(`Symbol ${k}`);
      if (k === 'echelon') { if (ref.idx === 'own') S.ownEchelon = v; else o.echelon = v; }
      else if (k === 'planned') o.planned = v === '1';
      else if (k === 'isHQ') o.isHQ = !!v;
      else if (k === 'size') o.size = +v;
      else if (['designation', 'hqDesignation'].includes(k)) o[k] = String(v).trim();
      else if (k === 'affil' || k === 'func') o[k] = v;
      else if (k === 'type') { S.threatType = v; S.avenues = null; clearOverlay('avenues'); await syncSettings(); }
      syncRibbonInputs(); renderAll(); refresh({ base: k === 'type' });
    }));
    el.querySelectorAll('[data-unit]').forEach((inp) => inp.addEventListener('change', () => { p.unit = inp.value.trim(); renderAttrTable(); toast('Associated unit saved with the plan.'); }));
    el.querySelectorAll('[data-docref]').forEach((b) => (b.onclick = () => openDocs(b.dataset.docref)));
  };
  /** Test matrix of the frame rule, drawn with the real renderer. */
  const openSymbolMatrix = () => {
    const echs = ['platoon', 'company', 'battalion'];
    const rows = [];
    const expect = (hq) => (cfg('sym.unitConvention') === 'app6' ? (hq ? 'app6hq' : 'standard') : hq ? 'hq' : 'goose');
    let pass = 0, total = 0;
    for (const affil of ['F', 'H']) for (const hq of [false, true]) for (const ech of echs) {
      const cells = [false, true].map((planned) => {
        const spec = { set: 'unit', affil, icon: affil === 'F' ? 'inf' : 'inf', mods: affil === 'F' ? ['mountain'] : [], echelon: ech, planned };
        if (hq) Object.assign(spec, { isHQ: true, hqText: UI.HQ_TEXT[ech] });
        const svg = UI.symbolSVG(spec), ok = svg.frameKind === expect(hq);
        total++; if (ok) pass++;
        return `<td><div class="sm-sym">${UI.symbolHTML(spec, 34)}</div><div class="sm-cap">${svg.frameKind} · ${UI.sidcForSpec(spec) || '—'}</div><div class="${ok ? 'sm-ok' : 'sm-bad'}">${ok ? '✓ correct' : '✗ wrong'}</div></td>`;
      });
      rows.push(`<tr><td class="lbl">${affil === 'F' ? 'Friendly' : 'Hostile'} ${ech}${hq ? ' <b>HQ</b>' : ''}</td><td class="lbl">${UI.FRAME_NAMES[expect(hq)]}</td>${cells.join('')}</tr>`);
    }
    // the rule must hold whatever the global convention: other echelons keep the standard frame
    const sec = UI.symbolSVG({ set: 'unit', affil: 'F', icon: 'inf', echelon: 'section' });
    const okSec = sec.frameKind === 'standard'; total++; if (okSec) pass++;
    rows.push(`<tr><td class="lbl">Friendly section (non-listed echelon)</td><td class="lbl">${UI.FRAME_NAMES.standard}</td><td colspan="2"><div class="sm-sym">${UI.symbolHTML({ set: 'unit', affil: 'F', icon: 'inf', echelon: 'section' }, 34)}</div><div class="${okSec ? 'sm-ok' : 'sm-bad'}">${okSec ? '✓ correct' : '✗ wrong'}</div></td></tr>`);
    $('symMatrixBody').innerHTML = `<p class="hint">Rendered live by the same function used for the 2D map, 3D scene, legends, attribute table, editor and exports (UI.symbolSVG → UI.frameKindOf). Convention: <b>${cfg('sym.unitConvention') === 'app6' ? 'APP-6(D) frames' : 'MtnEye overlay convention — goose egg = formation, square = headquarters (custom, not official APP-6(D) frames)'}</b>.</p>
      <table class="sm-t"><thead><tr><th>Object</th><th>Expected frame</th><th>Present</th><th>Planned</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
    $('symMatrixNote').textContent = `${pass} / ${total} frame checks correct`;
    UI._symMatrixResult = { pass, total };
    if (!$('symMatrix').open) $('symMatrix').showModal();
  };
  /** Weapon / equipment object: attributes with their origin (user-entered, built-in table, calculated). */
  const weaponObjectHTML = (ref, p) => {
    const res = S.weapons[ref.idx];
    const w = res.weapon, ov = (cfg('weapons') || {})[w.id] || {};
    const grp = (M.WEAPON_GROUPS.find((gr) => gr.ids.includes(w.id)) || {}).name || w.cat;
    const tag = (k) => (k in ov ? '<span class="orig user">user</span>' : '<span class="orig table">table</span>');
    const ll = M.cellToLatLon(S.grid, p.r, p.c);
    const row = (k, v, t) => `<tr><td>${esc(k)}</td><td>${v}${t || ''}</td></tr>`;
    const sidc = UI.sidcFor.weapon(w);
    return `<h5 class="subh">${UI.icon('data', 13)} Object information</h5>
      <table class="pgrid ex-t">
        ${row('Object name', esc(w.name), '<span class="orig table">table</span>')}
        ${row('Category', esc(grp), '<span class="orig table">table</span>')}
        ${row('Symbol identification', `<span class="sidc">${esc(sidc)}</span>`, '<span class="orig calc">calculated</span>')}
        ${row('Recorded coordinates', `${esc(F.listRef(p.r, p.c))}<br>${esc(M.formatLatLon(ll.lat, ll.lon, 'dd', 6))}`, '<span class="orig calc">calculated</span>')}
        ${row('Associated unit / formation', `<input type="text" data-unit value="${esc(p.unit || '')}" placeholder="not entered" spellcheck="false" style="width:100%">`, '<span class="orig user">user</span>')}
        ${row('Range band', `${esc(F.dist(w.minR))} – ${esc(F.dist(w.maxR))}`, tag('maxR'))}
        ${row('Maximum site slope', `${w.siteSlope}°`, tag('siteSlope'))}
        ${row('Data source', `MtnEye built-in table — indicative open-source planning values${Object.keys(ov).length ? `; user-edited fields: ${esc(Object.keys(ov).join(', '))}` : ''}. Confirm against current unit data.`)}
        ${row('Display settings', `${cfg('sym.size')} px symbol, ${esc(cfg('sym.colorMode'))} colours, planned (dashed)`)}
        ${row('Documentation', `<button class="link" data-docref="app6d">APP-6(D)</button> · <button class="link" data-docref="gsp-mw">GSP Mountain Warfare</button>`)}
      </table>
      <p class="sel-note"><span class="orig user">user</span> entered or edited by you · <span class="orig table">table</span> built-in default · <span class="orig calc">calculated</span> derived by MtnEye. The rows above the actions are results calculated by the siting tool from the terrain model.</p>`;
  };

  // =================================================================== Explain This / Reference Library
  const openExplain = (topic, extra = {}) => {
    if (!topic) { toast('Nothing to explain — select a result, a layer or a tool first.', true); return; }
    S.explainTopic = { topic, extra };
    $('explainBody').innerHTML = UI.explainHTML(topic, extra);
    $('explainBody').scrollTop = 0;
    $('explainBody').querySelectorAll('[data-ref]').forEach((b) => (b.onclick = () => openDocs(UI.resolveRef(b.dataset.ref, b.dataset.sec))));
    UI.applyIcons($('explainBody'));
    showRightTab('explain');
  };
  const explainLayer = (id) => { S.tocSel = id; renderTOC(); openExplain(UI.explainTopicForLayer(id, S), { layer: id }); };
  /** Explain whatever is in focus: selection, then the Contents selection, then the open tool, then the DEM. */
  const explainCurrent = () => {
    if (!S.grid) { openExplain('elevation'); return; }
    const t = UI.explainTopicForRef(S.sel) || UI.explainTopicForLayer(S.tocSel, S) || (GP.current() && UI.EXPLAIN_TOPICS[GP.current()] ? GP.current() : null) || 'elevation';
    openExplain(t, { ref: S.sel, layer: S.tocSel });
  };
  let libSel = null;
  const renderLibrary = () => {
    const r = UI.libraryHTML($('libSearch').value, libSel);
    $('libList').innerHTML = r.list; $('libDetail').innerHTML = r.detail;
    $('libCount').textContent = `${r.count} entries · citations are extracted from MtnEye’s own text; page numbers are not held by the application`;
    const on = $('libList').querySelector('.on');
    if (on) { libSel = on.dataset.lib; on.scrollIntoView({ block: 'nearest' }); }
    const box = $('docs');
    box.querySelectorAll('[data-lib]').forEach((b) => (b.onclick = () => { libSel = b.dataset.lib; renderLibrary(); }));
    box.querySelectorAll('[data-libtool]').forEach((b) => (b.onclick = () => { box.close(); GP.open(b.dataset.libtool); }));
    box.querySelectorAll('[data-libhelp]').forEach((b) => (b.onclick = () => { box.close(); openHelp(b.dataset.libhelp); }));
    box.querySelectorAll('[data-libex]').forEach((b) => (b.onclick = () => { box.close(); openExplain(b.dataset.libex); }));
  };
  const openDocs = (sel) => {
    libSel = sel || libSel;
    if (sel) $('libSearch').value = '';
    renderLibrary();
    if (!$('docs').open) $('docs').showModal();
  };
  UI.openExplain = (t, x) => openExplain(t, x);

  // =================================================================== attribute table
  const attrRows = () => {
    const rows = [];
    const add = (layer, sym, type, id, p, detail, ref, z) => rows.push({ layer, sym, type, id, r: p.r, c: p.c, z: z ?? M.sample(S.grid, S.L.z, p.r, p.c), detail, ref });
    const mk = S.markers;
    if (mk.own) add('markers', UI.ownSpec(), 'Own position', 'OWN', mk.own, S.ownEchelon, { kind: 'marker', idx: 'own' });
    if (mk.threat) add('markers', UI.threatSpec(), 'Enemy', 'ENY', mk.threat, M.MOVEMENT_PROFILES[S.threatType].name, { kind: 'marker', idx: 'threat' });
    if (mk.target) add('markers', UI.SYM.target(), 'Target area', 'TGT', mk.target, '', { kind: 'marker', idx: 'target' });
    if (mk.a) add('markers', UI.SYM.sp(), 'Route start', 'A / SP', mk.a, '', { kind: 'marker', idx: 'a' });
    if (mk.b) add('markers', UI.SYM.rp(), 'Route end', 'B / RP', mk.b, '', { kind: 'marker', idx: 'b' });
    if (S.key) {
      S.key.peaks.forEach((p, k) => add('key', null, 'Dominating height', `H${k + 1}`, p, `dominance ${F.height(p.prominence)}`, { kind: 'key', idx: k, sub: 'peak' }, p.z));
      S.key.passes.forEach((p, k) => add('key', null, 'Pass / col', `Col ${k + 1}`, p, '', { kind: 'key', idx: k, sub: 'pass' }, p.z));
    }
    if (S.posts) S.posts.posts.forEach((p, k) => add('posts', S.posts.mode === 'op' ? UI.SYM.op() : UI.SYM.post(S.posts.echelon), S.posts.mode === 'op' ? 'Observation post' : 'Defended post', p.id, p,
      `${p.strongPoint ? 'STRONG POINT · ' : ''}${p.tier || ''} · sees ${F.area(p.visibleKm2)} · ${pct(p.valueShare, 1)} of approaches`, { kind: 'post', idx: k }, p.z));
    S.weapons.forEach((res, wi) => res.sites.forEach((s, k) => add('weapons:' + wi, UI.SYM.weapon(res.weapon), `Weapon — ${res.weapon.short}`, s.id, s,
      s.cat === 'indirect' ? `${F.dist(s.rangeToTargetM)} to target · QE ${s.qeDeg === null ? '—' : F.angle(s.qeDeg)} · crest ${pct(s.clearShare)}`
        : `arc ${F.bearing(s.sector.left, s.r, s.c, true)}–${F.bearing(s.sector.right, s.r, s.c)} · ${pct(s.valueShare, 1)}`, { kind: 'weapon', idx: wi, sub: k }, s.z)));
    if (S.mfd) S.mfd.fields.forEach((f, k) => add('mfd', UI.SYM.mine(f.type), `Minefield ${f.type}`, f.id, f, `${f.gapM == null ? 'not tied in' : 'gap ' + F.dist(f.gapM)} · front ${F.dist(f.frontM)} · ≈${f.estMines} mines`, { kind: 'mfd', idx: k }, f.z));
    if (S.avenues) S.avenues.routes.forEach((rt, k) => add('avenues', null, 'Enemy avenue', `AA${k + 1}`, { c: rt.line[0][0], r: rt.line[0][1] }, `${F.dist(rt.lengthM)} · ${F.time(rt.timeH)}`, { kind: 'avenue', idx: k }));
    if (S.routes) {
      S.routes.routes.forEach((rt, k) => add('routes', null, 'Route', `R${k + 1}`, { c: rt.line[0][0], r: rt.line[0][1] }, `${F.dist(rt.lengthM)} · ${F.time(rt.timeH)} · GSP ${rt.gspDay ? gspRange(S.routes.night ? rt.gspNight : rt.gspDay) : '—'} · ↑${F.height(rt.ascentM)}`, { kind: 'route', idx: k }));
      S.routes.routes[S.routes.sel || 0].checkpoints.forEach((cp, k) => add('routes', UI.SYM.cp(k + 1), 'Checkpoint', `CKP ${k + 1}`, cp, `km ${(cp.d / 1000).toFixed(1)}`, { kind: 'cp', idx: k }));
    }
    secItems().filter((x) => x.layer !== 'ridges').forEach((x) => { add(x.layer, x.sym || null, x.type, x.id, x, x.detail, { kind: 'sec', layer: x.layer, idx: x.idx }, x.z); rows[rows.length - 1].rating = x.rating; });
    if (S.helipads) S.helipads.pads.forEach((p, k) => add('helipads', null, 'Helipad (HLS)', p.id, p, `${p.use} · ${p.meanSlopeDeg.toFixed(1)}° · ${p.hidden ? 'hidden' : 'seen'}`, { kind: 'hls', idx: k }, p.z));
    if (S.picquets) S.picquets.picquets.forEach((p, k) => add('picquets', UI.SYM.picquet(), 'Picquet', p.id, p, `km ${p.routeFromKm === null ? '—' : p.routeFromKm.toFixed(1) + '–' + p.routeToKm.toFixed(1)} · climb ${F.time(p.climbH)}`, { kind: 'picquet', idx: k }, p.z));
    return rows;
  };
  const ATTR_COLS = [
    { k: 'sym', t: '' }, { k: 'type', t: 'Type' }, { k: 'id', t: 'ID' }, { k: 'ref', t: () => F.refName() }, { k: 'sec', t: () => (F.secondaryCRS() ? F.secondaryCRS().name : '') },
    { k: 'z', t: () => `Elev (${F.elevUnit()})` }, { k: 'rating', t: 'Rating' }, { k: 'detail', t: 'Details' },
  ];
  const attrValue = (row, k) => {
    if (k === 'ref') return F.listRef(row.r, row.c);
    if (k === 'sec') return F.secondaryCell(row.r, row.c);
    if (k === 'z') return F.elevNum(row.z);
    if (k === 'rating') return row.rating || '';
    return row[k];
  };
  const renderAttrLayers = () => {
    const sel = $('attrLayer'), cur = sel.value;
    const layers = tocModel().flatMap((g) => g.layers).filter((l) => l.table);
    sel.innerHTML = '<option value="">All layers</option>' + layers.map((l) => `<option value="${esc(l.id)}">${esc(l.name)} (${l.count})</option>`).join('');
    sel.value = layers.some((l) => l.id === cur) ? cur : '';
  };
  const renderAttrTable = () => {
    const tbl = $('attrTable');
    if (!S.grid) { tbl.innerHTML = ''; $('attrCount').textContent = ''; return; }
    renderAttrLayers();
    let rows = attrRows();
    const lay = $('attrLayer').value;
    if (lay) rows = rows.filter((r) => r.layer === lay);
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
    if (!rows.length) { tbl.innerHTML = `<tbody><tr><td class="wrap">${q || lay ? 'No feature matches the filter.' : 'No features yet — place situation markers (Map ▸ Situation) or run a tool; its results are listed here.'}</td></tr></tbody>`; UI._attrRows = rows; return; }
    tbl.innerHTML = `<thead><tr>${cols.map((c) => `<th data-col="${c.k}" class="${sc.col === c.k ? 'sort' + (sc.desc ? ' desc' : '') : ''}">${esc(typeof c.t === 'function' ? c.t() : c.t)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-i="${i}" class="${S.sel && r.ref && JSON.stringify(S.sel) === JSON.stringify(r.ref) ? 'sel' : ''}">${cols.map((c) => c.k === 'sym'
        ? `<td>${r.sym ? UI.symbolHTML(r.sym, 12) : ''}</td>` : `<td class="${['ref', 'sec', 'z'].includes(c.k) ? 'm' : c.k === 'detail' ? 'det' : c.k === 'rating' ? `rt rt-${String(r.rating || '').replace(' ', '')}` : ''}"${c.k === 'detail' ? ` title="${esc(attrValue(r, c.k))}"` : ''}>${esc(attrValue(r, c.k))}</td>`).join('')}</tr>`).join('')}</tbody>`;
    tbl.querySelectorAll('th[data-col]').forEach((th) => th.addEventListener('click', () => {
      if (th.dataset.col === 'sym') return;
      S.sort = { col: th.dataset.col, desc: S.sort.col === th.dataset.col ? !S.sort.desc : false };
      renderAttrTable();
    }));
    tbl.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => { const r = rows[+tr.dataset.i]; if (r.ref) select(r.ref, true); }));
    UI._attrRows = rows;
  };
  const openAttrTable = (layerId) => {
    renderAttrLayers();
    $('attrLayer').value = layerId || '';
    setDock(true); showDockTab('table');
    renderAttrTable();
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

  // =================================================================== route card (GSP Annex E)
  const routeCardRows = () => {
    if (!S.routes) return [];
    const rt = S.routes.routes[S.routes.sel || 0];
    if (!rt || !rt.card) return [];
    const decl = F.declination();
    return rt.card.map((l, k) => {
      const mag = l.bearingDeg + F.convergence(l.from[1], l.from[0]) - decl;
      return { leg: k + 1, from: F.listRef(l.from[1], l.from[0]), to: F.listRef(l.to[1], l.to[0]), mag: F.angle(((mag % 360) + 360) % 360), hEnd: F.elev(l.heightEndM),
        hDiff: F.height(l.heightDiffM), dist: F.dist(l.distM), time: `${Math.round(l.minMin)}–${Math.round(l.maxMin)} min` };
    });
  };
  const CARD_COLS = [['leg', 'Leg'], ['from', 'From'], ['to', 'To'], ['mag', 'Magnetic bearing'], ['hEnd', 'Height at end'], ['hDiff', 'Height diff'], ['dist', 'Distance'], ['time', 'Time (GSP)']];
  const renderRouteCard = () => {
    const rows = routeCardRows();
    const tbl = $('cardTable');
    if (!rows.length) { tbl.innerHTML = '<tbody><tr><td class="wrap">Run Least-Time Route to make a route card.</td></tr></tbody>'; return; }
    const rt = S.routes.routes[S.routes.sel || 0];
    const tot = S.routes.night ? rt.gspNight : rt.gspDay;
    tbl.innerHTML = `<thead><tr>${CARD_COLS.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${CARD_COLS.map(([k]) => `<td class="${k === 'from' || k === 'to' || k === 'mag' ? 'm' : ''}">${esc(r[k])}</td>`).join('')}</tr>`).join('')}
      <tr class="sel"><td colspan="6">Total — route R${(S.routes.sel || 0) + 1} (${S.routes.night ? 'night' : 'day'}) · ↑${esc(F.height(rt.ascentM))} ↓${esc(F.height(rt.descentM))}</td><td>${esc(F.dist(rt.lengthM))}</td><td>${esc(gspRange(tot))}</td></tr></tbody>`;
  };
  const exportRouteCard = () => {
    const rows = routeCardRows();
    if (!rows.length) { toast('No route card — run Least-Time Route first.', true); return; }
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    UI.download(fileName('route_card.csv'), '\ufeff' + [CARD_COLS.map(([, t]) => q(t)).join(',')].concat(rows.map((r) => CARD_COLS.map(([k]) => q(r[k])).join(','))).join('\r\n'), 'text/csv');
  };

  // =================================================================== dock / profile
  const showDockTab = (tab) => {
    document.querySelectorAll('.dock-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.dock === tab));
    document.querySelector(`.dock-tabs [data-dock=${tab}]`).classList.remove('fresh');
    document.querySelectorAll('[data-dockpanel]').forEach((p) => (p.hidden = p.dataset.dockpanel !== tab));
    document.querySelector('[data-dockpanel-tools]').hidden = tab !== 'table';
    if (tab === 'card') renderRouteCard();
    if (tab === 'profile' && S.drawerData) UI.drawProfile($('chart'), S.drawerData);
    if (tab === 'routes') renderRouteTable();
    if (tab === 'diag') renderDiagnostics();
    if (tab === 'results') renderResults();
  };
  const setDock = (open) => { if (open && document.body.classList.contains('ws-expanded')) document.body.classList.remove('ws-expanded', 'rb-min'); $('dock').classList.toggle('collapsed', !open); $('dockToggle').textContent = open ? '▾' : '▴'; saveLayout(); relayout(); };
  const openProfile = (title, data) => {
    S.drawerData = data;
    $('profileTitle').textContent = title;
    if (!$('dock').classList.contains('collapsed')) showDockTab('profile');
    else document.querySelector('.dock-tabs [data-dock=profile]').classList.add('fresh');
  };
  const showRouteProfile = () => {
    if (!S.routes) return;
    const rt = S.routes.routes[S.routes.sel || 0];
    openProfile(`Route R${(S.routes.sel || 0) + 1} — ${M.MOVEMENT_PROFILES[S.routes.profile].name} — ${F.dist(rt.lengthM)} — ${F.time(rt.timeH)}`,
      { profile: rt.profile, gradeColors: true, markers: rt.checkpoints.map((c, k) => ({ d: c.d, label: `CKP ${k + 1}` })) });
  };

  // =================================================================== edit history (undo / redo)
  // Snapshots of the user-edited state only (markers, digitised geometry, sector, symbol options).
  // Analysis results are not part of undo: they are recomputed by re-running the tool.
  const undoStack = [], redoStack = [];
  const editSnapshot = () => JSON.parse(JSON.stringify({ markers: S.markers, markerOrigin: S.markerOrigin, obstacles: S.obstacles, tracks: S.tracks, sector: S.sector, border: S.border,
    symOpts: S.symOpts, ownEchelon: S.ownEchelon, threatType: S.threatType }));
  const pushUndo = (label) => {
    if (!S.grid) return;
    undoStack.push({ label, snap: editSnapshot() });
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
  };
  const updateUndoButtons = () => {
    const u = $('qbUndo'), r = $('qbRedo');
    if (u) { u.disabled = !undoStack.length; u.title = undoStack.length ? `Undo ${undoStack[undoStack.length - 1].label} (Ctrl+Z)` : 'Nothing to undo'; }
    if (r) { r.disabled = !redoStack.length; r.title = redoStack.length ? `Redo ${redoStack[redoStack.length - 1].label} (Ctrl+Y)` : 'Nothing to redo'; }
  };
  const restoreEdit = async (snap) => {
    const before = editSnapshot();
    Object.assign(S, JSON.parse(JSON.stringify(snap)));
    const changed = (k) => JSON.stringify(before[k]) !== JSON.stringify(snap[k]);
    if (changed('sector') || changed('border')) { S.sec = {}; clearOverlay('dominance'); clearOverlay('firecov'); }
    if (changed('markers') && (JSON.stringify(before.markers.own) !== JSON.stringify(snap.markers.own) || JSON.stringify(before.markers.threat) !== JSON.stringify(snap.markers.threat))) { S.avenues = null; S.hostile = null; clearOverlay('hostile'); clearOverlay('avenues'); }
    await syncSettings();
    if ((changed('obstacles') || changed('tracks')) && S.overlays.mobility.data) await computeMobility(GP.values('mobility'), true);
    syncRibbonInputs(); renderAll(); refresh({ base: true });
  };
  const undo = async () => { const e = undoStack.pop(); if (!e) return; redoStack.push({ label: e.label, snap: editSnapshot() }); await restoreEdit(e.snap); updateUndoButtons(); toast(`Undone: ${e.label}`); };
  const redo = async () => { const e = redoStack.pop(); if (!e) return; undoStack.push({ label: e.label, snap: editSnapshot() }); await restoreEdit(e.snap); updateUndoButtons(); toast(`Redone: ${e.label}`); };

  // =================================================================== run context (provenance)
  /** Inputs that are not tool parameters but shape the result: user geometry, markers, earlier runs. */
  const runContext = () => {
    const mk = {};
    for (const [k, v] of Object.entries(S.markers)) if (v) mk[k] = { c: v.c, r: v.r, origin: (S.markerOrigin || {})[k] || 'not recorded' };
    return { dem: S.grid ? `${S.grid.name} (${S.grid.w}×${S.grid.h} @ ${S.grid.cs} m)` : null, borderVertices: S.border ? S.border.length : 0, sectorVertices: S.sector ? S.sector.length : 0,
      markers: mk, obstacles: S.obstacles.length, tracks: S.tracks.length, planPresent: !!(S.sec && S.sec.plan), itgCount: S.sec && S.sec.itg ? S.sec.itg.itgs.length : 0,
      itgRun: S.lastRun.itgs ? S.lastRun.itgs.id : null, planRun: S.lastRun.deploy ? S.lastRun.deploy.id : null, approachesRun: S.lastRun.enemyApproaches ? S.lastRun.enemyApproaches.id : null,
      infiltrationRun: S.lastRun.infiltration ? S.lastRun.infiltration.id : null, profileOverrides: Object.keys(cfg('profiles') || {}) };
  };
  const annotateRun = (cmd, ctx) => { const r = S.lastRun[cmd]; if (r) r.context = sanitizeArgs(ctx); };

  // =================================================================== Route Analysis & Provenance
  const NR = 'Not recorded in this analysis run.';
  const CANNOT = 'Cannot be determined from the terrain model alone.';
  const PV = { calc: 'Calculated by the software', terrain: 'Derived from terrain data', user: 'Entered by the user', assumed: 'Assumed by the model', na: 'Not established by the available data' };
  const pv = (k) => `<span class="pv ${k}" title="${PV[k]}">${{ calc: 'calculated', terrain: 'terrain', user: 'user input', assumed: 'model assumption', na: 'not established' }[k]}</span>`;
  const RCAT = {
    route: { name: 'Route A→B — least-cost path', short: 'Route A→B', cmd: 'route', color: () => cfg('sym.routeColor'), fn: 'job route → M.findRoutes → M.astar → M.routeStats → M.routeCard (core/routing.js)', explain: 'route' },
    avenue: { name: 'Avenue of approach — model output', short: 'Avenue (model)', cmd: 'avenues', color: () => cfg('sym.avenueColor'), fn: 'job avenues → M.avenuesOfApproach → M.nearestPassable, M.findRoutes → M.astar → M.routeStats (core/tactical.js)', explain: 'avenues' },
    eappr: { name: 'Sector approach to an ITG — model output', short: 'Sector approach (model)', cmd: 'enemyApproaches', color: () => '#ff4136', fn: 'job enemyApproaches → M.enemyApproaches → entryPoints, M.reachable, reachGoal, M.astar, M.routeStats, classify (core/sector.js)', explain: 'enemyApproaches' },
    infil: { name: 'Infiltration route — model output', short: 'Infiltration (model)', cmd: 'infiltration', color: () => '#b0202a', fn: 'job infiltration → M.infiltrationRoutes → entryPoints, M.reachable, reachGoal, M.astar (penalised cost), M.routeStats, classify (core/sector.js)', explain: 'infiltration' },
    eopt: { name: 'Course-of-action line — copy of an approach / infiltration line', short: 'COA line (copy)', cmd: 'enemyOptions', color: () => '#c00000', fn: 'job enemyOptions → M.enemyOptions (selects existing lines; computes no new path) (core/sector.js)', explain: 'enemyOptions' },
  };
  const lineLen = (line) => { let d = 0; for (let k = 1; k < line.length; k++) d += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]) * S.grid.cs; return d; };
  const gridZ = () => Object.assign({}, S.grid, { z: S.L.z });
  /** Every displayed model line, one record each, from the live state (no copies kept elsewhere). */
  const routeRecords = () => {
    if (!S.grid) return [];
    const out = [], X = S.sec || {}, sh = S.show;
    const add = (cat, k, id, line, src, extra = {}) => {
      if (!line || line.length < 2) return;
      const key = `${cat}:${k}`;
      out.push(Object.assign({ key, cat, id, line, src, color: RCAT[cat].color(), run: S.lastRun[extra.cmd || RCAT[cat].cmd] || null, catVisible: true, visible: !UI.routeHidden(key) }, extra));
    };
    if (S.routes) S.routes.routes.forEach((rt, k) => add('route', k, `R${k + 1}`, rt.line, rt, { catVisible: sh.routes, alt: k !== (S.routes.sel || 0) }));
    if (S.avenues) S.avenues.routes.forEach((rt, k) => add('avenue', k, `AA${k + 1}`, rt.line, rt, { catVisible: sh.avenues, cmd: S.avenues.src === 'minefields' ? 'minefields' : 'avenues' }));
    if (X.appr) X.appr.approaches.forEach((a, k) => add('eappr', k, a.id, a.line, a, { catVisible: sh.eappr !== false }));
    if (X.infil) X.infil.routes.forEach((a, k) => add('infil', k, a.id, a.line, a, { catVisible: sh.infil !== false }));
    if (X.opts) X.opts.options.forEach((o, k) => o.lines.forEach((ln, j) => add('eopt', `${k}:${j}`, `${o.id} · ${j === 0 ? `main (${o.main})` : j === 1 && o.support ? `support (${o.support})` : 'infiltration'}`, ln, o, { catVisible: sh.eopts !== false, part: j })));
    out.forEach((r) => (r.visible = r.visible && r.catVisible !== false));
    return out;
  };
  UI._routeRecords = routeRecords;
  const recByKey = (key) => routeRecords().find((r) => r.key === key) || null;
  { const base = UI.explainTopicForRef; UI.explainTopicForRef = (ref) => { if (ref && (ref.kind === 'rline' || ref.kind === 'rvertex')) { const r = recByKey(ref.key); return r ? RCAT[r.cat].explain : null; } return base(ref); }; }

  /** Terrain along the drawn line, sampled from the DEM and the derived rasters (UI-side, labelled). */
  const lineTerrain = (line) => {
    const g = gridZ(), prof = M.terrainProfile(g, line, g.cs);
    const lf = new Array(6).fill(0), mobC = [0, 0, 0];
    let up = 0, down = 0, sMax = 0, sSum = 0, zMin = Infinity, zMax = -Infinity, n = 0;
    const mob = S.overlays.mobility.data;
    for (let k = 0; k < prof.length; k++) {
      const q = prof[k], i = Math.round(q.r) * g.w + Math.round(q.c);
      if (i < 0 || i >= g.z.length) continue;
      n++; lf[S.L.landform[i]]++; sSum += S.L.slope[i]; sMax = Math.max(sMax, S.L.slope[i]); zMin = Math.min(zMin, q.z); zMax = Math.max(zMax, q.z);
      if (mob) mobC[mob[i]]++;
      if (k) { const dz = q.z - prof[k - 1].z; if (dz > 0) up += dz; else down -= dz; }
    }
    return { n, lf: lf.map((v) => v / (n || 1)), slopeMean: sSum / (n || 1), slopeMax: sMax, zMin, zMax, up, down, mob: mob ? mobC.map((v) => v / (n || 1)) : null, mobProfile: S.overlays.mobility.profile };
  };
  const val = (o, k, fmt) => (o && o[k] !== undefined && o[k] !== null ? (fmt ? fmt(o[k]) : String(o[k])) : `<span class="na">${NR}</span>`);
  const params = (r) => (r.run ? Object.assign({}, r.run.args || {}, (r.run.context && r.run.context.defaultsApplied) || {}) : null);

  /** The computation stages that produced a line, with recorded values (or an explicit gap). */
  const routeStages = (r) => {
    const p = params(r), ctx = r.run && r.run.context, mkO = (k) => (ctx && ctx.markers && ctx.markers[k] ? ctx.markers[k].origin : null);
    const prof = (id) => { const q = profileOf(id); return q ? `${q.name}: GO < ${q.go}°, NO-GO ≥ ${q.slow}°, ${q.speed} km/h level (${q.src})` : NR; };
    const st = [];
    const S_ = (stage, fn, text, vals = []) => st.push({ stage, fn, text, vals });
    if (r.cat === 'route') {
      S_('Inputs', '—', 'Start A and end B are the situation markers; obstacles and tracks are user-digitised geometry.', [['A / B origin', mkO('a') ? `${mkO('a')} / ${mkO('b')}` : NR], ['No-Go areas / tracks', ctx ? `${ctx.obstacles} / ${ctx.tracks}` : NR]]);
      S_('Movement surface', 'M.classifyMobility, M.slowPassMob', 'Each cell classed GO / SLOW-GO / NO-GO from the Horn slope and the class limits; for foot classes slope NO-GO up to 45° becomes SLOW-GO with a ×4 time penalty.', [['Movement class', p ? prof(p.profile) : NR]]);
      S_('Cost weights', 'M.routeMode', 'Cost multipliers for the chosen mode (exposure to modelled observation, crest cells, valley-floor cells).', [['Mode', p ? p.mode : NR], ['Exposure / skyline / nullah weight', p ? `${p.exposureW} / ${p.skylineW} / ${p.nullahW}` : NR]]);
      S_('Search', 'M.findRoutes → M.astar', `A* over ${cfg('an.routeNeighbours') === 8 ? 8 : 16}-connected moves; cost = time from M.moveSpeed × multipliers; alternatives penalise a corridor (×3) around earlier paths and drop ≥ 75 % overlaps.`, [['Alternatives requested', p ? p.alternatives : NR], ['Separation', p ? `${p.separationM} m` : NR]]);
      S_('Statistics & simplification', 'M.routeStats, M.simplify', 'Length, climb, model time and GSP march time on the cell path; the drawn line is the cell path simplified with Ramer–Douglas–Peucker (0.6 cell).', [['Checkpoint spacing', p ? `${p.cpEveryM} m` : NR]]);
    } else if (r.cat === 'avenue') {
      S_('Inputs', '—', 'From the enemy marker to the own marker (user situation markers).', [['Enemy / own marker origin', mkO('threat') ? `${mkO('threat')} / ${mkO('own')}` : NR]]);
      S_('Endpoints', 'M.nearestPassable', 'Each marker is moved to the nearest cell that is not NO-GO for the movement class (search up to 2 500 m).', []);
      S_('Movement surface', 'M.classifyMobility, M.slowPassMob', 'As for routes.', [['Movement class', p ? prof(p.profile || p.type || 'foot') : NR]]);
      S_('Search', 'M.findRoutes → M.astar', 'k least-time alternatives; each later search penalises a corridor around the earlier ones.', [['Number requested (k)', p ? p.k : NR], ['Separation', p && p.separationM ? `${p.separationM} m` : NR], ['Corridor half-width', p && p.bufferM ? `${p.bufferM} m` : NR]]);
      if (r.run && r.run.cmd === 'minefields') S_('Origin of this layer', 'M.siteMinefields', 'This avenue layer was produced as an intermediate result of the minefield tool.', []);
    } else if (r.cat === 'eappr' || r.cat === 'infil' || r.cat === 'eopt') {
      const infil = r.cat === 'infil' || (r.cat === 'eopt' && r.part >= 2);
      S_('Sector frame', 'M.sectorFrame', 'Own / enemy side of the user-drawn border line, decided by the own marker (else the sector polygon).', [['Border line vertices (user)', ctx ? ctx.borderVertices : NR], ['Sector polygon vertices (user)', ctx ? ctx.sectorVertices : NR]]);
      if (r.cat !== 'eopt') {
        S_('Entry points (start candidates)', 'entryPoints → M.lineStations, pickSite', `Stations every “entry spacing” along the border; at each, the cell on the enemy side within ±300 m of the target depth that is not NO-GO and lies closest to that depth.`,
          [['Entry spacing', p ? `${p.entrySpacingM} m` : NR], ['Target depth beyond border', p ? `${infil ? Math.min(800, p.entryDepthM) : p.entryDepthM} m${infil ? ' (capped at 800 m for infiltration)' : ''}` : NR], ['Entry points found', ctx && ctx.entryPoints !== undefined ? ctx.entryPoints : NR]]);
        if (!infil) {
          S_('Objectives (end candidates)', 'ITG list (M.findITGs)', 'The first N ITGs in ITG score order; each end point is the reachable cell nearest the ITG summit within 1 200 m (reachGoal, after M.reachable from all entries ≤ 12 h).', [['Objectives considered', p ? p.objectives : NR], ['ITG run', ctx && ctx.itgRun ? ctx.itgRun : NR]]);
          S_('Entry ranking', 'M.reachable (from the end point, ≤ 6 h)', 'Entries ordered by modelled travel time to the end point; up to “per objective” kept, at least 1.5 × spacing apart.', [['Approaches per objective', p ? p.perObjective : NR]]);
          S_('Path', 'M.astar on M.enemyMoveCtx', 'Least-time path; foot movement crosses slope NO-GO ≤ 45° at ¼ speed. Paths overlapping an earlier one to the same objective by > 60 % are dropped.', [['Movement class', p ? prof(p.profile) : NR]]);
        } else {
          S_('Targets (end candidates)', 'reachGoal', 'Targets are the deployment-plan HQs if a plan exists, else the 3 ITGs farthest from the border; end point = reachable cell nearest the target within 1 500 m.', [['Targets used', ctx && ctx.targets ? ctx.targets : NR], ['Deployment plan present at run time', ctx ? (ctx.planPresent ? `yes (${ctx.planRun || 'run id not recorded'})` : 'no') : NR]]);
          S_('Cost surface', 'penalty array', 'Time cost × (1 + detection weight) on cells seen by own posts (viewshed count, 3 000 m, observer 2 m, target 1.5 m) × (1 − nullah preference) on nullah / valley-floor cells.', [['Detection weight', p ? `${p.detectW}×` : NR], ['Nullah preference', p ? p.nullahBonus : NR]]);
          S_('Path & selection', 'M.astar, sort', 'Each entry to its 2 nearest targets; candidates sorted by observed share then time; > 50 % overlap dropped; first N kept.', [['Routes reported', p ? p.infilCount : NR]]);
        }
        S_('Statistics & labels', 'M.routeStats, classify', 'Length / time / GSP time on the cell path; type = the larger share of valley / nullah / ridge cells (≥ 20 %, else “spur / slope”); drawn line simplified (RDP 0.6 cell).', []);
        S_('Rating text', infil ? 'M.infiltrationRoutes (templates)' : 'M.enemyApproaches (templates)', 'Threat / rating words come from fixed formulas over observed share and time (e.g. threat = 0.5·(1 − exposure) + 0.5·(1 − time/6 h)). They are model conventions, not evidence.', []);
      } else {
        S_('Selection of lines', 'M.enemyOptions', 'Re-uses approach lines (and, for the second option, the least-observed infiltration line). No new path is computed; scores weight ease (observation, GSP time) and, where a deployment plan exists, line of sight to own positions.', [['Approaches run', ctx && ctx.approachesRun ? ctx.approachesRun : NR], ['Infiltration run', ctx && ctx.infiltrationRun ? ctx.infiltrationRun : NR]]);
      }
    }
    return st;
  };

  /** Endpoint provenance for start (0) or end (1). Returns [origin text, tag]. */
  const endpointOrigin = (r, which) => {
    const ctx = r.run && r.run.context, pt = which ? r.line[r.line.length - 1] : r.line[0];
    const same = (m) => m && Math.round(m.c) === Math.round(pt[0]) && Math.round(m.r) === Math.round(pt[1]);
    if (r.cat === 'route') { const k = which ? 'b' : 'a', o = ctx && ctx.markers && ctx.markers[k] ? ctx.markers[k].origin : (S.markerOrigin || {})[k]; return [`${which ? 'End B' : 'Start A'} — situation marker (${o || 'origin not recorded'})`, o === 'demo generator' ? 'calc' : 'user']; }
    if (r.cat === 'avenue') {
      const m = which ? S.avenues.to : S.avenues.from;
      if (!m) return [`Derived from the ${which ? 'own' : 'enemy'} marker by M.nearestPassable — marker position at run time ${NR.toLowerCase()}`, 'calc'];
      return same(m) ? [`The ${which ? 'own' : 'enemy'} marker cell (user input, passable)`, 'user'] : [`Nearest passable cell to the ${which ? 'own' : 'enemy'} marker (M.nearestPassable), ${F.dist(Math.hypot(m.c - pt[0], m.r - pt[1]) * S.grid.cs)} from it — algorithmically derived`, 'calc'];
    }
    if (r.cat === 'eopt') return ['Copied from the referenced approach / infiltration line', 'calc'];
    if (!which) return ['Entry point generated by entryPoints() — algorithmically derived, not a user input', 'calc'];
    if (r.cat === 'eappr') return [`End cell from reachGoal(): reachable cell nearest ITG ${r.src.objective} (${F.dist(r.src.assaultM || 0)} from its summit) — algorithmically derived`, 'calc'];
    return [`End cell from reachGoal(): reachable cell nearest the target “${r.src.target}” within 1 500 m — algorithmically derived`, 'calc'];
  };

  const routeDetailHTML = (r) => {
    const g = S.grid, ctx = r.run && r.run.context, src = r.src;
    const T = lineTerrain(r.line);
    const row = (k, v, tag) => `<tr><td>${esc(k)}</td><td>${v}</td><td>${tag ? pv(tag) : ''}</td></tr>`;
    const a = r.line[0], b = r.line[r.line.length - 1], zAt = (q) => M.sample(g, S.L.z, q[1], q[0]);
    const so = endpointOrigin(r, 0), eo = endpointOrigin(r, 1);
    const missing = [];
    const miss = (k) => { missing.push(k); return `<span class="na">${NR}</span>`; };
    const lenRec = src.lengthM;
    const LF = M.LANDFORMS.map((x) => x.name.split(' (')[0]);
    const lfTxt = T.lf.map((v, i) => [LF[i], v]).filter(([, v]) => v >= 0.05).sort((x, y) => y[1] - x[1]).map(([n, v]) => `${n} ${Math.round(v * 100)} %`).join(' · ');
    const warn = [];
    if (g.synthetic) warn.push('DEM is synthetic (fictional terrain) — no real-world inference is possible.');
    if (S.filledCells) warn.push(`${S.filledCells} void cells in the DEM were filled by interpolation.`);
    warn.push(`The drawn line is a simplification of the computed cell path (RDP, 0.6 cell = ${(0.6 * g.cs).toFixed(0)} m); intermediate vertices are simplification points, not decision points.`);
    if (!src.path) warn.push('The full cell path is not kept with the displayed result (only the simplified line), so cell-by-cell costs cannot be re-inspected.');
    if (!r.run) warn.push('No processing record for this line in the session (e.g. loaded from a plan saved without records or produced before this version).');
    if (r.run && r.run.fromPlan) warn.push('Processing record restored from the plan file.');
    if (T.mob && r.cat !== 'route' && S.overlays.mobility.profile && params(r) && params(r).profile && params(r).profile !== S.overlays.mobility.profile) warn.push('The Go / No-Go layer shown is for a different movement class than this line.');
    const st = routeStages(r);
    const rules = [];
    if (src.type) rules.push(['Path type label', esc(src.type)]);
    if (src.threat) rules.push(['Threat word', esc(src.threat)]);
    if (src.rating) rules.push(['Rating word', esc(src.rating)]);
    if (src.reasons) rules.push(['Reasons text', esc(src.reasons.join(' · '))]);
    if (src.summary && r.cat === 'eopt') rules.push(['Summary text', esc(src.summary)]);
    if (src.recommendation && r.cat === 'eopt') rules.push(['Recommendation text', esc(src.recommendation)]);
    const verts = r.line.map((q, i) => {
      const ii = Math.round(q[1]) * g.w + Math.round(q[0]);
      return `<tr data-vtx="${i}"><td>${i === 0 ? 'S' : i === r.line.length - 1 ? 'E' : i}</td><td>${esc(F.listRef(q[1], q[0]))}</td><td>${F.elevNum(zAt(q))}</td><td>${S.L.slope[ii] !== undefined ? S.L.slope[ii].toFixed(0) + '°' : '—'}</td><td>${S.L.landform[ii] !== undefined ? esc(LF[S.L.landform[ii]]) : '—'}</td></tr>`;
    }).join('');
    const html = `<div class="rt-detail">
      <div class="rt-notice"><b>Model output, not a prediction.</b> This line is what MtnEye’s terrain cost model computed for the recorded inputs. It is <b>not</b> confirmation of real-world movement, routes or intent, and it has not been verified on the ground.</div>
      <div class="pv-legend">${Object.keys(PV).map(pv).join('')}</div>
      <h4><span class="k">A</span>Route identity</h4><table class="rt-t">
        ${row('Route identifier', `<b>${esc(r.id)}</b>`, 'calc')}${row('Output category', esc(RCAT[r.cat].name), 'calc')}
        ${row('Analysis run', r.run ? `${esc(r.run.id)} — ${esc(r.run.label)}, ${esc(new Date(r.run.t).toLocaleString())}` : miss('Analysis run'), r.run ? 'calc' : 'na')}
        ${row('Associated objective / reference', src.objective ? `ITG ${esc(src.objective)}` : src.target ? esc(src.target) : r.cat === 'route' ? 'Situation markers A and B' : r.cat === 'avenue' ? 'Enemy marker → own marker' : r.cat === 'eopt' ? `${esc(src.objective)} (option “${esc(src.id)}”)` : '—', r.cat === 'route' || r.cat === 'avenue' ? 'user' : 'calc')}
      </table>
      <h4><span class="k">B</span>Input provenance</h4><table class="rt-t">
        ${row('Elevation model', esc(g.name) + (g.synthetic ? ' — synthetic' : ''), g.synthetic ? 'calc' : 'user')}
        ${row('DEM resolution', `${g.cs} m cells (${g.w} × ${g.h})`, 'terrain')}${row('Spatial reference', esc(F.analysisCRSName()), 'calc')}
        ${row('Analysis extent', `${F.dist(g.w * g.cs)} × ${F.dist(g.h * g.cs)} · NW ${esc(F.listRef(0, 0))}`, 'terrain')}
        ${row('Border / boundary input', r.cat === 'route' || r.cat === 'avenue' ? 'Not used by this computation' : ctx ? `Border ${ctx.borderVertices} vertices · sector ${ctx.sectorVertices} vertices (user-drawn)` : miss('Border geometry'), r.cat === 'route' || r.cat === 'avenue' ? '' : ctx ? 'user' : 'na')}
        ${row('Obstacles / tracks', ctx ? `${ctx.obstacles} No-Go areas · ${ctx.tracks} tracks` : miss('Obstacles'), ctx ? 'user' : 'na')}
        ${row('Movement profile', params(r) && (params(r).profile || r.cat === 'infil') ? esc(profileOf(params(r).profile || 'foot').name) + (ctx && ctx.profileOverrides && ctx.profileOverrides.length ? ` (user-edited classes: ${esc(ctx.profileOverrides.join(', '))})` : '') : miss('Movement profile'), params(r) ? 'user' : 'na')}
        ${row('Run timestamp / ID', r.run ? `${esc(r.run.id)} · ${esc(new Date(r.run.t).toISOString())} · ${(r.run.dur / 1000).toFixed(2)} s · ${esc(r.run.engine)}` : miss('Run timestamp'), r.run ? 'calc' : 'na')}
      </table>
      <h4><span class="k">C</span>Computational audit trail</h4>
      <div class="hint">Producing function: <code>${esc(RCAT[r.cat].fn)}</code></div>
      ${st.map((x, i) => `<div class="rt-stage"><b>${i + 1}. ${esc(x.stage)}</b> <code>${esc(x.fn)}</code><div>${x.text}</div>${x.vals.length ? `<div class="vals">${x.vals.map(([k, v]) => `${esc(k)}: ${String(v).includes('class="na"') ? v : String(v) === NR ? `<span class="na">${NR}</span>` : esc(v)}`).join('<br>')}</div>` : ''}</div>`).join('')}
      <div class="hint">All parameters recorded for the run:</div>
      <table class="rt-t">${params(r) ? Object.entries(params(r)).filter(([, v]) => typeof v !== 'object' || Array.isArray(v)).map(([k, v]) => row(k, esc(Array.isArray(v) ? v.join(', ') : String(v)), (r.run.args || {})[k] !== undefined ? 'user' : 'assumed')).join('') : row('Parameters', miss('Parameters'), 'na')}</table>
      <h4><span class="k">D</span>Output information</h4><table class="rt-t">
        ${row('Start coordinate', `${esc(F.listRef(a[1], a[0]))}<br><span class="hint">${esc(so[0])}</span>`, so[1])}
        ${row('End coordinate', `${esc(F.listRef(b[1], b[0]))}<br><span class="hint">${esc(eo[0])}</span>`, eo[1])}
        ${row('Why these locations (real world)', `<span class="na">${CANNOT}</span>`, 'na')}
        ${row('Intermediate vertices', `${r.line.length - 2} (table below; click a row or the map to inspect)`, 'calc')}
        ${row('Total length (computed path)', lenRec !== undefined ? F.dist(lenRec) : miss('Length'), lenRec !== undefined ? 'calc' : 'na')}
        ${row('Length of drawn line', F.dist(lineLen(r.line)), 'calc')}
        ${row('Model travel time', src.timeH !== undefined ? F.time(src.timeH) : miss('Time'), src.timeH !== undefined ? 'calc' : 'na')}
        ${row('GSP march time (day / night)', src.gspDay ? `${F.time(src.gspDay.minH)}–${F.time(src.gspDay.maxH)} / ${F.time(src.gspNight.minH)}–${F.time(src.gspNight.maxH)}` : miss('GSP time'), src.gspDay ? 'calc' : 'na')}
        ${row('Climb / descent (computed path)', src.ascentM !== undefined ? `${F.height(src.ascentM)}${src.descentM !== undefined ? ` / ${F.height(-src.descentM)}` : ''}` : miss('Climb'), src.ascentM !== undefined ? 'calc' : 'na')}
        ${row('Elevation along drawn line', `${F.elev(T.zMin)} – ${F.elev(T.zMax)} · ↑${F.height(T.up)} ↓${F.height(-T.down)}`, 'terrain')}
        ${row('Slope along line (mean / max)', `${T.slopeMean.toFixed(1)}° / ${T.slopeMax.toFixed(0)}°`, 'terrain')}
        ${row('Landform classes crossed', esc(lfTxt || '—'), 'terrain')}
        ${row('Go / No-Go along line', T.mob ? `GO ${Math.round(T.mob[0] * 100)} % · SLOW ${Math.round(T.mob[1] * 100)} % · NO-GO ${Math.round(T.mob[2] * 100)} % (${esc(M.MOVEMENT_PROFILES[T.mobProfile].name.split(' (')[0])} layer)` : 'Go / No-Go layer not computed', T.mob ? 'terrain' : '')}
        ${src.exposure !== undefined ? row('Share watched by own posts (model)', `${Math.round(src.exposure * 100)} %`, 'calc') : ''}${src.detectShare !== undefined ? row('Share watched by own posts (model)', `${Math.round(src.detectShare * 100)} %`, 'calc') : ''}
        ${row('Positional uncertainty', `Vertices are cell centres (± ${(g.cs / 2).toFixed(1)} m quantisation) and the line deviates up to ${(0.6 * g.cs).toFixed(0)} m from the cell path.`, 'calc')}
        ${row('Confidence / probability', '<span class="na">Not computed — the model produces no statistical confidence or likelihood for any line.</span>', 'na')}
      </table>
      <div class="rt-vtx"><table><thead><tr><th>#</th><th>Grid ref</th><th>Elev</th><th>Slope</th><th>Landform</th></tr></thead><tbody>${verts}</tbody></table></div>
      ${warn.length ? `<h4><span class="k">!</span>Data-quality warnings</h4><ul class="ex-b">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${rules.length ? `<h4><span class="k">≈</span>Rule-generated labels (model conventions)</h4><table class="rt-t">${rules.map(([k, v]) => row(k, v, 'assumed')).join('')}</table><div class="hint">Produced by fixed text templates and score thresholds in the source code. They are not observations and say nothing certain about real intent.</div>` : ''}
      <h4><span class="k">E</span>Interpretation</h4><table class="rt-t">
        ${row('1. Calculated by the software', 'The path geometry, lengths, times, shares and every statistic above.', 'calc')}
        ${row('2. Derived from terrain data', 'Slope, landform, elevation and Go / No-Go values sampled along the line from the DEM.', 'terrain')}
        ${row('3. Entered by the user', `${r.cat === 'route' ? 'Markers A and B, ' : r.cat === 'avenue' ? 'Enemy and own markers, ' : 'Border line, sector polygon, own marker, '}obstacles / tracks, tool parameters.`, 'user')}
        ${row('4. Assumed by the model', 'Movement speeds (Tobler form, class speeds), slope limits, cost weights, penalty factors, thresholds and rating formulas.', 'assumed')}
        ${row('5. Not established by the available data', `Whether any real force would use this line or its end points, its intent, timing or strength; vegetation, snow, rivers and other unmapped obstacles; ${CANNOT.toLowerCase()}`, 'na')}
      </table>
      <div class="rt-notice">A computed path is <b>not</b> confirmation of real-world movement or intent.</div>
      <div class="sel-actions"><button class="btn sm ex-go" data-rt-explain>Method & references</button><button class="btn sm" data-rt-zoom>Zoom to line</button><button class="btn sm" data-rt-profile>Terrain profile</button><button class="btn sm" data-rt-report>Export route report</button></div>
    </div>`;
    return { html, missing };
  };

  const renderRoutesPanel = () => {
    const el = $('routesBody');
    if (!el) return;
    const recs = routeRecords();
    if (!recs.length) { el.innerHTML = '<p class="hint pad">No generated lines yet. Run Route A→B, Avenues of Approach or the sector tools; every displayed line then gets its own provenance record here.</p>'; return; }
    const selKey = S.sel && (S.sel.kind === 'rline' || S.sel.kind === 'rvertex') ? S.sel.key : S.routePanelKey;
    const sel = recs.find((r) => r.key === selKey) || null;
    const cats = [...new Set(recs.map((r) => r.cat))];
    const list = cats.map((c) => `<div class="rt-cat">${esc(RCAT[c].short)}</div>` + recs.filter((r) => r.cat === c).map((r) => `<div class="rt-item${sel && sel.key === r.key ? ' on' : ''}" data-rt="${esc(r.key)}">
        <input type="checkbox" data-rtvis="${esc(r.key)}" ${UI.routeHidden(r.key) ? '' : 'checked'} title="Show / hide this line"><i class="sw" style="background:${r.color}"></i><span>${esc(r.id)}${r.catVisible === false ? ' <span class="hint">(layer off)</span>' : ''}</span><small>${r.src.lengthM !== undefined ? F.dist(r.src.lengthM) : F.dist(lineLen(r.line))} · ${r.run ? r.run.id : 'no run record'}</small></div>`).join('')).join('');
    el.innerHTML = `<div class="rt-tools"><b style="font-size:12px">Route Analysis &amp; Provenance</b><span class="grow"></span><button class="btn sm" data-rt-all="1">Show all</button><button class="btn sm" data-rt-all="0">Hide all</button><button class="btn sm" data-rt-report>Report…</button></div>
      <div class="rt-list">${list}</div>${sel ? routeDetailHTML(sel).html : '<p class="hint pad">Select a line in the list or click it on the map. Where lines overlap, the map offers a list of the features under the cursor.</p>'}`;
    el.querySelectorAll('[data-rt]').forEach((n) => n.addEventListener('click', (e) => { if (e.target.matches('input')) return; selectRoute(n.dataset.rt, true); }));
    el.querySelectorAll('[data-rtvis]').forEach((cb) => cb.addEventListener('change', () => { S.hiddenRoutes[cb.dataset.rtvis] = !cb.checked; if (cb.checked) delete S.hiddenRoutes[cb.dataset.rtvis]; refresh(); renderRouteTable(); }));
    el.querySelectorAll('[data-rt-all]').forEach((b) => (b.onclick = () => { if (b.dataset.rtAll === '1') S.hiddenRoutes = {}; else recs.forEach((r) => (S.hiddenRoutes[r.key] = true)); refresh(); renderRoutesPanel(); }));
    el.querySelectorAll('[data-rt-report]').forEach((b) => (b.onclick = () => exportRouteReport(sel ? [sel] : null)));
    if (sel) {
      const q = (s) => el.querySelector(s);
      q('[data-rt-explain]').onclick = () => openExplain(RCAT[sel.cat].explain, { ref: { kind: 'rline', key: sel.key } });
      q('[data-rt-zoom]').onclick = () => zoomToLine(sel.line);
      q('[data-rt-profile]').onclick = () => openProfile(`${sel.id} — terrain along the drawn line (${RCAT[sel.cat].short})`, { profile: M.terrainProfile(gridZ(), sel.line, S.grid.cs) });
      el.querySelectorAll('[data-vtx]').forEach((tr) => tr.addEventListener('click', () => selectVertex(sel.key, +tr.dataset.vtx)));
    }
  };
  const renderRouteTable = () => {
    const tbl = $('rtTable');
    if (!tbl) return;
    const recs = routeRecords();
    $('rtCount').textContent = recs.length ? `(${recs.length})` : '';
    if (!recs.length) { tbl.innerHTML = '<tbody><tr><td class="wrap">No generated lines. Run a routing or sector tool.</td></tr></tbody>'; return; }
    tbl.innerHTML = `<thead><tr><th></th><th>ID</th><th>Category</th><th>Run</th><th>Start</th><th>End</th><th>Length</th><th>Model time</th><th>Vertices</th><th>Start origin</th><th>Missing metadata</th></tr></thead><tbody>${recs.map((r) => {
      const a = r.line[0], b = r.line[r.line.length - 1], so = endpointOrigin(r, 0), miss = (r.run ? 0 : 3) + (r.src.timeH === undefined ? 1 : 0) + (r.src.lengthM === undefined ? 1 : 0);
      return `<tr data-rtk="${esc(r.key)}" class="${S.sel && S.sel.key === r.key ? 'sel' : ''}"><td><i style="display:block;width:14px;height:3px;background:${r.color}"></i></td><td>${esc(r.id)}</td><td>${esc(RCAT[r.cat].short)}</td><td class="m">${r.run ? esc(r.run.id) : '—'}</td><td class="m">${esc(F.listRef(a[1], a[0]))}</td><td class="m">${esc(F.listRef(b[1], b[0]))}</td>
        <td class="m">${r.src.lengthM !== undefined ? F.dist(r.src.lengthM) : '—'}</td><td class="m">${r.src.timeH !== undefined ? F.time(r.src.timeH) : '—'}</td><td class="m">${r.line.length}</td><td class="wrap">${esc(so[0].split(' — ')[0])}</td><td>${miss ? `${miss} field(s) not recorded` : 'none'}</td></tr>`;
    }).join('')}</tbody>`;
    tbl.querySelectorAll('[data-rtk]').forEach((tr) => tr.addEventListener('click', () => selectRoute(tr.dataset.rtk, true)));
  };
  const zoomToLine = (line) => {
    const cs = line.map((p) => p[0]), rs = line.map((p) => p[1]);
    const c0 = Math.min(...cs), c1 = Math.max(...cs), r0 = Math.min(...rs), r1 = Math.max(...rs), span = Math.max(c1 - c0, r1 - r0, 30) * 1.25;
    if (S.view === '3d') v3.lookAtCell((c0 + c1) / 2, (r0 + r1) / 2, span * S.grid.cs * 1.4); else map.centerOn((c0 + c1) / 2, (r0 + r1) / 2, Math.min(map.W, map.H) / span);
  };
  const selectRoute = (key, zoom) => {
    const r = recByKey(key);
    if (!r) return;
    S.routePanelKey = key;
    if (r.cat === 'route') { S.routes.sel = +key.split(':')[1]; S.picquets = null; showRouteProfile(); renderRouteCard(); }
    S.sel = { kind: 'rline', key };
    if (zoom) zoomToLine(r.line);
    showRightTab('routes');
    renderAll(); refresh();
  };
  const selectVertex = (key, v) => { S.sel = { kind: 'rvertex', key, v }; S.routePanelKey = key; showRightTab('attr'); renderAll(); refresh(); };
  /** Screen-space hits on displayed lines (2D map). */
  const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)); return Math.hypot(ax + t * dx - px, ay + t * dy - py); };
  const routeHits = (x, y, tol = 7) => routeRecords().filter((r) => r.visible).map((r) => {
    let d = Infinity;
    for (let k = 1; k < r.line.length; k++) { const a = map.toScreen(...r.line[k - 1]), b = map.toScreen(...r.line[k]); d = Math.min(d, segDist(x, y, a[0], a[1], b[0], b[1])); }
    return { r, d };
  }).filter((h) => h.d <= tol).sort((a, b) => a.d - b.d).map((h) => h.r);
  const vertexHit = (x, y) => {
    if (!S.sel || (S.sel.kind !== 'rline' && S.sel.kind !== 'rvertex')) return null;
    const r = recByKey(S.sel.key);
    if (!r) return null;
    let best = null, bd = 8;
    r.line.forEach((q, i) => { const [sx, sy] = map.toScreen(q[0], q[1]); const d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = i; } });
    return best === null ? null : { kind: 'rvertex', key: r.key, v: best };
  };
  /** Point inspector rows for a vertex of a generated line. */
  const vertexRows = (ref) => {
    const r = recByKey(ref.key);
    if (!r) return null;
    const q = r.line[ref.v], last = r.line.length - 1, g = S.grid;
    const rr = Math.round(q[1]), cc = Math.round(q[0]), i = rr * g.w + cc, en = M.cellToEN(g, rr, cc);
    const role = ref.v === 0 ? 'Start point' : ref.v === last ? 'End point' : `Intermediate vertex ${ref.v} of ${last - 1}`;
    const origin = ref.v === 0 ? endpointOrigin(r, 0) : ref.v === last ? endpointOrigin(r, 1) : ['Cell of the computed path kept by M.simplify (Ramer–Douglas–Peucker, 0.6 cell) — algorithmically derived; it marks a change of direction of the simplified line, not a decision point', 'calc'];
    const stage = ref.v === 0 ? (r.cat === 'eappr' || r.cat === 'infil' ? 'entryPoints() → pickSite' : r.cat === 'avenue' ? 'M.nearestPassable' : r.cat === 'route' ? 'User marker → cell index' : 'copied line') : ref.v === last ? (r.cat === 'eappr' || r.cat === 'infil' ? 'reachGoal()' : r.cat === 'avenue' ? 'M.nearestPassable' : r.cat === 'route' ? 'User marker → cell index' : 'copied line') : 'M.astar → M.routeStats → M.simplify';
    const mob = S.overlays.mobility.data;
    return { r, role, rows: [
      ['Generated point', null], ['Feature', `${r.id} — ${RCAT[r.cat].short}`], ['Role', role],
      ['How it was produced', origin[0] + (/algorithmically derived|user input|entered/i.test(origin[0]) ? '' : origin[1] === 'user' ? ' — entered by the user' : ' — algorithmically derived')], ['Function / processing stage', stage],
      ['Why a real force would choose it', CANNOT],
      ['Source raster cell', `row ${rr}, column ${cc} (index ${i}) · cell centre ${Math.round(en.E)} mE ${Math.round(en.N)} mN · ${g.cs} m cell`],
      ['Source metadata', `${g.name}${g.synthetic ? ' (synthetic)' : ''} · ${S.sources ? S.sources.map((s) => s.name).join(', ').slice(0, 90) : 'no file metadata'} · vertical datum setting ${F.vdatum()}`],
      ['Slope (cell)', `${S.L.slope[i].toFixed(1)}°`], ['Landform (cell)', M.LANDFORMS[S.L.landform[i]].name], ...(mob ? [['Go / No-Go (cell)', `${M.CLASS_NAMES[mob[i]]} — ${M.MOVEMENT_PROFILES[S.overlays.mobility.profile].name.split(' (')[0]} layer`]] : []),
    ], c: q[0], rr: q[1] };
  };

  /** Route-analysis report (HTML file) built only from the records above. */
  const exportRouteReport = (only) => {
    const recs = only || routeRecords();
    if (!recs.length) { toast('No generated lines to report.', true); return; }
    const parts = recs.map((r) => `<section><h2>${esc(r.id)} — ${esc(RCAT[r.cat].name)}</h2>${routeDetailHTML(r).html.replace(/<div class="sel-actions">[\s\S]*?<\/div>\s*<\/div>$/, '</div>')}</section>`).join('');
    const hist = S.runs.map((x) => `<tr><td>${esc(x.id || '')}</td><td>${esc(new Date(x.t).toLocaleString())}</td><td>${esc(x.label)}</td><td>${x.ok ? 'done' : 'failed'}</td><td>${(x.dur / 1000).toFixed(2)} s</td><td>${esc(x.summary || '')}</td></tr>`).join('');
    const css = `body{font:12px/1.45 "Segoe UI",Arial,sans-serif;color:#10202a;max-width:1000px;margin:24px auto;padding:0 16px}h1{font-size:20px}h2{font-size:15px;border-bottom:2px solid #28b7c5;padding-bottom:3px;margin-top:28px}h4{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#156a75;margin:14px 0 4px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #c9d8de;padding:3px 6px;text-align:left;vertical-align:top}.na{color:#9a5b00;font-style:italic}.pv{font-size:10px;border:1px solid #888;border-radius:7px;padding:0 5px;white-space:nowrap}.rt-notice{border:1px solid #d77;border-left:4px solid #c33;background:#fff4f4;padding:6px 9px;margin:8px 0}.rt-stage{border-left:3px solid #28b7c5;padding:2px 8px;margin:6px 0}.hint{color:#556}.rt-vtx{max-height:none}.pv-legend{display:flex;gap:6px;flex-wrap:wrap}code{font-size:11px}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>MtnEye route analysis report</title><style>${css}</style></head><body>
      <h1>MtnEye ${esc(M.VERSION)} — Route Analysis & Provenance Report</h1>
      <p>Project: <b>${esc(S.projectName)}</b> · DEM: ${esc(S.grid.name)} (${S.grid.w}×${S.grid.h} @ ${S.grid.cs} m, ${esc(F.analysisCRSName())}) · generated ${esc(new Date().toLocaleString())} · ${recs.length} line(s)</p>
      <div class="rt-notice">Every line in this report is a model output computed from terrain data and the recorded parameters. None of them is a verified route or a prediction of real-world movement or intent. Fields marked “Not recorded in this analysis run.” were not retained by the application; “Cannot be determined from the terrain model alone.” marks questions the model cannot answer.</div>
      ${parts}<h2>Processing history (this session${S.runs.some((x) => x.fromPlan) ? ', including records restored from the plan file' : ''})</h2><table><tr><th>Run</th><th>Time</th><th>Tool</th><th>Status</th><th>Duration</th><th>Summary</th></tr>${hist}</table></body></html>`;
    UI.download(fileName('route_report.html'), html, 'text/html');
    toast(`Route report exported (${recs.length} line${recs.length > 1 ? 's' : ''}).`);
  };

  // =================================================================== analysis results, diagnostics, catalog
  S.results = [];
  UI.onToolResult = (id, msg) => {
    if (!msg || msg.running) return;
    const tool = GP.TOOLS[id];
    const cmdOf = { mobility: 'mobility', keyTerrain: 'keyTerrain', viewshed: 'viewshed', los: 'los', hostile: 'hostileObservation', avenues: 'avenues', posts: 'posts', weapons: 'weapons', mfd: 'minefields', route: 'route', picquets: 'picquets', helipads: 'helipads', sectorTerrain: 'sectorTerrain', itgs: 'itgs', deploy: 'deploy', enemyApproaches: 'enemyApproaches', infiltration: 'infiltration', fireCoverage: 'fireCoverage', borderWatch: 'borderWatch', enemyOptions: 'enemyOptions' }[id];
    S.results.unshift({ t: Date.now(), tool: tool ? tool.name : id, id, title: msg.title, text: msg.text || '', err: !!msg.err, run: cmdOf && S.lastRun[cmdOf] ? S.lastRun[cmdOf].id : null });
    if (S.results.length > 100) S.results.pop();
    renderResults();
    if (!msg.err) { renderRouteTable(); if (!$('routesBody').hidden) renderRoutesPanel(); }
  };
  const renderResults = () => {
    const el = $('resultsBody');
    if (!el) return;
    el.innerHTML = S.results.length ? S.results.map((r) => `<div class="res-item${r.err ? ' err' : ''}"><b>${esc(r.title)}</b><span class="hint">${esc(new Date(r.t).toLocaleTimeString())}${r.run ? ` · ${esc(r.run)}` : ''}${UI.EXPLAIN_TOPICS[r.id] ? ` · <button class="link" data-resx="${esc(r.id)}">Explain</button>` : ''}</span><pre>${esc(r.text)}</pre></div>`).join('') : '<p class="hint">Tool results appear here after each run.</p>';
    el.querySelectorAll('[data-resx]').forEach((b) => (b.onclick = () => openExplain(b.dataset.resx)));
  };
  S.diag = [];
  const diag = (lvl, msg) => { S.diag.push({ t: Date.now(), lvl, msg: String(msg).slice(0, 400) }); if (S.diag.length > 300) S.diag.shift(); const c = S.diag.filter((d) => d.lvl !== 'info').length; const n = $('diagCount'); if (n) n.textContent = c ? `(${c})` : ''; };
  UI.diag = diag;
  { const ow = console.warn.bind(console), oe = console.error.bind(console); console.warn = (...a) => { diag('warn', a.join(' ')); ow(...a); }; console.error = (...a) => { diag('error', a.map((x) => (x && x.message) || x).join(' ')); oe(...a); }; }
  window.addEventListener('error', (e) => diag('error', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => diag('error', `Unhandled promise rejection: ${(e.reason && e.reason.message) || e.reason}`));
  const renderDiagnostics = () => {
    const el = $('diagBody');
    if (!el) return;
    let storage = 'available'; try { localStorage.setItem('mtneye.probe', '1'); localStorage.removeItem('mtneye.probe'); } catch (e) { storage = 'unavailable (settings and layout are not persisted)'; }
    const checks = [['MtnEye version', M.VERSION], ['Analysis engine', engine.mode === 'local' ? 'main thread (Web Worker unavailable)' : 'Web Worker'], ['WebGL2 (3D scene)', v3 && v3.ok ? 'available' : 'unavailable'],
      ['DecompressionStream (zipped / compressed GeoTIFF)', typeof DecompressionStream !== 'undefined' ? 'available' : 'missing'], ['Local storage', storage], ['Layout storage key', `${LAYOUT_KEY}${S.layoutMigrated ? ' (1.2 layout found and ignored on first launch)' : ''}`],
      ['Network (navigator.onLine)', navigator.onLine ? 'online' : 'offline'], ['Basemap imagery', `${S.imagery.status} — ${S.imagery.message || ''}`], ['External libraries', 'none (single file; milsymbol not bundled)'],
      ['Loaded DEM', S.grid ? `${S.grid.name} · ${S.grid.w}×${S.grid.h} @ ${S.grid.cs} m` : 'none'], ['Engine runs this session', `${S.runs.length} (${S.runs.filter((r) => !r.ok).length} failed)`], ['Viewport', `${innerWidth} × ${innerHeight} · device pixel ratio ${devicePixelRatio || 1}`]];
    el.innerHTML = `<table class="grid-table">${checks.map(([k, v]) => `<tr class="diag-row"><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
      <h5 class="subh">Log (${S.diag.length})</h5><table class="grid-table">${S.diag.slice().reverse().map((d) => `<tr><td class="m">${esc(new Date(d.t).toLocaleTimeString())}</td><td><span class="diag-lvl ${d.lvl}">${d.lvl}</span></td><td class="wrap">${esc(d.msg)}</td></tr>`).join('') || '<tr><td class="wrap">No warnings or errors logged.</td></tr>'}</table>`;
  };
  S.projectName = 'Untitled project';
  const updateProjectTitle = () => { $('projTitle').textContent = S.projectName; document.title = `${S.projectName} — MtnEye`; };
  const renameProject = () => { const n = prompt('Project name', S.projectName); if (n && n.trim()) { S.projectName = n.trim().slice(0, 80); updateProjectTitle(); renderCatalog(); } };
  const renderCatalog = () => {
    const el = $('catalogBody');
    if (!el) return;
    const g = S.grid;
    const item = (icon, title, sub, acts) => `<div class="rt-item" style="grid-template-columns:18px 1fr auto;cursor:default">${UI.icon(icon, 15)}<span><b style="font-weight:600">${esc(title)}</b><br><small>${esc(sub)}</small></span><span>${acts || ''}</span></div>`;
    const btn = (cmd, t) => `<button class="btn sm" data-cat-cmd="${cmd}">${t}</button>`;
    el.innerHTML = `<div class="rt-cat">Project</div>${item('doc', S.projectName, `MtnEye ${M.VERSION} plan · ${S.runs.length} processing records`, btn('renameProject', 'Rename') + ' ' + btn('savePlan', 'Save'))}
      ${item('open', 'Open plan / project…', 'MtnEye plan (.json)', btn('loadPlan', 'Open'))}
      <div class="rt-cat">Elevation data</div>${g ? item('terrain', g.name, `${g.w} × ${g.h} @ ${g.cs} m · ${F.analysisCRSName()}${g.synthetic ? ' · synthetic' : ''}`, btn('explainDem', 'Explain')) : item('terrain', 'No elevation model', 'Add data to start', btn('addData', 'Add'))}
      ${(S.sources || []).map((s) => item('data', s.name, `${s.w} × ${s.h} source pixels`, '')).join('')}
      ${item('download', 'Download DEM…', 'AWS Terrain Tiles / OpenTopography (internet)', btn('downloadDEM', 'Open'))}
      <div class="rt-cat">Basemap</div>${item('imagery', S.imagery.status === 'ready' ? UI.IMAGERY_SOURCES[S.imagery.sourceId].name : 'Simulated terrain colouring', S.imagery.message || '', btn('reloadImagery', 'Reload'))}
      <div class="rt-cat">Analysis runs (${S.runs.length})</div>${S.runs.slice(-12).reverse().map((r) => item(r.ok ? 'ok' : 'err', `${r.id || ''} ${r.label}`, `${new Date(r.t).toLocaleTimeString()} · ${r.summary ? r.summary.split('\n')[0].slice(0, 70) : ''}`, '')).join('') || '<p class="hint pad">No runs yet.</p>'}
      <div class="rt-cat">Documentation</div>${item('book', 'Reference library', 'GSP / IPB citations, standards, literature', btn('docs', 'Open'))}`;
    el.querySelectorAll('[data-cat-cmd]').forEach((b) => (b.onclick = () => (b.dataset.catCmd === 'explainDem' ? openExplain('elevation') : runCmd(b.dataset.catCmd))));
  };

  // =================================================================== panes & layout
  const showRightTab = (tab) => {
    document.querySelectorAll('[data-rtab]').forEach((b) => b.classList.toggle('on', b.dataset.rtab === tab));
    document.querySelectorAll('[data-rpanel]').forEach((p) => (p.hidden = p.dataset.rpanel !== tab));
    if ($('app').classList.contains('no-right')) { $('app').classList.remove('no-right'); saveLayout(); map.resize(); }
    if (tab === 'gp' && !GP.current() && !$('gpPane').innerHTML) GP.home();
    if (tab === 'routes') renderRoutesPanel();
    if (tab === 'catalog') renderCatalog();
    updateWsButtons();
  };
  // Layout storage is versioned: 1.3 ignores the 1.2 key ('mtnai.layout.v2') so old pane sizes cannot
  // override the new map-first defaults on first launch. Only dimensions the user drags are stored.
  const LAYOUT_KEY = 'mtneye.layout.v13';
  const LEGACY_LAYOUT_KEYS = ['mtnai.layout.v2'];
  const saveLayout = () => {
    try {
      const st = document.documentElement.style;
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({
        v: '1.3', left: st.getPropertyValue('--left-w'), right: st.getPropertyValue('--right-w'), dock: st.getPropertyValue('--dock-h'),
        noLeft: $('app').classList.contains('no-left'), noRight: $('app').classList.contains('no-right'), dockClosed: $('dock').classList.contains('collapsed'),
        rbMin: document.body.classList.contains('rb-min'), rbCompact: document.body.classList.contains('rb-compact'), rbTab: S.rbTab,
      }));
    } catch (e) { /* storage unavailable */ }
  };
  /** Map-first defaults: Contents open, contextual pane closed (opens when needed), dock collapsed. */
  const applyDefaultLayout = () => {
    const st = document.documentElement.style;
    for (const v of ['--left-w', '--right-w', '--dock-h']) st.removeProperty(v);
    const narrow = window.innerWidth <= 900;
    $('app').classList.toggle('no-left', narrow);
    $('app').classList.add('no-right');
    $('dock').classList.add('collapsed');
    $('dockToggle').textContent = '▴';
    document.body.classList.remove('rb-min', 'rb-peek', 'rb-compact', 'ws-expanded');
    S.ws = 'default';
  };
  const loadLayout = () => {
    let l = null;
    try { l = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); } catch (e) { l = null; }
    S.layoutMigrated = !l && LEGACY_LAYOUT_KEYS.some((k) => { try { return localStorage.getItem(k) !== null; } catch (e) { return false; } });
    applyDefaultLayout();
    if (l) {
      const st = document.documentElement.style;
      if (l.left) st.setProperty('--left-w', l.left);
      if (l.right) st.setProperty('--right-w', l.right);
      if (l.dock) st.setProperty('--dock-h', l.dock);
      $('app').classList.toggle('no-left', !!l.noLeft || window.innerWidth <= 900);
      $('app').classList.toggle('no-right', l.noRight !== false);
      $('dock').classList.toggle('collapsed', l.dockClosed !== false);
      $('dockToggle').textContent = $('dock').classList.contains('collapsed') ? '▴' : '▾';
      document.body.classList.toggle('rb-min', !!l.rbMin);
      document.body.classList.toggle('rb-compact', !!l.rbCompact);
    }
    S.rbTab = (l && l.rbTab) || 'map';
  };
  const relayout = () => { updateRibbonState(); updateWsButtons(); setTimeout(() => { map.resize(); if (S.view === '3d') v3.resize(); if (S.drawerData && !$('dock').classList.contains('collapsed')) UI.drawProfile($('chart'), S.drawerData); }, 0); };
  /** Workspace modes: 'gis' (everything), 'map' (expanded map, floating controls), 'full' (full screen). */
  const setWorkspace = (mode) => {
    if (mode === 'full') { document.body.classList.remove('ws-expanded'); toggleFocus(true); S.ws = 'full'; relayout(); return; }
    if (document.body.classList.contains('focus-map')) toggleFocus(false);
    if (mode === 'map') {
      document.body.classList.add('ws-expanded', 'rb-min'); document.body.classList.remove('rb-peek');
      S.ws = 'map';
    } else {
      document.body.classList.remove('ws-expanded', 'rb-min');
      $('app').classList.remove('no-left', 'no-right');
      $('dock').classList.remove('collapsed'); $('dockToggle').textContent = '▾';
      S.ws = 'gis';
      saveLayout();
    }
    relayout();
  };
  const restoreLayout = () => {
    try { localStorage.removeItem(LAYOUT_KEY); } catch (e) { /* ignore */ }
    if (document.body.classList.contains('focus-map')) toggleFocus(false);
    applyDefaultLayout();
    relayout();
    toast('Default map-first layout restored.');
  };
  const updateWsButtons = () => {
    const full = document.body.classList.contains('focus-map'), exp = document.body.classList.contains('ws-expanded');
    const gis = !full && !exp && !$('app').classList.contains('no-left') && !$('app').classList.contains('no-right') && !$('dock').classList.contains('collapsed');
    $('wsGis').classList.toggle('on', gis); $('wsMap').classList.toggle('on', exp); $('wsFull').classList.toggle('on', full);
  };
  const initSplitters = () => {
    document.querySelectorAll('.splitter').forEach((sp) => sp.addEventListener('mousedown', (e) => {
      e.preventDefault();
      sp.classList.add('drag');
      const kind = sp.dataset.split;
      const st = document.documentElement.style;
      const move = (ev) => {
        if (kind === 'left') st.setProperty('--left-w', `${Math.max(180, Math.min(520, ev.clientX - $('app').getBoundingClientRect().left))}px`);
        else if (kind === 'right') st.setProperty('--right-w', `${Math.max(260, Math.min(620, window.innerWidth - ev.clientX))}px`);
        else { $('dock').classList.remove('collapsed'); st.setProperty('--dock-h', `${Math.max(90, Math.min(window.innerHeight * 0.7, $('center').getBoundingClientRect().bottom - ev.clientY))}px`); }
      };
      const up = () => {
        sp.classList.remove('drag');
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        saveLayout(); relayout();
      };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    }));
  };
  const applyTheme = () => {
    document.body.dataset.theme = 'light'; // dark themes are disabled; older saved choices fall back to light
    document.body.dataset.density = cfg('ui.density');
    document.documentElement.style.setProperty('--fs', `${cfg('ui.fontSize')}px`);
  };
  /** Focus Map: hide panes, dock and ribbon body so the elevation model fills the window; full screen where allowed. */
  let preFocusRbMin = false;
  const toggleFocus = (force) => {
    const on = force !== undefined ? force : !document.body.classList.contains('focus-map');
    if (on === document.body.classList.contains('focus-map')) return;
    if (on) { preFocusRbMin = document.body.classList.contains('rb-min'); document.body.classList.add('focus-map', 'rb-min'); }
    else { document.body.classList.remove('focus-map', 'rb-peek'); document.body.classList.toggle('rb-min', preFocusRbMin); }
    $('focusBtn').querySelector('span').textContent = on ? 'Exit Focus' : 'Focus Map';
    try {
      if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    } catch (e) { /* full screen not allowed */ }
    updateRibbonState(); if (typeof updateWsButtons === 'function') updateWsButtons();
    setTimeout(() => { map.resize(); if (S.view === '3d') v3.resize(); else map.fit(); }, 60);
    setTimeout(() => { map.resize(); if (S.view === '3d') v3.resize(); else map.fit(); }, 400);
  };
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('focus-map')) toggleFocus(false); });
  const togglePane = (cls) => { if (document.body.classList.contains('ws-expanded')) document.body.classList.remove('ws-expanded', 'rb-min'); $('app').classList.toggle(cls); saveLayout(); relayout(); };

  /** Inputs bound directly to a setting (data-setting="key"), e.g. on the ribbon. */
  const bindSettingInputs = () => {
    $('rbBody').querySelectorAll('[data-setting]').forEach((el) => {
      const key = el.dataset.setting, it = Settings.ITEMS[key];
      if (el.tagName === 'SELECT' && !el.options.length) {
        const opts = typeof it.options === 'function' ? it.options() : it.options;
        el.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
      }
      if (it.min !== undefined) el.min = it.min;
      if (it.max !== undefined) el.max = it.max;
      el.addEventListener('change', () => Settings.set(key, el.type === 'checkbox' ? el.checked : el.value));
    });
    syncRibbonInputs();
  };
  const syncRibbonInputs = () => {
    document.querySelectorAll('[data-setting]').forEach((el) => {
      const v = cfg(el.dataset.setting);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    if ($('rbThreat')) $('rbThreat').value = S.threatType;
    if ($('rbEchelon')) $('rbEchelon').value = S.ownEchelon;
  };

  /** React to settings changes according to their apply tags. */
  const onSettings = async (keys) => {
    const tags = Settings.tags(keys);
    syncRibbonInputs();
    if (tags.has('ui')) applyTheme();
    if (tags.has('sym')) UI.symbolCacheClear();
    if (tags.has('ovl')) for (const o of Object.values(S.overlays)) o.rgba = null;
    if (keys.includes('map.base')) S.base = cfg('map.base');
    if ((keys.includes('weapons') && GP.current() === 'weapons') || (keys.includes('profiles') && GP.current() === 'mobility')) GP.render();
    updateRibbonState();
    if (!S.grid) { updateStatusStatic(); return; }
    try {
      if (tags.has('analysis')) { await pushConfig(); await syncSettings(); }
      if (tags.has('reanalyse')) { await reloadTerrain('landform scales changed'); return; }
      if (tags.has('zone')) {
        if (S.sources) { await reloadTerrain(`analysis projection ${cfg('crs.zone') === 'auto' ? 'automatic' : 'UTM zone ' + cfg('crs.zone')}`); return; }
        toast('The synthetic training area is defined in UTM zone 43N; the projection setting applies to imported DEMs.');
      }
      if (tags.has('hs')) await recomputeHillshade(true);
      if (tags.has('contours')) S.contours = await engine.call('contours', { interval: +cfg('map.contourInterval'), majorEvery: +cfg('map.contourIndex') });
      if (tags.has('mesh') && v3.ok) { v3.setTerrain(S.grid, S.L.z); S.texDirty = true; }
      if (tags.has('3d') && v3.ok) v3.setExaggeration(+cfg('v3.vex'));
      if (keys.includes('profiles')) { await syncSettings(); if (S.overlays.mobility.data) await computeMobility(Object.assign(GP.values('mobility'), { profile: S.overlays.mobility.profile }), true); }
    } catch (e) { toast(e.message, true); }
    if (tags.has('imagery') || keys.includes('map.mode')) {
      const needs = basemapMode() !== 'topo' && !(S.imagery.status === 'ready' && S.imagery.sourceId === cfg('map.imagerySource') && !keys.includes('map.imageryUrl'));
      if (needs || basemapMode() === 'topo') requestImagery();
    }
    refresh({ base: ['base', 'hs', 'contours', 'ovl', 'sym', 'reanalyse', 'imagery'].some((t) => tags.has(t)) || keys.includes('map.base') });
    renderAll();
    if (S.view === '3d') updateTexture(true);
  };

  // =================================================================== view switching
  const setView = (v) => {
    if (v === '3d' && !v3.ok) { toast('WebGL2 is not available — Scene view disabled.', true); return; }
    if (!S.grid && v === '3d') return;
    const prev = S.view;
    S.view = v;
    $('vtMap').classList.toggle('on', v === '2d'); $('vtScene').classList.toggle('on', v === '3d'); $('vtModel').classList.toggle('on', v === 'model');
    $('map2d').hidden = v !== '2d'; $('gl3d').hidden = v !== '3d'; $('ovl3d').hidden = v !== '3d';
    document.body.classList.toggle('model-view', v === 'model');
    $('app').classList.toggle('mb-full', v === 'model');
    if (UI.MB) UI.MB.show(v === 'model');
    v3.visible = v === '3d';
    if (v === 'model') { updateRibbonState(); return; }
    $('mc2d3d').textContent = v === '3d' ? '2D' : '3D';
    // keep the project context: the 3D camera looks at the 2D map centre and vice versa
    if (S.grid && prev !== v && prev !== 'model' && v3.mesh) {
      if (v === '3d') {
        const span = (map.W / Math.max(1e-6, map.view.scale)) * S.grid.cs;
        v3.lookAtCell(Math.max(0, Math.min(S.grid.w - 1, map.view.cx)), Math.max(0, Math.min(S.grid.h - 1, map.view.cy)), Math.max(800, span * 1.15));
      } else if (v3.cam && v3.cam.target) {
        map.view.cx = v3.cam.target[0] / S.grid.cs + (S.grid.w - 1) / 2;
        map.view.cy = v3.cam.target[2] / S.grid.cs + (S.grid.h - 1) / 2;
      }
    }
    if (v === '3d') { v3.resize(); if (S.texDirty) updateTexture(true); v3.render(); } else { v3.stopFly(); map.resize(); }
    updateScale(); updateRibbonState();
  };

  // =================================================================== plan save / load
  const savePlanObject = () => {
    if (!S.grid) return null;
    const strip = (o, keys) => { if (!o) return null; const c = Object.assign({}, o); for (const k of keys) delete c[k]; return c; };
    return {
      format: 'mtneye-plan', version: M.VERSION, created: new Date().toISOString(), grid: M.gridMeta(S.grid),
      markers: S.markers, obstacles: S.obstacles, tracks: S.tracks, threatType: S.threatType, ownEchelon: S.ownEchelon, snowLine: S.snowLine, relief: S.relief,
      key: S.key, posts: strip(S.posts, ['cover', 'dead']), weapons: S.weapons.map((w) => strip(w, ['cover'])),
      mfd: S.mfd, avenues: S.avenues, helipads: S.helipads, sector: S.sector, border: S.border, sec: S.sec, routes: S.routes && Object.assign({}, S.routes, { routes: S.routes.routes.map((r) => strip(r, ['path', 'profile'])) }), picquets: S.picquets,
      symOpts: S.symOpts, overlayOrder: S.overlayOrder, processingRecord: S.runs.filter((r) => r.ok).slice(-100),
      projectName: S.projectName, markerOrigin: S.markerOrigin, hiddenRoutes: S.hiddenRoutes, symbolConvention: cfg('sym.unitConvention'),
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
    if (plan.format !== 'mtneye-plan' && plan.format !== 'mtnai-plan') { toast('Not an MtnEye plan file.', true); return; }
    const p = UI.remapPlan(plan, plan.grid, S.grid);
    const inGrid = (m) => m && m.c >= 0 && m.r >= 0 && m.c < S.grid.w && m.r < S.grid.h;
    S.markers = {};
    for (const k in p.markers || {}) if (inGrid(p.markers[k])) S.markers[k] = { c: Math.round(p.markers[k].c), r: Math.round(p.markers[k].r) };
    S.markerOrigin = {};
    for (const k in S.markers) S.markerOrigin[k] = plan.markerOrigin && plan.markerOrigin[k] ? (opts.silent ? plan.markerOrigin[k] : `${plan.markerOrigin[k]} (restored from plan file)`) : 'plan file';
    if (plan.projectName && !opts.silent) { S.projectName = plan.projectName; updateProjectTitle(); }
    if (plan.hiddenRoutes) S.hiddenRoutes = Object.assign({}, plan.hiddenRoutes);
    if (!opts.silent) { undoStack.length = 0; redoStack.length = 0; updateUndoButtons(); } // edit history does not span plan loads
    Object.assign(S, { obstacles: p.obstacles || [], tracks: p.tracks || [], threatType: p.threatType || 'foot', ownEchelon: p.ownEchelon || 'battalion', snowLine: p.snowLine || 0, relief: !!p.relief,
      sector: p.sector || null, border: p.border || null });
    if (plan.symOpts) S.symOpts = { own: Object.assign({ planned: false, designation: 'OWN', isHQ: false, affil: 'F', func: '', hqDesignation: '', size: 1 }, plan.symOpts.own), threat: Object.assign({ echelon: 'battalion', planned: false, designation: 'ENY', isHQ: false, affil: 'H', func: '', hqDesignation: '', size: 1 }, plan.symOpts.threat) };
    if (Array.isArray(plan.overlayOrder)) S.overlayOrder = plan.overlayOrder.slice();
    if (Array.isArray(plan.processingRecord) && (!opts.silent || plan.grid.name === S.grid.name)) {
      // processing records travel with the plan so Explain This can still show the parameters used
      for (const r of plan.processingRecord) { if (!S.runs.some((x) => x.t === r.t && x.cmd === r.cmd)) S.runs.push(Object.assign({}, r, { fromPlan: true })); }
      for (const r of S.runs) if (r.ok && (!S.lastRun[r.cmd] || S.lastRun[r.cmd].t <= r.t)) S.lastRun[r.cmd] = r;
    }
    S.sec = !opts.silent || plan.grid.name === S.grid.name ? p.sec || {} : {};
    if (!opts.silent || plan.grid.name === S.grid.name) {
      Object.assign(S, { key: p.key || null, posts: p.posts || null, mfd: p.mfd || null, avenues: p.avenues || null, picquets: p.picquets || null, helipads: p.helipads || null });
      S.weapons = (p.weapons || []).map((w) => Object.assign(w, { weapon: weaponOf(w.weapon.id) }));
      S.routes = p.routes || null;
      if (S.routes) {
        const pr = await Promise.all(S.routes.routes.map((r) => engine.call('profile', { pts: r.line })));
        S.routes.routes.forEach((r, k) => { r.profile = pr[k].profile; r.path = linePath(r.line); });
      }
    }
    syncRibbonInputs();
    await syncSettings();
    renderAll(); refresh({ base: true });
    if (!opts.silent) toast('Plan loaded.');
  };

  // =================================================================== export
  const fileName = (suffix) => `${cfg('rep.prefix') || ''}${(S.grid.name || 'mtneye').replace(/[^\w.-]+/g, '_').slice(0, 40)}_${suffix}`;
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
    else if (kind === 'shp') {
      const base = fileName('plan').replace(/[^\w-]+/g, '_');
      const files = M.geojsonToShapefiles(UI.toGeoJSON(S), base);
      if (!Object.keys(files).length) { toast('Nothing to export yet.', true); return; }
      UI.download(`${base}_shapefiles.zip`, new Blob([M.zipStore(files)], { type: 'application/zip' }), 'application/zip');
      toast(`Shapefiles exported (WGS 84): ${Object.keys(files).filter((f) => f.endsWith('.shp')).join(', ')}.`);
    }
    else if (kind === 'png') {
      const url = S.view === '3d' ? snapshot3D() : $('map2d').toDataURL('image/png');
      UI.download(fileName(`${S.view}.png`), await (await fetch(url)).blob(), 'image/png');
    } else if (kind === 'plan') UI.download(fileName('plan.mtneye.json'), JSON.stringify(savePlanObject()), 'application/json');
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

  // =================================================================== go to XY
  const gotoRef = (text) => {
    const box = $('gotoBox');
    const ll = F.parse(text);
    if (!ll || !S.grid) { box.classList.add('bad'); toast('Unrecognised reference. Accepted: MGRS, UTM, lat/lon (DD/DM/DMS), GARS, GEOREF or secondary-CRS E/N.', true); return; }
    box.classList.remove('bad');
    const p = M.latLonToCell(S.grid, ll.lat, ll.lon);
    if (!M.inGrid(S.grid, Math.round(p.r), Math.round(p.c))) { toast(`${F.ref(ll.lat, ll.lon)} is outside the loaded DEM.`, true); return; }
    S.gotoMark = { c: p.c, r: p.r };
    if (S.view === '3d') v3.lookAtCell(p.c, p.r, 4000); else map.centerOn(p.c, p.r, Math.max(map.view.scale, 3));
    select({ kind: 'point', c: p.c, r: p.r }, false, true);
  };

  // =================================================================== render all
  const renderAll = () => {
    renderTOC();
    if (!S.grid) return;
    renderSelection(); renderAttrTable(); updateMarkerButtons(); updateStatusStatic(); updateScale(); updateRibbonState();
    // keep an open explanation in step with re-run results (parameters, counts)
    const ex = $('explainBody');
    if (S.explainTopic && ex && !ex.hidden) { const st = ex.scrollTop; ex.innerHTML = UI.explainHTML(S.explainTopic.topic, S.explainTopic.extra); ex.scrollTop = st; ex.querySelectorAll('[data-ref]').forEach((b) => (b.onclick = () => openDocs(UI.resolveRef(b.dataset.ref, b.dataset.sec)))); }
  };
  const updateMarkerButtons = () => {
    const syms = { own: UI.ownSpec(), threat: UI.threatSpec(), target: UI.SYM.target(), a: UI.SYM.sp(), b: UI.SYM.rp() };
    document.querySelectorAll('[data-sym]').forEach((n) => {
      const k = n.dataset.sym;
      n.innerHTML = UI.symbolHTML(syms[k], n.classList.contains('lg') ? 17 : 12);
      const b = n.closest('button');
      if (b) b.classList.toggle('set', !!S.markers[k]);
    });
  };

  // =================================================================== commands
  const need = () => !!S.grid;
  const CMD = {
    addData: { t: 'Add Data — open elevation model…', rb: 'Add Data', icon: 'open', k: 'Ctrl+O', run: () => $('demFiles').click() },
    downloadDEM: { t: 'Download DEM…', rb: 'Download DEM', icon: 'download', run: () => openGP('downloadDEM') },
    demo: { t: 'Load demo terrain', rb: 'Demo Terrain', icon: 'terrain', run: loadDemo },
    explore: { t: 'Explore (pan, zoom, select)', rb: 'Explore', icon: 'zoom', run: () => setTool(null), on: () => !S.tool },
    fit: { t: 'Full extent', rb: 'Full Extent', icon: 'fit', k: 'F', need, run: () => (S.view === '3d' ? v3.home() : map.fit()) },
    zoomIn: { t: 'Zoom in', rb: 'Zoom In', icon: 'plus', k: '+', need, run: () => (S.view === '3d' ? ((v3.cam.dist *= 0.7), v3.render()) : map.zoomAt(map.W / 2, map.H / 2, 1.5)) },
    zoomOut: { t: 'Zoom out', rb: 'Zoom Out', icon: 'minus', k: '−', need, run: () => (S.view === '3d' ? ((v3.cam.dist /= 0.7), v3.render()) : map.zoomAt(map.W / 2, map.H / 2, 1 / 1.5)) },
    basemap: { t: 'Basemap — hybrid / imagery / topographic, terrain symbology', rb: 'Basemap', icon: 'layers', need, menu: basemapMenu },
    reloadImagery: { t: 'Reload satellite imagery', rb: 'Reload Imagery', icon: 'imagery', need, run: () => requestImagery() },
    explainCur: { t: 'Explain this — method, data, parameters of the selected result / layer', rb: 'Explain This', icon: 'help', k: 'E', need, run: explainCurrent },
    docs: { t: 'Reference library — GSP / IPB citations, standards, literature', rb: 'Reference Library', icon: 'book', k: 'Shift+F1', run: () => openDocs() },
    toggleView: { t: 'Switch between 2D map and 3D scene', rb: '2D / 3D', icon: 'terrain', need, run: () => setView(S.view === '3d' ? '2d' : '3d') },
    clearSel: { t: 'Clear selection', rb: 'Clear', icon: 'err', need, run: () => { S.sel = null; S.gotoMark = null; S.draft = null; renderAll(); refresh(); } },
    attrTable: { t: 'Attribute table', rb: 'Attribute Table', icon: 'log', k: 'Ctrl+T', need, run: () => openAttrTable(S.tocSel && findLayer(S.tocSel) && findLayer(S.tocSel).table ? S.tocSel : '') },
    fullExtent: { t: 'Full extent of DEM (undo crop)', rb: 'Full DEM', icon: 'fit', need, run: safe(resetAOI) },
    reproject: { t: 'Re-analyse terrain (apply projection / scale settings)', rb: 'Re-analyse', icon: 'terrain', need, run: safe(() => reloadTerrain('manual')) },
    loadPlan: { t: 'Open plan…', rb: 'Open Plan', icon: 'open', need, run: () => $('planFile').click() },
    savePlan: { t: 'Save plan', rb: 'Save Plan', icon: 'save', k: 'Ctrl+S', need, run: () => doExport('plan') },
    shapefile: { t: 'Export features — Shapefile (zipped)', rb: 'Shapefile', icon: 'download', need, run: () => doExport('shp') },
    'tool:sector': { t: 'Draw the sector boundary (area of interest)', rb: 'Sector Boundary', icon: 'crop', need, run: () => setTool('sector'), on: () => S.tool === 'sector' },
    'tool:border': { t: 'Draw the border line (LoC)', rb: 'Border Line', icon: 'track', need, run: () => setTool('border'), on: () => S.tool === 'border' },
    clearSector: { t: 'Clear sector boundary, border line and sector results', rb: 'Clear Sector', icon: 'err', need, run: () => { pushUndo('Clear sector'); S.sector = null; S.border = null; safe(onSectorChanged)(); } },
    secReport: { t: 'Sector assessment report', rb: 'Report', icon: 'doc', need, run: () => doExport('report') },
    geojson: { t: 'Export features — GeoJSON', rb: 'GeoJSON', icon: 'download', need, run: () => doExport('geojson') },
    csv: { t: 'Export attribute table — CSV', rb: 'Table (CSV)', icon: 'download', need, run: () => doExport('csv') },
    raster: { t: 'Export raster — GeoTIFF / ASCII grid…', rb: 'Raster', icon: 'download', need, run: () => openGP('exportRaster') },
    png: { t: 'Export view — PNG', rb: 'View (PNG)', icon: 'download', need, run: () => doExport('png') },
    report: { t: 'Terrain assessment report', rb: 'Report', icon: 'doc', k: 'Ctrl+P', need, run: () => doExport('report') },
    settings: { t: 'Settings…', rb: 'Settings', icon: 'gear', k: 'Ctrl+,', run: () => Settings.open() },
    gpCRS: { t: 'Coordinate systems…', rb: 'Coordinate Systems', icon: 'target', run: () => Settings.open('crs') },
    gpRefs: { t: 'Grid reference formats…', rb: 'Grid Refs', icon: 'target', run: () => Settings.open('refs') },
    view2d: { t: 'Map view (2D)', rb: 'Map', icon: 'data', k: '2', run: () => setView('2d'), on: () => S.view === '2d' },
    viewModel: { t: 'ModelBuilder — each analysis as a chain of GIS tools (Slope, Reclassify, Raster Calculator, Path Distance, Cost Path…) you can edit and run', rb: 'ModelBuilder', icon: 'flow', k: '4', run: () => setView('model'), on: () => S.view === 'model' },
    view3d: { t: 'Scene view (3D)', rb: 'Scene', icon: 'terrain', k: '3', need, run: () => setView('3d'), on: () => S.view === '3d' },
    viewModel: { t: 'ModelBuilder — each analysis as a chain of GIS tools (Slope, Reclassify, Raster Calculator, Path Distance, Cost Path…) you can edit and run', rb: 'ModelBuilder', icon: 'flow', k: '4', run: () => setView('model'), on: () => S.view === 'model' },
    focusMap: { t: 'Focus map — enlarge the map to fill the window', rb: 'Focus Map', icon: 'fit', k: 'Z', need, run: () => toggleFocus(), on: () => document.body.classList.contains('focus-map') },
    toggleLeft: { t: 'Contents pane', rb: 'Contents', icon: 'layers', k: 'Ctrl+B', run: () => togglePane('no-left'), on: () => !$('app').classList.contains('no-left') },
    toggleRight: { t: 'Geoprocessing / Attributes / Explain pane', rb: 'Side Pane', icon: 'panel', k: 'Ctrl+E', run: () => togglePane('no-right'), on: () => !$('app').classList.contains('no-right') },
    toggleDock: { t: 'Attribute table / profile dock', rb: 'Table Dock', icon: 'log', k: 'Ctrl+J', run: () => setDock($('dock').classList.contains('collapsed')), on: () => !$('dock').classList.contains('collapsed') },
    gpTools: { t: 'Geoprocessing — toolboxes', rb: 'Tools', icon: 'tools', run: () => { GP.home(); showRightTab('gp'); } },
    history: { t: 'Processing history (dock)', rb: 'History', icon: 'log', run: () => { setDock(true); showDockTab('hist'); } },
    results: { t: 'Analysis results (dock)', rb: 'Results', icon: 'log', run: () => { setDock(true); showDockTab('results'); } },
    diagnostics: { t: 'Diagnostics log (dock)', rb: 'Diagnostics', icon: 'gear', run: () => { setDock(true); showDockTab('diag'); } },
    undo: { t: 'Undo last edit', rb: 'Undo', icon: 'undo', k: 'Ctrl+Z', need, run: () => safe(undo)() },
    redo: { t: 'Redo edit', rb: 'Redo', icon: 'redo', k: 'Ctrl+Y', need, run: () => safe(redo)() },
    renameProject: { t: 'Rename project', rb: 'Rename', icon: 'doc', run: () => renameProject() },
    catalog: { t: 'Catalog pane — project items and data', rb: 'Catalog', icon: 'data', run: () => showRightTab('catalog') },
    'ws:gis': { t: 'Workspace — full GIS (Contents, map, side pane, dock)', rb: 'GIS Workspace', icon: 'panel', run: () => setWorkspace('gis'), on: () => S.ws === 'gis' && !document.body.classList.contains('ws-expanded') && !document.body.classList.contains('focus-map') },
    'ws:map': { t: 'Workspace — expanded map (panes and dock hidden)', rb: 'Expanded Map', icon: 'fit', k: 'X', run: () => setWorkspace('map'), on: () => document.body.classList.contains('ws-expanded') },
    'ws:full': { t: 'Workspace — full-screen map', rb: 'Full Screen', icon: 'expand', k: 'Z', need, run: () => setWorkspace('full'), on: () => document.body.classList.contains('focus-map') },
    restoreLayout: { t: 'Restore default layout (map-first)', rb: 'Restore Layout', icon: 'reset', run: () => restoreLayout() },
    compactRibbon: { t: 'Compact ribbon (icons only)', rb: 'Compact Ribbon', check: true, run: () => { document.body.classList.toggle('rb-compact'); saveLayout(); relayout(); }, on: () => document.body.classList.contains('rb-compact') },
    routesPane: { t: 'Route Analysis & Provenance pane', rb: 'Route Analysis', icon: 'route', run: () => showRightTab('routes') },
    routeTable: { t: 'Route information table (dock)', rb: 'Route Table', icon: 'log', run: () => { setDock(true); showDockTab('routes'); } },
    routeReport: { t: 'Export route-analysis report (HTML)', rb: 'Route Report', icon: 'doc', need, run: () => exportRouteReport() },
    symMatrix: { t: 'Unit frame matrix — formations vs headquarters', rb: 'Frame Matrix', icon: 'hq', run: () => openSymbolMatrix() },
    'conv:mtneye': { t: 'Unit frames: goose eggs for platoon / company / battalion, squares for every HQ', rb: 'Goose / HQ Square', icon: 'egg', run: () => Settings.set('sym.unitConvention', 'mtneye'), on: () => cfg('sym.unitConvention') !== 'app6' },
    'conv:app6': { t: 'Unit frames: standard APP-6(D) frames with HQ staff', rb: 'APP-6 Frames', icon: 'hq', run: () => Settings.set('sym.unitConvention', 'app6'), on: () => cfg('sym.unitConvention') === 'app6' },
    symBigger: { t: 'Larger symbols', rb: 'Larger', icon: 'plus', run: () => Settings.set('sym.size', Math.min(64, +cfg('sym.size') + 4)) },
    symSmaller: { t: 'Smaller symbols', rb: 'Smaller', icon: 'minus', run: () => Settings.set('sym.size', Math.max(16, +cfg('sym.size') - 4)) },
    declutter: { t: 'Hide overlapping labels', rb: 'Declutter', check: true, run: () => Settings.set('sym.declutter', !cfg('sym.declutter')), on: () => cfg('sym.declutter') !== false },
    symFilled: { t: 'Filled frames', rb: 'Filled', check: true, run: () => Settings.set('sym.filled', !cfg('sym.filled')), on: () => !!cfg('sym.filled') },
    symSettings: { t: 'Symbology settings…', rb: 'Symbology', icon: 'gear', run: () => Settings.open('sym') },
    'mode:hybrid': { t: 'Basemap: hybrid satellite + topographic', rb: 'Hybrid', icon: 'layers', run: () => Settings.set('map.mode', 'hybrid'), on: () => cfg('map.mode') === 'hybrid' },
    'mode:imagery': { t: 'Basemap: imagery only', rb: 'Imagery', icon: 'imagery', run: () => Settings.set('map.mode', 'imagery'), on: () => cfg('map.mode') === 'imagery' },
    'mode:topo': { t: 'Basemap: topographic (offline)', rb: 'Topographic', icon: 'terrain', run: () => Settings.set('map.mode', 'topo'), on: () => cfg('map.mode') === 'topo' },
    'src:esri': { t: 'Imagery source: Esri World Imagery', rb: 'Esri', check: true, run: () => Settings.set('map.imagerySource', 'esri'), on: () => cfg('map.imagerySource') === 'esri' },
    'src:eox': { t: 'Imagery source: Sentinel-2 cloudless (EOX)', rb: 'Sentinel-2', check: true, run: () => Settings.set('map.imagerySource', 'eox'), on: () => cfg('map.imagerySource') === 'eox' },
    'src:custom': { t: 'Imagery source: custom tile server', rb: 'Custom', check: true, run: () => Settings.set('map.imagerySource', 'custom'), on: () => cfg('map.imagerySource') === 'custom' },
    'src:none': { t: 'Imagery source: none (offline)', rb: 'None', check: true, run: () => Settings.set('map.imagerySource', 'none'), on: () => cfg('map.imagerySource') === 'none' },
    imgSettings: { t: 'Imagery settings…', rb: 'Settings', icon: 'gear', run: () => Settings.open('map') },
    explainImagery: { t: 'Explain the basemap data source', rb: 'Explain', icon: 'help', need, run: () => openExplain(basemapMode() === 'topo' ? (S.base === 'relief' ? 'hillshade' : S.base) : 'imagery') },
    hsSettings: { t: 'Hillshade and contour settings…', rb: 'Hillshade', icon: 'terrain', run: () => Settings.open('map') },
    snowTint: { t: 'High-altitude / snow tint (display only)', rb: 'Snow Tint', check: true, need, on: () => +cfg('map.snowLineM') > 0,
      run: () => Settings.set('map.snowLineM', +cfg('map.snowLineM') > 0 ? 0 : Math.round((S.stats.elevMin + 0.82 * S.stats.relief) / 50) * 50) },
    drainage: { t: 'Drainage, nullahs and ridgelines (flow accumulation)', rb: 'Drainage', icon: 'axis', need, run: () => openGP('sectorTerrain') },
    explainTerrain: { t: 'Explain the terrain symbology', rb: 'Explain Terrain', icon: 'help', need, run: () => openExplain(S.base === 'relief' ? 'hillshade' : S.base) },
    gridMgrs: { t: 'MGRS / UTM grid', rb: 'MGRS Grid', check: true, run: () => Settings.set('grid.mgrs', !cfg('grid.mgrs')), on: () => cfg('grid.mgrs') },
    gridGrat: { t: 'Lat / lon graticule', rb: 'Graticule', check: true, run: () => Settings.set('grid.graticule', !cfg('grid.graticule')), on: () => cfg('grid.graticule') },
    gridSec: { t: 'Secondary CRS grid', rb: 'Secondary Grid', check: true, run: () => Settings.set('grid.secondary', !cfg('grid.secondary')), on: () => cfg('grid.secondary') },
    contours: { t: 'Contours', rb: 'Contours', check: true, run: () => Settings.set('map.contours', !cfg('map.contours')), on: () => cfg('map.contours') },
    labels: { t: 'Labels', rb: 'Labels', check: true, run: () => Settings.set('sym.labels', !cfg('sym.labels')), on: () => cfg('sym.labels') },
    routeCard: { t: 'Route card (GSP Annex E)', rb: 'Route Card', icon: 'doc', need, run: () => { setDock(true); showDockTab('card'); } },
    doctrine: { t: 'Doctrine — GSP Mountain Warfare', rb: 'Doctrine', icon: 'doc', run: () => openHelp('doctrine') },
    swapAB: { t: 'Swap route start and end', rb: 'Swap A/B', icon: 'route', need, run: () => { pushUndo('Swap A/B'); [S.markers.a, S.markers.b] = [S.markers.b, S.markers.a]; [S.markerOrigin.a, S.markerOrigin.b] = [S.markerOrigin.b, S.markerOrigin.a]; renderAll(); refresh(); } },
    clearObstacles: { t: 'Delete digitised obstacles and tracks', rb: 'Delete All', icon: 'err', need, run: () => { pushUndo('Delete obstacles'); S.obstacles = []; S.tracks = []; safe(onObstaclesChanged)(); } },
    goto: { t: 'Go to XY (any reference)', k: 'Ctrl+G', need, run: () => { showRibbonTab('map'); $('gotoBox').focus(); } },
    palette: { t: 'Command search', k: 'Ctrl+K', run: () => openPalette() },
    help: { t: 'User guide', rb: 'User Guide', icon: 'help', k: 'F1', run: () => openHelp('guide') },
    shortcuts: { t: 'Keyboard shortcuts', rb: 'Shortcuts', icon: 'command', run: () => openHelp('keys') },
    about: { t: 'About MtnEye', rb: 'About', icon: 'help', run: () => openHelp('about') },
  };
  for (const [k, n] of Object.entries(BASE_NAMES)) CMD['terr:' + k] = { t: `Terrain symbology: ${n}`, rb: n.replace(/ \(.*\)$/, ''), check: true, need, run: () => setBase(k), on: () => S.base === k };
  const MARKER_TOOLS = [['own', 'Own position', 'Own Posn'], ['threat', 'Enemy position', 'Enemy'], ['target', 'Target area', 'Target'], ['a', 'Route start A', 'Start A'], ['b', 'Route end B', 'End B']];
  for (const [t, label, rb] of MARKER_TOOLS) CMD['tool:' + t] = { t: `Place ${label.toLowerCase()}`, rb, sym: t, need, run: () => setTool(t), on: () => S.tool === t };
  for (const [t, label, rb, icon, k] of [['measure', 'Measure distance & bearing', 'Measure', 'ruler', 'M'], ['los', 'Line of sight (interactive)', 'Line of Sight', 'los', 'L'], ['vs', 'Viewshed (interactive)', 'Viewshed', 'eye', 'V'],
    ['poly', 'Create No-Go area (polygon)', 'No-Go Area', 'nogo'], ['line', 'Create track / road (line)', 'Track', 'track'], ['aoi', 'Crop to area of interest', 'Crop to AOI', 'crop']]) {
    CMD['tool:' + t] = { t: label, rb, icon, k, need, run: () => setTool(t), on: () => S.tool === t };
  }
  for (const [id, tool] of Object.entries(GP.TOOLS)) {
    if (!CMD['gp:' + id]) CMD['gp:' + id] = { t: `${tool.name} (geoprocessing)`, rb: tool.name.replace(/ \(.*\)$/, '').replace(/^Suggest /, ''), icon: tool.icon, need: ['downloadDEM', 'convert'].includes(id) ? undefined : need, run: () => openGP(id) };
  }
  CMD['gp:sectorAll'].rb = 'Run All'; CMD['gp:sectorTerrain'].rb = 'Terrain Value'; CMD['gp:itgs'].rb = 'ITGs'; CMD['gp:deploy'].rb = 'Deployment';
  CMD['gp:fireCoverage'].rb = 'Fire Coverage'; CMD['gp:borderWatch'].rb = 'Border Watch'; CMD['gp:enemyApproaches'].rb = 'Approaches'; CMD['gp:infiltration'].rb = 'Infiltration'; CMD['gp:enemyOptions'].rb = 'Enemy Options';
  CMD['gp:route'].rb = 'Route A→B'; CMD['gp:picquets'].rb = 'Picquets'; CMD['gp:helipads'].rb = 'Helipads'; CMD['gp:fly'].rb = 'Fly Route'; CMD['gp:mobility'].rb = 'Go / No-Go'; CMD['gp:hostile'].rb = 'Enemy Obsn';
  CMD['gp:avenues'].rb = 'Avenues'; CMD['gp:posts'].rb = 'Posts / OPs'; CMD['gp:weapons'].rb = 'Weapon Sites'; CMD['gp:mfd'].rb = 'Minefields'; CMD['gp:convert'].rb = 'Convert Coords';
  CMD['gp:viewshed'].rb = 'Viewshed Tool'; CMD['gp:routeViewshed'].rb = 'Route Viewshed';
  CMD['tool:rvsline'] = { t: 'Draw a route for Route Viewshed', rb: 'Draw Route', icon: 'track', need, run: () => setTool('rvsline'), on: () => S.tool === 'rvsline' }; CMD['gp:los'].rb = 'LOS Tool';
  for (const sec of Settings.SCHEMA) CMD['settings:' + sec.id] = { t: `Settings — ${sec.title}`, run: () => Settings.open(sec.id) };
  const openGP = (id) => { GP.open(id); };
  const runCmd = (name, ev) => {
    const c = CMD[name];
    if (!c) { if (name.startsWith('gp:') && GP.TOOLS[name.slice(3)]) openGP(name.slice(3)); return; }
    if (c.need && !c.need()) { toast('Load an elevation model first (Map ▸ Add Data).', true); return; }
    closeMenus();
    if (c.menu) {
      const b = ev && ev.target.closest('[data-cmd]');
      const r = b ? b.getBoundingClientRect() : { left: window.innerWidth / 2, bottom: 120 };
      popupMenu(r.left, r.bottom, c.menu());
      return;
    }
    c.run();
  };

  // =================================================================== ribbon
  // Items: 'cmd' (small), '*cmd' (large), '|' column break for small buttons, {html} custom control.
  // MtnEye 1.3 ribbon — ArcGIS Pro organisation: Project · Map · Insert · Analysis · Edit · View · Imagery · Terrain · Symbology · Share · Help
  const RIBBON = [
    { id: 'project', name: 'Project', groups: [
      ['Project', ['*loadPlan', '*savePlan', 'renameProject', 'catalog']],
      ['Data', ['*addData', '*downloadDEM', 'demo']],
      ['Layout', ['*restoreLayout', 'ws:gis', 'ws:map', '|', 'ws:full']],
      ['Options', ['*settings', 'gpCRS', 'gpRefs']],
    ] },
    { id: 'map', name: 'Map', groups: [
      ['Navigate', ['*explore', 'fit', 'zoomIn', '|', 'zoomOut', 'toggleView', { html: '<div class="rb-goto"><label>Go To XY</label><input id="gotoBox" placeholder="MGRS · UTM · lat/lon · GARS" spellcheck="false" disabled></div>' }]],
      ['Layer', ['*basemap', 'attrTable', 'clearSel']],
      ['Inquiry', ['*tool:measure', 'tool:los', 'tool:vs', '|', 'gp:convert', '*explainCur']],
    ] },
    { id: 'insert', name: 'Insert', groups: [
      ['Situation', ['*tool:own', '*tool:threat', 'tool:target', 'tool:a', '|', 'tool:b']],
      ['Features', ['*tool:poly', '*tool:line', 'clearObstacles']],
      ['Sector geometry', ['*tool:sector', '*tool:border', 'clearSector']],
      ['Extent', ['*tool:aoi', 'fullExtent']],
    ] },
    { id: 'analysis', name: 'Analysis', groups: [
      ['Geoprocessing', ['*gpTools', 'results', 'history']],
      ['Terrain', ['*gp:keyTerrain', '*gp:mobility']],
      ['Visibility', ['gp:viewshed', 'gp:routeViewshed', '|', 'gp:los', 'gp:hostile', 'tool:rvsline']],
      ['Movement', ['*gp:route', 'gp:picquets', 'gp:helipads', '|', 'gp:fly', 'routeCard']],
      ['Model', ['*viewModel']],
      ['Siting', ['gp:avenues', 'gp:posts', '|', 'gp:weapons', 'gp:mfd']],
      ['Sector', ['*gp:sectorAll', 'gp:itgs', 'gp:deploy', '|', 'gp:enemyApproaches', 'gp:infiltration', '|', 'gp:enemyOptions', 'gp:fireCoverage', '|', 'gp:borderWatch']],
      ['Provenance', ['*routesPane', 'routeTable', 'routeReport']],
    ] },
    { id: 'edit', name: 'Edit', groups: [
      ['History', ['*undo', '*redo']],
      ['Create', ['*tool:poly', '*tool:line', 'swapAB']],
      ['Units', [{ html: `<div class="rb-field"><label>Own echelon</label><select id="rbEchelon">${['team', 'section', 'platoon', 'company', 'battalion', 'brigade'].map((e) => `<option value="${e}">${e[0].toUpperCase() + e.slice(1)}</option>`).join('')}</select></div>
        <div class="rb-field"><label>Enemy type</label><select id="rbThreat"><option value="foot">Infantry</option><option value="jeep">Wheeled / mech</option><option value="tracked">Armour</option><option value="mule">Animal transport</option><option value="truck">Trucks</option></select></div>` }]],
      ['Extent', ['*tool:aoi', 'fullExtent', 'reproject']],
      ['Delete', ['clearSel', 'clearObstacles']],
    ] },
    { id: 'view', name: 'View', groups: [
      ['Workspace', ['*ws:gis', '*ws:map', '*ws:full', 'restoreLayout']],
      ['Panes', ['toggleLeft', 'toggleRight', '|', 'toggleDock', 'compactRibbon']],
      ['Views', ['*view2d', '*view3d', '*viewModel']],
      ['Grids & labels', ['gridMgrs', 'gridGrat', '|', 'gridSec', 'labels']],
      ['Scene', [{ html: '<div class="rb-field"><label>Vertical exaggeration</label><input type="number" step="0.1" data-setting="v3.vex"></div><div class="rb-field"><label>Mesh</label><select data-setting="v3.mesh"></select></div>' }]],
      ['Appearance', ['*theme']],
    ] },
    { id: 'imagery', name: 'Imagery', groups: [
      ['Basemap', ['*mode:hybrid', '*mode:imagery', '*mode:topo']],
      ['Source', ['src:esri', 'src:eox', '|', 'src:custom', 'src:none']],
      ['Imagery', ['*reloadImagery', 'imgSettings', 'explainImagery']],
    ] },
    { id: 'terrain', name: 'Terrain', groups: [
      ['Symbology', ['terr:relief', 'terr:elevation', '|', 'terr:slope', 'terr:aspect', '|', 'terr:landform', 'terr:tri']],
      ['Relief', ['*hsSettings', 'contours', 'snowTint']],
      ['Analysis', ['*gp:keyTerrain', '*gp:mobility', '*drainage']],
      ['Explain', ['*explainTerrain']],
    ] },
    { id: 'symbology', name: 'Symbology', groups: [
      ['Unit frames', ['*conv:mtneye', '*conv:app6', '*symMatrix']],
      ['Display', ['symBigger', 'symSmaller', '|', 'labels', 'declutter', '|', 'symFilled']],
      ['Settings', ['*symSettings']],
    ] },
    { id: 'share', name: 'Share', groups: [
      ['Project', ['*loadPlan', '*savePlan']],
      ['Export', ['geojson', 'shapefile', '|', 'csv', 'raster', '|', 'png']],
      ['Reports', ['*report', '*secReport', '*routeReport']],
    ] },
    { id: 'help', name: 'Help', groups: [
      ['Help', ['*help', '*explainCur', '*docs', '*doctrine']],
      ['Support', ['shortcuts', 'about', '|', 'diagnostics']],
    ] },
  ];
  const rbIcon = (c, large) => (c.sym ? `<span class="rb-sym${large ? ' lg' : ''}" data-sym="${c.sym}"></span>` : c.check ? '<span class="rb-chk"></span>' : UI.icon(c.icon || 'command', large ? 21 : 15));
  const renderRibbon = () => {
    $('rbTabs').innerHTML = RIBBON.map((t) => `<button data-rbtab="${t.id}" class="${t.id === S.rbTab ? 'on' : ''}">${esc(t.name)}</button>`).join('') +
      '<span class="rb-tools"><button class="ghost-ic" data-cmd="compactRibbon" title="Compact ribbon (icons only)">▭</button><button class="rb-pin ghost-ic" id="rbPin" title="Collapse / pin the ribbon (double-click a tab)">⌃</button></span>';
    const tab = RIBBON.find((t) => t.id === S.rbTab) || RIBBON[0];
    $('rbBody').innerHTML = tab.groups.map(([gname, items]) => {
      let html = '', col = [];
      const flush = () => { if (col.length) html += `<div class="rb-col">${col.join('')}</div>`; col = []; };
      for (const it of items) {
        if (it === '|') { flush(); continue; }
        if (typeof it === 'object') { flush(); html += it.html; continue; }
        const large = it[0] === '*', name = large ? it.slice(1) : it, c = CMD[name];
        const btn = `<button class="${large ? 'rb-l' : 'rb-s'}${c.check ? ' chk' : ''}${c.menu ? ' dd' : ''}" data-cmd="${name}" title="${esc(c.t)}${c.k ? ` (${c.k})` : ''}">${rbIcon(c, large)}<span>${esc(c.rb || c.t)}</span></button>`;
        if (large) { flush(); html += btn; } else { col.push(btn); if (col.length === 2) flush(); }
      }
      flush();
      return `<div class="rb-group"><div class="rb-items">${html}</div><div class="rb-label">${esc(gname)}</div></div>`;
    }).join('');
    $('rbTabs').querySelectorAll('[data-rbtab]').forEach((b) => {
      b.addEventListener('click', () => { if (document.body.classList.contains('rb-min')) document.body.classList.add('rb-peek'); showRibbonTab(b.dataset.rbtab); });
      b.addEventListener('dblclick', () => { document.body.classList.toggle('rb-min'); document.body.classList.remove('rb-peek'); saveLayout(); map.resize(); });
    });
    $('rbPin').onclick = () => { document.body.classList.toggle('rb-min'); document.body.classList.remove('rb-peek'); saveLayout(); setTimeout(() => map.resize(), 0); };
    const gb = $('gotoBox');
    if (gb) {
      gb.disabled = !S.grid;
      gb.addEventListener('keydown', (e) => { if (e.key === 'Enter') gotoRef(e.target.value); if (e.key === 'Escape') e.target.blur(); });
      gb.addEventListener('input', () => gb.classList.remove('bad'));
    }
    if ($('rbThreat')) $('rbThreat').onchange = async (e) => { S.threatType = e.target.value; GP.set('avenues', 'threatType', e.target.value); S.avenues = null; clearOverlay('avenues'); await syncSettings(); renderAll(); refresh({ base: true }); };
    if ($('rbEchelon')) $('rbEchelon').onchange = (e) => { S.ownEchelon = e.target.value; renderAll(); refresh(); };
    UI.applyIcons($('rbBody'));
    bindSettingInputs();
    updateMarkerButtons(); updateEnabled(); updateRibbonState();
  };
  const showRibbonTab = (id) => { S.rbTab = id; renderRibbon(); saveLayout(); };
  const updateEnabled = () => {
    document.querySelectorAll('[data-cmd]').forEach((b) => { const c = CMD[b.dataset.cmd]; if (c && c.need && !b.matches('label')) b.disabled = !c.need(); });
    document.querySelectorAll('[data-need]').forEach((b) => (b.disabled = !S.grid));
    if ($('gotoBox')) $('gotoBox').disabled = !S.grid;
  };
  const updateRibbonState = () => {
    document.querySelectorAll('#ribbon [data-cmd], .qat [data-cmd]').forEach((b) => { const c = CMD[b.dataset.cmd]; if (c && c.on) b.classList.toggle('active', !!c.on()); });
  };

  // =================================================================== palette / help
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
    loadLayout();
    map = new UI.Map2D($('map2d'), app);
    map.onRender = updateScale;
    v3 = new UI.View3D($('gl3d'), $('ovl3d'), app);
    UI.app = { map, v3, S, engine, refresh, loadDemo, importFiles, setView, setTool, doExport, runCmd, weaponOf, profileOf, setWeaponField, setProfileField, pickPoint, showRightTab, openAttrTable, openLayerProps, findLayer, select, showMeasure, routeSources, renderAll, openExplain, openDocs, explainCurrent, requestImagery, selectRoute, selectVertex, setWorkspace, restoreLayout, hasCmd: (c) => !!CMD[c] || (c.startsWith('gp:') && !!GP.TOOLS[c.slice(3)]) };
    UI.applyIcons();
    map.resize();
    renderRibbon();
    initSplitters();
    GP.home();
    renderTOC(); updateStatusStatic(); renderSelection();
    updateProjectTitle(); updateUndoButtons(); updateWsButtons(); renderRouteTable(); renderResults();
    if (S.layoutMigrated) diag('info', 'A 1.2 layout was found; 1.3 starts with the new map-first layout (versioned key mtneye.layout.v13).');
    $('explainBody').innerHTML = '<p class="hint pad">Select a result, a layer (ⓘ in Contents) or a tool and press <b>Explain This</b> (E) to see what is displayed, the input data, method and formula, units, thresholds, assumptions, limitations and references.</p>';
    Settings.on((keys) => safe(onSettings)(keys));

    // command buttons anywhere
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (b && !b.disabled && !b.matches('label')) runCmd(b.dataset.cmd, e);
      if (document.body.classList.contains('rb-peek') && !e.target.closest('#ribbon')) document.body.classList.remove('rb-peek');
    });
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu') && !e.target.closest('[data-cmd]')) closeMenus(); });
    $('vtCRS').onclick = () => Settings.open('crs');
    document.querySelectorAll('[data-rtab]').forEach((b) => b.addEventListener('click', () => showRightTab(b.dataset.rtab)));
    $('logClear').onclick = () => { $('log').tBodies[0].innerHTML = ''; };
    $('cardCsv').onclick = exportRouteCard;
    renderRouteCard();
    document.querySelectorAll('.dock-tabs button').forEach((b) => b.addEventListener('click', () => { setDock(true); showDockTab(b.dataset.dock); }));
    $('dockToggle').onclick = () => setDock($('dock').classList.contains('collapsed'));
    $('attrFilter').addEventListener('input', renderAttrTable);
    $('attrLayer').addEventListener('change', renderAttrTable);
    $('tocFilter').addEventListener('input', renderTOC);
    new ResizeObserver(() => { if (!$('dock').classList.contains('collapsed') && S.drawerData && !document.querySelector('[data-dockpanel=profile]').hidden) UI.drawProfile($('chart'), S.drawerData); }).observe($('dock'));
    new ResizeObserver(() => { map.resize(); if (S.view === '3d') v3.resize(); }).observe($('stage'));

    // data
    for (const id of ['demFiles', 'demFiles3']) $(id).onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };
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

    // dialogs
    for (const id of ['settings', 'help', 'props', 'docs']) $(id).querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => $(id).close()));
    $('libSearch').addEventListener('input', () => { libSel = null; renderLibrary(); });
    $('srcChip').onclick = () => openExplain(basemapMode() === 'topo' ? (S.base === 'relief' ? 'hillshade' : S.base) : 'imagery');
    window.addEventListener('online', () => { if (S.grid && S.imagery.status === 'unavailable') requestImagery(); });
    // map context menu: explain / inspect what is under the cursor
    $('map2d').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!S.grid) return;
      const r0 = $('map2d').getBoundingClientRect(), x = e.clientX - r0.left, y = e.clientY - r0.top;
      const [c, r] = map.toCell(x, y);
      const ref = nearestSymbol(x, y) || (c >= -0.5 && r >= -0.5 && c <= S.grid.w - 0.5 && r <= S.grid.h - 0.5 ? { kind: 'point', c, r } : null);
      if (!ref) return;
      popupMenu(e.clientX, e.clientY, [
        { t: ref.kind === 'point' ? 'Explain this location…' : 'Explain this result…', icon: 'help', k: 'E', run: () => { select(ref, false, true); openExplain(UI.explainTopicForRef(ref), { ref }); } },
        { t: 'Inspect (Attributes)', icon: 'doc', run: () => select(ref, false, true) },
        { t: 'Copy grid reference', icon: 'copy', run: () => { const q = posOf(ref); if (q) copyText(F.listRef(q.r, q.c)); } },
        '-',
        { t: 'Centre map here', icon: 'fit', run: () => map.centerOn(c, r) },
        { t: 'Viewshed from here', icon: 'eye', run: () => { GP.set('viewshed', 'observer', { c: Math.round(c), r: Math.round(r) }); GP.open('viewshed'); GP.run('viewshed'); } },
      ]);
    });
    $('setSearch').addEventListener('input', () => Settings.render());
    $('setExport').onclick = () => UI.download('mtneye-settings.json', Settings.exportJSON(), 'application/json');
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
      const combos = { o: 'addData', s: 'savePlan', p: 'report', ',': 'settings', k: 'palette', g: 'goto', b: 'toggleLeft', j: 'toggleDock', t: 'attrTable', e: 'toggleRight', z: 'undo', y: 'redo' };
      if (ctrl && k === 'z' && e.shiftKey) { e.preventDefault(); runCmd('redo'); return; }
      if (ctrl && (k === 'z' || k === 'y') && e.target.matches('input, textarea')) return;
      if (ctrl && combos[k]) { e.preventDefault(); runCmd(combos[k]); return; }
      if (e.key === 'F1') { e.preventDefault(); runCmd(e.shiftKey ? 'docs' : 'help'); return; }
      if (e.target.matches('input, select, textarea') || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') { closeMenus(); if (v3._flying) v3.stopFly(); if (S.tool) setTool(null); else if (document.body.classList.contains('ws-expanded')) { document.body.classList.remove('ws-expanded', 'rb-min'); S.ws = 'default'; relayout(); } else if (document.body.classList.contains('focus-map') && !S.draft) toggleFocus(false); else if (S.draft) { S.draft = null; map.render(); v3.render(); } return; }
      if (S.draft && (S.draft.kind === 'poly' || S.draft.kind === 'line')) {
        if (e.key === 'Enter') { e.preventDefault(); finishDraft(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); S.draft.pts.pop(); redrawDraft(); return; }
      }
      const keys = { z: 'focusMap', x: 'ws:map', 2: 'view2d', 3: 'view3d', 4: 'viewModel', f: 'fit', m: 'tool:measure', l: 'tool:los', v: 'tool:vs', e: 'explainCur', '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', '/': 'palette' };
      if (!ctrl && keys[k] && (S.grid || k === '/')) { e.preventDefault(); runCmd(keys[k]); }
    });

    if (location.hash === '#demo' || cfg('ui.startup') === 'demo') loadDemo();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
