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
    terrain: { ridgeKm2: 0.6, nullahKm2: 0.4, valleyKm2: 15, minLineM: 400 },
    itg: { count: 15, peakRadiusM: 500, crestDropM: 60, maxRadiusM: 900, minDominance: 60, obsRangeM: 3000, minSepM: 700,
      wDominance: 0.4, wObs: 0.35, wBorder: 0.25, approachDepthM: 3000,
      sectionMaxPerimM: 400, platoonMaxPerimM: 1100, companyMaxPerimM: 2600, good: 0.72, marginal: 0.58 },
    plan: { mode: 'normal', companies: 3, platoonsPerCompany: 3, borderPostSpacingM: 0, borderPostDepthM: 0, maxPostSlope: 35,
      hqMaxSlope: 15, hqDepthM: 1200, bnDepthM: 3000, mortar60R: 2500, mortar81R: 5600, obsH: 2, enemyOPs: 8, enemySearchM: 4000 },
    fire: { mgRangeM: 1200, lmgRangeM: 800, minCover: 2 },
    border: { bandM: 500, obsRangeM: 3000, minGapM: 300, maxExtraOPs: 4, opSearchM: 1500, good: 0.9, marginal: 0.7 },
    enemy: { profile: 'foot', entrySpacingM: 1500, entryDepthM: 1500, perObjective: 2, objectives: 6, separationM: 400,
      infilCount: 5, detectW: 6, nullahBonus: 0.25, options: 4 },
  };
  /** Mode presets (GSP Sec 12, 13): forward = strong border posts; normal = tiered; strong point = company strong points. */
  M.DEPLOY_MODES = {
    forward: { name: 'Forward defence', borderPostSpacingM: 1000, borderPostDepthM: 400, tiers: [0.7, 0.3, 0] },
    normal: { name: 'Normal defence (tiered)', borderPostSpacingM: 1500, borderPostDepthM: 700, tiers: [0.45, 0.35, 0.2] },
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

  M.sectorTerrain = (T, o = {}) => {
    const { g, L, frame } = T;
    const p = opt('terrain', o);
    const cellKm2 = (g.cs * g.cs) / 1e6;
    const dom = M.dominanceLayer(g, L, frame.inSector);
    const wet = M.drainage(g, 1), dry = M.drainage(g, -1);
    const minLen = Math.max(3, Math.round(p.minLineM / g.cs));
    const nul = traceNetwork(g, wet, p.nullahKm2 / cellKm2, minLen);
    const rid = traceNetwork(g, dry, p.ridgeKm2 / cellKm2, minLen);
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

  M.findITGs = (T, terr, o = {}, progress) => {
    const { g, L, frame } = T;
    const p = opt('itg', o);
    const dom = terr.dominance;
    const R = Math.max(2, Math.round(p.peakRadiusM / g.cs));
    const st = Math.max(1, Math.round(Math.sqrt((g.w * g.h) / 260000)));
    const cands = [];
    for (let r = R; r < g.h - R; r += st)
      for (let c = R; c < g.w - R; c += st) {
        const i = r * g.w + c;
        if (!frame.inSector[i] || frame.side[i] < 0 || dom[i] < p.minDominance) continue;
        let top = true;
        for (let dr = -R; dr <= R && top; dr += st) for (let dc = -R; dc <= R; dc += st) {
          if (dr * dr + dc * dc > R * R) continue;
          if (g.z[(r + dr) * g.w + c + dc] > g.z[i]) { top = false; break; }
        }
        if (top) cands.push({ r, c, i, score: dom[i] });
      }
    const picked = M.nms(cands, p.minSepM / g.cs, p.count * 4);
    const target = approachMask(T, terr, p.approachDepthM);
    let tgtTotal = 0;
    for (const v of target) tgtTotal += v;
    const maxR = Math.round(p.maxRadiusM / g.cs);
    const out = picked.map((q, k) => {
      if (progress && k % 4 === 0) progress(0.1 + (0.8 * k) / picked.length, `ITG ${k + 1}/${picked.length}`);
      // footprint: connected cells within crestDrop of the summit and maxRadius of it
      const zTop = g.z[q.i], seen = new Set([q.i]), queue = [q.i];
      let perimEdges = 0;
      while (queue.length) {
        const i = queue.pop(), r = (i / g.w) | 0, c = i % g.w;
        for (const [dr, dc] of D8.slice(0, 4)) {
          const rr = r + dr, cc = c + dc, j = rr * g.w + cc;
          const ok = rr >= 0 && cc >= 0 && rr < g.h && cc < g.w && g.z[j] >= zTop - p.crestDropM && Math.hypot(rr - q.r, cc - q.c) <= maxR;
          if (!ok) { perimEdges++; continue; }
          if (!seen.has(j)) { seen.add(j); queue.push(j); }
        }
      }
      const cells = [...seen];
      const areaHa = (cells.length * g.cs * g.cs) / 1e4, perimM = perimEdges * g.cs;
      // outline: convex hull of the footprint (for display / export)
      const outline = hull(cells.map((i) => [i % g.w, (i / g.w) | 0]));
      const vs = M.viewshed(g, q.r, q.c, { obsH: 2, tgtH: 1.5, radiusM: p.obsRangeM });
      let seenT = 0;
      for (let i = 0; i < target.length; i++) if (target[i] && vs.mask[i]) seenT++;
      const obsShare = tgtTotal ? seenT / tgtTotal : 0;
      const bd = frame.hasBorder ? frame.borderDist[q.i] : null;
      const borderW = bd === null ? 0.5 : clamp01(1 - bd / (2 * p.approachDepthM));
      const score = p.wDominance * (dom[q.i] / 100) + p.wBorder * borderW; // + observation term, normalised below
      let slope = 0;
      for (const i of cells) slope += L.slope[i];
      const force = M.forceFor(perimM, p);
      const reasons = [`dominance ${Math.round(dom[q.i])}/100`, `sees ${Math.round(obsShare * 100)}% of approaches / nullahs`];
      if (bd !== null) reasons.push(`${(bd / 1000).toFixed(1)} km from border`);
      return { r: q.r, c: q.c, z: zTop, dominance: dom[q.i], areaHa, perimeterM: perimM, outline, obsShare, borderDistM: bd, meanSlope: slope / cells.length,
        score, force, reasons, landform: M.LANDFORMS[L.landform[q.i]].name };
    });
    const maxObs = Math.max(1e-6, ...out.map((x) => x.obsShare));
    out.forEach((x) => { x.obsIndex = x.obsShare / maxObs; x.score += p.wObs * x.obsIndex; x.rating = M.rate(x.score, p.good, p.marginal); });
    out.sort((a, b) => b.score - a.score).splice(p.count);
    out.forEach((x, k) => (x.id = `ITG ${k + 1}`));
    return { itgs: out, params: p };
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
    // 2. platoon posts on ITGs
    progress && progress(0.35, 'Platoon posts on ITGs');
    const itgs = itgRes.itgs.slice();
    const nPl = p.companies * p.platoonsPerCompany;
    const platoons = [];
    const depthOf = (q) => (frame.hasBorder ? frame.borderDist[q.r * g.w + q.c] : 0);
    const place = (itg, n, label) => {
      // spread n posts over the ITG footprint, first on the summit
      const sites = [{ r: itg.r, c: itg.c }];
      const pts = itg.outline.length ? itg.outline : [[itg.c, itg.r]];
      while (sites.length < n) {
        let best = null, bd = -1;
        for (const [c, r] of pts) {
          const d = Math.min(...sites.map((s) => Math.hypot(s.r - r, s.c - c)));
          if (d > bd) { bd = d; best = { r: Math.round(r), c: Math.round(c) }; }
        }
        // small ITG: the posts share the feature (still counted — never dropped)
        sites.push(!best || bd < 2 ? { r: itg.r, c: itg.c } : best);
      }
      sites.forEach((s) => platoons.push({ r: s.r, c: s.c, z: g.z[s.r * g.w + s.c], itg: itg.id, role: label }));
    };
    if (mode === 'strongpoint') {
      itgs.sort((a, b) => b.score - a.score); // ITG score already weighs dominance most
      itgs.slice(0, p.companies).forEach((itg) => place(itg, p.platoonsPerCompany, 'strong point'));
      notes.push('Strong point defence: each company holds the most dominating ITG with 30 days’ staying power; gaps are covered by fire, mines and patrols (GSP Sec 12 para 9, Sec 13).');
    } else {
      const tiers = M.DEPLOY_MODES[mode].tiers;
      const bands = [[0, 1500], [1500, 4000], [4000, Infinity]];
      let left = nPl;
      tiers.forEach((share, t) => {
        let want = t === tiers.length - 1 ? left : Math.round(nPl * share);
        // one platoon per ITG first (spread the tier), then reinforce ITGs that need more (max 3 = a company)
        const inBand = itgs.filter((x) => !x.used && depthOf(x) >= bands[t][0] && depthOf(x) < bands[t][1]);
        const alloc = new Map();
        for (let round = 0; round < 3 && want > 0; round++)
          for (const itg of inBand) {
            if (want <= 0) break;
            const have = alloc.get(itg) || 0;
            if (round && have >= Math.min(3, Math.ceil(itg.force.platoons))) continue;
            alloc.set(itg, have + 1); want--; left--;
          }
        for (const [itg, n] of alloc) { place(itg, n, ['forward', 'depth', 'rear'][t]); itg.used = true; }
      });
      // anything left over goes to the best unused ITGs
      for (const itg of itgs.filter((x) => !x.used)) { if (left <= 0) break; place(itg, 1, 'depth'); itg.used = true; left--; }
      // still left (fewer ITGs than platoons): reinforce the best ITGs — never drop a platoon
      const best = itgs.slice().sort((a, b) => b.score - a.score);
      for (let k = 0; left > 0 && best.length; k++, left--) place(best[k % best.length], 1, 'reserve');
      notes.push(mode === 'forward' ? 'Forward defence: strength on the border posts and forward ITGs; little depth (GSP Sec 12 para 4).'
        : 'Normal defence: tiered — valley / foothill, mid slope and ridge line — with depth and a reserve (GSP Sec 12 para 8).');
    }
    itgs.forEach((x) => delete x.used);
    // 3. group into companies along the border direction; HQs in defilade behind them
    progress && progress(0.55, 'Companies and HQs');
    let axis = [1, 0];
    if (frame.hasBorder) { const b = frame.border, a = b[0], z = b[b.length - 1], L2 = Math.hypot(z[0] - a[0], z[1] - a[1]) || 1; axis = [(z[0] - a[0]) / L2, (z[1] - a[1]) / L2]; }
    platoons.sort((a, b) => a.c * axis[0] + a.r * axis[1] - (b.c * axis[0] + b.r * axis[1]));
    const companies = [];
    for (let k = 0; k < platoons.length; k += p.platoonsPerCompany) companies.push({ platoons: platoons.slice(k, k + p.platoonsPerCompany) });
    const hqSite = (cx, cy, rad, minDepth) => pickSite(T, cx, cy, rad / g.cs,
      (i) => frame.side[i] > 0 && L.slope[i] <= p.hqMaxSlope && (!frame.hasBorder || frame.borderDist[i] >= minDepth),
      (i, r, c) => (seenByEnemy(i) ? -2 : 0) - Math.hypot(r - cy, c - cx) * g.cs / 1000 + (L.landform[i] <= 3 ? 0.3 : 0));
    companies.forEach((co, k) => {
      co.id = `${String.fromCharCode(65 + k)} Coy`;
      co.platoons.forEach((pl, j) => (pl.id = `${k + 1}${String.fromCharCode(65 + j)} Pl`));
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
      const onItg = platoons.filter((q) => q.itg === pl.itg).length;
      const need = itg ? itg.force.platoons : 1;
      const sc = 0.4 * (dom[i] / 100) + 0.3 * (onItg >= need ? 1 : onItg / need) + 0.3 * (seenByEnemy(i) ? 0.4 : 1);
      pl.rating = M.rate(sc, 0.65, 0.45);
      pl.reasons = [`on ${pl.itg} (${pl.role})`, onItg >= need ? 'ITG adequately held' : `ITG needs ${need} platoon(s), has ${onItg}`, seenByEnemy(i) ? 'overlooked from the enemy side — dig down and conceal' : 'not overlooked from the enemy side'];
    });
    const hqRate = (h, what) => {
      if (!h) return;
      const full = h.of === undefined || h.inRange >= h.of;
      h.rating = h.hidden && full ? 'Good' : h.hidden || full ? 'Marginal' : 'Not good';
      h.reasons = [h.hidden ? `${what} hidden from enemy observation` : `${what} can be seen from the enemy side`].concat(h.of !== undefined ? [`${h.inRange} of ${h.of} posts in range`] : []);
    };
    allC.forEach((co) => { hqRate(co.hq, 'HQ'); if (co.mortar) hqRate(co.mortar, 'mortar'); });
    hqRate(bnHq, 'HQ'); if (bnMortar) hqRate(bnMortar, 'mortar');
    const troops = platoons.length * 30 + borderPosts.length * 10 + allC.length * 15 + (bnHq ? 60 : 0);
    const unheld = itgRes.itgs.filter((x) => !platoons.some((q) => q.itg === x.id) && x.rating === 'Good').map((x) => x.id);
    if (unheld.length) notes.push(`Good ITGs not occupied: ${unheld.join(', ')} — cover them by fire, patrols or OPs.`);
    return { mode, modeName: M.DEPLOY_MODES[mode].name, borderPosts, platoons, companies: allC, bnHq, bnMortar, enemyOPs: enemy ? enemy.ops : [], notes, troops, params: p };
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
    const entries = entryPoints(T, mob, p);
    if (!entries.length) throw new Error('No passable entry points on the enemy side of the border.');
    const objs = itgs.slice(0, p.objectives);
    const ctx = { cls: mob.cls, slope: L.slope, prof: mob.prof, trackMask: mob.trackMask };
    // where can the enemy get to at all (summits are often ringed by NO-GO crags)?
    const tAll = M.reachable(g, ctx, entries.map((e) => e.i), 12 * 3600);
    const out = [];
    objs.forEach((obj, k) => {
      progress && progress(0.1 + (0.8 * k) / objs.length, `Approaches to ${obj.id}`);
      const goal = reachGoal(g, tAll, obj, 1200);
      if (goal < 0) return;
      const t = M.reachable(g, ctx, [goal], 6 * 3600);
      const ranked = entries.map((e) => ({ e, t: t[e.i] })).filter((x) => x.t < Infinity).sort((a, b) => a.t - b.t);
      const used = [];
      for (const { e } of ranked) {
        if (used.length >= p.perObjective) break;
        if (used.some((u) => Math.hypot(u.r - e.r, u.c - e.c) * g.cs < p.entrySpacingM * 1.5)) continue;
        const res = M.astar(g, ctx, e.i, goal);
        if (!res) continue;
        const path = Array.from(res.path);
        if (out.some((a) => a.objective === obj.id && overlap(a.path, path) > 0.6)) continue;
        used.push(e);
        const st = M.routeStats(g, ctx, path, {});
        let seenN = 0;
        for (const q of path) if (ownSeen && ownSeen[q] && frame.side[q] > 0) seenN++;
        const ownPart = path.filter((q) => frame.side[q] > 0).length || 1;
        out.push({ objective: obj.id, assaultM: Math.hypot(((goal / g.w) | 0) - obj.r, (goal % g.w) - obj.c) * g.cs, path, line: st.line, lengthM: st.lengthM, timeH: st.timeH, ascentM: st.ascentM, type: classify(T, terr, path),
          exposure: seenN / ownPart, entry: { r: e.r, c: e.c } });
      }
    });
    out.forEach((a, k) => {
      a.id = `EA${k + 1}`;
      const threat = 0.5 * (1 - a.exposure) + 0.5 * clamp01(1 - a.timeH / 6);
      a.threat = threat >= 0.6 ? 'High' : threat >= 0.4 ? 'Medium' : 'Low';
      a.rating = a.exposure >= 0.6 ? 'Good' : a.exposure >= 0.3 ? 'Marginal' : 'Not good'; // for us: how well we watch it
      a.reasons = [`${a.type} approach to ${a.objective}${a.assaultM > 2 * g.cs ? ` (last ${Math.round(a.assaultM)} m is a climb / assault)` : ''}`, `${(a.lengthM / 1000).toFixed(1)} km / ${a.timeH.toFixed(1)} h`, `${Math.round(a.exposure * 100)}% under own observation`];
    });
    return { approaches: out, entries: entries.map((e) => ({ r: e.r, c: e.c })), params: p };
  };

  M.infiltrationRoutes = (T, terr, targets, ownSeen, o = {}, progress) => {
    const { g, L, frame } = T;
    const p = opt('enemy', o);
    if (!frame.hasBorder) throw new Error('Draw the border line first (Sector tab ▸ Border Line).');
    const mob = T.mob('foot');
    const entries = entryPoints(T, mob, Object.assign({}, p, { entryDepthM: Math.min(800, p.entryDepthM) }));
    const n = g.w * g.h;
    const pen = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      if (ownSeen && ownSeen[i]) pen[i] += p.detectW;
      if (terr.nullahMask[i] || L.landform[i] === 0) pen[i] *= 1 - p.nullahBonus;
    }
    const ctx = { cls: mob.cls, slope: L.slope, prof: mob.prof, trackMask: mob.trackMask, penalty: pen };
    const tAll = M.reachable(g, { cls: mob.cls, slope: L.slope, prof: mob.prof, trackMask: mob.trackMask }, entries.map((e) => e.i), 12 * 3600);
    const goals = targets.map((t) => ({ t, i: reachGoal(g, tAll, t, 1500) })).filter((x) => x.i >= 0);
    const cand = [];
    entries.forEach((e, k) => {
      progress && progress(0.1 + (0.8 * k) / entries.length, 'Hidden routes');
      const near = goals.slice().sort((a, b) => Math.hypot(a.t.r - e.r, a.t.c - e.c) - Math.hypot(b.t.r - e.r, b.t.c - e.c)).slice(0, 2);
      for (const gl of near) {
        const res = M.astar(g, ctx, e.i, gl.i);
        if (!res) continue;
        const path = Array.from(res.path);
        const st = M.routeStats(g, { cls: mob.cls, slope: L.slope, prof: mob.prof, trackMask: mob.trackMask }, path, {});
        let seenN = 0, ownN = 0, nulN = 0;
        for (const q of path) { if (frame.side[q] > 0) { ownN++; if (ownSeen && ownSeen[q]) seenN++; } if (terr.nullahMask[q] || L.landform[q] === 0) nulN++; }
        cand.push({ path, line: st.line, lengthM: st.lengthM, timeH: st.timeH, detectShare: ownN ? seenN / ownN : 0, nullahShare: nulN / path.length, target: gl.t.id || 'rear area', type: classify(T, terr, path) });
      }
    });
    cand.sort((a, b) => a.detectShare - b.detectShare || a.timeH - b.timeH);
    const out = [];
    for (const c of cand) {
      if (out.length >= p.infilCount) break;
      if (out.some((x) => overlap(x.path, c.path) > 0.5)) continue;
      out.push(c);
    }
    out.forEach((x, k) => {
      x.id = `IR${k + 1}`;
      x.threat = x.detectShare < 0.15 ? 'High' : x.detectShare < 0.4 ? 'Medium' : 'Low';
      x.rating = x.threat === 'High' ? 'Not good' : x.threat === 'Medium' ? 'Marginal' : 'Good';
      x.reasons = [`${Math.round(x.detectShare * 100)}% of the route inside own ground is observed`, `${Math.round(x.nullahShare * 100)}% in nullahs / dead ground`,
        `${(x.lengthM / 1000).toFixed(1)} km, ${x.timeH.toFixed(1)} h on foot to ${x.target}`, x.threat === 'High' ? 'block with an ambush, LP or mines' : 'covered by own observation'];
    });
    return { routes: out, params: p };
  };

  /** Enemy courses of action: objective (ITG) + main approach + supporting approach, scored and described. */
  M.enemyOptions = (T, itgs, appr, o = {}) => {
    const p = opt('enemy', o);
    const byObj = {};
    appr.approaches.forEach((a) => (byObj[a.objective] = byObj[a.objective] || []).push(a));
    const bearing = (a) => { const s = a.line[0], e = a.line[a.line.length - 1]; return M.bearing(e[0] - s[0], s[1] - e[1]); };
    const opts = [];
    for (const itg of itgs) {
      const as = (byObj[itg.id] || []).slice().sort((a, b) => (1 - a.exposure) * 2 - a.timeH / 6 - ((1 - b.exposure) * 2 - b.timeH / 6)).reverse();
      if (!as.length) continue;
      const main = as[0];
      const sup = as.slice(1).find((x) => Math.abs(((bearing(x) - bearing(main) + 540) % 360) - 180) > 40);
      const cover = 1 - main.exposure, speed = clamp01(1 - main.timeH / 6), multi = sup ? 1 : 0, value = itg.score;
      const score = 0.35 * cover + 0.25 * speed + 0.2 * multi + 0.2 * value;
      opts.push({ objective: itg.id, objectiveRef: { r: itg.r, c: itg.c }, main: main.id, support: sup ? sup.id : null, score, cover, timeH: main.timeH, value,
        type: main.type, lines: [main.line].concat(sup ? [sup.line] : []) });
    }
    opts.sort((a, b) => b.score - a.score);
    const top = opts.slice(0, p.options);
    const maxV = Math.max(...top.map((x) => x.value), 0);
    top.forEach((x, k) => {
      x.id = `Option ${String.fromCharCode(65 + k)}`;
      x.label = [k === 0 ? 'Most likely' : '', x.value === maxV ? 'Most dangerous' : ''].filter(Boolean).join(' / ');
      x.threat = x.score >= 0.6 ? 'High' : x.score >= 0.4 ? 'Medium' : 'Low';
      x.summary = `Seize ${x.objective} by a ${x.type} approach (${x.main}, ${x.timeH.toFixed(1)} h, ${Math.round(x.cover * 100)}% unobserved)` +
        (x.support ? ` with a supporting thrust on ${x.support} (multi-directional, GSP Sec 7 para 13).` : '.');
      x.rating = x.threat === 'High' ? 'Not good' : x.threat === 'Medium' ? 'Marginal' : 'Good';
      x.recommendation = x.cover > 0.6 ? `Put an OP / LP to watch ${x.main} and register DF tasks on it.` : `Covered by observation — register mortar DF on ${x.main} and keep a counter-attack force for ${x.objective}.`;
    });
    return { options: top };
  };
});
