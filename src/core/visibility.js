/*
 * MtnEye core — intervisibility: viewshed, line of sight and terrain profiles.
 * Earth curvature and atmospheric refraction (default k = 0.13, see M.CFG) are applied.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function visibility(M) {
  'use strict';

  const R_EARTH = 6371000;

  /**
   * Radial-sweep viewshed (rays to every perimeter cell of the bounding square,
   * terrain linearly interpolated across the minor axis).
   * opts: {obsH=2, tgtH=0, radiusM, k (refraction, default M.CFG), out?: Uint8Array to OR into, value=1}
   * Returns {mask, visible (cells), r0, c0, R}. mask: 0 = not seen, `value` = seen.
   */
  M.viewshed = (g, r0, c0, opts = {}) => {
    const { w, h, cs, z } = g;
    r0 = Math.round(r0); c0 = Math.round(c0);
    const obsH = opts.obsH ?? 2, tgtH = opts.tgtH ?? 0;
    const radiusM = opts.radiusM || Math.max(w, h) * cs;
    const R = Math.max(1, Math.ceil(radiusM / cs));
    const curvK = M.CFG.curvature ? (1 - (opts.k ?? M.CFG.refraction)) / (2 * R_EARTH) : 0;
    const mask = opts.out || new Uint8Array(w * h);
    const value = opts.value || 1;
    const zObs = z[r0 * w + c0] + obsH;
    const rad2 = (radiusM / cs) * (radiusM / cs);
    let visible = 0;
    if (mask[r0 * w + c0] !== value) { mask[r0 * w + c0] = value; visible++; }
    const cast = (pr, pc) => {
      const dr = pr - r0, dc = pc - c0;
      const steps = Math.max(Math.abs(dr), Math.abs(dc));
      const sr = dr / steps, sc = dc / steps;
      const stepLen = Math.hypot(sr, sc) * cs;
      let maxS = -Infinity;
      for (let i = 1; i <= steps; i++) {
        const fr = r0 + sr * i, fc = c0 + sc * i;
        if (fr < 0 || fc < 0 || fr > h - 1 || fc > w - 1) break;
        const ddr = fr - r0, ddc = fc - c0;
        if (ddr * ddr + ddc * ddc > rad2) break;
        const d = stepLen * i;
        const curv = d * d * curvK;
        // terrain at the (fractional) ray point, interpolated across the minor axis
        let zt;
        if (Math.abs(sr) >= Math.abs(sc)) {
          const rr = Math.round(fr), cf = Math.floor(fc), t = fc - cf;
          const a = z[rr * w + cf], b = cf + 1 < w ? z[rr * w + cf + 1] : a;
          zt = a + (b - a) * t;
        } else {
          const cc = Math.round(fc), rf = Math.floor(fr), t = fr - rf;
          const a = z[rf * w + cc], b = rf + 1 < h ? z[(rf + 1) * w + cc] : a;
          zt = a + (b - a) * t;
        }
        const ri = Math.round(fr), ci = Math.round(fc);
        const idx = ri * w + ci;
        const sT = (z[idx] + tgtH - curv - zObs) / d;
        if (sT >= maxS && mask[idx] !== value) { mask[idx] = value; visible++; }
        const sG = (zt - curv - zObs) / d;
        if (sG > maxS) maxS = sG;
      }
    };
    const rMin = r0 - R, rMax = r0 + R, cMin = c0 - R, cMax = c0 + R;
    for (let c = cMin; c <= cMax; c++) { cast(rMin, c); cast(rMax, c); }
    for (let r = rMin + 1; r < rMax; r++) { cast(r, cMin); cast(r, cMax); }
    return { mask, visible, r0, c0, R };
  };

  /** Union / count of several viewsheds. Returns Uint8Array counts (saturating at 255). */
  M.viewshedCount = (g, observers, opts = {}) => {
    const count = new Uint8Array(g.w * g.h);
    const tmp = new Uint8Array(g.w * g.h);
    for (const o of observers) {
      tmp.fill(0);
      M.viewshed(g, o.r, o.c, Object.assign({}, opts, o.opts || {}, { out: tmp, value: 1 }));
      for (let i = 0; i < tmp.length; i++) if (tmp[i] && count[i] < 255) count[i]++;
    }
    return count;
  };

  /**
   * Terrain profile along a polyline of cell coords [[c, r], ...].
   * Returns [{d (m), z, r, c}] sampled every `step` metres (default cs/2).
   */
  M.terrainProfile = (g, pts, step) => {
    step = step || g.cs / 2;
    const out = [];
    let dist = 0;
    for (let k = 1; k < pts.length; k++) {
      const [ca, ra] = pts[k - 1], [cb, rb] = pts[k];
      const L = Math.hypot(cb - ca, rb - ra) * g.cs;
      const n = Math.max(1, Math.ceil(L / step));
      for (let s = k === 1 ? 0 : 1; s <= n; s++) {
        const t = s / n;
        const c = ca + (cb - ca) * t, r = ra + (rb - ra) * t;
        out.push({ d: dist + L * t, z: M.sample(g, g.z, r, c), r, c });
      }
      dist += L;
    }
    return out;
  };

  /**
   * Line of sight between two cells. a/b: {r, c}. Returns
   * {visible, distance, profile, blockIndex, clearance (min m above terrain)}.
   */
  M.lineOfSight = (g, a, b, opts = {}) => {
    const obsH = opts.obsH ?? 2, tgtH = opts.tgtH ?? 2;
    const prof = M.terrainProfile(g, [[a.c, a.r], [b.c, b.r]]);
    const D = prof[prof.length - 1].d || 1;
    const curvK = M.CFG.curvature ? (1 - (opts.k ?? M.CFG.refraction)) / (2 * R_EARTH) : 0;
    const zA = prof[0].z + obsH, zB = prof[prof.length - 1].z + tgtH;
    let blockIndex = -1, clearance = Infinity;
    for (let i = 1; i < prof.length - 1; i++) {
      const p = prof[i];
      const losZ = zA + ((zB - zA) * p.d) / D;
      // curvature lowers distant terrain relative to the sight line
      const drop = p.d * (D - p.d) * curvK;
      const terr = p.z - drop;
      p.los = losZ;
      const clr = losZ - terr;
      if (clr < clearance) clearance = clr;
      if (clr < 0 && blockIndex < 0) blockIndex = i;
    }
    prof[0].los = zA; prof[prof.length - 1].los = zB;
    return { visible: blockIndex < 0, distance: D, profile: prof, blockIndex, clearance };
  };

  /**
   * Viewshed of a route: viewsheds from stations every stepM along the line, summed.
   *   mode 'from'     — what a column on the route can see (observer on the route at obsH, target tgtH);
   *   mode 'exposure' — from where the route can be seen: by reciprocity the observer height and
   *                     target height swap (a man on the route at routeH, a watcher at watcherH).
   * Returns per-cell count of stations seeing / seen, area, share of stations, and the best
   * watch points (cells that see the most of the route).
   */
  M.routeViewshed = (g, line, o = {}) => {
    const stepM = Math.max(g.cs, o.stepM || 250);
    const st = M.lineStations(g, line, stepM).map((s) => ({ r: Math.round(s.r), c: Math.round(s.c), d: s.d })).filter((s) => M.inGrid(g, s.r, s.c));
    if (st.length < 2) throw new Error('Route too short for a route viewshed.');
    const exposure = o.mode === 'exposure';
    const obsH = exposure ? (o.routeH ?? 1.8) : (o.obsH ?? 2), tgtH = exposure ? (o.watcherH ?? 2) : (o.tgtH ?? 1.5);
    const count = M.viewshedCount(g, st, { obsH, tgtH, radiusM: o.radiusM || 3000 });
    let n = 0;
    for (const v of count) if (v) n++;
    // best watch points: cells that see the largest share of the route (spread apart)
    const cand = [];
    const stride = Math.max(1, Math.round(Math.sqrt((g.w * g.h) / 160000)));
    for (let r = 0; r < g.h; r += stride) for (let c = 0; c < g.w; c += stride) { const v = count[r * g.w + c]; if (v) cand.push({ r, c, score: v }); }
    const watch = M.nms(cand, (o.watchSepM || 600) / g.cs, o.watchPoints ?? 5).map((q) => ({ r: q.r, c: q.c, z: g.z[q.r * g.w + q.c], share: q.score / st.length }));
    return { count, stations: st, visibleKm2: (n * g.cs * g.cs) / 1e6, areaShare: n / count.length, watch, mode: exposure ? 'exposure' : 'from', obsH, tgtH };
  };
});
