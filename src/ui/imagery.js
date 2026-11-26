/*
 * MtnEye ui — hybrid basemap ground layer: satellite imagery or a clearly labelled
 * offline fallback.
 *
 * Imagery comes from public XYZ / WMTS tile services in Web Mercator (EPSG:3857). Each
 * 256 px tile is drawn into the analysis composite (WGS 84 / UTM, grid-north up) with
 * an affine transform fitted to three of its corners. Across one tile the Mercator ->
 * UTM mapping is affine to well under one composite pixel, so no per-pixel resampling
 * is needed. Tiles are requested with CORS (the composite is also uploaded to WebGL
 * and exported as PNG, which a tainted canvas would block).
 *
 * Imagery is never draped over the synthetic training area: real ground would not match
 * fictional terrain. The fallback there (and whenever tiles cannot be fetched) is a
 * terrain-derived colouring that is labelled "simulated" everywhere it appears.
 */
(function (UI) {
  'use strict';
  const M = UI.M;

  UI.IMAGERY_SOURCES = {
    esri: {
      name: 'Esri World Imagery',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Imagery © Esri — Source: Esri, Maxar, Earthstar Geographics and the GIS User Community',
      maxZoom: 18,
      terms: 'Esri basemap terms of use apply (check licensing for your use case).',
    },
    eox: {
      name: 'Sentinel-2 cloudless 2020 (EOX)',
      url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
      attribution: 'Sentinel-2 cloudless — s2maps.eu by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)',
      maxZoom: 15,
      terms: 'CC BY-NC-SA 4.0 — non-commercial use; verify licence before operational use.',
    },
    custom: {
      name: 'Custom tile server',
      url: '',
      attribution: 'Custom imagery tile server',
      maxZoom: 19,
      terms: 'Defined by the operator of the tile server.',
    },
  };

  const tileCache = new Map();

  /** Web Mercator ground resolution (m / px) at latitude and zoom. */
  const groundRes = (lat, z) => (156543.03392 * Math.cos(M.rad(lat))) / Math.pow(2, z);

  /** Latitude / longitude of a tile corner (x, y may be fractional). */
  const tileLL = (x, y, z) => {
    const n = Math.pow(2, z);
    const lon = (x / n) * 360 - 180;
    const lat = M.deg(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))));
    return { lat, lon };
  };

  /** Chooses a zoom level matching the composite resolution within a tile budget. */
  UI.imageryPlan = (g, k, maxTiles = 220, maxZoom = 18) => {
    const ll = [[0, 0], [0, g.w - 1], [g.h - 1, 0], [g.h - 1, g.w - 1]].map(([r, c]) => M.cellToLatLon(g, r, c));
    const bbox = { west: Math.min(...ll.map((p) => p.lon)), east: Math.max(...ll.map((p) => p.lon)), south: Math.min(...ll.map((p) => p.lat)), north: Math.max(...ll.map((p) => p.lat)) };
    const latC = (bbox.north + bbox.south) / 2;
    const target = g.cs / k; // metres per composite pixel
    let z = Math.min(maxZoom, Math.max(3, Math.ceil(Math.log2((156543.03392 * Math.cos(M.rad(latC))) / target))));
    let tr = M.tileRange(bbox, z);
    while (tr.count > maxTiles && z > 3) { z--; tr = M.tileRange(bbox, z); }
    return { z, bbox, range: tr, resM: groundRes(latC, z) };
  };

  const fetchTile = async (url, signal) => {
    if (tileCache.has(url)) return tileCache.get(url);
    const res = await fetch(url, { mode: 'cors', signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!/^image\//.test(blob.type) && blob.size < 200) throw new Error('not an image');
    const bmp = await createImageBitmap(blob);
    tileCache.set(url, bmp);
    if (tileCache.size > 900) tileCache.delete(tileCache.keys().next().value);
    return bmp;
  };

  /**
   * Draws imagery tiles into `canvas` (sized to the composite: grid * k px).
   * Returns {loaded, failed, z, resM, errors[]}. progress(p, msg).
   */
  UI.buildImagery = async (canvas, g, k, sourceId, opts = {}, progress) => {
    const src = Object.assign({}, UI.IMAGERY_SOURCES[sourceId] || UI.IMAGERY_SOURCES.esri);
    if (sourceId === 'custom') src.url = opts.customUrl || '';
    if (!src.url || !/\{z\}/.test(src.url) || !/\{x\}/.test(src.url) || !/\{y\}/.test(src.url)) throw new Error('No valid tile URL template ({z}, {x} and {y} are required).');
    const plan = UI.imageryPlan(g, k, opts.maxTiles || 220, src.maxZoom);
    const { z, range } = plan;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const toPx = (lat, lon) => {
      const u = M.toUTM(lat, lon, g.zone);
      const q = M.enToCell(g, u.E, u.N);
      return [(q.c + 0.5) * k, (q.r + 0.5) * k];
    };
    const jobs = [];
    for (let ty = range.y0; ty <= range.y1; ty++) for (let tx = range.x0; tx <= range.x1; tx++) jobs.push([tx, ty]);
    let loaded = 0, failed = 0, done = 0;
    const errors = [];
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ac && ac.abort(), opts.timeoutMs || 45000);
    const worker = async () => {
      while (jobs.length) {
        const [tx, ty] = jobs.shift();
        const url = src.url.replace('{z}', z).replace('{x}', tx).replace('{y}', ty).replace('{s}', 'a');
        try {
          const bmp = await fetchTile(url, ac && ac.signal);
          const nw = toPx(tileLL(tx, ty, z).lat, tileLL(tx, ty, z).lon);
          const ne = toPx(tileLL(tx + 1, ty, z).lat, tileLL(tx + 1, ty, z).lon);
          const sw = toPx(tileLL(tx, ty + 1, z).lat, tileLL(tx, ty + 1, z).lon);
          const W = bmp.width || 256, H = bmp.height || 256;
          ctx.setTransform((ne[0] - nw[0]) / W, (ne[1] - nw[1]) / W, (sw[0] - nw[0]) / H, (sw[1] - nw[1]) / H, nw[0], nw[1]);
          ctx.drawImage(bmp, -0.3, -0.3, W + 0.6, H + 0.6); // slight overlap hides seams
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          loaded++;
        } catch (e) {
          failed++;
          if (errors.length < 3) errors.push(String((e && e.message) || e));
          // abort early when nothing at all can be fetched (offline / blocked)
          if (!loaded && failed >= 4 && ac) ac.abort();
        }
        done++;
        if (progress) progress(done / range.count, `Imagery tile ${done} / ${range.count}`);
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker)); }
    finally { clearTimeout(timer); }
    return { loaded, failed, z, resM: plan.resM, tiles: range.count, errors, source: src };
  };

  /**
   * Offline / synthetic fallback: terrain-derived colouring (valley vegetation, scree,
   * rock and permanent snow by height and slope). NOT imagery — always labelled simulated.
   */
  UI.simulatedGround = (L, stats) => {
    const n = L.z.length;
    const out = new Uint8ClampedArray(n * 4);
    const zr = stats.elevMax - stats.elevMin || 1;
    const snowLine = stats.elevMin + zr * 0.82;
    const green = [86, 104, 60], olive = [118, 112, 78], scree = [142, 128, 104], rock = [112, 106, 100], snow = [236, 240, 244];
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let i = 0; i < n; i++) {
      const e = (L.z[i] - stats.elevMin) / zr, s = L.slope[i];
      let c = mix(green, olive, Math.min(1, e * 1.8));
      c = mix(c, scree, Math.min(1, Math.max(0, (e - 0.35) * 2.2)));
      c = mix(c, rock, Math.min(1, Math.max(0, (s - 28) / 14)));
      if (L.z[i] > snowLine && s < 42) c = mix(c, snow, Math.min(1, (L.z[i] - snowLine) / (zr * 0.06)));
      const h = 0.55 + 0.45 * (L.hs[i] / 255);
      out[i * 4] = c[0] * h; out[i * 4 + 1] = c[1] * h; out[i * 4 + 2] = c[2] * h; out[i * 4 + 3] = 255;
    }
    return out;
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
