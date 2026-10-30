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
      ctx.fillStyle = '#0f111a';
      ctx.fillRect(0, 0, this.W, this.H);
      if (!g || !S.baseCanvas) return;
      const P = { xy: (c, r) => this.toScreen(c, r), ppc: this.view.scale, lw: 1, cs: g.cs };
      // raster base + overlays (pre-composited)
      const [x0, y0] = this.toScreen(-0.5, -0.5);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(S.baseCanvas, x0, y0, g.w * this.view.scale, g.h * this.view.scale);
      // frame
      ctx.strokeStyle = 'rgba(46,230,214,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, g.w * this.view.scale, g.h * this.view.scale);
      const [c0, r0] = this.toCell(0, 0), [c1, r1] = this.toCell(this.W, this.H);
      if (S.show.grid) UI.drawGridLines(ctx, g, P, [c0, r0, c1, r1], true);
      UI.drawFeatures(ctx, S, P);
      UI.drawDraft(ctx, S, P);
      if (S.show.symbols) {
        UI.drawSymbols(ctx, UI.symbolItems(S), (c, r) => { const [x, y] = this.toScreen(c, r); return { x, y }; },
          { size: S.symbolSize, labels: S.show.labels });
      }
      this._hud(ctx, g);
    }

    _hud(ctx, g) {
      // scale bar
      const mPerPx = g.cs / this.view.scale;
      const target = mPerPx * 140;
      const nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
      let len = nice[0];
      for (const n of nice) if (n <= target) len = n;
      const px = len / mPerPx;
      const x = 16, y = this.H - 18;
      ctx.save();
      ctx.fillStyle = 'rgba(15,17,26,0.78)'; ctx.fillRect(x - 6, y - 22, px + 70, 30);
      ctx.fillStyle = '#fff'; ctx.fillRect(x, y - 4, px, 4);
      ctx.fillStyle = '#000'; ctx.fillRect(x + px / 2, y - 4, px / 2, 4);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x, y - 4, px, 4);
      UI.haloText(ctx, len >= 1000 ? `${len / 1000} km` : `${len} m`, x + px + 6, y - 2, { font: '11px "Segoe UI", Arial' });
      UI.haloText(ctx, `1:${Math.round((mPerPx / 0.000265) / 1000) * 1000}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','), x, y - 14, { font: '10px "Segoe UI", Arial', color: '#c8d2c8' });
      // north arrow (grid north)
      const nx = this.W - 30, ny = this.H - 40;
      ctx.translate(nx, ny);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(7, 8); ctx.lineTo(0, 3); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      UI.haloText(ctx, 'GN', 0, 18, { align: 'center', font: '700 10px "Segoe UI", Arial' });
      ctx.restore();
      // legend for the moving area hidden on the map edge is provided by #legend
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
