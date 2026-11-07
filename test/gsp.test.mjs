// GSP Mountain Warfare rules built into the algorithms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers/load-core.mjs';

const M = loadCore();
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('march time: 3 km/h by day plus 30–60 min per 300 m up and per 600 m down (Annex E)', () => {
  const t = M.gspMarchTime(6000, 300, 600);
  assert.ok(near(t.minH, 2 + 1) && near(t.maxH, 2 + 2), JSON.stringify(t));
  const n = M.gspMarchTime(1000, 0, 0, { night: true });
  assert.ok(near(n.minH, 1) && near(n.maxH, 2), 'night 0.5–1 km/h');
  assert.ok(near(M.gspMarchTime(3000, 0, 0, { mapFactor: 4 / 3 }).minH, 4 / 3), 'map distance + 1/3');
});

test('uphill / downhill sight factor matches the Sec 18 table', () => {
  for (const [deg, f] of [[10, 1.02], [15, 1.04], [20, 1.06], [25, 1.10], [60, 2.0]]) assert.ok(Math.abs(M.sightFactor(deg) - f) < 0.011, `${deg}°`);
  assert.equal(M.sightFactor(-20), M.sightFactor(20));
});

const syn = M.syntheticTerrain();
const { jobs } = M.createSession();
const base = jobs.init({ grid: syn.grid }, () => {});
const g = syn.grid;
const snap = (p) => ({ r: p.r, c: p.c });
jobs.settings({ own: snap(syn.markers.own), threat: snap(syn.markers.threat), target: snap(syn.markers.target), threatProfile: 'foot' });
const none = () => {};

test('helipads respect the slope limit over the whole pad and stay hidden when required', () => {
  for (const use of ['regular', 'cargo']) {
    const r = jobs.helipads({ use, count: 3, padRadiusM: 30 }, none);
    assert.ok(r.pads.length >= 1, use);
    const lim = M.HELIPAD_SLOPE[use];
    const rad = Math.round(30 / g.cs);
    for (const p of r.pads) {
      assert.ok(p.hidden, `${p.id} concealed`);
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++)
        if (dr * dr + dc * dc <= rad * rad) assert.ok(base.slope[(p.r + dr) * g.w + p.c + dc] <= lim, `${p.id} ≤ ${lim}°`);
    }
  }
});

test('posts carry a defence tier and exactly one strong point on the most dominating site', () => {
  const r = jobs.posts({ count: 4, candidates: 60 }, none);
  const sp = r.posts.filter((p) => p.strongPoint);
  assert.equal(sp.length, 1);
  assert.ok(r.posts.every((p) => ['Ridge line', 'Mid slope', 'Valley / foothill'].includes(p.tier)));
  assert.equal(sp[0].dominance, Math.max(...r.posts.map((p) => p.dominance)));
});

test('MG mount limits leave plunging-fire dead ground; removing them recovers it', () => {
  const lim = jobs.weapons({ weaponId: 'mg3', count: 2, candidates: 40 }, none);
  const free = jobs.weapons({ weaponId: 'mg3', count: 2, candidates: 40, weaponOverrides: { aimUp: null, aimDown: null } }, none);
  assert.ok(lim.sites.some((s) => s.plungeDeadShare > 0), 'some ground beyond +6° / −8.5°');
  assert.ok(free.sites.every((s) => s.plungeDeadShare === 0));
  assert.ok(lim.sites.every((s) => s.sightFactor >= 1));
});

test('minefields avoid steep ground when the steep factor is zero', () => {
  const r = jobs.minefields({ type: 'AP', count: 3, maxSiteSlope: 20, steepFactor: 0 }, none);
  assert.ok(r.fields.length >= 1);
  assert.ok(r.fields.every((f) => f.siteSlopeDeg <= 20 || f.score === 0), r.fields.map((f) => f.siteSlopeDeg).join(','));
});

test('route: GSP times and a route card whose legs add up to the route', () => {
  const rt = jobs.route({ a: snap(syn.markers.a), b: snap(syn.markers.own), profile: 'foot', mode: 'fastest', alternatives: 1, cpEveryM: 0, legEveryM: 1000 }, none).routes[0];
  assert.ok(rt.gspDay.maxH >= rt.gspDay.minH && rt.gspNight.minH > rt.gspDay.minH);
  const sum = rt.card.reduce((a, l) => a + l.distM, 0);
  assert.ok(Math.abs(sum - rt.lengthM) < 1, `${sum} vs ${rt.lengthM}`);
  assert.ok(rt.card.length >= Math.floor(rt.lengthM / 1000));
});

test('mule movement class: loaded mule climbs what a man can without hands (SLOW-GO ≤ 30°)', () => {
  assert.equal(M.MOVEMENT_PROFILES.mule.slow, 30);
});
