/*
 * MtnAI core — analysis jobs. One stateful session (grid + derived layers +
 * caches) that runs inside the Web Worker (or on the main thread as fallback).
 * Each job takes plain-object args and returns plain objects / typed arrays.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function jobs(M) {
  'use strict';

  M.createSession = () => {
    const S = { g: null, L: null, mobCache: new Map(), avCache: new Map(), hostile: null, settings: {} };

    const resetCaches = () => { S.mobCache.clear(); S.avCache.clear(); S.hostile = null; };

    const masks = () => {
      const g = S.g;
      const st = S.settings;
      const obstacleMask = st.obstacles && st.obstacles.length ? M.rasterPolys(g, st.obstacles) : null;
      const trackMask = st.tracks && st.tracks.length ? M.rasterLines(g, st.tracks, null, Math.max(0.5, 4 / g.cs)) : null;
      return { obstacleMask, trackMask };
    };

    const mob = (id) => {
      if (!S.mobCache.has(id)) {
        const prof = M.profile(id, (S.settings.profiles || {})[id]);
        const mk = S.masks || (S.masks = masks());
        const cls = M.classifyMobility(S.g, { slope: S.L.slope, z: S.g.z, obstacleMask: mk.obstacleMask, trackMask: mk.trackMask }, prof,
          { snowLine: S.settings.snowLine || 0, generalize: !!S.settings.generalize });
        S.mobCache.set(id, { cls, prof, trackMask: mk.trackMask });
      }
      return S.mobCache.get(id);
    };

    const tctx = () => ({
      g: S.g, L: S.L, mob, own: S.settings.own || null, threat: S.settings.threat || null, target: S.settings.target || null,
      threatProfile: S.settings.threatProfile || 'foot',
      avenues: (id) => {
        const key = id + JSON.stringify([S.settings.own, S.settings.threat]);
        if (!S.avCache.has(key)) {
          if (!S.settings.own || !S.settings.threat) return null;
          S.avCache.set(key, M.avenuesOfApproach(S.g, mob(id), S.settings.threat, S.settings.own, { slope: S.L.slope, k: 3 }));
        }
        return S.avCache.get(key);
      },
      hostileObs: () => {
        if (!S.settings.threat) return null;
        if (!S.hostile) S.hostile = M.hostileObservation(S.g, S.L, S.settings.threat, S.settings.hostileOpts || {});
        return S.hostile.count;
      },
    });

    const need = () => { if (!S.g) throw new Error('Load a DEM first.'); };
    const cellIdx = (p) => Math.round(p.r) * S.g.w + Math.round(p.c);

    const J = {
      /** Load a grid and compute base derivatives. */
      init({ grid }, progress) {
        const g = M.makeGrid(grid);
        M.fillNoData(g.z, g.w, g.h);
        S.g = g; S.masks = null; resetCaches();
        progress(0.1, 'Gradient');
        const grad = M.gradient(g);
        const { slope, aspect } = M.slopeAspect(g, grad);
        progress(0.35, 'Topographic position');
        const radS = Math.max(2, Math.round(M.CFG.tpiSmallM / g.cs)), radL = Math.max(5, Math.round(M.CFG.tpiLargeM / g.cs));
        const tpiS = M.tpi(g, radS), tpiL = M.tpi(g, radL);
        const landform = M.landforms(tpiS, slope);
        progress(0.6, 'Ruggedness');
        const tri = M.tri(g);
        const hs = M.hillshade(g, grad, { multi: true });
        S.grad = grad;
        S.L = { slope, aspect, landform, tpiS, tpiL, tri, sdS: M.meanStd(tpiS).std || 1, sdL: M.meanStd(tpiL).std || 1 };
        progress(0.85, 'Statistics');
        const stats = M.terrainStats(g, slope, aspect, landform);
        return { z: g.z.slice(), slope: slope.slice(), aspect: aspect.slice(), landform: landform.slice(), tri: tri.slice(), tpiL: tpiL.slice(), hs, stats };
      },

      /** Update analysis configuration; drops caches that depend on it. */
      config(cfg) {
        M.setConfig(cfg);
        S.hostile = null; S.avCache.clear();
        return { ok: true, cfg: M.CFG };
      },

      hillshade({ azimuth, altitude, zFactor, multi }) {
        need();
        return { hs: M.hillshade(S.g, S.grad, { azimuth, altitude, zFactor, multi }) };
      },

      contours({ interval, majorEvery }) {
        need();
        return M.contours(S.g, interval, majorEvery || 5);
      },

      /** Update planning settings (markers, obstacles, profiles...). Invalidates caches. */
      settings(st) {
        const geomChanged = JSON.stringify([st.obstacles, st.tracks, st.profiles, st.snowLine, st.generalize]) !==
          JSON.stringify([S.settings.obstacles, S.settings.tracks, S.settings.profiles, S.settings.snowLine, S.settings.generalize]);
        const markersChanged = JSON.stringify([st.own, st.threat, st.threatProfile]) !==
          JSON.stringify([S.settings.own, S.settings.threat, S.settings.threatProfile]);
        S.settings = Object.assign({}, S.settings, st);
        if (geomChanged) { S.masks = null; resetCaches(); }
        else if (markersChanged) { S.avCache.clear(); S.hostile = null; }
        return { ok: true };
      },

      mobility({ profile }) {
        need();
        const m = mob(profile);
        return { cls: m.cls.slice(), stats: M.mobilityStats(m.cls), profile: m.prof };
      },

      keyTerrain(opts) {
        need();
        return M.keyTerrain(S.g, S.L.slope, S.L.tpiL, opts || {});
      },

      viewshed({ p, obsH, tgtH, radiusM }) {
        need();
        const vs = M.viewshed(S.g, p.r, p.c, { obsH, tgtH, radiusM });
        return { mask: vs.mask, visibleKm2: (vs.visible * S.g.cs * S.g.cs) / 1e6 };
      },

      los({ a, b, obsH, tgtH }) {
        need();
        return M.lineOfSight(S.g, a, b, { obsH, tgtH });
      },

      profile({ pts }) {
        need();
        return { profile: M.terrainProfile(S.g, pts) };
      },

      hostileObservation(opts, progress) {
        need();
        if (!S.settings.threat) throw new Error('Place the enemy / threat position first.');
        S.settings.hostileOpts = opts || {};
        S.hostile = null;
        progress(0.2, 'Enemy observation viewsheds');
        tctx().hostileObs();
        return { count: S.hostile.count.slice(), observers: S.hostile.observers };
      },

      avenues({ profile }, progress) {
        need();
        if (!S.settings.own || !S.settings.threat) throw new Error('Place both own and enemy positions first.');
        progress(0.2, 'Least-time enemy approaches');
        const av = tctx().avenues(profile || S.settings.threatProfile || 'foot');
        return { routes: av.routes.map((r) => ({ line: r.line, lengthM: r.lengthM, timeH: r.timeH, slowFrac: r.slowFrac })), density: av.density.slice() };
      },

      posts(opts, progress) {
        need();
        return M.sitePosts(tctx(), opts, progress);
      },

      weapons(opts, progress) {
        need();
        const wp = M.weapon(opts.weaponId, opts.weaponOverrides);
        return M.siteWeapons(tctx(), Object.assign({}, opts, { weapon: wp }), progress);
      },

      minefields(opts, progress) {
        need();
        return M.siteMinefields(tctx(), opts, progress);
      },

      route({ a, b, profile, mode, alternatives, cpEveryM }, progress) {
        need();
        const m = mob(profile);
        const md = M.routeMode(mode);
        const t = tctx();
        const exposure = md.exposureW ? t.hostileObs() : null;
        let crest = null;
        if (md.skylineW) { crest = new Uint8Array(S.g.w * S.g.h); for (let i = 0; i < crest.length; i++) crest[i] = S.L.landform[i] === 5 ? 1 : 0; }
        const ctx = { cls: m.cls, slope: S.L.slope, prof: m.prof, trackMask: m.trackMask, exposure, exposureW: md.exposureW, crest, skylineW: md.skylineW };
        const sa = cellIdx(a), sb = cellIdx(b);
        if (m.cls[sa] === 2) throw new Error('Start point is in No-Go terrain for this movement class.');
        if (m.cls[sb] === 2) throw new Error('End point is in No-Go terrain for this movement class.');
        const routes = M.findRoutes(S.g, ctx, sa, sb, { alternatives, cpEveryM, separationM: 350 }, (p) => progress(p, 'Searching'));
        if (!routes.length) throw new Error('No route found — A and B are not connected for this movement class.');
        return {
          routes: routes.map((r) => Object.assign({}, r, { path: r.path, profile: M.terrainProfile(S.g, r.line, S.g.cs) })),
          usedExposure: !!exposure,
        };
      },

      picquets({ path, rangeM, minSepM, count }, progress) {
        need();
        return M.sitePicquets(tctx(), Int32Array.from(path), { rangeM, minSepM, count }, progress);
      },

      crestClearance({ site, target, weaponId, weaponOverrides }) {
        need();
        return M.crestClearance(S.g, site, target, M.weapon(weaponId, weaponOverrides));
      },
    };
    return { jobs: J, state: S };
  };

  /** Collect transferable buffers in a result object (one level of nesting is enough). */
  M.transferables = (obj, out = [], depth = 0) => {
    if (!obj || depth > 4) return out;
    if (ArrayBuffer.isView(obj)) { if (!out.includes(obj.buffer)) out.push(obj.buffer); return out; }
    if (Array.isArray(obj)) { for (const v of obj) M.transferables(v, out, depth + 1); return out; }
    if (typeof obj === 'object') for (const k in obj) M.transferables(obj[k], out, depth + 1);
    return out;
  };
});
