/*
 * MtnAI core — the analysis grid.
 *
 * All analysis runs on a square-cell raster in a single WGS84/UTM zone:
 *   g = { w, h, cs, x0, y0, zone, north, z: Float32Array, name }
 * Cell (r, c) has its centre at E = x0 + (c + .5) cs, N = y0 - (r + .5) cs,
 * i.e. row 0 is the northern edge. Grid north is "up" everywhere.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function grid(M) {
  'use strict';

  M.makeGrid = (o) => ({
    w: o.w, h: o.h, cs: o.cs, x0: o.x0, y0: o.y0,
    zone: o.zone, north: o.north !== false,
    z: o.z || new Float32Array(o.w * o.h),
    name: o.name || 'DEM', source: o.source || '', synthetic: !!o.synthetic,
  });

  /** Lightweight copy of grid metadata (no elevation array). */
  M.gridMeta = (g) => ({ w: g.w, h: g.h, cs: g.cs, x0: g.x0, y0: g.y0, zone: g.zone, north: g.north, name: g.name, source: g.source, synthetic: g.synthetic });

  M.cellToEN = (g, r, c) => ({ E: g.x0 + (c + 0.5) * g.cs, N: g.y0 - (r + 0.5) * g.cs });
  /** Fractional cell coords (integer = cell centre) for a UTM point. */
  M.enToCell = (g, E, N) => ({ c: (E - g.x0) / g.cs - 0.5, r: (g.y0 - N) / g.cs - 0.5 });
  M.cellToLatLon = (g, r, c) => {
    const p = M.cellToEN(g, r, c);
    return M.fromUTM(p.E, p.N, g.zone, g.north);
  };
  M.latLonToCell = (g, lat, lon) => {
    const u = M.toUTM(lat, lon, g.zone);
    return M.enToCell(g, u.E, u.N);
  };
  M.cellMGRS = (g, r, c, digits = 5) => {
    const p = M.cellToEN(g, r, c);
    const ll = M.fromUTM(p.E, p.N, g.zone, g.north);
    return M.utmToMGRS(p.E, p.N, g.zone, M.latBand(ll.lat) || 'N', digits);
  };
  M.inGrid = (g, r, c) => r >= 0 && c >= 0 && r < g.h && c < g.w;

  /** Bilinear sample of arr at fractional cell coords; clamps at edges. */
  M.sample = (g, arr, r, c) => {
    const w = g.w, h = g.h;
    if (r < 0) r = 0; else if (r > h - 1) r = h - 1;
    if (c < 0) c = 0; else if (c > w - 1) c = w - 1;
    const r0 = Math.floor(r), c0 = Math.floor(c);
    const r1 = r0 + 1 < h ? r0 + 1 : r0, c1 = c0 + 1 < w ? c0 + 1 : c0;
    const fr = r - r0, fc = c - c0;
    const a = arr[r0 * w + c0], b = arr[r0 * w + c1], d = arr[r1 * w + c0], e = arr[r1 * w + c1];
    return (a * (1 - fc) + b * fc) * (1 - fr) + (d * (1 - fc) + e * fc) * fr;
  };

  /** Summed-area table (Float64, (w+1)*(h+1)). */
  M.sat = (arr, w, h) => {
    const W = w + 1;
    const s = new Float64Array(W * (h + 1));
    for (let r = 0; r < h; r++) {
      let row = 0;
      for (let c = 0; c < w; c++) {
        row += arr[r * w + c];
        s[(r + 1) * W + c + 1] = s[r * W + c + 1] + row;
      }
    }
    return s;
  };

  /** Mean of a (2rad+1)^2 box around every cell, edge-clipped. */
  M.boxMean = (arr, w, h, rad) => {
    const s = M.sat(arr, w, h);
    const W = w + 1;
    const out = new Float32Array(w * h);
    for (let r = 0; r < h; r++) {
      const r0 = Math.max(0, r - rad), r1 = Math.min(h, r + rad + 1);
      for (let c = 0; c < w; c++) {
        const c0 = Math.max(0, c - rad), c1 = Math.min(w, c + rad + 1);
        const sum = s[r1 * W + c1] - s[r0 * W + c1] - s[r1 * W + c0] + s[r0 * W + c0];
        out[r * w + c] = sum / ((r1 - r0) * (c1 - c0));
      }
    }
    return out;
  };

  /** Fills NaN cells (SRTM voids, footprint edges) by iterative neighbour averaging. */
  M.fillNoData = (z, w, h) => {
    let holes = [];
    for (let i = 0; i < z.length; i++) if (z[i] !== z[i]) holes.push(i);
    const filled = holes.length;
    let guard = 0;
    while (holes.length && guard++ < 10000) {
      const vals = new Float32Array(holes.length);
      const rest = [];
      for (let k = 0; k < holes.length; k++) {
        const i = holes[k], r = (i / w) | 0, c = i % w;
        let s = 0, n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= h) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc;
            if (cc < 0 || cc >= w) continue;
            const v = z[rr * w + cc];
            if (v === v) { s += v; n++; }
          }
        }
        vals[k] = n ? s / n : NaN;
      }
      for (let k = 0; k < holes.length; k++) {
        if (vals[k] === vals[k]) z[holes[k]] = vals[k]; else rest.push(holes[k]);
      }
      if (rest.length === holes.length) break; // nothing valid at all
      holes = rest;
    }
    for (const i of holes) z[i] = 0;
    return filled;
  };

  /** Resample a sub-window of g (UTM bbox) to a new cell size (bilinear). */
  M.resampleGrid = (g, E0, N1, E1, N0, cs) => {
    const w = Math.max(2, Math.round((E1 - E0) / cs));
    const h = Math.max(2, Math.round((N1 - N0) / cs));
    const out = M.makeGrid({ w, h, cs, x0: E0, y0: N1, zone: g.zone, north: g.north, name: g.name, source: g.source, synthetic: g.synthetic });
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const p = M.cellToEN(out, r, c);
        const q = M.enToCell(g, p.E, p.N);
        out.z[r * w + c] = M.sample(g, g.z, q.r, q.c);
      }
    }
    return out;
  };

  /** Even-odd point-in-polygon on [[c, r], ...]. */
  M.pointInPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  /** Rasterise polygons ([[c, r], ...] in cell coords) into a mask (sets `value`). */
  M.rasterPolys = (g, polys, mask, value = 1) => {
    mask = mask || new Uint8Array(g.w * g.h);
    for (const poly of polys || []) {
      if (!poly || poly.length < 3) continue;
      let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
      for (const [c, r] of poly) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
      c0 = Math.max(0, Math.floor(c0)); c1 = Math.min(g.w - 1, Math.ceil(c1));
      r0 = Math.max(0, Math.floor(r0)); r1 = Math.min(g.h - 1, Math.ceil(r1));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++)
          if (M.pointInPoly(c, r, poly)) mask[r * g.w + c] = value;
    }
    return mask;
  };

  /** Rasterise polylines with a half-width (cells) into a mask. */
  M.rasterLines = (g, lines, mask, halfWidth = 0.5, value = 1) => {
    mask = mask || new Uint8Array(g.w * g.h);
    for (const line of lines || []) {
      for (let k = 1; k < (line || []).length; k++) {
        const [ca, ra] = line[k - 1], [cb, rb] = line[k];
        const len = Math.hypot(cb - ca, rb - ra);
        const n = Math.max(1, Math.ceil(len * 2));
        for (let s = 0; s <= n; s++) {
          const c = ca + ((cb - ca) * s) / n, r = ra + ((rb - ra) * s) / n;
          const hw = Math.ceil(halfWidth);
          for (let dr = -hw; dr <= hw; dr++)
            for (let dc = -hw; dc <= hw; dc++) {
              const rr = Math.round(r) + dr, cc = Math.round(c) + dc;
              if (rr < 0 || cc < 0 || rr >= g.h || cc >= g.w) continue;
              if (Math.hypot(rr - r, cc - c) <= halfWidth + 0.5) mask[rr * g.w + cc] = value;
            }
        }
      }
    }
    return mask;
  };
});
