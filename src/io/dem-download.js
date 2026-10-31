/*
 * MtnAI io — DEM download (the only network feature, used on explicit request)
 * and GeoTIFF writing so downloaded / derived rasters can be kept for offline use.
 *
 * Sources:
 *   - AWS Terrain Tiles (Terrarium PNG, public, CORS-enabled, global; SRTM / GMTED /
 *     NED / ETOPO blend) — no key required.
 *   - OpenTopography Global DEM API (COP30, SRTMGL1, NASADEM, AW3D30, ...) — free API key.
 * Fetching and PNG decoding are injected so the mosaic logic is testable offline.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function demDownload(M) {
  'use strict';

  const R = 6378137, WORLD = 2 * Math.PI * R;

  M.DEM_SOURCES = {
    terrarium: {
      name: 'AWS Terrain Tiles (Terrarium) — global, no key',
      url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
      zooms: [[10, '≈ 120 m'], [11, '≈ 60 m'], [12, '≈ 30 m'], [13, '≈ 15 m (resampled)']],
    },
    opentopo: {
      name: 'OpenTopography Global DEM API — API key required',
      url: 'https://portal.opentopography.org/API/globaldem?demtype={dem}&south={s}&north={n}&west={w}&east={e}&outputFormat=GTiff&API_Key={key}',
      dems: [['COP30', 'Copernicus GLO-30 (30 m)'], ['SRTMGL1', 'SRTM GL1 (30 m)'], ['NASADEM', 'NASADEM (30 m)'], ['AW3D30', 'ALOS World 3D (30 m)'], ['SRTMGL3', 'SRTM GL3 (90 m)'], ['COP90', 'Copernicus GLO-90 (90 m)']],
    },
  };

  /** Fractional slippy-map tile coordinates of a lon/lat at zoom z. */
  M.tileXY = (lon, lat, z) => {
    const n = Math.pow(2, z), phi = M.rad(Math.max(-85.0511, Math.min(85.0511, lat)));
    return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n };
  };
  /** Tile range covering a bbox {west, south, east, north}. */
  M.tileRange = (bbox, z) => {
    const a = M.tileXY(bbox.west, bbox.north, z), b = M.tileXY(bbox.east, bbox.south, z);
    const x0 = Math.floor(a.x), x1 = Math.floor(b.x - 1e-9), y0 = Math.floor(a.y), y1 = Math.floor(b.y - 1e-9);
    return { z, x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
  };
  /** Terrarium RGBA -> elevation (m): (R * 256 + G + B / 256) - 32768. */
  M.terrariumDecode = (rgba, out) => {
    const n = rgba.length / 4;
    out = out || new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
    return out;
  };

  /**
   * Mosaic Terrarium tiles covering bbox into one EPSG:3857 source raster (cropped to
   * the bbox plus a 2-pixel margin). getTile(z, x, y) -> Promise<RGBA Uint8 array (256*256*4)>.
   */
  M.mosaicTerrarium = async (bbox, z, getTile, progress, maxTiles = 144) => {
    const tr = M.tileRange(bbox, z);
    if (tr.count > maxTiles) throw new Error(`Area needs ${tr.count} tiles at zoom ${z} (limit ${maxTiles}) — reduce the area or the zoom level.`);
    const T = 256, nx = tr.x1 - tr.x0 + 1, ny = tr.y1 - tr.y0 + 1;
    const W = nx * T, H = ny * T;
    const full = new Float32Array(W * H).fill(NaN);
    let done = 0;
    const jobs = [];
    for (let ty = tr.y0; ty <= tr.y1; ty++) for (let tx = tr.x0; tx <= tr.x1; tx++) jobs.push([tx, ty]);
    const worker = async () => {
      while (jobs.length) {
        const [tx, ty] = jobs.shift();
        const rgba = await getTile(z, tx, ty);
        const el = M.terrariumDecode(rgba);
        const ox = (tx - tr.x0) * T, oy = (ty - tr.y0) * T;
        for (let r = 0; r < T; r++) full.set(el.subarray(r * T, (r + 1) * T), (oy + r) * W + ox);
        done++;
        if (progress) progress(done / tr.count, `Downloaded tile ${done} / ${tr.count}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker));
    // crop to the bbox
    const res = WORLD / (T * Math.pow(2, z));
    const a = M.tileXY(bbox.west, bbox.north, z), b = M.tileXY(bbox.east, bbox.south, z);
    const c0 = Math.max(0, Math.floor((a.x - tr.x0) * T) - 2), c1 = Math.min(W - 1, Math.ceil((b.x - tr.x0) * T) + 2);
    const r0 = Math.max(0, Math.floor((a.y - tr.y0) * T) - 2), r1 = Math.min(H - 1, Math.ceil((b.y - tr.y0) * T) + 2);
    const w = c1 - c0 + 1, h = r1 - r0 + 1;
    const data = new Float32Array(w * h);
    for (let r = 0; r < h; r++) data.set(full.subarray((r0 + r) * W + c0, (r0 + r) * W + c0 + w), r * w);
    const X0 = -WORLD / 2 + (tr.x0 * T + c0 + 0.5) * res, Y0 = WORLD / 2 - (tr.y0 * T + r0 + 0.5) * res;
    return { w, h, data, nodata: null, crs: { type: 'merc' }, x0: X0, y0: Y0, dx: res, dy: -res, name: `Terrain Tiles z${z} (${bbox.south.toFixed(3)}°, ${bbox.west.toFixed(3)}°)` };
  };

  /**
   * Download a DEM for bbox. o: {source: 'terrarium'|'opentopo', bbox, zoom, dem, apiKey}
   * deps: {fetch, decodePNG(blob) -> RGBA}. Returns [source raster].
   */
  M.downloadDEM = async (o, deps, progress) => {
    const f = deps.fetch || globalThis.fetch;
    const b = o.bbox;
    if (!(b.east > b.west && b.north > b.south)) throw new Error('Invalid download extent.');
    if (o.source === 'opentopo') {
      if (!o.apiKey) throw new Error('OpenTopography requires a free API key (opentopography.org → MyOpenTopo).');
      const url = M.DEM_SOURCES.opentopo.url.replace('{dem}', o.dem || 'COP30').replace('{s}', b.south).replace('{n}', b.north)
        .replace('{w}', b.west).replace('{e}', b.east).replace('{key}', encodeURIComponent(o.apiKey));
      progress && progress(0.1, 'Requesting DEM from OpenTopography…');
      const resp = await f(url);
      if (!resp.ok) throw new Error(`OpenTopography returned HTTP ${resp.status}${resp.status === 401 ? ' (invalid API key)' : ''}.`);
      const buf = await resp.arrayBuffer();
      progress && progress(0.8, 'Decoding GeoTIFF');
      return [await M.readGeoTIFF(buf, `${o.dem || 'COP30'} (OpenTopography)`)];
    }
    const tpl = M.DEM_SOURCES.terrarium.url;
    const getTile = async (z, x, y) => {
      const resp = await f(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      if (!resp.ok) throw new Error(`Tile ${z}/${x}/${y}: HTTP ${resp.status}`);
      return deps.decodePNG(await resp.blob());
    };
    return [await M.mosaicTerrarium(b, o.zoom || 12, getTile, progress, o.maxTiles || 144)];
  };

  // ------------------------------------------------------------------ GeoTIFF writer
  /**
   * Write a single-band Float32 GeoTIFF (uncompressed, little-endian, strips).
   * raster: {w, h, data, x0, y0 (centre of pixel 0,0), dx, dy (<0 north-up), crs: {type, zone, north}, nodata?}
   */
  M.writeGeoTIFF = (ras) => {
    const { w, h } = ras;
    const rowsPerStrip = Math.max(1, Math.floor(65536 / (w * 4)));
    const nStrips = Math.ceil(h / rowsPerStrip);
    let keys;
    const t = ras.crs.type;
    if (t === 'geo') keys = [1, 1, 0, 4, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326, 2054, 0, 1, 9102];
    else {
      const code = t === 'merc' ? 3857 : (ras.crs.north === false ? 32700 : 32600) + ras.crs.zone;
      keys = [1, 1, 0, 4, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, code, 3076, 0, 1, 9001];
    }
    const entries = [];
    const add = (tag, type, values) => entries.push({ tag, type, values: Array.isArray(values) ? values : [values] });
    add(256, 4, w); add(257, 4, h); add(258, 3, 32); add(259, 3, 1); add(262, 3, 1);
    add(273, 4, new Array(nStrips).fill(0)); add(277, 3, 1); add(278, 4, rowsPerStrip);
    add(279, 4, Array.from({ length: nStrips }, (_, k) => Math.min(rowsPerStrip, h - k * rowsPerStrip) * w * 4));
    add(284, 3, 1); add(339, 3, 3);
    add(33550, 12, [ras.dx, -ras.dy, 0]);
    add(33922, 12, [0, 0, 0, ras.x0 - ras.dx / 2, ras.y0 - ras.dy / 2, 0]);
    add(34735, 3, keys);
    if (ras.nodata !== undefined && ras.nodata !== null) add(42113, 2, [String(ras.nodata)]);
    entries.sort((a, b) => a.tag - b.tag);
    const SZ = { 2: 1, 3: 2, 4: 4, 12: 8 };
    const ifdOff = 8, ifdLen = 2 + entries.length * 12 + 4;
    let extra = ifdOff + ifdLen;
    for (const e of entries) {
      const bytes = e.type === 2 ? e.values[0].length + 1 : SZ[e.type] * e.values.length;
      e.count = e.type === 2 ? bytes : e.values.length;
      if (bytes > 4) { e.offset = extra; extra += bytes + (bytes & 1); }
    }
    const dataOff = Math.ceil(extra / 4) * 4; // Float32 view needs 4-byte alignment
    const total = dataOff + w * h * 4;
    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
    entries.find((e) => e.tag === 273).values = Array.from({ length: nStrips }, (_, k) => dataOff + k * rowsPerStrip * w * 4);
    const writeVals = (e, at) => {
      if (e.type === 2) { const s = e.values[0]; for (let i = 0; i < s.length; i++) dv.setUint8(at + i, s.charCodeAt(i)); return; }
      e.values.forEach((v, i) => {
        if (e.type === 3) dv.setUint16(at + i * 2, v, true);
        else if (e.type === 4) dv.setUint32(at + i * 4, v, true);
        else dv.setFloat64(at + i * 8, v, true);
      });
    };
    dv.setUint16(ifdOff, entries.length, true);
    entries.forEach((e, k) => {
      const p = ifdOff + 2 + k * 12;
      dv.setUint16(p, e.tag, true); dv.setUint16(p + 2, e.type, true); dv.setUint32(p + 4, e.count, true);
      if (e.offset !== undefined) { dv.setUint32(p + 8, e.offset, true); writeVals(e, e.offset); } else writeVals(e, p + 8);
    });
    dv.setUint32(ifdOff + 2 + entries.length * 12, 0, true);
    new Float32Array(buf, dataOff, w * h).set(ras.data instanceof Float32Array ? ras.data : Float32Array.from(ras.data));
    return buf;
  };

  /** Analysis grid (or a raster layer on it) as a GeoTIFF-writable raster in its UTM zone. */
  M.gridRaster = (g, arr) => ({
    w: g.w, h: g.h, data: arr, x0: g.x0 + g.cs / 2, y0: g.y0 - g.cs / 2, dx: g.cs, dy: -g.cs, crs: { type: 'utm', zone: g.zone, north: g.north },
  });
});
