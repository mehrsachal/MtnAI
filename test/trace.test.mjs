// Screening traces behind the Model view: every point tested is either passed or counted under a reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers/load-core.mjs';

const M = loadCore();
const syn = M.syntheticTerrain();
const { jobs } = M.createSession();
jobs.init({ grid: syn.grid }, () => {});
const snap = (p) => ({ r: p.r, c: p.c });
jobs.settings({ own: snap(syn.markers.own), threat: snap(syn.markers.threat), threatProfile: 'foot', sector: syn.sector, border: syn.border });
const none = () => {};
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('posts: tested = passed + rejected, and candidates are a subset of the passed points', () => {
  const r = jobs.posts({ count: 4 }, none);
  const t = r.trace;
  assert.ok(t.tested > 1000);
  assert.equal(t.tested, t.passed + sum(t.rejected));
  assert.ok(t.candidates.length > 0 && t.candidates.length <= t.passed);
  assert.ok(Object.keys(t.rejected).some((k) => /slope/.test(k)));
});

test('helipads and key terrain report why ground was rejected', () => {
  const h = jobs.helipads({ use: 'regular' }, none).trace;
  assert.equal(h.tested, h.passed + sum(h.rejected));
  const k = jobs.keyTerrain({});
  assert.equal(k.trace.peaksKept, k.peaks.length);
  assert.equal(k.trace.localMax, k.trace.lowProm + k.trace.notHighest + k.trace.peaksFound);
});

test('enemy approaches: per-objective counts add up to the approaches kept', () => {
  jobs.sectorTerrain({});
  jobs.itgs({}, none);
  const a = jobs.enemyApproaches({}, none);
  const t = a.trace;
  assert.ok(t.entries > 0 && t.entries <= t.stations);
  assert.equal(t.perObjective.reduce((s, o) => s + o.kept, 0), a.approaches.length);
  for (const o of t.perObjective) if (o.reachable) assert.equal(o.reached, o.kept + o.tooClose + o.noPath + o.duplicate + o.spare);
});
