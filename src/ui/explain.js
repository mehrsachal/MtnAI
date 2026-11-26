/*
 * MtnEye ui — "Explain This" methodology panels and the Reference Library.
 *
 * Every explanation is assembled from three things only:
 *   1. the method actually implemented in this file's core modules (described below, next to
 *      the function it documents),
 *   2. the parameters recorded when the result was produced (S.lastRun / S.runs), and
 *   3. the references already present in MtnEye (GSP / IPB citations extracted at run time
 *      from the tool descriptions, the doctrine table and the core source comments) plus a
 *      short list of published literature for the standard algorithms.
 * Where the application cannot establish an answer it says so ("Not available — …").
 * No page numbers, document numbers or quotations are invented.
 */
(function (UI) {
  'use strict';
  const M = UI.M, cfg = UI.cfg;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const NA = (why) => `<span class="na">Not available${why ? ' — ' + esc(why) : ''}</span>`;

  // =================================================================== reference library
  const NOT_REC = 'Not recorded in MtnEye’s source material';
  UI.REFS = {
    'gsp-mw': { kind: 'Doctrine', title: 'GSP Mountain Warfare (pamphlet)', number: NOT_REC, page: NOT_REC,
      relevance: 'Primary doctrinal source cited throughout MtnEye (march rates, route card, defence, observation, obstacles, fire, helicopter landing sites, sector defence). Section and paragraph numbers below are exactly those quoted in the application; page numbers are not available.' },
    ipb: { kind: 'Doctrine', title: 'IPB Basic Book — terrain classification', number: NOT_REC, page: NOT_REC, section: 'Terrain classification: obstacles, GO / SLOW-GO / NO-GO',
      relevance: 'Slope limits used by the Go / No-Go classification: GO below 30 %, SLOW-GO 30–45 % uphill, NO-GO 45 % or more uphill; optional elevation variation per km (100 / 200 m). Also the statement that NO-GO ground slows rather than stops movement, used for movement searches.' },
    app6d: { kind: 'Standard', title: 'NATO APP-6(D) — NATO Joint Military Symbology', number: 'APP-6(D)', page: NOT_REC,
      relevance: 'Frame shapes, affiliation colours, echelon amplifiers, status (planned = dashed) and the 20-digit symbol identification code (SIDC) layout used by the symbol renderer and the GeoJSON export. MtnEye implements a subset; entity codes have not been independently verified here.' },
    mil2525d: { kind: 'Standard', title: 'MIL-STD-2525D — Joint Military Symbology', number: 'MIL-STD-2525D', page: NOT_REC,
      relevance: 'US counterpart of APP-6(D) sharing the same SIDC structure. Referenced by the export module for SIDC generation.' },
    milsymbol: { kind: 'Software', title: 'milsymbol (MIT licence) — Måns Beckman, spatialillusions.com', number: 'Open-source JavaScript library', page: 'n/a',
      relevance: 'The symbol renderer states that its frame and icon geometry follow milsymbol. The library itself is not bundled: MtnEye contains its own lightweight renderer (offline, single file).' },
    horn1981: { kind: 'Literature', title: 'Horn, B. K. P. (1981). Hill shading and the reflectance map. Proceedings of the IEEE, 69(1), 14–47.', number: 'doi:10.1109/PROC.1981.11918', page: '—',
      relevance: 'Third-order finite-difference (3 × 3) gradient used for slope, aspect and hillshade (M.gradient).' },
    weiss2001: { kind: 'Literature', title: 'Weiss, A. (2001). Topographic Position and Landforms Analysis. Poster, ESRI International User Conference, San Diego.', number: '—', page: '—',
      relevance: 'Topographic Position Index (TPI) and slope-position classes (ridge, upper, mid, flat, lower, valley) from standardised TPI. MtnEye uses a square window and a 6° mid-slope / flat threshold (Weiss suggests a circular or annular window and 5°).' },
    riley1999: { kind: 'Literature', title: 'Riley, S. J., DeGloria, S. D., & Elliot, R. (1999). A terrain ruggedness index that quantifies topographic heterogeneity. Intermountain Journal of Sciences, 5(1–4), 23–27.', number: '—', page: '—',
      relevance: 'Original Terrain Ruggedness Index (square root of the summed squared differences to the 8 neighbours). MtnEye computes the mean absolute difference instead — see Wilson et al. (2007).' },
    wilson2007: { kind: 'Literature', title: 'Wilson, M. F. J., O’Connell, B., Brown, C., Guinan, J. C., & Grehan, A. J. (2007). Multiscale terrain analysis of multibeam bathymetry data for habitat mapping on the continental slope. Marine Geodesy, 30(1–2), 3–35.', number: 'doi:10.1080/01490410701295962', page: '—',
      relevance: 'TRI defined as the mean of the absolute differences between a cell and its 8 neighbours — the variant implemented by M.tri.' },
    tobler1993: { kind: 'Literature', title: 'Tobler, W. (1993). Three presentations on geographical analysis and modeling. NCGIA Technical Report 93-1.', number: 'NCGIA TR 93-1', page: '—',
      relevance: 'Hiking function v = 6·exp(−3.5·|grade + 0.05|) km/h. MtnEye uses the same exponential form scaled to each movement class’s level speed (M.moveSpeed).' },
    hart1968: { kind: 'Literature', title: 'Hart, P. E., Nilsson, N. J., & Raphael, B. (1968). A formal basis for the heuristic determination of minimum cost paths. IEEE Transactions on Systems Science and Cybernetics, 4(2), 100–107.', number: 'doi:10.1109/TSSC.1968.300136', page: '—',
      relevance: 'A* search used for least-cost routes (M.astar), with a straight-line / maximum-speed heuristic that never over-estimates.' },
    barnes2014: { kind: 'Literature', title: 'Barnes, R., Lehman, C., & Mulla, D. (2014). Priority-flood: An optimal depression-filling and watershed-labeling algorithm for digital elevation models. Computers & Geosciences, 62, 117–127.', number: 'doi:10.1016/j.cageo.2013.04.024', page: '—',
      relevance: 'Priority-flood depression filling used before D8 flow routing for the nullah and valley networks (M.drainage). Ridge lines use steepest-ascent D8 routing on the unfilled DEM (M.crestFlow), so they lie on the crests.' },
    ocallaghan1984: { kind: 'Literature', title: 'O’Callaghan, J. F., & Mark, D. M. (1984). The extraction of drainage networks from digital elevation data. Computer Vision, Graphics, and Image Processing, 28(3), 323–344.', number: 'doi:10.1016/S0734-189X(84)80011-0', page: '—',
      relevance: 'D8 single-flow-direction routing and flow accumulation (M.drainage).' },
    snyder1987: { kind: 'Literature', title: 'Snyder, J. P. (1987). Map Projections — A Working Manual. U.S. Geological Survey Professional Paper 1395.', number: 'USGS PP 1395', page: '—',
      relevance: 'Transverse Mercator / UTM series formulas used by the geodesy module (M.toUTM, M.fromUTM).' },
    esri: { kind: 'Data source', title: 'Esri World Imagery (tile service)', number: 'server.arcgisonline.com — World_Imagery MapServer', page: 'n/a',
      relevance: 'Default satellite ground layer of the hybrid basemap. Requires internet access. Acquisition dates and per-tile metadata are not retrieved by MtnEye.' },
    eox: { kind: 'Data source', title: 'Sentinel-2 cloudless 2020 by EOX IT Services GmbH', number: 's2maps.eu', page: 'n/a',
      relevance: 'Alternative imagery source (10 m Sentinel-2 mosaic). Requires internet access; licence CC BY-NC-SA 4.0.' },
    terrarium: { kind: 'Data source', title: 'AWS Terrain Tiles (Terrarium encoding)', number: 's3.amazonaws.com/elevation-tiles-prod', page: 'n/a',
      relevance: 'Optional DEM download (blend of SRTM, GMTED, NED, ETOPO). Vertical accuracy depends on the underlying source at each location and is not reported by the tiles.' },
    opentopo: { kind: 'Data source', title: 'OpenTopography Global DEM API', number: 'portal.opentopography.org', page: 'n/a',
      relevance: 'Optional DEM download (COP30, SRTMGL1, NASADEM, AW3D30, SRTMGL3, COP90). API key required.' },
  };

  // ---------------------------------------------------------------- GSP citation index (extracted, never typed in)
  const CITE_RE = /\b(?:Sec(?:tion)?s?\.?\s*\d+(?:\s*[–-]\s*\d+)?(?:\s*para(?:s)?\s*\d+[a-z]?(?:\s*[–-]\s*\d+[a-z]?)?)?|Annex\s+[A-Z](?:\s*para\s*\d+[a-z]?)?)/g;
  const sentenceAround = (text, idx) => {
    const a = Math.max(text.lastIndexOf('. ', idx), text.lastIndexOf('\n', idx), text.lastIndexOf('* ', idx), -1);
    let b = text.indexOf('. ', idx); if (b < 0) b = text.length;
    const nl = text.indexOf('\n', idx); if (nl >= 0 && nl < b) b = nl;
    return text.slice(a + 1, b + 1).replace(/^\s*[*/]+\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 260);
  };
  const normKey = (s) => s.replace(/Sections?\.?/, 'Sec').replace(/Secs?\.?/, 'Sec').replace(/paras?/, 'para').replace(/\s+/g, ' ').replace(/-/g, '–').trim();
  let gspCache = null;
  UI.gspIndex = () => {
    if (gspCache) return gspCache;
    const idx = new Map();
    const add = (where, text, open, whole) => {
      if (!text) return;
      CITE_RE.lastIndex = 0;
      let m;
      while ((m = CITE_RE.exec(text))) {
        const key = normKey(m[0]);
        if (!idx.has(key)) idx.set(key, []);
        const snip = whole ? whole.replace(/\s+/g, ' ').trim().slice(0, 320) : sentenceAround(text, m.index);
        const list = idx.get(key);
        if (!list.some((x) => x.where === where && x.text === snip)) list.push({ where, text: snip, open });
      }
    };
    const T = (UI.GP && UI.GP.TOOLS) || {};
    for (const [id, t] of Object.entries(T)) { if (t.gsp) add(`Tool: ${t.name}`, t.gsp, { tool: id }); }
    try {
      const d = document.createElement('div');
      d.innerHTML = UI.helpHTML('doctrine').html;
      d.querySelectorAll('tr').forEach((tr) => { const td = tr.querySelectorAll('td'); if (td.length >= 3) add(`Help ▸ Doctrine — ${td[0].textContent}`, `${td[0].textContent}. ${td[1].textContent}`, { help: 'doctrine' }, `${td[1].textContent} (Used in: ${td[2].textContent})`); });
    } catch (e) { /* help not available */ }
    for (const f of globalThis.MTN_CORE || []) {
      const src = f.toString();
      // only comment lines that mention the GSP
      const lines = src.split('\n').filter((l) => /^\s*(\/\/|\*|\/\*)/.test(l) || /GSP/.test(l));
      const text = lines.map((l) => l.replace(/^\s*(\/\/+|\/?\*+)\s?/, '')).join('\n');
      text.split(/\n(?=\S)/).forEach((block) => { if (/GSP|Annex/.test(block)) add(`Core code: ${f.name}.js`, block, null); });
    }
    const secNum = (k) => { const m = /(\d+)/.exec(k); return /Annex/.test(k) ? 1000 + k.charCodeAt(k.indexOf('Annex') + 6) : m ? +m[1] : 999; };
    const paraNum = (k) => { const m = /para\s*(\d+)/.exec(k); return m ? +m[1] : 0; };
    gspCache = [...idx.entries()].map(([key, mentions]) => ({ key, mentions })).sort((a, b) => secNum(a.key) - secNum(b.key) || paraNum(a.key) - paraNum(b.key) || a.key.localeCompare(b.key));
    return gspCache;
  };

  // =================================================================== explanation topics
  const fmtVal = (v) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'number' ? (Math.abs(v) >= 100 || Number.isInteger(v) ? String(+v.toFixed(2)) : String(+v.toFixed(4))) : typeof v === 'object' ? (v.r !== undefined && v.c !== undefined && UI.S.grid ? UI.F.listRef(v.r, v.c) : JSON.stringify(v).slice(0, 80)) : String(v));
  /** Parameter rows from a recorded run, labelled with the tool form labels where known. */
  const paramRows = (run, toolId) => {
    if (!run || !run.args) return [];
    const T = (UI.GP && UI.GP.TOOLS[toolId || run.tool || '']) || null;
    const label = (k) => { const p = T && T.params.find((x) => x.k === k); return p && p.label ? p.label : k; };
    const rows = [];
    const walk = (o, pre) => {
      for (const [k, v] of Object.entries(o || {})) {
        const key = pre ? `${pre}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v.r !== undefined && v.c !== undefined)) walk(v, key);
        else if (!(Array.isArray(v) && v.length > 12)) rows.push([label(key), fmtVal(v)]);
      }
    };
    walk(run.args, '');
    return rows;
  };
  const datasetRows = (S) => {
    const g = S.grid;
    if (!g) return [['Dataset', NA('no elevation model loaded')]];
    const F = UI.F;
    return [
      ['Elevation model', esc(g.name)],
      ['Source', g.synthetic ? 'Procedurally generated (fictional terrain) — <b>not real ground</b>' : S.sources ? esc(S.sources.map((s) => s.name).join(', ').slice(0, 200)) : 'Resampled grid'],
      ['Analysis grid', `${g.w} × ${g.h} cells, ${g.cs} m square cells`],
      ['Spatial reference', esc(F.analysisCRSName())],
      ['Vertical datum (user setting)', esc(F.vdatum())],
      ['Resampling on import', esc(cfg('data.resample'))],
      ['Void cells filled', S.filledCells === undefined ? NA('not reported for this dataset') : `${S.filledCells.toLocaleString()} (${((S.filledCells / (g.w * g.h)) * 100).toFixed(2)} %) — iterative 3 × 3 neighbour mean`],
      ['Vertical accuracy', NA('MtnEye does not hold accuracy metadata for the source DEM; consult the dataset documentation')],
    ];
  };
  const recordRows = (run) => (run ? [
    ['Tool', esc(run.label)], ['Run at', esc(new Date(run.t).toLocaleString())], ['Duration', `${(run.dur / 1000).toFixed(2)} s`],
    ['Engine', esc(run.engine || '—')], ['Dataset at run time', esc(run.grid || '—')], ['Result summary', esc(run.summary || '—').replace(/\n/g, '<br>')], ['MtnEye version', esc(M.VERSION)],
  ] : null);

  const T = {}; // topic builders: (ctx) -> {title, sub, sections:[[h, html]], refs:[[id, section]], params, record}
  const L = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const code = (s) => `<code class="fx">${esc(s)}</code>`;

  T.elevation = (c) => ({
    title: 'Elevation model', sub: 'Base raster for every analysis',
    what: 'Height of the terrain surface above the vertical datum in each analysis cell.',
    method: `Imported rasters (SRTM .hgt, GeoTIFF, ASCII grid) are reprojected and resampled (${esc(cfg('data.resample'))}) into one square-cell WGS 84 / UTM grid (cell centre E = x₀ + (c + ½)·cs, N = y₀ − (r + ½)·cs). Voids (NoData) are filled by repeated 3 × 3 neighbour averaging (M.fillNoData). Statistics are computed over all cells.`,
    units: `Metres (displayed in ${esc(UI.F.elevUnit())}${+cfg('units.elevOffset') ? `, with a display offset of ${cfg('units.elevOffset')} m` : ''}).`,
    classes: 'Display only: hypsometric colour ramp from the minimum to the maximum elevation of the loaded extent.',
    meaning: c.S.stats ? `Range ${UI.F.elev(c.S.stats.elevMin)} – ${UI.F.elev(c.S.stats.elevMax)}, mean ${UI.F.elev(c.S.stats.elevMean)}, relief ${UI.F.height(c.S.stats.relief)} over ${UI.F.area(c.S.stats.areaKm2)}.` : NA(),
    assumptions: L(['Most global DEMs (SRTM, Copernicus GLO-30, AW3D30) are surface models: tree canopy and buildings raise the surface.', 'The vertical datum is whatever the user sets in Settings ▸ Units; MtnEye does not convert between geoid and ellipsoid heights.']),
    quality: L(['Resampling smooths peaks and narrow gullies; coarse cells under-state local relief.', 'Filled voids (common on steep, shadowed slopes in radar DEMs) are interpolated, not measured.']),
    errors: L(['Source DEM vertical error, radar layover / shadow in steep terrain, co-registration error between tiles, interpolation in voids.']),
    refs: [['snyder1987', 'UTM projection']],
  });
  T.slope = () => ({
    title: 'Slope', sub: 'Steepness of the terrain surface',
    what: 'The maximum rate of change of elevation in each cell (steepest-descent gradient).',
    method: `Horn (1981) 3 × 3 finite differences on cells a–i (a b c / d e f / g h i):<br>${code('∂z/∂x = ((c + 2f + i) − (a + 2d + g)) / (8·cs)')}<br>${code('∂z/∂y = ((g + 2h + i) − (a + 2b + c)) / (8·cs)')}<br>${code('slope = atan( √((∂z/∂x)² + (∂z/∂y)²) )')}<br>Edge cells re-use the nearest row / column with the step corrected (M.gradient, M.slopeAspect).`,
    units: 'Degrees from horizontal (0–90°). Per cent = 100·tan(slope).',
    classes: `Map colours: ${M.SLOPE_CLASSES.slice(0, -1).map((v, k) => (k === M.SLOPE_CLASSES.length - 2 ? `> ${v}°` : `${v}–${M.SLOPE_CLASSES[k + 1]}°`)).join(' · ')}. Movement thresholds (IPB): 30 % = ${M.IPB.goDeg}° and 45 % = ${M.IPB.slowDeg}°.`,
    meaning: 'Higher values = steeper ground. Slope feeds mobility (GO / SLOW-GO / NO-GO), routing speeds, site constraints and helipad flatness.',
    assumptions: L(['A plane fitted over a 3 × 3 window represents the ground at the cell.', 'Slope is non-directional; uphill / downhill effects are handled only in route speeds.']),
    quality: L([`Slope depends on cell size (${c0().cs} m here): coarse DEMs under-state cliffs and short steep pitches; noisy fine DEMs over-state slope.`]),
    errors: L(['DEM noise and artefacts, void filling (artificially gentle), canopy height steps in surface models.']),
    refs: [['horn1981', ''], ['ipb', 'Terrain classification thresholds']],
  });
  const c0 = () => UI.S.grid || { cs: '—' };
  T.aspect = () => ({
    title: 'Aspect', sub: 'Direction the slope faces',
    what: 'Compass direction of steepest descent (the way the slope faces).',
    method: `From the Horn gradient: ${code('aspect = atan2(−∂z/∂x, ∂z/∂y)')}, measured clockwise from <b>grid north</b>; cells flatter than 1° are “flat” (no aspect).`,
    units: 'Degrees 0–360 clockwise from grid north; status bar shows the selected north reference (grid / true / magnetic) and unit.',
    classes: 'Eight 45° sectors (N, NE, E, SE, S, SW, W, NW) centred on the cardinal directions, plus Flat.',
    meaning: 'South-facing slopes (northern hemisphere) receive more sun — earlier snow-melt and drier ground; north-facing slopes hold snow and ice longer. MtnEye does not model these effects.',
    assumptions: L(['Grid north differs from true north by the grid convergence (shown in the declination diagram).']),
    quality: L(['On near-flat ground aspect is unstable (dominated by DEM noise); hence the 1° flat threshold.']),
    errors: L(['As for slope.']),
    refs: [['horn1981', '']],
  });
  T.hillshade = () => ({
    title: 'Hillshade', sub: 'Illumination model for visualising relief',
    what: 'Brightness of a matte (Lambertian) surface lit by a distant sun — a visual aid, not an analytical result.',
    method: `${code('shade = cos(Z)·cos(S) + sin(Z)·sin(S)·cos(A − asp)')} with Z = 90° − sun altitude, A = sun azimuth, S = slope and asp = aspect from the Horn gradient × z-factor. ${cfg('map.hsMulti') ? 'Multi-directional: weighted blend of four azimuths (A − 90° 0.15, A − 45° 0.25, A 0.40, A + 45° 0.20).' : 'Single direction.'}`,
    units: 'Unitless 0–255 (black = facing away, white = facing the sun).',
    classes: 'Continuous grey ramp.',
    meaning: 'Used only for display (base relief, hybrid basemap relief layer, 3D texture). No analysis reads it.',
    params: [['Sun azimuth', `${cfg('map.hsAzimuth')}°`], ['Sun altitude', `${cfg('map.hsAltitude')}°`], ['Z-factor', cfg('map.hsZ')], ['Multi-directional', cfg('map.hsMulti') ? 'yes' : 'no']],
    assumptions: L(['No cast shadows (only self-shading), no atmosphere.']),
    quality: L(['Cartographic convention lights from the north-west so relief is not perceived inverted; real sun position differs.']),
    errors: L(['Inherits DEM artefacts, which hillshade makes very visible (striping, tile seams).']),
    refs: [['horn1981', '']],
  });
  T.relief = T.hillshade;
  T.landform = () => ({
    title: 'Landforms (Topographic Position Index)', sub: 'Slope position of each cell relative to its neighbourhood',
    what: 'Whether a cell lies higher or lower than its surroundings: ridge, upper slope, mid slope, flat, lower slope or valley.',
    method: `${code('TPI = z − mean(z within a (2r+1)×(2r+1) square window)')} (summed-area table, edges clipped).<br>Local radius r = max(2, round(${cfg('an.tpiSmallM')} m / cs)) cells; regional (dominance) radius = max(5, round(${cfg('an.tpiLargeM')} m / cs)) cells.<br>Classes from the standardised local TPI (z = TPI / σ, σ over the whole loaded grid): z > 1 ridge; 0.5–1 upper slope; −0.5…0.5 mid slope if slope > 6°, else flat; −1…−0.5 lower slope; < −1 valley (M.landforms).`,
    units: 'TPI in metres; classes are categorical.',
    classes: M.LANDFORMS.map((l) => esc(l.name)).join(' · '),
    meaning: 'Ridge and upper-slope cells overlook their surroundings; valley cells are enclosed. The regional TPI (dominance) drives key-terrain and siting scores.',
    params: [['Local TPI radius', `${cfg('an.tpiSmallM')} m`], ['Regional TPI radius', `${cfg('an.tpiLargeM')} m`], ['Mid slope / flat threshold', '6°'], ['Standardisation', 'σ of TPI over the loaded grid']],
    assumptions: L(['A square window approximates the circular / annular neighbourhood of Weiss (2001).', 'Because σ is computed over the loaded extent, <b>class boundaries change when the DEM is cropped or extended</b>.']),
    quality: L(['Class results are scale-dependent: change the radii (Settings ▸ Analysis parameters) to suit the features of interest.']),
    errors: L(['Edge cells have truncated windows; DEM smoothing reduces TPI contrast.']),
    refs: [['weiss2001', 'TPI and slope-position classes']],
  });
  T.tpi = T.landform;
  T.tri = () => ({
    title: 'Terrain Ruggedness (TRI)', sub: 'Local elevation variability',
    what: 'How much the elevation changes between a cell and its eight neighbours.',
    method: `${code('TRI = (1/n) · Σ |zᵢ − z₀|')} over the n ≤ 8 neighbours (mean absolute difference, Wilson et al. 2007 form). Note: Riley et al. (1999) define TRI as √Σ(zᵢ − z₀)²; values are therefore not directly comparable with tools that use Riley’s formula.`,
    units: 'Metres.',
    classes: 'Display ramp from 0 to the 98th percentile of the loaded grid (values above are shown in the darkest colour).',
    meaning: 'Higher TRI = broken, irregular ground (scree, cliffs, gullies).',
    assumptions: L(['Edge cells use fewer neighbours.']),
    quality: L(['TRI scales with cell size; compare values only between grids of the same resolution.']),
    errors: L(['DEM noise inflates TRI on otherwise smooth ground.']),
    refs: [['wilson2007', 'Implemented formula'], ['riley1999', 'Original definition']],
  });
  T.contours = (c) => ({
    title: 'Contours', sub: 'Lines of equal elevation',
    what: 'Isolines of the DEM at a regular height interval.',
    method: `Marching squares on the lattice of cell centres; ambiguous saddle cases resolved by the cell-centre mean; levels offset by 0.1 mm to avoid degenerate crossings (M.contours). Interval ${+cfg('map.contourInterval') ? `${cfg('map.contourInterval')} m (user)` : `${c.S.contours ? c.S.contours.interval : '—'} m (automatic: “nice” value ≥ relief / 40)`}, index contour every ${cfg('map.contourIndex')} lines.`,
    units: 'Metres above the DEM vertical datum.',
    classes: 'Index (thick) and intermediate (thin) contours.',
    meaning: 'Close spacing = steep ground; V-shapes pointing uphill = valleys / nullahs; pointing downhill = spurs.',
    assumptions: L(['Linear interpolation between cell centres.']),
    quality: L(['Contours are derived from the DEM, not surveyed; they inherit its smoothing and voids.']),
    errors: L(['Cell size limits the detail of small features.']),
    refs: [],
  });
  T.imagery = (c) => {
    const im = c.S.imagery || {};
    const src = UI.IMAGERY_SOURCES[im.sourceId] || null;
    const sim = im.status !== 'ready';
    return {
      title: sim ? 'Ground layer — simulated terrain colouring' : `Satellite imagery — ${src ? src.name : ''}`,
      sub: 'Hybrid basemap ground layer',
      what: sim ? '<b>This is not imagery.</b> A terrain-derived colouring (vegetation-like greens on low, gentle ground, scree and rock browns / greys with height and slope, white above the upper 18 % of the elevation range) shown because satellite imagery is not available for this map.' : 'Photographic ground context from a public satellite / aerial imagery mosaic, drawn beneath the topographic and analytical layers.',
      input: sim ? `Reason: ${esc(im.message || 'imagery not requested')}` : `${esc(src.name)} — ${esc(src.attribution)}`,
      method: sim ? 'Colour = blend of fixed colours by relative elevation, slope (rock above ~28–42°) and an elevation-relative snow line, multiplied by the hillshade (UI.simulatedGround).' : `Web Mercator tiles at zoom ${im.z} (≈ ${im.resM ? im.resM.toFixed(1) : '—'} m / pixel at the map centre) are reprojected into the UTM analysis frame with one affine transform per tile fitted to three tile corners (residual well below one display pixel). ${im.loaded} of ${im.tiles} tiles loaded${im.failed ? `, ${im.failed} failed (shown with the simulated colouring)` : ''}.`,
      units: 'Display only (RGB).',
      classes: '—',
      meaning: sim ? 'Use only as a visual backdrop. It says nothing about actual land cover.' : 'Shows real ground cover at the time of image acquisition. It is not used by any analysis.',
      params: sim ? [] : [['Tile URL template', esc(im.url || '—')], ['Zoom level', im.z], ['Acquisition date', NA('the tile service does not report dates to MtnEye')], ['Licence / terms', esc(src.terms)]],
      assumptions: L(sim ? ['Thresholds are cosmetic constants, not a land-cover model.'] : ['DEM and imagery are both referenced to WGS 84; misalignment between them is not corrected.', 'Imagery depicts a different date than the DEM.']),
      quality: L(sim ? ['Not a data source.'] : ['Mosaics combine images from different dates and sensors; cloud, snow and shadow vary between tiles.', 'Horizontal accuracy of the mosaic is set by the provider and is not reported here.']),
      errors: L(sim ? ['—'] : ['Imagery orthorectification errors in steep terrain, seasonal snow cover, different acquisition dates.']),
      refs: sim ? [] : [[im.sourceId === 'eox' ? 'eox' : 'esri', '']],
    };
  };
  T.mobility = (c) => {
    const o = c.S.overlays && c.S.overlays.mobility;
    const p = o && o.info;
    return {
      title: `Go / No-Go mobility${p ? ' — ' + esc(p.name) : ''}`, sub: 'Cross-country movement classification',
      what: 'Classifies each cell as GO (unrestricted), SLOW-GO (restricted) or NO-GO (severely restricted / impassable) for a movement class.',
      method: `Per cell: ${code('GO if slope < go; SLOW-GO if slope < slow; else NO-GO')} (M.classifyMobility). Optional rules applied in order: IPB elevation variation (max − min within a 1 km window ≥ 100 m → SLOW-GO, ≥ 200 m → NO-GO); snow line (vehicles NO-GO, foot one class worse); 3 × 3 majority generalisation (keeps NO-GO cliffs); digitised No-Go polygons forced NO-GO; digitised tracks forced GO.`,
      units: 'Categorical class; areas in the run summary.',
      classes: p ? `GO < ${p.go}° · SLOW-GO ${p.go}–${p.slow}° · NO-GO ≥ ${p.slow}° (${esc(p.src || '')})` : `Infantry / mule / tracked defaults (IPB): GO < ${M.IPB.goDeg}° (30 %), NO-GO ≥ ${M.IPB.slowDeg}° (45 %). Wheeled-vehicle limits are planning values.`,
      meaning: 'An indication of where a movement class can travel cross-country on slope alone. NO-GO does not mean impossible for dismounted troops — routing treats slope NO-GO up to 45° as heavily slowed (×4) for foot movement.',
      params: p ? [['Movement class', esc(p.name)], ['GO limit', `${p.go}°`], ['NO-GO limit', `${p.slow}°`], ['Cross-country / track speed', `${p.speed} / ${p.road} km/h`], ['Limit source', esc(p.src || '—')], ['Snow line', c.S.snowLine ? `${c.S.snowLine} m` : 'off'], ['IPB relief rule', c.S.relief ? 'on' : 'off'], ['Generalised', c.S.generalize ? 'yes' : 'no']] : [],
      assumptions: L(['Slope is the only terrain factor unless obstacles / tracks are digitised: soil, vegetation, water, boulders, snow depth and weather are not modelled.', 'The IPB uphill wording is directional; the per-cell classification is not (route speeds are).']),
      quality: L(['Directly inherits slope accuracy, hence DEM resolution.', 'Wheeled-vehicle thresholds are planning values, not doctrine.']),
      errors: L(['Short steep pitches hidden by coarse cells, unmapped obstacles (rivers, glaciers, walls), surface model canopy.']),
      refs: [['ipb', 'GO / SLOW-GO / NO-GO slope limits'], ['gsp-mw', 'Sec 4 para 13a; Annex H para 5']],
    };
  };
  T.viewshed = (c) => ({
    title: 'Viewshed', sub: 'Ground visible from an observer',
    what: 'Cells from which a target of the given height would be visible to the observer (line of sight not blocked by terrain).',
    method: `Radial sweep (M.viewshed): rays from the observer to every perimeter cell of the bounding square of the radius; along each ray terrain is interpolated across the minor axis and a cell is visible when ${code('(z + h_tgt − d²·(1 − k)/(2R) − z_obs) / d ≥ max elevation angle so far')}, with ${code('z_obs = z(observer) + h_obs')}, R = 6 371 km, k = refraction coefficient${cfg('an.curvature') ? '' : ' (curvature switched off in Settings)'}.`,
    units: 'Binary (visible / not visible); visible area in km².',
    classes: 'Visible (coloured) / not visible (clear).',
    meaning: 'Visible cells could be seen from the observer point; clear cells are masked by terrain (dead ground from this point).',
    params: [['Earth curvature', cfg('an.curvature') ? 'applied' : 'off'], ['Refraction k', cfg('an.refraction')]],
    assumptions: L(['Bare terrain only (vegetation, buildings and weather not modelled unless contained in a surface-model DEM).', 'Observer and target heights are above the DEM surface at cell centres.']),
    quality: L(['Results differ from exact (R3) algorithms by a few cells along visibility boundaries.', 'Sensitive to small DEM errors near the observer.']),
    errors: L(['DEM vertical error, cell-centre sampling, atmospheric refraction varies with conditions.']),
    refs: [['gsp-mw', 'Sec 4 para 15 (observation)']],
  });
  T.los = (c) => ({
    title: 'Line of sight', sub: 'Intervisibility between two points',
    what: 'Whether the straight sight line between observer and target clears the terrain, where it is first blocked, and the minimum clearance.',
    method: `Terrain profile sampled every cs/2 with bilinear interpolation (M.terrainProfile); sight line from ${code('z_A + h_obs')} to ${code('z_B + h_tgt')}; terrain lowered by ${code('d·(D − d)·(1 − k)/(2R)')} for curvature / refraction; masked where clearance < 0 (M.lineOfSight).`,
    units: 'Distances in metres; clearance in metres above terrain.',
    classes: 'Visible / masked; green = clear, red = beyond the first obstruction.',
    meaning: c.S.los && c.S.los.res ? (c.S.los.res.visible ? `Visible — minimum clearance ${UI.F.height(c.S.los.res.clearance)} over ${UI.F.dist(c.S.los.res.distance)}.` : `Masked — first obstruction at ${UI.F.dist(c.S.los.res.profile[c.S.los.res.blockIndex].d)} from the observer.`) : 'Run Line of Sight to see a result.',
    assumptions: L(['Straight optical path; target and observer heights above ground.']),
    quality: L(['A single DEM error spike can block or open the line.']),
    errors: L(['As for viewshed.']),
    refs: [['gsp-mw', 'Sec 18 (fire up- or downhill — sight factor quoted in the result)']],
  });
  T.route = (c) => {
    const R = c.S.routes, run = c.run;
    const rt = R && R.routes[c.ref && c.ref.kind === 'route' ? c.ref.idx : R.sel || 0];
    const prof = R ? UI.app.profileOf(R.profile) : null;
    const mk = c.S.markers;
    const F = UI.F;
    const info = R && rt ? [
      ['Selected start (A)', mk.a ? esc(F.listRef(mk.a.r, mk.a.c)) : NA()], ['Selected destination (B)', mk.b ? esc(F.listRef(mk.b.r, mk.b.c)) : NA()],
      ['Route distance (plan / 3D)', `${F.dist(rt.lengthM)} / ${F.dist(rt.length3dM || rt.lengthM)}`], ['Ascent / descent', `${F.height(rt.ascentM)} / ${F.height(-rt.descentM)}`],
      ['Model travel time', F.time(rt.timeH)], ['GSP march time (day)', rt.gspDay ? `${F.time(rt.gspDay.minH)}–${F.time(rt.gspDay.maxH)}` : '—'],
      ['Elevation profile', 'Bottom dock ▸ Elevation profile (sampled every cell along the simplified line)'],
      ['Movement class', esc(prof ? prof.name : '—')], ['Cost mode', esc(R.mode)], ['Alternatives returned', R.routes.length],
    ] : [];
    return {
      title: `Generated route${rt ? ` R${(c.ref && c.ref.kind === 'route' ? c.ref.idx : R.sel || 0) + 1}` : ''}`, sub: 'How the software produced this line',
      banner: 'This line is the least-cost path through MtnEye’s terrain cost model for the parameters below. It is <b>not</b> a verified, reconnoitred or recommended real-world route.',
      what: 'The path between A and B that minimises the modelled cost (travel time, optionally multiplied by user-weighted penalty layers) for one movement class.',
      info,
      method: `A* search (M.astar) over ${cfg('an.routeNeighbours') === 8 ? '8' : '16'}-connected moves (8 neighbours + knight moves), no corner-cutting through NO-GO cells. Cost of a move = distance / speed × (1 + Σ weighted penalties) × alternative-separation penalty.<br>Foot / animal speed (Tobler form): ${code('v = v_level · exp(−3.5·|grade + 0.05|) / exp(−3.5·0.05)')}, × 0.7 on SLOW-GO, × max(${M.CFG.altFloor}, 1 −${cfg('an.altRate')} % per 1000 m above ${cfg('an.altStart')} m).<br>Vehicles: ${code('v = v_level · max(0.12, 1 − max(grade°, 0.5·slope°) / (slow + 5))')}, × 0.55 on SLOW-GO; track speed on digitised tracks.<br>Slope NO-GO between the class limit and 45° is crossed at ¼ speed by foot movement (IPB); steeper ground and digitised No-Go areas are impassable. Alternatives: cells within the separation distance of earlier routes cost ×3; near-duplicates (≥ 75 % overlap) are dropped. Route statistics and the GSP march time (3 km/h by day, 0.5–1 km/h by night, + 30–60 min per 300 m ascent and per 600 m descent) are computed on the found path.`,
      units: 'Distance m / km, time h, heights m.',
      classes: '—',
      meaning: 'Shows where the model finds movement cheapest. Model time and GSP time are independent estimates; neither accounts for weather, load, acclimatisation or enemy action.',
      params: paramRows(run, 'route'),
      assumptions: L(['Terrain cost from slope only (plus digitised tracks / obstacles).', 'Penalty layers, when weighted, come from other MtnEye models and inherit their assumptions.', 'Straight moves between cell centres; the drawn line is simplified (RDP, 0.6 cell tolerance).']),
      quality: L(['Path geometry is limited by the cell size and the 16-direction move set.', 'Small changes in parameters or DEM can move the path to a different valley.']),
      errors: L(['DEM and slope errors, unmapped obstacles (rivers, crevasses, cliffs below cell size), movement model constants.']),
      refs: [['hart1968', 'A* search'], ['tobler1993', 'Hiking function'], ['ipb', 'Slope classes'], ['gsp-mw', 'Sec 7 para 7b, Annex E (march time, route card)']],
      record: recordRows(run),
    };
  };
  T.profile = () => ({
    title: 'Elevation profile', sub: 'Terrain section along a line or route',
    what: 'Elevation against distance along the selected line.',
    method: 'Bilinear samples of the DEM at regular intervals along the line (M.terrainProfile).',
    units: 'Distance m / km (x), elevation m (y).',
    classes: 'Route profiles are coloured by grade.', meaning: 'Reads climbs, descents and crests along the path.',
    assumptions: L(['Profile follows the drawn line, not the exact cell path.']), quality: L(['DEM resolution limits detail.']), errors: L(['As for the DEM.']), refs: [],
  });
  T.keyTerrain = (c) => ({
    title: 'Key terrain — dominating heights and passes', sub: 'Terrain features extracted from the DEM',
    what: 'Local summits that rise above their surroundings, and saddles (cols / passes) between them.',
    method: `Heights: 8-neighbour local maxima whose regional TPI ≥ minimum dominance × σ, highest within the summit radius; score = TPI/σ + 0.8 × relative height; non-maximum suppression (M.keyTerrain).<br>Passes: on cells with slope ≤ 22°, 16 samples on a ring of the test radius; a saddle needs at least two higher and two lower lobes exceeding the relief threshold (max(15 m, 1.2·cs) unless set).`,
    units: 'Positions and elevations (m).', classes: '▲ height · )( col',
    meaning: 'Candidate dominating features and crossing points — derived from terrain shape only.',
    params: paramRows(c.run, 'keyTerrain'),
    assumptions: L(['Dominance is relative to the loaded extent.']), quality: L(['Flat summits and broad saddles may be missed or duplicated.']), errors: L(['DEM resolution and smoothing.']),
    refs: [['weiss2001', 'TPI'], ['gsp-mw', 'Sec 4 para 6–7; Sec 12 para 14']], record: recordRows(c.run),
  });
  /** Planning / siting tools: method summary from the tool definition + recorded parameters. */
  const TOOL_METHOD = {
    hostile: 'Likely observer points are the highest-scoring cells (regional + local TPI) within the search radius of the enemy marker, separated by non-maximum suppression; the overlay is the union / count of their viewsheds.',
    avenues: 'Up to k alternative least-time paths (same A* and movement model as routes) from the enemy to the own marker for the chosen movement class; corridors are buffered around each path.',
    posts: 'Candidate cells passing the site constraints are pre-scored from terrain, each candidate’s viewshed is weighted by a movement-ground value surface, and a greedy maximum-coverage selection with an overlap discount picks the sites; intervisibility pairs are checked by line of sight.',
    weapons: 'Candidates filtered by site slope, landform, access and distance; weighted visible ground within the recorded range band (with mount elevation / depression limits where given) is evaluated, followed by greedy maximum-coverage selection. Indirect-fire candidates are screened with a vacuum-trajectory crest-clearance check.',
    mfd: 'Cells on the computed avenues where a short line in one of several orientations meets NO-GO ground on both sides within the maximum gap; candidates scored by narrowness, number of avenues, distance and ground factors, then suppressed by separation.',
    picquets: 'Heights near the selected route that pass landform, slope and climb-time limits, chosen by greedy coverage of route cells in their viewsheds.',
    helipads: 'Cells whose whole pad radius is within the slope limit, filtered by distance, access and (optionally) enemy observation, ranked by the weighted flatness / concealment / proximity score.',
    sectorTerrain: 'Dominance = percentile within the sector of 0.5 × regional TPI + 0.2 × local TPI + 0.3 × height; nullahs / valleys from priority-flood + D8 flow accumulation; ridge lines from steepest-ascent D8 accumulation on the unfilled DEM (slopes drain up onto the crest, which carries the flow to the summit), so the lines lie on the crests seen in 3D.',
    itgs: 'Dominant summits on the own side of the border, extent grown to the connected ground within the crest drop and radius, scored by dominance, observation share and border distance.',
    deploy: 'Border posts along the line; platoon posts only on ridge-line crests, dispersed at least the set minimum distance apart, Good / Marginal ITGs held first and no ITG given more platoons than its perimeter needs; shares of forward / intermediate / depth ridge-line bands by mode; HQs and mortars in defilade; each position rated from the reasons listed with it.',
    fireCoverage: 'Counts, per cell, the positions whose range circle and line of sight reach it; flags under-covered stretches of the computed approaches.',
    borderWatch: 'Share of border stations visible from own observers within range; unwatched stretches listed and additional observer points searched nearby.',
    enemyApproaches: 'Least-time paths from entry points on the enemy side of the border to each ITG, classified by the terrain they follow, and the share under own observation.',
    infiltration: 'Least-cost foot paths that penalise ground seen by own posts and favour nullahs / dead ground.',
    enemyOptions: 'Combines the approach and infiltration results into the two course-of-action summaries described in the tool.',
    sectorAll: 'Runs the sector tools in sequence with their current parameters.',
  };
  const toolTopic = (id) => (c) => {
    const t = (UI.GP && UI.GP.TOOLS[id]) || { name: id, desc: '' };
    return {
      title: t.name, sub: 'Planning aid — output computed from terrain models',
      banner: 'Decision-support output produced from terrain data and the parameters below. It has not been verified on the ground and is not a recommendation; the application’s own guidance is to confirm every result by reconnaissance.',
      what: esc(t.desc),
      method: esc(TOOL_METHOD[id] || 'See the tool description.') + ' All scoring weights and thresholds are exposed as tool parameters; values used are listed below.',
      units: 'Positions (grid references), distances (m), areas (km²), shares (%), time (h).',
      classes: id === 'sectorAll' || /^(itgs|deploy|fireCoverage|borderWatch|enemyApproaches|infiltration|enemyOptions|sectorTerrain)$/.test(id) ? 'Ratings Good / Marginal / Not good from the score thresholds in the parameters.' : '—',
      meaning: 'Shows where the terrain model scores highest against the stated criteria. Scores are relative within the loaded extent.',
      params: paramRows(c.run, id),
      assumptions: L(['Terrain-only: vegetation, snow, weather, structures and actual dispositions are not modelled unless digitised.', 'Inherits the assumptions of slope, mobility, viewshed and routing (see those explanations).']),
      quality: L(['Weapon ranges and planning figures are indicative values from the built-in table or user edits (Settings ▸ Weapon data).']),
      errors: L(['DEM error propagates through every component; sensitivity to parameter choices can be high.']),
      refs: t.gsp ? [['gsp-mw', 'See doctrine note below']] : [],
      doctrine: t.gsp ? esc(t.gsp) : null,
      record: recordRows(c.run),
    };
  };
  for (const id of Object.keys(TOOL_METHOD)) T[id] = toolTopic(id);
  T.symbols = (c) => ({
    title: 'Military symbology', sub: 'APP-6(D) / MIL-STD-2525D subset rendered by MtnEye',
    what: 'Frame shape = standard identity (friend rectangle / circle for equipment, hostile diamond, neutral square, unknown quatrefoil); fill colour = affiliation; icon = function; amplifier above the frame = echelon; dashed outline = planned / anticipated status; mountain modifier at the bottom of land units.',
    method: 'SVG drawn in the standard 200 × 200 symbol space (UI.symbolSVG) and rasterised once per size for the map (UI.symbolImage). SIDCs for export are assembled field by field (UI.sidcFor).',
    units: '—', classes: 'Affiliation colours (light mode): friend #80E0FF, hostile #FF8080, neutral #AAFFAA, unknown #FFFF80.',
    meaning: 'Symbols mark user-placed situation markers and tool outputs. Planned (dashed) symbols are suggestions, not reported positions.',
    assumptions: L(['Only the symbol types MtnEye needs are implemented.', 'Frame rule (MtnEye overlay convention, default): an explicit headquarters (isHQ) is always a square; platoon, company and battalion formations are goose eggs; other echelons keep the standard frame. Goose eggs and HQ squares are custom cartographic conventions, not official APP-6(D) frames.', 'With the APP-6(D) convention every unit keeps its standard frame and an HQ gets the standard HQ staff.']),
    quality: L(['Frame and amplifier geometry follows milsymbol; entity / modifier codes in the SIDC builder have not been independently verified against the standard in this build — verify before exchanging symbols with other systems.']),
    errors: L(['—']), refs: [['app6d', ''], ['mil2525d', ''], ['milsymbol', 'Geometry reference']],
  });
  T.grids = () => ({
    title: 'Map grids and north reference', sub: 'MGRS / UTM grid, graticule, secondary CRS',
    what: 'Reference grids drawn over the map and the relationship between grid, true and magnetic north.',
    method: 'UTM / MGRS: Snyder (1987) Transverse Mercator series on WGS 84. Grid convergence γ = atan(tan Δλ · sin φ). Magnetic declination = user-entered value at epoch + annual change × years. Secondary CRSs use 3-parameter geocentric datum shifts.',
    units: 'Metres (grid), degrees / mils (angles).', classes: '—',
    meaning: 'The map is drawn grid-north up in the analysis UTM zone.',
    assumptions: L(['Datum-shift parameters are 3-parameter approximations (metre-level).']), quality: L(['Declination must be taken from a current source; MtnEye has no geomagnetic model.']), errors: L(['—']),
    refs: [['snyder1987', '']],
  });
  T.location = (c) => ({
    title: 'Inspected location', sub: 'How the values in the Attributes pane are derived',
    what: 'Coordinates and terrain values at the clicked point.',
    method: 'Elevation: bilinear interpolation of the DEM at the exact point. Slope, aspect, landform and mobility: value of the nearest cell. References: converted from the analysis UTM position with the selected formats and CRSs.',
    units: 'As displayed.', classes: '—', meaning: 'Values describe the analysis cell, which represents an area of cs × cs metres, not a surveyed point.',
    assumptions: L([`Cell size ${c0().cs} m.`]), quality: L(['Accuracy limited by the DEM and its georeferencing.']), errors: L(['—']), refs: [],
  });
  T.measure = () => ({
    title: 'Measure', sub: 'Distance, bearing and GSP march time between two points',
    what: 'Straight-line grid distance, slope distance, bearings and time estimates.',
    method: 'Grid distance in the UTM plane; bearings converted with grid convergence and the user’s declination; GSP march time from the straight-line distance and height difference.',
    units: 'As displayed.', classes: '—', meaning: 'Straight-line legs only; use the route tool for a terrain-following path.',
    assumptions: L(['UTM scale factor is not applied (differences of up to a few parts per 10 000).']), quality: L(['—']), errors: L(['—']), refs: [['gsp-mw', 'Sec 7 para 7b, Annex E; Sec 4 para 13b (map distance + ⅓)']],
  });

  UI.EXPLAIN_TOPICS = T;
  /** Library entry for a reference button: a GSP citation entry when the section is one MtnEye cites. */
  UI.resolveRef = (id, sec) => {
    if (id !== 'gsp-mw' || !sec) return id;
    const keys = UI.gspIndex().map((g) => g.key).sort((a, b) => b.length - a.length);
    const k = keys.find((x) => sec.replace(/-/g, '–').includes(x));
    return k ? 'gsp:' + k : id;
  };

  /** Topic for a Contents layer id. */
  UI.explainTopicForLayer = (id, S) => {
    if (!id) return null;
    if (id === 'dem') return S.base === 'relief' ? 'elevation' : S.base;
    if (id === 'bm:imagery') return 'imagery';
    if (id === 'bm:hillshade') return 'hillshade';
    if (id === 'bm:terrain') return S.base === 'relief' ? 'hillshade' : S.base;
    if (id.startsWith('ovl:')) return { mobility: 'mobility', viewshed: 'viewshed', hostile: 'hostile', avenues: 'avenues', cover: 'posts', dead: 'posts', wcover: 'weapons', dominance: 'sectorTerrain', firecov: 'fireCoverage' }[id.slice(4)] || null;
    if (id.startsWith('weapons:')) return 'weapons';
    if (id.startsWith('g:')) return id === 'g:contours' ? 'contours' : 'grids';
    return { markers: 'symbols', obstacles: 'mobility', routes: 'route', los: 'los', key: 'keyTerrain', posts: 'posts', hostileOps: 'hostile', avenues: 'avenues', mfd: 'mfd', picquets: 'picquets', helipads: 'helipads',
      itgs: 'itgs', plan: 'deploy', eappr: 'enemyApproaches', infil: 'infiltration', eopts: 'enemyOptions', bwatch: 'borderWatch', firegaps: 'fireCoverage', ridges: 'sectorTerrain', nullahs: 'sectorTerrain', secArea: 'grids' }[id] || null;
  };
  /** Topic for a selection reference. */
  UI.explainTopicForRef = (ref) => {
    if (!ref) return null;
    return { post: 'posts', weapon: 'weapons', mfd: 'mfd', picquet: 'picquets', hls: 'helipads', key: 'keyTerrain', marker: 'symbols', route: 'route', cp: 'route', avenue: 'avenues', point: 'location' }[ref.kind]
      || (ref.kind === 'sec' ? UI.explainTopicForLayer(ref.layer, UI.S) : null);
  };
  /** Which recorded engine command produced a topic. */
  const TOPIC_CMD = { route: 'route', keyTerrain: 'keyTerrain', hostile: 'hostileObservation', avenues: 'avenues', posts: 'posts', weapons: 'weapons', mfd: 'minefields', picquets: 'picquets', helipads: 'helipads',
    viewshed: 'viewshed', los: 'los', mobility: 'mobility', sectorTerrain: 'sectorTerrain', itgs: 'itgs', deploy: 'deploy', fireCoverage: 'fireCoverage', borderWatch: 'borderWatch', enemyApproaches: 'enemyApproaches', infiltration: 'infiltration', enemyOptions: 'enemyOptions' };

  /** Full HTML of an explanation. */
  UI.explainHTML = (topic, extra = {}) => {
    const S = UI.S;
    const fn = T[topic];
    if (!fn) return `<p class="hint pad">No explanation is defined for this item. ${NA('the application has no methodology record for it')}</p>`;
    const cmd = TOPIC_CMD[topic];
    const run = extra.run || (cmd && S.lastRun ? S.lastRun[cmd] : null);
    const x = fn({ S, run, ref: extra.ref, layer: extra.layer });
    const row = (k, v) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`;
    const sec = (n, h, body) => (body ? `<section class="ex-sec"><h4><span class="ex-n">${n}</span>${h}</h4><div class="ex-b">${body}</div></section>` : '');
    const refs = (x.refs || []).map(([id, s]) => {
      const R = UI.REFS[id];
      return R ? `<li><button class="link ex-ref" data-ref="${id}" data-sec="${esc(s || '')}">${esc(R.title.split('. ')[0])}${s ? ` — ${esc(s)}` : ''}</button> <span class="hint">(${esc(R.kind)})</span></li>` : '';
    }).join('');
    const params = (x.params && x.params.length) ? `<table class="pgrid ex-t">${x.params.map(([k, v]) => row(k, v)).join('')}</table>` : cmd ? (run ? '<p class="hint">No user parameters.</p>' : `<p class="hint">${NA('this result has not been run in this session (or was loaded from a plan file); parameters were not recorded')}</p>`) : '';
    const record = x.record ? `<table class="pgrid ex-t">${x.record.map(([k, v]) => row(k, v)).join('')}</table>` : '';
    let n = 0;
    return `<div class="ex">
      <div class="ex-head"><div class="ex-ic">${UI.icon('help', 18)}</div><div><div class="t">${x.title}</div><div class="s">${esc(x.sub || '')}</div></div></div>
      ${x.banner ? `<div class="ex-banner">${x.banner}</div>` : ''}
      ${x.info && x.info.length ? `<table class="pgrid ex-t ex-info">${x.info.map(([k, v]) => row(k, v)).join('')}</table>` : ''}
      ${sec(++n, 'What is displayed', x.what)}
      ${sec(++n, 'Input dataset', (x.input ? `<p>${x.input}</p>` : '') + `<table class="pgrid ex-t">${datasetRows(S).map(([k, v]) => row(k, v)).join('')}</table>`)}
      ${sec(++n, 'Method / formula', x.method)}
      ${sec(++n, 'Units', esc(x.units || '—'))}
      ${sec(++n, 'Classification / thresholds', x.classes)}
      ${sec(++n, 'Interpretation', x.meaning)}
      ${sec(++n, 'Parameters used', params || '<p class="hint">Fixed by the method (no user parameters).</p>')}
      ${sec(++n, 'Assumptions', x.assumptions)}
      ${sec(++n, 'Data quality & limitations', x.quality)}
      ${sec(++n, 'Potential sources of error', x.errors)}
      ${x.doctrine ? sec(++n, 'Doctrine note (as written in MtnEye)', `<blockquote>${x.doctrine}</blockquote>`) : ''}
      ${record ? sec(++n, 'Processing record', record) : ''}
      ${sec(++n, 'References', refs ? `<ul class="ex-refs">${refs}</ul>` : `<p class="hint">${NA('no documentation reference is recorded for this method in MtnEye')}</p>`)}
    </div>`;
  };

  // =================================================================== reference library (dialog)
  UI.libraryHTML = (q = '', sel = null) => {
    const ql = q.trim().toLowerCase();
    const gsp = UI.gspIndex();
    const items = [];
    for (const [id, r] of Object.entries(UI.REFS)) items.push({ id, group: r.kind, title: r.title, hay: `${r.title} ${r.relevance} ${r.number} ${r.kind}` });
    for (const g of gsp) items.push({ id: 'gsp:' + g.key, group: 'GSP citations found in MtnEye', title: `GSP Mountain Warfare — ${g.key}`, hay: `gsp ${g.key} ${g.mentions.map((m) => m.text + ' ' + m.where).join(' ')}` });
    const vis = items.filter((it) => !ql || it.hay.toLowerCase().includes(ql));
    const groups = [...new Set(vis.map((x) => x.group))];
    const selId = sel && vis.some((x) => x.id === sel) ? sel : vis[0] && vis[0].id;
    const list = groups.map((gname) => `<div class="lib-g">${esc(gname)}</div>${vis.filter((x) => x.group === gname).map((x) => `<button class="lib-i${x.id === selId ? ' on' : ''}" data-lib="${esc(x.id)}">${esc(x.title)}</button>`).join('')}`).join('') || '<p class="hint pad">No matching reference.</p>';
    let detail = '';
    if (selId && selId.startsWith('gsp:')) {
      const g = gsp.find((x) => 'gsp:' + x.key === selId);
      detail = `<h3>GSP Mountain Warfare — ${esc(g.key)}</h3>
        <table class="pgrid ex-t"><tr><td>Document</td><td>GSP Mountain Warfare (pamphlet)</td></tr><tr><td>Document number</td><td>${NA(NOT_REC)}</td></tr><tr><td>Section / paragraph</td><td>${esc(g.key)}</td></tr><tr><td>Page</td><td>${NA(NOT_REC)}</td></tr></table>
        <h4>Where MtnEye cites it (${g.mentions.length})</h4>${g.mentions.map((m) => `<div class="lib-m"><div class="lib-w">${m.open && m.open.tool ? `<button class="link" data-libtool="${m.open.tool}">${esc(m.where)}</button>` : m.open && m.open.help ? `<button class="link" data-libhelp="${m.open.help}">${esc(m.where)}</button>` : esc(m.where)}</div><blockquote>${esc(m.text)}</blockquote></div>`).join('')}
        <p class="hint">Text above is MtnEye’s own wording, not a quotation of the pamphlet. Verify against the issued document.</p>`;
    } else if (selId) {
      const r = UI.REFS[selId.replace(/^.*?:/, '')] || UI.REFS[selId];
      const used = Object.entries(T).filter(([k]) => { try { return (T[k]({ S: UI.S }).refs || []).some(([rid]) => rid === selId); } catch (e) { return false; } }).map(([k]) => k);
      detail = `<h3>${esc(r.title)}</h3><table class="pgrid ex-t"><tr><td>Type</td><td>${esc(r.kind)}</td></tr><tr><td>Document number / identifier</td><td>${r.number === NOT_REC ? NA(NOT_REC) : esc(r.number)}</td></tr>
        <tr><td>Relevant section</td><td>${r.section ? esc(r.section) : selId === 'gsp-mw' ? 'See the GSP citation entries' : '—'}</td></tr><tr><td>Page</td><td>${r.page === NOT_REC ? NA(NOT_REC) : esc(r.page)}</td></tr></table>
        <h4>Relevance to MtnEye</h4><p>${esc(r.relevance)}</p>
        ${used.length ? `<h4>Explanations that cite it</h4><div class="lib-used">${used.map((k) => `<button class="btn sm" data-libex="${k}">${esc(T[k]({ S: UI.S }).title.replace(/<[^>]+>/g, ''))}</button>`).join('')}</div>` : ''}
        ${selId === 'gsp-mw' ? `<h4>Citations found (${gsp.length})</h4><div class="lib-used">${gsp.map((g) => `<button class="btn sm" data-lib="gsp:${esc(g.key)}">${esc(g.key)}</button>`).join('')}</div>` : ''}`;
    }
    return { list, detail, count: vis.length };
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
