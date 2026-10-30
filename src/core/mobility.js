/*
 * MtnAI core — cross-country mobility (Go / Slow-Go / No-Go) and movement speeds.
 *
 * Classes follow the doctrinal three-tier terrain assessment:
 *   0 GO        unrestricted
 *   1 SLOW-GO   restricted (hinders movement)
 *   2 NO-GO     severely restricted / impassable for the movement class
 * Thresholds are slope based (deg) and editable; snow line, user obstacles
 * (No-Go polygons) and digitised tracks (forced Go, road speed) are applied on top.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function mobility(M) {
  'use strict';

  M.GO = 0; M.SLOW = 1; M.NOGO = 2;
  M.CLASS_NAMES = ['GO', 'SLOW-GO', 'NO-GO'];

  /**
   * Movement classes relevant to mountain operations. Slope limits are indicative
   * planning values; units should refine them from local trials.
   *   go / slow: max slope (deg) for GO and SLOW-GO
   *   speed: cross-country speed on level GO ground (km/h); road: speed on tracks
   */
  M.MOVEMENT_PROFILES = {
    foot: { id: 'foot', name: 'Infantry (dismounted, laden)', kind: 'foot', go: 20, slow: 40, speed: 4.5, road: 5, color: '#4fc3f7' },
    mule: { id: 'mule', name: 'Mule / Animal Transport', kind: 'foot', go: 15, slow: 25, speed: 3.5, road: 4.5, color: '#ffb74d' },
    jeep: { id: 'jeep', name: 'Light vehicle (jeep / 4x4)', kind: 'vehicle', go: 10, slow: 20, speed: 20, road: 35, color: '#aed581' },
    truck: { id: 'truck', name: 'Truck / towed gun', kind: 'vehicle', go: 6, slow: 12, speed: 12, road: 30, color: '#ce93d8' },
    tracked: { id: 'tracked', name: 'Tracked (tank / APC)', kind: 'vehicle', go: 15, slow: 30, speed: 18, road: 30, color: '#ef9a9a' },
  };

  M.profile = (id, overrides) => Object.assign({}, M.MOVEMENT_PROFILES[id] || M.MOVEMENT_PROFILES.foot, overrides || {});

  /**
   * Classify every cell. ctx: {slope, z, obstacleMask?, trackMask?}
   * opts: {snowLine (m, 0 = off), generalize (bool)}
   */
  M.classifyMobility = (g, ctx, prof, opts = {}) => {
    const n = g.w * g.h;
    const cls = new Uint8Array(n);
    const { slope, z } = ctx;
    const snow = opts.snowLine > 0 ? opts.snowLine : Infinity;
    for (let i = 0; i < n; i++) {
      const s = slope[i];
      let k = s <= prof.go ? 0 : s <= prof.slow ? 1 : 2;
      if (z[i] >= snow) k = prof.kind === 'vehicle' ? 2 : Math.min(2, k + 1);
      cls[i] = k;
    }
    let out = opts.generalize ? M.majority(cls, g.w, g.h) : cls;
    if (ctx.obstacleMask) for (let i = 0; i < n; i++) if (ctx.obstacleMask[i]) out[i] = 2;
    if (ctx.trackMask) for (let i = 0; i < n; i++) if (ctx.trackMask[i] && !(ctx.obstacleMask && ctx.obstacleMask[i])) out[i] = 0;
    return out;
  };

  /** 3x3 majority filter that never removes No-Go cliffs (keeps max if tie). */
  M.majority = (cls, w, h) => {
    const out = new Uint8Array(cls.length);
    const cnt = [0, 0, 0];
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        cnt[0] = cnt[1] = cnt[2] = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = Math.min(h - 1, Math.max(0, r + dr));
          for (let dc = -1; dc <= 1; dc++) cnt[cls[rr * w + Math.min(w - 1, Math.max(0, c + dc))]]++;
        }
        const own = cls[r * w + c];
        let best = own;
        for (let k = 0; k < 3; k++) if (cnt[k] > cnt[best] || (cnt[k] === cnt[best] && k > best)) best = k;
        out[r * w + c] = own === 2 && cnt[2] >= 3 ? 2 : best;
      }
    return out;
  };

  M.mobilityStats = (cls) => {
    const n = cls.length, k = [0, 0, 0];
    for (let i = 0; i < n; i++) k[cls[i]]++;
    return { go: k[0] / n, slow: k[1] / n, nogo: k[2] / n };
  };

  /**
   * Speed (km/h) for a move between two cells.
   *   grade: signed rise/run along the move; slopeDeg: terrain slope at the target;
   *   cls: mobility class at target; z: elevation (altitude penalty); onTrack: bool
   * Foot/animal movement uses Tobler's hiking function (anisotropic: downhill is
   * faster than uphill); vehicles slow linearly towards their Slow-Go limit.
   */
  M.moveSpeed = (prof, grade, slopeDeg, cls, z, onTrack) => {
    if (cls === 2) return 0;
    let v;
    if (prof.kind === 'foot') {
      const base = onTrack ? prof.road : prof.speed;
      v = base * Math.exp(-3.5 * Math.abs(grade + 0.05)) / Math.exp(-3.5 * 0.05);
      if (!onTrack && cls === 1) v *= 0.7;
      // reduced work capacity at altitude (default ~8 % per 1000 m above 2500 m, floor 55 %)
      const cfg = M.CFG;
      if (z > cfg.altStart) v *= Math.max(cfg.altFloor, 1 - cfg.altRate * ((z - cfg.altStart) / 1000));
    } else {
      const lim = prof.slow + 5;
      const gDeg = Math.atan(Math.abs(grade)) * 57.2958;
      const f = Math.max(0.12, 1 - Math.max(gDeg, slopeDeg * 0.5) / lim);
      v = (onTrack ? prof.road : prof.speed) * f * (!onTrack && cls === 1 ? 0.55 : 1);
    }
    return Math.max(v, 0.05);
  };
});
