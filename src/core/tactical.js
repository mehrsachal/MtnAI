/*
 * MtnAI core — tactical siting aids for mountain defence planning (OAKOC):
 *   hostile observation, enemy avenues of approach, defended posts / OPs,
 *   direct-fire, indirect-fire (with crest clearance) and AD weapon sites,
 *   minefield (Mfd) sites at defiles, and picquets to protect a route.
 *
 * Every weight, threshold and constraint is an option (see M.TACTICAL_DEFAULTS);
 * the geoprocessing tools expose them as parameters. Everything is a decision aid:
 * candidates are scored from terrain alone and must be confirmed on the ground.
 *
 * Context object `T` (built by jobs.js):
 *   g, L {slope, aspect, landform, tpiS, tpiL, sdS, sdL},
 *   mob(profileId) -> {cls, prof, trackMask}, own {r,c}|null, threat {r,c}|null, target,
 *   threatProfile, avenues(profileId, opts) -> {routes, density}|null, hostileObs() -> Uint8Array|null
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function tactical(M) {
  'use strict';

  const G = 9.80665;
  const idxOf = (g, p) => Math.round(p.r) * g.w + Math.round(p.c);
  const dCells = (a, b) => Math.hypot(a.r - b.r, a.c - b.c);
  const stride = (g) => Math.max(1, Math.round(Math.sqrt((g.w * g.h) / 260000)));
  /** Landform classes 0..5: valley, lower, flat, mid, upper, ridge. */
  const LF = (arr) => arr.slice(0, 6);

  /** Default parameters of every siting algorithm (all overridable per call). */
  M.TACTICAL_DEFAULTS = {
    value: { footGo: 1, footSlow: 0.55, footNogo: 0.05, vehGo: 1, vehSlow: 0.35, vehNogo: 0, obsFoot: 0.7, obsVeh: 0.5, avenueBonus: 2,
      useCorridor: true, corridorWidth: 0.45, corridorMinM: 1500, rearFactor: 0.3 },
    posts: { count: 5, rangeM: 3000, obsH: 2, tgtH: 1.5, minSepM: 600, maxSlope: 35, maxDistOwnM: 7000, minDistThreatM: 500,
      landforms: [3, 4, 5], candidates: 110, overlapKeep: 0.25, rangeDecay: 0.5, requireAccess: true, accessProfile: 'foot', maxAccessH: 0,
      wTpiL: 0.6, wTpiS: 0.4, wElev: 0.4, wCorridor: 0.4, deadThreshold: 0.25, linkFactor: 2.5 },
    direct: { count: 3, minSepM: 300, defRadiusM: 3000, candidates: 120, overlapKeep: 0.5, rangeDecay: 0.35, enfilade: null,
      requireAccess: true, maxAccessH: 0, lfWeights: [0.25, 0.5, 0.6, 0.85, 1.0, 0.55], wCorridor: 0.5, wTpiS: 0.15 },
    ad: { count: 3, minSepM: 500, defRadiusM: 5000, candidates: 120, overlapKeep: 0.5, rangeDecay: 0.35, requireAccess: true, maxAccessH: 0,
      lfWeights: [0.1, 0.3, 0.45, 0.7, 1.0, 1.0], airValue: [1.0, 0.8, 0.7, 0.25, 0.1, 0.05], wCorridor: 0.5, wTpiS: 0.15 },
    indirect: { count: 3, minSepM: 400, candidates: 160, targetSpreadM: 400, marginM: 15, requireDefilade: false, requireAccess: true, maxAccessH: 0,
      idealRangeFrac: 0.55, minRangeFrac: 0.15, maxRangeFrac: 0.92, forwardLimit: 0.25,
      wClear: 0.35, wDefilade: 0.3, wRange: 0.15, wFlat: 0.1, wAccess: 0.1, lfWeights: [0.7, 0.9, 1.0, 0.6, 0.35, 0.15] },
    mfd: { type: 'AT', count: 4, maxGapM: null, depthM: null, densityPerM: null, tieM: 30, minDistOwnM: 300, maxDistOwnM: 3000, minSepM: 400,
      avenues: 3, orientations: 8, onePerAvenue: true, requireCovered: false, narrowWeight: 0.7, uncoveredFactor: 0.45, rearFactor: 0.2, outOfRangeFactor: 0.15 },
    picquets: { rangeM: 1500, count: 0, kmPerPicquet: 2.5, maxCount: 12, minSepM: 500, maxOffsetM: 2000, minLandform: 4, maxSlope: 38, maxClimbH: 4,
      candidates: 120, overlapKeep: 0.15, obsH: 2, tgtH: 1.5 },
    hostile: { count: 5, searchRadiusM: 3000, rangeM: 8000, obsH: 3, tgtH: 1.5, minSepM: 600, includeThreat: true },
    avenues: { k: 3, separationM: 500, bufferM: 300 },
  };
  const opt = (group, o) => Object.assign({}, M.TACTICAL_DEFAULTS[group], ...Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ({ [k]: v })));

  /** Enemy approach corridor weight (0..1) and along-axis position, per cell. */
  M.threatCorridor = (g, threat, own, vo = {}) => {
    const v0 = opt('value', vo);
    const n = g.w * g.h;
    const wgt = new Float32Array(n).fill(1);
    const along = new Float32Array(n).fill(0.5);
    if (!threat || !own) return { wgt, along, axis: null };
    const ar = own.r - threat.r, ac = own.c - threat.c;
    const L2 = ar * ar + ac * ac || 1, L = Math.sqrt(L2);
    const sigma = Math.max(v0.corridorMinM / g.cs, v0.corridorWidth * L);
    for (let r = 0; r < g.h; r++)
      for (let c = 0; c < g.w; c++) {
        const t = ((r - threat.r) * ar + (c - threat.c) * ac) / L2;
        const tc = Math.max(-0.15, Math.min(1.15, t));
        const qr = threat.r + tc * ar, qc = threat.c + tc * ac;
        const d = Math.hypot(r - qr, c - qc);
        let v = v0.useCorridor ? Math.exp(-(d / sigma) * (d / sigma)) : 1;
        if (t > 1.1) v *= v0.rearFactor;
        wgt[r * g.w + c] = v;
        along[r * g.w + c] = t;
      }
    return { wgt, along, axis: { dr: ar / L, dc: ac / L, len: L } };
  };

  /** Hostile observation: union viewshed of likely enemy OPs on high ground near the threat. */
  M.hostileObservation = (g, L, threat, o = {}) => {
    const p = opt('hostile', Object.assign({ count: M.CFG.hostileCount, searchRadiusM: M.CFG.hostileSearchM, rangeM: M.CFG.hostileRangeM, obsH: M.CFG.hostileObsH }, o));
    const rad = p.searchRadiusM / g.cs;
    const items = [];
    const st = stride(g);
    for (let r = Math.max(0, Math.floor(threat.r - rad)); r < Math.min(g.h, threat.r + rad); r += st)
      for (let c = Math.max(0, Math.floor(threat.c - rad)); c < Math.min(g.w, threat.c + rad); c += st) {
        if (Math.hypot(r - threat.r, c - threat.c) > rad) continue;
        const i = r * g.w + c;
        items.push({ r, c, score: L.tpiL[i] / L.sdL + L.tpiS[i] / L.sdS });
      }
    const obs = p.count > 0 ? M.nms(items, Math.max(3, p.minSepM / g.cs), p.count) : [];
    if (p.includeThreat || !obs.length) obs.push({ r: Math.round(threat.r), c: Math.round(threat.c), score: 0, isThreat: true });
    const count = M.viewshedCount(g, obs, { obsH: p.obsH, tgtH: p.tgtH, radiusM: p.rangeM });
    return { count, observers: obs.map((x) => ({ r: x.r, c: x.c, z: g.z[x.r * g.w + x.c], isThreat: !!x.isThreat })) };
  };

  /** Enemy avenues of approach: k alternative least-time routes threat -> own position. */
  M.avenuesOfApproach = (g, mob, threat, own, o = {}, progress) => {
    const p = opt('avenues', o);
    // vehicles cannot reach a hill-top locality: end the avenue at the nearest passable ground
    const a = M.nearestPassable(g, mob.cls, threat, 2500), b = M.nearestPassable(g, mob.cls, own, 2500);
    const routes = a < 0 || b < 0 ? [] : M.findRoutes(g, { cls: mob.cls, slope: o.slope, prof: mob.prof, trackMask: mob.trackMask },
      a, b, { alternatives: p.k, separationM: p.separationM }, progress);
    const density = new Float32Array(g.w * g.h);
    const rad = Math.max(2, Math.round(p.bufferM / g.cs));
    routes.forEach((rt) => {
      for (let k = 0; k < rt.path.length; k++) {
        const q = rt.path[k], r = (q / g.w) | 0, c = q % g.w;
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

  /** Per-cell value of observing / engaging a cell for a role. */
  M.valueSurface = (T, role, corridor, vo = {}, airValue) => {
    const { g, L } = T;
    const w = opt('value', vo);
    const n = g.w * g.h;
    const V = new Float32Array(n);
    const foot = T.mob('foot').cls;
    const vehId = T.threatProfile === 'foot' ? 'tracked' : T.threatProfile;
    const veh = T.mob(vehId).cls;
    const aven = T.threat && T.own && w.avenueBonus > 0 ? T.avenues(T.threatProfile) : null;
    const FW = [w.footGo, w.footSlow, w.footNogo], VW = [w.vehGo, w.vehSlow, w.vehNogo];
    const AV = airValue || M.TACTICAL_DEFAULTS.ad.airValue;
    for (let i = 0; i < n; i++) {
      let v;
      if (role === 'pers') v = FW[foot[i]];
      else if (role === 'veh') v = VW[veh[i]];
      else if (role === 'air') v = AV[L.landform[i]];
      else v = FW[foot[i]] * w.obsFoot + VW[veh[i]] * w.obsVeh; // observation: any movement
      v *= corridor.wgt[i];
      if (aven) v *= 1 + w.avenueBonus * aven.density[i];
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
  const evalViewshed = (T, cand, o, weightFn) => {
    const { g } = T;
    const vs = M.viewshed(g, cand.r, cand.c, { obsH: o.obsH, tgtH: o.tgtH, radiusM: o.rangeM });
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
  const greedySelect = (g, cands, count, overlapKeep, minSepCells) => {
    const covered = new Float32Array(g.w * g.h);
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
  const accessField = (T, profileId, enabled) => {
    if (!T.own || enabled === false) return null;
    const m = T.mob(profileId);
    const seed = M.nearestPassable(T.g, m.cls, T.own);
    if (seed < 0) return null;
    return M.reachable(T.g, { cls: m.cls, slope: T.L.slope, prof: m.prof, trackMask: m.trackMask }, [seed]);
  };
  /** Accept test for access (reachable, optionally within maxAccessH hours). */
  const accessOK = (acc, i, maxH) => !acc || (acc[i] < Infinity && (!maxH || acc[i] <= maxH * 3600));

  /** Candidate generation with an access constraint that is relaxed (and reported) when it leaves none. */
  const withAccess = (access, gen) => {
    let cands = access ? gen(access) : [];
    let relaxed = false;
    if (!cands.length) { cands = gen(null); relaxed = !!access; }
    return { cands, relaxed };
  };

  // =====================================================================
  // Posts / OPs
  // =====================================================================
  M.sitePosts = (T, o = {}, progress) => {
    const { g, L } = T;
    const p = opt('posts', o);
    const minSep = Math.max(2, p.minSepM / g.cs);
    const corridor = M.threatCorridor(g, T.threat, T.own, o.value);
    const V = M.valueSurface(T, 'obs', corridor, o.value);
    progress && progress(0.1, 'Access from own position');
    const access = accessField(T, p.accessProfile, p.requireAccess);
    const maxOwn = p.maxDistOwnM / g.cs;
    const { min: zMin, max: zMax } = M.minMax(g.z);
    const relief = zMax - zMin || 1;
    const lfOK = new Set(p.landforms.map(Number));
    const { cands, relaxed } = withAccess(access, (acc) => genCandidates(T,
      (i, r, c) => L.slope[i] <= p.maxSlope && lfOK.has(L.landform[i]) && accessOK(acc, i, p.maxAccessH) &&
        (!T.own || Math.hypot(r - T.own.r, c - T.own.c) <= maxOwn) &&
        (!T.threat || Math.hypot(r - T.threat.r, c - T.threat.c) * g.cs >= p.minDistThreatM),
      (i) => p.wTpiL * (L.tpiL[i] / L.sdL) + p.wTpiS * (L.tpiS[i] / L.sdS) + (p.wElev * (g.z[i] - zMin)) / relief + p.wCorridor * corridor.wgt[i],
      minSep / 2, p.candidates));
    if (!cands.length) throw new Error('No suitable post candidates — relax the slope, landform or distance constraints.');
    cands.forEach((cd, j) => {
      Object.assign(cd, evalViewshed(T, cd, { obsH: p.obsH, tgtH: p.tgtH, rangeM: p.rangeM }, (i, r, c, d) => V[i] * (1 - (p.rangeDecay * d) / p.rangeM)));
      if (progress && j % 8 === 0) progress(0.15 + (0.7 * j) / cands.length, `Viewshed ${j + 1}/${cands.length}`);
    });
    const chosen = greedySelect(g, cands, p.count, p.overlapKeep, minSep);
    const cover = M.viewshedCount(g, chosen, { obsH: p.obsH, tgtH: p.tgtH, radiusM: p.rangeM });
    const dead = new Uint8Array(g.w * g.h);
    const R = p.rangeM / g.cs;
    let vMax = 0;
    for (let i = 0; i < V.length; i++) if (V[i] > vMax) vMax = V[i];
    let totalV = 0, seenV = 0;
    for (let r = 0; r < g.h; r++)
      for (let c = 0; c < g.w; c++) {
        const i = r * g.w + c;
        totalV += V[i];
        if (cover[i]) { seenV += V[i]; continue; }
        if (V[i] < p.deadThreshold * vMax) continue;
        for (const q of chosen) if (Math.hypot(r - q.r, c - q.c) <= R) { dead[i] = 1; break; }
      }
    const posts = chosen.map((q, k) => {
      let vis = 0;
      for (let j = 0; j < q.wts.length; j++) vis += V[q.cells[j]];
      const ai = q.r * g.w + q.c;
      return Object.assign(siteInfo(g, q), {
        id: `${o.mode === 'op' ? 'OP' : 'P'}${k + 1}`, visibleKm2: q.areaKm2, valueShare: totalV ? vis / totalV : 0,
        accessH: access && access[ai] < Infinity ? access[ai] / 3600 : null, landform: M.LANDFORMS[L.landform[ai]].name,
      });
    });
    const links = [];
    for (let a = 0; a < posts.length; a++)
      for (let b = a + 1; b < posts.length; b++) {
        if (dCells(posts[a], posts[b]) * g.cs > p.linkFactor * p.rangeM) continue;
        const los = M.lineOfSight(g, posts[a], posts[b], { obsH: p.obsH, tgtH: p.obsH });
        if (los.visible) links.push([a, b, Math.round(los.distance)]);
      }
    return { posts, links, cover, dead, coverageShare: totalV ? seenV / totalV : 0, accessRelaxed: relaxed, params: p };
  };

  // =====================================================================
  // Direct fire & AD weapon sites
  // =====================================================================
  M.siteWeapons = (T, o = {}, progress) => {
    const { g, L } = T;
    const wp = o.weapon;
    if (wp.cat === 'indirect') return M.siteIndirect(T, o, progress);
    const p = opt(wp.cat === 'ad' ? 'ad' : 'direct', o);
    const minSep = Math.max(2, p.minSepM / g.cs);
    const corridor = M.threatCorridor(g, T.threat, T.own, o.value);
    const V = M.valueSurface(T, wp.role, corridor, o.value, p.airValue);
    progress && progress(0.1, 'Access from own position');
    const accessProfile = o.accessProfile || wp.access;
    const access = accessField(T, accessProfile, p.requireAccess);
    const defR = p.defRadiusM / g.cs;
    const lw = LF(p.lfWeights);
    const { cands, relaxed } = withAccess(access, (acc) => genCandidates(T,
      (i, r, c) => L.slope[i] <= wp.siteSlope && lw[L.landform[i]] > 0 && accessOK(acc, i, p.maxAccessH) &&
        (!T.own || Math.hypot(r - T.own.r, c - T.own.c) <= defR),
      (i) => lw[L.landform[i]] + p.wCorridor * corridor.wgt[i] + p.wTpiS * Math.max(-2, Math.min(2, L.tpiS[i] / L.sdS)),
      minSep / 1.5, p.candidates));
    if (!cands.length) throw new Error('No suitable weapon site candidates — relax site slope, landform weights or the defended-area radius.');
    const ax = corridor.axis;
    const enf = (p.enfilade ?? wp.enfilade ?? 0) * 0.5;
    cands.forEach((cd, j) => {
      Object.assign(cd, evalViewshed(T, cd, { obsH: wp.obsH, tgtH: wp.tgtH, rangeM: wp.maxR }, (i, r, c, d) => {
        if (d < wp.minR) return 0;
        let v = V[i] * (1 - p.rangeDecay * (d / wp.maxR) * (d / wp.maxR));
        if (enf && ax && d > 0) {
          const fr = ((r - cd.r) * g.cs) / d, fc = ((c - cd.c) * g.cs) / d;
          v *= 1 - enf + enf * Math.abs(fr * ax.dc - fc * ax.dr); // |sin| between line of fire and approach
        }
        return v;
      }));
      if (progress && j % 8 === 0) progress(0.15 + (0.75 * j) / cands.length, `Fields of fire ${j + 1}/${cands.length}`);
    });
    const chosen = greedySelect(g, cands, p.count, p.overlapKeep, minSep);
    let totalV = 0;
    for (let i = 0; i < V.length; i++) totalV += V[i];
    const sites = chosen.map((q, k) => {
      const bearings = [], wts = [];
      let vis = 0, rangeSum = 0, wSum = 0;
      for (let j = 0; j < q.cells.length; j += Math.max(1, Math.floor(q.cells.length / 4000))) {
        const i = q.cells[j], r = (i / g.w) | 0, c = i % g.w;
        bearings.push(M.bearing(c - q.c, q.r - r)); wts.push(q.wts[j]);
        rangeSum += Math.hypot(r - q.r, c - q.c) * g.cs * q.wts[j]; wSum += q.wts[j];
      }
      for (let j = 0; j < q.cells.length; j++) vis += V[q.cells[j]];
      const ai = q.r * g.w + q.c;
      return Object.assign(siteInfo(g, q), {
        id: `${wp.short}-${k + 1}`, weapon: wp.id, cat: wp.cat, maxR: wp.maxR, minR: wp.minR,
        sector: M.bearingSpread(bearings, wts, 0.8), meanRangeM: wSum ? rangeSum / wSum : 0, valueShare: totalV ? vis / totalV : 0,
        accessH: access && access[ai] < Infinity ? access[ai] / 3600 : null, landform: M.LANDFORMS[L.landform[ai]].name,
      });
    });
    const cover = M.viewshedCount(g, chosen, { obsH: wp.obsH, tgtH: wp.tgtH, radiusM: wp.maxR });
    return { sites, cover, accessRelaxed: relaxed, accessProfile, params: p };
  };

  /**
   * Crest clearance for indirect fire (vacuum trajectory with an effective muzzle
   * velocity calibrated to the weapon's maximum range — an indicative check only).
   */
  M.crestClearance = (g, site, tgt, wp, o = {}) => {
    const margin = o.marginM ?? 15;
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
      for (const q of prof) {
        if (q.d < g.cs || q.d > D - 3 * g.cs) continue;
        const y = zG + q.d * Math.tan(t) - k * q.d * q.d;
        if (q.z + margin > y) { blocked = q; break; }
      }
      if (!blocked) return { ok: true, mode, qeDeg: deg, D, angleOfSightDeg: M.deg(Math.atan2(H, D)) };
      lastBlock = { mode, d: blocked.d, z: blocked.z };
    }
    return { ok: false, reason: lastBlock ? `masked by crest at ${Math.round(lastBlock.d)} m` : 'elevation limits', D, block: lastBlock };
  };

  M.siteIndirect = (T, o = {}, progress) => {
    const { g, L } = T;
    const wp = o.weapon;
    const p = opt('indirect', o);
    const tgt = T.target || T.threat;
    if (!tgt) throw new Error('Place the enemy / threat position (or a target area) first — indirect fire needs a target area.');
    const minSep = Math.max(2, p.minSepM / g.cs);
    progress && progress(0.05, 'Hostile observation');
    const hostile = T.hostileObs();
    progress && progress(0.15, 'Access');
    const accessProfile = o.accessProfile || wp.access;
    const access = accessField(T, accessProfile, p.requireAccess);
    const off = p.targetSpreadM / g.cs;
    const targets = (off > 0 ? [[0, 0], [off, 0], [-off, 0], [0, off], [0, -off]] : [[0, 0]])
      .map(([dr, dc]) => ({ r: tgt.r + dr, c: tgt.c + dc })).filter((q) => M.inGrid(g, q.r, q.c));
    const own = T.own;
    const tf = own ? dCells(tgt, own) : 0;
    const lw = LF(p.lfWeights);
    const rangeScore = (d) => Math.max(0, 1 - Math.abs(d / wp.maxR - p.idealRangeFrac) / Math.max(0.05, 1 - p.idealRangeFrac));
    const gen = (acc) => genCandidates(T,
      (i, r, c) => {
        if (L.slope[i] > wp.siteSlope || lw[L.landform[i]] <= 0) return false;
        if (!accessOK(acc, i, p.maxAccessH)) return false;
        if (p.requireDefilade && hostile && hostile[i]) return false;
        const d = Math.hypot(r - tgt.r, c - tgt.c) * g.cs;
        if (d < Math.max(wp.minR * 1.2, p.minRangeFrac * wp.maxR) || d > p.maxRangeFrac * wp.maxR) return false;
        if (own && tf > 0) {
          // not further forward of own position (towards the target) than forwardLimit × distance
          const t = ((r - tgt.r) * (own.r - tgt.r) + (c - tgt.c) * (own.c - tgt.c)) / (tf * tf);
          if (t < 1 - p.forwardLimit) return false;
        }
        return true;
      },
      (i, r, c) => {
        const d = Math.hypot(r - tgt.r, c - tgt.c) * g.cs;
        return (1 - L.slope[i] / (wp.siteSlope + 1)) + (hostile && hostile[i] ? 0 : 1.2) + rangeScore(d) + lw[L.landform[i]];
      },
      minSep, p.candidates);
    const { cands, relaxed } = withAccess(access, gen);
    if (!cands.length) {
      throw new Error(`No ${wp.short} position meets the constraints within ${(wp.maxR / 1000).toFixed(1)} km of the target area — ` +
        'move own position / target, increase the forward limit or pick a longer-range weapon.');
    }
    const scored = [];
    cands.forEach((cd, j) => {
      const res = targets.map((t) => M.crestClearance(g, cd, t, wp, { marginM: p.marginM }));
      const ok = res.filter((x) => x.ok).length;
      if (!ok) return;
      const i = cd.r * g.w + cd.c;
      const d = dCells(cd, tgt) * g.cs;
      const hidden = !hostile || !hostile[i];
      const flat = 1 - L.slope[i] / (wp.siteSlope + 1);
      const acc = access && access[i] < Infinity ? Math.max(0, 1 - access[i] / (6 * 3600)) : 0.3;
      cd.score = p.wClear * (ok / targets.length) + p.wDefilade * (hidden ? 1 : 0) + p.wRange * rangeScore(d) + p.wFlat * flat + p.wAccess * acc;
      cd.clear = res; cd.hidden = hidden; cd.hostileCount = hostile ? hostile[i] : 0;
      scored.push(cd);
      if (progress && j % 10 === 0) progress(0.2 + (0.75 * j) / cands.length, `Crest clearance ${j + 1}/${cands.length}`);
    });
    if (!scored.length) throw new Error('All candidate positions are masked by crests for this weapon — try a high-angle weapon, a smaller clearance margin or move own position.');
    const chosen = M.nms(scored, minSep, p.count);
    const sites = chosen.map((q, k) => {
      const okRes = q.clear.find((x) => x.ok);
      const c0 = q.clear[0].ok ? q.clear[0] : okRes;
      const ai = q.r * g.w + q.c;
      return Object.assign(siteInfo(g, q), {
        id: `${wp.short}-${k + 1}`, weapon: wp.id, cat: 'indirect', maxR: wp.maxR, minR: wp.minR,
        rangeToTargetM: dCells(q, tgt) * g.cs, bearingDeg: M.bearing(tgt.c - q.c, q.r - tgt.r),
        qeDeg: c0 ? c0.qeDeg : null, angleMode: c0 ? c0.mode : null,
        clearShare: q.clear.filter((x) => x.ok).length / q.clear.length,
        hidden: q.hidden, hostileCount: q.hostileCount, score: q.score,
        accessH: access && access[ai] < Infinity ? access[ai] / 3600 : null, landform: M.LANDFORMS[L.landform[ai]].name,
      });
    });
    return { sites, cover: null, target: { r: tgt.r, c: tgt.c }, accessRelaxed: relaxed, accessProfile, params: p };
  };

  // =====================================================================
  // Minefields (Mfd) at defiles on enemy avenues of approach
  // =====================================================================
  M.siteMinefields = (T, o = {}, progress) => {
    const { g } = T;
    const type = o.type || 'AT';
    const p = opt('mfd', Object.assign({ tieM: M.CFG.mfdTieM }, o));
    p.maxGapM = p.maxGapM || (type === 'AT' ? 600 : 300);
    p.depthM = p.depthM || (type === 'AT' ? 100 : 40);
    p.densityPerM = p.densityPerM || (type === 'AT' ? 1 : 3);
    const profId = o.profile || (type === 'AP' ? 'foot' : T.threatProfile === 'foot' ? 'tracked' : T.threatProfile);
    const mob = T.mob(profId);
    const cls = mob.cls;
    const maxGap = p.maxGapM / g.cs;
    const depth = p.depthM / g.cs;
    const tie = Math.max(0, p.tieM / g.cs);
    const minSep = Math.max(3, p.minSepM / g.cs);
    if (!T.threat || !T.own) throw new Error('Place own and enemy positions first — minefields are sited on enemy avenues of approach.');
    progress && progress(0.1, 'Avenues of approach');
    const aven = T.avenues(profId, { k: p.avenues });
    if (!aven || !aven.routes.length) {
      throw new Error(`No ${mob.prof.name} avenue links the enemy to own position — the threat cannot move by this means; consider ${type === 'AT' ? 'AP' : 'AT'} minefields.`);
    }
    const nDir = Math.max(4, Math.min(32, p.orientations | 0));
    const dirs = [];
    for (let k = 0; k < nDir; k++) {
      const deg = (k * 180) / nDir, th = M.rad(deg);
      dirs.push({ deg, dc: Math.sin(th), dr: -Math.cos(th) });
    }
    const march = (r, c, dr, dc) => {
      for (let s = 1; s * 0.5 <= maxGap; s++) {
        const rr = Math.round(r + dr * s * 0.5), cc = Math.round(c + dc * s * 0.5);
        if (rr < 0 || cc < 0 || rr >= g.h || cc >= g.w) return -1;
        if (cls[rr * g.w + cc] === 2) return s * 0.5;
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
    const candCells = [];
    const pathOf = new Map();
    aven.routes.forEach((rt, k) => {
      for (let q = 0; q < rt.path.length; q++) {
        const c = rt.path[q];
        if (!pathOf.has(c)) pathOf.set(c, new Set());
        pathOf.get(c).add(k);
        candCells.push(c);
      }
    });
    const ownVS = M.viewshed(g, T.own.r, T.own.c, { obsH: 3, tgtH: 1, radiusM: p.maxDistOwnM }).mask;
    const corridor = M.threatCorridor(g, T.threat, T.own, o.value);
    const items = [];
    const seen = new Set();
    candCells.forEach((cell, j) => {
      if (seen.has(cell)) return;
      seen.add(cell);
      const r = (cell / g.w) | 0, c = cell % g.w;
      const df = defile(r, c);
      if (!df) return;
      const covered = o.cover ? !!o.cover[cell] : !!ownVS[cell];
      if (p.requireCovered && !covered) return;
      const narrow = 1 - p.narrowWeight + p.narrowWeight * (1 - df.width / maxGap);
      const nAv = pathOf.get(cell).size;
      const avW = 0.5 + 0.5 * (nAv / aven.routes.length);
      const dm = Math.hypot(r - T.own.r, c - T.own.c) * g.cs;
      const distW = dm < p.minDistOwnM ? p.outOfRangeFactor : dm > p.maxDistOwnM ? Math.max(p.outOfRangeFactor, 1 - (dm - p.maxDistOwnM) / p.maxDistOwnM) : 1;
      const fwd = corridor.along[cell] < 1 ? 1 : p.rearFactor;
      items.push({ r, c, score: narrow * avW * distW * fwd * (covered ? 1 : p.uncoveredFactor), df, routes: [...pathOf.get(cell)], covered });
      if (progress && j % 2000 === 0) progress(0.2 + (0.7 * j) / candCells.length, 'Defile analysis');
    });
    if (!items.length) throw new Error('No defile narrower than the maximum gap was found on the approaches — increase the maximum gap width.');
    const picked = [];
    if (p.onePerAvenue) {
      aven.routes.forEach((_, k) => {
        const best = items.filter((it) => it.routes.includes(k)).sort((a, b) => b.score - a.score).find((it) => !picked.some((q) => dCells(q, it) < minSep));
        if (best) picked.push(best);
      });
    }
    for (const it of M.nms(items, minSep, p.count)) {
      if (picked.length >= p.count) break;
      if (!picked.some((q) => dCells(q, it) < minSep)) picked.push(it);
    }
    const fields = picked.slice(0, p.count).map((it, k) => {
      const { dir, a, b } = it.df;
      const e1 = [it.c + dir.dc * (a + tie), it.r + dir.dr * (a + tie)];
      const e2 = [it.c - dir.dc * (b + tie), it.r - dir.dr * (b + tie)];
      const pc = (-dir.dr * depth) / 2, pr = (dir.dc * depth) / 2;
      const poly = [[e2[0] - pc, e2[1] - pr], [e1[0] - pc, e1[1] - pr], [e1[0] + pc, e1[1] + pr], [e2[0] + pc, e2[1] + pr]];
      const front = (a + b + 2 * tie) * g.cs;
      return Object.assign(siteInfo(g, it), {
        id: `Mfd ${k + 1}`, type, profile: profId, poly, frontM: front, depthM: depth * g.cs,
        gapM: it.df.width * g.cs, orientationDeg: dir.deg, estMines: Math.round(front * p.densityPerM),
        onAvenues: it.routes.map((x) => x + 1), covered: it.covered, score: it.score,
      });
    });
    return { fields, avenues: aven.routes.map((rt) => ({ line: rt.line, lengthM: rt.lengthM, timeH: rt.timeH })), params: p };
  };

  // =====================================================================
  // Picquets: dominate the heights along a route ("crowning the heights")
  // =====================================================================
  M.sitePicquets = (T, path, o = {}, progress) => {
    const { g, L } = T;
    const p = opt('picquets', o);
    const minSep = Math.max(3, p.minSepM / g.cs);
    const maxOff = p.maxOffsetM / g.cs;
    const onRoute = new Uint8Array(g.w * g.h);
    for (const q of path) onRoute[q] = 1;
    const foot = T.mob('foot');
    progress && progress(0.1, 'Climb times from route');
    const climb = M.reachable(g, { cls: foot.cls, slope: L.slope, prof: foot.prof, trackMask: foot.trackMask }, Array.from(path), p.maxClimbH * 3600);
    const nearRoute = (r, c) => {
      for (let k = 0; k < path.length; k += 4) {
        const q = path[k];
        if (Math.hypot(r - ((q / g.w) | 0), c - (q % g.w)) <= maxOff) return true;
      }
      return false;
    };
    const cands = genCandidates(T,
      (i, r, c) => L.landform[i] >= p.minLandform && L.slope[i] <= p.maxSlope && climb[i] < Infinity && !onRoute[i] && nearRoute(r, c),
      (i) => L.tpiS[i] / L.sdS + 0.5 * (L.tpiL[i] / L.sdL), minSep / 2, p.candidates);
    if (!cands.length) throw new Error('No heights suitable for picquets near the route — relax landform, slope, offset or climb-time limits.');
    cands.forEach((cd, j) => {
      Object.assign(cd, evalViewshed(T, cd, { obsH: p.obsH, tgtH: p.tgtH, rangeM: p.rangeM }, (i) => (onRoute[i] ? 1 : 0)));
      if (progress && j % 10 === 0) progress(0.2 + (0.7 * j) / cands.length, `Picquet viewsheds ${j + 1}/${cands.length}`);
    });
    const cum = new Float64Array(path.length);
    for (let q = 1; q < path.length; q++) {
      const a = path[q - 1], b = path[q];
      cum[q] = cum[q - 1] + Math.hypot(((a / g.w) | 0) - ((b / g.w) | 0), (a % g.w) - (b % g.w)) * g.cs;
    }
    const routeLenKm = cum[path.length - 1] / 1000;
    const count = p.count || Math.max(2, Math.min(p.maxCount, Math.ceil(routeLenKm / p.kmPerPicquet)));
    const chosen = greedySelect(g, cands, count, p.overlapKeep, minSep);
    const seenBy = new Uint8Array(g.w * g.h);
    for (const q of chosen) for (const i of q.cells) seenBy[i] = 1;
    let covered = 0;
    for (const q of path) if (seenBy[q]) covered++;
    const picquets = chosen.map((q, k) => {
      const ks = [];
      const set = new Set(q.cells);
      for (let j = 0; j < path.length; j++) if (set.has(path[j])) ks.push(j);
      return Object.assign(siteInfo(g, q), {
        id: `PQ${k + 1}`, routeFromKm: ks.length ? cum[ks[0]] / 1000 : null, routeToKm: ks.length ? cum[ks[ks.length - 1]] / 1000 : null,
        routeShare: ks.length / path.length, climbH: climb[q.r * g.w + q.c] / 3600,
      });
    }).sort((a, b) => (a.routeFromKm ?? 0) - (b.routeFromKm ?? 0));
    picquets.forEach((q, k) => (q.id = `PQ${k + 1}`));
    return { picquets, routeCoverage: covered / path.length, params: p };
  };
});
