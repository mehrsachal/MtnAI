import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { loadCore } from './helpers/load-core.mjs';

const M = loadCore();

// ---------------------------------------------------------------- tiny TIFF writer
const T = { SHORT: 3, LONG: 4, DOUBLE: 12, ASCII: 2 };
function makeTiff({ w, h, bps, fmt, chunks, compression = 1, predictor = 1, tile, geo, nodata }) {
  const entries = [];
  const add = (tag, type, values) => entries.push({ tag, type, values: Array.isArray(values) ? values : [values] });
  add(256, T.LONG, w); add(257, T.LONG, h); add(258, T.SHORT, bps); add(259, T.SHORT, compression);
  add(262, T.SHORT, 1); add(277, T.SHORT, 1); add(284, T.SHORT, 1); add(317, T.SHORT, predictor); add(339, T.SHORT, fmt);
  if (geo) {
    add(33550, T.DOUBLE, geo.scale); add(33922, T.DOUBLE, geo.tie); add(34735, T.SHORT, geo.keys);
  }
  if (nodata !== undefined) add(42113, T.ASCII, String(nodata));
  // layout: header | chunk data | IFD | out-of-line values
  let off = 8;
  const offsets = chunks.map((c) => { const o = off; off += c.length; return o; });
  if (tile) { add(322, T.SHORT, tile); add(323, T.SHORT, tile); add(324, T.LONG, offsets); add(325, T.LONG, chunks.map((c) => c.length)); }
  else { add(273, T.LONG, offsets); add(278, T.LONG, h); add(279, T.LONG, chunks.map((c) => c.length)); }
  entries.sort((a, b) => a.tag - b.tag);
  const ifdOff = off;
  const size = { 2: 1, 3: 2, 4: 4, 12: 8 };
  let extra = ifdOff + 2 + entries.length * 12 + 4;
  const blobs = [];
  for (const e of entries) {
    const bytes = e.type === T.ASCII ? e.values[0].length + 1 : size[e.type] * e.values.length;
    e.count = e.type === T.ASCII ? bytes : e.values.length;
    if (bytes > 4) { e.offset = extra; blobs.push(e); extra += bytes + (bytes % 2); }
  }
  const buf = new ArrayBuffer(extra);
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
  chunks.forEach((c, k) => u8.set(c, offsets[k]));
  const writeVals = (e, at) => {
    if (e.type === T.ASCII) { for (let i = 0; i < e.values[0].length; i++) dv.setUint8(at + i, e.values[0].charCodeAt(i)); return; }
    e.values.forEach((v, i) => {
      if (e.type === T.SHORT) dv.setUint16(at + i * 2, v, true);
      else if (e.type === T.LONG) dv.setUint32(at + i * 4, v, true);
      else dv.setFloat64(at + i * 8, v, true);
    });
  };
  dv.setUint16(ifdOff, entries.length, true);
  entries.forEach((e, k) => {
    const p = ifdOff + 2 + k * 12;
    dv.setUint16(p, e.tag, true); dv.setUint16(p + 2, e.type, true); dv.setUint32(p + 4, e.count, true);
    if (e.offset !== undefined) { dv.setUint32(p + 8, e.offset, true); writeVals(e, e.offset); } else writeVals(e, p + 8);
  });
  return buf;
}

/** TIFF LZW encoder (MSB-first, early change) mirroring the decoder's dictionary. */
function lzwEncode(bytes) {
  const out = [];
  let acc = 0, nbits = 0, width = 9, decNext = 258, first = true;
  const write = (code) => {
    acc = (acc << width) | code; nbits += width;
    while (nbits >= 8) { out.push((acc >> (nbits - 8)) & 0xff); nbits -= 8; acc &= (1 << nbits) - 1; }
    if (!first) { decNext++; if (decNext + 1 >= 1 << width && width < 12) width++; }
    first = false;
  };
  write(256); first = true;
  const dict = new Map();
  let next = 258, cur = bytes[0];
  for (let i = 1; i < bytes.length; i++) {
    const k = bytes[i], key = cur * 256 + k;
    if (dict.has(key)) { cur = dict.get(key); continue; }
    write(cur);
    dict.set(key, next++);
    cur = k;
  }
  write(cur);
  // EOI (bypass dictionary bookkeeping)
  acc = (acc << width) | 257; nbits += width;
  while (nbits > 0) { out.push(nbits >= 8 ? (acc >> (nbits - 8)) & 0xff : (acc << (8 - nbits)) & 0xff); nbits -= 8; }
  return Uint8Array.from(out);
}

