/*
 * MtnAI ui — small canvas charts: terrain / route profile with line of sight,
 * histograms and the aspect rose.
 */
(function (UI) {
  'use strict';

  const setup = (cv, cssH) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || 300, H = cssH || cv.clientHeight || 150;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    if (cssH) cv.style.height = cssH + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
  };
  const niceStep = (span, n) => {
    const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  };

  /**
   * Elevation profile. data: {profile: [{d, z, los?}], blockIndex, markers: [{d, label}], gradeColors: bool, note}
   */
  UI.drawProfile = (cv, data) => {
    const { ctx, W, H } = setup(cv);
    const pr = data.profile;
    if (!pr || pr.length < 2) return;
    const padL = 52, padR = 16, padT = 14, padB = 26;
    const D = pr[pr.length - 1].d;
    let zMin = Infinity, zMax = -Infinity;
    for (const p of pr) { zMin = Math.min(zMin, p.z, p.los ?? Infinity); zMax = Math.max(zMax, p.z, p.los ?? -Infinity); }
    const span = zMax - zMin || 1;
    zMin -= span * 0.08; zMax += span * 0.12;
    const X = (d) => padL + (d / D) * (W - padL - padR);
    const Y = (z) => padT + (1 - (z - zMin) / (zMax - zMin)) * (H - padT - padB);
    // grid & axes
    ctx.font = '10.5px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#858da0'; ctx.strokeStyle = (getComputedStyle(document.body).getPropertyValue('--line') || '#333').trim(); ctx.lineWidth = 1;
    const zs = niceStep(zMax - zMin, 4);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let z = Math.ceil(zMin / zs) * zs; z <= zMax; z += zs) {
      ctx.beginPath(); ctx.moveTo(padL, Y(z)); ctx.lineTo(W - padR, Y(z)); ctx.stroke();
      ctx.fillText(`${Math.round(z)} m`, padL - 6, Y(z));
    }
    const ds = niceStep(D, 8);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let d = 0; d <= D + 1; d += ds) {
      ctx.beginPath(); ctx.moveTo(X(d), padT); ctx.lineTo(X(d), H - padB); ctx.stroke();
      ctx.fillText(D > 2000 ? `${(d / 1000).toFixed(ds < 1000 ? 1 : 0)} km` : `${Math.round(d)} m`, X(d), H - padB + 5);
    }
    // terrain
    const grd = ctx.createLinearGradient(0, padT, 0, H - padB);
    grd.addColorStop(0, 'rgba(176,138,88,0.85)'); grd.addColorStop(1, 'rgba(60,70,50,0.6)');
    ctx.beginPath();
    ctx.moveTo(X(0), H - padB);
    for (const p of pr) ctx.lineTo(X(p.d), Y(p.z));
    ctx.lineTo(X(D), H - padB); ctx.closePath();
    ctx.fillStyle = grd; ctx.fill();
    // surface line coloured by gradient
    ctx.lineWidth = 2.2;
    for (let k = 1; k < pr.length; k++) {
      const a = pr[k - 1], b = pr[k];
      let col = '#e8dcc0';
      if (data.gradeColors) {
        const g = Math.atan(Math.abs(b.z - a.z) / Math.max(1e-6, b.d - a.d)) * 57.3;
        const cl = UI.M.SLOPE_CLASSES;
        let i = 0; while (i < cl.length - 2 && g >= cl[i + 1]) i++;
        col = UI.SLOPE_COLORS[i];
      }
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(X(a.d), Y(a.z)); ctx.lineTo(X(b.d), Y(b.z)); ctx.stroke();
    }
    // line of sight
    if (pr[0].los !== undefined) {
      const bi = data.blockIndex;
      const end = pr[pr.length - 1];
      ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      if (bi < 0) {
        ctx.strokeStyle = '#3ddc66';
        ctx.beginPath(); ctx.moveTo(X(0), Y(pr[0].los)); ctx.lineTo(X(D), Y(end.los)); ctx.stroke();
      } else {
        const k = pr[bi];
        ctx.strokeStyle = '#3ddc66';
        ctx.beginPath(); ctx.moveTo(X(0), Y(pr[0].los)); ctx.lineTo(X(k.d), Y(k.los)); ctx.stroke();
        ctx.strokeStyle = '#ff4136';
        ctx.beginPath(); ctx.moveTo(X(k.d), Y(k.los)); ctx.lineTo(X(D), Y(end.los)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ff4136'; ctx.beginPath(); ctx.arc(X(k.d), Y(k.z), 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.setLineDash([]);
      for (const [d, z] of [[0, pr[0].los], [D, end.los]]) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(d), Y(z), 3.5, 0, Math.PI * 2); ctx.fill(); }
    }
    // markers (checkpoints etc.)
    ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
    ctx.font = '600 10px ui-monospace, Consolas, monospace'; ctx.fillStyle = '#8ff5ea'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const m of data.markers || []) {
      ctx.beginPath(); ctx.moveTo(X(m.d), padT); ctx.lineTo(X(m.d), H - padB); ctx.stroke();
      ctx.fillText(m.label, X(m.d), padT + 10);
    }
    ctx.setLineDash([]);
    if (data.note) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillStyle = (getComputedStyle(document.body).getPropertyValue('--text') || '#ddd').trim(); ctx.font = '11px "Segoe UI", Arial'; ctx.fillText(data.note, W - padR, 2); }
  };

  /** Vertical bar chart. bars: [{v (0..1), color, label}] */
  UI.drawBars = (cv, title, bars, h = 120) => {
    const { ctx, W, H } = setup(cv, h);
    ctx.font = '600 10px ui-monospace, Consolas, monospace'; ctx.fillStyle = '#858da0'; ctx.textBaseline = 'top';
    ctx.fillText(title.toUpperCase(), 6, 5);
    const top = 20, bottom = H - 16, n = bars.length;
    const max = Math.max(...bars.map((b) => b.v)) || 1;
    const bw = (W - 12) / n;
    bars.forEach((b, i) => {
      const hh = ((bottom - top) * b.v) / max;
      ctx.fillStyle = b.color;
      ctx.fillRect(6 + i * bw + 1, bottom - hh, bw - 2, hh);
      if (b.label && (n <= 10 || i % Math.ceil(n / 8) === 0)) {
        ctx.fillStyle = '#858da0'; ctx.font = '9.5px "Segoe UI", Arial'; ctx.textAlign = 'center';
        ctx.fillText(b.label, 6 + i * bw + bw / 2, bottom + 3);
      }
    });
  };

  /** Aspect rose: fractions[0..7] for N..NW, fractions[8] flat. */
  UI.drawRose = (cv, fr, h = 150) => {
    const { ctx, W, H } = setup(cv, h);
    ctx.font = '600 10px ui-monospace, Consolas, monospace'; ctx.fillStyle = '#858da0'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText('ASPECT ROSE', 6, 5);
    const cx = W / 2, cy = H / 2 + 8, R = Math.min(W, H) / 2 - 22;
    const max = Math.max(...fr.slice(0, 8)) || 1;
    ctx.strokeStyle = (getComputedStyle(document.body).getPropertyValue('--line') || '#333').trim();
    for (const k of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); ctx.stroke(); }
    for (let i = 0; i < 8; i++) {
      const a0 = ((i * 45 - 22.5 - 90) * Math.PI) / 180, a1 = ((i * 45 + 22.5 - 90) * Math.PI) / 180;
      const r = R * (fr[i] / max);
      ctx.fillStyle = UI.ASPECT_COLORS[i];
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath(); ctx.fill();
      const la = ((i * 45 - 90) * Math.PI) / 180;
      ctx.fillStyle = '#858da0'; ctx.font = '9.5px "Segoe UI", Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(UI.M.ASPECT_NAMES[i], cx + Math.cos(la) * (R + 11), cy + Math.sin(la) * (R + 11));
    }
    ctx.fillStyle = '#858da0'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(`flat ${(fr[8] * 100).toFixed(1)}%`, W - 6, H - 4);
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
