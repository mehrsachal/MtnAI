// Geoprocessing tool parameters must actually change what the algorithms produce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers/load-core.mjs';

const M = loadCore();
const syn = M.syntheticTerrain();
const { jobs } = M.createSession();
const base = jobs.init({ grid: syn.grid }, () => {});
const g = syn.grid, w = g.w;
const snap = (p) => ({ r: p.r, c: p.c });
const own = snap(syn.markers.own), threat = snap(syn.markers.threat);
jobs.settings({ own, threat, target: snap(syn.markers.target), threatProfile: 'foot' });
const none = () => {};
const distM = (a, b) => Math.hypot(a.r - b.r, a.c - b.c) * g.cs;

test('posts: allowed landforms and distance from own position are enforced', () => {
  const r = jobs.posts({ count: 3, landforms: [5], maxDistOwnM: 4000, candidates: 60 }, none);
  assert.ok(r.posts.length >= 1);
  for (const p of r.posts) {
    assert.equal(base.landform[p.r * w + p.c], 5, `${p.id} is on a ridge / crest`);
    assert.ok(distM(p, own) <= 4000 + g.cs, `${p.id} within 4 km of own position`);
  }
  assert.deepEqual(r.params.landforms, [5]);
});

test('posts: OP mode names sites OPn and minimum separation holds', () => {
  const r = jobs.posts({ mode: 'op', count: 4, minSepM: 1500, candidates: 80 }, none);
  assert.ok(r.posts.every((p) => /^OP\d$/.test(p.id)));
  for (let a = 0; a < r.posts.length; a++)
    for (let b = a + 1; b < r.posts.length; b++) assert.ok(distM(r.posts[a], r.posts[b]) >= 1500 * 0.75);
});

test('indirect fire: "must be hidden from enemy observation" yields only defiladed sites', () => {
  const r = jobs.weapons({ weaponId: 'mor81', count: 3, requireDefilade: true, requireAccess: false }, none);
  assert.ok(r.sites.length >= 1);
  assert.ok(r.sites.every((s) => s.hidden), 'every mortar position is hidden from likely enemy OPs');
});

test('minefields: maximum gap width bounds the frontage chosen', () => {
  const wide = jobs.minefields({ type: 'AP', count: 3, maxGapM: 400 }, none);
  const narrow = jobs.minefields({ type: 'AP', count: 3, maxGapM: 150 }, none);
  assert.ok(wide.fields.length >= 1 && narrow.fields.length >= 1);
  for (const f of narrow.fields) assert.ok(f.gapM <= 150 + 2 * g.cs, `${f.id} gap ${f.gapM}`);
  assert.equal(narrow.params.maxGapM, 150);
});

test('picquets: an explicit count overrides the automatic spacing', () => {
  const rt = jobs.route({ a: snap(syn.markers.a), b: own, profile: 'foot', mode: 'fastest', alternatives: 1, cpEveryM: 0 }, none);
  const path = Array.from(rt.routes[0].path);
  const two = jobs.picquets({ path, count: 2 }, none);
  const auto = jobs.picquets({ path, count: 0, kmPerPicquet: 1, maxCount: 8 }, none);
  assert.equal(two.picquets.length, 2);
  assert.ok(auto.picquets.length > 2, `automatic: ${auto.picquets.length}`);
});

test('route: custom exposure weight reduces exposure to enemy observation', () => {
  const args = { a: snap(syn.markers.a), b: own, profile: 'foot', alternatives: 1, cpEveryM: 0 };
  const fast = jobs.route(Object.assign({ mode: 'fastest' }, args), none).routes[0];
  const hid = jobs.route(Object.assign({ mode: 'custom', exposureW: 25, skylineW: 0 }, args), none).routes[0];
  assert.ok(hid.exposedFrac <= fast.exposedFrac, `${hid.exposedFrac} <= ${fast.exposedFrac}`);
  assert.ok(hid.timeH >= fast.timeH - 1e-9);
});

test('key terrain: maximum heights and passes are respected', () => {
  const r = jobs.keyTerrain({ maxPeaks: 4, maxPasses: 2 });
  assert.ok(r.peaks.length <= 4 && r.peaks.length >= 1);
  assert.ok(r.passes.length <= 2);
});
