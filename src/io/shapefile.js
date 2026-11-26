/*
 * MtnEye io — ESRI Shapefile export (WGS 84 geographic) packed in a ZIP.
 * A GeoJSON FeatureCollection is split into point, line and polygon layers
 * (<name>_points / _lines / _polygons: .shp .shx .dbf .prj .cpg), with every
 * property as a DBF field (names cut to 10 characters, made unique).
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function shapefile(M) {
  'use strict';

  M.WGS84_PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  const enc = (s) => new TextEncoder().encode(s);

  /** One shapefile layer. kind: 1 point, 3 polyline, 5 polygon. parts: array of [[x, y], ...] rings / paths per record. */
  const writeShp = (kind, records) => {
    const recLen = (rec) => (kind === 1 ? 20 : 44 + 4 * rec.length + 16 * rec.reduce((a, p) => a + p.length, 0));
    const shpLen = 100 + records.reduce((a, r) => a + 8 + recLen(r), 0);
    const shp = new DataView(new ArrayBuffer(shpLen)), shx = new DataView(new ArrayBuffer(100 + 8 * records.length));
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const r of records) for (const part of r) for (const [x, y] of part) { xmin = Math.min(xmin, x); ymin = Math.min(ymin, y); xmax = Math.max(xmax, x); ymax = Math.max(ymax, y); }
    if (!records.length) xmin = ymin = xmax = ymax = 0;
    const header = (dv, lenBytes) => {
      dv.setInt32(0, 9994); dv.setInt32(24, lenBytes / 2); dv.setInt32(28, 1000, true); dv.setInt32(32, kind, true);
      [xmin, ymin, xmax, ymax].forEach((v, k) => dv.setFloat64(36 + 8 * k, v, true));
    };
    header(shp, shpLen); header(shx, 100 + 8 * records.length);
    let o = 100;
    records.forEach((rec, k) => {
      const len = recLen(rec);
      shx.setInt32(100 + 8 * k, o / 2); shx.setInt32(104 + 8 * k, len / 2);
      shp.setInt32(o, k + 1); shp.setInt32(o + 4, len / 2); o += 8;
      shp.setInt32(o, kind, true);
      if (kind === 1) { shp.setFloat64(o + 4, rec[0][0][0], true); shp.setFloat64(o + 12, rec[0][0][1], true); o += 20; return; }
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const part of rec) for (const [x, y] of part) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
      [bx0, by0, bx1, by1].forEach((v, j) => shp.setFloat64(o + 4 + 8 * j, v, true));
      const nPts = rec.reduce((a, p) => a + p.length, 0);
      shp.setInt32(o + 36, rec.length, true); shp.setInt32(o + 40, nPts, true);
      let q = o + 44, start = 0;
      rec.forEach((part) => { shp.setInt32(q, start, true); q += 4; start += part.length; });
      for (const part of rec) for (const [x, y] of part) { shp.setFloat64(q, x, true); shp.setFloat64(q + 8, y, true); q += 16; }
      o = q;
    });
    return { shp: new Uint8Array(shp.buffer), shx: new Uint8Array(shx.buffer) };
  };

  /** dBASE III table from an array of property objects. */
  const writeDbf = (rows) => {
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const used = new Set();
    const fields = keys.map((k) => {
      let name = k.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 10) || 'F';
      for (let n = 1; used.has(name); n++) name = name.slice(0, 10 - String(n).length) + n;
      used.add(name);
      const vals = rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined && v !== '');
      const isNum = vals.length && vals.every((v) => typeof v === 'number' && isFinite(v));
      const isBool = vals.length && vals.every((v) => typeof v === 'boolean');
      if (isBool) return { k, name, type: 'L', len: 1, dec: 0 };
      if (isNum) {
        const dec = Math.min(6, Math.max(0, ...vals.map((v) => (String(v).split('.')[1] || '').length)));
        const len = Math.min(20, Math.max(...vals.map((v) => v.toFixed(dec).length)) + 1);
        return { k, name, type: 'N', len, dec };
      }
      const len = Math.min(254, Math.max(1, ...vals.map((v) => enc(typeof v === 'object' ? JSON.stringify(v) : String(v)).length)));
      return { k, name, type: 'C', len, dec: 0 };
    });
    const recLen = 1 + fields.reduce((a, f) => a + f.len, 0), hdrLen = 32 + 32 * fields.length + 1;
    const buf = new Uint8Array(hdrLen + recLen * rows.length + 1).fill(0x20);
    const dv = new DataView(buf.buffer);
    const now = new Date();
    buf[0] = 3; buf[1] = now.getFullYear() - 1900; buf[2] = now.getMonth() + 1; buf[3] = now.getDate();
    dv.setUint32(4, rows.length, true); dv.setUint16(8, hdrLen, true); dv.setUint16(10, recLen, true);
    for (let i = 12; i < 32; i++) buf[i] = 0;
    buf[29] = 0x57; // language driver: ANSI (UTF-8 declared in .cpg)
    fields.forEach((f, j) => {
      const o = 32 + 32 * j;
      for (let i = 0; i < 32; i++) buf[o + i] = 0;
      enc(f.name).forEach((b, i) => (buf[o + i] = b));
      buf[o + 11] = f.type.charCodeAt(0); buf[o + 16] = f.len; buf[o + 17] = f.dec;
    });
    buf[hdrLen - 1] = 0x0d;
    rows.forEach((r, i) => {
      let o = hdrLen + i * recLen;
      buf[o++] = 0x20;
      for (const f of fields) {
        const v = r[f.k];
        let s = '';
        if (v !== null && v !== undefined) {
          if (f.type === 'N') s = (+v).toFixed(f.dec).padStart(f.len).slice(-f.len);
          else if (f.type === 'L') s = v ? 'T' : 'F';
          else s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        }
        let bytes = enc(s);
        if (bytes.length > f.len) bytes = bytes.slice(0, f.len);
        buf.set(bytes, o);
        o += f.len;
      }
    });
    buf[buf.length - 1] = 0x1a;
    return { dbf: buf, fields };
  };

  /** GeoJSON FeatureCollection -> {filename: Uint8Array} for each non-empty geometry layer. */
  M.geojsonToShapefiles = (fc, base = 'mtneye') => {
    const groups = { points: { kind: 1, recs: [], props: [] }, lines: { kind: 3, recs: [], props: [] }, polygons: { kind: 5, recs: [], props: [] } };
    const flat = (p) => Object.fromEntries(Object.entries(p || {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]));
    const ringCW = (ring) => { // shapefile outer rings are clockwise
      let a = 0;
      for (let i = 0; i < ring.length - 1; i++) a += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
      return a > 0 ? ring : ring.slice().reverse();
    };
    for (const f of fc.features || []) {
      const gm = f.geometry;
      if (!gm) continue;
      if (gm.type === 'Point') { groups.points.recs.push([[gm.coordinates]]); groups.points.props.push(flat(f.properties)); }
      else if (gm.type === 'LineString') { groups.lines.recs.push([gm.coordinates]); groups.lines.props.push(flat(f.properties)); }
      else if (gm.type === 'Polygon') { groups.polygons.recs.push(gm.coordinates.map((r, k) => (k ? r : ringCW(r)))); groups.polygons.props.push(flat(f.properties)); }
    }
    const files = {};
    for (const [name, gr] of Object.entries(groups)) {
      if (!gr.recs.length) continue;
      const { shp, shx } = writeShp(gr.kind, gr.recs);
      const { dbf } = writeDbf(gr.props);
      const b = `${base}_${name}`;
      Object.assign(files, { [`${b}.shp`]: shp, [`${b}.shx`]: shx, [`${b}.dbf`]: dbf, [`${b}.prj`]: enc(M.WGS84_PRJ), [`${b}.cpg`]: enc('UTF-8') });
    }
    return files;
  };

  // ------------------------------------------------------------ minimal ZIP writer (stored)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  M.zipStore = (files) => {
    const entries = Object.entries(files).map(([name, data]) => ({ name: enc(name), data, crc: crc32(data) }));
    const size = entries.reduce((a, e) => a + 30 + e.name.length + e.data.length + 46 + e.name.length, 0) + 22;
    const out = new Uint8Array(size), dv = new DataView(out.buffer);
    let o = 0;
    const central = [];
    for (const e of entries) {
      central.push(o);
      dv.setUint32(o, 0x04034b50, true); dv.setUint16(o + 4, 20, true); dv.setUint16(o + 6, 0x0800, true); dv.setUint16(o + 8, 0, true);
      dv.setUint32(o + 14, e.crc, true); dv.setUint32(o + 18, e.data.length, true); dv.setUint32(o + 22, e.data.length, true);
      dv.setUint16(o + 26, e.name.length, true); dv.setUint16(o + 28, 0, true);
      out.set(e.name, o + 30); out.set(e.data, o + 30 + e.name.length);
      o += 30 + e.name.length + e.data.length;
    }
    const cdStart = o;
    entries.forEach((e, k) => {
      dv.setUint32(o, 0x02014b50, true); dv.setUint16(o + 4, 20, true); dv.setUint16(o + 6, 20, true); dv.setUint16(o + 8, 0x0800, true); dv.setUint16(o + 10, 0, true);
      dv.setUint32(o + 16, e.crc, true); dv.setUint32(o + 20, e.data.length, true); dv.setUint32(o + 24, e.data.length, true);
      dv.setUint16(o + 28, e.name.length, true); dv.setUint32(o + 42, central[k], true);
      out.set(e.name, o + 46);
      o += 46 + e.name.length;
    });
    dv.setUint32(o, 0x06054b50, true); dv.setUint16(o + 8, entries.length, true); dv.setUint16(o + 10, entries.length, true);
    dv.setUint32(o + 12, o - cdStart, true); dv.setUint32(o + 16, cdStart, true);
    return out;
  };
});
