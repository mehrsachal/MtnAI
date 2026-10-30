import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers/load-core.mjs';

const M = loadCore();

const planeGrid = (w, h, cs, fn) => {
  const z = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) z[r * w + c] = fn(r, c);
  return M.makeGrid({ w, h, cs, x0: 400000, y0: 4000000, zone: 43, north: true, z });
};

test('MGRS: equator / prime meridian reference', () => {
  assert.equal(M.toMGRS(0, 0), '31N AA 66021 00000');
});

test('MGRS: Washington Monument within 1 m of the published reference', () => {
  const s = M.toMGRS(38.8895, -77.0352);
  const [zb, sq, e, n] = s.split(' ');
  assert.equal(zb, '18S'); assert.equal(sq, 'UJ');
  assert.ok(Math.abs(+e - 23487) <= 1, s); assert.ok(Math.abs(+n - 6483) <= 1, s);
});

test('UTM round trip is sub-millimetre', () => {
  for (const [lat, lon] of [[35.9, 74.3], [33.7, 73.1], [-33.9, 18.4], [0.1, 3.2], [60.2, 24.9]]) {
    const u = M.toUTM(lat, lon);
    const ll = M.fromUTM(u.E, u.N, u.zone, u.north);
    assert.ok(Math.abs(ll.lat - lat) < 1e-8 && Math.abs(ll.lon - lon) < 1e-8, `${lat},${lon}`);
  }
});

test('MGRS parse round trip', () => {
  const lat = 35.92, lon = 74.31;
  const s = M.toMGRS(lat, lon, 5);
  const u = M.parseMGRS(s);
  const ll = M.fromUTM(u.E, u.N, u.zone, u.north);
  assert.ok(Math.abs(ll.lat - lat) < 2e-5 && Math.abs(ll.lon - lon) < 2e-5, s);
});

test('slope and aspect on an inclined plane', () => {
  const t = Math.tan(M.rad(30));
  const g = planeGrid(20, 20, 30, (r, c) => c * 30 * t); // rises to the east
  const { slope, aspect } = M.slopeAspect(g);
  const i = 10 * 20 + 10;
  assert.ok(Math.abs(slope[i] - 30) < 0.01, `slope ${slope[i]}`);
  assert.ok(Math.abs(aspect[i] - 270) < 0.01, `aspect ${aspect[i]}`); // faces west (downslope)
  const g2 = planeGrid(20, 20, 30, (r) => -r * 30 * t); // falls to the south
  assert.ok(Math.abs(M.slopeAspect(g2).aspect[i] - 180) < 0.01);
});

test('hillshade: slope facing the sun is brighter', () => {
  const g = planeGrid(20, 20, 30, (r, c) => c * 15); // faces west
  const hsW = M.hillshade(g, null, { azimuth: 270, altitude: 45 })[210];
  const hsE = M.hillshade(g, null, { azimuth: 90, altitude: 45 })[210];
  assert.ok(hsW > hsE + 50, `${hsW} vs ${hsE}`);
});

test('viewshed: flat ground fully visible; wall hides ground behind it', () => {
  const flat = planeGrid(101, 101, 10, () => 100);
  const vs = M.viewshed(flat, 50, 50, { obsH: 2, radiusM: 400 });
  let inside = 0, seen = 0;
  for (let r = 0; r < 101; r++) for (let c = 0; c < 101; c++) {
    if (Math.hypot(r - 50, c - 50) * 10 <= 390) { inside++; if (vs.mask[r * 101 + c]) seen++; }
  }
  assert.ok(seen / inside > 0.99, `${seen}/${inside}`);
  const wall = planeGrid(101, 101, 10, (r, c) => (c === 60 ? 200 : 100));
  const vw = M.viewshed(wall, 50, 50, { obsH: 2, radiusM: 450 });
  assert.equal(vw.mask[50 * 101 + 58], 1);
  assert.equal(vw.mask[50 * 101 + 80], 0);
});

test('line of sight is blocked by an intervening ridge', () => {
  const g = planeGrid(100, 10, 10, (r, c) => (c === 50 ? 300 : 100));
  assert.equal(M.lineOfSight(g, { r: 5, c: 10 }, { r: 5, c: 90 }).visible, false);
  const g2 = planeGrid(100, 10, 10, () => 100);
  assert.equal(M.lineOfSight(g2, { r: 5, c: 10 }, { r: 5, c: 90 }).visible, true);
});

test('mobility classes follow slope thresholds', () => {
  const prof = M.profile('jeep');
  const slope = Float32Array.from([5, 15, 25]);
  const cls = M.classifyMobility({ w: 3, h: 1 }, { slope, z: Float32Array.from([0, 0, 0]) }, prof, {});
  assert.deepEqual(Array.from(cls), [0, 1, 2]);
  const snow = M.classifyMobility({ w: 3, h: 1 }, { slope, z: Float32Array.from([5000, 0, 0]) }, prof, { snowLine: 4500 });
  assert.equal(snow[0], 2, 'vehicles are No-Go above the snow line');
});

