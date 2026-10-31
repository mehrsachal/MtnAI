/* MtnAI ui — user guide, keyboard shortcuts and about (rendered into the Help dialog). */
(function (UI) {
  'use strict';

  UI.helpHTML = (section = 'guide') => {
    const M = UI.M;
    const sym = (s) => UI.symbolHTML(s, 22);
    if (section === 'keys') {
      const keys = [
        ['Ctrl+O', 'Add Data (open elevation model)'], ['Ctrl+S', 'Save plan'], ['Ctrl+P', 'Terrain assessment report'], ['Ctrl+,', 'Settings'],
        ['Ctrl+K or /', 'Command search'], ['Ctrl+G', 'Go To XY'], ['Ctrl+B', 'Contents pane'], ['Ctrl+T', 'Attribute table'], ['Ctrl+J', 'Toggle attribute table / profile dock'],
        ['2 / 3', 'Map view / Scene view'], ['F', 'Zoom to full extent'], ['+ / −', 'Zoom in / out'], ['M', 'Measure'], ['L', 'Line of sight'], ['V', 'Viewshed'],
        ['Esc', 'Cancel tool, drawing or fly-through'], ['F1', 'User guide'],
      ];
      return { title: 'Keyboard shortcuts', html: `<table>${keys.map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join('')}</table>
        <h3>Mouse</h3><table><tr><td>2D</td><td>drag = pan · wheel = zoom · click = select / inspect · double-click = zoom in</td></tr>
        <tr><td>3D</td><td>drag = orbit · right-drag or Shift-drag = pan · wheel = zoom · double-click = recentre</td></tr></table>` };
    }
    if (section === 'about') {
      return { title: 'About MtnAI', html: `<h2>MtnAI ${M.VERSION}</h2>
        <p>Offline GIS decision aid for mountain operations. All processing runs locally in the browser; no data leaves the computer.</p>
        <table><tr><td>Analysis CRS</td><td>WGS 84 / UTM (zone of the DEM, or forced in Settings)</td></tr>
        <tr><td>Supported CRSs</td><td>${Object.values(M.CRS_PRESETS).map((c) => c.name).join(' · ')} · custom TM / LCC on any listed datum</td></tr>
        <tr><td>Reference formats</td><td>MGRS · UTM · lat/lon (DD, DM, DMS) · GARS · GEOREF · projected E/N and grid references</td></tr>
        <tr><td>Symbology</td><td>APP-6(D) / MIL-STD-2525D; geometry after the MIT-licensed milsymbol library (© Måns Beckman)</td></tr></table>
        <p class="hint">Weapon ranges are indicative open-source values and datum-shift parameters are 3-parameter approximations. All suggestions are planning aids to be confirmed by reconnaissance.</p>` };
    }
    const prof = Object.values(M.MOVEMENT_PROFILES).map((p) => `<tr><td>${p.name}</td><td>≤ ${p.go}°</td><td>≤ ${p.slow}°</td><td>&gt; ${p.slow}°</td></tr>`).join('');
    const wpn = M.WEAPON_GROUPS.map((gr) => gr.ids.map((id) => {
      const w = M.WEAPONS[id];
      return `<tr><td>${sym(UI.SYM.weapon(w))}</td><td>${w.name}</td><td>${gr.name}</td><td>${w.minR}–${w.maxR} m</td></tr>`;
    }).join('')).join('');
    return { title: 'User guide', html: `
<h2>MtnAI — mountain terrain analysis</h2>
<p>Load a digital elevation model, derive slope, aspect, landforms and mobility, and site posts, weapons, minefields and routes from the terrain.
Results appear on the 2D map, the 3D terrain, the attribute table (bottom dock) and the properties pane.</p>

<h3>Workspace (ArcGIS Pro conventions)</h3>
<ul>
<li><b>Ribbon</b> — Map (navigate, add data, basemap, inquiry, situation), Analysis (geoprocessing tools), Edit (digitise obstacles, place units, crop), View, Share (plan, exports, report), Settings, Help. Double-click a tab to collapse the ribbon.</li>
<li><b>Contents pane</b> — every layer with visibility check box and legend. Right-click a layer for Zoom To Layer, Attribute Table, Remove, Symbology and Properties; double-click opens Layer Properties (dataset, spatial reference, statistics, transparency).</li>
<li><b>Geoprocessing pane</b> — toolboxes with parameter forms. Every tool remembers its parameters; <i>Reset parameters</i> restores defaults; <i>Environments…</i> opens the analysis settings. Messages show the result after Run; the History tab logs every run.</li>
<li><b>Attributes pane</b> — properties of the selected feature or inspected point in every reference system. <b>Attribute table</b> (bottom dock, Ctrl+T) lists features by layer; click a row to zoom.</li>
<li><b>Map / Scene</b> view tabs switch between the 2D map and the 3D scene.</li>
</ul>

<h3>Workflow</h3>
<ol>
<li><b>Map ▸ Add Data</b> (SRTM .hgt, GeoTIFF, ASCII grid, .zip), <b>Map ▸ Download DEM</b> (AWS Terrain Tiles or OpenTopography — the only network feature; save the GeoTIFF copy to work offline afterwards) or the demo terrain. Data is resampled into one WGS 84 / UTM analysis grid.</li>
<li><b>Settings ▸ Coordinate Systems / Grid Refs</b> — analysis zone, secondary CRS (e.g. Kalianpur 1962 / India zone I), reference format and north reference.</li>
<li><b>Map ▸ Situation</b> — place own position, enemy, target area and route start / end. <b>Edit ▸ Create</b> — digitise No-Go areas (rivers, glaciers, cliffs) and tracks.</li>
<li><b>Analysis ▸ Terrain</b> — Key Terrain and Go / No-Go per movement class (slope limits, snow line, generalisation).</li>
<li><b>Analysis ▸ Visibility / Tactical Siting</b> — Enemy Observation, Avenues, Posts / OPs, Weapon Sites and Minefields. Each tool exposes its full set of constraints and scoring weights.</li>
<li><b>Analysis ▸ Routing</b> — Least-Time Route (fastest / balanced / covered / custom weights), Route Picquets, Fly Route.</li>
<li><b>Share</b> — plan file, GeoJSON, CSV, GeoTIFF / ASCII rasters, PNG and the printable terrain assessment report.</li>
</ol>

<h3>Coordinate systems & grid references</h3>
<ul>
<li><b>Analysis CRS</b> — WGS 84 / UTM, automatic zone or forced (Settings ▸ Coordinate systems). Square cells in metres; MGRS grid lines are straight.</li>
<li><b>Secondary CRS</b> — e.g. Kalianpur 1962 / India zone I or IIa (Lambert Conformal Conic on the Everest 1830 ellipsoid, 3-parameter shift to WGS 84), Kalianpur UTM, or a fully custom TM / LCC definition. Shown in the status bar, properties, attribute table, reports and as an optional map grid.</li>
<li><b>Reference formats</b> — MGRS (2- to 10-figure), UTM, lat/lon DD / DM / DMS, GARS, GEOREF, secondary-CRS E/N or truncated grid references.</li>
<li><b>Go To XY / Convert Coordinates</b> — accept any of these formats and the secondary CRS easting / northing.</li>
<li><b>North reference</b> — grid, true or magnetic. Grid convergence is computed; magnetic declination and annual change are entered from the map margin. The declination diagram shows GN, TN, MN and the grid-magnetic angle.</li>
<li><b>Units</b> — mils (6400 or 6000), degrees or gradians; metric, yards, imperial or nautical distances; metres or feet with an optional geoid / MSL offset.</li>
</ul>

<h3>Method (OAKOC)</h3>
<ul>
<li><b>Observation & fields of fire</b> — radial viewsheds with earth curvature and refraction; greedy maximum-coverage siting; enfilade bonus for direct fire.</li>
<li><b>Avenues of approach</b> — least-time paths for the enemy movement class.</li>
<li><b>Key terrain</b> — dominating heights (regional TPI) and cols (ring saddle test).</li>
<li><b>Obstacles</b> — slope NO-GO plus digitised features; minefields at the narrowest defiles on avenues, tied into NO-GO ground.</li>
<li><b>Cover & concealment</b> — likely enemy OPs drive defilade and covered routes. Indirect-fire sites pass a crest-clearance screen.</li>
</ul>

<h3>Movement classes (defaults — edit in Settings)</h3>
<table><tr><th>Class</th><th>GO</th><th>SLOW-GO</th><th>NO-GO</th></tr>${prof}</table>

<h3>Weapons (indicative defaults — edit in Settings ▸ Weapon data)</h3>
<table><tr><th></th><th>Weapon</th><th>Group</th><th>Range band</th></tr>${wpn}</table>

<h3>Symbology (APP-6D / MIL-STD-2525D)</h3>
<table>
<tr><td>${sym(UI.SYM.own('battalion'))}</td><td>Own position (mountain infantry)</td><td>${sym(UI.SYM.threat('foot'))}</td><td>Enemy</td></tr>
<tr><td>${sym(UI.SYM.post('platoon'))}</td><td>Suggested post (planned)</td><td>${sym(UI.SYM.op())}</td><td>Observation post</td></tr>
<tr><td>${sym(UI.SYM.mine('AT'))}</td><td>AT mine</td><td>${sym(UI.SYM.mine('AP'))}</td><td>AP mine</td></tr>
<tr><td>${sym(UI.SYM.sp())}</td><td>Start point</td><td>${sym(UI.SYM.rp())}</td><td>Release point</td></tr></table>

<h3>Limitations</h3>
<p>Results depend on DEM quality and resolution. Vegetation, snow, water, built-up areas and enemy dispositions are not modelled unless digitised.
Suggestions focus reconnaissance — they do not replace it.</p>` };
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
