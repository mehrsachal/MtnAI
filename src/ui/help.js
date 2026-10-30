/* MtnAI ui — help / doctrine notes (rendered into the Help dialog). */
(function (UI) {
  'use strict';

  UI.helpHTML = () => {
    const M = UI.M;
    const sym = (s) => UI.symbolHTML(s, 24);
    const prof = Object.values(M.MOVEMENT_PROFILES).map((p) => `<tr><td>${p.name}</td><td>≤ ${p.go}°</td><td>≤ ${p.slow}°</td><td>&gt; ${p.slow}°</td><td>${p.speed} / ${p.road} km/h</td></tr>`).join('');
    const wpn = M.WEAPON_GROUPS.map((gr) => gr.ids.map((id) => {
      const w = M.WEAPONS[id];
      return `<tr><td>${sym(UI.SYM.weapon(w))}</td><td>${w.name}</td><td>${gr.name}</td><td>${w.minR}–${w.maxR} m</td><td>${M.MOVEMENT_PROFILES[w.access].name}</td></tr>`;
    }).join('')).join('');
    return `
<h2>MtnAI — mountain terrain analysis</h2>
<p>An offline GIS decision aid for planning operations in mountains. It reads a digital elevation model (DEM), derives slope, aspect,
landforms and mobility, and suggests posts, weapon sites, minefields and routes from the terrain. All processing runs in this browser —
no internet connection or server is used.</p>

<h3>Quick start</h3>
<ol>
<li><b>Data</b> — open SRTM <code>.hgt</code> tiles, a GeoTIFF or an ASCII grid (or the synthetic demo). Use <i>Crop to area</i> to analyse a sector at full resolution.</li>
<li><b>Terrain</b> — choose the base layer (relief, elevation, slope, aspect, landforms, ruggedness), contours and grid; detect dominating heights and passes.</li>
<li><b>Mobility</b> — pick a movement class and compute GO / SLOW-GO / NO-GO. Digitise rivers / glaciers as No-Go areas and jeep / mule tracks.</li>
<li><b>Tactical</b> — place <i>Own position</i> and <i>Enemy</i>, then run enemy observation, avenues of approach, posts, weapon sites and minefields.</li>
<li><b>Routes</b> — place A and B, choose movement class and mode (fastest / balanced / covered), find routes and suggest picquets.</li>
<li><b>Export</b> — GeoJSON (with APP-6D SIDCs) for other GIS / C2 tools, ASCII grids, PNG, plan files and a printable assessment report.</li>
</ol>

<h3>Mouse &amp; keys</h3>
<table><tr><td>2D</td><td>drag = pan · wheel = zoom · click symbol = select</td></tr>
<tr><td>3D</td><td>drag = orbit · right-drag / Shift-drag = pan · wheel = zoom · double-click = recentre</td></tr>
<tr><td>Keys</td><td><kbd>2</kbd>/<kbd>3</kbd> switch view · <kbd>F</kbd> fit · <kbd>Esc</kbd> cancel tool / fly-through · <kbd>?</kbd> help</td></tr></table>

<h3>Method (OAKOC)</h3>
<ul>
<li><b>Observation &amp; fields of fire</b> — radial viewsheds with earth curvature and refraction (k = 0.13). Posts are chosen by greedy maximum coverage of likely enemy movement ground; weapon sites maximise visible target ground inside the weapon's range band, rewarding enfilade (flanking) fire.</li>
<li><b>Avenues of approach</b> — least-time paths for the enemy's movement class from the enemy to own position (three alternatives).</li>
<li><b>Key terrain</b> — dominating heights from large-scale topographic position; passes / cols from a ring sign-change saddle test.</li>
<li><b>Obstacles</b> — slope-based NO-GO plus digitised features. Minefields are sited at the narrowest defiles on enemy avenues, tied into NO-GO ground, within reach of own troops and preferably under observation.</li>
<li><b>Cover &amp; concealment</b> — enemy observation (likely enemy OPs on high ground near the enemy) drives covered routes and defiladed mortar / gun positions.</li>
</ul>

<h3>Movement classes (editable)</h3>
<table><tr><th>Class</th><th>GO</th><th>SLOW-GO</th><th>NO-GO</th><th>Speed x-country / track</th></tr>${prof}</table>
<p>Foot and animal movement uses Tobler's hiking function (downhill faster than uphill) with an altitude penalty above 2,500 m.
Vehicles slow towards their SLOW-GO limit. Above the snow line vehicles are NO-GO and foot movement is downgraded one class.</p>

<h3>Weapons (indicative open-source data — edit to unit data)</h3>
<table><tr><th></th><th>Weapon</th><th>Group</th><th>Range band</th><th>Access</th></tr>${wpn}</table>
<p>Indirect-fire positions must reach the target area, lie behind own troops, be hidden from enemy observation where possible, and pass a
crest-clearance check (simplified vacuum trajectory calibrated to maximum range; mortars use high angle only, the 130 mm gun low angle only).</p>

<h3>Symbology (APP-6D / MIL-STD-2525D)</h3>
<table>
<tr><td>${sym(UI.SYM.own('battalion'))}</td><td>Own position (mountain infantry; echelon amplifier)</td><td>${sym(UI.SYM.threat('foot'))}</td><td>Enemy (hostile)</td></tr>
<tr><td>${sym(UI.SYM.post('platoon'))}</td><td>Suggested defended post (planned = dashed frame)</td><td>${sym(UI.SYM.op())}</td><td>Observation post</td></tr>
<tr><td>${sym(UI.SYM.weapon(M.WEAPONS.mg3))}</td><td>Weapon site (equipment; bars = range class)</td><td>${sym(UI.SYM.weapon(M.WEAPONS.mor81))}</td><td>Mortar position</td></tr>
<tr><td>${sym(UI.SYM.mine('AT'))}</td><td>AT mine (minefield)</td><td>${sym(UI.SYM.mine('AP'))}</td><td>AP mine</td></tr>
<tr><td>${sym(UI.SYM.sp())}</td><td>Start point (A)</td><td>${sym(UI.SYM.rp())}</td><td>Release point (B)</td></tr>
<tr><td>${sym(UI.SYM.cp(1))}</td><td>Checkpoint</td><td>${sym(UI.SYM.target())}</td><td>Target reference / target area</td></tr></table>

<h3>Limitations</h3>
<p>Results depend on DEM quality and resolution (SRTM 30 m smooths cliffs and narrow nullahs). Vegetation, snow, soil, rivers, built-up
areas and enemy dispositions are not modelled unless digitised. Every suggestion is a planning aid to focus reconnaissance — not a
substitute for it.</p>
<p class="hint">Symbol geometry follows APP-6D / MIL-STD-2525D as implemented in the MIT-licensed milsymbol library (© Måns Beckman).</p>`;
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
