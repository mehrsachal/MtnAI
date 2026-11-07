/*
 * MtnAI ui — application controller (ArcGIS Pro-style shell): state, ribbon, Contents
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
    },
    markers: {}, obstacles: [], tracks: [],
    threatType: 'foot', ownEchelon: 'battalion',
    key: null, posts: null, weapons: [], mfd: null, avenues: null, routes: null, picquets: null, helipads: null, hostile: null, los: null, vsPoint: null, gotoMark: null,
    mobStats: {}, snowLine: 0, generalize: false,
    show: { symbols: true, labels: true, markers: true, obstacles: true, key: true, posts: true, weapons: true, mfd: true, routes: true, avenues: true, picquets: true, helipads: true, hostileOps: true },
    tool: null, draft: null, sel: null, view: '2d', baseCanvas: null, texCanvas: null, texDirty: true,
    sort: { col: 'type', desc: false }, tocSel: null, tocCollapsed: {},
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
  const run = async (label, cmd, args, summarize) => {
    busy(true, label);
    const entry = logStart(label);
    try {
      const res = await engine.call(cmd, args, progress);
      entry.done(summarize ? summarize(res) : '');
      return res;
    } catch (e) {
      entry.fail(e.message);
      throw e;
    } finally { busy(false); UI.jobSeq++; }
  };
  const safe = (fn) => (...a) => Promise.resolve().then(() => fn(...a)).catch((e) => { toast(e.message, true); console.debug('MtnAI:', e.message); });

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
      S.sources = opts.sources || null;
      if (opts.full) S.fullGrid = opts.full;
      Object.assign(S, { key: null, posts: null, weapons: [], mfd: null, avenues: null, routes: null, picquets: null, helipads: null, hostile: null, los: null, vsPoint: null, gotoMark: null, sel: null, mobStats: {}, draft: null });
      for (const o of Object.values(S.overlays)) { o.data = null; o.rgba = null; o.visible = false; }
      if (!opts.keepPlan) { S.markers = {}; S.obstacles = []; S.tracks = opts.tracks || []; }
      if (opts.markers) for (const k in opts.markers) S.markers[k] = snapLowSlope(opts.markers[k]);
      await recomputeHillshade(true);
      progress(0.9, 'Contours');
      S.contours = await engine.call('contours', { interval: +cfg('map.contourInterval'), majorEvery: +cfg('map.contourIndex') });
      await syncSettings();
      $('welcome').hidden = true;
      $('demName').textContent = `${meta.name} — ${meta.w} × ${meta.h} cells @ ${meta.cs} m`;
      updateEnabled();
      composeBase();
      map.fit();
      if (v3.ok) { v3.setTerrain(S.grid, S.L.z); v3.setExaggeration(+cfg('v3.vex')); updateTexture(true); }
      renderAll();
      entry.done(`${meta.w}×${meta.h} @ ${meta.cs} m · ${F.analysisCRSName()} · ${F.elev(res.stats.elevMin)}–${F.elev(res.stats.elevMax)}`);
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
        await loadGrid(syn.grid, { markers: syn.markers, full: syn.grid, tracks: syn.tracks });
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
    }
    return o.rgba;
  };
  const OVERLAY_ORDER = ['mobility', 'hostile', 'avenues', 'cover', 'wcover', 'dead', 'viewshed'];
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
    for (const id of OVERLAY_ORDER) {
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

  /** The layer model behind the Contents pane, attribute table and context menu. */
  const tocModel = () => {
    if (!S.grid) return [];
    const mk = S.markers;
    const feat = [];
    const nMk = Object.keys(mk).filter((k) => mk[k]).length;
    if (nMk) feat.push(Object.assign({ id: 'markers', name: 'Situation', count: nMk, table: true, legend: swatches([[symSw(UI.SYM.own(S.ownEchelon)), 'Own position'], [symSw(UI.SYM.threat(S.threatType)), 'Enemy'], [symSw(UI.SYM.target()), 'Target area'], [symSw(UI.SYM.sp(), 12), 'Route start (SP) / end (RP)']]),
      remove: () => { S.markers = {}; safe(syncSettings)(); } }, showFlag('markers')));
    if (S.obstacles.length || S.tracks.length) feat.push(Object.assign({ id: 'obstacles', name: 'Obstacles & tracks', count: S.obstacles.length + S.tracks.length,
      legend: swatches([[polySw('rgba(217,58,50,0.35)', '#ff5b4f'), `No-Go areas (${S.obstacles.length})`], [lineSw('#c8955c', true), `Tracks (${S.tracks.length})`]]),
      remove: () => { S.obstacles = []; S.tracks = []; safe(onObstaclesChanged)(); } }, showFlag('obstacles')));
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

    const ras = OVERLAY_ORDER.slice().reverse().filter((id) => S.overlays[id].data).map((id) => {
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
    const base = [{ id: 'dem', name: S.grid.name, sub: BASE_NAMES[S.base], legend: rasterLegend(S.base, baseInfo()), raster: true, isBase: true,
      visible: () => true, setVisible: () => {}, settings: 'map' }];
    return [
      { id: 'grpFeat', name: 'Situation & plan', layers: feat },
      { id: 'grpRas', name: 'Analysis rasters', layers: ras },
      { id: 'grpGrid', name: 'Map grids & annotation', layers: grids },
      { id: 'grpBase', name: 'Elevation', layers: base },
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
          const lc = !!S.tocCollapsed[l.id];
          return `<div class="toc-l${S.tocSel === l.id ? ' sel' : ''}${l.visible() ? '' : ' off'}" data-layer="${esc(l.id)}">
            <div class="toc-lh"><span class="tw" data-tw="${esc(l.id)}">${l.legend ? (lc ? '▸' : '▾') : ''}</span><input type="checkbox" data-vis="${esc(l.id)}" ${l.visible() ? 'checked' : ''} ${l.isBase || l.id === 'los' ? 'disabled' : ''}>
            <span class="toc-n" title="${esc(l.name)}">${esc(l.name)}</span>${l.count !== undefined ? `<i class="toc-c">${l.count}</i>` : ''}</div>
            ${l.sub ? `<div class="toc-sub">${esc(l.sub)}</div>` : ''}${l.legend && !lc ? `<div class="toc-lg">${l.legend}</div>` : ''}</div>`;
        }).join('')}</div>`;
    }).join('');
    el.querySelectorAll('[data-grp]').forEach((h) => h.addEventListener('click', () => { S.tocCollapsed[h.dataset.grp] = !S.tocCollapsed[h.dataset.grp]; renderTOC(); }));
    el.querySelectorAll('[data-tw]').forEach((h) => h.addEventListener('click', (e) => { e.stopPropagation(); S.tocCollapsed[h.dataset.tw] = !S.tocCollapsed[h.dataset.tw]; renderTOC(); }));
    el.querySelectorAll('[data-vis]').forEach((cb) => cb.addEventListener('change', (e) => { e.stopPropagation(); const l = findLayer(cb.dataset.vis); if (l) l.setVisible(cb.checked); renderTOC(); }));
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
    m.innerHTML = items.map((it, k) => (it === '-' ? '<div class="sep"></div>'
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
    if (l.isBase) items.push('-', ...Object.entries(BASE_NAMES).map(([k, n]) => ({ t: n, checked: S.base === k, run: () => setBase(k) })));
    items.push('-');
    if (l.remove) items.push({ t: 'Remove', icon: 'minus', run: () => { l.remove(); if (S.tocSel === id) S.tocSel = null; S.sel = null; renderAll(); refresh({ base: true }); } });
    if (l.settings) items.push({ t: 'Symbology settings…', icon: 'gear', run: () => Settings.open(l.settings) });
    items.push({ t: 'Properties…', icon: 'doc', run: () => openLayerProps(id) });
    popupMenu(x, y, items);
  };
  const setBase = (k) => { S.base = k; Settings.set('map.base', k); };

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
        if (id === 'ovl:mobility' && o.info) rows.push(['Movement class', o.info.name], ['GO / SLOW-GO limits', `≤ ${o.info.go}° / ≤ ${o.info.slow}°`]);
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
    S.draft = tool && ['poly', 'line', 'los', 'measure', 'aoi'].includes(tool) ? { kind: tool, pts: [] } : null;
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
    if (d.kind === 'poly' && pts.length >= 3) S.obstacles.push(pts);
    else if (d.kind === 'line' && pts.length >= 2) S.tracks.push(pts);
    else { toast('Not enough vertices.', true); setTool(null); return; }
    setTool(null);
    safe(onObstaclesChanged)();
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
    S.markers[k] = cell;
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
      const ref = nearestSymbol(ev.x, ev.y);
      if (ref) { select(ref, false, true); return; }
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
    if (tool === 'poly' || tool === 'line') { S.draft.pts.push([c, r]); redrawDraft(); return; }
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
    S.snowLine = +v.snowLine || 0; S.generalize = !!v.generalize;
    await syncSettings();
    const res = await run(`Go / No-Go — ${M.MOVEMENT_PROFILES[id].name}`, 'mobility', { profile: id },
      (r) => `GO ${pct(r.stats.go)} · SLOW ${pct(r.stats.slow)} · NO-GO ${pct(r.stats.nogo)}`);
    S.mobStats[id] = res.stats;
    S.overlays.mobility.profile = id;
    setOverlay('mobility', res.cls, Object.assign({ name: res.profile.name }, res.profile));
    renderAll(); refresh({ base: true });
    const s = res.stats, area = S.stats.areaKm2;
    if (!quiet) toast(`${res.profile.name}: ${pct(s.go)} GO, ${pct(s.slow)} SLOW-GO, ${pct(s.nogo)} NO-GO.`);
    return `${res.profile.name} (GO ≤ ${res.profile.go}°, SLOW-GO ≤ ${res.profile.slow}°)\nGO ${pct(s.go)} · ${F.area(s.go * area)}\nSLOW-GO ${pct(s.slow)} · ${F.area(s.slow * area)}\nNO-GO ${pct(s.nogo)} · ${F.area(s.nogo * area)}`;
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
    S.avenues = { routes: res.routes };
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
    const opts = Object.assign({}, v, { profile: v.profile === 'auto' ? undefined : v.profile, cover });
    const res = await run(`Minefields — ${v.type}`, 'minefields', opts, (r) => r.fields.map((f) => `${f.id} gap ${F.dist(f.gapM)} · ≈${f.estMines} mines`).join('\n'));
    S.mfd = res;
    if (!S.avenues) S.avenues = { routes: res.avenues };
    renderAll(); refresh();
    return `${res.fields.length} ${v.type} minefields${cover ? '' : ' (no posts / weapons sited yet — observation not assessed)'}\n` +
      refLines(res.fields, (f) => `gap ${F.dist(f.gapM)} · ${F.dist(f.frontM)} × ${F.dist(f.depthM)} · ≈${f.estMines} mines${f.covered ? '' : ' · NOT observed'}`);
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
    const mk = { own: ['Own position', UI.SYM.own(S.ownEchelon)], threat: ['Enemy', UI.SYM.threat(S.threatType)], target: ['Target area', UI.SYM.target()], a: ['Route start (SP)', UI.SYM.sp()], b: ['Route end (RP)', UI.SYM.rp()] };
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
        rows.push(['Obstacle', null], ['Gap at defile', F.dist(p.gapM)], ['Front × depth', `${F.dist(p.frontM)} × ${F.dist(p.depthM)}`], ['Orientation', F.bearing(p.orientationDeg, p.r, p.c)],
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
      default: title = ref.kind;
    }
    el.innerHTML = `<div class="sel-head">${icon}<div><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div></div>
      <table class="pgrid">${pgrid(rows.concat(positionRows(p.r, p.c)))}</table>
      <div class="sel-actions"><button class="btn sm" data-act="copy">Copy reference</button><button class="btn sm" data-act="zoom">Zoom to</button><button class="btn sm" data-act="vs">Viewshed from here</button></div>`;
    el.querySelector('[data-act=copy]').onclick = () => copyText(F.listRef(p.r, p.c));
    el.querySelector('[data-act=zoom]').onclick = () => (S.view === '3d' ? v3.lookAtCell(p.c, p.r, 3500) : map.centerOn(p.c, p.r, Math.max(map.view.scale, 3)));
    el.querySelector('[data-act=vs]').onclick = () => { GP.set('viewshed', 'observer', { c: Math.round(p.c), r: Math.round(p.r) }); GP.open('viewshed'); GP.run('viewshed'); };
  };

  // =================================================================== attribute table
  const attrRows = () => {
    const rows = [];
    const add = (layer, sym, type, id, p, detail, ref, z) => rows.push({ layer, sym, type, id, r: p.r, c: p.c, z: z ?? M.sample(S.grid, S.L.z, p.r, p.c), detail, ref });
    const mk = S.markers;
    if (mk.own) add('markers', UI.SYM.own(S.ownEchelon), 'Own position', 'OWN', mk.own, S.ownEchelon, { kind: 'marker', idx: 'own' });
    if (mk.threat) add('markers', UI.SYM.threat(S.threatType), 'Enemy', 'ENY', mk.threat, M.MOVEMENT_PROFILES[S.threatType].name, { kind: 'marker', idx: 'threat' });
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
    if (S.mfd) S.mfd.fields.forEach((f, k) => add('mfd', UI.SYM.mine(f.type), `Minefield ${f.type}`, f.id, f, `gap ${F.dist(f.gapM)} · front ${F.dist(f.frontM)} · ≈${f.estMines} mines`, { kind: 'mfd', idx: k }, f.z));
    if (S.avenues) S.avenues.routes.forEach((rt, k) => add('avenues', null, 'Enemy avenue', `AA${k + 1}`, { c: rt.line[0][0], r: rt.line[0][1] }, `${F.dist(rt.lengthM)} · ${F.time(rt.timeH)}`, { kind: 'avenue', idx: k }));
    if (S.routes) {
      S.routes.routes.forEach((rt, k) => add('routes', null, 'Route', `R${k + 1}`, { c: rt.line[0][0], r: rt.line[0][1] }, `${F.dist(rt.lengthM)} · ${F.time(rt.timeH)} · GSP ${rt.gspDay ? gspRange(S.routes.night ? rt.gspNight : rt.gspDay) : '—'} · ↑${F.height(rt.ascentM)}`, { kind: 'route', idx: k }));
      S.routes.routes[S.routes.sel || 0].checkpoints.forEach((cp, k) => add('routes', UI.SYM.cp(k + 1), 'Checkpoint', `CKP ${k + 1}`, cp, `km ${(cp.d / 1000).toFixed(1)}`, { kind: 'cp', idx: k }));
    }
    if (S.helipads) S.helipads.pads.forEach((p, k) => add('helipads', null, 'Helipad (HLS)', p.id, p, `${p.use} · ${p.meanSlopeDeg.toFixed(1)}° · ${p.hidden ? 'hidden' : 'seen'}`, { kind: 'hls', idx: k }, p.z));
    if (S.picquets) S.picquets.picquets.forEach((p, k) => add('picquets', UI.SYM.picquet(), 'Picquet', p.id, p, `km ${p.routeFromKm === null ? '—' : p.routeFromKm.toFixed(1) + '–' + p.routeToKm.toFixed(1)} · climb ${F.time(p.climbH)}`, { kind: 'picquet', idx: k }, p.z));
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
    document.querySelectorAll('[data-dockpanel]').forEach((p) => (p.hidden = p.dataset.dockpanel !== tab));
    document.querySelector('[data-dockpanel-tools]').hidden = tab !== 'table';
    if (tab === 'card') renderRouteCard();
    if (tab === 'profile' && S.drawerData) UI.drawProfile($('chart'), S.drawerData);
  };
  const setDock = (open) => { $('dock').classList.toggle('collapsed', !open); $('dockToggle').textContent = open ? '▾' : '▴'; saveLayout(); updateRibbonState(); };
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

  // =================================================================== panes & layout
  const showRightTab = (tab) => {
    document.querySelectorAll('[data-rtab]').forEach((b) => b.classList.toggle('on', b.dataset.rtab === tab));
    document.querySelectorAll('[data-rpanel]').forEach((p) => (p.hidden = p.dataset.rpanel !== tab));
    if ($('app').classList.contains('no-right')) { $('app').classList.remove('no-right'); saveLayout(); map.resize(); }
    if (tab === 'gp' && !GP.current() && !$('gpPane').innerHTML) GP.home();
  };
  const LAYOUT_KEY = 'mtnai.layout.v2';
  const saveLayout = () => {
    try {
      const st = document.documentElement.style;
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({
        left: st.getPropertyValue('--left-w'), right: st.getPropertyValue('--right-w'), dock: st.getPropertyValue('--dock-h'),
        noLeft: $('app').classList.contains('no-left'), noRight: $('app').classList.contains('no-right'), dockClosed: $('dock').classList.contains('collapsed'),
        rbMin: document.body.classList.contains('rb-min'), rbTab: S.rbTab,
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
    document.body.classList.toggle('rb-min', !!l.rbMin);
    S.rbTab = l.rbTab || 'map';
  };
  const initSplitters = () => {
    document.querySelectorAll('.splitter').forEach((sp) => sp.addEventListener('mousedown', (e) => {
      e.preventDefault();
      sp.classList.add('drag');
      const kind = sp.dataset.split;
      const st = document.documentElement.style;
      const move = (ev) => {
        if (kind === 'left') st.setProperty('--left-w', `${Math.max(200, Math.min(560, ev.clientX - $('app').getBoundingClientRect().left))}px`);
        else if (kind === 'right') st.setProperty('--right-w', `${Math.max(260, Math.min(640, window.innerWidth - ev.clientX))}px`);
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
  const togglePane = (cls) => { $('app').classList.toggle(cls); saveLayout(); updateRibbonState(); setTimeout(() => { map.resize(); if (S.view === '3d') v3.resize(); }, 0); };

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
    refresh({ base: ['base', 'hs', 'contours', 'ovl', 'sym', 'reanalyse'].some((t) => tags.has(t)) || keys.includes('map.base') });
    renderAll();
    if (S.view === '3d') updateTexture(true);
  };

  // =================================================================== view switching
  const setView = (v) => {
    if (v === '3d' && !v3.ok) { toast('WebGL2 is not available — Scene view disabled.', true); return; }
    if (!S.grid && v === '3d') return;
    S.view = v;
    $('vtMap').classList.toggle('on', v === '2d'); $('vtScene').classList.toggle('on', v === '3d');
    $('map2d').hidden = v !== '2d'; $('gl3d').hidden = v !== '3d'; $('ovl3d').hidden = v !== '3d';
    v3.visible = v === '3d';
    if (v === '3d') { v3.resize(); if (S.texDirty) updateTexture(true); v3.render(); } else { v3.stopFly(); map.resize(); }
    updateScale(); updateRibbonState();
  };

  // =================================================================== plan save / load
  const savePlanObject = () => {
    if (!S.grid) return null;
    const strip = (o, keys) => { if (!o) return null; const c = Object.assign({}, o); for (const k of keys) delete c[k]; return c; };
    return {
      format: 'mtnai-plan', version: M.VERSION, created: new Date().toISOString(), grid: M.gridMeta(S.grid),
      markers: S.markers, obstacles: S.obstacles, tracks: S.tracks, threatType: S.threatType, ownEchelon: S.ownEchelon, snowLine: S.snowLine,
      key: S.key, posts: strip(S.posts, ['cover', 'dead']), weapons: S.weapons.map((w) => strip(w, ['cover'])),
      mfd: S.mfd, avenues: S.avenues, helipads: S.helipads, routes: S.routes && Object.assign({}, S.routes, { routes: S.routes.routes.map((r) => strip(r, ['path', 'profile'])) }), picquets: S.picquets,
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
    else if (kind === 'png') {
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
  };
  const updateMarkerButtons = () => {
    const syms = { own: UI.SYM.own(S.ownEchelon), threat: UI.SYM.threat(S.threatType), target: UI.SYM.target(), a: UI.SYM.sp(), b: UI.SYM.rp() };
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
    basemap: { t: 'Basemap / elevation symbology', rb: 'Basemap', icon: 'layers', need, menu: () => Object.entries(BASE_NAMES).map(([k, n]) => ({ t: n, checked: S.base === k, run: () => setBase(k) })) },
    clearSel: { t: 'Clear selection', rb: 'Clear', icon: 'err', need, run: () => { S.sel = null; S.gotoMark = null; S.draft = null; renderAll(); refresh(); } },
    attrTable: { t: 'Attribute table', rb: 'Attribute Table', icon: 'log', k: 'Ctrl+T', need, run: () => openAttrTable(S.tocSel && findLayer(S.tocSel) && findLayer(S.tocSel).table ? S.tocSel : '') },
    fullExtent: { t: 'Full extent of DEM (undo crop)', rb: 'Full DEM', icon: 'fit', need, run: safe(resetAOI) },
    reproject: { t: 'Re-analyse terrain (apply projection / scale settings)', rb: 'Re-analyse', icon: 'terrain', need, run: safe(() => reloadTerrain('manual')) },
    loadPlan: { t: 'Open plan…', rb: 'Open Plan', icon: 'open', need, run: () => $('planFile').click() },
    savePlan: { t: 'Save plan', rb: 'Save Plan', icon: 'save', k: 'Ctrl+S', need, run: () => doExport('plan') },
    geojson: { t: 'Export features — GeoJSON', rb: 'GeoJSON', icon: 'download', need, run: () => doExport('geojson') },
    csv: { t: 'Export attribute table — CSV', rb: 'Table (CSV)', icon: 'download', need, run: () => doExport('csv') },
    raster: { t: 'Export raster — GeoTIFF / ASCII grid…', rb: 'Raster', icon: 'download', need, run: () => openGP('exportRaster') },
    png: { t: 'Export view — PNG', rb: 'View (PNG)', icon: 'download', need, run: () => doExport('png') },
    report: { t: 'Terrain assessment report', rb: 'Report', icon: 'doc', k: 'Ctrl+P', need, run: () => doExport('report') },
    settings: { t: 'Settings…', rb: 'Settings', icon: 'gear', k: 'Ctrl+,', run: () => Settings.open() },
    gpCRS: { t: 'Coordinate systems…', rb: 'Coordinate Systems', icon: 'target', run: () => Settings.open('crs') },
    gpRefs: { t: 'Grid reference formats…', rb: 'Grid Refs', icon: 'target', run: () => Settings.open('refs') },
    view2d: { t: 'Map view (2D)', rb: 'Map', icon: 'data', k: '2', run: () => setView('2d'), on: () => S.view === '2d' },
    view3d: { t: 'Scene view (3D)', rb: 'Scene', icon: 'terrain', k: '3', need, run: () => setView('3d'), on: () => S.view === '3d' },
    toggleLeft: { t: 'Contents pane', rb: 'Contents', icon: 'layers', k: 'Ctrl+B', run: () => togglePane('no-left'), on: () => !$('app').classList.contains('no-left') },
    toggleRight: { t: 'Geoprocessing / Attributes pane', rb: 'Side Pane', icon: 'panel', run: () => togglePane('no-right'), on: () => !$('app').classList.contains('no-right') },
    toggleDock: { t: 'Attribute table / profile dock', rb: 'Table Dock', icon: 'log', k: 'Ctrl+J', run: () => setDock($('dock').classList.contains('collapsed')), on: () => !$('dock').classList.contains('collapsed') },
    gpTools: { t: 'Geoprocessing — toolboxes', rb: 'Tools', icon: 'tools', run: () => { GP.home(); showRightTab('gp'); } },
    history: { t: 'Geoprocessing history', rb: 'History', icon: 'log', run: () => showRightTab('hist') },
    gridMgrs: { t: 'MGRS / UTM grid', rb: 'MGRS Grid', check: true, run: () => Settings.set('grid.mgrs', !cfg('grid.mgrs')), on: () => cfg('grid.mgrs') },
    gridGrat: { t: 'Lat / lon graticule', rb: 'Graticule', check: true, run: () => Settings.set('grid.graticule', !cfg('grid.graticule')), on: () => cfg('grid.graticule') },
    gridSec: { t: 'Secondary CRS grid', rb: 'Secondary Grid', check: true, run: () => Settings.set('grid.secondary', !cfg('grid.secondary')), on: () => cfg('grid.secondary') },
    contours: { t: 'Contours', rb: 'Contours', check: true, run: () => Settings.set('map.contours', !cfg('map.contours')), on: () => cfg('map.contours') },
    labels: { t: 'Labels', rb: 'Labels', check: true, run: () => Settings.set('sym.labels', !cfg('sym.labels')), on: () => cfg('sym.labels') },
    theme: { t: 'Theme', rb: 'Theme', icon: 'panel', menu: () => [['dark', 'Dark'], ['light', 'Light'], ['contrast', 'High contrast'], ['night', 'Night (red)']].map(([k, n]) => ({ t: n, checked: cfg('ui.theme') === k, run: () => Settings.set('ui.theme', k) })) },
    routeCard: { t: 'Route card (GSP Annex E)', rb: 'Route Card', icon: 'doc', need, run: () => { setDock(true); showDockTab('card'); } },
    doctrine: { t: 'Doctrine — GSP Mountain Warfare', rb: 'Doctrine', icon: 'doc', run: () => openHelp('doctrine') },
    swapAB: { t: 'Swap route start and end', rb: 'Swap A/B', icon: 'route', need, run: () => { [S.markers.a, S.markers.b] = [S.markers.b, S.markers.a]; renderAll(); refresh(); } },
    clearObstacles: { t: 'Delete digitised obstacles and tracks', rb: 'Delete All', icon: 'err', need, run: () => { S.obstacles = []; S.tracks = []; safe(onObstaclesChanged)(); } },
    goto: { t: 'Go to XY (any reference)', k: 'Ctrl+G', need, run: () => { showRibbonTab('map'); $('gotoBox').focus(); } },
    palette: { t: 'Command search', k: 'Ctrl+K', run: () => openPalette() },
    help: { t: 'User guide', rb: 'User Guide', icon: 'help', k: 'F1', run: () => openHelp('guide') },
    shortcuts: { t: 'Keyboard shortcuts', rb: 'Shortcuts', icon: 'command', run: () => openHelp('keys') },
    about: { t: 'About MtnAI', rb: 'About', icon: 'help', run: () => openHelp('about') },
  };
  const MARKER_TOOLS = [['own', 'Own position', 'Own Posn'], ['threat', 'Enemy position', 'Enemy'], ['target', 'Target area', 'Target'], ['a', 'Route start A', 'Start A'], ['b', 'Route end B', 'End B']];
  for (const [t, label, rb] of MARKER_TOOLS) CMD['tool:' + t] = { t: `Place ${label.toLowerCase()}`, rb, sym: t, need, run: () => setTool(t), on: () => S.tool === t };
  for (const [t, label, rb, icon, k] of [['measure', 'Measure distance & bearing', 'Measure', 'ruler', 'M'], ['los', 'Line of sight (interactive)', 'Line of Sight', 'los', 'L'], ['vs', 'Viewshed (interactive)', 'Viewshed', 'eye', 'V'],
    ['poly', 'Create No-Go area (polygon)', 'No-Go Area', 'nogo'], ['line', 'Create track / road (line)', 'Track', 'track'], ['aoi', 'Crop to area of interest', 'Crop to AOI', 'crop']]) {
    CMD['tool:' + t] = { t: label, rb, icon, k, need, run: () => setTool(t), on: () => S.tool === t };
  }
  for (const [id, tool] of Object.entries(GP.TOOLS)) {
    if (!CMD['gp:' + id]) CMD['gp:' + id] = { t: `${tool.name} (geoprocessing)`, rb: tool.name.replace(/ \(.*\)$/, '').replace(/^Suggest /, ''), icon: tool.icon, need: ['downloadDEM', 'convert'].includes(id) ? undefined : need, run: () => openGP(id) };
  }
  CMD['gp:route'].rb = 'Route A→B'; CMD['gp:picquets'].rb = 'Picquets'; CMD['gp:helipads'].rb = 'Helipads'; CMD['gp:fly'].rb = 'Fly Route'; CMD['gp:mobility'].rb = 'Go / No-Go'; CMD['gp:hostile'].rb = 'Enemy Obsn';
  CMD['gp:avenues'].rb = 'Avenues'; CMD['gp:posts'].rb = 'Posts / OPs'; CMD['gp:weapons'].rb = 'Weapon Sites'; CMD['gp:mfd'].rb = 'Minefields'; CMD['gp:convert'].rb = 'Convert Coords';
  CMD['gp:viewshed'].rb = 'Viewshed Tool'; CMD['gp:los'].rb = 'LOS Tool';
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
  const RIBBON = [
    { id: 'map', name: 'Map', groups: [
      ['Navigate', ['*explore', 'fit', 'zoomIn', 'zoomOut', '|', { html: '<div class="rb-goto"><label>Go To XY</label><input id="gotoBox" placeholder="MGRS · UTM · lat/lon · GARS" spellcheck="false" disabled></div>' }]],
      ['Layer', ['*addData', '*downloadDEM', 'demo', 'attrTable']],
      ['Basemap', ['*basemap']],
      ['Selection', ['clearSel']],
      ['Inquiry', ['*tool:measure', 'tool:los', 'tool:vs', 'gp:convert']],
      ['Situation', ['*tool:own', '*tool:threat', 'tool:target', 'tool:a', 'tool:b']],
    ] },
    { id: 'analysis', name: 'Analysis', groups: [
      ['Geoprocessing', ['*gpTools', '*history']],
      ['Terrain', ['*gp:keyTerrain', '*gp:mobility']],
      ['Visibility', ['gp:viewshed', 'gp:los', 'gp:hostile']],
      ['Tactical Siting', ['*gp:avenues', '*gp:posts', '*gp:weapons', '*gp:mfd']],
      ['Routing & Movement', ['*gp:route', 'gp:picquets', 'gp:helipads', '|', 'gp:fly', 'swapAB', 'routeCard']],
    ] },
    { id: 'edit', name: 'Edit', groups: [
      ['Create', ['*tool:poly', '*tool:line', 'clearObstacles']],
      ['Situation', ['*tool:own', '*tool:threat', 'tool:target', 'tool:a', 'tool:b', '|', { html: `<div class="rb-field"><label>Own echelon</label><select id="rbEchelon">${['team', 'section', 'platoon', 'company', 'battalion', 'brigade'].map((e) => `<option value="${e}">${e[0].toUpperCase() + e.slice(1)}</option>`).join('')}</select></div>
        <div class="rb-field"><label>Enemy type</label><select id="rbThreat"><option value="foot">Infantry</option><option value="jeep">Wheeled / mech</option><option value="tracked">Armour</option><option value="mule">Animal transport</option><option value="truck">Trucks</option></select></div>` }]],
      ['Extent', ['*tool:aoi', 'fullExtent', 'reproject']],
    ] },
    { id: 'view', name: 'View', groups: [
      ['Views', ['*view2d', '*view3d']],
      ['Windows', ['toggleLeft', 'toggleRight', 'toggleDock']],
      ['Grids & Labels', ['gridMgrs', 'gridGrat', 'gridSec', '|', 'contours', 'labels']],
      ['Scene', [{ html: '<div class="rb-field"><label>Vertical exaggeration</label><input type="number" step="0.1" data-setting="v3.vex"></div><div class="rb-field"><label>Mesh</label><select data-setting="v3.mesh"></select></div>' }]],
      ['Appearance', ['*theme']],
    ] },
    { id: 'share', name: 'Share', groups: [
      ['Project', ['*loadPlan', '*savePlan']],
      ['Export', ['geojson', 'csv', 'raster', '|', 'png']],
      ['Output', ['*report']],
    ] },
    { id: 'settings', name: 'Settings', groups: [
      ['Spatial Reference', ['*gpCRS', '*gpRefs']],
      ['Options', ['*settings']],
    ] },
    { id: 'help', name: 'Help', groups: [
      ['Help', ['*help', '*doctrine', '*shortcuts', 'about']],
    ] },
  ];
  const rbIcon = (c, large) => (c.sym ? `<span class="rb-sym${large ? ' lg' : ''}" data-sym="${c.sym}"></span>` : c.check ? '<span class="rb-chk"></span>' : UI.icon(c.icon || 'command', large ? 24 : 15));
  const renderRibbon = () => {
    $('rbTabs').innerHTML = RIBBON.map((t) => `<button data-rbtab="${t.id}" class="${t.id === S.rbTab ? 'on' : ''}">${esc(t.name)}</button>`).join('') +
      '<button class="rb-pin ghost-ic" id="rbPin" title="Collapse / pin the ribbon (double-click a tab)">⌃</button>';
    const tab = RIBBON.find((t) => t.id === S.rbTab) || RIBBON[0];
    $('rbBody').innerHTML = tab.groups.map(([gname, items]) => {
      let html = '', col = [];
      const flush = () => { if (col.length) html += `<div class="rb-col">${col.join('')}</div>`; col = []; };
      for (const it of items) {
        if (it === '|') { flush(); continue; }
        if (typeof it === 'object') { flush(); html += it.html; continue; }
        const large = it[0] === '*', name = large ? it.slice(1) : it, c = CMD[name];
        const btn = `<button class="${large ? 'rb-l' : 'rb-s'}${c.check ? ' chk' : ''}${c.menu ? ' dd' : ''}" data-cmd="${name}" title="${esc(c.t)}${c.k ? ` (${c.k})` : ''}">${rbIcon(c, large)}<span>${esc(c.rb || c.t)}</span></button>`;
        if (large) { flush(); html += btn; } else { col.push(btn); if (col.length === 3) flush(); }
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
    UI.app = { map, v3, S, engine, loadDemo, importFiles, setView, setTool, doExport, runCmd, weaponOf, profileOf, setWeaponField, setProfileField, pickPoint, showRightTab, openAttrTable, openLayerProps, findLayer, select, showMeasure };
    UI.applyIcons();
    map.resize();
    renderRibbon();
    initSplitters();
    GP.home();
    renderTOC(); updateStatusStatic(); renderSelection();
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
    for (const id of ['settings', 'help', 'props']) $(id).querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => $(id).close()));
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
      const combos = { o: 'addData', s: 'savePlan', p: 'report', ',': 'settings', k: 'palette', g: 'goto', b: 'toggleLeft', j: 'toggleDock', t: 'attrTable' };
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
