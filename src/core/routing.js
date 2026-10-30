/*
 * MtnAI core — least-time route finding (A*) over an anisotropic cost surface.
 *
 * 16-connected moves (8 neighbours + knight moves) give smooth headings.
 * Cost = travel time from the movement model, optionally multiplied by
 * exposure to enemy observation and skyline (crest) penalties, so the same
 * search returns the fastest, a balanced or a covered (concealed) route.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function routing(M) {
  'use strict';

  const MOVES = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1],
    [-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]]) {
    MOVES.push({ dr, dc, len: Math.hypot(dr, dc) });
  }

  M.ROUTE_MODES = {
    fastest: { name: 'Fastest', exposureW: 0, skylineW: 0 },
    balanced: { name: 'Balanced (time vs exposure)', exposureW: 1.5, skylineW: 0.4 },
    covered: { name: 'Covered (avoid enemy observation)', exposureW: 6, skylineW: 1.2 },
  };
  /** Route mode weights, taking user configuration into account. */
  M.routeMode = (mode) => {
    const c = M.CFG;
    if (mode === 'balanced') return Object.assign({}, M.ROUTE_MODES.balanced, { exposureW: c.expBalanced, skylineW: c.skyBalanced });
    if (mode === 'covered') return Object.assign({}, M.ROUTE_MODES.covered, { exposureW: c.expCovered, skylineW: c.skyCovered });
    return M.ROUTE_MODES.fastest;
  };

  /** Max speed (m/s) a profile can reach — keeps the A* heuristic admissible. */
  const vmaxMS = (prof) => (Math.max(prof.speed, prof.road || 0) * (prof.kind === 'foot' ? Math.exp(3.5 * 0.05) : 1)) / 3.6;

  /**
   * A* search. ctx: {cls, slope, prof, trackMask?, exposure?, exposureW?,
   * crest?, skylineW?, penalty?}. start/end: cell indices.
   * Returns {path: Int32Array, cost (weighted s)} or null.
   */
  M.astar = (g, ctx, start, end, progress) => {
    const { w, h, cs, z } = g;
    const { cls, slope, prof } = ctx;
    const n = w * h;
    if (cls[start] === 2 || cls[end] === 2) return null;
    const gS = new Float64Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new M.MinHeap(4096);
    const vmax = vmaxMS(prof);
    const er = (end / w) | 0, ec = end % w;
    const hEst = (r, c) => (Math.hypot(r - er, c - ec) * cs) / vmax;
    gS[start] = 0;
    heap.push(hEst((start / w) | 0, start % w), start);
    const expW = ctx.exposureW || 0, skyW = ctx.skylineW || 0;
    let iter = 0;
    const nMoves = M.CFG.routeNeighbours === 8 ? 8 : 16;
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      if (cur === end) break;
      closed[cur] = 1;
      if (progress && (++iter & 0x3ffff) === 0) progress(Math.min(0.95, iter / n));
      const r = (cur / w) | 0, c = cur % w;
      const zc = z[cur], gc = gS[cur];
      for (let m = 0; m < nMoves; m++) {
        const mv = MOVES[m];
        const rr = r + mv.dr, cc = c + mv.dc;
        if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
        const nb = rr * w + cc;
        if (closed[nb] || cls[nb] === 2) continue;
        // no corner cutting through No-Go cells
        if (m >= 4 && m < 8) {
          if (cls[r * w + cc] === 2 || cls[rr * w + c] === 2) continue;
        } else if (m >= 8) {
          const sr = Math.sign(mv.dr), sc = Math.sign(mv.dc);
          const a = Math.abs(mv.dr) === 2 ? (r + sr) * w + c : r * w + c + sc;
          const b = Math.abs(mv.dr) === 2 ? (r + sr) * w + cc : rr * w + c + sc;
          if (cls[a] === 2 || cls[b] === 2) continue;
        }
        const dist = mv.len * cs;
        const grade = (z[nb] - zc) / dist;
        const onTrack = ctx.trackMask ? ctx.trackMask[nb] === 1 : false;
        const v = M.moveSpeed(prof, grade, slope[nb], cls[nb], z[nb], onTrack) / 3.6;
        let t = dist / v;
        let mult = 1;
        if (expW && ctx.exposure && ctx.exposure[nb]) mult += expW * Math.min(1, ctx.exposure[nb] / 2 + 0.5);
        if (skyW && ctx.crest && ctx.crest[nb]) mult += skyW;
        if (ctx.penalty) mult *= ctx.penalty[nb];
        t *= mult;
        const ng = gc + t;
        if (ng < gS[nb]) {
          gS[nb] = ng; from[nb] = cur;
          heap.push(ng + hEst(rr, cc), nb);
        }
      }
    }
    if (from[end] < 0 && start !== end) return null;
    const path = [];
    for (let p = end; p >= 0; p = from[p]) { path.push(p); if (p === start) break; }
    path.reverse();
    return { path: Int32Array.from(path), cost: gS[end] };
  };

  /** Statistics for a cell path. Returns stats incl. a simplified polyline [[c, r]]. */
  M.routeStats = (g, ctx, path, opts = {}) => {
    const { w, cs, z } = g;
    const { cls, slope, prof } = ctx;
    let len2 = 0, len3 = 0, up = 0, down = 0, time = 0, slowLen = 0, expLen = 0, maxGrade = 0, zMax = -Infinity;
    const cum = new Float64Array(path.length);
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      const ra = (a / w) | 0, ca = a % w, rb = (b / w) | 0, cb = b % w;
      const d = Math.hypot(rb - ra, cb - ca) * cs;
      const dz = z[b] - z[a];
      len2 += d; len3 += Math.hypot(d, dz);
      if (dz > 0) up += dz; else down -= dz;
      const grade = dz / d;
      maxGrade = Math.max(maxGrade, Math.atan(Math.abs(grade)) * 57.2958);
      const onTrack = ctx.trackMask ? ctx.trackMask[b] === 1 : false;
      time += d / (M.moveSpeed(prof, grade, slope[b], cls[b], z[b], onTrack) / 3.6);
      if (cls[b] === 1) slowLen += d;
      if (ctx.exposure && ctx.exposure[b]) expLen += d;
      if (z[b] > zMax) zMax = z[b];
      cum[k] = len2;
    }
    const pts = Array.from(path, (p) => [p % w, (p / w) | 0]);
    const line = M.simplify(pts, 0.6);
    // checkpoints every opts.cpEveryM along the route
    const cps = [];
    const every = opts.cpEveryM || 0;
    if (every > 0) {
      for (let k = 1, next = every; k < path.length; k++) {
        if (cum[k] >= next && len2 - cum[k] > every * 0.35) {
          cps.push({ r: (path[k] / w) | 0, c: path[k] % w, d: cum[k] });
          next += every;
        }
      }
    }
    return {
      lengthM: len2, length3dM: len3, ascentM: up, descentM: down, timeH: time / 3600,
      slowFrac: len2 ? slowLen / len2 : 0, exposedFrac: len2 ? expLen / len2 : 0,
      maxGradeDeg: maxGrade, highestM: zMax, line, checkpoints: cps,
    };
  };

  /**
   * Primary + alternative routes. Alternatives are found by penalising cells
   * near earlier routes and rejecting near-duplicates.
   */
  M.findRoutes = (g, ctx, start, end, opts = {}, progress) => {
    const k = Math.max(1, Math.min(4, opts.alternatives || 1));
    const out = [];
    const penalty = new Float32Array(g.w * g.h).fill(1);
    const rad = Math.max(2, Math.round((opts.separationM || M.CFG.altSepM) / g.cs));
    for (let i = 0; i < k + 2 && out.length < k; i++) {
      const res = M.astar(g, Object.assign({}, ctx, { penalty: i ? penalty : null }), start, end,
        progress ? (p) => progress((out.length + p) / k) : null);
      if (!res) break;
      // overlap with existing routes
      let overlap = 0;
      if (out.length) {
        for (const p of res.path) if (penalty[p] > 1) overlap++;
        overlap /= res.path.length;
      }
      if (!out.length || overlap < 0.75) {
        out.push(Object.assign({ path: res.path, overlap }, M.routeStats(g, ctx, res.path, opts)));
      }
      // penalise a corridor around this path
      for (const p of res.path) {
        const r = (p / g.w) | 0, c = p % g.w;
        for (let dr = -rad; dr <= rad; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= g.h) continue;
          for (let dc = -rad; dc <= rad; dc++) {
            const cc = c + dc;
            if (cc < 0 || cc >= g.w || dr * dr + dc * dc > rad * rad) continue;
            penalty[rr * g.w + cc] = 3;
          }
        }
      }
    }
    return out;
  };

  /** Multi-source least-time reachability (Dijkstra) — used for access checks. */
  M.reachable = (g, ctx, starts, maxTimeS = Infinity) => {
    const { w, h, cs, z } = g;
    const { cls, slope, prof } = ctx;
    const n = w * h;
    // Float64 to match the heap keys exactly (a Float32 store would make fresh entries look stale)
    const t = new Float64Array(n).fill(Infinity);
    const heap = new M.MinHeap(4096);
    for (const s of starts) if (cls[s] !== 2) { t[s] = 0; heap.push(0, s); }
    while (heap.size) {
      const cur = heap.pop();
      const tc = heap.lastKey;
      if (tc > t[cur]) continue;
      if (tc > maxTimeS) break;
      const r = (cur / w) | 0, c = cur % w;
      for (let m = 0; m < 8; m++) {
        const mv = MOVES[m];
        const rr = r + mv.dr, cc = c + mv.dc;
        if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
        const nb = rr * w + cc;
        if (cls[nb] === 2) continue;
        if (m >= 4 && (cls[r * w + cc] === 2 || cls[rr * w + c] === 2)) continue;
        const dist = mv.len * cs;
        const onTrack = ctx.trackMask ? ctx.trackMask[nb] === 1 : false;
        const v = M.moveSpeed(prof, (z[nb] - z[cur]) / dist, slope[nb], cls[nb], z[nb], onTrack) / 3.6;
        const nt = tc + dist / v;
        if (nt < t[nb]) { t[nb] = nt; heap.push(nt, nb); }
      }
    }
    return t;
  };
});