const geoKeys4326 = [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326];
const geoKeysUTM43 = [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 32643];

test('GeoTIFF: uncompressed float32, EPSG:4326, nodata', async () => {
  const w = 20, h = 10;
  const f = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) f[r * w + c] = r * 100 + c;
  f[5] = -9999;
  const buf = makeTiff({ w, h, bps: 32, fmt: 3, chunks: [new Uint8Array(f.buffer)], geo: { scale: [0.001, 0.001, 0], tie: [0, 0, 0, 74, 36, 0], keys: geoKeys4326 }, nodata: -9999 });
  const src = await M.readGeoTIFF(buf, 't.tif');
  assert.equal(src.crs.type, 'geo');
  assert.equal(src.w, 20); assert.equal(src.data[3 * 20 + 7], 307);
  assert.equal(src.nodata, -9999);
  assert.ok(Math.abs(src.x0 - 74.0005) < 1e-9 && Math.abs(src.y0 - 35.9995) < 1e-9);
});

test('GeoTIFF: Deflate + horizontal predictor, tiled int16, WGS84/UTM 43N', async () => {
  const w = 32, h = 32, ts = 16;
  const val = (r, c) => 2000 + r * 7 - c * 3;
  const chunks = [];
  for (let tr = 0; tr < 2; tr++) for (let tc = 0; tc < 2; tc++) {
    const t = new Int16Array(ts * ts);
    for (let r = 0; r < ts; r++) {
      for (let c = 0; c < ts; c++) t[r * ts + c] = val(tr * ts + r, tc * ts + c);
      for (let c = ts - 1; c > 0; c--) t[r * ts + c] -= t[r * ts + c - 1];
    }
    chunks.push(new Uint8Array(zlib.deflateSync(Buffer.from(t.buffer))));
  }
  const buf = makeTiff({ w, h, bps: 16, fmt: 2, chunks, compression: 8, predictor: 2, tile: ts, geo: { scale: [30, 30, 0], tie: [0, 0, 0, 400000, 3900000, 0], keys: geoKeysUTM43 } });
  const src = await M.readGeoTIFF(buf, 'u.tif');
  assert.deepEqual(src.crs, { type: 'utm', zone: 43, north: true });
  for (const [r, c] of [[0, 0], [5, 20], [31, 31], [17, 3]]) assert.equal(src.data[r * w + c], val(r, c));
  assert.equal(src.x0, 400015);
});

test('GeoTIFF: LZW uint16', async () => {
  const w = 24, h = 16;
  const u = new Uint16Array(w * h);
  for (let i = 0; i < u.length; i++) u[i] = 3000 + ((i * 37) % 200);
  const buf = makeTiff({ w, h, bps: 16, fmt: 1, chunks: [lzwEncode(new Uint8Array(u.buffer))], compression: 5, geo: { scale: [0.0005, 0.0005, 0], tie: [0, 0, 0, 74, 36, 0], keys: geoKeys4326 } });
  const src = await M.readGeoTIFF(buf, 'l.tif');
  assert.deepEqual(Array.from(src.data), Array.from(u));
});

test('GeoTIFF: floating-point predictor (3) + Deflate', async () => {
  const w = 16, h = 4;
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = 1500.25 + i * 3.5;
  const raw = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) {
    const row = new Uint8Array(w * 4);
    for (let s = 0; s < w; s++) {
      const b = new Uint8Array(new Float32Array([f[r * w + s]]).buffer); // little-endian bytes
      for (let k = 0; k < 4; k++) row[k * w + s] = b[3 - k]; // big-endian byte planes
    }
    for (let q = row.length - 1; q > 0; q--) row[q] = (row[q] - row[q - 1]) & 0xff;
    raw.set(row, r * w * 4);
  }
  const buf = makeTiff({ w, h, bps: 32, fmt: 3, chunks: [new Uint8Array(zlib.deflateSync(Buffer.from(raw)))], compression: 8, predictor: 3, geo: { scale: [0.001, 0.001, 0], tie: [0, 0, 0, 74, 36, 0], keys: geoKeys4326 } });
  const src = await M.readGeoTIFF(buf, 'p3.tif');
  assert.deepEqual(Array.from(src.data), Array.from(f));
});

