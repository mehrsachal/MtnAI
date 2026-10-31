/*
 * MtnAI core — terrain derivatives: slope, aspect, hillshade, TPI landforms,
 * ruggedness, statistics, contours and key terrain (dominating heights, passes).
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function terrain(M) {
  'use strict';

  /** Horn (1981) 3x3 gradient. Returns {dx, dy}: dz/dEast and dz/dSouth (m/m). */
  M.gradient = (g) => {
    const { w, h, cs, z } = g;
    const dx = new Float32Array(w * h), dy = new Float32Array(w * h);
    const k = 1 / (8 * cs);
    for (let r = 0; r < h; r++) {
      const rn = r > 0 ? r - 1 : r, rs = r < h - 1 ? r + 1 : r;
      for (let c = 0; c < w; c++) {
        const cw = c > 0 ? c - 1 : c, ce = c < w - 1 ? c + 1 : c;
        const a = z[rn * w + cw], b = z[rn * w + c], cc = z[rn * w + ce];
        const d = z[r * w + cw], f = z[r * w + ce];
        const gg = z[rs * w + cw], hh = z[rs * w + c], ii = z[rs * w + ce];
        const sx = (ce - cw) / 2 || 1, sy = (rs - rn) / 2 || 1; // edge correction
        dx[r * w + c] = ((cc + 2 * f + ii) - (a + 2 * d + gg)) * k / sx;
        dy[r * w + c] = ((gg + 2 * hh + ii) - (a + 2 * b + cc)) * k / sy;
      }
    }
    return { dx, dy };
  };

  /** Slope (deg) and aspect (deg clockwise from grid north, downslope; -1 = flat). */
  M.slopeAspect = (g, grad) => {
    grad = grad || M.gradient(g);
    const n = g.w * g.h;
    const slope = new Float32Array(n), aspect = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const gx = grad.dx[i], gy = grad.dy[i];
      const s = Math.atan(Math.sqrt(gx * gx + gy * gy)) * 57.29577951308232;
      slope[i] = s;
      if (s < 1) { aspect[i] = -1; continue; }
      let a = Math.atan2(-gx, gy) * 57.29577951308232;
      if (a < 0) a += 360;
      aspect[i] = a;
    }
    return { slope, aspect };
  };

  /**
   * Hillshade 0..255. opts: {azimuth=315, altitude=45, zFactor=1, multi=false}
   * `multi` blends four illumination azimuths for readable relief in deep valleys.
   */
  M.hillshade = (g, grad, opts = {}) => {
    grad = grad || M.gradient(g);
    const az0 = opts.azimuth ?? 315, alt = opts.altitude ?? 45, zf = opts.zFactor ?? 1;
    const zen = M.rad(90 - alt);
    const cz = Math.cos(zen), sz = Math.sin(zen);
    const dirs = opts.multi ? [[az0 - 90, 0.15], [az0 - 45, 0.25], [az0, 0.4], [az0 + 45, 0.2]] : [[az0, 1]];
    const n = g.w * g.h;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const gx = grad.dx[i] * zf, gy = grad.dy[i] * zf;
      const s = Math.atan(Math.sqrt(gx * gx + gy * gy));
      const asp = Math.atan2(-gx, gy);
      const cs = Math.cos(s), ss = Math.sin(s);
      let v = 0;
      for (const [az, wgt] of dirs) v += wgt * Math.max(0, cz * cs + sz * ss * Math.cos(M.rad(az) - asp));
      out[i] = Math.round(M.clamp(v, 0, 1) * 255);
    }
    return out;
  };

  /** Topographic Position Index: z minus neighbourhood mean (radius in cells). */
  M.tpi = (g, radCells) => {
    const mean = M.boxMean(g.z, g.w, g.h, radCells);
    const out = new Float32Array(g.w * g.h);
    for (let i = 0; i < out.length; i++) out[i] = g.z[i] - mean[i];
    return out;
  };

  /** Landform / slope-position classes (Weiss 2001) from a standardised TPI. */
  M.LANDFORMS = [
    { id: 0, name: 'Valley / nullah floor' },
    { id: 1, name: 'Lower slope' },
    { id: 2, name: 'Flat / gentle ground' },
    { id: 3, name: 'Mid slope' },
    { id: 4, name: 'Upper slope (military crest zone)' },
    { id: 5, name: 'Ridge / crest' },
  ];
  M.landforms = (tpi, slope) => {
    const { std } = M.meanStd(tpi);
    const sd = std || 1;
    const out = new Uint8Array(tpi.length);
    for (let i = 0; i < tpi.length; i++) {
      const z = tpi[i] / sd;
      out[i] = z > 1 ? 5 : z > 0.5 ? 4 : z >= -0.5 ? (slope[i] > 6 ? 3 : 2) : z >= -1 ? 1 : 0;
    }
    return out;
  };

  /** Terrain Ruggedness Index: mean absolute elevation difference to the 8 neighbours (m). */
  M.tri = (g) => {
    const { w, h, z } = g;
    const out = new Float32Array(w * h);
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        const z0 = z[r * w + c];
        let s = 0, n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= h) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc;
            if ((!dr && !dc) || cc < 0 || cc >= w) continue;
            s += Math.abs(z[rr * w + cc] - z0); n++;
          }
        }
        out[r * w + c] = s / n;
      }
    return out;
  };

  M.SLOPE_CLASSES = [0, 5, 10, 15, 20, 30, 40, 50, 90];
  M.ASPECT_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  M.aspectClass = (a) => (a < 0 ? -1 : Math.floor(((a + 22.5) % 360) / 45));

  /** Summary statistics used by the Data tab and the report. */
  M.terrainStats = (g, slope, aspect, landform) => {
    const n = g.w * g.h;
    const { min, max } = M.minMax(g.z);
    const { mean } = M.meanStd(g.z);
    const bins = 24, hyp = new Array(bins).fill(0);
    const span = max - min || 1;
    const slopeHist = new Array(M.SLOPE_CLASSES.length - 1).fill(0);
    const rose = new Array(9).fill(0);
    const lf = new Array(M.LANDFORMS.length).fill(0);
    let sMean = 0, sMax = 0;
    for (let i = 0; i < n; i++) {
      hyp[Math.min(bins - 1, Math.floor(((g.z[i] - min) / span) * bins))]++;
      const s = slope[i];
      sMean += s; if (s > sMax) sMax = s;
      let k = 0;
      while (k < slopeHist.length - 1 && s >= M.SLOPE_CLASSES[k + 1]) k++;
      slopeHist[k]++;
      const a = M.aspectClass(aspect[i]);
      rose[a < 0 ? 8 : a]++;
      if (landform) lf[landform[i]]++;
    }
    const frac = (arr) => arr.map((v) => v / n);
    return {
      cells: n, areaKm2: (n * g.cs * g.cs) / 1e6,
      widthKm: (g.w * g.cs) / 1000, heightKm: (g.h * g.cs) / 1000,
      elevMin: min, elevMax: max, elevMean: mean, relief: max - min,
      hypsometry: { min, max, bins: frac(hyp) },
      slopeMean: sMean / n, slopeMax: sMax,
      slopeClasses: M.SLOPE_CLASSES, slopeHist: frac(slopeHist),
      aspectRose: frac(rose), landformFrac: frac(lf),
    };
  };

  /** "Nice" contour interval for a relief, aiming for ~30-50 levels. */
  M.niceInterval = (relief) => {
    const raw = relief / 40;
    const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500];
    for (const s of steps) if (s >= raw) return s;
    return 1000;
  };

  /**
   * Marching-squares contours. Returns {segs: Float32Array [c1,r1,c2,r2,...],
   * major: Uint8Array (1 = index contour), levels: Float32Array, interval}.
   */
  M.contours = (g, interval, majorEvery = 5) => {
    const { w, h, z } = g;
    const { min, max } = M.minMax(z);
    interval = interval || M.niceInterval(max - min);
    const first = Math.ceil(min / interval) * interval;
    const segs = [], major = [], levels = [];
    const edgePt = (e, c, r, L, tl, tr, br, bl) => {
      switch (e) {
        case 0: return [c + (L - tl) / (tr - tl), r];
        case 1: return [c + 1, r + (L - tr) / (br - tr)];
        case 2: return [c + (L - bl) / (br - bl), r + 1];
        default: return [c, r + (L - tl) / (bl - tl)];
      }
    };
    const TABLE = { 1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 6: [[0, 2]], 7: [[3, 0]], 8: [[3, 0]], 9: [[0, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]] };
    for (let r = 0; r < h - 1; r++) {
      for (let c = 0; c < w - 1; c++) {
        const tl = z[r * w + c], tr = z[r * w + c + 1], br = z[(r + 1) * w + c + 1], bl = z[(r + 1) * w + c];
        const lo = Math.min(tl, tr, br, bl), hi = Math.max(tl, tr, br, bl);
        if (hi < first) continue;
        let L = Math.ceil(lo / interval) * interval;
        if (L === lo) L += 0; // keep
        for (; L <= hi; L += interval) {
          const Lx = L + 1e-4; // avoid exact-equality degeneracy
          const idx = (tl > Lx ? 8 : 0) | (tr > Lx ? 4 : 0) | (br > Lx ? 2 : 0) | (bl > Lx ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          let pairs = TABLE[idx];
          if (!pairs) {
            const centre = (tl + tr + br + bl) / 4 > Lx;
            pairs = idx === 5 ? (centre ? [[3, 0], [2, 1]] : [[3, 2], [0, 1]]) : (centre ? [[0, 1], [3, 2]] : [[3, 0], [2, 1]]);
          }
          const isMajor = Math.round(L / interval) % majorEvery === 0 ? 1 : 0;
          for (const [e1, e2] of pairs) {
            const p = edgePt(e1, c, r, Lx, tl, tr, br, bl), q = edgePt(e2, c, r, Lx, tl, tr, br, bl);
            segs.push(p[0], p[1], q[0], q[1]);
            major.push(isMajor); levels.push(L);
          }
        }
      }
    }
    return { segs: new Float32Array(segs), major: new Uint8Array(major), levels: new Float32Array(levels), interval };
  };

  /**
   * Key terrain: dominating heights (peaks) and passes (cols / saddles).
   * Uses the large-scale TPI as a dominance measure and a ring sign-change test
   * for saddles. Returns {peaks:[{r,c,z,score}], passes:[{r,c,z,score}]}.
   */
  M.keyTerrain = (g, slope, tpiL, opts = {}) => {
    const { w, h, cs, z } = g;
    const peakRad = Math.max(3, Math.round((opts.peakRadiusM || 600) / cs));
    const maxPeaks = opts.maxPeaks || 20, maxPasses = opts.maxPasses || 15;
    const { min, max } = M.minMax(z);
    const sdL = M.meanStd(tpiL).std || 1;
    // ---- peaks
    const cands = [];
    for (let r = 1; r < h - 1; r++)
      for (let c = 1; c < w - 1; c++) {
        const i = r * w + c, v = z[i];
        if (v < z[i - 1] || v < z[i + 1] || v < z[i - w] || v < z[i + w] ||
            v < z[i - w - 1] || v < z[i - w + 1] || v < z[i + w - 1] || v < z[i + w + 1]) continue;
        if (tpiL[i] < (opts.minDominance ?? 0.5) * sdL) continue;
        cands.push(i);
      }
    const peaks = [];
    for (const i of cands) {
      const r = (i / w) | 0, c = i % w, v = z[i];
      let isMax = true;
      for (let dr = -peakRad; dr <= peakRad && isMax; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= h) continue;
        for (let dc = -peakRad; dc <= peakRad; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= w || dr * dr + dc * dc > peakRad * peakRad) continue;
          if (z[rr * w + cc] > v) { isMax = false; break; }
        }
      }
      if (!isMax) continue;
      peaks.push({ r, c, z: v, prominence: tpiL[i], score: tpiL[i] / sdL + (0.8 * (v - min)) / (max - min || 1) });
    }
    // ---- passes (saddles)
    const ringR = Math.max(3, Math.round((opts.passRingM || 240) / cs));
    const N = 16, ring = [];
    for (let k = 0; k < N; k++) ring.push([Math.sin((2 * Math.PI * k) / N) * ringR, -Math.cos((2 * Math.PI * k) / N) * ringR]);
    const relief = Math.max(15, opts.passReliefM || cs * 1.2);
    const passCands = [];
    for (let r = ringR; r < h - ringR; r += 1)
      for (let c = ringR; c < w - ringR; c += 1) {
        const i = r * w + c;
        if (slope[i] > 22) continue;
        const v = z[i];
        const d = new Float32Array(N);
        let hiMax = -Infinity, loMin = Infinity;
        for (let k = 0; k < N; k++) {
          d[k] = M.sample(g, z, r + ring[k][1], c + ring[k][0]) - v;
          if (d[k] > hiMax) hiMax = d[k];
          if (d[k] < loMin) loMin = d[k];
        }
        if (hiMax < relief || loMin > -relief) continue;
        // lobes: maximal runs of the same sign (dead band = relief/4)
        const band = relief / 4;
        const signs = [];
        for (let k = 0; k < N; k++) signs.push(d[k] > band ? 1 : d[k] < -band ? -1 : 0);
        const seq = [];
        for (let k = 0; k < N; k++) {
          const s = signs[k];
          if (!s) continue;
          if (!seq.length || seq[seq.length - 1].s !== s) seq.push({ s, ext: d[k] });
          else seq[seq.length - 1].ext = s > 0 ? Math.max(seq[seq.length - 1].ext, d[k]) : Math.min(seq[seq.length - 1].ext, d[k]);
        }
        if (seq.length > 1 && seq[0].s === seq[seq.length - 1].s) {
          const last = seq.pop();
          seq[0].ext = last.s > 0 ? Math.max(seq[0].ext, last.ext) : Math.min(seq[0].ext, last.ext);
        }
        const highs = seq.filter((s) => s.s > 0).map((s) => s.ext).sort((a, b) => b - a);
        const lows = seq.filter((s) => s.s < 0).map((s) => -s.ext).sort((a, b) => b - a);
        if (highs.length < 2 || lows.length < 2) continue;
        if (highs[1] < relief || lows[1] < relief) continue;
        passCands.push({ r, c, z: v, score: Math.min(highs[1], lows[1]) + 0.25 * (v - min) / 10 });
      }
    const sepCells = Math.max(4, Math.round(700 / cs));
    return {
      peaks: M.nms(peaks, peakRad, maxPeaks),
      passes: M.nms(passCands, sepCells, maxPasses),
    };
  };
});
