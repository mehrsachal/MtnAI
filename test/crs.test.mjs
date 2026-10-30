import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers/load-core.mjs';

const M = loadCore();
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('generic Transverse Mercator reproduces the UTM implementation', () => {
  const crs = M.resolveCRS('WGS84-UTM', { zone: 43, north: true });
  for (const [lat, lon] of [[35.7, 74.1], [33.2, 72.4], [36.9, 76.8]]) {
    const p = M.crsForward(crs, lat, lon), u = M.toUTM(lat, lon, 43);
    close(p.x, u.E, 0.001, 'E'); close(p.y, u.N, 0.001, 'N');
    const ll = M.crsInverse(crs, p.x, p.y);
    close(ll.lat, lat, 1e-8, 'lat'); close(ll.lon, lon, 1e-8, 'lon');
  }
});

test('India zone I (Lambert 1SP): natural origin maps to the false origin on its own datum', () => {
  const c = M.CRS_PRESETS['EPSG:24376'];
  const el = { a: 6377301.243, f: 1 / 300.8017255 };
  el.e2 = el.f * (2 - el.f); el.e = Math.sqrt(el.e2);
  const p = M.lccForward(el, 32.5, 68, c.proj);
  close(p.x, 2743196.4, 1e-6, 'FE'); close(p.y, 914398.8, 1e-6, 'FN');
  // scale factor at the origin parallel = k0: 1 km east along the parallel is k0 km on the grid
  const q = M.lccForward(el, 32.5, 68 + 1000 / (111320 * Math.cos((32.5 * Math.PI) / 180)) * 1.0, c.proj);
  assert.ok(q.x - p.x > 990 && q.x - p.x < 1005);
});

test('Kalianpur 1962 datum shift: round trip and plausible magnitude', () => {
  const lat = 34.0, lon = 73.5;
  const k = M.toDatum(lat, lon, 'KALIANPUR1962');
  const back = M.fromDatum(k.lat, k.lon, 'KALIANPUR1962');
  close(back.lat, lat, 1e-7, 'lat'); close(back.lon, lon, 1e-7, 'lon'); // < 1 cm (height is dropped)
  const dN = (k.lat - lat) * 111000, dE = (k.lon - lon) * 111000 * Math.cos((lat * Math.PI) / 180);
  const shift = Math.hypot(dN, dE);
  assert.ok(shift > 20 && shift < 2000, `shift ${shift.toFixed(0)} m`);
});

test('projected CRS round trips (India zones, Kalianpur UTM, Web Mercator)', () => {
  for (const id of ['EPSG:24376', 'EPSG:24377', 'KAL62-UTM', 'EPSG:3857']) {
    const c = M.resolveCRS(id, { zone: 43, north: true });
    const p = M.crsForward(c, 34.25, 73.75);
    const ll = M.crsInverse(c, p.x, p.y);
    close(ll.lat, 34.25, 1e-7, id); close(ll.lon, 73.75, 1e-7, id);
  }
});

test('GARS: cell / quadrant / keypad and parse round trip', () => {
  assert.equal(M.toGARS(-89.99, -179.99, 30), '001AA');
  const s = M.toGARS(35.71, 74.08, 5);
  assert.match(s, /^\d{3}[A-HJ-NP-Q][A-HJ-NP-Z][1-4][1-9]$/);
  const ll = M.parseGARS(s);
  assert.ok(Math.abs(ll.lat - 35.71) < 5 / 60 && Math.abs(ll.lon - 74.08) < 5 / 60, `${s} -> ${ll.lat},${ll.lon}`);
  assert.equal(M.toGARS(ll.lat, ll.lon, 5), s);
});

test('GEOREF: quadrangle letters and parse round trip', () => {
  const s = M.toGEOREF(35.71, 74.08, 2);
  assert.match(s, /^[A-HJ-NP-Z][A-HJ-M][A-HJ-NP-Q][A-HJ-NP-Q]\d{4}$/);
  // 74.08E: (74.08 + 180) / 15 = 16 -> 'S' (I and O are skipped); 35.71N: 125.71 / 15 = 8 -> 'J'
  assert.equal(s.slice(0, 2), 'SJ');
  assert.equal(M.toGEOREF(38.9, -77.0, 2).slice(0, 2), 'GJ'); // Washington DC lies in quadrangle GJ
  const ll = M.parseGEOREF(s);
  assert.ok(Math.abs(ll.lat - 35.71) < 1 / 60 && Math.abs(ll.lon - 74.08) < 1 / 60);
});

test('reference parser accepts MGRS, UTM, DMS, decimal and projected E/N', () => {
  const ref = M.toMGRS(35.71, 74.08, 5);
  for (const s of [ref, ref.replace(/\s/g, ''), '43S 416789mE 3951711mN', '35°42\'36"N 74°04\'48"E', '35.71, 74.08', '35 42 36 N 74 04 48 E']) {
    const ll = M.parseRef(s);
    assert.ok(ll, s);
    assert.ok(Math.abs(ll.lat - 35.71) < 0.05 && Math.abs(ll.lon - 74.08) < 0.05, `${s} -> ${JSON.stringify(ll)}`);
  }
  const c = M.resolveCRS('EPSG:24376');
  const p = M.crsForward(c, 35.71, 74.08);
  const ll = M.parseRef(`${Math.round(p.x)} ${Math.round(p.y)}`, { crs: c });
  assert.ok(Math.abs(ll.lat - 35.71) < 1e-4 && Math.abs(ll.lon - 74.08) < 1e-4);
});

test('north reference: true and magnetic bearings from grid bearing', () => {
  assert.equal(M.northRef(90, 'grid', 1.5, 3), 90);
  assert.equal(M.northRef(90, 'true', 1.5, 3), 91.5);
  assert.equal(M.northRef(90, 'magnetic', 1.5, 3), 88.5);
});