test('A*: straight path on flat ground and detour through a gap', () => {
  const w = 60, h = 60;
  const g = planeGrid(w, h, 30, () => 1000);
  const { slope } = M.slopeAspect(g);
  const prof = M.profile('foot');
  const cls = new Uint8Array(w * h);
  const ctx = { cls, slope, prof };
  const res = M.astar(g, ctx, 30 * w + 5, 30 * w + 55);
  const st = M.routeStats(g, ctx, res.path);
  assert.ok(Math.abs(st.lengthM - 50 * 30) < 1, `length ${st.lengthM}`);
  for (let r = 0; r < h; r++) if (r !== 10) cls[r * w + 30] = 2; // wall with a gap at r = 10
  const res2 = M.astar(g, ctx, 30 * w + 5, 30 * w + 55);
  assert.ok(Array.from(res2.path).includes(10 * w + 30), 'route passes the gap');
});

test('reachable() follows a one-cell-wide corridor on rough ground (no stale-entry drops)', () => {
  const w = 80, h = 9;
  const rnd = M.rng(3);
  const g = planeGrid(w, h, 25, () => 2000 + rnd() * 30);
  const { slope } = M.slopeAspect(g);
  const cls = new Uint8Array(w * h).fill(2);
  for (let c = 0; c < w; c++) cls[4 * w + c] = 0; // corridor along row 4
  const t = M.reachable(g, { cls, slope, prof: M.profile('mule') }, [4 * w]);
  assert.ok(Number.isFinite(t[4 * w + w - 1]), 'end of corridor reached');
});

test('Tobler: downhill faster than uphill for foot movement', () => {
  const prof = M.profile('foot');
  assert.ok(M.moveSpeed(prof, -0.1, 6, 0, 1000) > M.moveSpeed(prof, 0.1, 6, 0, 1000));
  assert.equal(M.moveSpeed(prof, 0, 50, 2, 1000), 0);
});

test('contours of a plane are evenly spaced straight lines', () => {
  const g = planeGrid(50, 50, 10, (r, c) => c * 10); // 0..490 m
  const ct = M.contours(g, 100);
  const levels = [...new Set(Array.from(ct.levels))].filter((l) => l > 0).sort((a, b) => a - b);
  assert.deepEqual(levels, [100, 200, 300, 400]);
  // each interior level crosses every row once: 49 segments per level
  assert.equal(Array.from(ct.levels).filter((l) => l === 200).length, 49);
});

test('key terrain finds a peak and the saddle between two peaks', () => {
  // E-W ridge with summits at c = 30 / 90 and a col at c = 60
  const g = planeGrid(121, 81, 25, (r, c) =>
    1000 + (400 + 300 * Math.cos((2 * Math.PI * (c - 30)) / 60)) * Math.exp(-((r - 40) ** 2) / 100));
  const { slope } = M.slopeAspect(g);
  const tpiL = M.tpi(g, 30);
  const kt = M.keyTerrain(g, slope, tpiL, { passReliefM: 20 });
  assert.ok(kt.peaks.some((p) => Math.abs(p.c - 30) <= 1 && Math.abs(p.r - 40) <= 1), 'west peak');
  assert.ok(kt.passes.some((p) => Math.abs(p.c - 60) <= 4 && Math.abs(p.r - 40) <= 4), JSON.stringify(kt.passes.slice(0, 3)));
});

test('crest clearance: mortar (high angle) clears a ridge a low-angle gun cannot', () => {
  // gun at c=10, ridge 300 m high 225-275 m in front, target at c=200 (4.75 km)
  const g = planeGrid(220, 5, 25, (r, c) => (c >= 19 && c <= 21 ? 1300 : 1000));
  const site = { r: 2, c: 10 }, tgt = { r: 2, c: 200 };
  const gun = M.weapon('t591');
  const mortar = M.weapon('mor120');
  assert.equal(M.crestClearance(g, site, tgt, gun).ok, false);
  const m = M.crestClearance(g, site, tgt, mortar);
  assert.equal(m.ok, true); assert.equal(m.mode, 'high');
});

test('tactical aids on the synthetic training area', () => {
  const syn = M.syntheticTerrain();
  const { jobs } = M.createSession();
  const base = jobs.init({ grid: syn.grid }, () => {});
  assert.ok(base.stats.relief > 1500);
  const snap = (p) => ({ r: p.r, c: p.c });
  jobs.settings({ own: snap(syn.markers.own), threat: snap(syn.markers.threat), threatProfile: 'foot' });
  const posts = jobs.posts({ count: 4, rangeM: 3000, maxSlope: 35 }, () => {});
  assert.equal(posts.posts.length, 4);
  for (const p of posts.posts) assert.ok(base.slope[p.r * syn.grid.w + p.c] <= 35);
  const mg = jobs.weapons({ weaponId: 'mg3', count: 2 }, () => {});
  assert.equal(mg.sites.length, 2);
  assert.ok(mg.sites[0].sector && mg.sites[0].sector.mean >= 0);
  const ap = jobs.minefields({ type: 'AP', count: 2 }, () => {});
  assert.ok(ap.fields.length >= 1);
  assert.equal(ap.fields[0].poly.length, 4);
  const rt = jobs.route({ a: snap(syn.markers.a), b: snap(syn.markers.own), profile: 'foot', mode: 'fastest', alternatives: 2, cpEveryM: 1000 }, () => {});
  assert.ok(rt.routes.length >= 1 && rt.routes[0].lengthM > 1000);
});
