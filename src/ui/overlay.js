/*
 * MtnAI ui — vector features and NATO symbols, drawn identically on the 2D map
 * (screen space) and into the texture draped over the 3D terrain.
 *
 * P = { xy(c, r) -> [x, y], ppc: pixels per cell, lw: line-width scale, cs: cell size (m) }
 */
(function (UI) {
  'use strict';

  const FRIEND = '#1f7cff', HOSTILE = '#ff3b30', ROUTE = '#27d3ff', TRACK = '#c8955c';

  const path = (ctx, pts, P, close) => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = P.xy(pts[i][0], pts[i][1]);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    if (close) ctx.closePath();
  };
  const cased = (ctx, pts, P, color, width, dash, caseColor = 'rgba(0,0,0,0.75)') => {
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    path(ctx, pts, P);
    ctx.setLineDash([]);
    ctx.strokeStyle = caseColor; ctx.lineWidth = (width + 3) * P.lw; ctx.stroke();
    ctx.setLineDash(dash ? dash.map((d) => d * P.lw) : []);
    ctx.strokeStyle = color; ctx.lineWidth = width * P.lw; ctx.stroke();
    ctx.restore();
  };
  const arrowHead = (ctx, a, b, size, color) => {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    ctx.save();
    ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - size * Math.cos(ang - 0.45), b[1] - size * Math.sin(ang - 0.45));
    ctx.lineTo(b[0] - size * Math.cos(ang + 0.45), b[1] - size * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  };
  UI.haloText = (ctx, text, x, y, opts = {}) => {
    ctx.save();
    ctx.font = opts.font || '600 12px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.textAlign = opts.align || 'left'; ctx.textBaseline = opts.base || 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = opts.halo || 'rgba(0,0,0,0.85)'; ctx.lineWidth = opts.haloW || 3.5;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = opts.color || '#fff';
    ctx.fillText(text, x, y);
    ctx.restore();
  };
  /** Point at bearing (deg, grid) and distance (cells) from (c, r). */
  const polar = (c, r, bearingDeg, distCells) => {
    const b = (bearingDeg * Math.PI) / 180;
    return [c + Math.sin(b) * distCells, r - Math.cos(b) * distCells];
  };

  /** Contours into a context (texture or screen). */
  UI.drawContours = (ctx, ct, P) => {
    if (!ct) return;
    const s = ct.segs;
    for (const pass of [0, 1]) {
      ctx.beginPath();
      for (let k = 0; k < ct.major.length; k++) {
        if (ct.major[k] !== pass) continue;
        const [x1, y1] = P.xy(s[k * 4], s[k * 4 + 1]), [x2, y2] = P.xy(s[k * 4 + 2], s[k * 4 + 3]);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.strokeStyle = pass ? 'rgba(92,52,20,0.85)' : 'rgba(110,66,30,0.5)';
      ctx.lineWidth = (pass ? 1.3 : 0.6) * P.lw;
      ctx.stroke();
    }
  };

  /** MGRS / UTM 1 km grid (lines are axis-aligned because the grid is in UTM). */
  UI.drawGridLines = (ctx, g, P, bounds, labels) => {
    const [c0, r0, c1, r1] = bounds;
    const E0 = g.x0 + (c0 + 0.5) * g.cs, E1 = g.x0 + (c1 + 0.5) * g.cs;
    const N1 = g.y0 - (r0 + 0.5) * g.cs, N0 = g.y0 - (r1 + 0.5) * g.cs;
    const spanKm = Math.max(E1 - E0, N1 - N0) / 1000;
    const step = spanKm > 60 ? 10000 : spanKm > 25 ? 5000 : 1000;
    ctx.save();
    ctx.strokeStyle = 'rgba(40,110,255,0.55)'; ctx.lineWidth = 0.8 * P.lw;
    ctx.beginPath();
    const toC = (E) => (E - g.x0) / g.cs - 0.5, toR = (N) => (g.y0 - N) / g.cs - 0.5;
    const rTop = Math.max(-0.5, r0), rBot = Math.min(g.h - 0.5, r1), cL = Math.max(-0.5, c0), cR = Math.min(g.w - 0.5, c1);
    const eLines = [], nLines = [];
    for (let E = Math.ceil(E0 / step) * step; E <= E1; E += step) {
      const c = toC(E);
      if (c < -0.5 || c > g.w - 0.5) continue;
      const [x1, y1] = P.xy(c, rTop), [x2, y2] = P.xy(c, rBot);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      eLines.push([E, x1]);
    }
    for (let N = Math.ceil(N0 / step) * step; N <= N1; N += step) {
      const r = toR(N);
      if (r < -0.5 || r > g.h - 0.5) continue;
      const [x1, y1] = P.xy(cL, r), [x2, y2] = P.xy(cR, r);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      nLines.push([N, y1]);
    }
    ctx.stroke();
    if (labels) {
      const [, yTop] = P.xy(cL, rTop), [xLeft] = P.xy(cL, rTop);
      const fmt = (v) => String(Math.floor(v / 1000) % 100).padStart(2, '0');
      for (const [E, x] of eLines) UI.haloText(ctx, fmt(E), x + 2, Math.max(yTop, 0) + 9, { font: '11px ui-monospace, Consolas, monospace', color: '#cfe0ff' });
      for (const [N, y] of nLines) UI.haloText(ctx, fmt(N), Math.max(xLeft, 0) + 3, y - 7, { font: '11px ui-monospace, Consolas, monospace', color: '#cfe0ff' });
    }
    ctx.restore();
  };

  /** All vector features except symbols. S = app state. */
  UI.drawFeatures = (ctx, S, P) => {
    const sh = S.show;
    const g = S.grid;
    const lw = P.lw;
    // obstacles & tracks
    for (const poly of S.obstacles) {
      ctx.save();
      path(ctx, poly, P, true);
      ctx.fillStyle = 'rgba(217,58,50,0.28)'; ctx.fill();
      ctx.strokeStyle = '#ff5b4f'; ctx.lineWidth = 2 * lw; ctx.setLineDash([6 * lw, 4 * lw]); ctx.stroke();
      ctx.restore();
    }
    for (const ln of S.tracks) cased(ctx, ln, P, TRACK, 2.2, [7, 4]);

    // enemy avenues of approach
    if (sh.avenues && S.avenues) {
      S.avenues.routes.forEach((rt) => {
        if (rt.line.length < 2) return;
        cased(ctx, rt.line, P, HOSTILE, 3, [10, 6]);
        const n = rt.line.length;
        arrowHead(ctx, P.xy(...rt.line[n - 2]), P.xy(...rt.line[n - 1]), 14 * lw, HOSTILE);
      });
    }

    // minefields
    if (sh.mfd && S.mfd) {
      S.mfd.fields.forEach((f, k) => {
        const sel = S.sel && S.sel.kind === 'mfd' && S.sel.idx === k;
        ctx.save();
        path(ctx, f.poly, P, true);
        ctx.fillStyle = sel ? 'rgba(46,230,214,0.32)' : 'rgba(255,255,255,0.18)';
        ctx.fill();
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 4 * lw; ctx.stroke();
        ctx.setLineDash([8 * lw, 5 * lw]); ctx.strokeStyle = '#000'; ctx.lineWidth = 2 * lw; ctx.stroke();
        ctx.restore();
        // mine glyphs along the front
        const img = UI.symbolImage(UI.SYM.mine(f.type), Math.max(10, 12 * lw));
        const [a, b, c2, d] = f.poly;
        const mid = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        if (img) {
          for (const t of [0.25, 0.5, 0.75]) {
            const p1 = mid(a, b, t), p2 = mid(d, c2, t);
            const [x, y] = P.xy((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
            ctx.drawImage(img.img, x - img.ax, y - img.ay, img.w, img.h);
          }
        }
        if (sh.labels) {
          const [x, y] = P.xy(f.c, f.r);
          UI.haloText(ctx, `${f.id} (${f.type})`, x, y - 14 * lw, { align: 'center', font: `600 ${Math.round(11 * lw)}px "Segoe UI", Arial`, color: '#ffe9a8' });
        }
      });
    }

    // weapons: sectors of fire, range rings, lines to target
    if (sh.weapons && S.weapons.length) {
      S.weapons.forEach((res, wi) => {
        res.sites.forEach((s, k) => {
          const sel = S.sel && S.sel.kind === 'weapon' && S.sel.idx === wi && S.sel.sub === k;
          if (s.cat !== 'indirect' && s.sector) {
            const R = s.maxR / g.cs;
            const L = polar(s.c, s.r, s.sector.left, R), Rr = polar(s.c, s.r, s.sector.right, R);
            ctx.save();
            ctx.strokeStyle = sel ? '#2ee6d6' : FRIEND; ctx.lineWidth = (sel ? 2.4 : 1.6) * lw; ctx.setLineDash([9 * lw, 5 * lw]);
            const o = P.xy(s.c, s.r);
            ctx.beginPath(); ctx.moveTo(...o); ctx.lineTo(...P.xy(...L)); ctx.moveTo(...o); ctx.lineTo(...P.xy(...Rr)); ctx.stroke();
            // arc
            ctx.setLineDash([]); ctx.lineWidth = 1.2 * lw; ctx.beginPath();
            let span = (s.sector.right - s.sector.left + 360) % 360;
            for (let t = 0; t <= 24; t++) {
              const p = P.xy(...polar(s.c, s.r, s.sector.left + (span * t) / 24, R));
              if (t) ctx.lineTo(...p); else ctx.moveTo(...p);
            }
            ctx.stroke();
            // principal direction of fire
            ctx.setLineDash([2 * lw, 4 * lw]); ctx.beginPath(); ctx.moveTo(...o); ctx.lineTo(...P.xy(...polar(s.c, s.r, s.sector.mean, R * 0.6))); ctx.stroke();
            ctx.restore();
          } else if (s.cat === 'indirect' && res.target) {
            ctx.save();
            ctx.strokeStyle = sel ? '#2ee6d6' : 'rgba(31,124,255,0.9)'; ctx.lineWidth = 1.4 * lw; ctx.setLineDash([3 * lw, 5 * lw]);
            ctx.beginPath(); ctx.moveTo(...P.xy(s.c, s.r)); ctx.lineTo(...P.xy(res.target.c, res.target.r)); ctx.stroke();
            if (sel) {
              for (const [rad, dash] of [[s.maxR, [12, 6]], [s.minR, [3, 4]]]) {
                if (!rad) continue;
                ctx.setLineDash(dash.map((d) => d * lw));
                ctx.beginPath();
                for (let t = 0; t <= 96; t++) { const p = P.xy(...polar(s.c, s.r, (t * 360) / 96, rad / g.cs)); if (t) ctx.lineTo(...p); else ctx.moveTo(...p); }
                ctx.stroke();
              }
            }
            ctx.restore();
          }
        });
      });
    }

    // posts: intervisibility links
    if (sh.posts && S.posts) {
      ctx.save();
      ctx.strokeStyle = 'rgba(128,224,255,0.85)'; ctx.lineWidth = 1.3 * lw; ctx.setLineDash([4 * lw, 4 * lw]);
      for (const [a, b] of S.posts.links) {
        const A = S.posts.posts[a], B = S.posts.posts[b];
        ctx.beginPath(); ctx.moveTo(...P.xy(A.c, A.r)); ctx.lineTo(...P.xy(B.c, B.r)); ctx.stroke();
      }
      ctx.restore();
    }

    // friendly routes
    if (sh.routes && S.routes) {
      const sel = S.routes.sel || 0;
      S.routes.routes.forEach((rt, k) => { if (k !== sel) cased(ctx, rt.line, P, 'rgba(39,211,255,0.75)', 2.5, [8, 6]); });
      const rt = S.routes.routes[sel];
      if (rt) {
        cased(ctx, rt.line, P, ROUTE, 4);
        const n = rt.line.length;
        // direction chevrons
        for (let q = 6; q < n - 1; q += 8) arrowHead(ctx, P.xy(...rt.line[q - 1]), P.xy(...rt.line[q]), 9 * lw, ROUTE);
      }
    }

    // line of sight
    if (S.los && S.los.res) {
      const { a, b, res } = S.los;
      const pts = res.profile;
      const bi = res.blockIndex;
      ctx.save();
      ctx.lineWidth = 3 * lw;
      ctx.strokeStyle = '#3ddc66';
      const pa = P.xy(a.c, a.r), pb = P.xy(b.c, b.r);
      if (bi < 0) { ctx.beginPath(); ctx.moveTo(...pa); ctx.lineTo(...pb); ctx.stroke(); }
      else {
        const pk = P.xy(pts[bi].c, pts[bi].r);
        ctx.beginPath(); ctx.moveTo(...pa); ctx.lineTo(...pk); ctx.stroke();
        ctx.strokeStyle = '#ff4136'; ctx.beginPath(); ctx.moveTo(...pk); ctx.lineTo(...pb); ctx.stroke();
        ctx.fillStyle = '#ff4136'; ctx.beginPath(); ctx.arc(...pk, 5 * lw, 0, Math.PI * 2); ctx.fill();
      }
      for (const p of [pa, pb]) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(...p, 4.5 * lw, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }

    // viewshed observer
    if (S.vsPoint) {
      const p = P.xy(S.vsPoint.c, S.vsPoint.r);
      ctx.save();
      ctx.fillStyle = '#ffe246'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(...p, 6 * lw, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // key terrain: spot heights and passes
    if (sh.key && S.key) {
      for (const pk of S.key.peaks) {
        const [x, y] = P.xy(pk.c, pk.r);
        ctx.save();
        ctx.fillStyle = '#111'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * lw;
        ctx.beginPath(); ctx.moveTo(x, y - 6 * lw); ctx.lineTo(x + 5 * lw, y + 3.5 * lw); ctx.lineTo(x - 5 * lw, y + 3.5 * lw); ctx.closePath();
        ctx.stroke(); ctx.fill();
        ctx.restore();
        if (sh.labels) UI.haloText(ctx, String(Math.round(pk.z)), x + 7 * lw, y, { font: `600 ${Math.round(11 * lw)}px "Segoe UI", Arial` });
      }
      for (const ps of S.key.passes) {
        const [x, y] = P.xy(ps.c, ps.r);
        UI.haloText(ctx, ')(', x, y, { align: 'center', font: `700 ${Math.round(15 * lw)}px Georgia, serif`, color: '#ffe9a8' });
        if (sh.labels) UI.haloText(ctx, `Col ${Math.round(ps.z)}`, x + 10 * lw, y + 1, { font: `${Math.round(11 * lw)}px "Segoe UI", Arial`, color: '#ffe9a8' });
      }
    }
  };

  /** Interactive drafts (screen only): polygons, lines, measure, AOI. */
  UI.drawDraft = (ctx, S, P) => {
    const d = S.draft;
    if (!d) return;
    const pts = d.pts.concat(d.hover ? [d.hover] : []);
    ctx.save();
    ctx.strokeStyle = '#2ee6d6'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    if (d.kind === 'aoi' && pts.length === 2) {
      const [x1, y1] = P.xy(...pts[0]), [x2, y2] = P.xy(...pts[1]);
      ctx.fillStyle = 'rgba(46,230,214,0.10)';
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (pts.length) {
      path(ctx, pts, P, d.kind === 'poly');
      if (d.kind === 'poly') { ctx.fillStyle = 'rgba(46,230,214,0.12)'; ctx.fill(); }
      ctx.stroke();
      for (const p of d.pts) { const [x, y] = P.xy(...p); ctx.setLineDash([]); ctx.fillStyle = '#2ee6d6'; ctx.fillRect(x - 3, y - 3, 6, 6); }
      if ((d.kind === 'measure' || d.kind === 'los') && pts.length === 2 && S.grid) {
        const g = S.grid;
        const dc = pts[1][0] - pts[0][0], dr = pts[1][1] - pts[0][1];
        const dist = Math.hypot(dc, dr) * g.cs;
        const brg = UI.M.bearing(dc, -dr);
        const [x, y] = P.xy(pts[1][0], pts[1][1]);
        UI.haloText(ctx, `${dist >= 1000 ? (dist / 1000).toFixed(2) + ' km' : Math.round(dist) + ' m'} · ${Math.round(UI.M.mils(brg))} mils (${brg.toFixed(1)}°)`, x + 10, y - 10, { color: '#8ff5ea', font: '600 12px ui-monospace, Consolas, monospace' });
      }
    }
    ctx.restore();
  };

  /** Collect symbol placements from state. */
  UI.symbolItems = (S) => {
    const items = [];
    const sh = S.show;
    const mk = S.markers;
    const isSel = (kind, idx, sub) => !!S.sel && S.sel.kind === kind && S.sel.idx === idx && (sub === undefined || S.sel.sub === sub);
    if (sh.posts && S.posts) S.posts.posts.forEach((p, k) => items.push({ c: p.c, r: p.r, spec: S.posts.mode === 'op' ? UI.SYM.op() : UI.SYM.post(S.posts.echelon), label: p.id, sub: `${Math.round(p.z)} m`, ref: { kind: 'post', idx: k }, sel: isSel('post', k) }));
    if (sh.weapons) S.weapons.forEach((res, wi) => res.sites.forEach((s, k) => items.push({ c: s.c, r: s.r, spec: UI.SYM.weapon(res.weapon), label: s.id, ref: { kind: 'weapon', idx: wi, sub: k }, sel: isSel('weapon', wi, k) })));
    if (sh.picquets && S.picquets) S.picquets.picquets.forEach((p, k) => items.push({ c: p.c, r: p.r, spec: UI.SYM.picquet(), label: p.id, ref: { kind: 'picquet', idx: k }, sel: isSel('picquet', k) }));
    if (sh.hostileOps && S.hostile) S.hostile.observers.filter((o) => !o.isThreat).forEach((o) => items.push({ c: o.c, r: o.r, spec: UI.SYM.hostileOP(), small: true }));
    if (sh.routes && S.routes) {
      const rt = S.routes.routes[S.routes.sel || 0];
      if (rt) rt.checkpoints.forEach((cp, k) => items.push({ c: cp.c, r: cp.r, spec: UI.SYM.cp(k + 1), small: true }));
    }
    if (mk.target) items.push({ c: mk.target.c, r: mk.target.r, spec: UI.SYM.target(), label: 'TGT' });
    if (mk.threat) items.push({ c: mk.threat.c, r: mk.threat.r, spec: UI.SYM.threat(S.threatType), label: 'ENY' });
    if (mk.own) items.push({ c: mk.own.c, r: mk.own.r, spec: UI.SYM.own(S.ownEchelon), label: 'OWN' });
    if (mk.a) items.push({ c: mk.a.c, r: mk.a.r, spec: UI.SYM.sp(), label: 'A' });
    if (mk.b) items.push({ c: mk.b.c, r: mk.b.r, spec: UI.SYM.rp(), label: 'B' });
    return items;
  };

  /**
   * Draw symbol items. project(c, r) -> {x, y, hidden?} | null.
   * opts: {size, labels, lift (px leader line for 3D)}
   */
  UI.drawSymbols = (ctx, items, project, opts = {}) => {
    const size = opts.size || 30;
    for (const it of items) {
      const p = project(it.c, it.r);
      if (!p) continue;
      const sz = it.small ? size * 0.72 : size;
      const s = UI.symbolImage(it.spec, sz);
      if (!s) continue;
      let x = p.x, y = p.y;
      ctx.save();
      if (p.hidden) ctx.globalAlpha = 0.35;
      if (opts.lift) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - opts.lift); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        y -= opts.lift;
      }
      if (it.sel) {
        ctx.strokeStyle = '#2ee6d6'; ctx.lineWidth = 2.5; ctx.shadowColor = '#2ee6d6'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(x, y, Math.max(s.w, s.h) * 0.55, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
      }
      ctx.drawImage(s.img, x - s.ax, y - s.ay, s.w, s.h);
      if (opts.labels && it.label) {
        UI.haloText(ctx, it.label, x + s.w - s.ax + 3, y - (it.sub ? 7 : 0), { font: '700 12px "Segoe UI", Arial' });
        if (it.sub) UI.haloText(ctx, it.sub, x + s.w - s.ax + 3, y + 7, { font: '11px "Segoe UI", Arial', color: '#d6e2d6' });
      }
      ctx.restore();
    }
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
