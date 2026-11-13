// Sector planning: frame, terrain value, networks, ITGs, deployment, fire, border watch, enemy analysis, Shapefile export.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers/load-core.mjs';

const M = loadCore();
const syn = M.syntheticTerrain();
const { jobs, state } = M.createSession();
jobs.init({ grid: syn.grid }, () => {});
const g = syn.grid;
const snap = (p) => ({ r: p.r, c: p.c });
jobs.settings({ own: snap(syn.markers.own), threat: snap(syn.markers.threat), threatProfile: 'foot', sector: syn.sector, border: syn.border });
const none = () => {};
const terr = jobs.sectorTerrain({});
const F = () => state.sec.frame;
const side = (q) => F().side[Math.round(q.r) * g.w + Math.round(q.c)];

test('frame: own position is on the own side, enemy on the other; distances to the border are metres', () => {
  assert.equal(side(syn.markers.own), 1);
  assert.equal(side(syn.markers.threat), -1);
  const b = syn.border[5];
  assert.ok(F().borderDist[Math.round(b[1]) * g.w + Math.round(b[0])] <= g.cs);
});

test('terrain value is 0–100 and ridges score higher than nullahs', () => {
  let lo = Infinity, hi = -Infinity;
  for (const v of terr.dominance) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo >= 0 && hi <= 100 && hi > 95);
  assert.ok(terr.ridges.length > 5 && terr.nullahs.length > 5);
  assert.ok(terr.ridges[0].meanDominance > 70, `best ridge ${terr.ridges[0].meanDominance}`);
  assert.ok(terr.nullahs.some((n) => n.type === 'valley') && terr.nullahs.some((n) => n.type === 'nullah'));
});

test('ITGs: summits on the own side inside the sector, with extent, size and force needed', () => {
  const r = jobs.itgs({ count: 8 }, none);
  assert.ok(r.itgs.length >= 4);
  for (const q of r.itgs) {
    assert.equal(side(q), 1, `${q.id} own side`);
    assert.ok(M.pointInPoly(q.c, q.r, syn.sector), `${q.id} in sector`);
    assert.ok(q.areaHa > 0 && q.perimeterM > 0 && q.outline.length >= 3);
    assert.ok(['section', 'platoon', 'company', 'battalion'].includes(q.force.echelon));
    assert.ok(['Good', 'Marginal', 'Not good'].includes(q.rating));
  }
  assert.deepEqual(M.forceFor(300, M.SECTOR_DEFAULTS.itg).echelon, 'section');
  assert.deepEqual(M.forceFor(2000, M.SECTOR_DEFAULTS.itg).echelon, 'company');
});

test('deployment modes: forward has the most border posts, strong point concentrates platoons on fewest ITGs', () => {
  const plans = {};
  for (const mode of ['forward', 'normal', 'strongpoint']) plans[mode] = jobs.deploy({ mode }, none);
  const itgsUsed = (p) => new Set(p.platoons.map((q) => q.itg)).size;
  assert.ok(plans.forward.borderPosts.length > plans.normal.borderPosts.length && plans.normal.borderPosts.length > plans.strongpoint.borderPosts.length);
  assert.equal(itgsUsed(plans.strongpoint), 3);
  assert.ok(itgsUsed(plans.normal) > itgsUsed(plans.strongpoint));
  for (const p of Object.values(plans)) {
    assert.equal(p.platoons.length, 9);
    assert.equal(p.companies.length, 3);
    for (const q of p.borderPosts) { assert.equal(side(q), 1); assert.ok(F().borderDist[q.r * g.w + q.c] <= p.params.borderPostDepthM + g.cs); }
    for (const co of p.companies) { assert.equal(side(co.hq), 1); assert.ok(co.hq.rating); }
  }
});

test('enemy approaches start across the border and end at ITGs; options are 3–4 with labels', () => {
  jobs.deploy({ mode: 'normal' }, none);
  const a = jobs.enemyApproaches({}, none);
  assert.ok(a.approaches.length >= 4);
  for (const x of a.approaches) {
    assert.equal(side({ c: x.line[0][0], r: x.line[0][1] }), -1, `${x.id} starts on the enemy side`);
    assert.ok(['valley', 'nullah', 'ridge line', 'spur / slope'].includes(x.type));
    assert.ok(x.exposure >= 0 && x.exposure <= 1);
  }
  const o = jobs.enemyOptions({});
  assert.ok(o.options.length >= 3 && o.options.length <= 4);
  assert.ok(o.options[0].label.includes('Most likely'));
  assert.ok(o.options.some((x) => x.label.includes('Most dangerous')));
});

test('infiltration routes prefer unobserved ground; fire coverage and border watch report gaps', () => {
  const inf = jobs.infiltration({ infilCount: 3 }, none);
  assert.ok(inf.routes.length >= 1);
  for (let k = 1; k < inf.routes.length; k++) assert.ok(inf.routes[k].detectShare >= inf.routes[k - 1].detectShare);
  const f = jobs.fireCoverage({});
  assert.ok(f.weapons.length >= 12 && f.postCover.length >= 9);
  assert.ok(f.postCover.every((q) => q.coveredBy >= 0 && ['Good', 'Marginal', 'Not good'].includes(q.rating)));
  const bw = jobs.borderWatch({}, none);
  assert.ok(bw.observedShare > 0 && bw.observedShare <= 1);
  const few = jobs.borderWatch({ extraObservers: [] , opts: {} }, none);
  assert.equal(few.observedShare, bw.observedShare);
});

test('Shapefile export: valid headers, record counts and DBF fields; ZIP has every file', () => {
  const fc = { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [74.1, 35.7] }, properties: { id: 'P1', rating: 'Good', z: 3988, hidden: true } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[74, 35], [74.1, 35.1]] }, properties: { id: 'EA1' } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[74, 35], [74.1, 35], [74.1, 35.1], [74, 35]]] }, properties: { id: 'ITG 1', area_ha: 2.5 } },
  ] };
  const files = M.geojsonToShapefiles(fc, 't');
  for (const [name, kind] of [['points', 1], ['lines', 3], ['polygons', 5]]) {
    const shp = new DataView(files[`t_${name}.shp`].buffer);
    assert.equal(shp.getInt32(0), 9994);
    assert.equal(shp.getInt32(24) * 2, files[`t_${name}.shp`].length);
    assert.equal(shp.getInt32(32, true), kind);
    assert.equal((files[`t_${name}.shx`].length - 100) / 8, 1);
    assert.equal(new DataView(files[`t_${name}.dbf`].buffer).getUint32(4, true), 1);
    assert.ok(new TextDecoder().decode(files[`t_${name}.prj`]).startsWith('GEOGCS["GCS_WGS_1984"'));
  }
  const zip = M.zipStore(files);
  const dv = new DataView(zip.buffer), eocd = zip.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  assert.equal(dv.getUint16(eocd + 10, true), 15);
  let at = dv.getUint32(eocd + 16, true), names = [];
  for (let k = 0; k < 15; k++) {
    assert.equal(dv.getUint32(at, true), 0x02014b50);
    const n = dv.getUint16(at + 28, true);
    names.push(new TextDecoder().decode(zip.subarray(at + 46, at + 46 + n)));
    at += 46 + n;
  }
  assert.ok(names.includes('t_polygons.dbf') && names.includes('t_points.prj'));
});
