/*
 * MtnEye ui — "How was this found?": a ModelBuilder-style Model view for each tool and a
 * step-by-step Brief mode on the map.
 *
 * Every tool has one spec: the question it answers, its steps as a flow (inputs → process →
 * outputs) with this run's numbers and the reasons ground was thrown out, how to read the
 * result, what an empty or failed result means, and a script for briefing a senior. The same
 * specs drive the printable briefing book (Print / PDF).
 */
(function (UI) {
  'use strict';
  const X = (UI.Explain = {});
  const F = UI.F, GP = UI.GP;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;
  const km = (m) => F.dist(m);
  const hrs = (h) => F.time(h);
  const n = (x) => (x === undefined || x === null ? '—' : Math.round(x).toLocaleString('en-GB'));
  const pv = (id, k) => { try { return GP.values(id)[k]; } catch (e) { return undefined; } };
  const sumObj = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  /** Rejection lines from a screening trace, largest first. */
  const rejOf = (tr) => (tr ? Object.entries(tr.rejected || {}).sort((a, b) => b[1] - a[1]).map(([why, k]) => [k, why]) : []);
  const pts = (list, s, lab) => (list || []).map((q, k) => ({ t: 'pt', c: q.c, r: q.r, s, label: lab ? lab(q, k) : '' }));
  const lines = (list, s, lab) => (list || []).map((q, k) => ({ t: 'line', pts: q.line || q, s, label: lab ? lab(q, k) : '' }));
  const rateS = (rt) => (rt === 'Good' ? 'ok' : rt === 'Marginal' ? 'mid' : 'bad');
  const mk = (S, k) => S.markers && S.markers[k];

  // =====================================================================
  // Tool specs
  // =====================================================================
  /*
   * node: { id, k: 'in' | 'step' | 'out', col, t: title, v: this run's numbers, d: plain description,
   *         rej: [[count, reason]], from: [node ids], map: { show: [layer flags], ovl: [overlays], geo: [...] } }
   */
  const SPECS = [];
  const spec = (o) => { SPECS.push(o); return o; };

  // ------------------------------------------------------------- Go / No-Go
  spec({
    id: 'mobility', gp: ['mobility'], group: 'Ground', title: 'Go / No-Go (mobility)',
    q: 'Where can this kind of troops or vehicle move freely, move slowly, or not move at all?',
    result: (S) => (S.overlays.mobility.data && S.mobStats[S.overlays.mobility.profile] ? { stats: S.mobStats[S.overlays.mobility.profile], prof: S.overlays.mobility.info || {} } : null),
    nodes: (r, S) => [
      { id: 'dem', k: 'in', col: 0, t: 'Elevation model', v: S.grid ? `${S.grid.w} × ${S.grid.h} cells, ${S.grid.cs} m each` : '—', d: 'The height of the ground in a grid of small squares (cells).' },
      { id: 'prof', k: 'in', col: 0, t: 'Movement class', v: r ? `${r.prof.name}: GO ≤ ${r.prof.go}°, SLOW ≤ ${r.prof.slow}°` : '—', d: 'Who is moving: foot, mules, wheels or tracks. Each has its own slope limits.' },
      { id: 'slope', k: 'step', col: 1, from: ['dem'], t: 'Measure the slope of every cell', v: S.grid ? `${n(S.grid.w * S.grid.h)} cells measured` : '—', d: 'Slope = how steep the ground is, in degrees, from the heights of the cell and its neighbours.' },
      { id: 'cls', k: 'step', col: 2, from: ['slope', 'prof'], t: 'Compare each slope with the limits', v: r ? `≤ ${r.prof.go}° GO · ≤ ${r.prof.slow}° SLOW-GO · steeper NO-GO` : '—', d: 'Not steeper than the GO limit: GO. Up to the SLOW limit: SLOW-GO. Steeper, or water, snow above the snow line, or a drawn obstacle: NO-GO.', map: { ovl: ['mobility'] } },
      { id: 'out', k: 'out', col: 3, from: ['cls'], t: 'Go / No-Go map', v: r ? `GO ${pct(r.stats.go)} · SLOW ${pct(r.stats.slow)} · NO-GO ${pct(r.stats.nogo)}` : '—', d: 'Green = GO, yellow = SLOW-GO, red = NO-GO.', map: { ovl: ['mobility'] }, shot: true },
    ],
    read: () => ['Green ground can be crossed at normal speed, yellow only slowly, red not at all by this class.', 'Run it again for another class: ground that is NO-GO for vehicles is often GO for foot.'],
    none: [['Almost all red', 'The limits are low for this terrain, or the snow line is set too low.', 'Choose foot or mules, or raise the snow line (Settings).'], ['Almost all green', 'Flat area, or the DEM is coarse and smooths out the slopes.', 'Use a finer DEM (30 m or better).']],
    brief: (r) => r ? [`This map shows where ${r.prof.name.toLowerCase()} can move.`, `Ground up to ${r.prof.go}° is GO, up to ${r.prof.slow}° is slow, steeper is NO-GO.`, `Here ${pct(r.stats.go)} of the area is GO and ${pct(r.stats.nogo)} is NO-GO.`] : [],
  });

  // ------------------------------------------------------------- Key terrain
  spec({
    id: 'keyTerrain', gp: ['keyTerrain'], group: 'Ground', title: 'Key terrain (heights and passes)',
    q: 'Which heights dominate the area, and where are the passes (cols) between them?',
    result: (S) => S.key || null,
    nodes: (r, S) => {
      const t = r && r.trace;
      return [
        { id: 'dem', k: 'in', col: 0, t: 'Elevation model', v: S.grid ? `${S.grid.w} × ${S.grid.h} cells` : '—', d: 'Heights of the ground.' },
        { id: 'tops', k: 'step', col: 1, from: ['dem'], t: 'Find hill tops', v: t ? `${n(t.localMax)} cells higher than all 8 neighbours` : '—', d: 'A hill top is a cell higher than every cell around it.' },
        { id: 'prom', k: 'step', col: 2, from: ['tops'], t: 'Keep only commanding tops', v: t ? `${n(t.peaksFound)} tops kept` : '—', rej: t ? [[t.lowProm, 'not much higher than the ground around'], [t.notHighest, `a higher point within ${km(t.peakRadiusM)}`]] : [],
          d: 'A top must stand well above its surroundings and be the highest point within the search radius.', map: { geo: (rr) => pts(rr.peaks, 'cand') } },
        { id: 'peaks', k: 'out', col: 3, from: ['prom'], t: 'Dominating heights', v: r ? `${r.peaks.length} heights (best first)` : '—', d: 'Ranked by how far they stand above the ground around them and by height.', map: { geo: (rr) => pts(rr.peaks, 'key', (q, k) => `H${k + 1}`) }, shot: true },
        { id: 'sad', k: 'step', col: 1, from: ['dem'], t: 'Look for saddles', v: t ? `${n(t.passTested)} points tested` : '—', rej: t ? [[t.passFlat, 'slope over 22° (not a crossing)'], [t.passShape, `not high on two sides and low on two sides by ${Math.round(t.reliefM)} m`]] : [],
          d: 'A pass is low between two higher sides and high between two lower sides — like a horse saddle.' },
        { id: 'passes', k: 'out', col: 3, from: ['sad'], t: 'Passes / cols', v: r ? `${r.passes.length} passes` : '—', d: 'Spaced at least 700 m apart, best first.', map: { geo: (rr) => pts(rr.passes, 'mid', (q, k) => `PS${k + 1}`) } },
      ];
    },
    read: () => ['▲ marks a dominating height; )( marks a pass.', 'Heights see and command the ground; passes are where movement is forced through.'],
    none: [['No heights', 'Flat or gently rolling area.', 'Lower “minimum dominance” in the tool.'], ['No passes', 'No saddle shape stands out by the relief set.', 'Lower “pass relief” in the tool.']],
    brief: (r) => r ? [`The tool looked at every hill top and kept those that stand clearly above the ground around them: ${r.peaks.length} dominating heights.`, `It also looked for saddle shapes between heights: ${r.passes.length} passes, where movement is channelled.`] : [],
  });

  // ------------------------------------------------------------- Enemy observation
  spec({
    id: 'hostile', gp: ['hostile'], group: 'Enemy', title: 'Enemy observation',
    q: 'Which of our ground can the enemy see from his likely OPs?',
    result: (S) => (S.hostile && S.overlays.hostile.data ? S.hostile : null),
    nodes: (r, S) => {
      const ops = r ? r.observers.filter((o) => !o.isThreat) : [];
      let seen = 0, tot = 0;
      if (r) { const d = S.overlays.hostile.data; tot = d.length; for (let i = 0; i < d.length; i++) if (d[i]) seen++; }
      return [
        { id: 'eny', k: 'in', col: 0, t: 'Enemy position', v: mk(S, 'threat') ? F.listRef(mk(S, 'threat').r, mk(S, 'threat').c) : 'not placed', d: 'Where the enemy is, placed by you.', map: { geo: () => [] } },
        { id: 'pick', k: 'step', col: 1, from: ['eny'], t: 'Pick his likely OPs', v: r ? `${ops.length} OPs on the most commanding ground within ${km(+pv('hostile', 'searchRadiusM') || 0)}` : '—', d: 'An OP goes where the ground is highest compared with its surroundings, near the enemy, spaced apart.', map: { geo: () => pts(ops, 'enemy', (q, k) => `EOP${k + 1}`) } },
        { id: 'vs', k: 'step', col: 2, from: ['pick'], t: 'Viewshed from each OP', v: r ? `range ${km(+pv('hostile', 'rangeM') || 0)}` : '—', d: 'From each OP, draw a straight line to every cell; if the ground blocks the line, the cell is hidden.' },
        { id: 'out', k: 'out', col: 3, from: ['vs'], t: 'Ground the enemy sees', v: r ? `${pct(seen / (tot || 1))} of the area is seen` : '—', d: 'Shaded = seen by at least one enemy OP. Unshaded = defilade (hidden).', map: { ovl: ['hostile'], geo: () => pts(ops, 'enemy') }, shot: true },
      ];
    },
    read: () => ['Shaded ground is seen by the enemy: move there by night or under cover.', 'Unshaded ground is hidden from him: good for HQs, mortars, routes and admin.'],
    none: [['Nothing shaded', 'The enemy sits low with ridges between.', 'Check the enemy position; add more OPs or a longer range in the tool.'], ['Fails: “Place the enemy”', 'No enemy position on the map.', 'Place it with Points ▸ Enemy.']],
    brief: (r) => r ? [`We assumed the enemy puts OPs on the ${r.observers.filter((o) => !o.isThreat).length} most commanding points near him.`, 'From each we checked, cell by cell, whether the ground blocks the view.', 'Shaded ground is what he can see; unshaded is hidden from him.'] : [],
  });

  // ------------------------------------------------------------- Avenues
  spec({
    id: 'avenues', gp: ['avenues'], group: 'Enemy', title: 'Enemy avenues of approach',
    q: 'Which ways can the enemy come to our position fastest?',
    result: (S) => (S.avenues && S.avenues.routes ? S.avenues : null),
    nodes: (r, S) => [
      { id: 'eny', k: 'in', col: 0, t: 'Enemy position', v: mk(S, 'threat') ? F.listRef(mk(S, 'threat').r, mk(S, 'threat').c) : 'not placed', d: 'Start of every avenue.' },
      { id: 'own', k: 'in', col: 0, t: 'Own position', v: mk(S, 'own') ? F.listRef(mk(S, 'own').r, mk(S, 'own').c) : 'not placed', d: 'End of every avenue.' },
      { id: 'mob', k: 'step', col: 1, from: ['eny', 'own'], t: 'Go / No-Go for the enemy', v: pv('avenues', 'threatType') || '—', d: 'Each cell gets a walking or driving time from its slope; NO-GO cells cannot be crossed.' },
      { id: 'fast', k: 'step', col: 2, from: ['mob'], t: 'Fastest path (least time)', v: r && r.routes[0] ? `AA1: ${km(r.routes[0].lengthM)}, ${hrs(r.routes[0].timeH)}` : '—', d: 'The computer tries paths cell by cell and keeps the one with the least total time.', map: { geo: (rr) => lines(rr.routes.slice(0, 1), 'enemy', () => 'AA1') } },
      { id: 'alt', k: 'step', col: 3, from: ['fast'], t: 'Other, separate ways', v: r ? (r.routes.length > 1 ? `${r.routes.length - 1} more, each ≥ ${km(+pv('avenues', 'separationM') || 0)} from the others` : 'none — no separate way exists') : '—', d: 'The used path is made expensive and the search runs again, so the next route takes different ground.' },
      { id: 'out', k: 'out', col: 4, from: ['alt'], t: 'Avenues of approach', v: r ? r.routes.map((x, k) => `AA${k + 1} ${hrs(x.timeH)}`).join(' · ') : '—', d: 'Red dashed lines, fastest first.', map: { ovl: ['avenues'], geo: (rr) => lines(rr.routes, 'enemy', (q, k) => `AA${k + 1}`) }, shot: true },
    ],
    read: () => ['AA1 is the fastest way for the enemy; the others are real alternatives on different ground.', 'The shaded band shows where each avenue runs: watch and cover these by fire.'],
    none: [['No avenue', 'Vehicles cannot connect the two points (NO-GO in between).', 'Switch to foot, or move the points onto passable ground.'], ['Only one avenue', 'The ground forces everything through one valley or pass.', 'That itself is the answer: a single defile — block it.']],
    brief: (r) => r ? [`The computer gave every cell a crossing time from its slope, then found the quickest way from the enemy to us: AA1, ${hrs(r.routes[0].timeH)}.`, `It then blocked that path and searched again to get ${r.routes.length - 1} more avenues on different ground.`] : [],
  });

  // ------------------------------------------------------------- Posts / OPs
  const sitingNodes = (o) => (r, S) => {
    const t = r && r.trace;
    const out = [
      { id: 'in', k: 'in', col: 0, t: o.inT, v: o.inV(S), d: o.inD },
      { id: 'screen', k: 'step', col: 1, from: ['in'], t: 'Screen every sample point', v: t ? `${n(t.tested)} points tested → ${n(t.passed)} pass` : '—', rej: rejOf(t), d: o.screenD },
      { id: 'short', k: 'step', col: 2, from: ['screen'], t: 'Shortlist the best placed', v: t ? `${t.candidates.length} candidates` : '—', d: o.shortD, map: { geo: () => pts(t ? t.candidates : [], 'cand') }, shot: true },
      { id: 'score', k: 'step', col: 3, from: ['short'], t: o.scoreT, v: t ? `${t.candidates.length} tested` : '—', d: o.scoreD, map: { geo: () => pts(t ? t.candidates : [], 'cand') } },
      { id: 'pick', k: 'step', col: 4, from: ['score'], t: 'Pick best first, then what adds most', v: r ? `${o.list(r).length} chosen` : '—', d: o.pickD, map: { geo: () => pts(t ? t.candidates : [], 'cand').concat(pts(r ? o.list(r) : [], 'ok', (q) => q.id)) } },
      { id: 'out', k: 'out', col: 5, from: ['pick'], t: o.outT, v: r ? o.outV(r) : '—', d: o.outD, map: o.outMap, shot: true },
    ];
    if (t && t.accessRelaxed) out[1].rej.unshift(['!', 'no site was reachable — the access rule was relaxed']);
    return out;
  };
  spec({
    id: 'posts', gp: ['posts'], group: 'Own', title: 'Posts and OPs',
    q: 'Where should posts / OPs go so together they see the most of the ground the enemy must use?',
    result: (S) => S.posts || null,
    nodes: sitingNodes({
      inT: 'Own and enemy positions, Go / No-Go', inV: (S) => `${mk(S, 'own') ? 'own ✓' : 'own —'} · ${mk(S, 'threat') ? 'enemy ✓' : 'enemy —'}`, inD: 'Posts stay near own troops and away from the enemy; approach ground matters most.',
      screenD: 'Throw out every point that is too steep, wrong type of ground (e.g. valley floor), cannot be reached, too far from own troops or too close to the enemy.',
      shortD: 'Of what is left, keep the highest and most commanding points, spaced apart.',
      scoreT: 'Viewshed from each candidate', scoreD: 'For each candidate, find every cell it can see. Ground the enemy must walk or drive across counts most; nearer ground counts more.',
      pickD: 'Take the candidate that sees the most valuable ground. Then take the one that adds the most ground not already seen. Repeat.',
      list: (r) => r.posts, outT: 'Posts / OPs', outV: (r) => `${r.posts.length} sites see ${pct(r.coverageShare)} of approach ground`, outD: 'Shaded = seen by the posts. Hatched = dead ground inside their range that nobody sees.',
      outMap: { show: ['posts'], ovl: ['cover', 'dead'] },
    }),
    read: (r) => ['Each symbol is a post; the shading is what they see together.', 'Hatched dead ground needs patrols, an LP or mines.', r && r.links ? `${r.links.length} pairs of posts can see each other (mutual support).` : ''],
    none: [['Fails: “No suitable post candidates”', 'Every point failed the screen — the message lists how many were thrown out for each reason.', 'Relax the reason with the biggest number (e.g. raise the slope limit or the distance from own).'], ['Low coverage', 'The ground is broken; few points see far.', 'Add more posts, or accept and cover the dead ground.']],
    brief: (r) => r && r.trace ? [`${n(r.trace.tested)} points were checked; ${n(r.trace.passed)} passed the basic rules${rejOf(r.trace)[0] ? ` — the main reason for rejection was “${rejOf(r.trace)[0][1]}” (${n(rejOf(r.trace)[0][0])})` : ''}.`, `The ${r.trace.candidates.length} best placed were tested by working out what each can actually see.`, `The computer then picked ${r.posts.length} that together see ${pct(r.coverageShare)} of the ground the enemy must use.`] : [],
  });

  // ------------------------------------------------------------- Weapon sites
  spec({
    id: 'weapons', gp: ['weapons'], group: 'Own', title: 'Weapon sites',
    q: 'Where should this weapon go to cover the enemy approaches (direct fire) or reach the target from hidden ground (indirect fire)?',
    result: (S) => { const id = X.lastWeapon; const w = (id && S.weapons.find((x) => x.weapon.id === id)) || S.weapons[S.weapons.length - 1]; return w || null; },
    nodes: (r, S) => {
      const ind = r && r.weapon.cat === 'indirect';
      return sitingNodes({
        inT: r ? r.weapon.name : 'Weapon', inV: () => (r ? (ind ? `range ${km(r.weapon.minR)}–${km(r.weapon.maxR)}` : `effective ${km(r.weapon.maxR || 0)}`) : '—'), inD: 'The weapon’s range and siting slope limit come from the weapon table.',
        screenD: ind ? 'Throw out points that are too steep, cannot be reached, can be seen by the enemy (if defilade is required), are out of range of the target, or are too far forward.' : 'Throw out points that are too steep for the weapon, on ground it cannot use, cannot be reached, or outside the defended area.',
        shortD: 'Of what is left, keep the best placed points, spaced apart.',
        scoreT: ind ? 'Check the crest and range' : 'Field of fire from each candidate',
        scoreD: ind ? 'Can the shell clear the crest in front on its way to the target, and is the site hidden from the enemy?' : 'For each candidate, find the ground it can hit. Ground the enemy must cross counts most.',
        pickD: 'Take the best site, then the one that adds the most new cover. Repeat.',
        list: (x) => x.sites, outT: 'Weapon sites', outV: (x) => `${x.sites.length} sites`, outD: ind ? 'Each site with its range to the target.' : 'Each site with its arc of fire; shading = fields of fire.',
        outMap: { show: ['weapons'], ovl: ind ? [] : ['wcover'] },
      })(r, S);
    },
    read: () => ['Each symbol is a weapon site with its arc (direct fire) or range to target (indirect).', 'Sites marked “hidden” cannot be seen from the enemy side.'],
    none: [['Fails: “No suitable weapon site candidates”', 'Every point failed the screen — the message lists the reasons, biggest first.', 'Relax the biggest reason: more slope, larger defended radius, or untick “require defilade”.'], ['Fails: “indirect fire needs a target”', 'No enemy or target point.', 'Place Points ▸ Target or Enemy.']],
    brief: (r) => r && r.trace ? [`For the ${r.weapon.name} the computer checked ${n(r.trace.tested)} points and kept ${n(r.trace.passed)} that the weapon can use.`, `It tested the best ${r.trace.candidates.length} and chose ${r.sites.length} sites that together cover the most of the enemy’s ground.`] : [],
  });

  // ------------------------------------------------------------- Minefields
  spec({
    id: 'mfd', gp: ['mfd'], group: 'Own', title: 'Minefields',
    q: 'Where would a minefield cost the enemy the most time on his way to us?',
    result: (S) => S.mfd || null,
    nodes: (r, S) => {
      const t = r && r.trace, ap = r && r.purpose === 'protective';
      const cands = t ? t.candidates : [];
      const good = cands.filter((q) => q.blocks || (q.delayMin || 0) >= (r.params.minDelayMin || 5)).length;
      return [
        { id: 'in', k: 'in', col: 0, t: 'Own and enemy positions', v: r ? `${r.fields[0] ? r.fields[0].type : ''} · ${ap ? 'protective' : 'barrier'}` : '—', d: 'AT = anti-tank (on vehicle routes, a barrier); AP = anti-personnel (protective, close in front of own troops).' },
        { id: 'aven', k: 'step', col: 1, from: ['in'], t: 'Enemy’s fastest ways in', v: r ? `${r.avenues.length} avenues · best ${hrs(r.enemyBefore.timeH)}` : '—', d: 'Least-time routes from the enemy to us for his vehicles (AT) or men on foot (AP).', map: { geo: (rr) => lines(rr.avenues, 'thin').concat(lines([rr.enemyBefore], 'enemy', () => 'enemy now')) } },
        { id: 'def', k: 'step', col: 2, from: ['aven'], t: ap ? 'Sites in front of own troops' : 'Find defiles on those routes', v: t ? `${t.defiles} sites found · ${t.inBand} in the distance band → best ${cands.length} shortlisted` : '—', rej: t ? [[t.defiles - cands.length, 'weaker site, or next to a better one']] : [], d: ap ? 'Points 80–800 m in front of posts, across the foot approaches.' : 'A defile is a narrow gap between NO-GO ground — the cheapest place to block.', map: { geo: () => pts(cands, 'cand') }, shot: true },
        { id: 'test', k: 'step', col: 3, from: ['def'], t: 'Test each: mine it, re-route the enemy', v: t ? `${cands.length} tested · ${good} delay ≥ ${r.params.minDelayMin} min` : '—', rej: t ? [[cands.length - good, `delay under ${r.params.minDelayMin} min — he just walks round`]] : [],
          d: 'Pretend the site is mined, then let the enemy find his new fastest way. The extra time is what the field is worth.',
          map: { geo: () => cands.map((q) => ({ t: 'pt', c: q.c, r: q.r, s: q.blocks || (q.delayMin || 0) >= r.params.minDelayMin ? 'mid' : 'bad', label: q.blocks ? 'blocks' : q.delayMin === null ? '' : `+${Math.round(q.delayMin)}′` })) } },
        { id: 'pick', k: 'step', col: 4, from: ['test'], t: 'Pick biggest delay, re-test the rest', v: r ? `${r.fields.length} fields chosen (up to ${r.params.count})` : '—', rej: r && t ? [[good - r.fields.length, r.fields.length >= r.params.count ? `not needed — the plan asks for ${r.params.count} fields` : 'no longer worth it once the enemy re-routed round earlier fields, or too close to one']] : [], d: 'Lay the best field, then test again — the enemy now goes a different way, so the next field must work against that.' },
        { id: 'out', k: 'out', col: 5, from: ['pick'], t: 'Minefields', v: r ? `${r.fields.length} fields` : '—', d: 'Rated by delay, fire cover and distance from own troops.', map: { show: ['mfd'] }, shot: true },
        { id: 'time', k: 'out', col: 5, from: ['pick'], t: 'Enemy time before → after', v: r ? `${hrs(r.enemyBefore.timeH)} → ${hrs(r.enemyAfter.timeH)} (+${Math.round(r.totalDelayMin)} min)` : '—', d: 'Thin red: his best way now. Thick red: his best way with the fields laid.', map: { show: ['mfd'], geo: (rr) => [{ t: 'line', pts: rr.enemyBefore.line, s: 'thin', label: 'before' }, { t: 'line', pts: rr.enemyAfter.line, s: 'enemy', label: 'after' }] } },
      ];
    },
    read: () => ['Each field shows the minutes it adds. “No bypass” means he must breach.', 'A field marked NOT observed can be lifted at leisure — put an OP or a weapon on it.'],
    none: [['Fails: “No defile narrower than the maximum gap”', 'The approaches run over open ground with no narrow point.', 'Raise “maximum gap”, widen the distance band, or use AP fields close in.'], ['Fails: “No field delays the enemy …”', 'He can go round every site with little loss.', 'Obstacles here buy no time: use depth, fire and patrols instead.'], ['Warning: placed outside the band', 'No suitable defile inside the band.', 'Accept, or widen the band.']],
    brief: (r) => r && r.trace ? [`First we found the enemy’s fastest way to us: ${hrs(r.enemyBefore.timeH)}.`, `We then tested ${r.trace.candidates.length} possible sites: each was “mined” and the enemy re-routed to see how much time it really costs him.`, `We kept the ${r.fields.length} that cost him most. Together they add ${Math.round(r.totalDelayMin)} minutes: ${hrs(r.enemyBefore.timeH)} becomes ${hrs(r.enemyAfter.timeH)}.`] : [],
  });

  // ------------------------------------------------------------- Least-time route
  spec({
    id: 'route', gp: ['route'], group: 'Move', title: 'Least-time route',
    q: 'What is the quickest (or most hidden) way from A to B for this column?',
    result: (S) => S.routes || null,
    nodes: (r, S) => {
      const rt = r && r.routes[r.sel || 0];
      return [
        { id: 'ab', k: 'in', col: 0, t: 'Start A and end B', v: mk(S, 'a') && mk(S, 'b') ? `${F.listRef(mk(S, 'a').r, mk(S, 'a').c)} → ${F.listRef(mk(S, 'b').r, mk(S, 'b').c)}` : 'not placed', d: 'Placed by you.' },
        { id: 'cls', k: 'in', col: 0, t: 'Column and mode', v: r ? `${r.profile} · ${r.mode}${r.night ? ' · night' : ''}` : '—', d: 'Fastest; covered (avoid enemy view); hidden (also avoid skylines).' },
        { id: 'cost', k: 'step', col: 1, from: ['ab', 'cls'], t: 'Time to cross every cell', v: r ? (r.mode === 'fastest' ? 'slope only' : 'slope + penalty where the enemy sees / on skylines') : '—', d: 'Each cell costs walking or driving time from its slope; seen ground and crests cost extra in covered / hidden modes.' },
        { id: 'search', k: 'step', col: 2, from: ['cost'], t: 'Search for the least total', v: rt ? `R1 ${km(r.routes[0].lengthM)}, ${hrs(r.routes[0].timeH)}` : '—', d: 'Like water finding the lowest way, the search spreads from A and keeps the cheapest path to B.', map: { geo: (rr) => lines(rr.routes.slice(0, 1), 'own', () => 'R1') } },
        { id: 'alt', k: 'step', col: 3, from: ['search'], t: 'Alternatives on other ground', v: r ? `${r.routes.length - 1} alternative(s)` : '—', d: 'The first route is made expensive and the search runs again.' },
        { id: 'out', k: 'out', col: 4, from: ['alt'], t: 'Routes and route card', v: rt ? `selected R${(r.sel || 0) + 1}: ${hrs(rt.timeH)} · exposed ${pct(rt.exposedFrac)}` : '—', d: 'Blue line with numbered checkpoints; route card in the bottom dock.', map: { show: ['routes'] }, shot: true },
      ];
    },
    read: () => ['R1 is the best for the chosen mode; alternatives are on different ground.', 'GSP time (route card) is the doctrinal planning time; the model time is from slope only.'],
    none: [['Fails: “Start / End point is in No-Go”', 'A or B sits on ground this column cannot use.', 'Move the point, or choose foot.'], ['Fails: “not connected”', 'NO-GO ground cuts A off from B.', 'Use foot / mules, or add a track.']],
    brief: (r) => r && r.routes[0] ? [`Every cell got a crossing time from its slope${r.mode !== 'fastest' ? ', with extra cost where the enemy can see' : ''}.`, `The search found the cheapest way: ${km(r.routes[0].lengthM)} in ${hrs(r.routes[0].timeH)}.`] : [],
  });

  // ------------------------------------------------------------- Picquets
  spec({
    id: 'picquets', gp: ['picquets'], group: 'Move', title: 'Route picquets',
    q: 'Which heights must be picqueted so the whole route is watched?',
    result: (S) => S.picquets || null,
    nodes: sitingNodes({
      inT: 'Selected route', inV: (S) => (S.routes ? `R${(S.routes.sel || 0) + 1}` : 'none'), inD: 'The route to protect (run Least-time route first).',
      screenD: 'Keep heights near the route that a picquet can climb in time; throw out the route itself, low ground and steep crags.',
      shortD: 'Keep the most commanding heights, spaced apart.',
      scoreT: 'What part of the route each height sees', scoreD: 'For each height, count the route cells it can see.',
      pickD: 'Take the height that sees most of the route, then the one that sees most of what is still unwatched.',
      list: (r) => r.picquets, outT: 'Picquets', outV: (r) => `${r.picquets.length} picquets watch ${pct(r.routeCoverage)} of the route`, outD: 'Ordered along the route with the climb time.',
      outMap: { show: ['picquets', 'routes'] },
    }),
    read: () => ['Each PQ symbol is a height to picquet before the column passes.', 'Route not watched = no height sees it: move fast there or picquet with patrols.'],
    none: [['Fails: “No heights suitable for picquets”', 'All heights fail the screen — the message lists the reasons, biggest first.', 'Raise the offset, the climb time, or lower the landform rule.']],
    brief: (r) => r && r.trace ? [`${n(r.trace.tested)} points near the route were checked; ${n(r.trace.passed)} are heights a picquet can reach.`, `${r.picquets.length} of them together watch ${pct(r.routeCoverage)} of the route.`] : [],
  });

  // ------------------------------------------------------------- Helipads
  spec({
    id: 'helipads', gp: ['helipads'], group: 'Own', title: 'Helipad sites',
    q: 'Where can a helicopter land safely, out of enemy view, close to own troops?',
    result: (S) => S.helipads || null,
    nodes: (r, S) => {
      const t = r && r.trace;
      return [
        { id: 'in', k: 'in', col: 0, t: 'Use and positions', v: r ? `${r.params.use}: ≤ ${r.pads[0] ? r.pads[0].slopeLimitDeg : '—'}°` : '—', d: 'Regular use ≤ 4°; emergency up to 10° (light) or 20° (cargo).' },
        { id: 'screen', k: 'step', col: 1, from: ['in'], t: 'Screen every sample point', v: t ? `${n(t.tested)} tested → ${n(t.passed)} pass` : '—', rej: rejOf(t), d: 'The whole pad must be flat enough; not seen by the enemy; not on a crest; reachable and near own troops.' },
        { id: 'rank', k: 'step', col: 2, from: ['screen'], t: 'Rank: flattest, hidden, nearest', v: t ? `${t.candidates.length} candidates` : '—', d: 'Flatter, hidden and nearer sites rank higher.', map: { geo: () => pts(t ? t.candidates : [], 'cand') } },
        { id: 'out', k: 'out', col: 3, from: ['rank'], t: 'Helipad sites', v: r ? `${r.pads.length} sites` : '—', d: 'Ⓗ symbols with slope and whether seen.', map: { show: ['helipads'] }, shot: true },
      ];
    },
    read: () => ['Ⓗ marks a landing site; the table gives slope, size and whether the enemy sees it.'],
    none: [['No sites', 'Nothing flat enough for the chosen use.', 'Choose emergency use, a smaller pad, or untick “concealed”.']],
    brief: (r) => r && r.trace ? [`${n(r.trace.tested)} points were checked for a flat, hidden pad.`, rejOf(r.trace)[0] ? `Most were rejected because: ${rejOf(r.trace)[0][1]} (${n(rejOf(r.trace)[0][0])}).` : '', `${r.pads.length} sites remain.`] : [],
  });

  // ------------------------------------------------------------- Route viewshed
  spec({
    id: 'routeViewshed', gp: ['routeViewshed'], group: 'Move', title: 'Route viewshed',
    q: 'From where can a route be seen — or what can a column on it see?',
    result: (S) => S.rvs || null,
    nodes: (r) => [
      { id: 'line', k: 'in', col: 0, t: 'Route', v: r ? r.label : '—', d: 'A computed route, an avenue, or a line you draw.', map: { geo: (rr) => [{ t: 'line', pts: rr.line, s: 'own' }] } },
      { id: 'st', k: 'step', col: 1, from: ['line'], t: 'Stations along the route', v: r ? `${r.stations} stations` : '—', d: 'Points at equal spacing along the line.' },
      { id: 'vs', k: 'step', col: 2, from: ['st'], t: 'Viewshed from every station', v: r ? (r.mode === 'exposure' ? 'who can see the route' : 'what the column sees') : '—', d: 'For each station, which cells are in line of sight. Counts are added up.' },
      { id: 'out', k: 'out', col: 3, from: ['vs'], t: 'Route viewshed', v: r ? `${F.area(r.visibleKm2)} (${pct(r.areaShare)} of the map)` : '—', d: 'Darker = sees (or is seen from) more of the route.', map: { ovl: ['routevs'], show: ['rvs'] }, shot: true },
      { id: 'watch', k: 'out', col: 3, from: ['vs'], t: 'Best watch points', v: r ? `${r.watch.length} points` : '—', d: 'Where a picquet (or enemy OP) sees most of the route.', map: { geo: (rr) => [{ t: 'line', pts: rr.line, s: 'own' }].concat(pts(rr.watch, 'key', (q, k) => `W${k + 1}`)) } },
    ],
    read: () => ['Dark ground sees most of the route: picquet it, or expect enemy OPs there.'],
    none: [['Very small area', 'The route runs in a deep valley.', 'Good for hiding — or check the observer height.']],
    brief: (r) => r ? [`We placed ${r.stations} stations along ${r.label}.`, `From each we worked out line of sight and added the results: ${F.area(r.visibleKm2)} of ground can see the route.`] : [],
  });

  // ------------------------------------------------------------- Sector: ITGs
  spec({
    id: 'itgs', gp: ['itgs', 'sectorAll'], group: 'Sector', title: 'Important tactical ground (ITGs)',
    q: 'Which heights in our sector must we hold, and how big a force does each need?',
    result: (S) => (S.sec && S.sec.itg) || null,
    nodes: (r) => {
      const t = r && r.trace;
      return [
        { id: 'in', k: 'in', col: 0, t: 'Sector, border, terrain value', v: r ? `min value ${r.params.minDominance}` : '—', d: 'Terrain value (0–100) = how much a point commands the ground around it.' },
        { id: 'screen', k: 'step', col: 1, from: ['in'], t: 'Screen sample points', v: t ? `${n(t.tested)} tested → ${n(t.summits)} summits` : '—',
          rej: t ? [[t.outside, 'outside the sector'], [t.enemySide, 'on the enemy side of the border'], [t.lowValue, `terrain value under ${r.params.minDominance}`], [t.notTop, `not the top within ${km(r.params.peakRadiusM)}`]] : [], d: 'Keep only summits inside our sector, on our side, with high terrain value.' },
        { id: 'space', k: 'step', col: 2, from: ['screen'], t: 'Space them apart', v: t ? `${t.spaced} kept, ≥ ${km(r.params.minSepM)} apart` : '—', d: 'Two tops on the same hill count as one.', map: { geo: () => pts(t ? t.tops : [], 'cand') } },
        { id: 'measure', k: 'step', col: 3, from: ['space'], t: 'Measure each ITG', v: r ? 'area, perimeter → force; view; border' : '—', d: 'Footprint = ground within 60 m of the top; its perimeter sets the force (section / platoon / company / battalion). Also: how much of the approaches it sees, and how far from the border.' },
        { id: 'score', k: 'step', col: 4, from: ['measure'], t: 'Score and rate', v: r ? `${Math.round(r.params.wDominance * 100)}% value + ${Math.round(r.params.wObs * 100)}% view + ${Math.round(r.params.wBorder * 100)}% border` : '—', d: `Good ≥ ${r ? r.params.good : 0.72}, Marginal ≥ ${r ? r.params.marginal : 0.58}, else Not good.` },
        { id: 'out', k: 'out', col: 5, from: ['score'], t: 'ITGs', v: r ? `${r.itgs.length}: ${['Good', 'Marginal', 'Not good'].map((k) => `${r.itgs.filter((q) => q.rating === k).length} ${k}`).join(' · ')}` : '—', d: 'Outline, force needed and rating for each.', map: { show: ['itgs'], geo: (rr) => pts(rr.itgs, null, (q) => q.id).map((p, k) => Object.assign(p, { s: rateS(rr.itgs[k].rating) })) }, shot: true },
      ];
    },
    read: () => ['Each ITG shows the force needed to hold it and a rating. Good = dominant, sees the approaches, close to the border.'],
    none: [['Fails / no ITGs', 'No summit on our side passes the value limit.', 'Lower the minimum terrain value, or check the border is drawn the right way round.']],
    brief: (r) => r && r.trace ? [`${n(r.trace.tested)} points were checked; ${n(r.trace.summits)} are summits on our side with high terrain value.`, `After merging tops on the same hill, ${r.trace.spaced} remain; each was measured for size, view over the approaches and distance to the border.`, `The best ${r.itgs.length} are listed with the force each needs.`] : [],
  });

  // ------------------------------------------------------------- Sector: deployment
  spec({
    id: 'deploy', gp: ['deploy', 'sectorAll'], group: 'Sector', title: 'Deployment plan',
    q: 'How do we lay out border posts, platoons, companies, HQs and mortars on the ITGs?',
    result: (S) => (S.sec && S.sec.plan) || null,
    nodes: (r) => [
      { id: 'in', k: 'in', col: 0, t: 'ITGs and mode', v: r ? r.modeName : '—', d: 'Forward: strength on the border. Normal: tiers in depth. Strong point: companies on the best ITGs.' },
      { id: 'bp', k: 'step', col: 1, from: ['in'], t: 'Border posts along the line', v: r ? `${r.borderPosts.length} posts every ${km(r.params.borderPostSpacingM)}` : '—', d: 'On the most dominant ground within the set depth of the border, checked for line of sight to neighbours.', map: { geo: (rr) => pts(rr.borderPosts, null, (q) => q.id).map((p, k) => Object.assign(p, { s: rateS(rr.borderPosts[k].rating) })) } },
      { id: 'pl', k: 'step', col: 2, from: ['in'], t: 'Platoons on ITGs', v: r ? `${r.platoons.length} platoons` : '—', d: 'Spread over the ITGs by depth tiers (or massed in strong point mode), at most 3 per ITG.', map: { geo: (rr) => pts(rr.platoons, 'own', (q) => q.id) } },
      { id: 'co', k: 'step', col: 3, from: ['pl'], t: 'Companies and HQs', v: r ? `${r.companies.length} companies` : '—', d: 'Platoons grouped along the border; each HQ on gentle ground behind them, hidden from the enemy.' },
      { id: 'bn', k: 'step', col: 4, from: ['co'], t: 'Bn HQ and mortars', v: r ? `${r.bnHq ? 'Bn HQ ✓' : 'no Bn HQ'}${r.bnMortar ? ` · mortar reaches ${r.bnMortar.inRange}/${r.bnMortar.of} posts` : ''}` : '—', d: 'Mortar sited to reach the most posts, hidden if possible.' },
      { id: 'out', k: 'out', col: 5, from: ['bp', 'bn'], t: 'Deployment plan', v: r ? `~${r.troops} all ranks` : '—', d: 'Rated items in the attribute table; notes list ITGs left unoccupied.', map: { show: ['plan', 'itgs'] }, shot: true },
    ],
    read: (r) => ['Each post is rated: intervisible with neighbours, dominant and hidden = Good.'].concat(r ? r.notes : []),
    none: [['No border posts', 'No border line, or no ground on our side within the depth.', 'Draw the border; raise border post depth.'], ['Few platoons placed', 'Too few ITGs.', 'Run ITGs with a lower value limit.']],
    brief: (r) => r ? [`Mode: ${r.modeName}.`, `${r.borderPosts.length} border posts along the line, ${r.platoons.length} platoons on the ITGs in ${r.companies.length} companies.`, ...r.notes] : [],
  });

  // ------------------------------------------------------------- Sector: enemy approaches
  spec({
    id: 'eappr', gp: ['enemyApproaches', 'sectorAll'], group: 'Sector', title: 'Enemy approaches across the border',
    q: 'From where across the border can the enemy reach each of our ITGs, by which way, and how much of it do we see?',
    result: (S) => (S.sec && S.sec.appr) || null,
    nodes: (r, S) => {
      const t = r && r.trace, objs = t ? t.perObjective : [];
      const itg = (id) => (S.sec.itg ? S.sec.itg.itgs.find((q) => q.id === id) : null);
      const sum = (k) => objs.reduce((a, o) => a + o[k], 0);
      return [
        { id: 'border', k: 'in', col: 0, t: 'Border line', v: S.border ? `${km(M_len(S.border, S))}` : 'not drawn', d: 'The LoC as drawn. Enemy side and own side come from it.', map: { geo: () => [{ t: 'line', pts: S.border || [], s: 'border', label: 'LoC' }] } },
        { id: 'itgs', k: 'in', col: 0, t: 'Our ITGs (objectives)', v: t ? `top ${t.objectives} ITGs` : '—', d: 'The enemy aims for the ground that matters: our best ITGs.', map: { geo: () => pts(objs, 'key', (q) => q.objective) } },
        { id: 'entry', k: 'step', col: 1, from: ['border'], t: 'Where can he start?', v: t ? `${t.stations} points along the line → ${t.entries} entry points` : '—', rej: t ? [[t.stations - t.entries, 'no passable ground near that point']] : [],
          d: `Every ${km(r ? r.params.entrySpacingM : 1500)} along the border, go ${km(r ? r.params.entryDepthM : 1500)} back into enemy ground and pick a spot he can move on. These are his forming-up places.`, map: { geo: (rr) => [{ t: 'line', pts: S.border || [], s: 'border' }].concat(pts(rr.entries, 'enemy', (q, k) => `E${k + 1}`)) }, shot: true },
        { id: 'reach', k: 'step', col: 2, from: ['entry'], t: 'Which ground can he reach at all?', v: t ? `${t.reachAny} of ${t.entries} entries lead into our side` : '—', d: `Spread out from every entry point at ${r ? r.params.profile : 'foot'} speed (slope limits, NO-GO). Crags and cliffs stop him.`, map: { geo: (rr) => pts(rr.entries, 'enemy') } },
        { id: 'goal', k: 'step', col: 2, from: ['itgs', 'reach'], t: 'Foot of each objective', v: t ? `${objs.filter((o) => o.reachable).length} of ${objs.length} ITGs reachable` : '—', rej: objs.filter((o) => !o.reachable).map((o) => [1, `${o.objective}: ringed by NO-GO within 1.2 km`]),
          d: 'Summits are often ringed by crags. The nearest reachable spot to each ITG is where his final assault starts.', map: { geo: () => objs.map((o) => ({ t: 'pt', c: o.c, r: o.r, s: o.reachable ? 'key' : 'bad', label: `${o.objective}${o.reachable ? '' : ' ✗'}` })) } },
        { id: 'rank', k: 'step', col: 3, from: ['goal'], t: 'Fastest entries for each objective', v: t ? `${sum('reached')} entry→objective links; ${sum('kept')} kept` : '—',
          rej: t ? [[sum('tooClose'), `start within ${km(r.params.entrySpacingM * 1.5)} of one already used`], [sum('duplicate'), 'same path as one already kept'], [sum('spare'), `slower than the ${r.params.perObjective} kept per objective`], [sum('noPath'), 'no path found']] : [],
          d: `For each ITG, rank all entry points by travel time and keep the ${r ? r.params.perObjective : 2} fastest that start apart and do not share the same path.`, map: { geo: (rr) => lines(rr.approaches, 'enemy', (q) => q.id).concat(pts(objs.filter((o) => o.reachable), 'key', (q) => q.objective)) } },
        { id: 'measure', k: 'step', col: 4, from: ['rank'], t: 'Describe each approach', v: r ? `${r.approaches.length} measured` : '—', d: 'Type (valley, nullah, ridge, spur), length, time, and how much of its length on our side our posts can see.' },
        { id: 'out', k: 'out', col: 5, from: ['measure'], t: 'Enemy approaches', v: r ? r.approaches.map((a) => `${a.id}→${a.objective}`).join(' · ') : '—',
          d: 'Line colour = how well we watch it (green ≥ 60% seen, amber ≥ 30%, red less). Threat = hidden and fast.', map: { geo: (rr) => [{ t: 'line', pts: S.border || [], s: 'border' }].concat(rr.approaches.map((a) => ({ t: 'line', pts: a.line, s: rateS(a.rating), label: `${a.id} ${pct(a.exposure)} seen` })), pts(objs, 'key', (q) => q.objective)) }, shot: true },
      ];
    },
    read: (r) => ['Each line is the enemy’s quickest way from a forming-up place across the border to one of our ITGs.', 'Green = we see most of it; red = he can come mostly unseen — that is where to put an OP, LP or mines.', r ? `Threat High = mostly unseen and quick (${r.approaches.filter((a) => a.threat === 'High').length} here).` : ''],
    none: [['Fails: “Draw the border line first”', 'No border line.', 'Sector tab ▸ Border Line.'], ['Fails: “No passable entry points”', 'Enemy side is all NO-GO for this movement class at the set depth.', 'Use foot, or reduce the entry depth.'], ['An ITG has no approach', 'Every way to it is blocked by NO-GO, or all entries were too close to ones already used.', 'Shown in the “Foot of each objective” and “Fastest entries” boxes. A naturally protected ITG — say so.'], ['No approaches at all', 'The ITGs are unreachable for this class (e.g. vehicles).', 'Run for foot.']],
    brief: (r) => {
      if (!r || !r.trace) return [];
      const t = r.trace, objs = t.perObjective;
      const out = [`We marked ${t.stations} points along the LoC and, behind each, a place the enemy could form up: ${t.entries} usable entry points.`,
        `Our objectives are our top ${objs.length} ITGs; ${objs.filter((o) => o.reachable).length} of them can be reached on ${r.params.profile}.`,
        `For each ITG we let the computer find the quickest way from every entry point, and kept the ${r.params.perObjective} fastest that start in different places: ${r.approaches.length} approaches.`];
      const worst = r.approaches.slice().sort((a, b) => a.exposure - b.exposure)[0];
      if (worst) out.push(worst.exposure < 0.6
        ? `The most dangerous is ${worst.id} to ${worst.objective}: a ${worst.type} approach, ${hrs(worst.timeH)}, only ${pct(worst.exposure)} seen by us.`
        : `All approaches are well watched: even the least-watched, ${worst.id} to ${worst.objective}, is ${pct(worst.exposure)} seen by us.`);
      const un = objs.filter((o) => !o.reachable).map((o) => o.objective);
      if (un.length) out.push(`${un.join(', ')} cannot be reached at all — crags all round.`);
      return out;
    },
  });
  const M_len = (line, S) => { let d = 0; for (let k = 1; k < line.length; k++) d += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]); return d * (S.grid ? S.grid.cs : 1); };

  // ------------------------------------------------------------- Sector: infiltration
  spec({
    id: 'infil', gp: ['infiltration', 'sectorAll'], group: 'Sector', title: 'Infiltration routes',
    q: 'How could small enemy parties slip in to our HQs unseen?',
    result: (S) => (S.sec && S.sec.infil) || null,
    nodes: (r, S) => {
      const t = r && r.trace;
      return [
        { id: 'border', k: 'in', col: 0, t: 'Border and our targets', v: t ? `${t.targets} targets (HQs or rear ITGs)` : '—', d: 'Infiltrators go for HQs, guns and admin, not the posts.' },
        { id: 'seen', k: 'in', col: 0, t: 'What our posts see', v: S.sec && S.sec.plan ? 'from the deployment plan' : 'no plan yet', d: 'Union of what every post and OP sees.' },
        { id: 'entry', k: 'step', col: 1, from: ['border'], t: 'Entry points close to the line', v: t ? `${t.stations} points → ${t.entries} entries` : '—', rej: t ? [[t.stations - t.entries, 'no passable ground']] : [], d: 'Like the approaches, but only up to 800 m back: infiltrators cross close to the line.', map: { geo: () => pts(t ? t.entryPts : [], 'enemy') } },
        { id: 'cost', k: 'step', col: 1, from: ['seen'], t: 'Make seen ground expensive', v: r ? `seen ×${1 + r.params.detectW}, nullahs −${pct(r.params.nullahBonus)}` : '—', d: 'A cell our posts see costs many times more; nullahs and dead ground cost less. The cheapest path is then the most hidden one, not the quickest.' },
        { id: 'paths', k: 'step', col: 2, from: ['entry', 'cost'], t: 'Hidden path to the nearest targets', v: t ? `${t.tried} tried, ${t.candidates} found` : '—', rej: t ? [[t.noPath, 'no path at all']] : [], d: 'From each entry to its 2 nearest targets.' },
        { id: 'keep', k: 'step', col: 3, from: ['paths'], t: 'Keep the least-watched distinct routes', v: t ? `${t.kept} kept` : '—', rej: t ? [[t.overlap, 'shares more than half its path with one kept'], [t.unused, `more watched than the ${r.params.infilCount} kept`]] : [], d: 'Sorted by how much of the route on our side is watched; near-duplicates dropped.' },
        { id: 'out', k: 'out', col: 4, from: ['keep'], t: 'Infiltration routes', v: r ? r.routes.map((x) => `${x.id} ${pct(x.detectShare)} seen`).join(' · ') : '—', d: 'Threat High = under 15% watched.', map: { geo: (rr) => rr.routes.map((x) => ({ t: 'line', pts: x.line, s: rateS(x.rating), label: `${x.id} ${pct(x.detectShare)} seen` })) }, shot: true },
      ];
    },
    read: () => ['Each line is a way a small party could come in while staying out of sight.', 'Red = almost unwatched: block with an ambush, LP or mines.'],
    none: [['No routes', 'No entry connects to a target on foot.', 'Check the border and targets.'], ['All routes well watched', 'Our posts see the gaps.', 'Good — say so.']],
    brief: (r) => r && r.trace ? [`From ${r.trace.entries} crossing places close to the line we searched for the most hidden way to our HQs: ground our posts see was made ${1 + r.params.detectW} times as costly.`, `${r.routes.length} distinct routes remain; the worst is ${r.routes[0] ? `${r.routes[0].id}, only ${pct(r.routes[0].detectShare)} watched` : '—'}.`] : [],
  });

  // ------------------------------------------------------------- Sector: enemy options
  spec({
    id: 'eopts', gp: ['enemyOptions', 'sectorAll'], group: 'Sector', title: 'Enemy options (courses of action)',
    q: 'What are the enemy’s 3–4 most likely ways to attack, and which is most dangerous?',
    result: (S) => (S.sec && S.sec.opts) || null,
    nodes: (r) => {
      const t = r && r.trace;
      return [
        { id: 'in', k: 'in', col: 0, t: 'ITGs and enemy approaches', v: t ? `${t.itgs} ITGs` : '—', d: 'From the ITG and Enemy Approaches tools.' },
        { id: 'pair', k: 'step', col: 1, from: ['in'], t: 'For each ITG: main + supporting thrust', v: t ? `${t.scored} ITGs with an approach` : '—', rej: t ? [[t.noApproach, 'ITG has no approach (unreachable)']] : [], d: 'Main thrust = the approach most hidden and fastest. Supporting thrust = another approach from a direction at least 40° different.' },
        { id: 'score', k: 'step', col: 2, from: ['pair'], t: 'Score each option', v: '35% unseen + 25% speed + 20% two directions + 20% value of ITG', d: 'Higher = more attractive to the enemy.' },
        { id: 'out', k: 'out', col: 3, from: ['score'], t: 'Enemy options', v: r ? r.options.map((o) => `${o.id.replace('Option ', '')}: ${o.objective}`).join(' · ') : '—', d: 'Option A = most likely. “Most dangerous” = goes for our most valuable ITG.', map: { geo: (rr) => [].concat(...rr.options.map((o) => o.lines.map((l, k) => ({ t: 'line', pts: l, s: k ? 'thin' : 'enemy', label: k ? '' : o.id })))).concat(rr.options.map((o) => ({ t: 'pt', c: o.objectiveRef.c, r: o.objectiveRef.r, s: 'key', label: o.objective }))) }, shot: true },
      ];
    },
    read: (r) => (r ? r.options.map((o) => `${o.id}${o.label ? ` (${o.label})` : ''}: ${o.summary} ${o.recommendation}`) : []),
    none: [['Fails: “Run Enemy Approaches first”', 'Options are built from approaches.', 'Run Enemy Approaches.'], ['Fewer than 3 options', 'Few ITGs can be reached.', 'Our ground is naturally strong — say so.']],
    brief: (r) => (r ? [`Each ITG the enemy can reach gives one option: his best hidden, fast approach, plus a second from another direction if there is one.`, `Ranked by how hidden, fast, multi-directional and valuable: ${r.options.map((o) => `${o.id} on ${o.objective}`).join(', ')}.`] : []),
  });

  const borderGeo = (S) => (S.border ? [{ t: 'line', pts: S.border, s: 'border', label: 'LoC' }] : []);
  SPECS.filter((sp) => sp.group === 'Sector').forEach((sp) => (sp.base = borderGeo));
  X.SPECS = SPECS;
  X.specFor = (gpId) => { const s = SPECS.find((x) => x.gp.includes(gpId)); return s ? s.id : null; };
  X.get = (id) => SPECS.find((x) => x.id === id);

  // =====================================================================
  // Failures and last runs (from the Geoprocessing pane)
  // =====================================================================
  X.fail = {};
  GP.onResult = (gpId, err) => {
    if (gpId === 'weapons') X.lastWeapon = pv('weapons', 'weaponId');
    for (const s of SPECS) if (s.gp.includes(gpId)) { if (err) X.fail[s.id] = { msg: err, at: Date.now() }; else delete X.fail[s.id]; }
    if (X.cur && X.visible) X.render();
  };

  /** Evaluate a spec against the current session. */
  X.evaluate = (sp) => {
    const S = UI.S;
    let r = null;
    try { r = sp.result(S); } catch (e) { r = null; }
    let nodes;
    try { nodes = sp.nodes(r, S); } catch (e) { console.debug('explain', sp.id, e); r = null; nodes = sp.nodes(null, S); }
    nodes.forEach((nd) => { nd.rej = (nd.rej || []).filter((x) => x[0] && x[0] !== 0); });
    let script = [];
    try { script = (sp.brief(r) || []).filter(Boolean); } catch (e) { script = []; }
    let read = [];
    try { read = (sp.read(r) || []).filter(Boolean); } catch (e) { read = []; }
    return { r, nodes, script, read, fail: X.fail[sp.id] || null };
  };

  // =====================================================================
  // Diagram (SVG)
  // =====================================================================
  const wrap = (s, max) => {
    const out = [];
    let line = '';
    for (const w of String(s).split(/\s+/)) {
      if (line && (line + ' ' + w).length > max) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
    }
    if (line) out.push(line);
    return out;
  };
  /**
   * Lay out and draw a model. opts: { print: black-only, sel: node id, failNode }.
   * Inputs are ovals, process steps rectangles, outputs rounded double-bordered ovals.
   */
  X.svg = (ev, opts = {}) => {
    const BW = 236, GX = 36, GY = 34, PAD = 14, LH = 14.5, CH = 37;
    const P = opts.print;
    const col = {}, boxes = {};
    ev.nodes.forEach((nd) => {
      const tl = wrap(nd.t, CH - 4), vl = nd.v && nd.v !== '—' ? wrap(nd.v, CH) : [ev.r ? '' : '—'].filter(Boolean);
      const rl = (nd.rej || []).slice(0, 5).map(([k, why]) => wrap(`✗ ${typeof k === 'number' ? n(k) : k} ${why}`, CH)).flat();
      const h = 18 + (tl.length + vl.length + rl.length) * LH + (rl.length ? 6 : 0) + (nd.k === 'step' ? 4 : 10);
      boxes[nd.id] = { nd, tl, vl, rl, h };
      (col[nd.col] = col[nd.col] || []).push(nd.id);
    });
    // top-to-bottom flow: each level is a row, its boxes side by side
    const levels = Object.keys(col).map(Number).sort((a, b) => a - b);
    const maxN = Math.max(...levels.map((c) => col[c].length));
    const W = PAD * 2 + maxN * BW + (maxN - 1) * GX;
    let y = PAD;
    levels.forEach((c) => {
      const ids = col[c], rowH = Math.max(...ids.map((id) => boxes[id].h));
      const rowW = ids.length * BW + (ids.length - 1) * GX;
      ids.forEach((id, k) => { const b = boxes[id]; b.x = (W - rowW) / 2 + k * (BW + GX); b.y = y + (rowH - b.h) / 2; });
      y += rowH + GY;
    });
    const H = y - GY + PAD;
    const C = P ? { inF: '#fff', inS: '#000', stF: '#fff', stS: '#000', outF: '#fff', outS: '#000', txt: '#000', rej: '#000', arr: '#000', sel: '#000' }
      : { inF: '#dbe8fb', inS: '#3b6fe0', stF: '#fff4c8', stS: '#c49a00', outF: '#d9f1da', outS: '#2f8a3b', txt: '#1b1f24', rej: '#b3261e', arr: '#5b6573', sel: '#e0662b' };
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto" font-family="Arial, Helvetica, sans-serif" font-size="12">`;
    s += `<defs><marker id="mvArr${P ? 'p' : ''}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="${C.arr}"/></marker></defs>`;
    // connectors first
    ev.nodes.forEach((nd) => (nd.from || []).forEach((f) => {
      const a = boxes[f], b = boxes[nd.id];
      if (!a || !b) return;
      const x1 = a.x + BW / 2, y1 = a.y + a.h, x2 = b.x + BW / 2, y2 = b.y, my = (y1 + y2) / 2;
      s += `<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2 - 2}" fill="none" stroke="${C.arr}" stroke-width="1.4" marker-end="url(#mvArr${P ? 'p' : ''})"/>`;
    }));
    ev.nodes.forEach((nd, idx) => {
      const b = boxes[nd.id], { x, y, h } = b;
      const fill = nd.k === 'in' ? C.inF : nd.k === 'out' ? C.outF : C.stF, stroke = nd.k === 'in' ? C.inS : nd.k === 'out' ? C.outS : C.stS;
      const isFail = opts.failNode === nd.id, isSel = opts.sel === nd.id;
      const sw = isSel ? 3 : 1.5, st = isFail ? (P ? '#000' : '#b3261e') : isSel ? C.sel : stroke;
      s += `<g class="mv-node${ev.r ? '' : ' empty'}" data-node="${nd.id}" data-idx="${idx}" style="cursor:pointer">`;
      if (nd.k === 'step') s += `<rect x="${x}" y="${y}" width="${BW}" height="${h}" rx="3" fill="${fill}" stroke="${st}" stroke-width="${sw}"${isFail ? ' stroke-dasharray="5 3"' : ''}/>`;
      else {
        const rx = Math.min(BW / 2, h / 2 + 14);
        s += `<rect x="${x}" y="${y}" width="${BW}" height="${h}" rx="${rx}" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
        if (nd.k === 'out') s += `<rect x="${x + 4}" y="${y + 4}" width="${BW - 8}" height="${h - 8}" rx="${Math.max(2, rx - 4)}" fill="none" stroke="${st}" stroke-width="1"/>`;
      }
      const tx = x + BW / 2;
      let ty = y + (nd.k === 'step' ? 17 : 21);
      if (nd.k === 'step') s += `<text x="${x + 6}" y="${y + 12}" font-size="9.5" fill="${C.txt}" opacity="0.7">${ev.nodes.filter((q) => q.k === 'step').indexOf(nd) + 1}</text>`;
      b.tl.forEach((l) => { s += `<text x="${tx}" y="${ty}" text-anchor="middle" font-weight="bold" fill="${C.txt}">${esc(l)}</text>`; ty += LH; });
      b.vl.forEach((l) => { s += `<text x="${tx}" y="${ty}" text-anchor="middle" fill="${C.txt}">${esc(l)}</text>`; ty += LH; });
      if (b.rl.length) { ty += 4; b.rl.forEach((l) => { s += `<text x="${tx}" y="${ty}" text-anchor="middle" font-size="11" ${P ? 'font-style="italic"' : ''} fill="${C.rej}">${esc(l)}</text>`; ty += LH; }); }
      s += '</g>';
    });
    s += '</svg>';
    return { svg: s, W, H };
  };

  /** Which node a failure message points at, and a plain fix. */
  const failInfo = (sp, ev) => {
    if (!ev.fail) return null;
    const row = sp.none.find(([what]) => /^Fails/.test(what) && ev.fail.msg.toLowerCase().includes(what.replace(/^Fails:\s*“?/, '').replace(/[”…]/g, '').trim().toLowerCase().slice(0, 18)));
    const scr = ev.nodes.find((nd) => nd.id === 'screen' || nd.id === 'entry' || nd.id === 'def') || ev.nodes.find((nd) => nd.k === 'step');
    return { msg: ev.fail.msg, why: row ? row[1] : 'The tool stopped before producing a result.', fix: row ? row[2] : 'Read the message; adjust the input named in it and run again.', node: scr ? scr.id : null };
  };

  // =====================================================================
  // Model view (center pane)
  // =====================================================================
  const $ = (id) => document.getElementById(id);
  X.cur = SPECS[0].id;
  X.sel = null;
  X.visible = false;
  X.tab = 'read';

  X.open = (id) => {
    if (id) X.cur = id;
    X.sel = null;
    UI.app.setView('model');
  };
  X.show = (on) => {
    X.visible = on;
    const el = $('modelView');
    if (!el) return;
    el.hidden = !on;
    if (on) X.render();
  };

  X.render = () => {
    const el = $('modelView');
    if (!el || el.hidden) return;
    const sp = X.get(X.cur), ev = X.evaluate(sp), fi = failInfo(sp, ev);
    const has = (s) => { try { return !!s.result(UI.S); } catch (e) { return false; } };
    const opts = ['Ground', 'Enemy', 'Own', 'Move', 'Sector'].map((g) => `<optgroup label="${g}">${SPECS.filter((s) => s.group === g).map((s) => `<option value="${s.id}"${s.id === X.cur ? ' selected' : ''}>${has(s) ? '● ' : X.fail[s.id] ? '✗ ' : '○ '}${esc(s.title)}</option>`).join('')}</optgroup>`).join('');
    const d = X.svg(ev, { sel: X.sel, failNode: fi && fi.node });
    const nd = X.sel ? ev.nodes.find((q) => q.id === X.sel) : null;
    const state = fi ? `<div class="mv-state err"><b>Last run failed:</b> ${esc(fi.msg)}<br><b>Why:</b> ${esc(fi.why)}<br><b>What to do:</b> ${esc(fi.fix)}</div>`
      : ev.r ? '<div class="mv-state ok">Showing this session’s last result. Click a box to see that step on the map.</div>'
        : '<div class="mv-state">Not run yet — the diagram shows how the tool works. Run it to see the numbers.</div>';
    const side = nd
      ? `<div class="mv-card"><div class="mv-kind ${nd.k}">${nd.k === 'in' ? 'Input' : nd.k === 'out' ? 'Output' : 'Step'}</div><h3>${esc(nd.t)}</h3><p>${esc(nd.d || '')}</p>${nd.v ? `<p><b>This run:</b> ${esc(nd.v)}</p>` : ''}${nd.rej && nd.rej.length ? `<p><b>Thrown out:</b></p><ul>${nd.rej.map(([k, w]) => `<li>${typeof k === 'number' ? n(k) : esc(k)} — ${esc(w)}</li>`).join('')}</ul>` : ''}${ev.r && nd.map ? '<button class="btn" data-act="brief-here">Show this step on the map</button>' : ''}</div>`
      : '';
    const tabs = [['read', 'How to read the result'], ['none', 'Nothing found / failed'], ['script', 'Brief script']];
    const body = X.tab === 'read' ? (ev.read.length ? `<ul>${ev.read.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="hint">—</p>')
      : X.tab === 'none' ? `<table class="mv-tbl"><tr><th>You see</th><th>Why</th><th>What to do</th></tr>${sp.none.map((x) => `<tr>${x.map((y) => `<td>${esc(y)}</td>`).join('')}</tr>`).join('')}</table>`
        : ev.script.length ? `<ol>${ev.script.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '<p class="hint">Run the tool to get a script with this run’s numbers.</p>';
    el.innerHTML = `<div class="mv-head"><select id="mvTool" title="Tool">${opts}</select><div class="mv-q">${esc(sp.q)}</div>
      <button class="btn" data-act="run">Open tool</button><button class="btn primary" data-act="brief"${ev.r ? '' : ' disabled'}>▶ Brief on map</button><button class="btn" data-act="print">Print / PDF</button></div>
      ${state}
      <div class="mv-body"><div class="mv-diagram">${d.svg}<div class="mv-key"><span class="k in">Input</span><span class="k step">Step</span><span class="k out">Output</span><span class="k rej">✗ thrown out, and why</span></div></div>
      <div class="mv-side">${side}<div class="mv-tabs">${tabs.map(([k, t]) => `<button data-tab="${k}" class="${X.tab === k ? 'on' : ''}">${t}</button>`).join('')}</div><div class="mv-tab">${body}</div></div></div>`;
    $('mvTool').onchange = (e) => { X.cur = e.target.value; X.sel = null; X.render(); };
    el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { X.tab = b.dataset.tab; X.render(); }));
    el.querySelectorAll('.mv-node').forEach((g) => {
      g.onclick = () => { X.sel = g.dataset.node; X.render(); };
      g.ondblclick = () => { if (ev.r) X.brief(X.cur, +g.dataset.idx); };
    });
    el.querySelector('[data-act=run]').onclick = () => { UI.app.setView('2d'); UI.GP.open(sp.gp[0]); };
    el.querySelector('[data-act=brief]').onclick = () => X.brief(X.cur, 0);
    el.querySelector('[data-act=print]').onclick = () => X.print();
    const bh = el.querySelector('[data-act=brief-here]');
    if (bh) bh.onclick = () => X.brief(X.cur, ev.nodes.indexOf(nd));
  };

  // =====================================================================
  // Brief mode (map)
  // =====================================================================
  let saved = null;
  X.briefing = null;
  const LAYERS = ['key', 'posts', 'weapons', 'mfd', 'routes', 'avenues', 'picquets', 'helipads', 'hostileOps', 'secArea', 'ridges', 'nullahs', 'itgs', 'plan', 'eappr', 'infil', 'eopts', 'bwatch', 'firegaps', 'rvs', 'obstacles'];
  const saveState = () => {
    const S = UI.S;
    if (saved) return;
    saved = { show: Object.assign({}, S.show), ovl: Object.fromEntries(Object.entries(S.overlays).map(([k, o]) => [k, o.visible])), sel: S.sel };
  };
  const restoreState = () => {
    if (!saved) return;
    const S = UI.S;
    Object.assign(S.show, saved.show);
    Object.entries(saved.ovl).forEach(([k, v]) => { if (S.overlays[k]) S.overlays[k].visible = v; });
    saved = null;
  };
  /** Steps worth showing on the map. */
  const briefSteps = (ev) => ev.nodes.map((nd, i) => ({ nd, i })).filter((x) => x.nd.map || x.nd.k !== 'in');

  X.brief = (id, idx = 0) => {
    const sp = X.get(id), ev = X.evaluate(sp);
    if (!ev.r) return;
    saveState();
    const steps = briefSteps(ev);
    let k = steps.findIndex((s) => s.i === idx);
    if (k < 0) k = 0;
    X.briefing = { id, k, steps, ev, sp };
    UI.app.setView('2d');
    X.applyBrief();
    fitBrief();
  };
  X.applyBrief = () => {
    const B = X.briefing, S = UI.S;
    if (!B) return;
    const { nd } = B.steps[B.k];
    LAYERS.forEach((l) => { if (l in S.show) S.show[l] = false; });
    Object.values(S.overlays).forEach((o) => (o.visible = false));
    const m = nd.map || {};
    (m.show || []).forEach((l) => (S.show[l] = true));
    (m.ovl || []).forEach((o) => { if (S.overlays[o] && S.overlays[o].data) S.overlays[o].visible = true; });
    B.geo = [];
    try { B.geo = (B.sp.base ? B.sp.base(S) : []).concat(m.geo ? m.geo(B.ev.r) || [] : []); } catch (e) { B.geo = []; }
    B.veil = (m.ovl || []).length ? 0.12 : 0.42;
    UI.app.refresh({ base: true });
    renderBar();
  };
  const renderBar = () => {
    const B = X.briefing, bar = $('briefBar');
    if (!bar) return;
    if (!B) { bar.hidden = true; return; }
    const { nd } = B.steps[B.k];
    const no = B.steps.filter((s) => s.nd.k === 'step').indexOf(B.steps[B.k]);
    const tag = nd.k === 'in' ? 'Input' : nd.k === 'out' ? 'Result' : `Step ${no + 1}`;
    bar.hidden = false;
    bar.innerHTML = `<div class="bb-top"><span class="bb-tool">${esc(B.sp.title)}</span><span class="bb-n">${B.k + 1} / ${B.steps.length}</span></div>
      <div class="bb-main"><span class="bb-tag ${nd.k}">${tag}</span><b>${esc(nd.t)}</b>${nd.v && nd.v !== '—' ? ` — ${esc(nd.v)}` : ''}</div>
      <div class="bb-desc">${esc(nd.d || '')}${nd.rej && nd.rej.length ? `<div class="bb-rej">${nd.rej.slice(0, 4).map(([c, w]) => `✗ ${typeof c === 'number' ? n(c) : esc(c)} ${esc(w)}`).join(' · ')}</div>` : ''}</div>
      <div class="bb-ctl"><button class="btn" data-b="prev"${B.k ? '' : ' disabled'}>◀ Prev</button><button class="btn primary" data-b="next"${B.k < B.steps.length - 1 ? '' : ' disabled'}>Next ▶</button><button class="btn" data-b="model">Model</button><button class="btn" data-b="exit">Exit</button></div>`;
    bar.querySelector('[data-b=prev]').onclick = () => X.step(-1);
    bar.querySelector('[data-b=next]').onclick = () => X.step(1);
    bar.querySelector('[data-b=model]').onclick = () => { const id = B.id; X.endBrief(); X.open(id); };
    bar.querySelector('[data-b=exit]').onclick = () => X.endBrief();
  };
  /** Zoom to everything the briefing will show (one steady view for all steps), below the caption bar. */
  const fitBrief = () => {
    const B = X.briefing, S = UI.S, map = UI.app.map;
    if (!B || !S.grid) return;
    let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
    const add = (c, r) => { if (!isFinite(c) || !isFinite(r)) return; c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); };
    B.steps.forEach(({ nd }) => {
      let geo = [];
      try { geo = nd.map && nd.map.geo ? nd.map.geo(B.ev.r) || [] : []; } catch (e) { geo = []; }
      geo.forEach((q) => (q.t === 'pt' ? add(q.c, q.r) : (q.pts || []).forEach(([c, r]) => add(c, r))));
    });
    ['own', 'threat', 'a', 'b'].forEach((k) => { const q = S.markers[k]; if (q && B.sp.group !== 'Sector') add(q.c, q.r); });
    if (!isFinite(c0)) { map.fit(); return; }
    const bar = ($('briefBar') || {}).offsetHeight || 0, padC = 25;
    c0 -= padC; c1 += padC; r0 -= padC; r1 += padC;
    const W = map.W, Hh = map.H - bar - 24;
    const sc = Math.max(0.2, Math.min((W - 60) / (c1 - c0), (Hh - 40) / (r1 - r0), 6));
    map.centerOn((c0 + c1) / 2, (r0 + r1) / 2 - (bar + 24) / 2 / sc, sc);
  };
  X.step = (d) => {
    const B = X.briefing;
    if (!B) return;
    B.k = Math.max(0, Math.min(B.steps.length - 1, B.k + d));
    X.applyBrief();
  };
  X.endBrief = () => {
    if (!X.briefing) return;
    X.briefing = null;
    restoreState();
    renderBar();
    UI.app.refresh({ base: true });
  };
  document.addEventListener('keydown', (e) => {
    if (!X.briefing || /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { X.step(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { X.step(-1); e.preventDefault(); }
    else if (e.key === 'Escape') { X.endBrief(); e.preventDefault(); }
  }, true);

  // ---------------------------------------------------------------- map drawing
  const COL = { ok: '#1f8a3c', mid: '#d08a00', bad: '#c8322b', cand: '#6b7280', key: '#111827', enemy: '#d0342c', own: '#2a62d8', thin: '#d0342c', border: '#7c3aed', in: '#2a62d8' };
  /** Veil over the base map (called by the 2D map after the raster is drawn). */
  UI.briefVeil = (ctx, W, H) => {
    const B = X.briefing;
    if (!B) return;
    ctx.fillStyle = `rgba(255,255,255,${B.veil})`;
    ctx.fillRect(0, 0, W, H);
  };
  UI.drawBrief = (ctx, P) => {
    const B = X.briefing;
    if (!B || !B.geo) return;
    for (const gq of B.geo) {
      const col = COL[gq.s] || COL.key;
      if (gq.t === 'line' && gq.pts && gq.pts.length > 1) {
        ctx.save();
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        const w = gq.s === 'thin' ? 2 : gq.s === 'border' ? 3 : 4;
        if (gq.s === 'thin') ctx.setLineDash([7, 6]);
        ctx.beginPath();
        gq.pts.forEach(([c, r], k) => { const [x, y] = P.xy(c, r); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = w + 3; ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
        ctx.restore();
        if (gq.label) {
          const m = gq.pts[Math.floor(gq.pts.length * 0.55)];
          const [x, y] = P.xy(m[0], m[1]);
          UI.haloText(ctx, gq.label, x + 8, y - 6, { now: true, color: col, size: 12, bold: true });
        }
      } else if (gq.t === 'pt') {
        const [x, y] = P.xy(gq.c, gq.r);
        ctx.save();
        ctx.beginPath();
        const rad = gq.s === 'cand' ? 4 : 6.5;
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fillStyle = gq.s === 'cand' ? 'rgba(255,255,255,0.85)' : col;
        ctx.strokeStyle = gq.s === 'cand' ? col : '#fff';
        ctx.lineWidth = gq.s === 'cand' ? 1.5 : 2;
        ctx.fill(); ctx.stroke();
        if (gq.s === 'bad') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3); ctx.stroke(); }
        ctx.restore();
        if (gq.label) UI.haloText(ctx, gq.label, x + 9, y - 7, { now: true, color: gq.s === 'cand' ? '#374151' : col, size: 12, bold: gq.s !== 'cand' });
      }
    }
  };

  // =====================================================================
  // Printable briefing book (Arial 12, black only)
  // =====================================================================
  /**
   * HTML for the briefing book. opts: { ids, shots: { specId: [{ title, src }] }, title, intro }
   */
  X.printable = (opts = {}) => {
    const ids = opts.ids || SPECS.map((s) => s.id);
    const S = UI.S;
    let toc = '', body = '';
    ids.forEach((id, k) => {
      const sp = X.get(id), ev = X.evaluate(sp), d = X.svg(ev, { print: true });
      const shots = (opts.shots && opts.shots[id]) || [];
      toc += `<li>${esc(sp.title)}</li>`;
      body += `<section class="tool"><h2>${k + 1}. ${esc(sp.title)}</h2>
        <p><b>Question it answers.</b> ${esc(sp.q)}</p>
        <h3>The model</h3><div class="dia">${d.svg}</div>
        <p class="small">Ovals with a single line are inputs; rectangles are steps (numbered); ovals with a double line are results. Lines starting with ✗ show how many points were thrown out at that step and why.</p>
        <h3>Step by step${ev.r ? ' (with this run’s numbers)' : ''}</h3>
        <table><tr><th style="width:22%">Box</th><th>What it does</th><th style="width:30%">This run</th></tr>
        ${ev.nodes.map((nd) => `<tr><td><b>${esc(nd.t)}</b><br><span class="small">${nd.k === 'in' ? 'input' : nd.k === 'out' ? 'result' : 'step'}</span></td><td>${esc(nd.d || '')}</td><td>${esc(nd.v || '—')}${nd.rej && nd.rej.length ? `<br>${nd.rej.map(([c, w]) => `✗ ${typeof c === 'number' ? n(c) : esc(c)} ${esc(w)}`).join('<br>')}` : ''}</td></tr>`).join('')}</table>
        ${shots.map((sh) => `<figure><img src="${sh.src}"><figcaption>${esc(sh.title)}</figcaption></figure>`).join('')}
        <h3>How to read the result</h3><ul>${ev.read.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>If you get nothing, or it fails</h3><table><tr><th>You see</th><th>Why</th><th>What to do</th></tr>${sp.none.map((x) => `<tr>${x.map((y) => `<td>${esc(y)}</td>`).join('')}</tr>`).join('')}</table>
        ${ev.script.length ? `<h3>What to say when briefing</h3><ol>${ev.script.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
      </section>`;
    });
    const title = opts.title || 'MtnEye — How Each Tool Thinks';
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      @page { size: A4; margin: 18mm 16mm; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; color: #000; background: #fff; line-height: 1.35; }
      h1 { font-size: 20pt; margin: 0 0 8pt; } h2 { font-size: 15pt; margin: 0 0 6pt; border-bottom: 1px solid #000; padding-bottom: 3pt; }
      h3 { font-size: 12.5pt; margin: 12pt 0 4pt; } p, li { margin: 3pt 0; } .small { font-size: 10pt; }
      section.tool { page-break-before: always; } table { border-collapse: collapse; width: 100%; margin: 4pt 0; font-size: 10.5pt; }
      th, td { border: 1px solid #000; padding: 3pt 5pt; vertical-align: top; text-align: left; } th { background: #fff; }
      .dia { text-align: center; } .dia svg { max-width: 100%; height: auto; max-height: 215mm; } figure { margin: 8pt 0; page-break-inside: avoid; } figure img { width: 100%; border: 1px solid #000; }
      figcaption { font-size: 10pt; font-style: italic; } tr { page-break-inside: avoid; }
    </style></head><body>
      <h1>${esc(title)}</h1>
      ${opts.intro || `<p>Every MtnEye tool answers one question. This book shows, for each tool, the question, the steps the computer takes (as a ModelBuilder-style diagram), the numbers from ${S.grid ? `the run on ${esc(S.grid.name || 'this terrain')}` : 'a run'}, how to read the result, what it means when the tool finds nothing or fails, and a short script for briefing.</p>`}
      <p><b>Tools covered</b></p><ol>${toc}</ol>
      ${body}</body></html>`;
  };
  X.print = () => {
    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to print the briefing book.'); return; }
    w.document.write(X.printable({ ids: [X.cur] }));
    w.document.close();
    setTimeout(() => w.print(), 300);
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
