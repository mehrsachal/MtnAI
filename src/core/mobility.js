/*
 * MtnEye core — cross-country mobility (Go / Slow-Go / No-Go) and movement speeds.
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
   * IPB Basic Book, terrain classification (para on obstacles / GO, SLOW-GO, NO-GO):
   *   GO       slopes less than 30 percent
   *   SLOW-GO  slopes of 30 to 45 percent uphill (directional)
   *   NO-GO    slopes of 45 percent or greater uphill (directional)
   *   elevation variation per km: GO 0-100 m, SLOW-GO 100-200 m, NO-GO 200-400 m
   * 30 % = 16.7 deg, 45 % = 24.2 deg. The IPB slope rule is applied to infantry, animal
   * transport (GSP Mountain Warfare Annex H: a loaded mule climbs any slope a man can
   * negotiate without using his hands) and tracked vehicles. The IPB gives no separate
   * figures for wheeled vehicles, so their limits remain planning values (editable).
   *   go / slow: max slope (deg) for GO and SLOW-GO; src: where the limit comes from
   *   speed: cross-country speed on level GO ground (km/h); road: speed on tracks
   */
  M.pctToDeg = (p) => Math.round(Math.atan(p / 100) * 57.29577951308232 * 10) / 10;
  M.IPB = { goPct: 30, slowPct: 45, goDeg: M.pctToDeg(30), slowDeg: M.pctToDeg(45), reliefSlowM: 100, reliefNogoM: 200 };
  M.MOVEMENT_PROFILES = {
    foot: { id: 'foot', name: 'Infantry (dismounted, laden)', kind: 'foot', go: M.IPB.goDeg, slow: M.IPB.slowDeg, speed: 4.5, road: 5, color: '#4fc3f7', src: 'IPB' },
    mule: { id: 'mule', name: 'Mule / Animal Transport', kind: 'foot', go: M.IPB.goDeg, slow: M.IPB.slowDeg, speed: 3.5, road: 4.5, color: '#ffb74d', src: 'IPB + GSP Annex H' },
    jeep: { id: 'jeep', name: 'Light vehicle (jeep / 4x4)', kind: 'vehicle', go: 10, slow: 20, speed: 20, road: 35, color: '#aed581', src: 'Planning value' },
    truck: { id: 'truck', name: 'Truck / towed gun', kind: 'vehicle', go: 6, slow: 12, speed: 12, road: 30, color: '#ce93d8', src: 'Planning value' },
    tracked: { id: 'tracked', name: 'Tracked (tank / APC)', kind: 'vehicle', go: M.IPB.goDeg, slow: M.IPB.slowDeg, speed: 18, road: 30, color: '#ef9a9a', src: 'IPB' },
  };

  M.profile = (id, overrides) => Object.assign({}, M.MOVEMENT_PROFILES[id] || M.MOVEMENT_PROFILES.foot, overrides || {});

  /**
   * Classify every cell. ctx: {slope, z, obstacleMask?, trackMask?}
   * opts: {snowLine (m, 0 = off), generalize (bool), relief (bool: IPB elevation variation per km)}
   */
  M.classifyMobility = (g, ctx, prof, opts = {}) => {
    const n = g.w * g.h;
    const cls = new Uint8Array(n);
    const { slope, z } = ctx;
    const snow = opts.snowLine > 0 ? opts.snowLine : Infinity;
    const rel = opts.relief ? M.localRelief(g, 1000) : null;
    for (let i = 0; i < n; i++) {
      const s = slope[i];
      let k = s < prof.go ? 0 : s < prof.slow ? 1 : 2;   // IPB: GO below 30 %, SLOW-GO 30-45 %, NO-GO 45 % or more
      if (rel) k = Math.max(k, rel[i] >= M.IPB.reliefNogoM ? 2 : rel[i] >= M.IPB.reliefSlowM ? 1 : 0);
      if (z[i] >= snow) k = prof.kind === 'vehicle' ? 2 : Math.min(2, k + 1);
      cls[i] = k;
    }
    let out = opts.generalize ? M.majority(cls, g.w, g.h) : cls;
    if (ctx.obstacleMask) for (let i = 0; i < n; i++) if (ctx.obstacleMask[i]) out[i] = 2;
    if (ctx.trackMask) for (let i = 0; i < n; i++) if (ctx.trackMask[i] && !(ctx.obstacleMask && ctx.obstacleMask[i])) out[i] = 0;
    return out;
  };

  /** Elevation variation (m) inside a square window of `sizeM` metres around each cell (max - min). IPB: per kilometre. */
  M.localRelief = (g, sizeM = 1000) => {
    const { w, h, z } = g;
    const r = Math.max(1, Math.round(sizeM / g.cs / 2));
    const run = (src, out, len, count, stride, step, isMax) => {
      const buf = new Float32Array(len);
      for (let k = 0; k < count; k++) {
        const base = k * stride;
        for (let i = 0; i < len; i++) buf[i] = src[base + i * step];
        // van Herk / Gil-Werman style is overkill here; a deque keeps it O(len)
        const dq = new Int32Array(len); let hd = 0, tl = 0;
        for (let i = 0; i < len + r; i++) {
          if (i < len) {
            const v = buf[i];
            while (tl > hd && (isMax ? buf[dq[tl - 1]] <= v : buf[dq[tl - 1]] >= v)) tl--;
            dq[tl++] = i;
          }
          const c = i - r;
          if (c >= 0) {
            while (dq[hd] < c - r) hd++;
            out[base + c * step] = buf[dq[hd]];
          }
        }
      }
    };
    const n = w * h, mx = new Float32Array(n), mn = new Float32Array(n), t = new Float32Array(n);
    run(z, t, w, h, w, 1, true); run(t, mx, h, w, 1, w, true);
    run(z, t, w, h, w, 1, false); run(t, mn, h, w, 1, w, false);
    for (let i = 0; i < n; i++) mx[i] -= mn[i];
    return mx;
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
