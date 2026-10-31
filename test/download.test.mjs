import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers/load-core.mjs';

const M = loadCore();
const R = 6378137, WORLD = 2 * Math.PI * R;
const elevFn = (lat, lon) => 2000 + (lon - 74) * 4000 + (lat - 35) * 2500; // smooth test surface
/** Synthetic Terrarium tile: encode elevFn at every pixel centre. */
const makeTile = (z, x, y) => {
  const rgba = new Uint8ClampedArray(256 * 256 * 4);
  const res = WORLD / (256 * 2 ** z);
  for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) {
    const X = -WORLD / 2 + (x * 256 + c + 0.5) * res, Y = WORLD / 2 - (y * 256 + r + 0.5) * res;
    const lon = (X / R) * 180 / Math.PI, lat = (2 * Math.atan(Math.exp(Y / R)) - Math.PI / 2) * 180 / Math.PI;
    const v = elevFn(lat, lon) + 32768;
    const i = (r * 256 + c) * 4;
    rgba[i] = Math.floor(v / 256); rgba[i + 1] = Math.floor(v) % 256; rgba[i + 2] = Math.round((v - Math.floor(v)) * 256) % 256; rgba[i + 3] = 255;
  }
  return rgba;
};

test('slippy tile coordinates', () => {
  const t = M.tileXY(0, 0, 1);
  assert.equal(t.x, 1); assert.ok(Math.abs(t.y - 1) < 1e-12);
  const r = M.tileRange({ west: 74.0, south: 35.5, east: 74.1, north: 35.6 }, 12);
  assert.ok(r.count >= 1 && r.count <= 9, JSON.stringify(r));
});

test('Terrarium decoding', () => {
  const e = M.terrariumDecode(Uint8Array.from([128, 0, 0, 255, 129, 44, 128, 255]));
  assert.equal(e[0], 0); assert.equal(e[1], 300.5);
});

test('Terrarium mosaic -> UTM analysis grid reproduces the surface', async () => {
  const bbox = { west: 74.02, south: 35.52, east: 74.12, north: 35.6 };
  const src = await M.mosaicTerrarium(bbox, 12, async (z, x, y) => makeTile(z, x, y));
  assert.equal(src.crs.type, 'merc');
  const g = M.buildGrid([src], { maxCells: 200000 });
  assert.equal(g.zone, 43);
  for (const [r, c] of [[10, 10], [Math.floor(g.h / 2), Math.floor(g.w / 2)], [g.h - 10, g.w - 10]]) {
    const ll = M.cellToLatLon(g, r, c);
    assert.ok(Math.abs(g.z[r * g.w + c] - elevFn(ll.lat, ll.lon)) < 1, `${g.z[r * g.w + c]} vs ${elevFn(ll.lat, ll.lon)}`);
  }
});

test('downloadDEM (terrarium) with injected fetch / PNG decoder', async () => {
  const urls = [];
  const fakeFetch = async (u) => { urls.push(u); const m = /terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(u); return { ok: true, blob: async () => ({ z: +m[1], x: +m[2], y: +m[3] }) }; };
  const decodePNG = async (b) => makeTile(b.z, b.x, b.y);
  const [src] = await M.downloadDEM({ source: 'terrarium', bbox: { west: 74.0, south: 35.5, east: 74.05, north: 35.55 }, zoom: 11 }, { fetch: fakeFetch, decodePNG });
  assert.ok(urls.length >= 1 && urls[0].startsWith('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/11/'));
  assert.ok(src.w > 10 && src.h > 10);
  await assert.rejects(M.downloadDEM({ source: 'opentopo', bbox: { west: 74, south: 35, east: 74.1, north: 35.1 } }, { fetch: fakeFetch }), /API key/);
});

test('GeoTIFF writer round trip (geographic, UTM, Web Mercator)', async () => {
  const w = 37, h = 23;
  const data = Float32Array.from({ length: w * h }, (_, i) => 1000 + i * 0.25);
  for (const crs of [{ type: 'geo' }, { type: 'utm', zone: 43, north: true }, { type: 'merc' }]) {
    const ras = { w, h, data, x0: crs.type === 'geo' ? 74.0005 : 412012.5, y0: crs.type === 'geo' ? 35.9995 : 3960012.5, dx: crs.type === 'geo' ? 0.001 : 25, dy: crs.type === 'geo' ? -0.001 : -25, crs };
    const back = await M.readGeoTIFF(M.writeGeoTIFF(ras), 'rt.tif');
    assert.equal(back.w, w); assert.equal(back.h, h);
    assert.deepEqual(Array.from(back.data), Array.from(data));
    assert.equal(back.crs.type, crs.type);
    if (crs.type === 'utm') assert.equal(back.crs.zone, 43);
    assert.ok(Math.abs(back.x0 - ras.x0) < 1e-6 && Math.abs(back.y0 - ras.y0) < 1e-6);
  }
});
