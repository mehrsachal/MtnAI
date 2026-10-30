/*
 * MtnAI core — intervisibility: viewshed, line of sight and terrain profiles.
 * Earth curvature and standard atmospheric refraction (k = 0.13) are applied.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function visibility(M) {
  'use strict';

  const R_EARTH = 6371000;

  /**
   * Radial-sweep viewshed (rays to every perimeter cell of the bounding square,
   * terrain linearly interpolated across the minor axis).
   * opts: {obsH=2, tgtH=0, radiusM, k=0.13, out?: Uint8Array to OR into, value=1}
   * Returns {mask, visible (cells), r0, c0, R}. mask: 0 = not seen, `value` = seen.
   */
  M.viewshed = (g, r0, c0, opts = {}) => {
    const { w, h, cs, z } = g;
    r0 = Math.round(r0); c0 = Math.round(c0);
    const obsH = opts.obsH ?? 2, tgtH = opts.tgtH ?? 0;
    const radiusM = opts.radiusM || Math.max(w, h) * cs;
    const R = Math.max(1, Math.ceil(radiusM / cs));
    const curvK = (1 - (opts.k ?? 0.13)) / (2 * R_EARTH);
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
    const curvK = (1 - (opts.k ?? 0.13)) / (2 * R_EARTH);
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
});
