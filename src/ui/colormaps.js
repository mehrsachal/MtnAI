/*
 * MtnAI ui — raster colouring and legends.
 * Every function returns an ImageData-compatible RGBA Uint8ClampedArray (w*h*4).
 */
(function (UI) {
  'use strict';

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rampLUT = (stops, n = 256) => {
    const lut = new Uint8Array(n * 3);
    const cs = stops.map(([t, c]) => [t, hex(c)]);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      let k = 0;
      while (k < cs.length - 2 && t > cs[k + 1][0]) k++;
      const [t0, c0] = cs[k], [t1, c1] = cs[k + 1];
      const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
      for (let j = 0; j < 3; j++) lut[i * 3 + j] = Math.round(c0[j] + (c1[j] - c0[j]) * f);
    }
    return lut;
  };

  const PAL = {
    elevation: [[0, '#2f5d34'], [0.12, '#5f8d46'], [0.28, '#a9ad63'], [0.42, '#b08a58'], [0.58, '#8c6d55'], [0.74, '#9b958e'], [0.88, '#d5d3cf'], [1, '#ffffff']],
    tri: [[0, '#ffffcc'], [0.25, '#fed976'], [0.5, '#fd8d3c'], [0.75, '#e31a1c'], [1, '#800026']],
  };
  const LUT = { elevation: rampLUT(PAL.elevation), tri: rampLUT(PAL.tri) };

  UI.SLOPE_COLORS = ['#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#a50026'];
  UI.ASPECT_COLORS = ['#e8423f', '#f39a2e', '#f2e33a', '#7ccf4a', '#3cc7c2', '#3c8fe0', '#5a52d6', '#c64fc4', '#9a9a9a'];
  UI.LANDFORM_COLORS = ['#2c7fb8', '#7fcdbb', '#c7e9b4', '#fdd49e', '#fc8d59', '#b30000'];
  UI.MOB_COLORS = [[46, 160, 67, 0.32], [232, 170, 40, 0.55], [217, 58, 50, 0.62]];
  const SLOPE_RGB = UI.SLOPE_COLORS.map(hex), ASPECT_RGB = UI.ASPECT_COLORS.map(hex), LF_RGB = UI.LANDFORM_COLORS.map(hex);

  const shadeK = (hs, i, blend) => (blend && hs ? 0.42 + 0.58 * (hs[i] / 255) : 1);

  /** Base layer RGBA. L: {z, slope, aspect, landform, tri, hs}, stats: {elevMin, elevMax}. */
  UI.colorBase = (kind, L, stats, blend) => {
    const n = L.z.length;
    const out = new Uint8ClampedArray(n * 4);
    const hs = L.hs;
    if (kind === 'relief') {
      const zr = stats.elevMax - stats.elevMin || 1;
      for (let i = 0; i < n; i++) {
        const h = hs[i] / 255;
        const e = (L.z[i] - stats.elevMin) / zr;
        // soft warm/cool relief with a hint of altitude tint
        const v = 30 + 215 * h;
        out[i * 4] = v * (0.93 + 0.1 * e);
        out[i * 4 + 1] = v * (0.95 + 0.06 * e);
        out[i * 4 + 2] = v * (0.86 + 0.16 * e);
        out[i * 4 + 3] = 255;
      }
      return out;
    }
    let col;
    if (kind === 'elevation') {
      const zr = stats.elevMax - stats.elevMin || 1;
      col = (i) => { const k = Math.round(((L.z[i] - stats.elevMin) / zr) * 255) * 3; return [LUT.elevation[k], LUT.elevation[k + 1], LUT.elevation[k + 2]]; };
    } else if (kind === 'slope') {
      const cl = UI.M.SLOPE_CLASSES;
      col = (i) => { const s = L.slope[i]; let k = 0; while (k < cl.length - 2 && s >= cl[k + 1]) k++; return SLOPE_RGB[k]; };
    } else if (kind === 'aspect') {
      col = (i) => { const a = UI.M.aspectClass(L.aspect[i]); return ASPECT_RGB[a < 0 ? 8 : a]; };
    } else if (kind === 'landform') {
      col = (i) => LF_RGB[L.landform[i]];
    } else if (kind === 'tri') {
      const hi = UI.percentile(L.tri, 0.98) || 1;
      col = (i) => { const k = Math.round(Math.min(1, L.tri[i] / hi) * 255) * 3; return [LUT.tri[k], LUT.tri[k + 1], LUT.tri[k + 2]]; };
    }
    for (let i = 0; i < n; i++) {
      const c = col(i), k = shadeK(hs, i, blend);
      out[i * 4] = c[0] * k; out[i * 4 + 1] = c[1] * k; out[i * 4 + 2] = c[2] * k; out[i * 4 + 3] = 255;
    }
    return out;
  };

  UI.percentile = (arr, q) => {
    const step = Math.max(1, Math.floor(arr.length / 20000));
    const s = [];
    for (let i = 0; i < arr.length; i += step) s.push(arr[i]);
    s.sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  };

  /** Class raster -> RGBA from a palette of [r, g, b, a(0..1)]. */
  UI.colorClasses = (cls, palette) => {
    const out = new Uint8ClampedArray(cls.length * 4);
    for (let i = 0; i < cls.length; i++) {
      const p = palette[cls[i]];
      if (!p) continue;
      out[i * 4] = p[0]; out[i * 4 + 1] = p[1]; out[i * 4 + 2] = p[2]; out[i * 4 + 3] = p[3] * 255;
    }
    return out;
  };

  /** Mask (non-zero) -> single colour. */
  UI.colorMask = (mask, rgb, alpha) => {
    const out = new Uint8ClampedArray(mask.length * 4);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      out[i * 4] = rgb[0]; out[i * 4 + 1] = rgb[1]; out[i * 4 + 2] = rgb[2]; out[i * 4 + 3] = alpha * 255;
    }
    return out;
  };

  /** Count raster (e.g. number of posts seeing a cell) -> graded colour. */
  UI.colorCount = (count, rgbs) => {
    const out = new Uint8ClampedArray(count.length * 4);
    for (let i = 0; i < count.length; i++) {
      const k = Math.min(count[i], rgbs.length) - 1;
      if (k < 0) continue;
      const c = rgbs[k];
      out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = c[3] * 255;
    }
    return out;
  };

  /** Continuous 0..1 field -> colour with alpha proportional to value. */
  UI.colorDensity = (d, rgb, maxAlpha) => {
    const out = new Uint8ClampedArray(d.length * 4);
    for (let i = 0; i < d.length; i++) {
      if (d[i] <= 0) continue;
      out[i * 4] = rgb[0]; out[i * 4 + 1] = rgb[1]; out[i * 4 + 2] = rgb[2]; out[i * 4 + 3] = Math.min(1, d[i]) * maxAlpha * 255;
    }
    return out;
  };

  // ---------------------------------------------------------------- legends (HTML)
  const ramp = (stops) => `linear-gradient(90deg, ${stops.map(([t, c]) => `${c} ${Math.round(t * 100)}%`).join(', ')})`;
  const sw = (items) => `<div class="sw">${items.map(([c, t]) => `<i style="background:${c}"></i><span>${t}</span>`).join('')}</div>`;
  const rgba = (p) => `rgba(${p[0]},${p[1]},${p[2]},${Math.min(1, p[3] + 0.25)})`;

  UI.legendHTML = (kind, info = {}) => {
    switch (kind) {
      case 'relief': return `<h4>Shaded relief</h4><div class="ramp" style="background:linear-gradient(90deg,#1e1e1e,#f5f2ea)"></div><div class="ends"><span>shadow</span><span>lit</span></div>`;
      case 'elevation': return `<h4>Elevation (m)</h4><div class="ramp" style="background:${ramp(PAL.elevation)}"></div><div class="ends"><span>${Math.round(info.min)}</span><span>${Math.round(info.max)}</span></div>`;
      case 'slope': {
        const cl = UI.M.SLOPE_CLASSES;
        return `<h4>Slope (deg)</h4>` + sw(UI.SLOPE_COLORS.map((c, k) => [c, k === cl.length - 2 ? `> ${cl[k]}°` : `${cl[k]}–${cl[k + 1]}°`]));
      }
      case 'aspect': return `<h4>Aspect (downslope facing)</h4>` + sw(UI.ASPECT_COLORS.map((c, k) => [c, k < 8 ? UI.M.ASPECT_NAMES[k] : 'Flat']));
      case 'landform': return `<h4>Landforms (TPI)</h4>` + sw(UI.LANDFORM_COLORS.map((c, k) => [c, UI.M.LANDFORMS[k].name]));
      case 'tri': return `<h4>Ruggedness (TRI, m)</h4><div class="ramp" style="background:${ramp(PAL.tri)}"></div><div class="ends"><span>smooth</span><span>${Math.round(info.max || 0)}+</span></div>`;
      case 'mobility': return `<h4>Mobility — ${info.name || ''}</h4>` + sw([[rgba(UI.MOB_COLORS[0]), `GO ≤ ${info.go}°`], [rgba(UI.MOB_COLORS[1]), `SLOW-GO ≤ ${info.slow}°`], [rgba(UI.MOB_COLORS[2]), 'NO-GO']]);
      case 'viewshed': return `<h4>Viewshed</h4>` + sw([['rgba(255,226,70,.75)', 'Visible from observer']]);
      case 'cover': return `<h4>Observation coverage</h4>` + sw([['rgba(150,230,140,.7)', 'seen by 1 post'], ['rgba(60,190,90,.75)', '2 posts'], ['rgba(20,130,60,.8)', '3+ posts']]);
      case 'dead': return `<h4>Dead ground</h4>` + sw([['rgba(220,60,220,.75)', 'In range, unobserved movement ground']]);
      case 'wcover': return `<h4>Fields of fire</h4>` + sw([['rgba(255,150,40,.7)', 'Covered by suggested weapons']]);
      case 'hostile': return `<h4>Enemy observation</h4>` + sw([['rgba(255,70,70,.7)', 'Seen from likely enemy OPs'], ['transparent', 'clear = defilade from enemy view']]);
      case 'avenues': return `<h4>Enemy avenues of approach</h4>` + sw([['rgba(255,60,40,.75)', 'Least-time approach corridors']]);
      default: return '';
    }
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
