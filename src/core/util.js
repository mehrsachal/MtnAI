/*
 * MtnAI core — shared utilities.
 *
 * Every core module registers a factory on globalThis.MTN_CORE. The factories
 * are self-contained (they only touch their argument `M` and JS built-ins), so
 * the same source can run on the main thread, inside a Blob Web Worker (their
 * source text is serialised with Function.prototype.toString) and under Node
 * for the unit tests.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function util(M) {
  'use strict';

  M.VERSION = '1.1.0';

  /**
   * Analysis configuration (user settings). The worker receives updates through
   * the `config` job; every core function reads its defaults from here.
   */
  M.CFG = {
    curvature: true, refraction: 0.13,          // intervisibility
    altStart: 2500, altRate: 0.08, altFloor: 0.55, // altitude penalty for foot / animal movement
    routeNeighbours: 16, altSepM: 350,           // routing
    expBalanced: 1.5, expCovered: 6, skyBalanced: 0.4, skyCovered: 1.2,
    hostileCount: 5, hostileSearchM: 3000, hostileRangeM: 8000, hostileObsH: 3, // enemy observation
    tpiSmallM: 250, tpiLargeM: 1500,             // landform scales
    mfdTieM: 30,                                 // minefield tie-in to No-Go ground
  };
  M.setConfig = (c) => Object.assign(M.CFG, c || {});

  M.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  M.lerp = (a, b, t) => a + (b - a) * t;
  M.smoothstep = (e0, e1, x) => {
    const t = M.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  M.deg = (rad) => (rad * 180) / Math.PI;
  M.rad = (deg) => (deg * Math.PI) / 180;
  /** Degrees -> NATO mils (6400 per circle). */
  M.mils = (deg) => (deg * 6400) / 360;
  /** Grid bearing (deg, clockwise from grid north) from a to b in metres. */
  M.bearing = (dE, dN) => {
    let b = M.deg(Math.atan2(dE, dN));
    if (b < 0) b += 360;
    return b;
  };

  /** Binary min-heap keyed by Float64 priority holding Int32 payloads. */
  class MinHeap {
    constructor(capacity = 1024) {
      this.k = new Float64Array(capacity);
      this.v = new Int32Array(capacity);
      this.n = 0;
    }
    get size() { return this.n; }
    push(key, val) {
      if (this.n === this.k.length) {
        const k2 = new Float64Array(this.n * 2); k2.set(this.k); this.k = k2;
        const v2 = new Int32Array(this.n * 2); v2.set(this.v); this.v = v2;
      }
      let i = this.n++;
      const k = this.k, v = this.v;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (k[p] <= key) break;
        k[i] = k[p]; v[i] = v[p]; i = p;
      }
      k[i] = key; v[i] = val;
    }
    /** Pops the smallest entry; returns its payload. Key is left in `lastKey`. */
    pop() {
      const k = this.k, v = this.v;
      const topV = v[0];
      this.lastKey = k[0];
      const n = --this.n;
      if (n > 0) {
        const key = k[n], val = v[n];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= key) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = key; v[i] = val;
      }
      return topV;
    }
  }
  M.MinHeap = MinHeap;

  /** Mulberry32 seeded PRNG. */
  M.rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /** Mean / std of the finite values of an array (optionally masked). */
  M.meanStd = (arr, mask) => {
    let s = 0, s2 = 0, n = 0;
    for (let i = 0; i < arr.length; i++) {
      if (mask && !mask[i]) continue;
      const x = arr[i];
      if (x !== x) continue;
      s += x; s2 += x * x; n++;
    }
    const mean = n ? s / n : 0;
    return { mean, std: n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : 0, n };
  };

  M.minMax = (arr) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i];
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    return { min: lo, max: hi };
  };

  /**
   * Greedy non-maximum suppression over cells.
   * items: [{r, c, score, ...}] (any order). Returns at most `limit` items whose
   * mutual distance (in cells) is >= minSepCells, best scores first.
   */
  M.nms = (items, minSepCells, limit) => {
    const sorted = items.slice().sort((a, b) => b.score - a.score);
    const out = [];
    const s2 = minSepCells * minSepCells;
    for (const it of sorted) {
      let ok = true;
      for (const o of out) {
        const dr = o.r - it.r, dc = o.c - it.c;
        if (dr * dr + dc * dc < s2) { ok = false; break; }
      }
      if (ok) {
        out.push(it);
        if (out.length >= limit) break;
      }
    }
    return out;
  };

  /** Weighted circular statistics of bearings (deg). Returns mean and central spread. */
  M.bearingSpread = (bearings, weights, central = 0.8) => {
    let sx = 0, sy = 0, sw = 0;
    for (let i = 0; i < bearings.length; i++) {
      const b = M.rad(bearings[i]);
      sx += Math.sin(b) * weights[i]; sy += Math.cos(b) * weights[i]; sw += weights[i];
    }
    if (!sw) return null;
    const mean = (M.deg(Math.atan2(sx, sy)) + 360) % 360;
    // signed offsets from the mean, then weighted quantiles
    const off = bearings.map((b, i) => ({ d: ((b - mean + 540) % 360) - 180, w: weights[i] }));
    off.sort((a, b) => a.d - b.d);
    const lo = (1 - central) / 2 * sw, hi = (1 + central) / 2 * sw;
    let acc = 0, left = off[0].d, right = off[off.length - 1].d, gotL = false;
    for (const o of off) {
      acc += o.w;
      if (!gotL && acc >= lo) { left = o.d; gotL = true; }
      if (acc >= hi) { right = o.d; break; }
    }
    return { mean, left: (mean + left + 360) % 360, right: (mean + right + 360) % 360, width: right - left };
  };

  /** Ramer–Douglas–Peucker simplification for [[x,y],...]. */
  M.simplify = (pts, tol) => {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    const t2 = tol * tol;
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
      let best = -1, bestD = t2;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = pts[i];
        let t = ((px - ax) * dx + (py - ay) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + t * dx - px, qy = ay + t * dy - py;
        const d = qx * qx + qy * qy;
        if (d > bestD) { bestD = d; best = i; }
      }
      if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
});
