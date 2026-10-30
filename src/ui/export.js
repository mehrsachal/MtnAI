/*
 * MtnAI ui — export: GeoJSON (with MIL-STD-2525D / APP-6D SIDCs), ESRI ASCII
 * grid + .prj, PNG snapshot, plan save/load and a printable assessment report.
 */
(function (UI) {
  'use strict';
  const M = UI.M;

  UI.download = (name, data, mime = 'application/octet-stream') => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  // ---------------------------------------------------------------- SIDC (2525D / APP-6D, 20 digits)
  const ECH = { team: '11', squad: '12', section: '13', platoon: '14', company: '15', battalion: '16', regiment: '17', brigade: '18' };
  const sidc = (id, set, entity, opt = {}) => `100${id}${set}${opt.planned ? 1 : 0}0${opt.amp || '00'}${entity}${opt.m1 || '00'}${opt.m2 || '00'}`;
  const WPN_ENTITY = { mg: '1102', atrl: '1117', rcl: '1108', atgm: '1112', mortar: '1114', how: '1109', sam: '1111', adgun: '1105' };
  UI.sidcFor = {
    own: (ech) => sidc(3, '10', '121100', { amp: ECH[ech] || '16', m2: '27' }),
    threat: (t) => sidc(6, '10', t === 'tracked' ? '120500' : t === 'jeep' ? '121102' : '121100', { amp: '16' }),
    post: (ech) => sidc(3, '10', '121100', { amp: ECH[ech] || '14', m2: '27', planned: true }),
    op: () => sidc(3, '25', '160100', { planned: true }),
    weapon: (w) => sidc(3, '15', WPN_ENTITY[w.icon] + '0' + (w.rng || 0), { planned: true }),
    mine: (t) => sidc(3, '25', t === 'AP' ? '280200' : '280300', { planned: true }),
    minefield: () => sidc(3, '25', '270701', { planned: true }),
    sp: () => sidc(3, '25', '131600'), rp: () => sidc(3, '25', '131500'), cp: () => sidc(3, '25', '130300'),
    trp: () => sidc(6, '25', '160300'),
  };

  // ---------------------------------------------------------------- GeoJSON
  UI.toGeoJSON = (S) => {
    const g = S.grid;
    const ll = (c, r) => { const p = M.cellToLatLon(g, r, c); return [+p.lon.toFixed(7), +p.lat.toFixed(7)]; };
    const feats = [];
    const pt = (c, r, props) => feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: ll(c, r) }, properties: Object.assign({ mgrs: M.cellMGRS(g, r, c, 5), elevation_m: Math.round(M.sample(g, S.L.z, r, c)) }, props) });
    const line = (pts, props) => feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(([c, r]) => ll(c, r)) }, properties: props });
    const poly = (pts, props) => feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts.concat([pts[0]]).map(([c, r]) => ll(c, r))] }, properties: props });
    const mk = S.markers;
    if (mk.own) pt(mk.own.c, mk.own.r, { kind: 'own_position', echelon: S.ownEchelon, sidc: UI.sidcFor.own(S.ownEchelon) });
    if (mk.threat) pt(mk.threat.c, mk.threat.r, { kind: 'enemy', threat: S.threatType, sidc: UI.sidcFor.threat(S.threatType) });
    if (mk.target) pt(mk.target.c, mk.target.r, { kind: 'target_area', sidc: UI.sidcFor.trp() });
    if (mk.a) pt(mk.a.c, mk.a.r, { kind: 'route_start', sidc: UI.sidcFor.sp() });
    if (mk.b) pt(mk.b.c, mk.b.r, { kind: 'route_end', sidc: UI.sidcFor.rp() });
    if (S.key) {
      S.key.peaks.forEach((p) => pt(p.c, p.r, { kind: 'dominating_height' }));
      S.key.passes.forEach((p) => pt(p.c, p.r, { kind: 'pass' }));
    }
    if (S.posts) S.posts.posts.forEach((p) => pt(p.c, p.r, {
      kind: S.posts.mode === 'op' ? 'observation_post' : 'defended_post', id: p.id, echelon: S.posts.echelon,
      visible_km2: +p.visibleKm2.toFixed(2), approach_coverage_pct: +(p.valueShare * 100).toFixed(1), landform: p.landform,
      access_h: p.accessH === null ? null : +p.accessH.toFixed(2),
      sidc: S.posts.mode === 'op' ? UI.sidcFor.op() : UI.sidcFor.post(S.posts.echelon),
    }));
    S.weapons.forEach((res) => res.sites.forEach((s) => pt(s.c, s.r, Object.assign({
      kind: 'weapon_site', id: s.id, weapon: res.weapon.name, category: s.cat, max_range_m: s.maxR, landform: s.landform,
      access_h: s.accessH === null ? null : +s.accessH.toFixed(2), sidc: UI.sidcFor.weapon(res.weapon),
    }, s.sector ? {
      sector_left_mils: Math.round(M.mils(s.sector.left)), sector_right_mils: Math.round(M.mils(s.sector.right)),
      principal_direction_mils: Math.round(M.mils(s.sector.mean)), target_area_coverage_pct: +(s.valueShare * 100).toFixed(1),
    } : {
      range_to_target_m: Math.round(s.rangeToTargetM), bearing_mils: Math.round(M.mils(s.bearingDeg)),
      quadrant_elevation_mils: s.qeDeg === null ? null : Math.round(M.mils(s.qeDeg)), trajectory: s.angleMode,
      crest_clearance_pct: Math.round(s.clearShare * 100), hidden_from_enemy_obs: s.hidden,
    }))));
    if (S.mfd) {
      S.mfd.fields.forEach((f) => poly(f.poly, {
        kind: 'minefield', id: f.id, type: f.type, front_m: Math.round(f.frontM), depth_m: Math.round(f.depthM), gap_m: Math.round(f.gapM),
        est_mines: f.estMines, on_avenues: f.onAvenues.join(','), covered_by_observation: f.covered, mgrs: f.mgrs, sidc: UI.sidcFor.minefield(),
      }));
    }
    if (S.avenues) S.avenues.routes.forEach((rt, k) => line(rt.line, { kind: 'enemy_avenue_of_approach', index: k + 1, length_km: +(rt.lengthM / 1000).toFixed(2), time_h: +rt.timeH.toFixed(2) }));
    if (S.routes) S.routes.routes.forEach((rt, k) => {
      line(rt.line, { kind: 'route', index: k + 1, primary: k === (S.routes.sel || 0), movement: S.routes.profile, mode: S.routes.mode,
        length_km: +(rt.lengthM / 1000).toFixed(2), time_h: +rt.timeH.toFixed(2), ascent_m: Math.round(rt.ascentM), descent_m: Math.round(rt.descentM),
        max_grade_deg: +rt.maxGradeDeg.toFixed(1), slow_go_pct: Math.round(rt.slowFrac * 100), exposed_pct: Math.round(rt.exposedFrac * 100) });
      if (k === (S.routes.sel || 0)) rt.checkpoints.forEach((cp, i) => pt(cp.c, cp.r, { kind: 'checkpoint', id: `CKP ${i + 1}`, chainage_km: +(cp.d / 1000).toFixed(2), sidc: UI.sidcFor.cp() }));
    });
    if (S.picquets) S.picquets.picquets.forEach((p) => pt(p.c, p.r, { kind: 'picquet', id: p.id, route_from_km: p.routeFromKm, route_to_km: p.routeToKm, climb_h: +p.climbH.toFixed(2), sidc: UI.sidcFor.post('section') }));
    if (S.hostile) S.hostile.observers.filter((o) => !o.isThreat).forEach((o) => pt(o.c, o.r, { kind: 'likely_enemy_op' }));
    S.obstacles.forEach((p, k) => poly(p, { kind: 'obstacle_nogo', index: k + 1 }));
    S.tracks.forEach((t, k) => line(t, { kind: 'track', index: k + 1 }));
    return {
      type: 'FeatureCollection',
      name: 'MtnAI plan',
      metadata: { generator: 'MtnAI ' + M.VERSION, dem: g.name, utm_zone: `${g.zone}${g.north ? 'N' : 'S'}`, cell_size_m: g.cs, created: new Date().toISOString() },
      features: feats,
    };
  };

  // ---------------------------------------------------------------- ESRI ASCII grid
  UI.toASC = (g, arr, decimals = 2, nodata = -9999) => {
    const lines = [`ncols ${g.w}`, `nrows ${g.h}`, `xllcorner ${g.x0}`, `yllcorner ${g.y0 - g.h * g.cs}`, `cellsize ${g.cs}`, `NODATA_value ${nodata}`];
    for (let r = 0; r < g.h; r++) {
      const row = new Array(g.w);
      for (let c = 0; c < g.w; c++) {
        const v = arr[r * g.w + c];
        row[c] = v === v ? (decimals ? (+v).toFixed(decimals) : String(Math.round(v))) : String(nodata);
      }
      lines.push(row.join(' '));
    }
    return lines.join('\n') + '\n';
  };

  // ---------------------------------------------------------------- plan (JSON)
  /** Remap every {r, c} object and [c, r] pair inside known keys between two grids. */
  UI.remapPlan = (obj, from, to) => {
    const map = (c, r) => {
      const E = from.x0 + (c + 0.5) * from.cs, N = from.y0 - (r + 0.5) * from.cs;
      let e = E, n = N;
      if (from.zone !== to.zone) { const ll = M.fromUTM(E, N, from.zone, from.north); const u = M.toUTM(ll.lat, ll.lon, to.zone); e = u.E; n = u.N; }
      return [(e - to.x0) / to.cs - 0.5, (to.y0 - n) / to.cs - 0.5];
    };
    const LINE_KEYS = new Set(['line', 'poly', 'obstacles', 'tracks']);
    const walk = (o, key) => {
      if (Array.isArray(o)) {
        if (LINE_KEYS.has(key) && o.length && Array.isArray(o[0]) && typeof o[0][0] === 'number') return o.map(([c, r]) => map(c, r));
        if (LINE_KEYS.has(key)) return o.map((x) => walk(x, key));
        return o.map((x) => walk(x, null));
      }
      if (o && typeof o === 'object') {
        const out = {};
        for (const k in o) out[k] = walk(o[k], k);
        if (typeof o.r === 'number' && typeof o.c === 'number') { const [c, r] = map(o.c, o.r); out.c = c; out.r = r; }
        return out;
      }
      return o;
    };
    return walk(obj, null);
  };

  // ---------------------------------------------------------------- report
  UI.reportHTML = (S, images) => {
    const g = S.grid, st = S.stats;
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const mg = (p) => M.cellMGRS(g, p.r, p.c, 4);
    const km = (m) => (m / 1000).toFixed(1);
    const tbl = (head, rows) => rows.length ? `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="na">Not computed.</p>';
    const sym = (spec) => UI.symbolHTML(spec, 22);
    const mk = S.markers;
    let html = `<!doctype html><html><head><meta charset="utf-8"><title>Terrain assessment — ${esc(g.name)}</title><style>
      body{font:12px/1.45 "Segoe UI",Arial,sans-serif;color:#111;margin:24px auto;max-width:960px;padding:0 16px}
      h1{font-size:20px;margin:0 0 4px} h2{font-size:14px;border-bottom:2px solid #4a5a33;padding-bottom:3px;margin-top:22px;color:#33401f}
      table{border-collapse:collapse;width:100%;margin:6px 0} th,td{border:1px solid #bbb;padding:3px 6px;text-align:left;vertical-align:middle} th{background:#e7ead9}
      .kv{display:grid;grid-template-columns:200px 1fr;gap:2px 12px} .kv b{font-weight:600}
      .banner{background:#33401f;color:#fff;padding:6px 10px;font-weight:600;letter-spacing:.5px}
      img.map{width:100%;border:1px solid #888;margin:6px 0} .na{color:#777;font-style:italic} .note{color:#555;font-size:11px}
      .bar{display:flex;height:14px;border:1px solid #888;margin:4px 0}.bar i{display:block;height:100%}
      @media print{button{display:none} h2{break-after:avoid} table,img{break-inside:avoid}}
      </style></head><body>
      <div class="banner">TERRAIN ASSESSMENT — PLANNING AID · verify all sites by ground reconnaissance</div>
      <h1>${esc(g.name)}</h1><p class="note">Generated by MtnAI ${M.VERSION} on ${new Date().toLocaleString()} · UTM zone ${g.zone}${g.north ? 'N' : 'S'} (WGS 84) · grid references MGRS (10 m)</p>
      <button onclick="print()">Print / save as PDF</button>
      <h2>1. Area and elevation model</h2><div class="kv">
      <b>Extent</b><span>${st.widthKm.toFixed(1)} × ${st.heightKm.toFixed(1)} km (${st.areaKm2.toFixed(0)} km²)</span>
      <b>NW / SE corners</b><span>${M.cellMGRS(g, 0, 0, 4)} / ${M.cellMGRS(g, g.h - 1, g.w - 1, 4)}</span>
      <b>Cell size</b><span>${g.cs} m (${g.w} × ${g.h} cells)</span>
      <b>Elevation</b><span>${Math.round(st.elevMin)} – ${Math.round(st.elevMax)} m (mean ${Math.round(st.elevMean)} m, relief ${Math.round(st.relief)} m)</span>
      <b>Slope</b><span>mean ${st.slopeMean.toFixed(1)}°, max ${st.slopeMax.toFixed(0)}°; ${((st.slopeHist.slice(5).reduce((a, b) => a + b, 0)) * 100).toFixed(0)}% steeper than 30°</span>
      <b>Landforms</b><span>${M.LANDFORMS.map((l, k) => `${l.name} ${(st.landformFrac[k] * 100).toFixed(0)}%`).join(' · ')}</span></div>`;
    for (const im of images) html += `<img class="map" src="${im}">`;
    html += `<h2>2. Mobility (Go / Slow-Go / No-Go)</h2>`;
    const mobRows = Object.entries(S.mobStats || {}).map(([id, s]) => {
      const p = M.MOVEMENT_PROFILES[id];
      return [esc(p.name), `${(s.go * 100).toFixed(0)}%`, `${(s.slow * 100).toFixed(0)}%`, `${(s.nogo * 100).toFixed(0)}%`,
        `<div class="bar"><i style="width:${s.go * 100}%;background:#3fa34d"></i><i style="width:${s.slow * 100}%;background:#e3a72f"></i><i style="width:${s.nogo * 100}%;background:#d9433b"></i></div>`];
    });
    html += tbl(['Movement class', 'GO', 'SLOW-GO', 'NO-GO', ''], mobRows);
    if (S.obstacles.length || S.tracks.length) html += `<p class="note">${S.obstacles.length} digitised No-Go areas and ${S.tracks.length} tracks applied.</p>`;
    html += `<h2>3. Situation and key terrain</h2>`;
    html += tbl(['', 'Item', 'Grid ref', 'Elevation'], [
      mk.own && [sym(UI.SYM.own(S.ownEchelon)), 'Own position', mg(mk.own), `${Math.round(M.sample(g, S.L.z, mk.own.r, mk.own.c))} m`],
      mk.threat && [sym(UI.SYM.threat(S.threatType)), `Enemy (${esc(S.threatType)})`, mg(mk.threat), `${Math.round(M.sample(g, S.L.z, mk.threat.r, mk.threat.c))} m`],
      mk.target && [sym(UI.SYM.target()), 'Target area', mg(mk.target), `${Math.round(M.sample(g, S.L.z, mk.target.r, mk.target.c))} m`],
    ].filter(Boolean));
    if (S.key) {
      html += tbl(['Dominating heights', 'Grid ref', 'Elevation', 'Local dominance'], S.key.peaks.slice(0, 12).map((p, k) => [`H${k + 1}`, mg(p), `${Math.round(p.z)} m`, `+${Math.round(p.prominence)} m`]));
      html += tbl(['Passes / cols', 'Grid ref', 'Elevation'], S.key.passes.map((p, k) => [`Col ${k + 1}`, mg(p), `${Math.round(p.z)} m`]));
    }
    if (S.avenues) html += tbl(['Enemy avenue of approach', 'Length', 'Est. time'], S.avenues.routes.map((r, k) => [`AA ${k + 1}`, `${km(r.lengthM)} km`, `${r.timeH.toFixed(1)} h`]));
    html += `<h2>4. Posts / OPs</h2>`;
    html += S.posts ? tbl(['', 'Post', 'Grid ref', 'Elevation', 'Visible area', 'Approach coverage', 'Access (foot)', 'Landform'], S.posts.posts.map((p) => [
      sym(S.posts.mode === 'op' ? UI.SYM.op() : UI.SYM.post(S.posts.echelon)), p.id, mg(p), `${Math.round(p.z)} m`, `${p.visibleKm2.toFixed(1)} km²`, `${(p.valueShare * 100).toFixed(1)}%`,
      p.accessH === null ? '—' : `${p.accessH.toFixed(1)} h`, esc(p.landform)])) +
      `<p class="note">Combined coverage of likely enemy movement ground: ${(S.posts.coverageShare * 100).toFixed(0)}%. Intervisible pairs: ${S.posts.links.map(([a, b]) => `${S.posts.posts[a].id}–${S.posts.posts[b].id}`).join(', ') || 'none'}.</p>` : '<p class="na">Not computed.</p>';
    html += `<h2>5. Weapon sites</h2>`;
    if (!S.weapons.length) html += '<p class="na">Not computed.</p>';
    for (const res of S.weapons) {
      const w = res.weapon;
      html += `<h3 style="font-size:12.5px;margin:10px 0 2px">${sym(UI.SYM.weapon(w))} ${esc(w.name)} — range ${w.minR}–${w.maxR} m</h3>`;
      html += w.cat === 'indirect'
        ? tbl(['Site', 'Grid ref', 'Range to tgt', 'Bearing', 'QE', 'Trajectory', 'Crest clearance', 'Hidden from enemy obs'], res.sites.map((s) => [
          s.id, mg(s), `${km(s.rangeToTargetM)} km`, `${Math.round(M.mils(s.bearingDeg))} mils`, s.qeDeg === null ? '—' : `${Math.round(M.mils(s.qeDeg))} mils`,
          s.angleMode || '—', `${Math.round(s.clearShare * 100)}%`, s.hidden ? 'yes' : `no (${s.hostileCount} OPs)`]))
        : tbl(['Site', 'Grid ref', 'Elevation', 'Arc of fire (L–R)', 'PDF', 'Mean range', 'Coverage', 'Landform'], res.sites.map((s) => [
          s.id, mg(s), `${Math.round(s.z)} m`, s.sector ? `${Math.round(M.mils(s.sector.left))}–${Math.round(M.mils(s.sector.right))} mils` : '—',
          s.sector ? `${Math.round(M.mils(s.sector.mean))} mils` : '—', `${Math.round(s.meanRangeM)} m`, `${(s.valueShare * 100).toFixed(1)}%`, esc(s.landform)]));
    }
    html += `<h2>6. Minefields (Mfd)</h2>`;
    html += S.mfd ? tbl(['', 'Mfd', 'Type', 'Centre', 'Gap', 'Front × depth', 'Est. mines', 'On avenue', 'Observed'], S.mfd.fields.map((f) => [
      sym(UI.SYM.mine(f.type)), f.id, f.type, mg(f), `${Math.round(f.gapM)} m`, `${Math.round(f.frontM)} × ${Math.round(f.depthM)} m`, f.estMines,
      f.onAvenues.length ? 'AA ' + f.onAvenues.join(', ') : '—', f.covered ? 'yes' : 'NO — site OP / weapons'])) : '<p class="na">Not computed.</p>';
    html += `<h2>7. Routes</h2>`;
    if (S.routes) {
      html += `<p class="note">${esc(M.MOVEMENT_PROFILES[S.routes.profile].name)} · mode: ${esc(S.routes.mode)}</p>`;
      html += tbl(['Route', 'Length', 'Time', 'Ascent / descent', 'Max grade', 'Slow-Go', 'Exposed to enemy obs', 'Highest point'], S.routes.routes.map((r, k) => [
        `R${k + 1}${k === (S.routes.sel || 0) ? ' (selected)' : ''}`, `${km(r.lengthM)} km`, `${r.timeH.toFixed(1)} h`, `+${Math.round(r.ascentM)} / −${Math.round(r.descentM)} m`,
        `${r.maxGradeDeg.toFixed(0)}°`, `${Math.round(r.slowFrac * 100)}%`, `${Math.round(r.exposedFrac * 100)}%`, `${Math.round(r.highestM)} m`]));
      const sel = S.routes.routes[S.routes.sel || 0];
      if (sel && sel.checkpoints.length) html += tbl(['Checkpoint', 'Grid ref', 'Chainage'], sel.checkpoints.map((c, k) => [`CKP ${k + 1}`, mg(c), `${km(c.d)} km`]));
    } else html += '<p class="na">Not computed.</p>';
    if (S.picquets) html += tbl(['Picquet', 'Grid ref', 'Elevation', 'Protects (km)', 'Climb from route'], S.picquets.picquets.map((p) => [
      p.id, mg(p), `${Math.round(p.z)} m`, p.routeFromKm === null ? '—' : `${p.routeFromKm.toFixed(1)}–${p.routeToKm.toFixed(1)}`, `${p.climbH.toFixed(1)} h`])) +
      `<p class="note">Route observed by picquets: ${Math.round(S.picquets.routeCoverage * 100)}%.</p>`;
    html += `<h2>Notes</h2><p class="note">Analysis is derived from the elevation model only (resolution ${g.cs} m). Vegetation, snow cover, soil, water,
      built-up areas and man-made obstacles are not represented unless digitised. Weapon ranges are indicative open-source figures and crest
      clearance uses a simplified trajectory model. All suggestions are decision aids and must be confirmed by reconnaissance and unit data.</p>
      </body></html>`;
    return html;
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
