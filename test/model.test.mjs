// ModelBuilder: toolbox, Map Algebra, executor (order, caching, failures) and the ready-made models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers/load-core.mjs';

const M = loadCore();
const syn = M.syntheticTerrain();
const { jobs } = M.createSession();
jobs.init({ grid: syn.grid }, () => {});
const ctx = { own: syn.markers.own, threat: syn.markers.threat, a: syn.markers.a, b: syn.markers.b, border: syn.border };
const run = (m, o) => jobs.modelRun(Object.assign({ model: m }, o || {}), () => {});

test('Map Algebra: Con, NoData, comparisons, %value% substitution; unsafe code is refused', () => {
  const f = M.compileExpr('Con("A" == 2, NoData, Con("A" == 1, 1.43, 1) * (1 + %W% * ("B" > 0)))', ['A', 'B'], { W: 6 });
  const R = [[0, 1, 2, 0], [0, 0, 0, 3]];
  assert.equal(f(R, 0), 1);
  assert.equal(f(R, 1), 1.43);
  assert.ok(Number.isNaN(f(R, 2)));
  assert.equal(f(R, 3), 7);
  assert.throws(() => M.compileExpr('alert(1)', [], {}));
  assert.throws(() => M.compileExpr('"A" = 3', ['A'], {}));
  assert.deepEqual(M.exprRefs('"Go / No-Go" + %Seen penalty%'), { rasters: ['Go / No-Go'], values: ['Seen penalty'] });
});

test('Reclassify remap table: ranges, names, NoData', () => {
  const rows = M.parseRemap('0 20 : 0 GO; 20 40 : 1 SLOW-GO; 40 90 : NoData');
  assert.equal(rows.length, 3);
  assert.equal(rows[1].name, 'SLOW-GO');
  assert.ok(Number.isNaN(rows[2].v));
  assert.throws(() => M.parseRemap('steep : 3'));
});

test('every ready-made model runs and produces its outputs', () => {
  for (const [id, t] of Object.entries(M.MODEL_TEMPLATES)) {
    const rep = run(t.build(ctx));
    assert.ok(!rep.failed, `${id}: ${JSON.stringify(Object.values(rep.tools).filter((x) => x.state === 'failed'))}`);
  }
});

test('least-cost route model gives the same time as the app route tool (fastest, foot)', () => {
  const m = M.MODEL_TEMPLATES.route.build(ctx);
  m.nodes.find((n) => n.id === 'expw').value = 0;
  const rep = run(m);
  const modelH = rep.vars.tbl.rows[0]['Time h'];
  jobs.settings({ own: ctx.own, threat: ctx.threat, threatProfile: 'foot' });
  const r = jobs.route({ a: ctx.a, b: ctx.b, profile: 'foot', mode: 'fastest', alternatives: 1, cpEveryM: 1000 }, () => {});
  assert.ok(Math.abs(r.routes[0].timeH - modelH) / modelH < 0.03, `model ${modelH} h vs route tool ${r.routes[0].timeH} h`);
});

test('changing a value re-runs only the tools downstream of it; a raised weight hides the route', () => {
  const m = M.MODEL_TEMPLATES.route.build(ctx);
  m.nodes.find((n) => n.id === 'eny').value = { r: Math.round(ctx.own.r), c: Math.round(ctx.own.c) }; // an OP that sees the route
  m.nodes.find((n) => n.id === 'expw').value = 0;
  const a = run(m);
  m.nodes.find((n) => n.id === 'expw').value = 20;
  const b = run(m);
  assert.equal(b.tools.t1.state, 'cached');
  assert.equal(b.tools.t3.state, 'cached');
  assert.equal(b.tools.t4.state, 'done');
  const seen = (r) => r.vars.tbl.rows[0]['% in enemy view'];
  assert.ok(seen(b) < seen(a), `exposure ${seen(a)}% -> ${seen(b)}%`);
  assert.ok(b.vars.tbl.rows[0]['Time h'] >= a.vars.tbl.rows[0]['Time h']);
});

test('failures: a missing input stops the model there, later tools are not run', () => {
  const m = M.MODEL_TEMPLATES.route.build(ctx);
  m.nodes.find((n) => n.id === 'b').value = null;
  const rep = run(m);
  assert.ok(rep.failed);
  assert.equal(rep.tools.t6.state, 'failed');
  assert.match(rep.tools.t6.msg, /End B/);
  assert.equal(rep.tools.t7.state, 'notrun');
  // a destination walled in by NoData cannot be reached
  const m2 = M.MODEL_TEMPLATES.route.build(ctx);
  m2.nodes.find((n) => n.id === 't4').values.expr = 'Con("Go / No-Go" >= 0, NoData, 1)';
  const r2 = run(m2);
  assert.equal(r2.tools.t5.state, 'failed');
  assert.match(r2.tools.t5.msg, /NoData/);
});

test('enemy approaches model: one path per reachable objective, named by its entry point', () => {
  const rep = run(M.MODEL_TEMPLATES.approaches.build(ctx));
  const L = rep.vars.appr.lines;
  assert.ok(L.length >= 3);
  for (const l of L) assert.match(l.from, /^E\d+$/);
  assert.equal(rep.vars.tbl.rows.length, L.length);
});
