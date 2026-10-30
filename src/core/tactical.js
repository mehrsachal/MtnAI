/*
 * MtnAI core — tactical siting aids for mountain defence planning (OAKOC):
 *   hostile observation, enemy avenues of approach, defended posts / OPs,
 *   direct-fire, indirect-fire (with crest clearance) and AD weapon sites,
 *   minefield (Mfd) sites at defiles, and picquets to protect a route.
 *
 * Everything is a decision aid: candidates are scored from terrain alone and must
 * be confirmed by ground reconnaissance.
 *
 * Context object `T` (built by jobs.js):
 *   g, L {slope, aspect, landform, tpiS, tpiL, sdS, sdL},
 *   mob(profileId) -> {cls, prof, trackMask}, own {r,c}|null, threat {r,c}|null,
 *   threatProfile, avenues(profileId) -> {paths, density}|null, hostileObs() -> Uint8Array|null
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function tactical(M) {
  'use strict';

  const G = 9.80665;
  const idxOf = (g, p) => Math.round(p.r) * g.w + Math.round(p.c);
  const dCells = (a, b) => Math.hypot(a.r - b.r, a.c - b.c);
  const stride = (g) => Math.max(1, Math.round(Math.sqrt((g.w * g.h) / 260000)));

  /** Enemy approach corridor weight (0..1) and along-axis position, per cell. */
  M.threatCorridor = (g, threat, own) => {
    const n = g.w * g.h;
    const wgt = new Float32Array(n).fill(1);
    const along = new Float32Array(n).fill(0.5);
    if (!threat || !own) return { wgt, along, axis: null };
    const ar = own.r - threat.r, ac = own.c - threat.c;
    const L2 = ar * ar + ac * ac || 1, L = Math.sqrt(L2);
    const sigma = Math.max(1500 / g.cs, 0.45 * L);
    for (let r = 0; r < g.h; r++)
      for (let c = 0; c < g.w; c++) {
        const t = ((r - threat.r) * ar + (c - threat.c) * ac) / L2;
        const tc = Math.max(-0.15, Math.min(1.15, t));
        const qr = threat.r + tc * ar, qc = threat.c + tc * ac;
        const d = Math.hypot(r - qr, c - qc);
        let v = Math.exp(-(d / sigma) * (d / sigma));
        if (t > 1.1) v *= 0.3; // own rear
        wgt[r * g.w + c] = v;
        along[r * g.w + c] = t;
      }
    return { wgt, along, axis: { dr: ar / L, dc: ac / L, len: L } };
  };

  /** Hostile observation: union viewshed of likely enemy OPs on high ground near the threat. */
  M.hostileObservation = (g, L, threat, opts = {}) => {
    const rad = (opts.searchRadiusM || M.CFG.hostileSearchM) / g.cs;
    const items = [];
    const st = stride(g);
    for (let r = Math.max(0, Math.floor(threat.r - rad)); r < Math.min(g.h, threat.r + rad); r += st)
      for (let c = Math.max(0, Math.floor(threat.c - rad)); c < Math.min(g.w, threat.c + rad); c += st) {
        if (Math.hypot(r - threat.r, c - threat.c) > rad) continue;
        const i = r * g.w + c;
        items.push({ r, c, score: L.tpiL[i] / L.sdL + L.tpiS[i] / L.sdS });
      }
    const obs = M.nms(items, Math.max(3, 600 / g.cs), opts.count || M.CFG.hostileCount);
    obs.push({ r: Math.round(threat.r), c: Math.round(threat.c), score: 0, isThreat: true });
    const count = M.viewshedCount(g, obs, { obsH: opts.obsH ?? M.CFG.hostileObsH, tgtH: opts.tgtH ?? 1.5, radiusM: opts.rangeM || M.CFG.hostileRangeM });
    return { count, observers: obs.map((o) => ({ r: o.r, c: o.c, z: g.z[o.r * g.w + o.c], isThreat: !!o.isThreat })) };
  };

  /** Enemy avenues of approach: k alternative least-time routes threat -> own position. */
  M.avenuesOfApproach = (g, mob, threat, own, opts = {}, progress) => {
    // vehicles cannot reach a hill-top locality: end the avenue at the nearest passable ground
    const a = M.nearestPassable(g, mob.cls, threat, 2500), b = M.nearestPassable(g, mob.cls, own, 2500);
    const routes = a < 0 || b < 0 ? [] : M.findRoutes(g, { cls: mob.cls, slope: opts.slope, prof: mob.prof, trackMask: mob.trackMask },
      a, b, { alternatives: opts.k || 3, separationM: opts.separationM || 500 }, progress);
    const density = new Float32Array(g.w * g.h);
    const rad = Math.max(2, Math.round((opts.bufferM || 300) / g.cs));
    routes.forEach((rt) => {
      for (let k = 0; k < rt.path.length; k += 1) {
        const p = rt.path[k], r = (p / g.w) | 0, c = p % g.w;
        for (let dr = -rad; dr <= rad; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= g.h) continue;
          for (let dc = -rad; dc <= rad; dc++) {
            const cc = c + dc;
            if (cc < 0 || cc >= g.w) continue;
            const d = Math.hypot(dr, dc) / rad;
            if (d > 1) continue;
            const i = rr * g.w + cc;
            const v = 1 - d * 0.8;
            if (v > density[i]) density[i] = v;
          }
        }
      }
    });
    return { routes, density };
  };

  const LF_W = {
    obs: [0.1, 0.3, 0.45, 0.7, 1.0, 1.0],
    direct: [0.25, 0.5, 0.6, 0.85, 1.0, 0.55],
    indirect: [0.7, 0.9, 1.0, 0.6, 0.35, 0.15],
    air: [1.0, 0.8, 0.7, 0.25, 0.1, 0.05],
  };

  /** Per-cell value of observing / engaging a cell for a role. */
  M.valueSurface = (T, role, corridor) => {
    const { g, L } = T;
    const n = g.w * g.h;
    const V = new Float32Array(n);
    const foot = T.mob('foot').cls;
    const vehId = T.threatProfile === 'foot' ? 'tracked' : T.threatProfile;
    const veh = T.mob(vehId).cls;
    const aven = T.threat && T.own ? T.avenues(T.threatProfile) : null;
    const FW = [1, 0.55, 0.05], VW = [1, 0.35, 0];
    for (let i = 0; i < n; i++) {
      let v;
      if (role === 'pers') v = FW[foot[i]];
      else if (role === 'veh') v = VW[veh[i]];
      else if (role === 'air') v = LF_W.air[L.landform[i]];
      else v = FW[foot[i]] * 0.7 + VW[veh[i]] * 0.5; // observation: any movement
      v *= corridor.wgt[i];
      if (aven) v *= 1 + 2 * aven.density[i];
      V[i] = v;
    }
    return V;
  };

  /** Shared candidate generation: filter + prescore + non-maximum suppression. */
  const genCandidates = (T, accept, prescore, sepCells, limit) => {
    const { g } = T;
    const st = stride(g);
    const items = [];
    for (let r = 1; r < g.h - 1; r += st)
      for (let c = 1; c < g.w - 1; c += st) {
        const i = r * g.w + c;
        if (!accept(i, r, c)) continue;
        items.push({ r, c, i, score: prescore(i, r, c) });
      }
    return M.nms(items, sepCells, limit);
  };

  /** Viewshed of a candidate, returned as visible cell indices with weights. */
  const evalViewshed = (T, cand, opts, weightFn) => {
    const { g } = T;
    const vs = M.viewshed(g, cand.r, cand.c, { obsH: opts.obsH, tgtH: opts.tgtH, radiusM: opts.rangeM });
    const R = vs.R;
    const cells = [], wts = [];
    let area = 0;
    for (let r = Math.max(0, cand.r - R); r <= Math.min(g.h - 1, cand.r + R); r++)
      for (let c = Math.max(0, cand.c - R); c <= Math.min(g.w - 1, cand.c + R); c++) {
        const i = r * g.w + c;
        if (!vs.mask[i]) continue;
        area++;
        const d = Math.hypot(r - cand.r, c - cand.c) * g.cs;
        const wv = weightFn(i, r, c, d);
        if (wv > 0) { cells.push(i); wts.push(wv); }
      }
    return { cells: Int32Array.from(cells), wts: Float32Array.from(wts), areaKm2: (area * g.cs * g.cs) / 1e6 };
  };

  /** Greedy maximum-coverage selection with overlap discount and separation. */
  const greedySelect = (g, cands, count, overlapKeep, minSepCells, extraScore) => {
    const covered = new Float32Array(g.w * g.h); // fraction already "used"
    const chosen = [];
    const used = new Uint8Array(cands.length);
    for (let k = 0; k < count; k++) {
      let best = -1, bestGain = 0;
      for (let j = 0; j < cands.length; j++) {
        if (used[j]) continue;
        const cd = cands[j];
        if (chosen.some((o) => dCells(o, cd) < minSepCells)) continue;
        let gain = 0;
        for (let q = 0; q < cd.cells.length; q++) gain += cd.wts[q] * (1 - covered[cd.cells[q]]);
        gain *= extraScore ? extraScore(cd) : 1;
        if (gain > bestGain) { bestGain = gain; best = j; }
      }
      if (best < 0) break;
      used[best] = 1;
      const cd = cands[best];
      cd.gain = bestGain;
      for (let q = 0; q < cd.cells.length; q++) covered[cd.cells[q]] = 1 - overlapKeep;
      chosen.push(cd);
    }
    return chosen;
  };

  const siteInfo = (g, p) => {
    const ll = M.cellToLatLon(g, p.r, p.c);
    return { r: p.r, c: p.c, z: g.z[p.r * g.w + p.c], lat: ll.lat, lon: ll.lon, mgrs: M.cellMGRS(g, p.r, p.c, 5) };
  };

  /** Nearest cell (by ring search) that is not No-Go for `cls`, within maxM. */
  M.nearestPassable = (g, cls, p, maxM = 1500) => {
    const r0 = Math.round(p.r), c0 = Math.round(p.c);
    if (M.inGrid(g, r0, c0) && cls[r0 * g.w + c0] !== 2) return r0 * g.w + c0;
    const R = Math.ceil(maxM / g.cs);
    for (let rad = 1; rad <= R; rad++) {
      let best = -1, bd = Infinity;
      for (let dr = -rad; dr <= rad; dr++)
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const r = r0 + dr, c = c0 + dc;
          if (!M.inGrid(g, r, c) || cls[r * g.w + c] === 2) continue;
          const d = dr * dr + dc * dc;
          if (d < bd) { bd = d; best = r * g.w + c; }
        }
      if (best >= 0) return best;
    }
    return -1;
  };

  /** Least-time access field (s) from own position for a movement class, or null. */
  const accessField = (T, profileId) => {
    if (!T.own) return null;
    const m = T.mob(profileId);
    const seed = M.nearestPassable(T.g, m.cls, T.own);
    if (seed < 0) return null;
    return M.reachable(T.g, { cls: m.cls, slope: T.L.slope, prof: m.prof, trackMask: m.trackMask }, [seed]);
  };

  /**
   * Candidate generation with an access constraint that is relaxed (and reported)
   * when it leaves no candidates — e.g. no track has been digitised yet.
   */
  const withAccess = (access, gen) => {
    let cands = access ? gen(access) : [];
    let relaxed = false;
    if (!cands.length) { cands = gen(null); relaxed = !!access; }
    return { cands, relaxed };
  };

  // =====================================================================
  // Posts / OPs
  // =====================================================================
  M.sitePosts = (T, opts = {}, progress) => {
    const { g, L } = T;
    const count = opts.count || 5;
    const rangeM = opts.rangeM || 3000;
    const minSep = Math.max(2, (opts.minSepM || 600) / g.cs);
    const corridor = M.threatCorridor(g, T.threat, T.own);
    const V = M.valueSurface(T, 'obs', corridor);
    progress && progress(0.1, 'Access from own position');
    const access = accessField(T, 'foot');
    const maxOwn = (opts.maxDistOwnM || 7000) / g.cs;
    const { min: zMin, max: zMax } = M.minMax(g.z);
    const relief = zMax - zMin || 1;
    const { cands, relaxed } = withAccess(access, (acc) => genCandidates(T,
      (i, r, c) => L.slope[i] <= (opts.maxSlope || 35) && L.landform[i] >= 3 &&
        (!acc || acc[i] < Infinity) &&
        (!T.own || Math.hypot(r - T.own.r, c - T.own.c) <= maxOwn) &&
        (!T.threat || Math.hypot(r - T.threat.r, c - T.threat.c) * g.cs >= 500),
      (i) => 0.6 * (L.tpiL[i] / L.sdL) + 0.4 * (L.tpiS[i] / L.sdS) + (0.4 * (g.z[i] - zMin)) / relief + 0.4 * corridor.wgt[i],
      minSep / 2, opts.candidates || 110));
    if (!cands.length) throw new Error('No suitable post candidates (check own position / slope limits).');
    cands.forEach((cd, j) => {
      Object.assign(cd, evalViewshed(T, cd, { obsH: opts.obsH ?? 2, tgtH: opts.tgtH ?? 1.5, rangeM },
        (i, r, c, d) => V[i] * (1 - (0.5 * d) / rangeM)));
      if (progress && j % 8 === 0) progress(0.15 + (0.7 * j) / cands.length, `Viewshed ${j + 1}/${cands.length}`);
    });
    const chosen = greedySelect(g, cands, count, 0.25, minSep);
    // coverage raster, dead ground, intervisibility
    const cover = M.viewshedCount(g, chosen, { obsH: opts.obsH ?? 2, tgtH: opts.tgtH ?? 1.5, radiusM: rangeM });
    const dead = new Uint8Array(g.w * g.h);
    const R = rangeM / g.cs;
    let vMax = 0;
    for (let i = 0; i < V.length; i++) if (V[i] > vMax) vMax = V[i];
    let totalV = 0, seenV = 0;
    for (let r = 0; r < g.h; r++)
      for (let c = 0; c < g.w; c++) {
        const i = r * g.w + c;
        totalV += V[i];
        if (cover[i]) { seenV += V[i]; continue; }
        if (V[i] < 0.25 * vMax) continue;
        for (const p of chosen) if (Math.hypot(r - p.r, c - p.c) <= R) { dead[i] = 1; break; }
      }
    const posts = chosen.map((p, k) => {
      let vis = 0;
      for (let q = 0; q < p.wts.length; q++) vis += V[p.cells[q]];
      return Object.assign(siteInfo(g, p), {
        id: `${opts.mode === 'op' ? 'OP' : 'P'}${k + 1}`, visibleKm2: p.areaKm2, valueShare: totalV ? vis / totalV : 0,
        accessH: access && access[p.r * g.w + p.c] < Infinity ? access[p.r * g.w + p.c] / 3600 : null,
        landform: M.LANDFORMS[L.landform[p.r * g.w + p.c]].name,
      });
    });
    const links = [];
    for (let a = 0; a < posts.length; a++)
      for (let b = a + 1; b < posts.length; b++) {
        if (dCells(posts[a], posts[b]) * g.cs > 2.5 * rangeM) continue;
        const los = M.lineOfSight(g, posts[a], posts[b], { obsH: 2, tgtH: 2 });
        if (los.visible) links.push([a, b, Math.round(los.distance)]);
      }
    return { posts, links, cover, dead, coverageShare: totalV ? seenV / totalV : 0, accessRelaxed: relaxed };
  };

  // =====================================================================
  // Direct fire & AD weapon sites
  // =====================================================================
  M.siteWeapons = (T, opts = {}, progress) => {
    const { g, L } = T;
    const wp = opts.weapon;
    if (wp.cat === 'indirect') return M.siteIndirect(T, opts, progress);
    const count = opts.count || 3;
    const minSep = Math.max(2, (opts.minSepM || 300) / g.cs);
    const corridor = M.threatCorridor(g, T.threat, T.own);
    const V = M.valueSurface(T, wp.role, corridor);
    progress && progress(0.1, 'Access from own position');
    const access = accessField(T, wp.access);
    const defR = (opts.defRadiusM || (wp.cat === 'ad' ? 5000 : 3000)) / g.cs;
    const lw = wp.cat === 'ad' ? LF_W.obs : LF_W.direct;
    const { cands, relaxed } = withAccess(access, (acc) => genCandidates(T,
      (i, r, c) => L.slope[i] <= wp.siteSlope && (!acc || acc[i] < Infinity) &&
        (!T.own || Math.hypot(r - T.own.r, c - T.own.c) <= defR),
      (i, r, c) => lw[L.landform[i]] + 0.5 * corridor.wgt[i] + 0.15 * Math.max(-2, Math.min(2, L.tpiS[i] / L.sdS)),
      minSep / 1.5, opts.candidates || 120));
    if (!cands.length) throw new Error('No suitable weapon site candidates (slope / defended-area limits).');
    const ax = corridor.axis;
    const enf = (wp.enfilade || 0) * 0.5;
    cands.forEach((cd, j) => {
      Object.assign(cd, evalViewshed(T, cd, { obsH: wp.obsH, tgtH: wp.tgtH, rangeM: wp.maxR }, (i, r, c, d) => {
        if (d < wp.minR) return 0;
        let v = V[i] * (1 - 0.35 * (d / wp.maxR) * (d / wp.maxR));
        if (enf && ax && d > 0) {
          const fr = (r - cd.r) * g.cs / d, fc = (c - cd.c) * g.cs / d;
          v *= 1 - enf + enf * Math.abs(fr * ax.dc - fc * ax.dr); // |sin| between line of fire and approach
        }
        return v;
      }));
      if (progress && j % 8 === 0) progress(0.15 + (0.75 * j) / cands.length, `Fields of fire ${j + 1}/${cands.length}`);
    });
    const chosen = greedySelect(g, cands, count, 0.5, minSep);
    let totalV = 0;
    for (let i = 0; i < V.length; i++) totalV += V[i];
    const sites = chosen.map((p, k) => {
      const bearings = [], wts = [];
      let vis = 0, rangeSum = 0, wSum = 0;
      for (let q = 0; q < p.cells.length; q += Math.max(1, Math.floor(p.cells.length / 4000))) {
        const i = p.cells[q], r = (i / g.w) | 0, c = i % g.w;
        bearings.push(M.bearing(c - p.c, p.r - r)); wts.push(p.wts[q]);
        rangeSum += Math.hypot(r - p.r, c - p.c) * g.cs * p.wts[q]; wSum += p.wts[q];
      }
      for (let q = 0; q < p.cells.length; q++) vis += V[p.cells[q]];
      const sector = M.bearingSpread(bearings, wts, 0.8);
      return Object.assign(siteInfo(g, p), {
        id: `${wp.short}-${k + 1}`, weapon: wp.id, cat: wp.cat, maxR: wp.maxR, minR: wp.minR,
        sector, meanRangeM: wSum ? rangeSum / wSum : 0, valueShare: totalV ? vis / totalV : 0,
        accessH: access && access[p.r * g.w + p.c] < Infinity ? access[p.r * g.w + p.c] / 3600 : null,
        landform: M.LANDFORMS[L.landform[p.r * g.w + p.c]].name,
      });
    });
    const cover = M.viewshedCount(g, chosen, { obsH: wp.obsH, tgtH: wp.tgtH, radiusM: wp.maxR });
    return { sites, cover, accessRelaxed: relaxed, accessProfile: wp.access };
  };

  /**
   * Crest clearance for indirect fire (vacuum trajectory with an effective muzzle
   * velocity calibrated to the weapon's maximum range — an indicative check only).
   */
  M.crestClearance = (g, site, tgt, wp, opts = {}) => {
    const margin = opts.marginM ?? 15;
    const zG = g.z[idxOf(g, site)] + 1.5;
    const zT = M.sample(g, g.z, tgt.r, tgt.c);
    const D = dCells(site, tgt) * g.cs;
    if (D < wp.minR) return { ok: false, reason: 'inside minimum range', D };
    if (D > wp.maxR) return { ok: false, reason: 'out of range', D };
    const v = Math.sqrt(G * wp.maxR);
    const H = zT - zG;
    const disc = v ** 4 - G * (G * D * D + 2 * H * v * v);
    if (disc < 0) return { ok: false, reason: 'out of range (height)', D };
    const th = { low: Math.atan((v * v - Math.sqrt(disc)) / (G * D)), high: Math.atan((v * v + Math.sqrt(disc)) / (G * D)) };
    const order = wp.angle === 'high' ? ['high'] : wp.angle === 'low' ? ['low'] : ['low', 'high'];
    const prof = M.terrainProfile(g, [[site.c, site.r], [tgt.c, tgt.r]], g.cs);
    let lastBlock = null;
    for (const mode of order) {
      const t = th[mode], deg = M.deg(t);
      if (deg < wp.elev[0] || deg > wp.elev[1]) continue;
      const k = G / (2 * v * v * Math.cos(t) * Math.cos(t));
      let blocked = null;
      for (const p of prof) {
        if (p.d < g.cs || p.d > D - 3 * g.cs) continue;
        const y = zG + p.d * Math.tan(t) - k * p.d * p.d;
        if (p.z + margin > y) { blocked = p; break; }
      }
      if (!blocked) return { ok: true, mode, qeDeg: deg, D, angleOfSightDeg: M.deg(Math.atan2(H, D)) };
      lastBlock = { mode, d: blocked.d, z: blocked.z };
    }
    return { ok: false, reason: lastBlock ? `masked by crest at ${Math.round(lastBlock.d)} m` : 'elevation limits', D, block: lastBlock };
  };

  M.siteIndirect = (T, opts = {}, progress) => {
    const { g, L } = T;
    const wp = opts.weapon;
    const tgt = T.target || T.threat;
    if (!tgt) throw new Error('Place the enemy / threat position (or a target area) first — indirect fire needs a target area.');
    const count = opts.count || 3;
    const minSep = Math.max(2, (opts.minSepM || 400) / g.cs);
    progress && progress(0.05, 'Hostile observation');
    const hostile = T.hostileObs();
    progress && progress(0.15, 'Access');
    const access = accessField(T, wp.access);
    const off = (opts.targetSpreadM || 400) / g.cs;
    const targets = [[0, 0], [off, 0], [-off, 0], [0, off], [0, -off]]
      .map(([dr, dc]) => ({ r: tgt.r + dr, c: tgt.c + dc }))
      .filter((p) => M.inGrid(g, p.r, p.c));
    const own = T.own;
    const tf = own ? dCells(tgt, own) : 0;
    const gen = (acc) => genCandidates(T,
      (i, r, c) => {
        if (L.slope[i] > wp.siteSlope) return false;
        if (acc && acc[i] === Infinity) return false;
        const d = Math.hypot(r - tgt.r, c - tgt.c) * g.cs;
        if (d < Math.max(wp.minR * 1.2, 0.15 * wp.maxR) || d > 0.92 * wp.maxR) return false;
        if (own && tf > 0) {
          // not forward of own position (towards the target) by more than 25 % of the distance
          const t = ((r - tgt.r) * (own.r - tgt.r) + (c - tgt.c) * (own.c - tgt.c)) / (tf * tf);
          if (t < 0.75) return false;
        }
        return true;
      },
      (i, r, c) => {
        const d = Math.hypot(r - tgt.r, c - tgt.c) * g.cs;
        return (1 - L.slope[i] / (wp.siteSlope + 1)) + (hostile && hostile[i] ? 0 : 1.2) +
          (1 - Math.abs(d / wp.maxR - 0.55) / 0.45) + LF_W.indirect[L.landform[i]];
      },
      minSep, opts.candidates || 160);
    const { cands, relaxed } = withAccess(access, gen);
    if (!cands.length) {
      throw new Error(`No ${wp.short} position behind own troops is within ${(wp.maxR / 1000).toFixed(1)} km of the target area — ` +
        'move own position / target closer or pick a longer-range weapon.');
    }
    const scored = [];
    cands.forEach((cd, j) => {
      const res = targets.map((t) => M.crestClearance(g, cd, t, wp));
      const ok = res.filter((x) => x.ok).length;
      if (!ok) return;
      const i = cd.r * g.w + cd.c;
      const d = dCells(cd, tgt) * g.cs;
      const hidden = !hostile || !hostile[i];
      const rangeScore = Math.max(0, 1 - Math.abs(d / wp.maxR - 0.55) / 0.45);
      const flat = 1 - L.slope[i] / (wp.siteSlope + 1);
      const acc = access && access[i] < Infinity ? Math.max(0, 1 - access[i] / (6 * 3600)) : 0.3;
      cd.score = 0.35 * (ok / targets.length) + 0.3 * (hidden ? 1 : 0) + 0.15 * rangeScore + 0.1 * flat + 0.1 * acc;
      cd.clear = res; cd.hidden = hidden; cd.hostileCount = hostile ? hostile[i] : 0;
      scored.push(cd);
      if (progress && j % 10 === 0) progress(0.2 + (0.75 * j) / cands.length, `Crest clearance ${j + 1}/${cands.length}`);
    });
    if (!scored.length) throw new Error('All candidate positions are masked by crests for this weapon — try a high-angle weapon or move own position.');
    const chosen = M.nms(scored, minSep, count);
    const sites = chosen.map((p, k) => {
      const okRes = p.clear.find((x) => x.ok);
      const c0 = p.clear[0].ok ? p.clear[0] : okRes;
      return Object.assign(siteInfo(g, p), {
        id: `${wp.short}-${k + 1}`, weapon: wp.id, cat: 'indirect', maxR: wp.maxR, minR: wp.minR,
        rangeToTargetM: dCells(p, tgt) * g.cs, bearingDeg: M.bearing(tgt.c - p.c, p.r - tgt.r),
        qeDeg: c0 ? c0.qeDeg : null, angleMode: c0 ? c0.mode : null,
        clearShare: p.clear.filter((x) => x.ok).length / p.clear.length,
        hidden: p.hidden, hostileCount: p.hostileCount, score: p.score,
        accessH: access && access[p.r * g.w + p.c] < Infinity ? access[p.r * g.w + p.c] / 3600 : null,
        landform: M.LANDFORMS[L.landform[p.r * g.w + p.c]].name,
      });
    });
    return { sites, cover: null, target: { r: tgt.r, c: tgt.c }, accessRelaxed: relaxed, accessProfile: wp.access };
  };

  // =====================================================================
  // Minefields (Mfd) at defiles on enemy avenues of approach
  // =====================================================================
  M.siteMinefields = (T, opts = {}, progress) => {
    const { g } = T;
    const type = opts.type || 'AT';
    const profId = type === 'AP' ? 'foot' : (T.threatProfile === 'foot' ? 'tracked' : T.threatProfile);
    const mob = T.mob(profId);
    const cls = mob.cls;
    const maxGap = (opts.maxGapM || (type === 'AT' ? 600 : 300)) / g.cs;
    const depth = (opts.depthM || (type === 'AT' ? 100 : 40)) / g.cs;
    const tie = Math.max(1, M.CFG.mfdTieM / g.cs);
    const minSep = Math.max(3, (opts.minSepM || 400) / g.cs);
    if (!T.threat || !T.own) throw new Error('Place own and enemy positions first — minefields are sited on enemy avenues of approach.');
    progress && progress(0.1, 'Avenues of approach');
    const aven = T.avenues(profId);
    if (!aven || !aven.routes.length) {
      throw new Error(`No ${mob.prof.name} avenue links the enemy to own position — the threat cannot move by this means; consider ${type === 'AT' ? 'AP' : 'AT'} minefields.`);
    }
    const dirs = [];
    for (let k = 0; k < 8; k++) {
      const th = M.rad(k * 22.5);
      dirs.push({ deg: k * 22.5, dc: Math.sin(th), dr: -Math.cos(th) });
    }
    const march = (r, c, dr, dc) => {
      const lim = maxGap * 2;
      for (let s = 1; s <= lim; s++) {
        const rr = Math.round(r + dr * s * 0.5), cc = Math.round(c + dc * s * 0.5);
        if (rr < 0 || cc < 0 || rr >= g.h || cc >= g.w) return -1;
        if (cls[rr * g.w + cc] === 2) return s * 0.5;
        if (s * 0.5 > maxGap) return -1;
      }
      return -1;
    };
    const defile = (r, c) => {
      let best = null;
      for (const d of dirs) {
        const a = march(r, c, d.dr, d.dc);
        if (a < 0) continue;
        const b = march(r, c, -d.dr, -d.dc);
        if (b < 0) continue;
        const wdt = a + b;
        if (wdt <= maxGap && (!best || wdt < best.width)) best = { width: wdt, a, b, dir: d };
      }
      return best;
    };
    // candidate cells: every cell on the enemy avenues of approach
    const candCells = [];
    const pathOf = new Map();
    aven.routes.forEach((rt, k) => {
      for (let q = 0; q < rt.path.length; q++) {
        const p = rt.path[q];
        if (!pathOf.has(p)) pathOf.set(p, new Set());
        pathOf.get(p).add(k);
        candCells.push(p);
      }
    });
    const ownVS = T.own ? M.viewshed(g, T.own.r, T.own.c, { obsH: 3, tgtH: 1, radiusM: opts.maxDistOwnM || 3000 }).mask : null;
    const corridor = M.threatCorridor(g, T.threat, T.own);
    const items = [];
    const seen = new Set();
    candCells.forEach((p, j) => {
      if (seen.has(p)) return;
      seen.add(p);
      const r = (p / g.w) | 0, c = p % g.w;
      const df = defile(r, c);
      if (!df) return;
      const narrow = 0.3 + 0.7 * (1 - df.width / maxGap);
      const nAv = pathOf.has(p) ? pathOf.get(p).size : 0;
      const avW = 0.5 + 0.5 * (nAv / aven.routes.length);
      let distW = 1;
      if (T.own) {
        const dm = Math.hypot(r - T.own.r, c - T.own.c) * g.cs;
        const lo = opts.minDistOwnM || 300, hi = opts.maxDistOwnM || 3000;
        distW = dm < lo ? 0.15 : dm > hi ? Math.max(0.1, 1 - (dm - hi) / hi) : 1;
      }
      const fwd = corridor.along[p] < 1 ? 1 : 0.2;
      const covered = opts.cover ? (opts.cover[p] ? 1 : 0.45) : ownVS ? (ownVS[p] ? 1 : 0.5) : 1;
      items.push({ r, c, score: narrow * avW * distW * fwd * covered, df, routes: nAv ? [...pathOf.get(p)] : [], covered: covered === 1 });
      if (progress && j % 2000 === 0) progress(0.2 + (0.7 * j) / candCells.length, 'Defile analysis');
    });
    if (!items.length) throw new Error('No defiles narrower than the maximum gap were found on the approaches.');
    // one per avenue first, then best remaining
    const picked = [];
    aven.routes.forEach((_, k) => {
      const best = items.filter((it) => it.routes.includes(k)).sort((a, b) => b.score - a.score)
        .find((it) => !picked.some((o) => dCells(o, it) < minSep));
      if (best) picked.push(best);
    });
    for (const it of M.nms(items, minSep, opts.count || 4)) {
      if (picked.length >= (opts.count || 4)) break;
      if (!picked.some((o) => dCells(o, it) < minSep)) picked.push(it);
    }
    const density = opts.densityPerM || (type === 'AT' ? 1 : 3);
    const fields = picked.slice(0, opts.count || 4).map((it, k) => {
      const { dir, a, b } = it.df;
      const e1 = [it.c + dir.dc * (a + tie), it.r + dir.dr * (a + tie)];
      const e2 = [it.c - dir.dc * (b + tie), it.r - dir.dr * (b + tie)];
      const pc = -dir.dr * depth / 2, pr = dir.dc * depth / 2; // perpendicular (approach direction)
      const poly = [[e2[0] - pc, e2[1] - pr], [e1[0] - pc, e1[1] - pr], [e1[0] + pc, e1[1] + pr], [e2[0] + pc, e2[1] + pr]];
      const front = (a + b + 2 * tie) * g.cs;
      return Object.assign(siteInfo(g, it), {
        id: `Mfd ${k + 1}`, type, profile: profId, poly, frontM: front, depthM: depth * g.cs,
        gapM: it.df.width * g.cs, orientationDeg: dir.deg, estMines: Math.round(front * density),
        onAvenues: it.routes.map((x) => x + 1), covered: it.covered, score: it.score,
      });
    });
    return { fields, avenues: aven.routes.map((rt) => ({ line: rt.line, lengthM: rt.lengthM, timeH: rt.timeH })) };
  };

  // =====================================================================
  // Picquets: dominate the heights along a route ("crowning the heights")
  // =====================================================================
  M.sitePicquets = (T, path, opts = {}, progress) => {
    const { g, L } = T;
    const rangeM = opts.rangeM || 1500;
    const minSep = Math.max(3, (opts.minSepM || 500) / g.cs);
    const maxOff = (opts.maxOffsetM || 2000) / g.cs;
    const onRoute = new Uint8Array(g.w * g.h);
    for (const p of path) onRoute[p] = 1;
    const foot = T.mob('foot');
    progress && progress(0.1, 'Climb times from route');
    const climb = M.reachable(g, { cls: foot.cls, slope: L.slope, prof: foot.prof, trackMask: foot.trackMask }, Array.from(path), 4 * 3600);
    // distance-to-route via the reachable field is enough: use a coarse buffer test
    const nearRoute = (r, c) => {
      for (let k = 0; k < path.length; k += 4) {
        const p = path[k];
        if (Math.hypot(r - ((p / g.w) | 0), c - (p % g.w)) <= maxOff) return true;
      }
      return false;
    };
    const cands = genCandidates(T,
      (i, r, c) => L.landform[i] >= 4 && L.slope[i] <= 38 && climb[i] < Infinity && !onRoute[i] && nearRoute(r, c),
      (i) => L.tpiS[i] / L.sdS + 0.5 * (L.tpiL[i] / L.sdL), minSep / 2, opts.candidates || 120);
    if (!cands.length) throw new Error('No heights suitable for picquets near the route.');
    cands.forEach((cd, j) => {
      Object.assign(cd, evalViewshed(T, cd, { obsH: 2, tgtH: 1.5, rangeM }, (i) => (onRoute[i] ? 1 : 0)));
      if (progress && j % 10 === 0) progress(0.2 + (0.7 * j) / cands.length, `Picquet viewsheds ${j + 1}/${cands.length}`);
    });
    const routeLenKm = (path.length * g.cs * 1.15) / 1000;
    const count = opts.count || Math.max(2, Math.min(12, Math.ceil(routeLenKm / 2.5)));
    const chosen = greedySelect(g, cands, count, 0.15, minSep);
    const seenBy = new Uint8Array(g.w * g.h);
    for (const p of chosen) for (const i of p.cells) seenBy[i] = 1;
    let covered = 0;
    for (const p of path) if (seenBy[p]) covered++;
    // chainage on the route each picquet protects
    const cum = new Float64Array(path.length);
    for (let q = 1; q < path.length; q++) {
      const a = path[q - 1], b = path[q];
      cum[q] = cum[q - 1] + Math.hypot(((a / g.w) | 0) - ((b / g.w) | 0), (a % g.w) - (b % g.w)) * g.cs;
    }
    const picquets = chosen.map((p, k) => {
      const ks = [];
      const set = new Set(p.cells);
      for (let q = 0; q < path.length; q++) if (set.has(path[q])) ks.push(q);
      return Object.assign(siteInfo(g, p), {
        id: `PQ${k + 1}`, routeFromKm: ks.length ? cum[ks[0]] / 1000 : null, routeToKm: ks.length ? cum[ks[ks.length - 1]] / 1000 : null,
        routeShare: ks.length / path.length, climbH: climb[p.r * g.w + p.c] / 3600,
      });
    }).sort((a, b) => (a.routeFromKm ?? 0) - (b.routeFromKm ?? 0));
    picquets.forEach((p, k) => (p.id = `PQ${k + 1}`));
    return { picquets, routeCoverage: covered / path.length };
  };
});