test('SRTM HGT: origin from file name, big-endian samples, voids', () => {
  const n = 11;
  const buf = new ArrayBuffer(n * n * 2);
  const dv = new DataView(buf);
  for (let i = 0; i < n * n; i++) dv.setInt16(i * 2, 2500 + i, false);
  dv.setInt16(0, -32768, false);
  const src = M.readHGT(buf, 'N35E074.hgt');
  assert.equal(src.x0, 74); assert.equal(src.y0, 36);
  assert.ok(Math.abs(src.dx - 0.1) < 1e-12 && Math.abs(src.dy + 0.1) < 1e-12);
  assert.equal(src.data[12], 2512); assert.equal(src.nodata, -32768);
});

test('ESRI ASCII grid parse (geographic)', () => {
  const txt = 'ncols 3\nnrows 2\nxllcorner 74.0\nyllcorner 35.0\ncellsize 0.01\nNODATA_value -9999\n1 2 3\n4 5 -9999\n';
  const src = M.readASC(txt, 'a.asc');
  assert.equal(src.crs.type, 'geo');
  assert.deepEqual(Array.from(src.data), [1, 2, 3, 4, 5, -9999]);
  assert.ok(Math.abs(src.y0 - 35.015) < 1e-12);
});

test('ZIP (stored) containing an ASCII grid', async () => {
  const name = 'dem.asc';
  const data = new TextEncoder().encode('ncols 2\nnrows 2\nxllcorner 74\nyllcorner 35\ncellsize 0.01\n1 2\n3 4\n');
  const nameB = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nameB.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 0, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameB.length, true); local.set(nameB, 30); local.set(data, 30 + nameB.length);
  const cen = new Uint8Array(46 + nameB.length);
  const cv = new DataView(cen.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 0, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameB.length, true); cv.setUint32(42, 0, true); cen.set(nameB, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true); ev.setUint32(12, cen.length, true); ev.setUint32(16, local.length, true);
  const zip = new Uint8Array(local.length + cen.length + end.length);
  zip.set(local); zip.set(cen, local.length); zip.set(end, local.length + cen.length);
  const srcs = await M.parseDEMFile('tile.zip', zip.buffer);
  assert.equal(srcs.length, 1);
  assert.deepEqual(Array.from(srcs[0].data), [1, 2, 3, 4]);
});

test('buildGrid resamples a geographic DEM into a UTM grid', () => {
  const n = 201; // 0.1 deg tile at 0.0005 deg (~55 m)
  const data = new Float32Array(n * n);
  const lat0 = 36.0, lon0 = 74.0, d = 0.0005;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) data[r * n + c] = 2000 + (lat0 - r * d - 35.9) * 10000 + (c * d) * 5000;
  const src = { w: n, h: n, data, nodata: null, crs: { type: 'geo' }, x0: lon0, y0: lat0, dx: d, dy: -d, name: 'synthetic' };
  const g = M.buildGrid([src], { maxCells: 250000 });
  assert.equal(g.zone, 43);
  assert.ok(g.cs >= 55 && g.cs < 70, `cs ${g.cs}`);
  for (const [r, c] of [[10, 10], [Math.floor(g.h / 2), Math.floor(g.w / 2)], [g.h - 5, g.w - 5]]) {
    const ll = M.cellToLatLon(g, r, c);
    const expect = 2000 + (ll.lat - 35.9) * 10000 + (ll.lon - lon0) * 5000;
    assert.ok(Math.abs(g.z[r * g.w + c] - expect) < 0.5, `${g.z[r * g.w + c]} vs ${expect}`);
  }
  let nan = 0;
  for (const v of g.z) if (v !== v) nan++;
  assert.ok(nan / g.z.length < 0.03, `NaN share ${nan / g.z.length}`);
});
