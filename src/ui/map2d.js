/*
 * MtnAI ui — 2D map view (grid-north up, UTM metric space) on a canvas.
 * Pan: drag · Zoom: wheel / pinch · Tools are dispatched to the app.
 */
(function (UI) {
  'use strict';

  class Map2D {
    constructor(canvas, app) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.app = app;
      this.view = { cx: 0, cy: 0, scale: 1 };
      this.W = 1; this.H = 1; this.dpr = 1;
      this._raf = 0;
      this._bind();
      new ResizeObserver(() => { this.resize(); }).observe(canvas);
    }

    resize() {
      const r = this.cv.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
      this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
      this.render();
    }

    fit() {
      const g = this.app.S.grid;
      if (!g) return;
      this.view.scale = Math.min(this.W / g.w, this.H / g.h) * 0.94;
      this.view.cx = g.w / 2 - 0.5; this.view.cy = g.h / 2 - 0.5;
      this.render();
    }

    centerOn(c, r, scale) {
      this.view.cx = c; this.view.cy = r;
      if (scale) this.view.scale = scale;
      this.render();
    }

    toScreen(c, r) { return [(c - this.view.cx) * this.view.scale + this.W / 2, (r - this.view.cy) * this.view.scale + this.H / 2]; }
    toCell(x, y) { return [(x - this.W / 2) / this.view.scale + this.view.cx, (y - this.H / 2) / this.view.scale + this.view.cy]; }

    zoomAt(x, y, f) {
      const [c, r] = this.toCell(x, y);
      const g = this.app.S.grid;
      const minS = g ? Math.min(this.W / g.w, this.H / g.h) * 0.25 : 0.01;
      this.view.scale = Math.min(60, Math.max(minS, this.view.scale * f));
      this.view.cx = c - (x - this.W / 2) / this.view.scale;
      this.view.cy = r - (y - this.H / 2) / this.view.scale;
      this.render();
    }

    render() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
    }

    draw() {
      const ctx = this.ctx, S = this.app.S, g = S.grid;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = UI.cfg('map.background');
      ctx.fillRect(0, 0, this.W, this.H);
      if (!g || !S.baseCanvas) return;
      const P = { xy: (c, r) => this.toScreen(c, r), ppc: this.view.scale, lw: 1, cs: g.cs };
      // raster base + overlays (pre-composited)
      const [x0, y0] = this.toScreen(-0.5, -0.5);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(S.baseCanvas, x0, y0, g.w * this.view.scale, g.h * this.view.scale);
      // frame
      ctx.strokeStyle = 'rgba(128,128,128,0.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, g.w * this.view.scale, g.h * this.view.scale);
      const [c0, r0] = this.toCell(0, 0), [c1, r1] = this.toCell(this.W, this.H);
      UI.drawGrids(ctx, g, P, [c0, r0, c1, r1], { labels: true, viewW: this.W, viewH: this.H });
      UI.drawFeatures(ctx, S, P);
      UI.drawDraft(ctx, S, P);
      if (S.show.symbols) {
        UI.drawSymbols(ctx, UI.symbolItems(S), (c, r) => { const [x, y] = this.toScreen(c, r); return { x, y }; },
          { size: +UI.cfg('sym.size'), labels: S.show.labels && UI.cfg('sym.labels') });
      }
      this._hud(ctx, g);
      if (this.onRender) this.onRender();
    }

    /** Representative scale denominator at 0.28 mm / pixel (OGC standard rendering pixel). */
    scaleDenominator() {
      const g = this.app.S.grid;
      return g ? (g.cs / this.view.scale) / 0.00028 : 0;
    }

    _hud(ctx, g) {
      const F = UI.F;
      ctx.save();
      if (UI.cfg('map.scaleBar')) {
        const mPerPx = g.cs / this.view.scale;
        const target = mPerPx * 140;
        const nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
        let len = nice[0];
        for (const n of nice) if (n <= target) len = n;
        const px = len / mPerPx;
        const x = 14, y = this.H - 16;
        ctx.fillStyle = 'rgba(20,22,26,0.78)'; ctx.fillRect(x - 6, y - 22, px + 74, 30);
        for (let k = 0; k < 4; k++) { ctx.fillStyle = k % 2 ? '#000' : '#fff'; ctx.fillRect(x + (k * px) / 4, y - 4, px / 4, 4); }
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x, y - 4, px, 4);
        UI.haloText(ctx, F.dist(len), x + px + 6, y - 2, { font: '11px Segoe UI, Arial' });
        UI.haloText(ctx, `1:${Math.round(this.scaleDenominator() / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','), x, y - 14, { font: '10px Segoe UI, Arial', color: '#d0d4da' });
      }
      // north arrow / declination diagram (GN · TN · MN)
      const cx = this.W - 46, cy = this.H - 22, L = 44;
      const c = this.view.cx, r = this.view.cy;
      const conv = F.convergence(r, c), decl = F.declination();
      const line = (gridDeg, label, style) => {
        const a = (gridDeg * Math.PI) / 180;
        const x2 = cx + Math.sin(a) * L, y2 = cy - Math.cos(a) * L;
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash(style === 'dash' ? [4, 3] : []);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
        const side = gridDeg === 0 ? 0 : Math.sign(gridDeg);
        UI.haloText(ctx, label, x2 + Math.sin(a) * 9 + side * 8, y2 - Math.cos(a) * 9, { align: side < 0 ? 'right' : side > 0 ? 'left' : 'center', font: '700 10px Segoe UI, Arial' });
      };
      if (UI.cfg('north.diagram')) {
        // small angles are exaggerated for legibility (values are printed)
        const vis = (d) => (Math.abs(d) < 0.01 ? 0 : Math.sign(d) * Math.min(40, 8 + Math.abs(d) * 3.5));
        line(0, 'GN');
        line(vis(-conv), 'TN', 'dash');
        if (Math.abs(+UI.cfg('north.declination')) > 0 || Math.abs(+UI.cfg('north.annual')) > 0) line(vis(decl - conv), 'MN', 'dash');
        ctx.fillStyle = 'rgba(20,22,26,0.78)';
        const txt = [`γ ${conv >= 0 ? '+' : ''}${conv.toFixed(2)}°`, `δ ${decl >= 0 ? '+' : ''}${decl.toFixed(2)}°`, `GMA ${F.angle(decl - conv)}`];
        ctx.fillRect(cx - 132, cy - 46, 74, 46);
        txt.forEach((t, k) => UI.haloText(ctx, t, cx - 128, cy - 38 + k * 14, { font: '10px Consolas, monospace', color: '#d0d4da' }));
      } else {
        ctx.translate(cx, cy - 18);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(7, 8); ctx.lineTo(0, 3); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
        UI.haloText(ctx, 'GN', 0, 18, { align: 'center', font: '700 10px Segoe UI, Arial' });
      }
      ctx.restore();
    }

    _bind() {
      const cv = this.cv;
      let drag = null;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      cv.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const [x, y] = pos(e);
        drag = { x, y, cx: this.view.cx, cy: this.view.cy, moved: false };
      });
      window.addEventListener('mousemove', (e) => {
        const [x, y] = pos(e);
        if (drag) {
          const dx = x - drag.x, dy = y - drag.y;
          if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; cv.classList.add('dragging'); }
          if (drag.moved) {
            this.view.cx = drag.cx - dx / this.view.scale;
            this.view.cy = drag.cy - dy / this.view.scale;
            this.render();
          }
        } else if (e.target === cv) {
          const [c, r] = this.toCell(x, y);
          this.app.onHover(c, r, x, y);
        }
      });
      window.addEventListener('mouseup', (e) => {
        if (!drag) return;
        const d = drag;
        drag = null;
        cv.classList.remove('dragging');
        if (!d.moved && e.target === cv) {
          const [x, y] = pos(e);
          const [c, r] = this.toCell(x, y);
          this.app.onClick(c, r, { x, y, shift: e.shiftKey, detail: e.detail });
        }
      });
      cv.addEventListener('dblclick', (e) => {
        const [x, y] = pos(e);
        const [c, r] = this.toCell(x, y);
        this.app.onDblClick(c, r);
      });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const [x, y] = pos(e);
        this.zoomAt(x, y, Math.pow(1.0015, -e.deltaY));
      }, { passive: false });
      cv.addEventListener('mouseleave', () => this.app.onHover(null));
      // touch: one finger pan / tap, two fingers pinch-zoom
      let t0 = null;
      cv.addEventListener('touchstart', (e) => {
        const ts = [...e.touches].map((t) => pos(t));
        t0 = { ts, cx: this.view.cx, cy: this.view.cy, scale: this.view.scale, moved: false };
      }, { passive: true });
      cv.addEventListener('touchmove', (e) => {
        if (!t0) return;
        e.preventDefault();
        const ts = [...e.touches].map((t) => pos(t));
        if (ts.length === 1 && t0.ts.length === 1) {
          const dx = ts[0][0] - t0.ts[0][0], dy = ts[0][1] - t0.ts[0][1];
          if (Math.hypot(dx, dy) > 6) t0.moved = true;
          this.view.cx = t0.cx - dx / this.view.scale; this.view.cy = t0.cy - dy / this.view.scale;
        } else if (ts.length === 2 && t0.ts.length === 2) {
          t0.moved = true;
          const d0 = Math.hypot(t0.ts[0][0] - t0.ts[1][0], t0.ts[0][1] - t0.ts[1][1]);
          const d1 = Math.hypot(ts[0][0] - ts[1][0], ts[0][1] - ts[1][1]);
          this.view.scale = Math.min(60, Math.max(0.01, t0.scale * (d1 / d0)));
        }
        this.render();
      }, { passive: false });
      cv.addEventListener('touchend', (e) => {
        if (t0 && !t0.moved && t0.ts.length === 1) {
          const [c, r] = this.toCell(...t0.ts[0]);
          this.app.onClick(c, r, { x: t0.ts[0][0], y: t0.ts[0][1] });
        }
        if (!e.touches.length) t0 = null;
      });
    }
  }

  UI.Map2D = Map2D;
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
