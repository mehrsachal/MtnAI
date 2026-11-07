/*
 * MtnAI ui — vector features, map grids and NATO symbols, drawn identically on the
 * 2D map (screen space) and into the texture draped over the 3D terrain.
 *
 * P = { xy(c, r) -> [x, y], ppc: pixels per cell, lw: line-width scale, cs: cell size (m) }
 */
(function (UI) {
  'use strict';
  const M = UI.M, cfg = UI.cfg;
  const FONT = '"Segoe UI", Roboto, Arial, sans-serif', MONO = 'Consolas, "Cascadia Mono", monospace';

  const path = (ctx, pts, P, close) => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = P.xy(pts[i][0], pts[i][1]);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    if (close) ctx.closePath();
  };
  const cased = (ctx, pts, P, color, width, dash, caseColor = 'rgba(0,0,0,0.7)') => {
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    path(ctx, pts, P);
    ctx.setLineDash([]);
    ctx.strokeStyle = caseColor; ctx.lineWidth = (width + 2.5) * P.lw; ctx.stroke();
    ctx.setLineDash(dash ? dash.map((d) => d * P.lw) : []);
    ctx.strokeStyle = color; ctx.lineWidth = width * P.lw; ctx.stroke();
    ctx.restore();
  };
  const arrowHead = (ctx, a, b, size, color) => {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    ctx.save();
    ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - size * Math.cos(ang - 0.45), b[1] - size * Math.sin(ang - 0.45));
    ctx.lineTo(b[0] - size * Math.cos(ang + 0.45), b[1] - size * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  };
  UI.haloText = (ctx, text, x, y, opts = {}) => {
    ctx.save();
    ctx.font = opts.font || `600 12px ${FONT}`;
    ctx.textAlign = opts.align || 'left'; ctx.textBaseline = opts.base || 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = opts.halo || 'rgba(0,0,0,0.85)'; ctx.lineWidth = opts.haloW || 3.2;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = opts.color || '#fff';
    ctx.fillText(text, x, y);
    ctx.restore();
  };
  const polar = (c, r, bearingDeg, distCells) => {
    const b = (bearingDeg * Math.PI) / 180;
    return [c + Math.sin(b) * distCells, r - Math.cos(b) * distCells];
  };
  const rgbaHex = (hx, a) => { const c = UI.hexRGB(hx); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  const accent = () => getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#4c8dff';

  /** Contours into a context (texture or screen). */
  UI.drawContours = (ctx, ct, P) => {
    if (!ct) return;
    const s = ct.segs;
    const base = cfg('map.contourColor');
    for (const pass of [0, 1]) {
      ctx.beginPath();
      for (let k = 0; k < ct.major.length; k++) {
        if (ct.major[k] !== pass) continue;
        const [x1, y1] = P.xy(s[k * 4], s[k * 4 + 1]), [x2, y2] = P.xy(s[k * 4 + 2], s[k * 4 + 3]);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.strokeStyle = rgbaHex(base, pass ? 0.9 : 0.5);
      ctx.lineWidth = (pass ? 1.3 : 0.6) * P.lw;
      ctx.stroke();
    }
  };

  // ------------------------------------------------------------------ map grids
  const niceStep = (spanM) => {
    for (const s of [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]) if (spanM / s <= 18) return s;
    return 100000;
  };
  const strokeLines = (ctx, lines, P, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width * P.lw;
    ctx.beginPath();
    for (const ln of lines) {
      let pen = false;
      for (const q of ln.pts) {
        if (!q) { pen = false; continue; }
        const [x, y] = P.xy(q[0], q[1]);
        if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
      }
    }
    ctx.stroke();
  };
  const sampleLine = (f, n = 28) => { const pts = []; for (let k = 0; k <= n; k++) pts.push(f(k / n)); return pts; };
  const cellOfLL = (g, lat, lon) => { const p = M.latLonToCell(g, lat, lon); return [p.c, p.r]; };

  /**
   * All configured grids: MGRS / UTM (analysis zone), WGS 84 graticule and the
   * secondary-CRS grid. bounds = visible cell window [c0, r0, c1, r1].
   * opts: {labels (edge labels, screen only), viewW, viewH}
   */
  UI.drawGrids = (ctx, g, P, bounds, opts = {}) => {
    const c0 = Math.max(-0.5, bounds[0]), r0 = Math.max(-0.5, bounds[1]);
    const c1 = Math.min(g.w - 0.5, bounds[2]), r1 = Math.min(g.h - 0.5, bounds[3]);
    if (c1 <= c0 || r1 <= r0) return;
    const width = +cfg('grid.width');
    const labels = [];
    ctx.save();
    if (cfg('grid.mgrs')) {
      const color = cfg('grid.mgrsColor');
      const E0 = g.x0 + (c0 + 0.5) * g.cs, E1 = g.x0 + (c1 + 0.5) * g.cs, N1 = g.y0 - (r0 + 0.5) * g.cs, N0 = g.y0 - (r1 + 0.5) * g.cs;
      const iv = cfg('grid.mgrsInterval');
      let step = iv === 'auto' ? niceStep(Math.max(E1 - E0, N1 - N0)) : +iv;
      if ((E1 - E0) / step > 400) step = niceStep(Math.max(E1 - E0, N1 - N0));
      const toC = (E) => (E - g.x0) / g.cs - 0.5, toR = (N) => (g.y0 - N) / g.cs - 0.5;
      const lines = [];
      for (let E = Math.ceil(E0 / step) * step; E <= E1; E += step) { lines.push({ pts: [[toC(E), r0], [toC(E), r1]] }); labels.push({ axis: 'x', v: E, at: P.xy(toC(E), r0), color, kind: 'utm' }); }
      for (let N = Math.ceil(N0 / step) * step; N <= N1; N += step) { lines.push({ pts: [[c0, toR(N)], [c1, toR(N)]] }); labels.push({ axis: 'y', v: N, at: P.xy(c0, toR(N)), color, kind: 'utm' }); }
      strokeLines(ctx, lines, P, rgbaHex(color, 0.6), width);
      if (opts.labels && cfg('grid.squareIds')) {
        for (let E = Math.floor(E0 / 1e5) * 1e5; E < E1; E += 1e5)
          for (let N = Math.floor(N0 / 1e5) * 1e5; N < N1; N += 1e5) {
            const ce = Math.min(Math.max(E + 5e4, E0 + 4 * g.cs), E1 - 4 * g.cs), cn = Math.min(Math.max(N + 5e4, N0 + 4 * g.cs), N1 - 4 * g.cs);
            const ll = M.fromUTM(ce, cn, g.zone, g.north);
            const id = M.utmToMGRS(ce, cn, g.zone, M.latBand(ll.lat) || 'N', 1).split(' ').slice(0, 2).join(' ');
            const [x, y] = P.xy(toC(ce), toR(cn));
            UI.haloText(ctx, id, x, y, { align: 'center', font: `700 13px ${MONO}`, color: rgbaHex(color, 0.95), haloW: 4 });
          }
      }
    }
    if (cfg('grid.graticule')) {
      const color = cfg('grid.graticuleColor');
      const corners = [[c0, r0], [c1, r0], [c0, r1], [c1, r1], [(c0 + c1) / 2, r0], [(c0 + c1) / 2, r1]].map(([c, r]) => M.cellToLatLon(g, r, c));
      const la0 = Math.min(...corners.map((p) => p.lat)), la1 = Math.max(...corners.map((p) => p.lat));
      const lo0 = Math.min(...corners.map((p) => p.lon)), lo1 = Math.max(...corners.map((p) => p.lon));
      const iv = cfg('grid.graticuleInterval');
      const span = Math.max(la1 - la0, lo1 - lo0) * 60;
      let st = iv === 'auto' ? [1, 2, 5, 10, 15, 30, 60, 120].find((m) => span / m <= 12) || 120 : +iv;
      if (span / st > 200) st = 60;
      const d = st / 60, lines = [];
      for (let lon = Math.ceil(lo0 / d) * d; lon <= lo1; lon += d) {
        const ln = { pts: sampleLine((t) => cellOfLL(g, la0 + (la1 - la0) * t, lon)) };
        lines.push(ln); labels.push({ axis: 'x', v: lon, line: ln, color, kind: 'lon' });
      }
      for (let lat = Math.ceil(la0 / d) * d; lat <= la1; lat += d) {
        const ln = { pts: sampleLine((t) => cellOfLL(g, lat, lo0 + (lo1 - lo0) * t)) };
        lines.push(ln); labels.push({ axis: 'y', v: lat, line: ln, color, kind: 'lat' });
      }
      ctx.setLineDash([6 * P.lw, 4 * P.lw]);
      strokeLines(ctx, lines, P, rgbaHex(color, 0.75), width);
      ctx.setLineDash([]);
    }
    const crs = cfg('grid.secondary') && UI.F.secondaryCRS();
    if (crs) {
      const color = cfg('grid.secondaryColor');
      const geo = M.isGeographic(crs);
      const pts = [];
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
        const ll = M.cellToLatLon(g, r0 + ((r1 - r0) * i) / 4, c0 + ((c1 - c0) * j) / 4);
        const p = M.crsForward(crs, ll.lat, ll.lon);
        pts.push(geo ? { x: p.lon, y: p.lat } : p);
      }
      const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
      const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
      const iv = cfg('grid.secondaryInterval');
      let step;
      if (geo) step = ([1, 2, 5, 10, 15, 30, 60].find((m) => (Math.max(x1 - x0, y1 - y0) * 60) / m <= 12) || 60) / 60;
      else step = iv === 'auto' ? niceStep(Math.max(x1 - x0, y1 - y0)) : +iv;
      if (!geo && Math.max(x1 - x0, y1 - y0) / step > 200) step = niceStep(Math.max(x1 - x0, y1 - y0));
      const toCell = (x, y) => { const ll = M.crsInverse(crs, x, y); return cellOfLL(g, ll.lat, ll.lon); };
      const lines = [];
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        const ln = { pts: sampleLine((t) => toCell(x, y0 + (y1 - y0) * t)) };
        lines.push(ln); labels.push({ axis: 'x', v: x, line: ln, color, kind: geo ? 'lon' : 'proj' });
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        const ln = { pts: sampleLine((t) => toCell(x0 + (x1 - x0) * t, y)) };
        lines.push(ln); labels.push({ axis: 'y', v: y, line: ln, color, kind: geo ? 'lat' : 'proj' });
      }
      ctx.setLineDash([2 * P.lw, 3 * P.lw]);
      strokeLines(ctx, lines, P, rgbaHex(color, 0.85), width);
      ctx.setLineDash([]);
    }
    if (opts.labels && cfg('grid.mgrsLabels') !== 'none') {
      const [xL, yT] = P.xy(c0, r0);
      const vw = opts.viewW || 1e9, vh = opts.viewH || 1e9;
      const full = cfg('grid.mgrsLabels') === 'full';
      const txt = (l) => {
        if (l.kind === 'utm') return full ? String(Math.round(l.v)) : String(Math.floor(l.v / 1000) % 100).padStart(2, '0');
        if (l.kind === 'proj') return full ? String(Math.round(l.v)) : String(Math.floor(l.v / 1000));
        const a = Math.abs(l.v), dg = Math.floor(a + 1e-9), mi = Math.round((a - dg) * 60);
        return `${dg}°${mi ? String(mi).padStart(2, '0') + "'" : ''}${l.kind === 'lat' ? (l.v >= 0 ? 'N' : 'S') : (l.v >= 0 ? 'E' : 'W')}`;
      };
      for (const l of labels) {
        let at = l.at;
        if (!at && l.line) {
          const pts = l.line.pts.filter(Boolean).map((q) => P.xy(q[0], q[1]));
          if (!pts.length) continue;
          at = l.axis === 'x' ? pts.reduce((a, b) => (b[1] < a[1] ? b : a)) : pts.reduce((a, b) => (b[0] < a[0] ? b : a));
        }
        if (!at) continue;
        const font = `${l.kind === 'utm' ? 600 : 400} 11px ${MONO}`;
        const off = l.kind === 'utm' ? 0 : l.kind === 'proj' ? 1 : 2;
        if (l.axis === 'x') UI.haloText(ctx, txt(l), Math.min(vw - 30, at[0] + 2), Math.max(yT, 0) + 9 + off * 13, { font, color: rgbaHex(l.color, 1) });
        else UI.haloText(ctx, txt(l), Math.max(xL, 0) + 3 + off * 44, Math.min(vh - 10, at[1] - 7), { font, color: rgbaHex(l.color, 1) });
      }
    }
    ctx.restore();
  };

  // ------------------------------------------------------------------ features
  UI.drawFeatures = (ctx, S, P) => {
    const sh = S.show;
    const g = S.grid;
    const lw = P.lw;
    const F = UI.F;
    const routeC = cfg('sym.routeColor'), avC = cfg('sym.avenueColor'), secC = cfg('sym.sectorColor'), selC = accent();
    const lblFont = (px, wgt = 600) => `${wgt} ${Math.round(px * lw)}px ${FONT}`;
    if (sh.obstacles !== false) for (const poly of S.obstacles) {
      ctx.save();
      path(ctx, poly, P, true);
      ctx.fillStyle = 'rgba(217,58,50,0.28)'; ctx.fill();
      ctx.strokeStyle = '#ff5b4f'; ctx.lineWidth = 2 * lw; ctx.setLineDash([6 * lw, 4 * lw]); ctx.stroke();
      ctx.restore();
    }
    if (sh.obstacles !== false) for (const ln of S.tracks) cased(ctx, ln, P, '#c8955c', 2.2, [7, 4]);

    if (sh.avenues && S.avenues) {
      S.avenues.routes.forEach((rt) => {
        if (rt.line.length < 2) return;
        cased(ctx, rt.line, P, avC, 3, [10, 6]);
        const n = rt.line.length;
        arrowHead(ctx, P.xy(...rt.line[n - 2]), P.xy(...rt.line[n - 1]), 14 * lw, avC);
      });
    }

    if (sh.mfd && S.mfd) {
      S.mfd.fields.forEach((f, k) => {
        const sel = S.sel && S.sel.kind === 'mfd' && S.sel.idx === k;
        ctx.save();
        path(ctx, f.poly, P, true);
        ctx.fillStyle = sel ? rgbaHex(selC, 0.3) : 'rgba(255,255,255,0.18)';
        ctx.fill();
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 4 * lw; ctx.stroke();
        ctx.setLineDash([8 * lw, 5 * lw]); ctx.strokeStyle = '#000'; ctx.lineWidth = 2 * lw; ctx.stroke();
        ctx.restore();
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
          UI.haloText(ctx, `${f.id} (${f.type})`, x, y - 14 * lw, { align: 'center', font: lblFont(11), color: '#ffe9a8' });
        }
      });
    }

    if (sh.weapons && S.weapons.length) {
      S.weapons.forEach((res, wi) => {
        if (res.hidden) return;
        res.sites.forEach((s, k) => {
          const sel = S.sel && S.sel.kind === 'weapon' && S.sel.idx === wi && S.sel.sub === k;
          if (s.cat !== 'indirect' && s.sector) {
            const R = s.maxR / g.cs;
            const L = polar(s.c, s.r, s.sector.left, R), Rr = polar(s.c, s.r, s.sector.right, R);
            ctx.save();
            ctx.strokeStyle = sel ? selC : secC; ctx.lineWidth = (sel ? 2.4 : 1.5) * lw; ctx.setLineDash([9 * lw, 5 * lw]);
            const o = P.xy(s.c, s.r);
            ctx.beginPath(); ctx.moveTo(...o); ctx.lineTo(...P.xy(...L)); ctx.moveTo(...o); ctx.lineTo(...P.xy(...Rr)); ctx.stroke();
            ctx.setLineDash([]); ctx.lineWidth = 1.2 * lw; ctx.beginPath();
            const span = (s.sector.right - s.sector.left + 360) % 360;
            for (let t = 0; t <= 24; t++) {
              const p = P.xy(...polar(s.c, s.r, s.sector.left + (span * t) / 24, R));
              if (t) ctx.lineTo(...p); else ctx.moveTo(...p);
            }
            ctx.stroke();
            ctx.setLineDash([2 * lw, 4 * lw]); ctx.beginPath(); ctx.moveTo(...o); ctx.lineTo(...P.xy(...polar(s.c, s.r, s.sector.mean, R * 0.6))); ctx.stroke();
            ctx.restore();
          } else if (s.cat === 'indirect' && res.target) {
            ctx.save();
            ctx.strokeStyle = sel ? selC : rgbaHex(secC, 0.9); ctx.lineWidth = 1.4 * lw; ctx.setLineDash([3 * lw, 5 * lw]);
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

    if (sh.posts && S.posts) {
      ctx.save();
      ctx.strokeStyle = 'rgba(128,224,255,0.85)'; ctx.lineWidth = 1.3 * lw; ctx.setLineDash([4 * lw, 4 * lw]);
      for (const [a, b] of S.posts.links) {
        const A = S.posts.posts[a], B = S.posts.posts[b];
        ctx.beginPath(); ctx.moveTo(...P.xy(A.c, A.r)); ctx.lineTo(...P.xy(B.c, B.r)); ctx.stroke();
      }
      ctx.restore();
    }

    if (sh.routes && S.routes) {
      const sel = S.routes.sel || 0;
      S.routes.routes.forEach((rt, k) => { if (k !== sel) cased(ctx, rt.line, P, rgbaHex(routeC, 0.75), 2.5, [8, 6]); });
      const rt = S.routes.routes[sel];
      if (rt) {
        cased(ctx, rt.line, P, routeC, 4);
        const n = rt.line.length;
        for (let q = 6; q < n - 1; q += 8) arrowHead(ctx, P.xy(...rt.line[q - 1]), P.xy(...rt.line[q]), 9 * lw, routeC);
      }
    }

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

    if (S.vsPoint) {
      const p = P.xy(S.vsPoint.c, S.vsPoint.r);
      ctx.save();
      ctx.fillStyle = cfg('ovl.viewshedColor'); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(...p, 6 * lw, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    if (S.gotoMark) {
      const [x, y] = P.xy(S.gotoMark.c, S.gotoMark.r);
      ctx.save();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4 * lw;
      const cross = () => { ctx.beginPath(); ctx.arc(x, y, 9 * lw, 0, Math.PI * 2); ctx.moveTo(x - 16 * lw, y); ctx.lineTo(x + 16 * lw, y); ctx.moveTo(x, y - 16 * lw); ctx.lineTo(x, y + 16 * lw); ctx.stroke(); };
      cross();
      ctx.strokeStyle = selC; ctx.lineWidth = 2 * lw; cross();
      ctx.restore();
    }

    if (sh.helipads !== false && S.helipads) {
      S.helipads.pads.forEach((q, k) => {
        const [x, y] = P.xy(q.c, q.r);
        const sel = S.sel && S.sel.kind === 'hls' && S.sel.idx === k;
        const R = Math.max(7 * lw, (S.helipads.params.padRadiusM / g.cs) * (P.ppc || 1));
        ctx.save();
        ctx.lineWidth = 2 * lw; ctx.strokeStyle = sel ? selC : '#000'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(x, y, Math.max(8 * lw, Math.min(R, 22 * lw)), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#000'; ctx.font = `700 ${Math.round(11 * lw)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('H', x, y + 0.5);
        ctx.restore();
        if (sh.labels) UI.haloText(ctx, q.id, x + 12 * lw, y - 10 * lw, { font: lblFont(11) });
      });
    }

    if (sh.key && S.key) {
      for (const pk of S.key.peaks) {
        const [x, y] = P.xy(pk.c, pk.r);
        ctx.save();
        ctx.fillStyle = '#111'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * lw;
        ctx.beginPath(); ctx.moveTo(x, y - 6 * lw); ctx.lineTo(x + 5 * lw, y + 3.5 * lw); ctx.lineTo(x - 5 * lw, y + 3.5 * lw); ctx.closePath();
        ctx.stroke(); ctx.fill();
        ctx.restore();
        if (sh.labels) UI.haloText(ctx, String(F.elevNum(pk.z)), x + 7 * lw, y, { font: lblFont(11) });
      }
      for (const ps of S.key.passes) {
        const [x, y] = P.xy(ps.c, ps.r);
        UI.haloText(ctx, ')(', x, y, { align: 'center', font: `700 ${Math.round(15 * lw)}px Georgia, serif`, color: '#ffe9a8' });
        if (sh.labels) UI.haloText(ctx, `Col ${F.elevNum(ps.z)}`, x + 10 * lw, y + 1, { font: lblFont(11, 400), color: '#ffe9a8' });
      }
    }
  };

  /**
   * Interactive drafts (digitising, measure, LOS, AOI) — drawn in the final feature style
   * so the shape is visible while it is being placed. P.xy may return null (3D: behind camera).
   */
  UI.drawDraft = (ctx, S, P) => {
    const d = S.draft;
    if (!d) return;
    const col = accent();
    const xy = (p) => P.xy(p[0], p[1]);
    const placed = d.pts.map(xy);
    const hover = d.hover ? xy(d.hover) : null;
    const style = d.kind === 'poly' ? { line: '#ff5b4f', fill: 'rgba(217,58,50,0.30)' } : d.kind === 'line' ? { line: '#d9a066' } : { line: col };
    const stroke = (pts, width, color, dash) => {
      const q = pts.filter(Boolean);
      if (q.length < 2) return;
      ctx.beginPath();
      q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.setLineDash(dash || []);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = width + 3; ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    };
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (d.kind === 'aoi') {
      if (placed[0] && (placed[1] || hover)) {
        const [x1, y1] = placed[0], [x2, y2] = placed[1] || hover;
        ctx.fillStyle = rgbaHex(col, 0.15);
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 5; ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([8, 5]); ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      }
    } else {
      // polygon fill preview (placed vertices + cursor)
      if (d.kind === 'poly') {
        const q = placed.concat(hover ? [hover] : []).filter(Boolean);
        if (q.length >= 3) {
          ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
          ctx.fillStyle = style.fill; ctx.fill();
        }
      }
      stroke(placed, 2.6, style.line);
      // rubber band to the cursor (and back to the first vertex for polygons)
      if (hover && placed.length) {
        stroke([placed[placed.length - 1], hover], 2, style.line, [7, 5]);
        if (d.kind === 'poly' && placed.length >= 2) stroke([hover, placed[0]], 1.5, style.line, [3, 5]);
      }
      ctx.setLineDash([]);
      placed.forEach((p, i) => {
        if (!p) return;
        ctx.fillStyle = i === 0 ? style.line : '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
        if (i === 0) { ctx.beginPath(); ctx.arc(p[0], p[1], 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        else { ctx.fillRect(p[0] - 4, p[1] - 4, 8, 8); ctx.strokeRect(p[0] - 4, p[1] - 4, 8, 8); }
      });
      const pts = d.pts.concat(d.hover ? [d.hover] : []);
      if ((d.kind === 'measure' || d.kind === 'los') && pts.length === 2 && S.grid && xy(pts[1])) {
        const g = S.grid;
        const dc = pts[1][0] - pts[0][0], dr = pts[1][1] - pts[0][1];
        const [x, y] = xy(pts[1]);
        UI.haloText(ctx, `${UI.F.dist(Math.hypot(dc, dr) * g.cs)} · ${UI.F.bearing(M.bearing(dc, -dr), pts[0][1], pts[0][0])}`, x + 10, y - 10, { font: `600 12px ${MONO}` });
      }
    }
    ctx.restore();
  };

  /** Length (m) and, for polygons, area (km²) of the current draft incl. the cursor point. */
  UI.draftMetrics = (S) => {
    const d = S.draft, g = S.grid;
    if (!d || !g) return null;
    const pts = d.pts.concat(d.hover ? [d.hover] : []);
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) * g.cs;
    let area = 0;
    if (d.kind === 'poly' && pts.length >= 3) {
      for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
      area = (Math.abs(area) / 2) * g.cs * g.cs / 1e6;
      len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) * g.cs;
    }
    return { n: d.pts.length, len, area };
  };

  /** Collect symbol placements from state. */
  UI.symbolItems = (S) => {
    const items = [];
    const sh = S.show;
    const mk = S.markers;
    const F = UI.F;
    const isSel = (kind, idx, sub) => !!S.sel && S.sel.kind === kind && S.sel.idx === idx && (sub === undefined || S.sel.sub === sub);
    if (sh.posts && S.posts) S.posts.posts.forEach((p, k) => items.push({ c: p.c, r: p.r, spec: S.posts.mode === 'op' ? UI.SYM.op() : UI.SYM.post(S.posts.echelon), label: p.strongPoint ? `${p.id} SP` : p.id, sub: F.elev(p.z), ref: { kind: 'post', idx: k }, sel: isSel('post', k) }));
    if (sh.weapons) S.weapons.forEach((res, wi) => !res.hidden && res.sites.forEach((s, k) => items.push({ c: s.c, r: s.r, spec: UI.SYM.weapon(res.weapon), label: s.id, ref: { kind: 'weapon', idx: wi, sub: k }, sel: isSel('weapon', wi, k) })));
    if (sh.picquets && S.picquets) S.picquets.picquets.forEach((p, k) => items.push({ c: p.c, r: p.r, spec: UI.SYM.picquet(), label: p.id, ref: { kind: 'picquet', idx: k }, sel: isSel('picquet', k) }));
    if (sh.hostileOps && S.hostile) S.hostile.observers.filter((o) => !o.isThreat).forEach((o) => items.push({ c: o.c, r: o.r, spec: UI.SYM.hostileOP(), small: true }));
    if (sh.routes && S.routes) {
      const rt = S.routes.routes[S.routes.sel || 0];
      if (rt) rt.checkpoints.forEach((cp, k) => items.push({ c: cp.c, r: cp.r, spec: UI.SYM.cp(k + 1), small: true }));
    }
    if (sh.markers === false) return items;
    if (mk.target) items.push({ c: mk.target.c, r: mk.target.r, spec: UI.SYM.target(), label: 'TGT', ref: { kind: 'marker', idx: 'target' }, sel: isSel('marker', 'target') });
    if (mk.threat) items.push({ c: mk.threat.c, r: mk.threat.r, spec: UI.SYM.threat(S.threatType), label: 'ENY', ref: { kind: 'marker', idx: 'threat' }, sel: isSel('marker', 'threat') });
    if (mk.own) items.push({ c: mk.own.c, r: mk.own.r, spec: UI.SYM.own(S.ownEchelon), label: 'OWN', ref: { kind: 'marker', idx: 'own' }, sel: isSel('marker', 'own') });
    if (mk.a) items.push({ c: mk.a.c, r: mk.a.r, spec: UI.SYM.sp(), label: 'A', ref: { kind: 'marker', idx: 'a' }, sel: isSel('marker', 'a') });
    if (mk.b) items.push({ c: mk.b.c, r: mk.b.r, spec: UI.SYM.rp(), label: 'B', ref: { kind: 'marker', idx: 'b' }, sel: isSel('marker', 'b') });
    return items;
  };

  /**
   * Draw symbol items. project(c, r) -> {x, y, hidden?} | null.
   * opts: {size, labels, lift (px leader line for 3D)}
   */
  UI.drawSymbols = (ctx, items, project, opts = {}) => {
    const size = opts.size || 30;
    const lpx = +cfg('sym.labelSize');
    const selC = accent();
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
        ctx.strokeStyle = selC; ctx.lineWidth = 2;
        ctx.strokeRect(x - s.ax - 4, y - s.ay - 4, s.w + 8, s.h + 8);
      }
      ctx.drawImage(s.img, x - s.ax, y - s.ay, s.w, s.h);
      if (opts.labels && it.label) {
        UI.haloText(ctx, it.label, x + s.w - s.ax + 3, y - (it.sub ? lpx * 0.55 : 0), { font: `700 ${lpx}px ${FONT}` });
        if (it.sub) UI.haloText(ctx, it.sub, x + s.w - s.ax + 3, y + lpx * 0.6, { font: `${lpx - 1}px ${FONT}`, color: '#d6e2d6' });
      }
      ctx.restore();
    }
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
