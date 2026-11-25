/*
 * MtnEye core — ModelBuilder: a toolbox of single-purpose geoprocessing tools (Slope,
 * Reclassify, Raster Calculator, Viewshed, Path Distance, Cost Path, ...) and an executor
 * that runs a model — a graph of data / value variables and tools — in dependency order.
 *
 * Data types: raster { a: typed array, kind: 'continuous'|'class'|'count', unit, classes? }
 * (NaN = NoData); points [{ r, c, label }]; lines [{ line: [[c, r]...], label, attrs }];
 * table { cols, rows }; plus plain values (number, string, select, point {r, c}, line [[c, r]]).
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function model(M) {
  'use strict';

  const MOVES = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1],
    [-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]]) MOVES.push({ dr, dc, len: Math.hypot(dr, dc) });

  const raster = (a, kind, unit, extra) => Object.assign({ dt: 'raster', a, kind, unit: unit || '' }, extra || {});
  const asPoints = (v) => {
    if (!v) return [];
    if (v.dt === 'points') return v.pts;
    if (Array.isArray(v)) return v.map((q, k) => ({ r: q.r, c: q.c, label: q.label || `P${k + 1}` }));
    if (typeof v.r === 'number') return [{ r: v.r, c: v.c, label: v.label || 'P1' }];
    return [];
  };
  const asLine = (v) => (v && v.dt === 'lines' ? (v.lines[0] || {}).line : v);
  const idx = (g, q) => Math.round(q.r) * g.w + Math.round(q.c);
  const inG = (g, q) => q && q.r >= 0 && q.c >= 0 && q.r < g.h && q.c < g.w;
  const need = (v, what) => { if (v === undefined || v === null || (Array.isArray(v) && !v.length)) throw new Error(`${what} is empty — set it first.`); return v; };

  // ---------------------------------------------------------------- Raster Calculator (Map Algebra)
  const FUNCS = { Con: 'C', IsNull: 'N', Abs: 'Math.abs', Exp: 'Math.exp', Ln: 'Math.log', Log10: 'Math.log10', Sqrt: 'Math.sqrt', Power: 'Math.pow', Min: 'Math.min', Max: 'Math.max', Cos: 'Math.cos', Sin: 'Math.sin', Tan: 'Math.tan', Int: 'Math.trunc', Round: 'Math.round' };
  /** Names of rasters ("Name") and value variables (%Name%) an expression uses. */
  M.exprRefs = (expr) => ({
    rasters: [...new Set([...String(expr).matchAll(/"([^"]+)"/g)].map((m) => m[1]))],
    values: [...new Set([...String(expr).matchAll(/%([^%]+)%/g)].map((m) => m[1]))],
  });
  /** Compile a Map Algebra expression into a per-cell function f(R, i). */
  M.compileExpr = (expr, names, values) => {
    let s = String(expr).replace(/%([^%]+)%/g, (m, k) => {
      if (!(k in values)) throw new Error(`Unknown variable %${k}%.`);
      const v = values[k];
      return typeof v === 'number' ? String(v) : JSON.stringify(v);
    });
    s = s.replace(/"([^"]+)"/g, (m, k) => { const j = names.indexOf(k); if (j < 0) throw new Error(`Unknown raster "${k}".`); return `R[${j}][i]`; });
    s = s.replace(/\bNoData\b/g, 'NaN');
    // ArcGIS boolean operators
    s = s.replace(/&&?/g, '&&').replace(/\|\|?/g, '||').replace(/~(?!=)/g, '!');
    s = s.replace(/\b([A-Z][A-Za-z0-9]*)\s*\(/g, (m, f) => { if (!FUNCS[f]) throw new Error(`Unknown function ${f}().`); return FUNCS[f] + '('; });
    // only numbers, operators, brackets and the functions above may remain
    const check = s.replace(/R\[\d+\]\[i\]/g, '').replace(/Math\.\w+|\bC\b|\bN\b|\bNaN\b|\btrue\b|\bfalse\b/g, '').replace(/\d+(\.\d+)?(e[-+]?\d+)?/gi, '0');
    if (!/^[0\s.+\-*/()<>=!&|,]*$/.test(check) || /(^|[^<>!=])=([^=]|$)/.test(check)) throw new Error(`Expression not understood: ${expr}`);
    // eslint-disable-next-line no-new-func
    const f = new Function('R', 'i', 'C', 'N', `return (${s});`);
    const C = (a, b, c) => (a ? b : c === undefined ? NaN : c);
    const N = (x) => Number.isNaN(x);
    return (R, i) => { const v = f(R, i, C, N); return typeof v === 'boolean' ? (v ? 1 : 0) : v; };
  };

  // ---------------------------------------------------------------- Reclassify remap table
  /** "0 20 : 0 GO; 20 40 : 1 SLOW-GO; 40 90 : 2 NO-GO" -> [{lo, hi, v, name}] */
  M.parseRemap = (txt) => String(txt).split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^(-?[\d.]+)\s*(?:-|–|to|\s)\s*(-?[\d.]+)\s*(?::|=>|→|->)\s*(NoData|-?[\d.]+)\s*(.*)$/i);
    if (!m) throw new Error(`Remap row not understood: "${x}" (write: low high : new value  name)`);
    return { lo: +m[1], hi: +m[2], v: /nodata/i.test(m[3]) ? NaN : +m[3], name: m[4].trim() };
  });

  // =====================================================================
  // Toolbox
  // =====================================================================
  /*
   * param: { k, label, dt, dir: 'in' | 'out', def, options, optional, help }
   * dt: raster | points | lines | table | number | string | select | point | line | profile | expr | remap
   */
  const T = (M.GPT = {});
  T.slope = {
    name: 'Slope', cat: 'Surface', arc: 'Spatial Analyst ▸ Surface ▸ Slope',
    help: 'Steepness of every cell in degrees, from the heights of the cell and its 8 neighbours.',
    params: [{ k: 'dem', label: 'Input surface (DEM)', dt: 'raster', dir: 'in' }, { k: 'out', label: 'Output slope', dt: 'raster', dir: 'out' }],
    run: (E, p) => ({ out: raster(p.dem.a === E.g.z ? E.L.slope : M.slopeAspect(Object.assign({}, E.g, { z: p.dem.a }), M.gradient(Object.assign({}, E.g, { z: p.dem.a }))).slope, 'continuous', '°') }),
  };
  T.reclassify = {
    name: 'Reclassify', cat: 'Reclass', arc: 'Spatial Analyst ▸ Reclass ▸ Reclassify',
    help: 'Gives every cell a new value from the range its old value falls in (the remap table). Values outside every range become NoData.',
    params: [{ k: 'in', label: 'Input raster', dt: 'raster', dir: 'in' }, { k: 'remap', label: 'Reclassification (low high : new value name; …)', dt: 'remap', dir: 'in', def: '0 20 : 0 GO; 20 40 : 1 SLOW-GO; 40 90 : 2 NO-GO' },
      { k: 'out', label: 'Output raster', dt: 'raster', dir: 'out' }],
    run: (E, p) => {
      const rows = M.parseRemap(p.remap);
      const a = p.in.a, out = new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) {
        const x = a[i];
        let v = NaN;
        for (const r of rows) if (x >= r.lo && x <= r.hi) { v = r.v; break; }
        out[i] = v;
      }
      const classes = {};
      rows.forEach((r) => { if (!Number.isNaN(r.v)) classes[r.v] = r.name || String(r.v); });
      return { out: raster(out, 'class', '', { classes }) };
    },
  };
  T.rasterCalc = {
    name: 'Raster Calculator', cat: 'Map Algebra', arc: 'Spatial Analyst ▸ Map Algebra ▸ Raster Calculator',
    help: 'Works out a new value for every cell from a formula over other rasters ("Name") and model values (%Name%). Con(test, a, b) = a where the test is true, else b; NoData blocks movement.',
    params: [{ k: 'expr', label: 'Map Algebra expression', dt: 'expr', dir: 'in', def: '"Slope" * 1' }, { k: 'out', label: 'Output raster', dt: 'raster', dir: 'out' }],
    run: (E, p) => {
      const names = Object.keys(p._rasters || {});
      const R = names.map((k) => p._rasters[k].a);
      const f = M.compileExpr(p.expr, names, p._values || {});
      const n = E.g.w * E.g.h, out = new Float32Array(n);
      for (let i = 0; i < n; i++) { const v = f(R, i); out[i] = v === Infinity || v === -Infinity ? NaN : v; }
      return { out: raster(out, 'continuous', '') };
    },
  };
  T.viewshed = {
    name: 'Viewshed', cat: 'Visibility', arc: 'Spatial Analyst ▸ Surface ▸ Viewshed',
    help: 'For every cell, how many of the observers can see it: a straight line from the observer’s eye to the cell that the ground does not block.',
    params: [{ k: 'dem', label: 'Input surface (DEM)', dt: 'raster', dir: 'in' }, { k: 'obs', label: 'Observer points', dt: 'points', dir: 'in' },
      { k: 'obsH', label: 'Observer offset (m)', dt: 'number', dir: 'in', def: 2 }, { k: 'tgtH', label: 'Target offset (m)', dt: 'number', dir: 'in', def: 1.5 },
      { k: 'radiusM', label: 'Outer radius (m)', dt: 'number', dir: 'in', def: 4000 }, { k: 'out', label: 'Output viewshed (count)', dt: 'raster', dir: 'out' }],
    run: (E, p) => {
      const obs = need(asPoints(p.obs), 'Observer points').filter((q) => inG(E.g, q)).map((q) => ({ r: Math.round(q.r), c: Math.round(q.c) }));
      if (!obs.length) throw new Error('No observer point lies on the DEM.');
      return { out: raster(M.viewshedCount(E.g, obs, { obsH: +p.obsH, tgtH: +p.tgtH, radiusM: +p.radiusM }), 'count', 'observers') };
    },
  };
  T.pathDistance = {
    name: 'Path Distance', cat: 'Distance', arc: 'Spatial Analyst ▸ Distance ▸ Path Distance (with surface and vertical factor)',
    help: 'Spreads out from the sources like water and records, for every cell, the least time to get there. Time per step = distance on the ground × cost (friction) of the cell, at the walking / driving speed for the slope of the step (vertical factor: uphill slower, gentle downhill fastest). NoData cost cells cannot be entered. Also writes the backlink (which way to step back) and the allocation (which source is nearest in time).',
    params: [{ k: 'src', label: 'Input sources', dt: 'points', dir: 'in' }, { k: 'cost', label: 'Cost (friction) raster', dt: 'raster', dir: 'in' },
      { k: 'dem', label: 'Surface raster (DEM)', dt: 'raster', dir: 'in' }, { k: 'profile', label: 'Vertical factor — movement class', dt: 'profile', dir: 'in', def: 'foot' },
      { k: 'maxH', label: 'Maximum time (h)', dt: 'number', dir: 'in', def: 24 },
      { k: 'out', label: 'Output path distance (time, h)', dt: 'raster', dir: 'out' }, { k: 'back', label: 'Output backlink raster', dt: 'raster', dir: 'out' },
      { k: 'alloc', label: 'Output allocation (nearest source)', dt: 'raster', dir: 'out', optional: true }],
    run: (E, p, progress) => {
      const g = E.g, n = g.w * g.h, { z, cs, w, h } = g;
      const cost = p.cost.a, slope = E.L.slope;
      const mob = E.mob(p.profile || 'foot');
      const prof = mob.prof, track = mob.trackMask;
      const src = need(asPoints(p.src), 'Input sources').filter((q) => inG(g, q));
      const t = new Float64Array(n).fill(Infinity), back = new Int32Array(n).fill(-1), alloc = new Int16Array(n).fill(-1);
      const heap = new M.MinHeap(4096);
      const bad = (i) => !(cost[i] > 0);
      src.forEach((q, k) => { const i = idx(g, q); if (!bad(i)) { t[i] = 0; alloc[i] = k; heap.push(0, i); } });
      if (!heap.size) throw new Error('Every source sits on NoData (impassable) cost cells — move the sources or check the cost raster.');
      const maxS = (+p.maxH || 24) * 3600;
      let it = 0;
      while (heap.size) {
        const cur = heap.pop(), tc = heap.lastKey;
        if (tc > t[cur]) continue;
        if (tc > maxS) break;
        if (progress && (++it & 0x3ffff) === 0) progress(Math.min(0.95, it / n));
        const r = (cur / w) | 0, c = cur % w;
        for (let m = 0; m < 16; m++) {
          const mv = MOVES[m], rr = r + mv.dr, cc = c + mv.dc;
          if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
          const nb = rr * w + cc;
          if (bad(nb)) continue;
          if (m >= 4 && m < 8) { if (bad(r * w + cc) || bad(rr * w + c)) continue; } else if (m >= 8) {
            const sr = Math.sign(mv.dr), sc = Math.sign(mv.dc);
            const a = Math.abs(mv.dr) === 2 ? (r + sr) * w + c : r * w + c + sc, b = Math.abs(mv.dr) === 2 ? (r + sr) * w + cc : rr * w + c + sc;
            if (bad(a) || bad(b)) continue;
          }
          const dist = mv.len * cs;
          const v = M.moveSpeed(prof, (z[nb] - z[cur]) / dist, slope[nb], 0, z[nb], track ? track[nb] === 1 : false) / 3.6;
          const nt = tc + (dist / v) * cost[nb];
          if (nt < t[nb]) { t[nb] = nt; back[nb] = cur; alloc[nb] = alloc[cur]; heap.push(nt, nb); }
        }
      }
      const out = new Float32Array(n), al = new Float32Array(n);
      for (let i = 0; i < n; i++) { out[i] = t[i] < Infinity ? t[i] / 3600 : NaN; al[i] = alloc[i] >= 0 ? alloc[i] + 1 : NaN; }
      const classes = {};
      src.forEach((q, k) => (classes[k + 1] = q.label || `S${k + 1}`));
      return { out: raster(out, 'continuous', 'h', { profile: prof.name }), back: raster(back, 'backlink', ''), alloc: raster(al, 'class', '', { classes }), _sources: src };
    },
  };
  T.costPath = {
    name: 'Cost Path', cat: 'Distance', arc: 'Spatial Analyst ▸ Distance ▸ Cost Path (each zone)',
    help: 'From each destination, follows the backlink raster step by step back to the nearest source: the least-time (least-cost) path. A destination with NoData time cannot be reached.',
    params: [{ k: 'dst', label: 'Input destinations', dt: 'points', dir: 'in' }, { k: 'dist', label: 'Path distance raster', dt: 'raster', dir: 'in' },
      { k: 'back', label: 'Backlink raster', dt: 'raster', dir: 'in' }, { k: 'alloc', label: 'Allocation raster (to name the source)', dt: 'raster', dir: 'in', optional: true },
      { k: 'out', label: 'Output path(s)', dt: 'lines', dir: 'out' }],
    run: (E, p) => {
      const g = E.g, back = p.back.a, dist = p.dist.a;
      const dst = need(asPoints(p.dst), 'Destinations');
      const lines = [], skipped = [];
      for (const q of dst) {
        if (!inG(g, q)) { skipped.push(`${q.label}: off the map`); continue; }
        let i = idx(g, q);
        if (!(dist[i] >= 0)) { skipped.push(`${q.label}: cannot be reached (NoData time)`); continue; }
        const path = [];
        for (let guard = 0; i >= 0 && guard < g.w * g.h; guard++) { path.push(i); i = back[i]; }
        path.reverse();
        const from = p.alloc ? (p.alloc.classes || {})[p.alloc.a[path[0]]] : null;
        lines.push({ label: q.label, from, path: Int32Array.from(path), line: M.simplify(path.map((x) => [x % g.w, (x / g.w) | 0]), 0.6),
          attrs: { to: q.label, from: from || '', timeH: dist[idx(g, q)] } });
      }
      if (!lines.length) throw new Error(`No path: ${skipped.join('; ')}.`);
      return { out: { dt: 'lines', lines, skipped } };
    },
  };
  T.pointsAlongLine = {
    name: 'Generate Points Along Line (offset)', cat: 'Features', arc: 'Data Management ▸ Sampling ▸ Generate Points Along Lines + offset',
    help: 'Puts a point every so many metres along the line, then moves each point the given distance square to the line — towards the side away from the reference point (e.g. into enemy ground, away from own position).',
    params: [{ k: 'line', label: 'Input line', dt: 'line', dir: 'in' }, { k: 'spacingM', label: 'Distance between points (m)', dt: 'number', dir: 'in', def: 1500 },
      { k: 'offsetM', label: 'Offset from the line (m)', dt: 'number', dir: 'in', def: 1500 }, { k: 'ref', label: 'Reference point (offset goes away from it)', dt: 'point', dir: 'in', optional: true },
      { k: 'prefix', label: 'Label prefix', dt: 'string', dir: 'in', def: 'E' }, { k: 'out', label: 'Output points', dt: 'points', dir: 'out' }],
    run: (E, p) => {
      const g = E.g, line = need(asLine(p.line), 'Input line');
      const st = M.lineStations(g, line, Math.max(g.cs, +p.spacingM));
      const off = (+p.offsetM || 0) / g.cs, out = [];
      // which side is "away from the reference": sign of the cross product at the nearest segment
      let sideSign = 1;
      if (p.ref && typeof p.ref.r === 'number') {
        let best = Infinity;
        for (let k = 1; k < line.length; k++) {
          const [ax, ay] = line[k - 1], [bx, by] = line[k];
          const d = Math.hypot((ax + bx) / 2 - p.ref.c, (ay + by) / 2 - p.ref.r);
          if (d < best) { best = d; const cr = (bx - ax) * (p.ref.r - ay) - (by - ay) * (p.ref.c - ax); sideSign = cr > 0 ? -1 : 1; }
        }
      }
      st.forEach((s, k) => {
        // local direction of the line
        let seg = 1;
        for (let j = 1, acc = 0; j < line.length; j++) { const L = Math.hypot(line[j][0] - line[j - 1][0], line[j][1] - line[j - 1][1]) * g.cs; if (acc + L >= s.d) { seg = j; break; } acc += L; seg = j; }
        const [ax, ay] = line[seg - 1], [bx, by] = line[seg];
        const L = Math.hypot(bx - ax, by - ay) || 1;
        // left normal of (dx, dy) in (c, r) is (dy, -dx); positive cross = left
        const nx = (by - ay) / L, ny = -(bx - ax) / L;
        const q = { c: s.c + nx * off * sideSign, r: s.r + ny * off * sideSign, label: `${p.prefix || 'P'}${k + 1}` };
        if (inG(g, q)) out.push(q);
      });
      if (!out.length) throw new Error('No point falls on the DEM — reduce the offset or check the line.');
      return { out: { dt: 'points', pts: out } };
    },
  };
  T.snapPoints = {
    name: 'Snap Points to Valid Cells', cat: 'Features', arc: 'Spatial Analyst ▸ Hydrology ▸ Snap Pour Point (nearest valid cell)',
    help: 'Moves each point to the nearest cell that has a value (is not NoData) in the raster, within the search distance. Points with no valid cell nearby are dropped and listed.',
    params: [{ k: 'in', label: 'Input points', dt: 'points', dir: 'in' }, { k: 'ras', label: 'Raster of valid cells', dt: 'raster', dir: 'in' },
      { k: 'radiusM', label: 'Search distance (m)', dt: 'number', dir: 'in', def: 1200 }, { k: 'out', label: 'Output snapped points', dt: 'points', dir: 'out' }],
    run: (E, p) => {
      const g = E.g, a = p.ras.a, R = Math.ceil((+p.radiusM || 0) / g.cs), out = [], dropped = [];
      for (const q of need(asPoints(p.in), 'Input points')) {
        let best = null, bd = Infinity;
        for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
          const r = Math.round(q.r) + dr, c = Math.round(q.c) + dc, d = Math.hypot(dr, dc);
          if (r < 0 || c < 0 || r >= g.h || c >= g.w || d > R || d >= bd) continue;
          const v = a[r * g.w + c];
          if (Number.isFinite(v) && v === v) { bd = d; best = { r, c }; }
        }
        if (best) out.push({ r: best.r, c: best.c, label: q.label, movedM: Math.round(bd * g.cs) }); else dropped.push(q.label);
      }
      if (!out.length) throw new Error(`No valid cell within ${p.radiusM} m of any point (${dropped.join(', ')}).`);
      return { out: { dt: 'points', pts: out, dropped } };
    },
  };
  T.findPeaks = {
    name: 'Find Dominating Heights', cat: 'Surface', arc: 'Focal Statistics (maximum) = DEM, ranked by Topographic Position Index',
    help: 'Finds cells that are the highest point within the search radius (Focal Maximum equals the cell), ranks them by how far they stand above the ground around them, and keeps the best, spaced apart. An optional mask raster limits the search to cells that have a value above 0.',
    params: [{ k: 'dem', label: 'Input surface (DEM)', dt: 'raster', dir: 'in' }, { k: 'mask', label: 'Mask (search only where > 0)', dt: 'raster', dir: 'in', optional: true },
      { k: 'radiusM', label: 'Search radius (m)', dt: 'number', dir: 'in', def: 500 }, { k: 'count', label: 'Maximum number', dt: 'number', dir: 'in', def: 6 },
      { k: 'prefix', label: 'Label prefix', dt: 'string', dir: 'in', def: 'H' }, { k: 'out', label: 'Output points', dt: 'points', dir: 'out' }],
    run: (E, p) => {
      const g = E.g, z = p.dem.a, R = Math.max(1, Math.round((+p.radiusM || 500) / g.cs)), mask = p.mask ? p.mask.a : null;
      const st = Math.max(1, Math.round(R / 4)), cands = [];
      for (let r = 0; r < g.h; r += st) for (let c = 0; c < g.w; c += st) {
        const i = r * g.w + c;
        if (mask && !(mask[i] > 0)) continue;
        let top = true;
        for (let dr = -R; dr <= R && top; dr += st) for (let dc = -R; dc <= R; dc += st) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= g.h || cc >= g.w || dr * dr + dc * dc > R * R) continue;
          if (z[rr * g.w + cc] > z[i]) { top = false; break; }
        }
        if (top) cands.push({ r, c, score: E.L.tpiL[i] / E.L.sdL + 1e-4 * z[i] });
      }
      const pts = M.nms(cands, R, Math.max(1, +p.count || 6)).map((q, k) => ({ r: q.r, c: q.c, z: z[q.r * g.w + q.c], label: `${p.prefix || 'H'}${k + 1}` }));
      if (!pts.length) throw new Error('No height found — enlarge the mask or reduce the search radius.');
      return { out: { dt: 'points', pts, tested: cands.length } };
    },
  };
  T.borderSide = {
    name: 'Side of Line', cat: 'Features', arc: 'Polygon to Raster of the own-side polygon',
    help: 'Splits the map along a line (the border) and marks every cell 1 on the side of the reference point (own side) and 0 on the far side.',
    params: [{ k: 'line', label: 'Input line', dt: 'line', dir: 'in' }, { k: 'ref', label: 'Reference point (own side)', dt: 'point', dir: 'in' }, { k: 'out', label: 'Output side raster', dt: 'raster', dir: 'out' }],
    run: (E, p) => {
      const fr = M.sectorFrame(E.g, null, need(asLine(p.line), 'Input line'), need(p.ref, 'Reference point'));
      const out = new Float32Array(fr.side.length);
      for (let i = 0; i < out.length; i++) out[i] = fr.side[i] > 0 ? 1 : 0;
      return { out: raster(out, 'class', '', { classes: { 0: 'far side', 1: 'own side' } }) };
    },
  };
  T.maxCoverage = {
    name: 'Maximize Coverage (location–allocation)', cat: 'Visibility', arc: 'Network/Location–Allocation “Maximize Coverage”, with viewsheds as coverage',
    help: 'Computes the viewshed of every candidate, then picks the candidate that sees the most demand (weight raster), then the one that adds most demand not yet seen, and so on.',
    params: [{ k: 'cand', label: 'Candidate points', dt: 'points', dir: 'in' }, { k: 'dem', label: 'Input surface (DEM)', dt: 'raster', dir: 'in' },
      { k: 'demand', label: 'Demand (weight) raster', dt: 'raster', dir: 'in', optional: true }, { k: 'count', label: 'Number to choose', dt: 'number', dir: 'in', def: 5 },
      { k: 'obsH', label: 'Observer offset (m)', dt: 'number', dir: 'in', def: 2 }, { k: 'radiusM', label: 'Range (m)', dt: 'number', dir: 'in', def: 3000 },
      { k: 'out', label: 'Output chosen points', dt: 'points', dir: 'out' }, { k: 'cover', label: 'Output coverage (count)', dt: 'raster', dir: 'out' }],
    run: (E, p, progress) => {
      const g = E.g, n = g.w * g.h, dem = p.demand ? p.demand.a : null;
      const wt = (i) => (dem ? (dem[i] > 0 ? dem[i] : 0) : 1);
      const cands = need(asPoints(p.cand), 'Candidates').filter((q) => inG(g, q));
      const vs = cands.map((q, k) => {
        if (progress) progress(0.8 * k / cands.length, `Viewshed ${k + 1}/${cands.length}`);
        const m = M.viewshed(g, Math.round(q.r), Math.round(q.c), { obsH: +p.obsH, tgtH: 1.5, radiusM: +p.radiusM }).mask;
        const cells = [];
        for (let i = 0; i < n; i++) if (m[i] && wt(i) > 0) cells.push(i);
        return cells;
      });
      let total = 0;
      for (let i = 0; i < n; i++) total += wt(i);
      const seen = new Uint8Array(n), chosen = [], rows = [];
      for (let k = 0; k < Math.min(+p.count || 5, cands.length); k++) {
        let best = -1, bv = 0;
        vs.forEach((cells, j) => { if (chosen.includes(j)) return; let v = 0; for (const i of cells) if (!seen[i]) v += wt(i); if (v > bv) { bv = v; best = j; } });
        if (best < 0 || bv <= 0) break;
        chosen.push(best);
        for (const i of vs[best]) seen[i] = 1;
        rows.push({ label: `OP${k + 1}`, adds: total ? bv / total : 0 });
      }
      const pts = chosen.map((j, k) => Object.assign({}, cands[j], { label: `OP${k + 1}`, addsShare: rows[k].adds }));
      const cover = M.viewshedCount(g, pts.map((q) => ({ r: Math.round(q.r), c: Math.round(q.c) })), { obsH: +p.obsH, tgtH: 1.5, radiusM: +p.radiusM });
      let got = 0;
      for (let i = 0; i < n; i++) if (cover[i]) got += wt(i);
      return { out: { dt: 'points', pts, coverShare: total ? got / total : 0 }, cover: raster(cover, 'count', 'observers') };
    },
  };
  T.lineStats = {
    name: 'Line Statistics (along route)', cat: 'Features', arc: 'Extract Values to Line / Zonal Statistics as Table along each path',
    help: 'For each line: length on the ground, climb and descent from the DEM, travel time at its end (from the path distance raster), and the share of its length where the zone raster is above 0 (e.g. seen by own or enemy observers).',
    params: [{ k: 'lines', label: 'Input lines', dt: 'lines', dir: 'in' }, { k: 'dem', label: 'Surface (DEM)', dt: 'raster', dir: 'in' },
      { k: 'zone', label: 'Zone raster (share where > 0)', dt: 'raster', dir: 'in', optional: true }, { k: 'zoneName', label: 'Zone column name', dt: 'string', dir: 'in', def: '% seen' },
      { k: 'out', label: 'Output table', dt: 'table', dir: 'out' }],
    run: (E, p) => {
      const g = E.g, z = p.dem.a;
      const rows = need(p.lines && p.lines.lines, 'Input lines').map((L) => {
        const path = L.path || Int32Array.from([]);
        let len = 0, up = 0, down = 0, inZ = 0;
        for (let k = 1; k < path.length; k++) {
          const a = path[k - 1], b = path[k];
          const d = Math.hypot(((a / g.w) | 0) - ((b / g.w) | 0), (a % g.w) - (b % g.w)) * g.cs;
          len += d; const dz = z[b] - z[a]; if (dz > 0) up += dz; else down -= dz;
          if (p.zone && p.zone.a[b] > 0) inZ += d;
        }
        const row = { Path: L.label + (L.from ? ` (from ${L.from})` : ''), 'Length km': +(len / 1000).toFixed(2), 'Climb m': Math.round(up), 'Descent m': Math.round(down), 'Time h': L.attrs && L.attrs.timeH != null ? +L.attrs.timeH.toFixed(2) : null };
        if (p.zone) row[p.zoneName || '% in zone'] = Math.round((len ? inZ / len : 0) * 100);
        return row;
      });
      return { out: { dt: 'table', cols: Object.keys(rows[0] || {}), rows } };
    },
  };

  // =====================================================================
  // Executor
  // =====================================================================
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

  /** Tool nodes in dependency order, with the variable ids each one reads and writes. */
  M.modelGraph = (model) => {
    const vars = {}, tools = [];
    for (const nd of model.nodes) { if (nd.kind === 'tool') tools.push(nd); else vars[nd.id] = nd; }
    const byName = {};
    Object.values(vars).forEach((v) => (byName[v.name] = v.id));
    const reads = (t) => {
      const ids = Object.values(t.inputs || {}).filter(Boolean);
      if (t.tool === 'rasterCalc') {
        const ex = t.inputs && t.inputs.expr ? vars[t.inputs.expr] && vars[t.inputs.expr].value : (t.values || {}).expr;
        const ref = M.exprRefs(ex || '');
        for (const nm of ref.rasters.concat(ref.values)) if (byName[nm]) ids.push(byName[nm]);
      }
      return [...new Set(ids)];
    };
    const producer = {};
    tools.forEach((t) => Object.values(t.outputs || {}).forEach((v) => (producer[v] = t.id)));
    const order = [], seen = new Set(), visiting = new Set();
    const visit = (t) => {
      if (seen.has(t.id)) return;
      if (visiting.has(t.id)) throw new Error(`The model has a loop at ${t.name}.`);
      visiting.add(t.id);
      for (const v of reads(t)) if (producer[v]) visit(tools.find((x) => x.id === producer[v]));
      visiting.delete(t.id); seen.add(t.id); order.push(t);
    };
    tools.forEach(visit);
    return { vars, tools: order, reads, producer, byName };
  };

  const summarize = (E, d) => {
    if (d === undefined || d === null) return null;
    if (d.dt === 'raster') {
      if (d.kind === 'backlink') return { dt: 'raster', kind: 'backlink', text: 'direction to step back towards the source, for every reached cell' };
      const a = d.a;
      let lo = Infinity, hi = -Infinity, sum = 0, k = 0, nd = 0;
      const cnt = {};
      for (let i = 0; i < a.length; i++) {
        const v = a[i];
        if (v !== v) { nd++; continue; }
        if (v < lo) lo = v; if (v > hi) hi = v; sum += v; k++;
        if (d.kind === 'class') cnt[v] = (cnt[v] || 0) + 1;
      }
      const s = { dt: 'raster', kind: d.kind, unit: d.unit, min: k ? lo : null, max: k ? hi : null, mean: k ? sum / k : null, nodata: nd / a.length, classes: d.classes || null };
      if (d.kind === 'class') s.counts = Object.fromEntries(Object.entries(cnt).map(([v, c]) => [v, c / a.length]));
      if (d.kind === 'count') { let seen = 0; for (let i = 0; i < a.length; i++) if (a[i] > 0) seen++; s.share = seen / a.length; }
      return s;
    }
    if (d.dt === 'points') return { dt: 'points', n: d.pts.length, pts: d.pts.map((q) => Object.assign({}, q)), dropped: d.dropped, coverShare: d.coverShare };
    if (d.dt === 'lines') return { dt: 'lines', n: d.lines.length, lines: d.lines.map((L) => ({ label: L.label, from: L.from, line: L.line, attrs: L.attrs })), skipped: d.skipped };
    if (d.dt === 'table') return d;
    return { dt: 'value', value: d };
  };
  /** Value of a variable as the tools see it (sources resolved). */
  const varValue = (E, v) => {
    if (v.src === 'dem') return raster(E.g.z, 'continuous', 'm');
    if (v.dt === 'points' && v.value && !v.value.dt) return { dt: 'points', pts: asPoints(v.value) };
    if (v.dt === 'point' && v.value) return v.value;
    return v.value;
  };

  /**
   * Run a model. E: { g, L, mob, cache: Map }. opts: { upTo: tool id (run it and what it needs), force }
   * Returns { tools: {id: {state, ms, msg}}, vars: {id: summary}, order }.
   */
  M.runModel = (E, model, opts = {}, progress) => {
    const G = M.modelGraph(model);
    const data = {}, stamp = {}, rep = { tools: {}, vars: {}, order: G.tools.map((t) => t.id) };
    for (const v of Object.values(G.vars)) if (!G.producer[v.id]) { data[v.id] = varValue(E, v); stamp[v.id] = v.src === 'dem' ? `dem:${E.g.name}:${E.g.w}` : hashStr(JSON.stringify(v.value === undefined ? null : v.value)); }
    let wanted = null;
    if (opts.upTo) {
      wanted = new Set();
      const add = (tid) => { if (wanted.has(tid)) return; wanted.add(tid); const t = G.tools.find((x) => x.id === tid); for (const v of G.reads(t)) if (G.producer[v]) add(G.producer[v]); };
      add(opts.upTo);
    }
    const cache = E.cache || (E.cache = new Map());
    let failed = false;
    G.tools.forEach((t, k) => {
      const def = T[t.tool];
      if (wanted && !wanted.has(t.id)) return;
      if (failed) { rep.tools[t.id] = { state: 'notrun', msg: 'not run — an earlier tool failed' }; return; }
      if (!def) { rep.tools[t.id] = { state: 'failed', msg: `Unknown tool ${t.tool}` }; failed = true; return; }
      // resolve parameters
      const p = {}, keyParts = [t.tool];
      let missing = null;
      for (const pd of def.params) {
        if (pd.dir === 'out') continue;
        const vid = t.inputs && t.inputs[pd.k];
        if (vid) { p[pd.k] = data[vid]; keyParts.push(pd.k + '=' + stamp[vid]); if ((p[pd.k] === undefined || p[pd.k] === null || p[pd.k] === '') && !pd.optional) missing = `${pd.label} — “${(G.vars[vid] || {}).name || vid}” has no value`; continue; }
        const val = t.values && pd.k in t.values ? t.values[pd.k] : pd.def;
        p[pd.k] = val; keyParts.push(pd.k + '=' + JSON.stringify(val === undefined ? null : val));
        if ((val === undefined || val === null || val === '') && !pd.optional) missing = `${pd.label} is not set`;
      }
      if (t.tool === 'rasterCalc') {
        const ref = M.exprRefs(p.expr || '');
        p._rasters = {}; p._values = {};
        for (const nm of ref.rasters) { const vid = G.byName[nm]; if (!vid || data[vid] === undefined) { missing = `raster "${nm}" ${vid ? 'has no value yet' : 'is not in the model'}`; break; } p._rasters[nm] = data[vid]; keyParts.push(nm + '=' + stamp[vid]); }
        for (const nm of ref.values) { const vid = G.byName[nm]; if (!vid) { missing = `value %${nm}% is not in the model`; break; } p._values[nm] = data[vid]; keyParts.push(nm + '=' + stamp[vid]); }
      }
      if (missing) { rep.tools[t.id] = { state: 'failed', msg: `Not ready: ${missing}.` }; failed = true; return; }
      const key = hashStr(keyParts.join('|') + '|' + E.g.name + E.g.w);
      const t0 = Date.now();
      let out, state = 'done';
      if (!opts.force && cache.has(t.id) && cache.get(t.id).key === key) { out = cache.get(t.id).out; state = 'cached'; } else {
        try {
          out = def.run(E, p, progress ? (f, m) => progress((k + f) / G.tools.length, `${t.name}: ${m || ''}`) : null);
          cache.set(t.id, { key, out });
        } catch (e) { rep.tools[t.id] = { state: 'failed', msg: e.message }; failed = true; return; }
      }
      if (progress) progress((k + 1) / G.tools.length, t.name);
      for (const [pk, vid] of Object.entries(t.outputs || {})) { data[vid] = out[pk]; stamp[vid] = key + pk; }
      rep.tools[t.id] = { state, ms: Date.now() - t0 };
    });
    for (const [vid, d] of Object.entries(data)) { const s = summarize(E, d); if (s) rep.vars[vid] = s; }
    rep.failed = failed;
    E.lastData = data;
    return rep;
  };
});
