/*
 * MtnEye core — ready-made models for ModelBuilder. Each is an ordinary model (variables + tools)
 * that the user can open, edit, re-wire and run; ctx supplies the current situation:
 * { own, threat, a, b, border } (cells / line in [c, r]).
 *
 * Node: { id, kind: 'data' | 'value' | 'derived' | 'tool', name, dt, value, src, P (model parameter),
 *         display (add to display), col, row, tool, inputs: {param: varId}, values: {param: literal}, outputs }
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function modelTemplates(M) {
  'use strict';

  const pt = (q, label) => (q ? { r: Math.round(q.r), c: Math.round(q.c), label } : null);
  // builders
  const D = (id, name, dt, col, row, o) => Object.assign({ id, kind: 'data', name, dt, col, row }, o || {});
  const V = (id, name, dt, value, col, row, o) => Object.assign({ id, kind: 'value', name, dt, value, col, row }, o || {});
  const O = (id, name, dt, col, row, o) => Object.assign({ id, kind: 'derived', name, dt, col, row }, o || {});
  const TL = (id, tool, name, col, row, inputs, outputs, values) => ({ id, kind: 'tool', tool, name, col, row, inputs, outputs, values: values || {} });
  const DEM = (col, row) => D('dem', 'DEM', 'raster', col, row, { src: 'dem' });
  // IPB terrain classification: GO below 30 % (16.7°), SLOW-GO 30–45 %, NO-GO 45 % (24.2°) or more
  const REMAP = '0 16.7 : 0 GO; 16.7 24.2 : 1 SLOW-GO; 24.2 90 : 2 NO-GO';
  // IPB: slope NO-GO slows foot movement (x %Steep-ground penalty%) but does not stop it; cliffs over 45° stay impassable
  const STEEP = 'Con("Go / No-Go" == 2, Con("Slope" <= 45, 1.43 * %Steep-ground penalty%, NoData), Con("Go / No-Go" == 1, 1.43, 1))';
  const FRICTION = STEEP;
  const PEN = (col, row) => V('pen4', 'Steep-ground penalty', 'number', 4, col, row, { P: true, note: 'IPB: NO-GO by slope (up to 45°) is crossed this many times slower, not avoided. Cliffs over 45° stay NoData.' });

  M.MODEL_TEMPLATES = {
    gonogo: {
      name: 'Go / No-Go (mobility)', question: 'Where can this kind of troops or vehicle move, move slowly, or not move at all?',
      build: () => ({
        nodes: [
          DEM(0, 0),
          TL('t1', 'slope', 'Slope', 1, 0, { dem: 'dem' }, { out: 'slope' }),
          O('slope', 'Slope', 'raster', 2, 0),
          V('remap', 'Slope classes', 'remap', REMAP, 2, 1, { P: true, note: 'Foot: GO ≤ 20°, SLOW-GO ≤ 40°. Jeep: 12 / 20. Tracked: 17 / 30.' }),
          TL('t2', 'reclassify', 'Reclassify', 3, 0, { in: 'slope', remap: 'remap' }, { out: 'gonogo' }),
          O('gonogo', 'Go / No-Go', 'raster', 4, 0, { display: true }),
        ],
      }),
    },

    route: {
      layout: {"eny": [0, 0], "radius": [1, 0.85], "t3": [2, 0], "vis": [3, 0], "expw": [4, 0.2], "dem": [0, 1.7], "t1": [1, 1.7], "slope": [2, 1.7], "remap": [2, 2.8], "t2": [3, 1.7], "gng": [4, 1.7], "t4": [5, 1.0], "cost": [6, 1.0], "a": [6, 2.0], "prof": [6, 2.9], "t5": [7, 1.9], "pd": [8, 1.3], "bl": [8, 2.5], "b": [8, 3.5], "t6": [9, 1.9], "route": [10, 1.9], "t7": [11, 1.9], "tbl": [12, 1.9]},
      name: 'Least-cost route A → B', question: 'What is the quickest way from A to B for this column, keeping out of enemy view as much as we choose?',
      build: (ctx) => ({
        nodes: [
          DEM(0, 1),
          V('a', 'Start A', 'point', pt(ctx.a || ctx.own, 'A'), 0, 3, { P: true }),
          V('b', 'End B', 'point', pt(ctx.b || ctx.threat, 'B'), 4, 4, { P: true }),
          V('eny', 'Enemy OP', 'point', pt(ctx.threat, 'ENY'), 0, 0, { P: true }),
          TL('t1', 'slope', 'Slope', 1, 1, { dem: 'dem' }, { out: 'slope' }),
          O('slope', 'Slope', 'raster', 2, 1),
          V('remap', 'Slope classes', 'remap', REMAP, 2, 2, { P: true }),
          TL('t2', 'reclassify', 'Reclassify', 3, 1, { in: 'slope', remap: 'remap' }, { out: 'gng' }),
          O('gng', 'Go / No-Go', 'raster', 4, 1),
          V('radius', 'Enemy view range (m)', 'number', 4000, 1, 0, { P: true }),
          TL('t3', 'viewshed', 'Viewshed', 2, 0, { dem: 'dem', obs: 'eny', radiusM: 'radius' }, { out: 'vis' }, { obsH: 2, tgtH: 1.5 }),
          O('vis', 'Enemy view', 'raster', 3, 0),
          V('expw', 'Exposure weight', 'number', 6, 4, 0, { P: true, note: '0 = fastest; 1.5 = balanced; 6 = covered (each seen cell costs 7× as much).' }),
          TL('t4', 'rasterCalc', 'Raster Calculator', 5, 1, {}, { out: 'cost' },
            { expr: `${STEEP} * (1 + %Exposure weight% * ("Enemy view" > 0))` }),
          O('cost', 'Cost raster', 'raster', 6, 1, { display: true }),
          PEN(5, 0.2),
          V('prof', 'Movement class', 'profile', 'foot', 6, 3, { P: true }),
          TL('t5', 'pathDistance', 'Path Distance', 7, 2, { src: 'a', cost: 'cost', dem: 'dem', profile: 'prof' }, { out: 'pd', back: 'bl' }),
          O('pd', 'Time from A', 'raster', 8, 1),
          O('bl', 'Backlink', 'raster', 8, 3),
          TL('t6', 'costPath', 'Cost Path', 9, 2, { dst: 'b', dist: 'pd', back: 'bl' }, { out: 'route' }),
          O('route', 'Least-cost route', 'lines', 10, 2, { display: true }),
          TL('t7', 'lineStats', 'Line Statistics', 11, 2, { lines: 'route', dem: 'dem', zone: 'vis' }, { out: 'tbl' }, { zoneName: '% in enemy view' }),
          O('tbl', 'Route table', 'table', 12, 2),
        ],
      }),
    },

    approaches: {
      layout: {"border": [0, 0], "spacing": [1, 0.9], "depth": [2, 0.9], "t1": [2, 0], "raw": [3, 0], "t5": [4, 0], "entries": [5, 0], "dem": [0, 2.2], "t2": [1, 2.2], "slope": [2, 2.2], "remap": [2, 3.3], "t3": [3, 2.2], "gng": [4, 2.2], "t4": [5, 2.2], "cost": [6, 2.2], "prof": [6, 1.2], "t6": [7, 1.2], "pd": [8, 0.5], "bl": [8, 1.4], "al": [8, 2.3], "own": [0, 4.2], "t7": [2, 4.2], "side": [3, 4.2], "nobj": [3, 5.2], "t8": [4, 4.2], "obj": [5, 4.2], "t9": [9, 3.3], "foot": [10, 3.3], "t10": [11, 1.4], "appr": [12, 1.4], "t11": [2, 6.4], "ownview": [3, 6.4], "t12": [13, 1.4], "tbl": [14, 1.4]},
      name: 'Enemy approaches across the border', question: 'From where across the border can the enemy reach each of our dominating heights fastest, and how much of each way do we see?',
      build: (ctx) => ({
        nodes: [
          V('border', 'Border line', 'line', ctx.border || null, 0, 0, { P: true }),
          V('own', 'Own position', 'point', pt(ctx.own, 'OWN'), 0, 2, { P: true }),
          DEM(0, 4),
          V('spacing', 'Entry spacing (m)', 'number', 1500, 0, 1, { P: true }),
          V('depth', 'Entry depth (m)', 'number', 1500, 1, 1, { P: true }),
          TL('t1', 'pointsAlongLine', 'Generate Points Along Line', 2, 0, { line: 'border', spacingM: 'spacing', offsetM: 'depth', ref: 'own' }, { out: 'raw' }, { prefix: 'E' }),
          O('raw', 'Candidate entries', 'points', 3, 0),
          TL('t2', 'slope', 'Slope', 1, 4, { dem: 'dem' }, { out: 'slope' }),
          O('slope', 'Slope', 'raster', 2, 4),
          V('remap', 'Slope classes', 'remap', REMAP, 2, 5, { P: true }),
          TL('t3', 'reclassify', 'Reclassify', 3, 4, { in: 'slope', remap: 'remap' }, { out: 'gng' }),
          O('gng', 'Go / No-Go', 'raster', 4, 4),
          TL('t4', 'rasterCalc', 'Raster Calculator', 5, 4, {}, { out: 'cost' }, { expr: FRICTION }),
          PEN(5, 3.1),
          O('cost', 'Cost raster', 'raster', 6, 4),
          TL('t5', 'snapPoints', 'Snap Points to Valid Cells', 4, 0, { in: 'raw', ras: 'cost' }, { out: 'entries' }, { radiusM: 400 }),
          O('entries', 'Entry points', 'points', 5, 0, { display: true }),
          V('prof', 'Movement class', 'profile', 'foot', 6, 2, { P: true }),
          TL('t6', 'pathDistance', 'Path Distance', 7, 2, { src: 'entries', cost: 'cost', dem: 'dem', profile: 'prof' }, { out: 'pd', back: 'bl', alloc: 'al' }),
          O('pd', 'Time from border', 'raster', 8, 1, { display: true }),
          O('bl', 'Backlink', 'raster', 8, 2),
          O('al', 'Nearest entry', 'raster', 8, 3),
          TL('t7', 'borderSide', 'Side of Line', 2, 2, { line: 'border', ref: 'own' }, { out: 'side' }),
          O('side', 'Own side', 'raster', 3, 2),
          V('nobj', 'Number of objectives', 'number', 6, 3, 3, { P: true }),
          TL('t8', 'findPeaks', 'Find Dominating Heights', 4, 2, { dem: 'dem', mask: 'side', count: 'nobj' }, { out: 'obj' }, { radiusM: 500, prefix: 'OBJ ' }),
          O('obj', 'Objectives', 'points', 5, 2, { display: true }),
          TL('t9', 'snapPoints', 'Snap Points to Valid Cells', 9, 1, { in: 'obj', ras: 'pd' }, { out: 'foot' }, { radiusM: 1200 }),
          O('foot', 'Foot of objective', 'points', 10, 1),
          TL('t10', 'costPath', 'Cost Path', 11, 2, { dst: 'foot', dist: 'pd', back: 'bl', alloc: 'al' }, { out: 'appr' }),
          O('appr', 'Enemy approaches', 'lines', 12, 2, { display: true }),
          TL('t11', 'viewshed', 'Viewshed', 1, 3, { dem: 'dem', obs: 'own' }, { out: 'ownview' }, { obsH: 2, tgtH: 1.5, radiusM: 4000 }),
          O('ownview', 'Own view', 'raster', 2, 3),
          TL('t12', 'lineStats', 'Line Statistics', 13, 2, { lines: 'appr', dem: 'dem', zone: 'ownview' }, { out: 'tbl' }, { zoneName: '% seen by us' }),
          O('tbl', 'Approach table', 'table', 14, 2),
        ],
      }),
    },

    infiltration: {
      layout: {"own": [0, 0], "t3": [2, 0], "seen": [3, 0], "pen": [4, 0.2], "dem": [0, 1.7], "t1": [1, 1.7], "slope": [2, 1.7], "remap": [2, 2.8], "t2": [3, 1.7], "gng": [4, 1.7], "t4": [5, 1.0], "cost": [6, 1.0], "start": [6, 2.2], "t5": [7, 1.9], "pd": [8, 1.3], "bl": [8, 2.5], "tgt": [8, 3.5], "t6": [9, 1.9], "route": [10, 1.9], "t7": [11, 1.9], "tbl": [12, 1.9]},
      name: 'Hidden (infiltration) route', question: 'Which way would a small party take to reach a target while staying out of our sight?',
      build: (ctx) => ({
        nodes: [
          DEM(0, 1),
          V('start', 'Infiltrator start', 'point', pt(ctx.threat, 'START'), 0, 3, { P: true }),
          V('tgt', 'Target', 'point', pt(ctx.own, 'TGT'), 8, 4, { P: true }),
          V('own', 'Own OP', 'point', pt(ctx.own, 'OP'), 0, 0, { P: true }),
          TL('t1', 'slope', 'Slope', 1, 1, { dem: 'dem' }, { out: 'slope' }),
          O('slope', 'Slope', 'raster', 2, 1),
          V('remap', 'Slope classes', 'remap', REMAP, 2, 2, { P: true }),
          TL('t2', 'reclassify', 'Reclassify', 3, 1, { in: 'slope', remap: 'remap' }, { out: 'gng' }),
          O('gng', 'Go / No-Go', 'raster', 4, 1),
          TL('t3', 'viewshed', 'Viewshed', 1, 0, { dem: 'dem', obs: 'own' }, { out: 'seen' }, { obsH: 2, tgtH: 1.5, radiusM: 3000 }),
          O('seen', 'Own view', 'raster', 2, 0),
          V('pen', 'Seen penalty', 'number', 6, 4, 0, { P: true, note: 'Each cell we can see costs (1 + penalty) times as much — the path hides.' }),
          TL('t4', 'rasterCalc', 'Raster Calculator', 5, 1, {}, { out: 'cost' },
            { expr: `${STEEP} * (1 + %Seen penalty% * ("Own view" > 0))` }),
          O('cost', 'Cost raster', 'raster', 6, 1, { display: true }),
          PEN(5, 0.2),
          TL('t5', 'pathDistance', 'Path Distance', 7, 2, { src: 'start', cost: 'cost', dem: 'dem' }, { out: 'pd', back: 'bl' }, { profile: 'foot' }),
          O('pd', 'Time from start', 'raster', 8, 1),
          O('bl', 'Backlink', 'raster', 8, 3),
          TL('t6', 'costPath', 'Cost Path', 9, 2, { dst: 'tgt', dist: 'pd', back: 'bl' }, { out: 'route' }),
          O('route', 'Hidden route', 'lines', 10, 2, { display: true }),
          TL('t7', 'lineStats', 'Line Statistics', 11, 2, { lines: 'route', dem: 'dem', zone: 'seen' }, { out: 'tbl' }, { zoneName: '% seen by us' }),
          O('tbl', 'Route table', 'table', 12, 2),
        ],
      }),
    },

    ops: {
      name: 'Observation posts (maximize coverage)', question: 'Where should a few OPs go so together they see the most ground the enemy can move on?',
      build: (ctx) => ({
        nodes: [
          DEM(0, 1),
          TL('t1', 'slope', 'Slope', 1, 1, { dem: 'dem' }, { out: 'slope' }),
          O('slope', 'Slope', 'raster', 2, 1),
          V('maxs', 'Max OP slope (°)', 'number', 30, 2, 0, { P: true }),
          TL('t2', 'rasterCalc', 'Raster Calculator', 3, 0, {}, { out: 'ok' }, { expr: 'Con("Slope" <= %Max OP slope (°)%, 1, NoData)' }),
          O('ok', 'Usable OP ground', 'raster', 4, 0),
          TL('t3', 'findPeaks', 'Find Dominating Heights', 5, 0, { dem: 'dem', mask: 'ok' }, { out: 'cand' }, { radiusM: 300, count: 40, prefix: 'C' }),
          O('cand', 'OP candidates', 'points', 6, 0, { display: true }),
          V('remap', 'Enemy slope classes', 'remap', REMAP, 2, 2, { P: true }),
          TL('t4', 'reclassify', 'Reclassify', 3, 2, { in: 'slope', remap: 'remap' }, { out: 'gng' }),
          O('gng', 'Enemy Go / No-Go', 'raster', 4, 2),
          TL('t5', 'rasterCalc', 'Raster Calculator', 5, 2, {}, { out: 'dem2' }, { expr: 'Con("Enemy Go / No-Go" == 0, 1, Con("Enemy Go / No-Go" == 1, 0.5, 0))' }),
          O('dem2', 'Ground worth watching', 'raster', 6, 2),
          V('n', 'Number of OPs', 'number', 5, 6, 1, { P: true }),
          V('range', 'OP range (m)', 'number', 3000, 7, 3, { P: true }),
          TL('t6', 'maxCoverage', 'Maximize Coverage', 7, 1, { cand: 'cand', dem: 'dem', demand: 'dem2', count: 'n', radiusM: 'range' }, { out: 'ops', cover: 'cov' }, { obsH: 2 }),
          O('ops', 'OPs', 'points', 8, 0, { display: true }),
          O('cov', 'Coverage', 'raster', 8, 2, { display: true }),
        ],
      }),
    },
  };
  // apply each template's layout (col / row per element) after it is built
  Object.values(M.MODEL_TEMPLATES).forEach((t) => {
    if (!t.layout) return;
    const build = t.build;
    t.build = (ctx) => { const m = build(ctx); m.nodes.forEach((n) => { const q = t.layout[n.id]; if (q) { n.col = q[0]; n.row = q[1]; } }); return m; };
  });
  /** GP tool id -> template that shows how it is built. */
  M.MODEL_FOR_TOOL = { mobility: 'gonogo', route: 'route', avenues: 'route', enemyApproaches: 'approaches', sectorAll: 'approaches', infiltration: 'infiltration', posts: 'ops' };
});
