/*
 * MtnEye core — sector planning: area of interest + border line (LoC), terrain value
 * (dominance), ridge and nullah networks, Important Terrain Grounds (ITGs) with force
 * sizing, own deployment (forward / normal / strong point), fire coverage and
 * interlocking, border surveillance, enemy approaches, infiltration routes and enemy
 * courses of action. Every result carries a Good / Marginal / Not good rating with
 * reasons. Doctrine: GSP Mountain Warfare Sec 4, 7, 10, 12, 13, 15, 22.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function sector(M) {
  'use strict';

  const D8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const opt = (group, o) => Object.assign({}, M.SECTOR_DEFAULTS[group], ...Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ({ [k]: v })));

  M.SECTOR_DEFAULTS = {
    terrain: { ridgeKm2: 0.1, crestScaleM: 100, crestDropM: 5, nullahKm2: 0.4, valleyKm2: 15, minLineM: 400 },
    itg: { count: 15, peakRadiusM: 500, crestDropM: 60, maxRadiusM: 900, minDominance: 60, obsRangeM: 3000, minSepM: 700, minOnApproach: 3, approachBandM: 800, behindOwnM: 1000, maxApproaches: 6,
      wDominance: 0.4, wObs: 0.35, wBorder: 0.25, wAstride: 0.25, approachDepthM: 3000,
      sectionMaxPerimM: 1500, platoonMaxPerimM: 3500, companyMaxPerimM: 7000, good: 0.72, marginal: 0.58 },
    plan: { mode: 'normal', companies: 3, platoonsPerCompany: 3, borderPostSpacingM: 0, borderPostDepthM: 0, maxPostSlope: 35, platoonSepM: 800, strongPointSepM: 400, itgReachM: 900,
      hqMaxSlope: 15, hqDepthM: 1200, bnDepthM: 3000, mortar60R: 2500, mortar81R: 5600, obsH: 2, enemyOPs: 8, enemySearchM: 4000 },
    fire: { mgRangeM: 1200, lmgRangeM: 800, minCover: 2 },
    border: { bandM: 500, obsRangeM: 3000, minGapM: 300, maxExtraOPs: 4, opSearchM: 1500, good: 0.9, marginal: 0.7 },
    enemy: { profile: 'foot', entrySpacingM: 1500, entryDepthM: 1500, perObjective: 2, objectives: 6, separationM: 400,
      infilCount: 5, detectW: 6, nullahBonus: 0.25, options: 4 },
  };
  /** Mode presets (GSP Sec 12, 13): forward = strong border posts; normal = tiered; strong point = company strong points. */
  M.DEPLOY_MODES = {
    // tiers: share of platoons in the [forward, intermediate, depth] bands of ridge line — GSP Sec 12 para 8
    forward: { name: 'Forward defence', borderPostSpacingM: 1000, borderPostDepthM: 400, tiers: [0.7, 0.3, 0] },
    normal: { name: 'Normal defence (tiered)', borderPostSpacingM: 1500, borderPostDepthM: 700, tiers: [0.55, 0.25, 0.2] },
    strongpoint: { name: 'Strong point defence', borderPostSpacingM: 2500, borderPostDepthM: 700, tiers: null },
  };
  M.rate = (score, good = 0.6, marginal = 0.4) => (score >= good ? 'Good' : score >= marginal ? 'Marginal' : 'Not good');

  // =====================================================================
  // Sector frame: inside-sector mask, own / enemy side of the border, distance to border
  // =====================================================================
  M.sectorFrame = (g, sector, border, own) => {
    const n = g.w * g.h;
    const inSector = new Uint8Array(n);
    if (sector && sector.length >= 3) M.rasterPolys(g, [sector], inSector, 1); else inSector.fill(1);
    const side = new Int8Array(n);
    const borderDist = new Float32Array(n).fill(Infinity);
    if (border && border.length >= 2) {
      const seg = M.simplify(border, 0.5);
      // sign of the cross product with the nearest segment
      for (let r = 0; r < g.h; r++)
        for (let c = 0; c < g.w; c++) {
          let best = Infinity, sgn = 0;
          for (let k = 1; k < seg.length; k++) {
            const [ax, ay] = seg[k - 1], [bx, by] = seg[k];
            const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((c - ax) * dx + (r - ay) * dy) / L2));
            const px = ax + t * dx - c, py = ay + t * dy - r, d = px * px + py * py;
            if (d < best) { best = d; sgn = Math.sign(dx * (r - ay) - dy * (c - ax)) || 1; }
          }
          const i = r * g.w + c;
          borderDist[i] = Math.sqrt(best) * g.cs;
          side[i] = sgn;
        }
      // which sign is ours: own position, else the sector's centroid, else the larger in-sector share
      let ownSign = 0;
      if (own) ownSign = side[Math.round(own.r) * g.w + Math.round(own.c)];
      if (!ownSign && sector && sector.length >= 3) {
        let sum = 0;
        for (let i = 0; i < n; i++) if (inSector[i]) sum += side[i];
        ownSign = sum >= 0 ? 1 : -1;
      }
      if (!ownSign) ownSign = 1;
      for (let i = 0; i < n; i++) side[i] = side[i] === ownSign ? 1 : -1;
    } else side.fill(1);
    return { inSector, side, borderDist, hasBorder: !!(border && border.length >= 2), border: border || null, sector: sector || null };
  };

  /** Stations every `stepM` along a polyline: [{c, r, d (m along)}]. */
  M.lineStations = (g, line, stepM) => {
    const out = [];
    let acc = 0, next = 0;
    for (let k = 1; k < line.length; k++) {
      const [ax, ay] = line[k - 1], [bx, by] = line[k];
      const L = Math.hypot(bx - ax, by - ay) * g.cs;
      while (next <= acc + L) {
        const t = L ? (next - acc) / L : 0;
        out.push({ c: ax + (bx - ax) * t, r: ay + (by - ay) * t, d: next });
        next += stepM;
      }
      acc += L;
    }
    return out;
  };

  // =====================================================================
  // Terrain value (dominance 0-100), drainage, ridge and nullah networks
  // =====================================================================
  const pctRank = (vals, mask) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < vals.length; i++) if (mask[i]) { if (vals[i] < lo) lo = vals[i]; if (vals[i] > hi) hi = vals[i]; }
    const B = 2048, hist = new Float64Array(B + 1), span = hi - lo || 1;
    let tot = 0;
    for (let i = 0; i < vals.length; i++) if (mask[i]) { hist[Math.floor(((vals[i] - lo) / span) * B)]++; tot++; }
    for (let b = 1; b <= B; b++) hist[b] += hist[b - 1];
    return (v) => (tot ? hist[Math.max(0, Math.min(B, Math.floor(((v - lo) / span) * B)))] / tot : 0);
  };
  /** Dominance: regional and local topographic position plus relative height, as a percentile within the sector. */
  M.dominanceLayer = (g, L, inSector) => {
    const n = g.w * g.h;
    const zp = pctRank(g.z, inSector);
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = 0.5 * clamp01((L.tpiL[i] / L.sdL + 2) / 4) + 0.2 * clamp01((L.tpiS[i] / L.sdS + 2) / 4) + 0.3 * zp(g.z[i]);
    const rp = pctRank(raw, inSector);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = 100 * rp(raw[i]);
    return out;
  };

  /** Priority-flood depression filling, D8 receivers and flow accumulation (cells). sign -1 = ridges. */
  M.drainage = (g, sign = 1) => {
    const { w, h } = g, n = w * h, z = g.z;
    const fz = new Float32Array(n), seen = new Uint8Array(n), order = new Int32Array(n);
    const heap = new M.MinHeap(4 * (w + h));
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      if (r && c && r < h - 1 && c < w - 1) continue;
      const i = r * w + c;
      fz[i] = sign * z[i]; seen[i] = 1; heap.push(fz[i], i);
    }
    let k = 0;
    while (heap.size) {
      const i = heap.pop();
      order[k++] = i;
      const r = (i / w) | 0, c = i % w;
      for (const [dr, dc] of D8) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
        const j = rr * w + cc;
        if (seen[j]) continue;
        seen[j] = 1;
        fz[j] = Math.max(sign * z[j], fz[i] + 1e-3);
        heap.push(fz[j], j);
      }
    }
    const rec = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const r = (i / w) | 0, c = i % w;
      let best = 0, bj = -1;
      for (const [dr, dc] of D8) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
        const j = rr * w + cc, drop = (fz[i] - fz[j]) / (dr && dc ? Math.SQRT2 : 1);
        if (drop > best) { best = drop; bj = j; }
      }
      rec[i] = bj;
    }
    const acc = new Float32Array(n).fill(1);
    for (let q = n - 1; q >= 0; q--) { const i = order[q]; if (rec[i] >= 0) acc[rec[i]] += acc[i]; }
    return { rec, acc };
  };

  /**
   * Ridge network on the real (unfilled) surface: every cell points to its steepest-ascent neighbour,
   * so the slopes drain UP onto the crest and the flow then runs along the crest to the summit; the
   * up-slope area therefore collects on the crest lines themselves. (Flow on an inverted, pit-filled
   * DEM — drainage() with sign -1, used before — fills every massif above its saddles and draws
   * straight shortcuts across it, off the real crest: Safwan's 3D-view finding.)
   */
  M.crestFlow = (g) => {
    const { w, h, z } = g, n = w * h;
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => z[a] - z[b]);
    const rec = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const r = (i / w) | 0, c = i % w;
      let best = 0, bj = -1;
      for (const [dr, dc] of D8) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
        const j = rr * w + cc, rise = (z[j] - z[i]) / (dr && dc ? Math.SQRT2 : 1);
        if (rise > best) { best = rise; bj = j; }
      }
      rec[i] = bj;
    }
    const acc = new Float32Array(n).fill(1);
    for (let q = 0; q < n; q++) { const i = order[q]; if (rec[i] >= 0) acc[rec[i]] += acc[i]; }
    return { rec, acc };
  };

  /** Vectorise a channel network: cells with acc >= minCells, traced from heads downstream. */
  const traceNetwork = (g, dr, minCells, minLenCells) => {
    const { w } = g, n = w * g.h;
    const ch = new Uint8Array(n), hasDonor = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (dr.acc[i] >= minCells) ch[i] = 1;
    for (let i = 0; i < n; i++) if (ch[i] && dr.rec[i] >= 0) hasDonor[dr.rec[i]] = 1;
    const done = new Uint8Array(n), lines = [];
    const heads = [];
    for (let i = 0; i < n; i++) if (ch[i] && !hasDonor[i]) heads.push(i);
    heads.sort((a, b) => dr.acc[b] - dr.acc[a]);
    for (const h0 of heads) {
      const cells = [];
      let i = h0;
      while (i >= 0 && ch[i]) {
        cells.push(i);
        if (done[i]) break;
        done[i] = 1;
        i = dr.rec[i];
      }
      if (cells.length < minLenCells) continue;
      lines.push({ cells, line: M.simplify(cells.map((q) => [q % w, (q / w) | 0]), 0.7), maxAcc: dr.acc[cells[cells.length - 1]] });
    }
    return { lines, mask: ch };
  };

  M.traceNetwork = traceNetwork;

  /**
   * Crest strength (m): for every cell, along the best of four directions (N–S, E–W, two diagonals),
   * how far the ground falls on the LOWER of the two sides at scaleM — 0 where the cell is not on a
   * crest. Used to keep only the stretches of the ridge network that are true crests.
   */
  M.crestStrength = (g, scaleM = 100) => {
    const { w, h, z } = g, n = w * h, k = Math.max(1, Math.round(scaleM / g.cs));
    const out = new Float32Array(n);
    const AX = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = k; r < h - k; r++) for (let c = k; c < w - k; c++) {
      const i = r * w + c;
      let best = 0;
      for (const [dr, dc] of AX) best = Math.max(best, Math.min(z[i] - z[(r + dr * k) * w + c + dc * k], z[i] - z[(r - dr * k) * w + c - dc * k]));
      out[i] = best;
    }
    return out;
  };
  /** Keep the crest stretches of each line (strength >= dropM, gaps up to maxGap cells bridged), at least minLen cells long. */
  M.crestOnly = (g, lines, strength, dropM, minLen, maxGap = 3) => {
    const out = [];
    for (const l of lines) {
      let run = [], gap = 0;
      const flush = () => { while (run.length && strength[run[run.length - 1]] < dropM) run.pop(); if (run.length >= minLen) out.push(run); run = []; gap = 0; };
      for (const q of l.cells) {
        if (strength[q] >= dropM) { run.push(q); gap = 0; } else if (run.length && gap < maxGap) { run.push(q); gap++; } else flush();
      }
      flush();
    }
    return out.map((cells) => ({ cells, line: M.simplify(cells.map((q) => [q % g.w, (q / g.w) | 0]), 0.6), maxAcc: 0 }));
  };

  M.sectorTerrain = (T, o = {}) => {
    const { g, L, frame } = T;
    const p = opt('terrain', o);
    const cellKm2 = (g.cs * g.cs) / 1e6;
    const dom = M.dominanceLayer(g, L, frame.inSector);
    const wet = M.drainage(g, 1);
    const minLen = Math.max(3, Math.round(p.minLineM / g.cs));
    const nul = traceNetwork(g, wet, p.nullahKm2 / cellKm2, minLen);
    // ridge lines: steepest-ascent flow on the real surface (see M.crestFlow) — on the crests seen in 3D
    const net = traceNetwork(g, M.crestFlow(g), p.ridgeKm2 / cellKm2, minLen);
    const rid = { lines: M.crestOnly(g, net.lines, M.crestStrength(g, p.crestScaleM), p.crestDropM, minLen), mask: net.mask };
    const sideOf = (cells) => {
      let own = 0;
      for (const q of cells) if (frame.side[q] > 0) own++;
      return own / cells.length > 0.8 ? 'own' : own / cells.length < 0.2 ? 'enemy' : 'both';
    };
    const lenM = (cells) => {
      let d = 0;
      for (let k = 1; k < cells.length; k++) d += Math.hypot((cells[k] % g.w) - (cells[k - 1] % g.w), ((cells[k] / g.w) | 0) - ((cells[k - 1] / g.w) | 0));
      return d * g.cs;
    };
    const ridges = rid.lines.map((l, k) => {
      let s = 0;
      for (const q of l.cells) s += dom[q];
      const meanDom = s / l.cells.length;
      return { id: `RL${k + 1}`, line: l.line, lengthM: lenM(l.cells), meanDominance: meanDom, side: sideOf(l.cells), rating: M.rate(meanDom / 100, 0.7, 0.5) };
    }).sort((a, b) => b.meanDominance * Math.sqrt(b.lengthM) - a.meanDominance * Math.sqrt(a.lengthM));
    ridges.forEach((x, k) => (x.id = `RL${k + 1}`));
    const nullahs = nul.lines.map((l) => ({ line: l.line, lengthM: lenM(l.cells), catchKm2: l.maxAcc * cellKm2, type: l.maxAcc * cellKm2 >= p.valleyKm2 ? 'valley' : 'nullah', side: sideOf(l.cells) }))
      .sort((a, b) => b.catchKm2 - a.catchKm2);
    nullahs.forEach((x, k) => (x.id = `${x.type === 'valley' ? 'V' : 'N'}${k + 1}`));
    const valleyMask = new Uint8Array(g.w * g.h);
    for (let i = 0; i < valleyMask.length; i++) if (wet.acc[i] * cellKm2 >= p.valleyKm2) valleyMask[i] = 1;
    return { dominance: dom, ridges, nullahs, ridgeMask: rid.mask, nullahMask: nul.mask, valleyMask, wetAcc: wet.acc, params: p };
  };

  // =====================================================================
  // ITGs (Important Terrain Grounds) with footprint, size and force needed
  // =====================================================================
  M.forceFor = (perimM, p) => (perimM <= p.sectionMaxPerimM ? { echelon: 'section', troops: 10, platoons: 0.33 }
    : perimM <= p.platoonMaxPerimM ? { echelon: 'platoon', troops: 30, platoons: 1 }
      : perimM <= p.companyMaxPerimM ? { echelon: 'company', troops: 100, platoons: 3 } : { echelon: 'battalion', troops: 600, platoons: 9 });

  /** Cells that matter to the defender: enemy-side approach band near the border, nullahs, valleys and the border itself. */
  const approachMask = (T, terr, depthM) => {
    const { g, frame } = T;
    const m = new Uint8Array(g.w * g.h);
    for (let i = 0; i < m.length; i++) {
      if (frame.hasBorder && frame.side[i] < 0 && frame.borderDist[i] <= depthM) m[i] = 1;
      else if (terr && (terr.nullahMask[i] || terr.valleyMask[i]) && frame.inSector[i]) m[i] = 1;
      else if (frame.hasBorder && frame.borderDist[i] <= g.cs) m[i] = 1;
    }
    return m;
  };

  /**
   * Enemy approaches to the Own Position: one least-time map (Dijkstra) from own position for enemy
   * infantry, then from every entry point on the enemy side of the border (or the enemy marker) the
   * path is traced downhill in time to own position. Near-duplicate paths are dropped; the fastest
   * `max` are kept. Also returns the distance (m) of every cell from the nearest approach.
   */
  /**
   * Movement context for enemy approach analysis. IPB: "NO-GO terrain does not necessarily mean that
   * units cannot pass through that terrain, but only that ... the speed of movement will be
   * substantially reduced". So ground that is NO-GO only because of slope is crossed at a quarter of
   * the speed; cliffs steeper than 45 degrees and drawn obstacles stay impassable.
   */
  M.enemyMoveCtx = (T, mob) => {
    const { g, L } = T, n = g.w * g.h;
    const cls = mob.cls.slice(), penalty = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) if (cls[i] === 2 && L.slope[i] >= mob.prof.slow && L.slope[i] <= 45 && !(mob.obstacleMask && mob.obstacleMask[i])) { cls[i] = 1; penalty[i] = 4; }
    return { cls, slope: L.slope, prof: mob.prof, trackMask: mob.trackMask, penalty };
  };

  /** IPB: slope NO-GO slows foot movement (x4) but does not stop it; drawn No-Go areas and slopes over 45 deg stay impassable. Vehicles unchanged. */
  M.slowPassMob = (g, slope, mob) => {
    if (!mob.prof || mob.prof.kind !== 'foot') return mob;
    const n = g.w * g.h, cls = mob.cls.slice(), penalty = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) if (cls[i] === 2 && slope[i] >= mob.prof.slow && slope[i] <= 45 && !(mob.obstacleMask && mob.obstacleMask[i])) { cls[i] = 1; penalty[i] = 4; }
    return Object.assign({}, mob, { cls, penalty, strictCls: mob.cls });
  };

  M.ownApproaches = (T, o = {}) => {
    const { g, L, frame } = T;
    if (!T.own) return null;
    const pe = opt('enemy', {});
    const mob = T.mob('foot');
    const ctx = M.enemyMoveCtx(T, mob);
    const n = g.w * g.h;
    let goal = Math.round(T.own.r) * g.w + Math.round(T.own.c);
    if (ctx.cls[goal] === 2) goal = M.nearestPassable(g, ctx.cls, T.own, 2500);
    if (goal < 0) return null;
    const t = M.reachable(g, ctx, [goal], 24 * 3600);
    let entries = frame.hasBorder ? entryPoints(T, { cls: ctx.cls }, pe) : [];
    if (!entries.length && T.threat) entries = [{ r: Math.round(T.threat.r), c: Math.round(T.threat.c), i: Math.round(T.threat.r) * g.w + Math.round(T.threat.c) }];
    const routes = [];
    const ranked = entries.filter((e) => t[e.i] < Infinity).sort((x, y) => t[x.i] - t[y.i]);
    for (const e of ranked) {
      if (routes.length >= (o.max || 6)) break;
      const path = [e.i];
      let cur = e.i, guard = 0;
      while (cur !== goal && guard++ < n) {
        const r = (cur / g.w) | 0, c = cur % g.w;
        let best = cur, bt = t[cur];
        for (const [dr, dc] of D8) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= g.h || cc >= g.w) continue;
          const j = rr * g.w + cc;
          if (t[j] < bt) { bt = t[j]; best = j; }
        }
        if (best === cur) break;
        path.push(best); cur = best;
      }
      if (cur !== goal) continue;
      if (routes.some((x) => overlap(x.path, path) > 0.6)) continue;
      const st = M.routeStats(g, ctx, path, {});
      routes.push({ path, timeH: t[e.i] / 3600, lengthM: st.lengthM, gspDay: st.gspDay, gspNight: st.gspNight, entry: { r: e.r, c: e.c } });
    }
    // distance from the nearest approach (two-pass chamfer transform)
    const dist = new Float32Array(n).fill(1e9);
    for (const rt of routes) for (const q of rt.path) dist[q] = 0;
    const d1 = g.cs, d2 = g.cs * Math.SQRT2;
    for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
      const i = r * g.w + c; let v = dist[i];
      if (c > 0) v = Math.min(v, dist[i - 1] + d1);
      if (r > 0) { v = Math.min(v, dist[i - g.w] + d1); if (c > 0) v = Math.min(v, dist[i - g.w - 1] + d2); if (c < g.w - 1) v = Math.min(v, dist[i - g.w + 1] + d2); }
      dist[i] = v;
    }
    for (let r = g.h - 1; r >= 0; r--) for (let c = g.w - 1; c >= 0; c--) {
      const i = r * g.w + c; let v = dist[i];
      if (c < g.w - 1) v = Math.min(v, dist[i + 1] + d1);
      if (r < g.h - 1) { v = Math.min(v, dist[i + g.w] + d1); if (c < g.w - 1) v = Math.min(v, dist[i + g.w + 1] + d2); if (c > 0) v = Math.min(v, dist[i + g.w - 1] + d2); }
      dist[i] = v;
    }
    routes.forEach((rt, k) => (rt.id = `A${k + 1}`));
    return { routes, dist, goal };
  };

  M.findITGs = (T, terr, o = {}, progress) => {
    const { g, L, frame } = T;
    const p = opt('itg', o);
    const dom = terr.dominance;
    const R = Math.max(2, Math.round(p.peakRadiusM / g.cs));
    const st = Math.max(1, Math.round(Math.sqrt((g.w * g.h) / 260000)));
    // Own Position is the ground to defend: ITGs lie astride the enemy approaches to it and not far
    // behind it (GSP Sec 12: hold the dominating features astride and on the flanks of the axis).
    progress && progress(0.02, 'Enemy approaches to own position');
    const appr = null; // ITGs follow GSP Sec 12 para 4c: dominating features covering the approaches (no own-position axis)
    const useAppr = !!(appr && appr.routes.length);
    const ownI = T.own ? Math.round(T.own.r) * g.w + Math.round(T.own.c) : -1;
    const ownBD = frame.hasBorder && ownI >= 0 ? frame.borderDist[ownI] : Infinity;
    const notBehind = () => true;
    const ok = (i) => frame.inSector[i] && frame.side[i] > 0 && notBehind(i);
    const summits = (rad, minDom, extra) => {
      const out = [];
      for (let r = rad; r < g.h - rad; r += st)
        for (let c = rad; c < g.w - rad; c += st) {
          const i = r * g.w + c;
          if (!ok(i) || dom[i] < minDom || (extra && !extra(i))) continue;
          let top = true;
          for (let dr = -rad; dr <= rad && top; dr += st) for (let dc = -rad; dc <= rad; dc += st) {
            if (dr * dr + dc * dc > rad * rad) continue;
            if (g.z[(r + dr) * g.w + c + dc] > g.z[i]) { top = false; break; }
          }
          if (top) out.push({ r, c, i, score: dom[i] });
        }
      return out;
    };
    let picked = M.nms(summits(R, p.minDominance), p.minSepM / g.cs, p.count * 4);
    // Approaches need holding even where no dominating summit lies right on them: if too few ITGs lie
    // within approachBandM of an approach, add the best local summits there (smaller search radius,
    // lower dominance threshold). They are rated on the same scale as every other ITG.
    const onAppr = (i) => useAppr && appr.dist[i] <= p.approachBandM;
    if (useAppr && p.minOnApproach > 0 && picked.filter((q) => onAppr(q.i)).length < p.minOnApproach) {
      const R2 = Math.max(2, Math.round(R / 2));
      const fc = summits(R2, Math.max(0, p.minDominance - 25), onAppr)
        .filter((q) => !picked.some((x) => Math.hypot(x.r - q.r, x.c - q.c) * g.cs < p.minSepM))
        .map((q) => Object.assign(q, { score: q.score + 100 * (1 - appr.dist[q.i] / p.approachBandM), approachAdded: true }));
      picked = picked.concat(M.nms(fc, p.minSepM / g.cs, p.minOnApproach - picked.filter((q) => onAppr(q.i)).length));
    }
    // what an ITG should see: the approaches to own position (+ the border line), else the old mask
    let target;
    if (useAppr) {
      target = new Uint8Array(g.w * g.h);
      for (let i = 0; i < target.length; i++) if (appr.dist[i] <= 300 || (frame.hasBorder && frame.borderDist[i] <= g.cs)) target[i] = 1;
    } else target = approachMask(T, terr, p.approachDepthM);
    let tgtTotal = 0;
    for (const v of target) tgtTotal += v;
    const maxR = Math.round(p.maxRadiusM / g.cs);
    const nearestRoute = (i) => {
      if (!useAppr) return null;
      let best = null, bd = Infinity;
      const r0 = (i / g.w) | 0, c0 = i % g.w;
      for (const rt of appr.routes) for (const q of rt.path) { const d = Math.hypot(((q / g.w) | 0) - r0, (q % g.w) - c0); if (d < bd) { bd = d; best = rt.id; } }
      return best;
    };
    const out = picked.map((q, k) => {
      if (progress && k % 4 === 0) progress(0.1 + (0.8 * k) / picked.length, `ITG ${k + 1}/${picked.length}`);
      // footprint: connected cells within crestDrop of the summit and maxRadius of it
      const zTop = g.z[q.i], seen = new Set([q.i]), queue = [q.i];
      let perimEdges = 0;
      while (queue.length) {
        const i = queue.pop(), r = (i / g.w) | 0, c = i % g.w;
        for (const [dr, dc] of D8.slice(0, 4)) {
          const rr = r + dr, cc = c + dc, j = rr * g.w + cc;
          const okc = rr >= 0 && cc >= 0 && rr < g.h && cc < g.w && g.z[j] >= zTop - p.crestDropM && Math.hypot(rr - q.r, cc - q.c) <= maxR;
          if (!okc) { perimEdges++; continue; }
          if (!seen.has(j)) { seen.add(j); queue.push(j); }
        }
      }
      const cells = [...seen];
      const outline = hull(cells.map((i) => [i % g.w, (i / g.w) | 0]));
      // perimeter to be held = length of the feature's outline (convex hull), not the cell-edge count,
      // which over-states a jagged raster boundary by about a quarter
      let perimM = 0;
      for (let k = 0; k < outline.length; k++) { const a1 = outline[k], b1 = outline[(k + 1) % outline.length]; perimM += Math.hypot(b1[0] - a1[0], b1[1] - a1[1]) * g.cs; }
      if (!perimM) perimM = perimEdges * g.cs;
      const areaHa = (cells.length * g.cs * g.cs) / 1e4;
      const vs = M.viewshed(g, q.r, q.c, { obsH: 2, tgtH: 1.5, radiusM: p.obsRangeM });
      let seenT = 0;
      for (let i = 0; i < target.length; i++) if (target[i] && vs.mask[i]) seenT++;
      const obsShare = tgtTotal ? seenT / tgtTotal : 0;
      const bd = frame.hasBorder ? frame.borderDist[q.i] : null;
      let third, reasons;
      if (useAppr) {
        // astride: on or close to an approach to own position (1 on it, 0 at 1.5 km)
        const da = appr.dist[q.i];
        third = p.wAstride * clamp01(1 - da / 1500);
        const rid = nearestRoute(q.i);
        reasons = [`dominance ${Math.round(dom[q.i])}/100`, `sees ${Math.round(obsShare * 100)}% of the approaches to own position`,
          da <= 2 * g.cs ? `astride approach ${rid}` : `${Math.round(da)} m from approach ${rid}`];
      } else {
        third = p.wBorder * (bd === null ? 0.5 : clamp01(1 - bd / (2 * p.approachDepthM)));
        reasons = [`dominance ${Math.round(dom[q.i])}/100`, `sees ${Math.round(obsShare * 100)}% of approaches / nullahs`];
      }
      if (q.approachAdded) reasons.push('added to hold an approach (best local summit on it)');
      if (bd !== null) reasons.push(`${(bd / 1000).toFixed(1)} km from border`);
      const score = p.wDominance * (dom[q.i] / 100) + third; // + observation term, normalised below
      let slope = 0;
      for (const i of cells) slope += L.slope[i];
      const force = M.forceFor(perimM, p);
      return { r: q.r, c: q.c, z: zTop, dominance: dom[q.i], areaHa, perimeterM: perimM, outline, obsShare, borderDistM: bd, meanSlope: slope / cells.length,
        approachDistM: useAppr ? appr.dist[q.i] : null, score, force, reasons, landform: M.LANDFORMS[L.landform[q.i]].name, i: q.i, approachAdded: !!q.approachAdded };
    });
    const maxObs = Math.max(1e-6, ...out.map((x) => x.obsShare));
    out.forEach((x) => { x.obsIndex = x.obsShare / maxObs; x.score += p.wObs * x.obsIndex; x.rating = M.rate(x.score, p.good, p.marginal); });
    out.sort((a, b) => b.score - a.score);
    if (useAppr && p.minOnApproach > 0) {
      // keep at least minOnApproach ITGs on the approaches when cutting the list to `count`
      const keep = out.filter((x) => x.approachDistM <= p.approachBandM).slice(0, p.minOnApproach);
      const rest = out.filter((x) => !keep.includes(x)).slice(0, Math.max(0, p.count - keep.length));
      out.length = 0; out.push(...keep.concat(rest).sort((a, b) => b.score - a.score));
    } else out.splice(p.count);
    out.forEach((x) => delete x.i);
    out.forEach((x, k) => (x.id = `ITG ${k + 1}`));
    const ownAppr = useAppr ? appr.routes.map((rt) => ({ id: rt.id, line: M.simplify(rt.path.map((q) => [q % g.w, (q / g.w) | 0]), 0.6), timeH: rt.timeH, lengthM: rt.lengthM, gspDay: rt.gspDay, gspNight: rt.gspNight, entry: rt.entry })) : [];
    const res = { itgs: out, params: p, ownApproaches: ownAppr, ownBorderDistM: null };
    Object.defineProperty(res, 'apprDist', { value: useAppr ? appr.dist : null, enumerable: false }); // not cloned to the UI
    return res;
  };
  const hull = (pts) => {
    if (pts.length < 3) return pts;
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1)).map(([c, r]) => [c, r]);
  };

  // =====================================================================
  // Enemy observation of own ground (from dominating points on the enemy side)
  // =====================================================================
  const enemyObservation = (T, terr, p) => {
    const { g, frame } = T;
    if (!frame.hasBorder) return null;
    const cands = [];
    const st = Math.max(2, Math.round(300 / g.cs));
    for (let r = 0; r < g.h; r += st) for (let c = 0; c < g.w; c += st) {
      const i = r * g.w + c;
      if (frame.side[i] < 0 && frame.borderDist[i] <= p.enemySearchM) cands.push({ r, c, score: terr.dominance[i] });
    }
    const obs = M.nms(cands, 800 / g.cs, p.enemyOPs);
    return { count: M.viewshedCount(g, obs, { obsH: 3, tgtH: 1.5, radiusM: 8000 }), ops: obs };
  };

  // =====================================================================
  // Own deployment plan
  // =====================================================================
  const pickSite = (T, cx, cy, radCells, ok, score) => {
    const { g } = T;
    let best = null, bs = -Infinity;
    const R = Math.ceil(radCells), st = Math.max(1, Math.round(R / 25));
    for (let dr = -R; dr <= R; dr += st) for (let dc = -R; dc <= R; dc += st) {
      if (dr * dr + dc * dc > R * R) continue;
      const r = Math.round(cy + dr), c = Math.round(cx + dc);
      if (!M.inGrid(g, r, c)) continue;
      const i = r * g.w + c;
      if (!ok(i, r, c)) continue;
      const s = score(i, r, c);
      if (s > bs) { bs = s; best = { r, c, i }; }
    }
    return best;
  };

  M.deploymentPlan = (T, terr, itgRes, o = {}, progress) => {
    const { g, L, frame } = T;
    const mode = M.DEPLOY_MODES[o.mode] ? o.mode : 'normal';
    const p = opt('plan', Object.assign({}, M.DEPLOY_MODES[mode], o));
    p.borderPostSpacingM = +o.borderPostSpacingM || M.DEPLOY_MODES[mode].borderPostSpacingM;
    p.borderPostDepthM = +o.borderPostDepthM || M.DEPLOY_MODES[mode].borderPostDepthM;
    const dom = terr.dominance;
    const enemy = enemyObservation(T, terr, p);
    const seenByEnemy = (i) => (enemy ? enemy.count[i] : 0);
    const notes = [];
    // 1. border posts along the line (own side, within depth, on dominant ground)
    progress && progress(0.1, 'Border posts');
    const borderPosts = [];
    if (frame.hasBorder) {
      const st = M.lineStations(g, frame.border, p.borderPostSpacingM);
      const depth = p.borderPostDepthM;
      st.forEach((s) => {
        const site = pickSite(T, s.c, s.r, Math.max(depth, p.borderPostSpacingM / 2) / g.cs,
          (i) => frame.side[i] > 0 && frame.borderDist[i] <= depth && L.slope[i] <= p.maxPostSlope && frame.inSector[i],
          (i, r, c) => dom[i] - 0.02 * Math.hypot(r - s.r, c - s.c) * g.cs / 10);
        if (site && !borderPosts.some((q) => Math.hypot(q.r - site.r, q.c - site.c) * g.cs < p.borderPostSpacingM * 0.5)) borderPosts.push(Object.assign(site, { alongM: s.d }));
      });
      borderPosts.forEach((q, k) => {
        q.id = `BP${k + 1}`; q.z = g.z[q.i];
        const prev = borderPosts[k - 1], next = borderPosts[k + 1];
        const losTo = (b) => !b || M.lineOfSight(g, q, b, { obsH: p.obsH, tgtH: p.obsH }).visible;
        q.linkedPrev = losTo(prev); q.linkedNext = losTo(next);
        const linked = (q.linkedPrev ? 1 : 0) + (q.linkedNext ? 1 : 0), ends = (prev ? 1 : 0) + (next ? 1 : 0);
        const sc = 0.5 * (ends ? linked / ends : 1) + 0.3 * (dom[q.i] / 100) + 0.2 * (seenByEnemy(q.i) ? 0.3 : 1);
        q.rating = M.rate(sc, 0.65, 0.45);
        q.reasons = [ends ? `intervisible with ${linked}/${ends} neighbours` : 'single post', `dominance ${Math.round(dom[q.i])}`, seenByEnemy(q.i) ? 'seen from the enemy side' : 'hidden from the enemy side'];
      });
    }
    // 2. platoon posts — on the ridge lines, dispersed (GSP Sec 12: hold the dominating ground; posts
    //    spread so that one shell, one OP or one infiltrating party cannot deal with two of them)
    progress && progress(0.35, 'Platoon posts on the ridge lines');
    const itgs = itgRes.itgs.slice();
    const nPl = p.companies * p.platoonsPerCompany;
    const platoons = [];
    const depthOf = (q) => (frame.hasBorder ? frame.borderDist[q.r * g.w + q.c] : 0);
    const R1 = (x) => Math.round(x);
    // every ridge-line cell on our side that can take a post, scored
    const near = (q, itg) => Math.hypot(q.r - itg.r, q.c - itg.c) * g.cs;
    const itgOf = (q) => { let best = null, bd = Infinity; for (const x of itgs) { const d = near(q, x); if (d < bd) { bd = d; best = x; } } return bd <= Math.max(600, p.itgReachM) ? best : null; };
    const cands = [];
    const stepCells = Math.max(1, Math.round(60 / g.cs));
    for (const rl of terr.ridges || []) {
      const L2 = rl.line;
      for (let k = 1; k < L2.length; k++) {
        const [c0, r0] = L2[k - 1], [c1, r1] = L2[k], m = Math.max(1, Math.ceil(Math.hypot(c1 - c0, r1 - r0) / stepCells));
        for (let s2 = 0; s2 < m; s2++) {
          const q = { c: R1(c0 + ((c1 - c0) * s2) / m), r: R1(r0 + ((r1 - r0) * s2) / m) };
          if (q.r < 0 || q.c < 0 || q.r >= g.h || q.c >= g.w) continue;
          const i2 = q.r * g.w + q.c;
          if (!frame.inSector[i2] || frame.side[i2] <= 0 || L.slope[i2] > p.maxPostSlope) continue;
          const itg = itgOf(q);
          const score = 0.45 * (dom[i2] / 100) + 0.25 * (itg ? itg.score : 0) + 0.15 * (seenByEnemy(i2) ? 0.3 : 1) + 0.15 * (rl.meanDominance / 100);
          cands.push({ r: q.r, c: q.c, i: i2, ridge: rl.id, itg, score, depth: frame.hasBorder ? frame.borderDist[i2] : 0 });
        }
      }
    }
    // fall back to ITG summits when the sector has no usable ridge line
    if (!cands.length) itgs.forEach((x) => cands.push({ r: x.r, c: x.c, i: x.r * g.w + x.c, ridge: null, itg: x, score: x.score, depth: depthOf(x) }));
    const capOf = (itg) => (!itg ? 1 : mode === 'strongpoint' ? p.platoonsPerCompany : Math.max(1, Math.ceil(itg.force.platoons)));
    const take = (pool, n, sepM, label) => {
      let got = 0;
      const sorted = pool.slice().sort((a, b) => b.score - a.score);
      for (const cd of sorted) {
        if (got >= n) break;
        if (platoons.some((q) => Math.hypot(q.r - cd.r, q.c - cd.c) * g.cs < sepM)) continue;
        if (cd.itg && platoons.filter((q) => q.itgRef === cd.itg).length >= capOf(cd.itg)) continue;
        // spread over the ridge lines: a second post on the same ridge line ranks a little lower
        platoons.push({ r: cd.r, c: cd.c, z: g.z[cd.i], itg: cd.itg ? cd.itg.id : cd.ridge, itgRef: cd.itg, ridge: cd.ridge, role: label, depthM: cd.depth });
        got++;
      }
      return got;
    };
    let sepUsed = p.platoonSepM;
    if (mode === 'strongpoint') {
      itgs.sort((a, b) => b.score - a.score); // ITG score already weighs dominance most
      for (const itg of itgs.slice(0, p.companies)) {
        const pool = cands.filter((cd) => near(cd, itg) <= Math.max(1200, p.itgReachM) && (!cd.itg || cd.itg === itg)).map((cd) => Object.assign({}, cd, { itg }));
        let sep = p.strongPointSepM, got = take(pool, p.platoonsPerCompany, sep, 'ridge line — strong point');
        while (got < p.platoonsPerCompany && sep > 150) { sep *= 0.7; got += take(pool, p.platoonsPerCompany - got, sep, 'ridge line — strong point'); }
        // no ridge-line room left: spread the rest round the feature's outline (farthest from the posts already there)
        for (; got < p.platoonsPerCompany; got++) {
          const mine = platoons.filter((q) => q.itgRef === itg);
          let best = { c: itg.c, r: itg.r }, bd = -1;
          for (const [c, r] of (itg.outline && itg.outline.length ? itg.outline : [[itg.c, itg.r]])) {
            const d = Math.min(...mine.map((q) => Math.hypot(q.r - r, q.c - c)), Infinity);
            if (d > bd) { bd = d; best = { c: Math.round(c), r: Math.round(r) }; }
          }
          platoons.push({ r: best.r, c: best.c, z: g.z[best.r * g.w + best.c], itg: itg.id, itgRef: itg, ridge: 'summit', role: 'ridge line — strong point', depthM: depthOf(best) });
        }
      }
      notes.push(`Strong point defence: each company holds the most dominating ITG with 30 days’ staying power; its platoons are on the ridge lines of the feature, at least ${Math.round(p.strongPointSepM)} m apart where the ground allows; gaps are covered by fire, mines and patrols (GSP Sec 12 para 9, Sec 13).`);
    } else {
      // tiers: shares of the platoons in the forward, intermediate and depth bands of ridge line (GSP Sec 12 para 8)
      const shares = M.DEPLOY_MODES[mode].tiers;
      const ds = cands.map((cd) => cd.depth).sort((a, b) => a - b);
      const q3 = (f) => (ds.length ? ds[Math.min(ds.length - 1, Math.floor(f * ds.length))] : 0);
      const e1 = q3(1 / 3), e2 = q3(2 / 3);
      const bands = [
        { name: 'forward', pool: cands.filter((cd) => cd.depth <= e1) },
        { name: 'intermediate', pool: cands.filter((cd) => cd.depth > e1 && cd.depth <= e2) },
        { name: 'depth', pool: cands.filter((cd) => cd.depth > e2) },
      ];
      const want = shares.map((x) => Math.round(nPl * x));
      want[0] += nPl - want.reduce((a, b) => a + b, 0);
      const bandOf = (d) => (d <= e1 ? 0 : d <= e2 ? 1 : 2);
      bands.forEach((b) => (b.got = 0));
      // first the important ground: one post on each Good / Marginal ITG, best first (GSP Sec 12 para 4c)
      // forward defence takes the ITGs nearest the border first; the others the best-scoring
      const order = mode === 'forward' ? itgs.slice().sort((a, b) => depthOf(a) - depthOf(b) || b.score - a.score) : itgs.slice().sort((a, b) => b.score - a.score);
      for (const itg of order) {
        if (platoons.length >= nPl) break;
        if (itg.rating === 'Not good') continue;
        const pool = cands.filter((cd) => cd.itg === itg);
        const k = bandOf(pool.length ? pool[0].depth : depthOf(itg));
        if (bands[k].got >= want[k]) continue; // the band's share is full (tiers of the mode)
        if (take(pool.length ? pool : [{ r: itg.r, c: itg.c, i: itg.r * g.w + itg.c, ridge: 'summit', itg, score: itg.score, depth: depthOf(itg) }], 1, p.platoonSepM, `ridge line — ${bands[k].name}`)) bands[k].got++;
      }
      let short = 0;
      bands.forEach((b, k) => { const n2 = Math.max(0, Math.min(want[k] - b.got, nPl - platoons.length)); const got = take(b.pool, n2, p.platoonSepM, `ridge line — ${b.name}`); b.got += got; short += n2 - got; });
      short = Math.max(short, nPl - platoons.length);
      // a band with too few sites: the rest go to the other bands, nearest band first
      for (const k of [1, 0, 2]) if (short > 0) { const got = take(bands[k].pool, short, p.platoonSepM, `ridge line — ${bands[k].name}`); bands[k].got += got; short -= got; }
      short = nPl - platoons.length;
      // still short: relax the spacing step by step (never below 300 m)
      while (short > 0 && sepUsed > 300) {
        sepUsed = Math.max(300, sepUsed * 0.8);
        for (const b of bands) { if (short <= 0) break; const got = take(b.pool, short, sepUsed, `ridge line — ${b.name}`); b.got += got; short -= got; }
      }
      for (let k = 0; short > 0 && itgs.length; k++, short--) { const x = itgs[k % itgs.length]; platoons.push({ r: x.r, c: x.c, z: x.z, itg: x.id, itgRef: x, ridge: 'summit', role: 'ridge line — forward', depthM: depthOf(x) }); }
      const cnt = (nm) => platoons.filter((q) => q.role === `ridge line — ${nm}`).length;
      notes.push(`${mode === 'forward' ? 'Forward' : 'Normal'} defence on the ridge lines (GSP Sec 12 para 8): ${cnt('forward')} platoon(s) on forward ridge lines, ${cnt('intermediate')} in the intermediate band and ${cnt('depth')} in depth${frame.hasBorder ? ` (bands at ${(e1 / 1000).toFixed(1)} and ${(e2 / 1000).toFixed(1)} km from the border)` : ''}. Posts are dispersed at least ${Math.round(sepUsed)} m apart${sepUsed < p.platoonSepM ? ` (the ground did not allow ${Math.round(p.platoonSepM)} m everywhere)` : ''}; no ITG gets more platoons than its size needs.`);
    }
    // 3. group into companies along the border direction; HQs in defilade behind them
    progress && progress(0.55, 'Companies and HQs');
    let axis = [1, 0];
    if (frame.hasBorder) { const b = frame.border, a = b[0], z = b[b.length - 1], L2 = Math.hypot(z[0] - a[0], z[1] - a[1]) || 1; axis = [(z[0] - a[0]) / L2, (z[1] - a[1]) / L2]; }
    // Platoons on the same ITG stay in the same company (one feature, one company commander).
    // Features are taken in order along the border and split into p.companies groups of about
    // p.platoonsPerCompany platoons each (dynamic programming over the ordered features).
    const along = (q) => q.c * axis[0] + q.r * axis[1];
    platoons.sort((a, b) => along(a) - along(b));
    const byItg = new Map();
    platoons.forEach((q) => { const key = q.itg || `_${q.r}_${q.c}`; if (!byItg.has(key)) byItg.set(key, []); byItg.get(key).push(q); });
    let clusters = [];
    for (const list of byItg.values()) {
      for (let k = 0; k < list.length; k += p.platoonsPerCompany) clusters.push(list.slice(k, k + p.platoonsPerCompany)); // a feature larger than a company is split
    }
    const cpos = (cl) => cl.reduce((s, q) => s + along(q), 0) / cl.length;
    clusters.sort((a, b) => cpos(a) - cpos(b));
    const K = Math.min(p.companies, clusters.length), P = p.platoonsPerCompany, N = clusters.length;
    const size = (i, j) => { let n = 0; for (let k = i; k < j; k++) n += clusters[k].length; return n; };
    const cost = (i, j) => { const n = size(i, j); return (n - P) * (n - P) + (n > P ? 100 * (n - P) : 0); };
    const best = Array.from({ length: K + 1 }, () => new Array(N + 1).fill(Infinity)), cut = Array.from({ length: K + 1 }, () => new Array(N + 1).fill(-1));
    best[0][0] = 0;
    for (let k = 1; k <= K; k++) for (let j = k; j <= N; j++) for (let i = k - 1; i < j; i++) {
      const v = best[k - 1][i] + cost(i, j);
      if (v < best[k][j]) { best[k][j] = v; cut[k][j] = i; }
    }
    const groups = [];
    for (let k = K, j = N; k > 0; k--) { const i = cut[k][j]; groups.unshift(clusters.slice(i, j).flat()); j = i; }
    const companies = groups.map((pl) => ({ platoons: pl.sort((a, b) => along(a) - along(b)) }));
    const hqSite = (cx, cy, rad, minDepth) => pickSite(T, cx, cy, rad / g.cs,
      (i) => frame.side[i] > 0 && L.slope[i] <= p.hqMaxSlope && (!frame.hasBorder || frame.borderDist[i] >= minDepth),
      (i, r, c) => (seenByEnemy(i) ? -2 : 0) - Math.hypot(r - cy, c - cx) * g.cs / 1000 + (L.landform[i] <= 3 ? 0.3 : 0));
    // Platoon names: a company keeps its own platoons A, B, C. When a feature needs a 4th platoon,
    // it is taken from a company that holds only two and placed under command (u/c) — the
    // battalion still has three platoons per company, but each feature is under one commander.
    const donors = [];
    companies.forEach((co, k) => {
      co.id = `${String.fromCharCode(65 + k)} Coy`;
      for (let j = co.platoons.length; j < p.platoonsPerCompany; j++) donors.push({ k, j });
    });
    companies.forEach((co, k) => {
      co.platoons.forEach((pl, j) => {
        if (j < p.platoonsPerCompany || !donors.length) pl.id = `${k + 1}${String.fromCharCode(65 + j)} Pl`;
        else {
          const d = donors.shift();
          pl.id = `${d.k + 1}${String.fromCharCode(65 + d.j)} Pl (u/c ${co.id})`;
          notes.push(`${pl.id.split(' (')[0]} of ${companies[d.k].id} is placed under command of ${co.id} so that ${pl.itg} is held under one company commander.`);
        }
      });
      const cx = co.platoons.reduce((s, q) => s + q.c, 0) / co.platoons.length, cy = co.platoons.reduce((s, q) => s + q.r, 0) / co.platoons.length;
      const md = Math.max(...co.platoons.map(depthOf));
      co.hq = hqSite(cx, cy, 2000, Math.min(md + 300, md + p.hqDepthM)) || hqSite(cx, cy, 3000, 0);
      if (co.hq) {
        co.hq.z = g.z[co.hq.i]; co.hq.id = `${co.id} HQ`;
        co.hq.hidden = !seenByEnemy(co.hq.i);
        // 60 mm mortar section near the company HQ, in range of all its platoons
        const inR = (r, c, list, R) => list.filter((q) => Math.hypot(q.r - r, q.c - c) * g.cs <= R * 0.9).length;
        const mor = pickSite(T, co.hq.c, co.hq.r, 1500 / g.cs,
          (i) => frame.side[i] > 0 && L.slope[i] <= p.hqMaxSlope,
          (i, r, c) => 2 * inR(r, c, co.platoons, p.mortar60R) + (seenByEnemy(i) ? 0 : 1) + (L.landform[i] <= 3 ? 0.2 : 0) - Math.hypot(r - co.hq.r, c - co.hq.c) * g.cs / 3000);
        if (mor) co.mortar = { r: mor.r, c: mor.c, z: g.z[mor.i], id: `${co.id} 60 MOR`, weapon: 'mor60', hidden: !seenByEnemy(mor.i), inRange: inR(mor.r, mor.c, co.platoons, p.mortar60R), of: co.platoons.length };
      }
    });
    const allC = companies.filter((co) => co.hq);
    let bnHq = null, bnMortar = null;
    if (allC.length) {
      const cx = allC.reduce((s, q) => s + q.hq.c, 0) / allC.length, cy = allC.reduce((s, q) => s + q.hq.r, 0) / allC.length;
      const md = Math.max(...allC.map((co) => depthOf(co.hq)));
      bnHq = hqSite(cx, cy, 3500, Math.min(md + 500, p.bnDepthM)) || hqSite(cx, cy, 5000, 0);
      if (bnHq) {
        bnHq = { r: bnHq.r, c: bnHq.c, z: g.z[bnHq.i], id: 'Bn HQ', hidden: !seenByEnemy(bnHq.i) };
        const inR = (r, c) => platoons.filter((q) => Math.hypot(q.r - r, q.c - c) * g.cs <= p.mortar81R * 0.9).length;
        const mor = pickSite(T, bnHq.c, bnHq.r, 2500 / g.cs,
          (i) => frame.side[i] > 0 && L.slope[i] <= p.hqMaxSlope,
          (i, r, c) => 2 * inR(r, c) + (seenByEnemy(i) ? 0 : 1) - Math.hypot(r - bnHq.r, c - bnHq.c) * g.cs / 4000);
        if (mor) bnMortar = { r: mor.r, c: mor.c, z: g.z[mor.i], id: 'Bn 81 MOR', weapon: 'mor81', hidden: !seenByEnemy(mor.i), inRange: inR(mor.r, mor.c), of: platoons.length };
      }
    }
    // 4. ratings
    const itgById = Object.fromEntries(itgRes.itgs.map((x) => [x.id, x]));
    platoons.forEach((pl) => {
      const i = pl.r * g.w + pl.c, itg = itgById[pl.itg];
      if (pl.layer) {
        const sup = platoons.some((q) => !q.layer && Math.hypot(q.r - pl.r, q.c - pl.c) * g.cs <= 1800);
        const sc = 0.4 * (pl.onAppr || 0) + 0.3 * (sup ? 1 : 0.3) + 0.3 * (seenByEnemy(i) ? 0.4 : 1);
        pl.rating = M.rate(sc, 0.65, 0.45);
        pl.reasons = [`${pl.role} post in front of ${pl.itg}`, pl.onAppr > 0.5 ? 'on an enemy approach' : pl.onAppr > 0 ? 'near an enemy approach' : 'off the main approaches',
          sup ? 'supported from the ridge line' : 'no ridge-line post within 1.8 km', seenByEnemy(i) ? 'overlooked from the enemy side — dig down and conceal' : 'not overlooked from the enemy side'];
        return;
      }
      const onItg = platoons.filter((q) => q.itg === pl.itg).length;
      const need = itg ? itg.force.platoons : 1;
      const nn = Math.min(...platoons.filter((q) => q !== pl).map((q) => Math.hypot(q.r - pl.r, q.c - pl.c) * g.cs), Infinity);
      const spread = nn === Infinity ? 1 : clamp01(nn / p.platoonSepM);
      const sc = 0.35 * (dom[i] / 100) + 0.25 * (onItg >= need ? 1 : onItg / need) + 0.2 * spread + 0.2 * (seenByEnemy(i) ? 0.4 : 1);
      pl.rating = M.rate(sc, 0.65, 0.45);
      pl.reasons = [`${pl.role}${pl.ridge === 'summit' ? ' on the summit' : pl.ridge ? ` on ${pl.ridge}` : ''}${itg ? `, holding ${itg.id} (needs ${itg.force.echelon})` : ''}`,
        nn === Infinity ? 'single post' : `nearest other platoon ${(nn / 1000).toFixed(1)} km away${nn < p.platoonSepM ? ' — closer than planned' : ''}`,
        itg ? (onItg >= need ? 'ITG adequately held' : `ITG needs ${need} platoon(s), has ${onItg}`) : 'ridge-line post between ITGs',
        seenByEnemy(i) ? 'overlooked from the enemy side — dig down and conceal' : 'not overlooked from the enemy side'];
    });
    const hqRate = (h, what) => {
      if (!h) return;
      const full = h.of === undefined || h.inRange >= h.of;
      h.rating = h.hidden && full ? 'Good' : h.hidden || full ? 'Marginal' : 'Not good';
      h.reasons = [h.hidden ? `${what} hidden from enemy observation` : `${what} can be seen from the enemy side`].concat(h.of !== undefined ? [`${h.inRange} of ${h.of} posts in range`] : []);
    };
    allC.forEach((co) => { hqRate(co.hq, 'HQ'); if (co.mortar) hqRate(co.mortar, 'mortar'); });
    // GSP Sec 12 para 9: each company position has at least a platoon strong point with 30 days'
    // staying power, on its most dominating feature.
    allC.forEach((co) => {
      const ridge = co.platoons.filter((q) => !q.layer);
      const pool = ridge.length ? ridge : co.platoons;
      const sp = pool.slice().sort((a, b) => dom[b.r * g.w + b.c] - dom[a.r * g.w + a.c])[0];
      if (!sp) return;
      sp.strongPoint = true;
      const base = sp.id.split(' (')[0], tail = sp.id.slice(base.length);
      sp.id = `${base} SP${tail}`;
      sp.reasons = (sp.reasons || []).concat([`strong point of ${co.id} — 30 days' staying power (GSP Sec 12 para 9)`]);
    });
    hqRate(bnHq, 'HQ'); if (bnMortar) hqRate(bnMortar, 'mortar');
    const troops = platoons.length * 30 + borderPosts.length * 10 + allC.length * 15 + (bnHq ? 60 : 0);
    const unheld = itgRes.itgs.filter((x) => !platoons.some((q) => q.itg === x.id) && x.rating === 'Good').map((x) => x.id);
    if (unheld.length) notes.push(`Good ITGs not occupied: ${unheld.join(', ')} — cover them by fire, patrols or OPs.`);
    if (itgRes.ownApproaches && itgRes.ownApproaches.length) notes.push(`Defends own position against ${itgRes.ownApproaches.length} enemy approach(es) to it (${itgRes.ownApproaches.map((a) => `${a.id} ${(a.lengthM / 1000).toFixed(1)} km — GSP day ${a.gspDay.minH.toFixed(1)}–${a.gspDay.maxH.toFixed(1)} h, night ${a.gspNight.minH.toFixed(0)}–${a.gspNight.maxH.toFixed(0)} h`).join('; ')}); ITGs are chosen astride them.`);
    platoons.forEach((q) => delete q.itgRef);
    return { mode, modeName: M.DEPLOY_MODES[mode].name, borderPosts, platoons, companies: allC, bnHq, bnMortar, enemyOPs: enemy ? enemy.ops : [], notes, troops, params: p, ownApproaches: itgRes.ownApproaches || [] };
  };

  /** Observer list (posts) of a deployment plan. */
  M.planObservers = (plan, extra = []) => (plan ? plan.borderPosts.concat(plan.platoons) : []).concat(extra).map((q) => ({ r: q.r, c: q.c }));

  // =====================================================================
  // Fire coverage and interlocking
  // =====================================================================
  M.fireCoverage = (T, plan, o = {}, extraWeapons = [], approaches = []) => {
    const { g, frame } = T;
    const p = opt('fire', o);
    const n = g.w * g.h;
    const weapons = [];
    if (plan) {
      plan.platoons.forEach((q) => weapons.push({ r: q.r, c: q.c, id: `${q.id} MG`, kind: 'direct', obsH: 0.6, tgtH: 1, maxR: p.mgRangeM, minR: 0, post: q.id }));
      plan.borderPosts.forEach((q) => weapons.push({ r: q.r, c: q.c, id: `${q.id} LMG`, kind: 'direct', obsH: 0.6, tgtH: 1, maxR: p.lmgRangeM, minR: 0, post: q.id }));
      plan.companies.forEach((co) => co.mortar && weapons.push({ r: co.mortar.r, c: co.mortar.c, id: co.mortar.id, kind: 'mortar', maxR: 2500, minR: 100 }));
      if (plan.bnMortar) weapons.push({ r: plan.bnMortar.r, c: plan.bnMortar.c, id: plan.bnMortar.id, kind: 'mortar', maxR: 5600, minR: 100 });
    }
    extraWeapons.forEach((w) => weapons.push(w));
    const count = new Uint8Array(n);
    const tmp = new Uint8Array(n);
    const masks = [];
    for (const w of weapons) {
      tmp.fill(0);
      if (w.kind === 'mortar') {
        const R = w.maxR / g.cs, r0 = w.minR / g.cs;
        for (let r = Math.max(0, Math.floor(w.r - R)); r <= Math.min(g.h - 1, Math.ceil(w.r + R)); r++)
          for (let c = Math.max(0, Math.floor(w.c - R)); c <= Math.min(g.w - 1, Math.ceil(w.c + R)); c++) {
            const d = Math.hypot(r - w.r, c - w.c);
            if (d <= R && d >= r0) tmp[r * g.w + c] = 1;
          }
      } else M.viewshed(g, w.r, w.c, { obsH: w.obsH, tgtH: w.tgtH, radiusM: w.maxR, out: tmp, value: 1 });
      const idx = [];
      for (let i = 0; i < n; i++) if (tmp[i]) { idx.push(i); if (count[i] < 255) count[i]++; }
      masks.push(new Set(idx));
    }
    // interlocking: how many OTHER weapons cover each post
    const posts = plan ? plan.platoons.concat(plan.borderPosts) : [];
    const postCover = posts.map((q) => {
      const i = q.r * g.w + q.c;
      let k = 0;
      weapons.forEach((w, j) => { if (w.post !== q.id && masks[j].has(i)) k++; });
      return { id: q.id, r: q.r, c: q.c, coveredBy: k, rating: k >= p.minCover ? 'Good' : k === 1 ? 'Marginal' : 'Not good',
        reasons: [`covered by ${k} other weapon(s)`, k >= p.minCover ? 'mutually supported' : 'not mutually supported — add a weapon or move the post'] };
    });
    // gaps along approaches
    const gaps = [];
    approaches.forEach((a) => {
      let run = null, covered = 0;
      const near = a.path.filter((q) => !frame || !frame.hasBorder || frame.side[q] > 0 || frame.borderDist[q] <= 1000);
      near.forEach((cell, k) => {
        if (count[cell] >= p.minCover) { covered++; if (run && run.n * g.cs >= 200) gaps.push(run); run = null; }
        else if (!run) run = { approach: a.id, start: cell, n: 1 }; else run.n++;
        if (k === near.length - 1 && run && run.n * g.cs >= 200) gaps.push(run);
      });
      a.fireCoverShare = near.length ? covered / near.length : 0;
    });
    const gapsOut = gaps.map((x, k) => ({ id: `Gap ${k + 1}`, approach: x.approach, r: (x.start / g.w) | 0, c: x.start % g.w, lengthM: x.n * g.cs, rating: 'Not good',
      reasons: [`${Math.round(x.n * g.cs)} m of ${x.approach} under fewer than ${p.minCover} weapons — cover with mortars or mines (GSP Sec 4 para 16)`] }));
    return { count, weapons: weapons.map((w) => ({ id: w.id, kind: w.kind, r: w.r, c: w.c, maxR: w.maxR })), postCover, gaps: gapsOut, params: p };
  };

  // =====================================================================
  // Border surveillance
  // =====================================================================
  M.borderSurveillance = (T, observers, o = {}, progress) => {
    const { g, L, frame } = T;
    const p = opt('border', o);
    if (!frame.hasBorder) throw new Error('Draw the border line first (Sector tab ▸ Border Line).');
    const obs = observers.length ? observers : [];
    progress && progress(0.1, 'Observation from own posts');
    const seen = M.viewshedCount(g, obs, { obsH: 2, tgtH: 1.5, radiusM: p.obsRangeM });
    const st = M.lineStations(g, frame.border, g.cs);
    const band = Math.max(1, Math.round(p.bandM / g.cs));
    const stationSeen = (s) => {
      let tot = 0, ok = 0;
      for (let dr = -band; dr <= band; dr++) for (let dc = -band; dc <= band; dc++) {
        const r = Math.round(s.r + dr), c = Math.round(s.c + dc);
        if (!M.inGrid(g, r, c) || dr * dr + dc * dc > band * band) continue;
        const i = r * g.w + c;
        if (frame.side[i] > 0 && frame.borderDist[i] > g.cs) continue; // band on the enemy side and the line itself
        tot++; if (seen[i]) ok++;
      }
      return tot ? ok / tot >= 0.5 : false;
    };
    const flags = st.map(stationSeen);
    const runs = [];
    let cur = null;
    flags.forEach((f, k) => {
      if (!f) { if (!cur) cur = { a: k, b: k }; else cur.b = k; }
      else if (cur) { runs.push(cur); cur = null; }
    });
    if (cur) runs.push(cur);
    const gaps = runs.filter((x) => (x.b - x.a + 1) * g.cs >= p.minGapM).map((x, k) => {
      const m = st[(x.a + x.b) >> 1];
      return { id: `BG${k + 1}`, from: st[x.a], to: st[x.b], r: m.r, c: m.c, lengthM: (x.b - x.a + 1) * g.cs, a: x.a, b: x.b };
    });
    // suggest extra OPs: greedy over candidates near the largest gaps
    progress && progress(0.6, 'Extra OPs for gaps');
    const extra = [];
    for (const gp of gaps.slice().sort((a, b) => b.lengthM - a.lengthM).slice(0, p.maxExtraOPs)) {
      const R = p.opSearchM / g.cs;
      const cands = [];
      const stp = Math.max(1, Math.round(R / 12));
      for (let dr = -R; dr <= R; dr += stp) for (let dc = -R; dc <= R; dc += stp) {
        const r = Math.round(gp.r + dr), c = Math.round(gp.c + dc);
        if (!M.inGrid(g, r, c)) continue;
        const i = r * g.w + c;
        if (frame.side[i] < 0 || L.slope[i] > 40) continue;
        cands.push({ r, c, score: g.z[i] });
      }
      let best = null, bs = 0;
      for (const cd of M.nms(cands, 3, 15)) {
        const vs = M.viewshed(g, cd.r, cd.c, { obsH: 2, tgtH: 1.5, radiusM: p.obsRangeM });
        let k = 0;
        for (let s = gp.a; s <= gp.b; s++) if (vs.mask[Math.round(st[s].r) * g.w + Math.round(st[s].c)]) k++;
        if (k > bs) { bs = k; best = cd; }
      }
      if (best) extra.push({ id: `OP+${extra.length + 1}`, r: best.r, c: best.c, z: g.z[best.r * g.w + best.c], forGap: gp.id, closesM: bs * g.cs,
        rating: bs * g.cs >= gp.lengthM * 0.6 ? 'Good' : 'Marginal', reasons: [`watches ${Math.round(bs * g.cs)} m of ${gp.id} (${Math.round(gp.lengthM)} m)`] });
    }
    const share = flags.length ? flags.filter(Boolean).length / flags.length : 0;
    gaps.forEach((x) => { x.rating = 'Not good'; x.reasons = [`${Math.round(x.lengthM)} m of border not observed`]; delete x.a; delete x.b; });
    return { observedShare: share, lengthM: flags.length * g.cs, rating: M.rate(share, p.good, p.marginal), gaps, extraOPs: extra, seen, params: p };
  };

  // =====================================================================
  // Enemy approaches across the border, infiltration routes, courses of action
  // =====================================================================
  const entryPoints = (T, mob, p) => {
    const { g, frame } = T;
    const st = M.lineStations(g, frame.border, p.entrySpacingM);
    const out = [];
    out.stations = st.length;
    st.forEach((s) => {
      const site = pickSite(T, s.c, s.r, (p.entryDepthM + 300) / g.cs,
        (i) => frame.side[i] < 0 && Math.abs(frame.borderDist[i] - p.entryDepthM) <= 300 && mob.cls[i] !== 2, (i) => -Math.abs(frame.borderDist[i] - p.entryDepthM));
      if (site) out.push(site);
    });
    return out;
  };
  const classify = (T, terr, path) => {
    const { g, L } = T;
    let ridge = 0, nul = 0, val = 0;
    for (const q of path) {
      if (terr.valleyMask[q]) val++;
      else if (terr.nullahMask[q] || L.landform[q] === 0) nul++;
      else if (L.landform[q] >= 4) ridge++;
    }
    const n = path.length || 1;
    const types = [['valley', val / n], ['nullah', nul / n], ['ridge line', ridge / n]].sort((a, b) => b[1] - a[1]);
    return types[0][1] >= 0.2 ? types[0][0] : 'spur / slope';
  };
  /** Reachable cell closest to an objective (the foot of the final assault), within maxM. */
  const reachGoal = (g, t, obj, maxM) => {
    const R = Math.ceil(maxM / g.cs);
    let best = -1, bd = Infinity;
    for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
      const r = Math.round(obj.r) + dr, c = Math.round(obj.c) + dc;
      if (!M.inGrid(g, r, c)) continue;
      const i = r * g.w + c, d = Math.hypot(dr, dc);
      if (t[i] < Infinity && d <= R && d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const overlap = (a, b) => { const s = new Set(b); let k = 0; for (const q of a) if (s.has(q)) k++; return k / Math.min(a.length, b.length); };

  M.enemyApproaches = (T, terr, itgs, ownSeen, o = {}, progress) => {
    const { g, L, frame } = T;
    const p = opt('enemy', o);
    if (!frame.hasBorder) throw new Error('Draw the border line first (Sector tab ▸ Border Line).');
    const mob = T.mob(p.profile);
    // IPB: slope NO-GO slows movement but does not stop it (see M.enemyMoveCtx)
    const ctx = mob.prof.kind === 'foot' ? M.enemyMoveCtx(T, mob) : { cls: mob.cls, slope: L.slope, prof: mob.prof, trackMask: mob.trackMask };
    const entries = entryPoints(T, { cls: ctx.cls }, p);
    if (!entries.length) throw new Error('No passable entry points on the enemy side of the border.');
    const objs = itgs.slice(0, p.objectives);
    // where can the enemy get to at all (summits are often ringed by NO-GO crags)?
    const tAll = M.reachable(g, ctx, entries.map((e) => e.i), 12 * 3600);
    const out = [];
    const perObj = [];
    objs.forEach((obj, k) => {
      progress && progress(0.1 + (0.8 * k) / objs.length, `Approaches to ${obj.id}`);
      const goal = reachGoal(g, tAll, obj, 1200);
      const rec = { objective: obj.id, r: obj.r, c: obj.c, reachable: goal >= 0, reached: 0, tooClose: 0, noPath: 0, duplicate: 0, spare: 0, kept: 0 };
      perObj.push(rec);
      if (goal < 0) return;
      const t = M.reachable(g, ctx, [goal], 24 * 3600); // IPB slow passage makes mountain approaches long: 6 h was too short
      const ranked = entries.map((e) => ({ e, t: t[e.i] })).filter((x) => x.t < Infinity).sort((a, b) => a.t - b.t);
      rec.reached = ranked.length;
      const used = [];
      for (const { e } of ranked) {
        if (used.length >= p.perObjective) { rec.spare++; continue; }
        if (used.some((u) => Math.hypot(u.r - e.r, u.c - e.c) * g.cs < p.entrySpacingM * 1.5)) { rec.tooClose++; continue; }
        const res = M.astar(g, ctx, e.i, goal);
        if (!res) { rec.noPath++; continue; }
        const path = Array.from(res.path);
        if (out.some((a) => a.objective === obj.id && overlap(a.path, path) > 0.6)) { rec.duplicate++; continue; }
        used.push(e); rec.kept++;
        const st = M.routeStats(g, ctx, path, {});
        let seenN = 0;
        for (const q of path) if (ownSeen && ownSeen[q] && frame.side[q] > 0) seenN++;
        const ownPart = path.filter((q) => frame.side[q] > 0).length || 1;
        out.push({ objective: obj.id, assaultM: Math.hypot(((goal / g.w) | 0) - obj.r, (goal % g.w) - obj.c) * g.cs, path, line: st.line, lengthM: st.lengthM, timeH: st.timeH, gspDay: st.gspDay, gspNight: st.gspNight, ascentM: st.ascentM, type: classify(T, terr, path),
          exposure: seenN / ownPart, entry: { r: e.r, c: e.c } });
      }
    });
    out.forEach((a, k) => {
      a.id = `EA${k + 1}`;
      const threat = 0.5 * (1 - a.exposure) + 0.5 * clamp01(1 - a.timeH / 6);
      a.threat = threat >= 0.6 ? 'High' : threat >= 0.4 ? 'Medium' : 'Low';
      a.rating = a.exposure >= 0.6 ? 'Good' : a.exposure >= 0.3 ? 'Marginal' : 'Not good'; // for us: how well we watch it
      a.reasons = [`${a.type} approach to ${a.objective}${a.assaultM > 2 * g.cs ? ` (last ${Math.round(a.assaultM)} m is a climb / assault)` : ''}`, `${(a.lengthM / 1000).toFixed(1)} km — GSP day ${a.gspDay.minH.toFixed(1)}–${a.gspDay.maxH.toFixed(1)} h, night ${a.gspNight.minH.toFixed(0)}–${a.gspNight.maxH.toFixed(0)} h (model ${a.timeH.toFixed(1)} h)`, `${Math.round(a.exposure * 100)}% under own observation`];
    });
    const reachAny = entries.filter((e) => tAll[e.i] < Infinity).length;
    return { approaches: out, entries: entries.map((e) => ({ r: e.r, c: e.c })), params: p,
      trace: { stations: entries.stations, entries: entries.length, reachAny, objectives: objs.length, perObjective: perObj, profile: p.profile } };
  };

  M.infiltrationRoutes = (T, terr, targets, ownSeen, o = {}, progress) => {
    const { g, L, frame } = T;
    const p = opt('enemy', o);
    if (!frame.hasBorder) throw new Error('Draw the border line first (Sector tab ▸ Border Line).');
    const mob = M.slowPassMob(g, L.slope, T.mob('foot')); // IPB: steep ground slows infiltrators (x4), does not stop them
    const entries = entryPoints(T, mob, Object.assign({}, p, { entryDepthM: Math.min(800, p.entryDepthM) }));
    const n = g.w * g.h;
    const pen = mob.penalty ? Float32Array.from(mob.penalty) : new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      if (ownSeen && ownSeen[i]) pen[i] += p.detectW;
      if (terr.nullahMask[i] || L.landform[i] === 0) pen[i] *= 1 - p.nullahBonus;
    }
    const ctx = { cls: mob.cls, slope: L.slope, prof: mob.prof, trackMask: mob.trackMask, penalty: pen };
    const tAll = M.reachable(g, { cls: mob.cls, slope: L.slope, prof: mob.prof, trackMask: mob.trackMask, penalty: mob.penalty }, entries.map((e) => e.i), 12 * 3600);
    const goals = targets.map((t) => ({ t, i: reachGoal(g, tAll, t, 1500) })).filter((x) => x.i >= 0);
    const cand = [];
    let noPath = 0, overlapN = 0;
    entries.forEach((e, k) => {
      progress && progress(0.1 + (0.8 * k) / entries.length, 'Hidden routes');
      const near = goals.slice().sort((a, b) => Math.hypot(a.t.r - e.r, a.t.c - e.c) - Math.hypot(b.t.r - e.r, b.t.c - e.c)).slice(0, 2);
      for (const gl of near) {
        const res = M.astar(g, ctx, e.i, gl.i);
        if (!res) { noPath++; continue; }
        const path = Array.from(res.path);
        const st = M.routeStats(g, { cls: mob.cls, slope: L.slope, prof: mob.prof, trackMask: mob.trackMask, penalty: mob.penalty }, path, {});
        let seenN = 0, ownN = 0, nulN = 0;
        for (const q of path) { if (frame.side[q] > 0) { ownN++; if (ownSeen && ownSeen[q]) seenN++; } if (terr.nullahMask[q] || L.landform[q] === 0) nulN++; }
        cand.push({ path, line: st.line, lengthM: st.lengthM, timeH: st.timeH, gspDay: st.gspDay, gspNight: st.gspNight, detectShare: ownN ? seenN / ownN : 0, nullahShare: nulN / path.length, target: gl.t.id || 'rear area', type: classify(T, terr, path) });
      }
    });
    cand.sort((a, b) => a.detectShare - b.detectShare || a.timeH - b.timeH);
    const out = [];
    for (const c of cand) {
      if (out.length >= p.infilCount) break;
      if (out.some((x) => overlap(x.path, c.path) > 0.5)) { overlapN++; continue; }
      out.push(c);
    }
    out.forEach((x, k) => {
      x.id = `IR${k + 1}`;
      x.threat = x.detectShare < 0.15 ? 'High' : x.detectShare < 0.4 ? 'Medium' : 'Low';
      x.rating = x.threat === 'High' ? 'Not good' : x.threat === 'Medium' ? 'Marginal' : 'Good';
      x.reasons = [`${Math.round(x.detectShare * 100)}% of the route inside own ground is observed`, `${Math.round(x.nullahShare * 100)}% in nullahs / dead ground`,
        `${(x.lengthM / 1000).toFixed(1)} km to ${x.target} — GSP day ${x.gspDay.minH.toFixed(1)}–${x.gspDay.maxH.toFixed(1)} h, night ${x.gspNight.minH.toFixed(0)}–${x.gspNight.maxH.toFixed(0)} h (model ${x.timeH.toFixed(1)} h)`, x.threat === 'High' ? 'block with an ambush, LP or mines' : 'covered by own observation'];
    });
    return { routes: out, params: p, trace: { stations: entries.stations, entries: entries.length, entryPts: entries.map((e) => ({ r: e.r, c: e.c })), targets: targets.length, goals: goals.length,
      tried: cand.length + noPath, noPath, candidates: cand.length, overlap: overlapN, kept: out.length, unused: Math.max(0, cand.length - out.length - overlapN) } };
  };

  /** Enemy courses of action: objective (ITG) + main approach + supporting approach, scored and described. */
  /**
   * Enemy courses of action, from the GSP's description of the attacker's objectives:
   *  - Sec 4 para 7: at brigade and below, tasks are the seizure of specific dominating heights.
   *  - Sec 7 para 3 / Sec 9 para 7: objectives are hill features on the flanks and in the rear of the
   *    defence that dominate it; their capture isolates the defences, cuts the routes of withdrawal
   *    and stops supplies and reinforcements. Localities are by-passed where possible and the
   *    defender forced to abandon them without a fight.
   *  - Sec 7 para 13a(2)-(3): a multi-directional threat combining nullahs, valleys and ridge lines.
   *  - Sec 10 para 4: infiltration to attack localities from the rear, seize defiles in depth,
   *    interdict reserves and lines of communication, and raid headquarters and gun areas.
   * Two options are produced:
   *  MOST LIKELY    — the dominating height the enemy can reach most easily: least observed and
   *                   quickest approach (GSP march time), with a second direction if the ground offers one.
   *  MOST DANGEROUS — the height that dominates our defences: it overlooks the most of our posts and
   *                   HQs, stands above them and lies on their flank or rear (cutting withdrawal and
   *                   supply); combined with infiltration on the most hidden route to the rear.
   */
  M.enemyOptions = (T, itgs, appr, o = {}, infil = null, plan = null) => {
    const { g } = T;
    const byObj = {};
    appr.approaches.forEach((a) => (byObj[a.objective] = byObj[a.objective] || []).push(a));
    const bearing = (a) => { const s0 = a.line[0], e = a.line[a.line.length - 1]; return M.bearing(e[0] - s0[0], s0[1] - e[1]); };
    const gspMid = (a) => (a.gspDay ? (a.gspDay.minH + a.gspDay.maxH) / 2 : a.timeH);
    const ease = (a) => 0.6 * (1 - a.exposure) + 0.4 * clamp01(1 - gspMid(a) / 12);
    const frame = T.frame;
    // our defences: posts, HQs and mortars of the deployment plan
    const defs = plan ? plan.borderPosts.concat(plan.platoons, plan.companies.map((c) => c.hq), plan.companies.map((c) => c.mortar), [plan.bnHq, plan.bnMortar]).filter(Boolean) : [];
    const med = (arr) => { const a2 = arr.slice().sort((x, y) => x - y); return a2.length ? a2[a2.length >> 1] : 0; };
    const defZ = med(defs.map((q) => g.z[Math.round(q.r) * g.w + Math.round(q.c)]));
    const defBD = frame && frame.hasBorder ? med(defs.map((q) => frame.borderDist[Math.round(q.r) * g.w + Math.round(q.c)])) : 0;
    const cands = [];
    for (const itg of itgs) {
      const as = (byObj[itg.id] || []).slice().sort((x, y) => ease(y) - ease(x));
      if (!as.length) continue;
      const main = as[0];
      const sup = as.slice(1).find((x) => Math.abs(((bearing(x) - bearing(main) + 540) % 360) - 180) > 40) || null;
      // how far this height dominates our defences (GSP Sec 7 para 3: features that dominate the defences)
      let seenDefs = 0, above = 0, flankRear = 0;
      if (defs.length) {
        for (const q of defs) if (Math.hypot(q.r - itg.r, q.c - itg.c) * g.cs <= 4000 && M.lineOfSight(g, { r: itg.r, c: itg.c }, { r: Math.round(q.r), c: Math.round(q.c) }, { obsH: 2, tgtH: 2 }).visible) seenDefs++;
        above = clamp01((itg.z - defZ) / 300);
        if (frame && frame.hasBorder) flankRear = clamp01(0.5 + (frame.borderDist[itg.r * g.w + itg.c] - defBD) / 2000);
      }
      const overlook = defs.length ? seenDefs / defs.length : 0;
      const danger = defs.length ? 0.4 * overlook + 0.3 * above + 0.3 * flankRear : itg.score;
      cands.push({ itg, main, sup, ease: ease(main) + (sup ? 0.1 : 0), danger, seenDefs, overlook, above, flankRear });
    }
    if (!cands.length) return { options: [] };
    const ml = cands.slice().sort((x, y) => y.ease - x.ease)[0];
    const md = cands.slice().sort((x, y) => y.danger - x.danger || y.itg.score - x.itg.score)[0];
    // most hidden infiltration route, for the most dangerous option (Sec 10 para 4)
    const ir = infil && infil.routes ? infil.routes.filter((x) => x.detectShare < 0.4).sort((x, y) => x.detectShare - y.detectShare)[0] || null : null; // only a route our posts do not already watch
    const tm = (a) => (a.gspDay ? `GSP day ${a.gspDay.minH.toFixed(1)}–${a.gspDay.maxH.toFixed(1)} h, night ${a.gspNight.minH.toFixed(0)}–${a.gspNight.maxH.toFixed(0)} h` : `${a.timeH.toFixed(1)} h`);
    const mk = (cd, kind) => {
      const { itg, main, sup } = cd;
      const opt = { objective: itg.id, objectiveRef: { r: itg.r, c: itg.c }, main: main.id, support: sup ? sup.id : null, timeH: main.timeH, cover: 1 - main.exposure,
        value: itg.score, type: main.type, lines: [main.line].concat(sup ? [sup.line] : []) };
      const multi = sup ? ` and a second thrust on ${sup.id} from another direction — a multi-directional threat (GSP Sec 7 para 13a)` : '';
      if (kind === 'ml') {
        opt.id = 'Most likely';
        opt.score = cd.ease;
        opt.summary = `Seize ${itg.id}, the dominating height easiest to reach (GSP Sec 4 para 7): a ${main.type} approach on ${main.id}, ${Math.round(opt.cover * 100)}% unobserved by our posts, ${tm(main)}${multi}.`;
        opt.recommendation = opt.cover > 0.6 ? `Watch ${main.id} with an OP / LP, register DF tasks on it and lay mines / obstacles in its defiles; keep a counter-attack force for ${itg.id}.`
          : `${main.id} is under observation — register mortar and artillery DF on it and keep a counter-attack force for ${itg.id}.`;
      } else {
        opt.id = 'Most dangerous';
        opt.score = cd.danger;
        const why = [cd.seenDefs ? `it overlooks ${cd.seenDefs} of our ${defs.length} posts / HQs` : '', cd.above > 0.3 ? `it stands ${Math.round(itg.z - defZ)} m above our layout` : '', cd.flankRear > 0.6 ? 'it lies on the flank / in the rear of our defences' : ''].filter(Boolean).join(', ');
        opt.summary = `Seize ${itg.id}, the height that dominates our defences${why ? ` — ${why}` : ''}: its capture would isolate our defences, cut the routes of withdrawal and the supplies and reinforcements, and could force us to abandon localities without a fight (GSP Sec 7 para 3, Sec 9 para 7). Approach ${main.id} (${tm(main)})${multi}` +
          (ir ? `, combined with infiltration on ${ir.id} (${Math.round(ir.detectShare * 100)}% observed) to raid headquarters and gun areas and cut the lines of communication (GSP Sec 10 para 4).` : '.');
        opt.recommendation = `Hold ${itg.id} as a strong point with all-round defence and 30 days' staying power (GSP Sec 12 para 9); cover ${main.id} by fire and obstacles` + (ir ? `; block ${ir.id} with an ambush / LP and mines` : '') + '; keep a counter-attack force ready.';
        if (ir) opt.lines.push(ir.line);
      }
      opt.threat = opt.score >= 0.6 ? 'High' : opt.score >= 0.4 ? 'Medium' : 'Low';
      opt.rating = opt.threat === 'High' ? 'Not good' : opt.threat === 'Medium' ? 'Marginal' : 'Good';
      return opt;
    };
    const options = [mk(ml, 'ml')];
    const mdo = mk(md, 'md');
    if (md === ml) mdo.summary = `Same objective as the most likely option. ${mdo.summary}`;
    options.push(mdo);
    options.forEach((x) => (x.label = ''));
    return { options };
  };
});
