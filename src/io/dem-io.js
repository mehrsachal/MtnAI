/*
 * MtnAI io — offline DEM import.
 *   SRTM .hgt (1" / 3", mosaics of several tiles), GeoTIFF (uncompressed, LZW,
 *   Deflate, PackBits; predictors 1/2/3; strips or tiles; EPSG:4326, WGS84/UTM,
 *   EPSG:3857), ESRI ASCII grid (.asc) and .zip archives containing those.
 * All sources are resampled (bilinear) into one square-cell UTM analysis grid.
 *
 * A source raster is:
 *   { w, h, data, nodata, crs: {type:'geo'|'utm'|'merc', zone, north}, x0, y0, dx, dy, name }
 * where (x0, y0) is the centre of pixel (0, 0) and dy < 0 for north-up rasters.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function demio(M) {
  'use strict';

  // ------------------------------------------------------------------ helpers
  const inflate = async (bytes, format = 'deflate') => {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress Deflate data (DecompressionStream missing).');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };

  /** TIFF-flavoured LZW (MSB-first codes, early change). */
  M.lzwDecode = (input, expected) => {
    const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), len = new Uint16Array(4096);
    for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; len[i] = 1; }
    let out = new Uint8Array(expected || input.length * 3);
    let op = 0;
    const ensure = (n) => {
      if (op + n <= out.length) return;
      const o2 = new Uint8Array(Math.max(out.length * 2, op + n)); o2.set(out); out = o2;
    };
    const emit = (code) => {
      const L = len[code];
      ensure(L);
      let p = op + L - 1, c = code;
      while (c >= 0) { out[p--] = suffix[c]; c = prefix[c]; }
      op += L;
    };
    const first = (code) => { let c = code; while (prefix[c] >= 0) c = prefix[c]; return suffix[c]; };
    let bitPos = 0, width = 9, next = 258, old = -1;
    const totalBits = input.length * 8;
    while (bitPos + width <= totalBits) {
      // read `width` bits MSB-first
      let code = 0;
      for (let k = 0; k < width; k++) {
        const b = bitPos + k;
        code = (code << 1) | ((input[b >> 3] >> (7 - (b & 7))) & 1);
      }
      bitPos += width;
      if (code === 257) break;
      if (code === 256) { width = 9; next = 258; old = -1; continue; }
      if (old < 0) { emit(code); old = code; continue; }
      if (code < next) {
        emit(code);
        if (next < 4096) { prefix[next] = old; suffix[next] = first(code); len[next] = len[old] + 1; next++; }
      } else {
        const fc = first(old);
        if (next < 4096) { prefix[next] = old; suffix[next] = fc; len[next] = len[old] + 1; next++; }
        emit(next - 1);
      }
      old = code;
      if (next + 1 >= 1 << width && width < 12) width++;
    }
    return out.subarray(0, op);
  };

  M.packBitsDecode = (input, expected) => {
    const out = new Uint8Array(expected);
    let ip = 0, op = 0;
    while (ip < input.length && op < expected) {
      const n = (input[ip++] << 24) >> 24;
      if (n >= 0) { for (let k = 0; k <= n; k++) out[op++] = input[ip++]; }
      else if (n !== -128) { const v = input[ip++]; for (let k = 0; k < 1 - n; k++) out[op++] = v; }
    }
    return out;
  };

  // ------------------------------------------------------------------ GeoTIFF
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

  M.readGeoTIFF = async (buffer, name = 'GeoTIFF') => {
    const dv = new DataView(buffer);
    const bo = dv.getUint16(0);
    const le = bo === 0x4949;
    if (!le && bo !== 0x4d4d) throw new Error(`${name}: not a TIFF file.`);
    const magic = dv.getUint16(2, le);
    if (magic === 43) throw new Error(`${name}: BigTIFF is not supported — convert with gdal_translate -co BIGTIFF=NO.`);
    if (magic !== 42) throw new Error(`${name}: not a TIFF file.`);
    const ifd = dv.getUint32(4, le);
    const n = dv.getUint16(ifd, le);
    const tags = {};
    const readVal = (type, off) => {
      switch (type) {
        case 1: case 2: case 7: return dv.getUint8(off);
        case 6: return dv.getInt8(off);
        case 3: return dv.getUint16(off, le);
        case 8: return dv.getInt16(off, le);
        case 4: return dv.getUint32(off, le);
        case 9: return dv.getInt32(off, le);
        case 5: return dv.getUint32(off, le) / dv.getUint32(off + 4, le);
        case 10: return dv.getInt32(off, le) / dv.getInt32(off + 4, le);
        case 11: return dv.getFloat32(off, le);
        case 12: return dv.getFloat64(off, le);
        default: return 0;
      }
    };
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), count = dv.getUint32(e + 4, le);
      const size = (TYPE_SIZE[type] || 1) * count;
      const off = size <= 4 ? e + 8 : dv.getUint32(e + 8, le);
      if (type === 2) {
        let s = '';
        for (let q = 0; q < count; q++) { const ch = dv.getUint8(off + q); if (ch) s += String.fromCharCode(ch); }
        tags[tag] = s;
      } else {
        const vals = new Array(count);
        for (let q = 0; q < count; q++) vals[q] = readVal(type, off + q * (TYPE_SIZE[type] || 1));
        tags[tag] = vals;
      }
    }
    const w = tags[256][0], h = tags[257][0];
    const bps = (tags[258] || [8])[0];
    const comp = (tags[259] || [1])[0];
    const spp = (tags[277] || [1])[0];
    const planar = (tags[284] || [1])[0];
    const pred = (tags[317] || [1])[0];
    const fmt = (tags[339] || [1])[0];
    const B = bps / 8;
    if (![1, 2, 4, 8].includes(B)) throw new Error(`${name}: unsupported bits per sample (${bps}).`);
    const tiled = !!tags[322];
    const tw = tiled ? tags[322][0] : w, th = tiled ? tags[323][0] : (tags[278] || [h])[0];
    const offsets = tiled ? tags[324] : tags[273], counts = tiled ? tags[325] : tags[279];
    const tilesAcross = Math.ceil(w / tw);
    const chunkSpp = planar === 2 ? 1 : spp;
    const out = new Float32Array(w * h);
    const readSample = (view, off) => {
      if (fmt === 3) return B === 4 ? view.getFloat32(off, le) : view.getFloat64(off, le);
      if (fmt === 2) return B === 1 ? view.getInt8(off) : B === 2 ? view.getInt16(off, le) : view.getInt32(off, le);
      return B === 1 ? view.getUint8(off) : B === 2 ? view.getUint16(off, le) : view.getUint32(off, le);
    };
    // planar=2 stores band 1 first: only the first tiles/strips are needed
    const nChunks = planar === 2 ? Math.ceil(offsets.length / spp) : offsets.length;
    for (let k = 0; k < nChunks; k++) {
      let bytes = new Uint8Array(buffer, offsets[k], counts[k]);
      const rowsInChunk = tiled ? th : Math.min(th, h - k * th);
      const rowBytes = tw * chunkSpp * B;
      const expected = rowBytes * rowsInChunk;
      if (comp === 5) bytes = M.lzwDecode(bytes, expected);
      else if (comp === 8 || comp === 32946) bytes = await inflate(bytes);
      else if (comp === 32773) bytes = M.packBitsDecode(bytes, expected);
      else if (comp !== 1) throw new Error(`${name}: compression ${comp} not supported (use none/LZW/Deflate).`);
      else bytes = bytes.slice();
      if (pred === 2) {
        // horizontal differencing on whole samples, in file byte order
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let r = 0; r < rowsInChunk; r++) {
          for (let q = chunkSpp; q < tw * chunkSpp; q++) {
            const o = r * rowBytes + q * B, p = o - chunkSpp * B;
            if (B === 1) bytes[o] = (bytes[o] + bytes[p]) & 0xff;
            else if (B === 2) v.setUint16(o, (v.getUint16(o, le) + v.getUint16(p, le)) & 0xffff, le);
            else v.setUint32(o, (v.getUint32(o, le) + v.getUint32(p, le)) >>> 0, le);
          }
        }
      } else if (pred === 3) {
        // floating-point predictor: byte-wise differencing then de-interleave byte planes (big-endian order)
        const fixed = new Uint8Array(bytes.length);
        for (let r = 0; r < rowsInChunk; r++) {
          const row = bytes.subarray(r * rowBytes, (r + 1) * rowBytes);
          for (let q = chunkSpp; q < rowBytes; q++) row[q] = (row[q] + row[q - chunkSpp]) & 0xff;
          const nS = tw * chunkSpp;
          for (let s = 0; s < nS; s++)
            for (let b = 0; b < B; b++) fixed[r * rowBytes + s * B + (le ? B - 1 - b : b)] = row[b * nS + s];
        }
        bytes = fixed;
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const c0 = tiled ? (k % tilesAcross) * tw : 0;
      const r0 = tiled ? Math.floor(k / tilesAcross) * th : k * th;
      for (let r = 0; r < rowsInChunk; r++) {
        const rr = r0 + r;
        if (rr >= h) break;
        for (let c = 0; c < tw; c++) {
          const cc = c0 + c;
          if (cc >= w) break;
          out[rr * w + cc] = readSample(view, (r * tw + c) * chunkSpp * B);
        }
      }
    }
    // ---- georeferencing
    const nodataTag = tags[42113];
    const nodata = nodataTag !== undefined && nodataTag !== '' ? parseFloat(nodataTag) : null;
    const keys = {};
    const gk = tags[34735];
    if (gk) {
      for (let k = 0; k < gk[3]; k++) {
        const id = gk[4 + k * 4], loc = gk[5 + k * 4], cnt = gk[6 + k * 4], val = gk[7 + k * 4];
        keys[id] = loc === 0 ? val : loc === 34736 ? (tags[34736] || [])[val] : loc === 34737 ? String(tags[34737] || '').substr(val, cnt) : val;
      }
    }
    let x0, y0, dx, dy;
    if (tags[33550] && tags[33922]) {
      const [sx, sy] = tags[33550];
      const tp = tags[33922];
      const isPoint = keys[1025] === 2;
      const X = tp[3] - tp[0] * sx, Y = tp[4] + tp[1] * sy;
      dx = sx; dy = -sy;
      x0 = isPoint ? X : X + sx / 2;
      y0 = isPoint ? Y : Y - sy / 2;
    } else if (tags[34264]) {
      const t = tags[34264];
      if (Math.abs(t[1]) > 1e-12 || Math.abs(t[4]) > 1e-12) throw new Error(`${name}: rotated rasters are not supported.`);
      dx = t[0]; dy = t[5];
      x0 = t[3] + dx / 2; y0 = t[7] + dy / 2;
    } else throw new Error(`${name}: no georeferencing (not a GeoTIFF).`);
    let crs;
    const pcs = keys[3072];
    if (pcs >= 32601 && pcs <= 32660) crs = { type: 'utm', zone: pcs - 32600, north: true };
    else if (pcs >= 32701 && pcs <= 32760) crs = { type: 'utm', zone: pcs - 32700, north: false };
    else if (pcs === 3857 || pcs === 900913) crs = { type: 'merc' };
    else if (pcs && pcs !== 32767) throw new Error(`${name}: projection EPSG:${pcs} is not supported — reproject to EPSG:4326 or WGS 84 / UTM (gdalwarp -t_srs EPSG:4326).`);
    else if (keys[1024] === 2 || keys[2048] || (Math.abs(x0) <= 360 && Math.abs(dx) < 1)) crs = { type: 'geo' };
    else throw new Error(`${name}: unknown coordinate system — reproject to EPSG:4326 or WGS 84 / UTM.`);
    return { w, h, data: out, nodata, crs, x0, y0, dx, dy, name };
  };

  // ------------------------------------------------------------------ SRTM HGT
  M.readHGT = (buffer, name) => {
    const m = /([NS])(\d{1,2})([EW])(\d{1,3})/i.exec(name || '');
    if (!m) throw new Error(`${name}: SRTM file name must contain the tile origin, e.g. N35E074.hgt`);
    const lat0 = (m[1].toUpperCase() === 'S' ? -1 : 1) * +m[2];
    const lon0 = (m[3].toUpperCase() === 'W' ? -1 : 1) * +m[4];
    const n = Math.round(Math.sqrt(buffer.byteLength / 2));
    if (n * n * 2 !== buffer.byteLength) throw new Error(`${name}: unexpected HGT size.`);
    const dv = new DataView(buffer);
    const data = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) data[i] = dv.getInt16(i * 2, false);
    return { w: n, h: n, data, nodata: -32768, crs: { type: 'geo' }, x0: lon0, y0: lat0 + 1, dx: 1 / (n - 1), dy: -1 / (n - 1), name };
  };

  // ------------------------------------------------------------------ ESRI ASCII grid
  M.readASC = (text, name, utm) => {
    const lines = text.split(/\r?\n/);
    const hdr = {};
    let i = 0;
    for (; i < lines.length; i++) {
      const m = /^\s*([a-zA-Z_]+)\s+(-?[\d.eE+-]+)\s*$/.exec(lines[i]);
      if (!m) break;
      hdr[m[1].toLowerCase()] = parseFloat(m[2]);
    }
    const w = hdr.ncols, h = hdr.nrows, cs = hdr.cellsize;
    if (!w || !h || !cs) throw new Error(`${name}: invalid ASCII grid header.`);
    const data = new Float32Array(w * h);
    let k = 0;
    for (; i < lines.length && k < w * h; i++) {
      const parts = lines[i].trim().split(/\s+/);
      for (const p of parts) if (p !== '') data[k++] = parseFloat(p);
    }
    const xll = hdr.xllcorner ?? hdr.xllcenter - cs / 2;
    const yll = hdr.yllcorner ?? hdr.yllcenter - cs / 2;
    const geo = Math.abs(xll) <= 360 && cs < 0.5;
    let crs = { type: 'geo' };
    if (!geo) {
      if (!utm || !utm.zone) throw new Error(`${name}: projected ASCII grid — set the UTM zone in Data settings before loading.`);
      crs = { type: 'utm', zone: utm.zone, north: utm.north !== false };
    }
    return { w, h, data, nodata: hdr.nodata_value ?? null, crs, x0: xll + cs / 2, y0: yll + (h - 0.5) * cs, dx: cs, dy: -cs, name };
  };

  // ------------------------------------------------------------------ ZIP (stored / deflate)
  M.unzip = async (buffer) => {
    const dv = new DataView(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Invalid ZIP archive.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = [];
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(new Uint8Array(buffer, p + 46, nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      const lnlen = dv.getUint16(lho + 26, true), lxlen = dv.getUint16(lho + 28, true);
      const raw = new Uint8Array(buffer, lho + 30 + lnlen + lxlen, csize);
      let bytes;
      if (method === 0) bytes = raw.slice();
      else if (method === 8) bytes = await inflate(raw, 'deflate-raw');
      else continue;
      files.push({ name: name.split('/').pop(), buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    }
    return files;
  };

  /** Parse one file (by extension) into source rasters. */
  M.parseDEMFile = async (name, buffer, opts = {}) => {
    const ext = name.toLowerCase().split('.').pop();
    if (ext === 'zip') {
      const out = [];
      for (const f of await M.unzip(buffer)) {
        if (/\.(hgt|tif|tiff|asc)$/i.test(f.name)) out.push(...(await M.parseDEMFile(f.name, f.buffer, opts)));
      }
      if (!out.length) throw new Error(`${name}: archive contains no .hgt / .tif / .asc DEM.`);
      return out;
    }
    if (ext === 'hgt') return [M.readHGT(buffer, name)];
    if (ext === 'tif' || ext === 'tiff') return [await M.readGeoTIFF(buffer, name)];
    if (ext === 'asc' || ext === 'txt') return [M.readASC(new TextDecoder().decode(buffer), name, opts.ascUtm)];
    throw new Error(`${name}: unsupported file type (use .hgt, .tif, .asc or .zip).`);
  };

  // ------------------------------------------------------------------ resampling into the UTM analysis grid
  const RM = 6378137;
  const toSrc = (src, lat, lon, E, N, zone) => {
    switch (src.crs.type) {
      case 'geo': return [lon, lat];
      case 'merc': return [RM * M.rad(lon), RM * Math.log(Math.tan(Math.PI / 4 + M.rad(lat) / 2))];
      default:
        if (src.crs.zone === zone) return [E, N];
        { const u = M.toUTM(lat, lon, src.crs.zone); return [u.E, u.N]; }
    }
  };
  const srcToLatLon = (src, x, y) => {
    switch (src.crs.type) {
      case 'geo': return { lat: y, lon: x };
      case 'merc': return { lat: M.deg(2 * Math.atan(Math.exp(y / RM)) - Math.PI / 2), lon: M.deg(x / RM) };
      default: return M.fromUTM(x, y, src.crs.zone, src.crs.north);
    }
  };
  /** Native ground resolution (m) of a source. */
  M.sourceResolution = (src) => {
    if (src.crs.type === 'utm') return Math.abs(src.dx);
    const ll = srcToLatLon(src, src.x0 + (src.w / 2) * src.dx, src.y0 + (src.h / 2) * src.dy);
    if (src.crs.type === 'merc') return Math.abs(src.dx) * Math.cos(M.rad(ll.lat));
    return Math.abs(src.dy) * 111320;
  };
  const sampleSrc = (src, x, y, nearest) => {
    const c = (x - src.x0) / src.dx, r = (y - src.y0) / src.dy;
    if (c < -0.5 || r < -0.5 || c > src.w - 0.5 || r > src.h - 0.5) return NaN;
    if (nearest) {
      const v = src.data[Math.min(src.h - 1, Math.max(0, Math.round(r))) * src.w + Math.min(src.w - 1, Math.max(0, Math.round(c)))];
      return v !== v || (src.nodata !== null && v === src.nodata) || v < -1000 || v > 9000 ? NaN : v;
    }
    const cc = Math.min(Math.max(c, 0), src.w - 1), rr = Math.min(Math.max(r, 0), src.h - 1);
    const c0 = Math.floor(cc), r0 = Math.floor(rr);
    const c1 = Math.min(c0 + 1, src.w - 1), r1 = Math.min(r0 + 1, src.h - 1);
    const fc = cc - c0, fr = rr - r0;
    const d = src.data, w = src.w, nd = src.nodata;
    const v = [d[r0 * w + c0], d[r0 * w + c1], d[r1 * w + c0], d[r1 * w + c1]];
    const wt = [(1 - fc) * (1 - fr), fc * (1 - fr), (1 - fc) * fr, fc * fr];
    let s = 0, sw = 0;
    for (let k = 0; k < 4; k++) {
      const x0 = v[k];
      if (x0 !== x0 || (nd !== null && x0 === nd) || x0 < -1000 || x0 > 9000) continue;
      s += x0 * wt[k]; sw += wt[k];
    }
    return sw > 0.2 ? s / sw : NaN;
  };

  /** Geographic + UTM extent of a list of sources. */
  M.sourcesExtent = (sources, zone) => {
    let lat = 0, lon = 0, k = 0;
    const pts = [];
    for (const s of sources) {
      for (const [fc, fr] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
        const x = s.x0 + (fc * (s.w - 1)) * s.dx, y = s.y0 + (fr * (s.h - 1)) * s.dy;
        const ll = srcToLatLon(s, x, y);
        pts.push(ll); lat += ll.lat; lon += ll.lon; k++;
      }
    }
    lat /= k; lon /= k;
    const utmSrc = sources.find((s) => s.crs.type === 'utm');
    zone = zone || (utmSrc ? utmSrc.crs.zone : M.utmZoneFor(lat, lon));
    const north = utmSrc ? utmSrc.crs.north : lat >= 0;
    let E0 = Infinity, E1 = -Infinity, N0 = Infinity, N1 = -Infinity;
    for (const p of pts) {
      const u = M.toUTM(p.lat, p.lon, zone);
      E0 = Math.min(E0, u.E); E1 = Math.max(E1, u.E); N0 = Math.min(N0, u.N); N1 = Math.max(N1, u.N);
    }
    return { lat, lon, zone, north, E0, E1, N0, N1 };
  };

  /**
   * Build the analysis grid. opts: {maxCells (default 1024*1024), cs (force), aoi: {E0,E1,N0,N1}, zone,
   *   resample: 'bilinear' | 'nearest'}
   * Rows/cols that fall outside every source are trimmed.
   */
  M.buildGrid = (sources, opts = {}) => {
    const ext = M.sourcesExtent(sources, opts.zone);
    let { E0, E1, N0, N1 } = ext;
    if (opts.aoi) {
      E0 = Math.max(E0, opts.aoi.E0); E1 = Math.min(E1, opts.aoi.E1);
      N0 = Math.max(N0, opts.aoi.N0); N1 = Math.min(N1, opts.aoi.N1);
      if (E1 <= E0 || N1 <= N0) throw new Error('The selected area does not overlap the DEM.');
    }
    const native = Math.min(...sources.map(M.sourceResolution));
    const maxCells = opts.maxCells || 1024 * 1024;
    let cs = opts.cs || native;
    cs = Math.max(cs, Math.sqrt(((E1 - E0) * (N1 - N0)) / maxCells));
    cs = Math.ceil(cs * 2) / 2;
    const w = Math.max(8, Math.floor((E1 - E0) / cs)), h = Math.max(8, Math.floor((N1 - N0) / cs));
    const z = new Float32Array(w * h).fill(NaN);
    const g = M.makeGrid({ w, h, cs, x0: E0, y0: N1, zone: ext.zone, north: ext.north, z, name: sources.map((s) => s.name).join(' + '), source: 'import' });
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const p = M.cellToEN(g, r, c);
        const ll = M.fromUTM(p.E, p.N, g.zone, g.north);
        for (const s of sources) {
          const [x, y] = toSrc(s, ll.lat, ll.lon, p.E, p.N, g.zone);
          const v = sampleSrc(s, x, y, opts.resample === 'nearest');
          if (v === v) { z[r * w + c] = v; break; }
        }
      }
    }
    return M.trimGrid(g);
  };

  /** Drop border rows/columns that are entirely NaN (rotated UTM footprint). */
  M.trimGrid = (g) => {
    const { w, h, z } = g;
    const rowOk = (r) => { let n = 0; for (let c = 0; c < w; c++) if (z[r * w + c] === z[r * w + c]) n++; return n > w * 0.98; };
    const colOk = (c, r0, r1) => { let n = 0; for (let r = r0; r <= r1; r++) if (z[r * w + c] === z[r * w + c]) n++; return n > (r1 - r0 + 1) * 0.98; };
    let r0 = 0, r1 = h - 1;
    while (r0 < r1 && !rowOk(r0)) r0++;
    while (r1 > r0 && !rowOk(r1)) r1--;
    let c0 = 0, c1 = w - 1;
    while (c0 < c1 && !colOk(c0, r0, r1)) c0++;
    while (c1 > c0 && !colOk(c1, r0, r1)) c1--;
    if (r1 - r0 < 8 || c1 - c0 < 8) { r0 = 0; r1 = h - 1; c0 = 0; c1 = w - 1; }
    if (r0 === 0 && c0 === 0 && r1 === h - 1 && c1 === w - 1) return g;
    const W = c1 - c0 + 1, H = r1 - r0 + 1;
    const z2 = new Float32Array(W * H);
    for (let r = 0; r < H; r++) z2.set(z.subarray((r + r0) * w + c0, (r + r0) * w + c0 + W), r * W);
    return M.makeGrid(Object.assign({}, g, { w: W, h: H, x0: g.x0 + c0 * g.cs, y0: g.y0 - r0 * g.cs, z: z2 }));
  };
});
