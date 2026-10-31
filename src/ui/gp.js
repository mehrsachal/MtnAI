/*
 * MtnAI ui — Geoprocessing pane: toolboxes, tool parameter forms (ArcGIS Pro style),
 * Run / messages and per-tool parameter memory.
 *
 * A parameter: {k, label, type, def, options, min, max, step, unit, help, show(v), group}
 *   types: number · select · bool · text · password · checks (multi) · weights (6 landforms)
 *          point (pick on map / type a reference) · marker (situation marker) · section · info
 * Dotted keys ("value.footGo") are assembled into nested objects for the handler.
 */
(function (UI) {
  'use strict';
  const M = UI.M, cfg = UI.cfg;
  const STORE = 'mtnai.gp.v1';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const LF_NAMES = ['Valley / nullah', 'Lower slope', 'Flat', 'Mid slope', 'Upper slope', 'Ridge / crest'];
  const D = M.TACTICAL_DEFAULTS;
  const profOpts = () => Object.values(M.MOVEMENT_PROFILES).map((p) => [p.id, p.name]);
  const sec = (label, collapsed = true) => ({ type: 'section', label, collapsed });

  const VALUE = (posts) => [
    sec('Target value — enemy movement ground'),
    { k: 'value.footGo', label: 'Dismounted GO ground', type: 'number', def: D.value.footGo, min: 0, max: 10, step: 0.05 },
    { k: 'value.footSlow', label: 'Dismounted SLOW-GO ground', type: 'number', def: D.value.footSlow, min: 0, max: 10, step: 0.05 },
    { k: 'value.footNogo', label: 'Dismounted NO-GO ground', type: 'number', def: D.value.footNogo, min: 0, max: 10, step: 0.05 },
    { k: 'value.vehGo', label: 'Vehicle GO ground', type: 'number', def: D.value.vehGo, min: 0, max: 10, step: 0.05 },
    { k: 'value.vehSlow', label: 'Vehicle SLOW-GO ground', type: 'number', def: D.value.vehSlow, min: 0, max: 10, step: 0.05 },
    { k: 'value.vehNogo', label: 'Vehicle NO-GO ground', type: 'number', def: D.value.vehNogo, min: 0, max: 10, step: 0.05 },
    ...(posts ? [
      { k: 'value.obsFoot', label: 'Share for dismounted movement', type: 'number', def: D.value.obsFoot, min: 0, max: 5, step: 0.05 },
      { k: 'value.obsVeh', label: 'Share for vehicle movement', type: 'number', def: D.value.obsVeh, min: 0, max: 5, step: 0.05 }] : []),
    { k: 'value.avenueBonus', label: 'Bonus on avenues of approach (×)', type: 'number', def: D.value.avenueBonus, min: 0, max: 20, step: 0.5, help: 'Extra value for ground within the enemy avenue corridors (0 = ignore avenues).' },
    { k: 'value.useCorridor', label: 'Concentrate on the enemy approach corridor', type: 'bool', def: D.value.useCorridor },
    { k: 'value.corridorWidth', label: 'Corridor width (fraction of enemy distance)', type: 'number', def: D.value.corridorWidth, min: 0.05, max: 3, step: 0.05 },
    { k: 'value.corridorMinM', label: 'Minimum corridor width', type: 'number', def: D.value.corridorMinM, min: 100, max: 20000, step: 100, unit: 'm' },
    { k: 'value.rearFactor', label: 'Value of ground behind own position', type: 'number', def: D.value.rearFactor, min: 0, max: 1, step: 0.05 },
  ];

  const weaponCat = (v) => (M.WEAPONS[v.weaponId] || {}).cat;

  /** Tool catalogue. */
  const BOXES = [
    { name: 'Data Management', tools: ['downloadDEM', 'exportRaster'] },
    { name: 'Terrain Analysis', tools: ['keyTerrain', 'mobility'] },
    { name: 'Visibility', tools: ['viewshed', 'los', 'hostile'] },
    { name: 'Tactical Siting', tools: ['avenues', 'posts', 'weapons', 'mfd'] },
    { name: 'Routing', tools: ['route', 'picquets', 'fly'] },
    { name: 'Conversion', tools: ['convert'] },
  ];

  const TOOLS = {
    downloadDEM: {
      name: 'Download DEM', icon: 'download',
      desc: 'Downloads an elevation model for an area from the internet and loads it. This is the only tool that uses the network; save a GeoTIFF copy to work offline later.',
      params: [
        { k: 'source', label: 'Source', type: 'select', def: 'terrarium', options: () => Object.entries(M.DEM_SOURCES).map(([k, s]) => [k, s.name]) },
        { k: 'zoom', label: 'Resolution (tile level)', type: 'select', def: 12, options: () => M.DEM_SOURCES.terrarium.zooms.map(([z, l]) => [z, `Level ${z} — ${l}`]), show: (v) => v.source === 'terrarium' },
        { k: 'dem', label: 'Dataset', type: 'select', def: 'COP30', options: () => M.DEM_SOURCES.opentopo.dems, show: (v) => v.source === 'opentopo' },
        { k: 'apiKey', label: 'OpenTopography API key', type: 'password', def: '', show: (v) => v.source === 'opentopo', help: 'Free from opentopography.org (MyOpenTopo ▸ Get an API key).' },
        { k: 'extent', label: 'Extent', type: 'select', def: 'center', options: [['center', 'Centre point and size'], ['bbox', 'Bounding box (lat / lon)'], ['view', 'Current map view'], ['dem', 'Extent of the loaded DEM']] },
        { k: 'center', label: 'Centre', type: 'text', def: '35.80, 74.30', show: (v) => v.extent === 'center', help: 'Any reference: MGRS, UTM, lat/lon (DD / DMS), GARS, GEOREF or secondary-CRS E/N.' },
        { k: 'widthKm', label: 'Width', type: 'number', def: 20, min: 1, max: 200, step: 1, unit: 'km', show: (v) => v.extent === 'center' },
        { k: 'heightKm', label: 'Height', type: 'number', def: 20, min: 1, max: 200, step: 1, unit: 'km', show: (v) => v.extent === 'center' },
        { k: 'west', label: 'West (lon °)', type: 'number', def: 74.2, step: 0.001, show: (v) => v.extent === 'bbox' },
        { k: 'south', label: 'South (lat °)', type: 'number', def: 35.7, step: 0.001, show: (v) => v.extent === 'bbox' },
        { k: 'east', label: 'East (lon °)', type: 'number', def: 74.45, step: 0.001, show: (v) => v.extent === 'bbox' },
        { k: 'north', label: 'North (lat °)', type: 'number', def: 35.9, step: 0.001, show: (v) => v.extent === 'bbox' },
        sec('Output', false),
        { k: 'saveCopy', label: 'Save a GeoTIFF copy for offline use', type: 'bool', def: true },
        { k: 'load', label: 'Add to map', type: 'bool', def: true },
      ],
    },
    exportRaster: {
      name: 'Export Raster', icon: 'download',
      desc: 'Writes the elevation model or an analysis raster to GeoTIFF (Float32, WGS 84 / UTM) or ESRI ASCII grid with .prj.',
      params: [
        { k: 'layer', label: 'Raster', type: 'select', def: 'z', options: () => [['z', 'Elevation'], ['slope', 'Slope (°)'], ['aspect', 'Aspect (°)'], ['landform', 'Landform class'], ['tri', 'Ruggedness (TRI)'], ['hs', 'Hillshade'],
          ...Object.entries((UI.S && UI.S.overlays) || {}).filter(([, o]) => o.data).map(([id, o]) => ['ovl:' + id, o.name])] },
        { k: 'format', label: 'Format', type: 'select', def: 'tif', options: [['tif', 'GeoTIFF (.tif)'], ['asc', 'ESRI ASCII grid (.asc + .prj)']] },
      ],
    },
    keyTerrain: {
      name: 'Key Terrain', icon: 'peak',
      desc: 'Finds dominating heights (local summits with high regional topographic position) and passes / cols (saddles).',
      params: [
        sec('Dominating heights', false),
        { k: 'maxPeaks', label: 'Maximum heights', type: 'number', def: 20, min: 1, max: 200, step: 1 },
        { k: 'peakRadiusM', label: 'Summit search radius', type: 'number', def: 600, min: 100, max: 5000, step: 50, unit: 'm', help: 'A height must be the highest point within this radius.' },
        { k: 'minDominance', label: 'Minimum dominance (σ of regional TPI)', type: 'number', def: 0.5, min: 0, max: 5, step: 0.1 },
        sec('Passes / cols', false),
        { k: 'maxPasses', label: 'Maximum passes', type: 'number', def: 15, min: 0, max: 200, step: 1 },
        { k: 'passRingM', label: 'Saddle test radius', type: 'number', def: 240, min: 50, max: 2000, step: 10, unit: 'm' },
        { k: 'passReliefM', label: 'Minimum relief either side (0 = auto)', type: 'number', def: 0, min: 0, max: 1000, step: 5, unit: 'm' },
      ],
    },
    mobility: {
      name: 'Go / No-Go (Mobility)', icon: 'mobility',
      desc: 'Classifies cross-country movement into GO / SLOW-GO / NO-GO for a movement class from slope, snow line and digitised obstacles / tracks.',
      params: [
        { k: 'profile', label: 'Movement class', type: 'select', def: 'foot', options: profOpts },
        { k: 'go', label: 'GO — maximum slope', type: 'number', def: null, min: 1, max: 70, step: 1, unit: '°', dynamic: (v) => UI.app.profileOf(v.profile).go },
        { k: 'slow', label: 'SLOW-GO — maximum slope', type: 'number', def: null, min: 2, max: 80, step: 1, unit: '°', dynamic: (v) => UI.app.profileOf(v.profile).slow },
        { k: 'speed', label: 'Cross-country speed (level GO)', type: 'number', def: null, min: 0.5, max: 80, step: 0.5, unit: 'km/h', dynamic: (v) => UI.app.profileOf(v.profile).speed },
        { k: 'road', label: 'Speed on tracks', type: 'number', def: null, min: 0.5, max: 120, step: 0.5, unit: 'km/h', dynamic: (v) => UI.app.profileOf(v.profile).road },
        { k: 'snowLine', label: 'Snow line (0 = off)', type: 'number', def: 0, min: 0, max: 9000, step: 100, unit: 'm', help: 'Above it vehicles are NO-GO and foot movement drops one class.' },
        { k: 'generalize', label: 'Generalise (3×3 majority filter)', type: 'bool', def: false },
      ],
    },
    viewshed: {
      name: 'Viewshed', icon: 'eye',
      desc: 'Ground visible from an observer, with earth curvature and refraction (Settings ▸ Analysis parameters).',
      params: [
        { k: 'observer', label: 'Observer point', type: 'point' },
        { k: 'obsH', label: 'Observer height above ground', type: 'number', def: () => cfg('an.obsH'), min: 0, max: 500, step: 0.5, unit: 'm' },
        { k: 'tgtH', label: 'Target height above ground', type: 'number', def: () => cfg('an.tgtH'), min: 0, max: 2000, step: 0.5, unit: 'm' },
        { k: 'radiusM', label: 'Radius', type: 'number', def: 5000, min: 100, max: 100000, step: 100, unit: 'm' },
      ],
    },
    los: {
      name: 'Line of Sight', icon: 'los',
      desc: 'Intervisibility between two points with terrain profile, obstruction point and clearance.',
      params: [
        { k: 'from', label: 'Observer point', type: 'point' },
        { k: 'to', label: 'Target point', type: 'point' },
        { k: 'obsH', label: 'Observer height', type: 'number', def: () => cfg('an.obsH'), min: 0, max: 500, step: 0.5, unit: 'm' },
        { k: 'tgtH', label: 'Target height', type: 'number', def: 2, min: 0, max: 2000, step: 0.5, unit: 'm' },
      ],
    },
    hostile: {
      name: 'Enemy Observation', icon: 'eye',
      desc: 'Ground overlooked by likely enemy OPs on the high ground near the enemy position. Unshaded ground is in defilade.',
      params: [
        { k: 'threat', type: 'marker' },
        { k: 'count', label: 'Likely enemy OPs to model', type: 'number', def: () => cfg('an.hostileCount'), min: 0, max: 50, step: 1 },
        { k: 'searchRadiusM', label: 'OP search radius around enemy', type: 'number', def: () => cfg('an.hostileSearchM'), min: 200, max: 30000, step: 250, unit: 'm' },
        { k: 'minSepM', label: 'Minimum OP separation', type: 'number', def: 600, min: 50, max: 10000, step: 50, unit: 'm' },
        { k: 'rangeM', label: 'Observation range', type: 'number', def: () => cfg('an.hostileRangeM'), min: 500, max: 50000, step: 500, unit: 'm' },
        { k: 'obsH', label: 'Enemy observer height', type: 'number', def: () => cfg('an.hostileObsH'), min: 0, max: 100, step: 0.5, unit: 'm' },
        { k: 'tgtH', label: 'Target height (own troops)', type: 'number', def: 1.5, min: 0, max: 100, step: 0.5, unit: 'm' },
        { k: 'includeThreat', label: 'Include the enemy position itself', type: 'bool', def: true },
      ],
    },
    avenues: {
      name: 'Avenues of Approach', icon: 'axis',
      desc: 'Least-time enemy approach routes from the enemy to own position for the enemy movement class.',
      params: [
        { k: 'own', type: 'marker' }, { k: 'threat', type: 'marker' },
        { k: 'threatType', label: 'Enemy movement class', type: 'select', def: 'foot', options: [['foot', 'Infantry (dismounted)'], ['jeep', 'Wheeled / mechanised'], ['tracked', 'Armour (tracked)'], ['mule', 'Animal transport'], ['truck', 'Trucks']] },
        { k: 'k', label: 'Number of avenues', type: 'number', def: D.avenues.k, min: 1, max: 4, step: 1 },
        { k: 'separationM', label: 'Separation between avenues', type: 'number', def: D.avenues.separationM, min: 50, max: 5000, step: 50, unit: 'm' },
        { k: 'bufferM', label: 'Corridor half-width', type: 'number', def: D.avenues.bufferM, min: 25, max: 3000, step: 25, unit: 'm' },
      ],
    },
    posts: {
      name: 'Suggest Posts / OPs', icon: 'post',
      desc: 'Sites defended posts or OPs on the heights by maximum coverage of likely enemy movement ground, with dead ground and intervisibility.',
      params: [
        { k: 'own', type: 'marker' }, { k: 'threat', type: 'marker' },
        { k: 'mode', label: 'Post type', type: 'select', def: 'post', options: [['post', 'Defended post'], ['op', 'Observation post']] },
        { k: 'echelon', label: 'Strength (symbol)', type: 'select', def: 'platoon', options: [['team', 'Team'], ['section', 'Section'], ['platoon', 'Platoon'], ['company', 'Company']] },
        { k: 'count', label: 'Number of posts', type: 'number', def: D.posts.count, min: 1, max: 40, step: 1 },
        { k: 'rangeM', label: 'Observation range', type: 'number', def: D.posts.rangeM, min: 200, max: 30000, step: 250, unit: 'm' },
        { k: 'obsH', label: 'Observer height', type: 'number', def: D.posts.obsH, min: 0, max: 100, step: 0.5, unit: 'm' },
        { k: 'tgtH', label: 'Target height', type: 'number', def: D.posts.tgtH, min: 0, max: 100, step: 0.5, unit: 'm' },
        { k: 'minSepM', label: 'Minimum separation', type: 'number', def: D.posts.minSepM, min: 50, max: 10000, step: 50, unit: 'm' },
        sec('Site constraints'),
        { k: 'maxSlope', label: 'Maximum site slope', type: 'number', def: D.posts.maxSlope, min: 1, max: 80, step: 1, unit: '°' },
        { k: 'landforms', label: 'Allowed landforms', type: 'checks', def: D.posts.landforms, options: LF_NAMES.map((n, i) => [i, n]) },
        { k: 'maxDistOwnM', label: 'Maximum distance from own position', type: 'number', def: D.posts.maxDistOwnM, min: 100, max: 100000, step: 250, unit: 'm' },
        { k: 'minDistThreatM', label: 'Minimum distance from enemy', type: 'number', def: D.posts.minDistThreatM, min: 0, max: 50000, step: 100, unit: 'm' },
        { k: 'requireAccess', label: 'Must be reachable from own position', type: 'bool', def: D.posts.requireAccess },
        { k: 'accessProfile', label: 'Access movement class', type: 'select', def: D.posts.accessProfile, options: profOpts, show: (v) => v.requireAccess },
        { k: 'maxAccessH', label: 'Maximum access time (0 = any)', type: 'number', def: D.posts.maxAccessH, min: 0, max: 48, step: 0.5, unit: 'h', show: (v) => v.requireAccess },
        sec('Search & scoring'),
        { k: 'candidates', label: 'Candidate sites evaluated', type: 'number', def: D.posts.candidates, min: 10, max: 600, step: 10, help: 'More candidates = better coverage, longer run time.' },
        { k: 'overlapKeep', label: 'Value of repeated coverage (0–1)', type: 'number', def: D.posts.overlapKeep, min: 0, max: 1, step: 0.05, help: '0 = no credit for ground already observed; 1 = full credit (mutual support).' },
        { k: 'rangeDecay', label: 'Range decay (0–1)', type: 'number', def: D.posts.rangeDecay, min: 0, max: 1, step: 0.05 },
        { k: 'wTpiL', label: 'Prescore — regional dominance', type: 'number', def: D.posts.wTpiL, min: 0, max: 5, step: 0.05 },
        { k: 'wTpiS', label: 'Prescore — local prominence', type: 'number', def: D.posts.wTpiS, min: 0, max: 5, step: 0.05 },
        { k: 'wElev', label: 'Prescore — absolute height', type: 'number', def: D.posts.wElev, min: 0, max: 5, step: 0.05 },
        { k: 'wCorridor', label: 'Prescore — closeness to approach', type: 'number', def: D.posts.wCorridor, min: 0, max: 5, step: 0.05 },
        { k: 'deadThreshold', label: 'Dead-ground value threshold (0–1)', type: 'number', def: D.posts.deadThreshold, min: 0, max: 1, step: 0.05 },
        { k: 'linkFactor', label: 'Intervisibility check range (× obs range)', type: 'number', def: D.posts.linkFactor, min: 0.5, max: 10, step: 0.5 },
        ...VALUE(true),
      ],
    },
    weapons: {
      name: 'Suggest Weapon Sites', icon: 'tactical',
      desc: 'Direct-fire sites by fields of fire over target ground (with enfilade), indirect-fire positions with crest clearance and defilade, AD sites over air corridors.',
      params: [
        { k: 'own', type: 'marker' }, { k: 'threat', type: 'marker' }, { k: 'target', type: 'marker', show: (v) => weaponCat(v) === 'indirect' },
        { k: 'weaponId', label: 'Weapon', type: 'select', def: 'mg3', options: () => M.WEAPON_GROUPS.flatMap((g) => g.ids.map((id) => [id, `${M.WEAPONS[id].name} — ${g.name}`])), rerender: true },
        { k: 'count', label: 'Number of sites', type: 'number', def: 3, min: 1, max: 30, step: 1 },
        sec('Weapon data (saved to Settings ▸ Weapon data)'),
        { k: 'w.minR', label: 'Minimum range', type: 'number', unit: 'm', min: 0, max: 50000, step: 50, weapon: 'minR' },
        { k: 'w.maxR', label: 'Maximum / effective range', type: 'number', unit: 'm', min: 50, max: 50000, step: 50, weapon: 'maxR' },
        { k: 'w.siteSlope', label: 'Maximum site slope', type: 'number', unit: '°', min: 1, max: 60, step: 1, weapon: 'siteSlope' },
        { k: 'w.obsH', label: 'Sight height', type: 'number', unit: 'm', min: 0, max: 20, step: 0.1, weapon: 'obsH', show: (v) => weaponCat(v) !== 'indirect' },
        { k: 'w.tgtH', label: 'Target height', type: 'number', unit: 'm', min: 0, max: 500, step: 0.5, weapon: 'tgtH', show: (v) => weaponCat(v) !== 'indirect' },
        { k: 'w.access', label: 'Access movement class', type: 'select', options: profOpts, weapon: 'access' },
        sec('Site constraints'),
        { k: 'defRadiusM', label: 'Defended-area radius around own position', type: 'number', def: 3000, min: 100, max: 50000, step: 250, unit: 'm', show: (v) => weaponCat(v) !== 'indirect' },
        { k: 'minSepM', label: 'Minimum separation', type: 'number', def: 300, min: 25, max: 10000, step: 25, unit: 'm' },
        { k: 'requireAccess', label: 'Must be reachable from own position', type: 'bool', def: true },
        { k: 'maxAccessH', label: 'Maximum access time (0 = any)', type: 'number', def: 0, min: 0, max: 48, step: 0.5, unit: 'h', show: (v) => v.requireAccess },
        { k: 'direct.enfilade', label: 'Enfilade preference (0–1, blank = weapon default)', type: 'number', def: null, min: 0, max: 1, step: 0.05, show: (v) => weaponCat(v) === 'direct', help: 'Credit for fire across the enemy approach rather than head-on.' },
        { k: 'indirect.requireDefilade', label: 'Position must be hidden from enemy observation', type: 'bool', def: D.indirect.requireDefilade, show: (v) => weaponCat(v) === 'indirect' },
        { k: 'indirect.forwardLimit', label: 'Maximum forward of own position (fraction)', type: 'number', def: D.indirect.forwardLimit, min: 0, max: 1, step: 0.05, show: (v) => weaponCat(v) === 'indirect' },
        { k: 'indirect.minRangeFrac', label: 'Minimum range to target (× max range)', type: 'number', def: D.indirect.minRangeFrac, min: 0, max: 1, step: 0.05, show: (v) => weaponCat(v) === 'indirect' },
        { k: 'indirect.maxRangeFrac', label: 'Maximum range to target (× max range)', type: 'number', def: D.indirect.maxRangeFrac, min: 0.1, max: 1, step: 0.01, show: (v) => weaponCat(v) === 'indirect' },
        { k: 'indirect.idealRangeFrac', label: 'Preferred range to target (× max range)', type: 'number', def: D.indirect.idealRangeFrac, min: 0.1, max: 1, step: 0.05, show: (v) => weaponCat(v) === 'indirect' },
        { k: 'indirect.targetSpreadM', label: 'Target-area spread (crest clearance fan)', type: 'number', def: D.indirect.targetSpreadM, min: 0, max: 5000, step: 50, unit: 'm', show: (v) => weaponCat(v) === 'indirect' },
        { k: 'indirect.marginM', label: 'Crest clearance margin', type: 'number', def: D.indirect.marginM, min: 0, max: 500, step: 5, unit: 'm', show: (v) => weaponCat(v) === 'indirect' },
        sec('Search & scoring'),
        { k: 'candidates', label: 'Candidate sites evaluated', type: 'number', def: 120, min: 10, max: 600, step: 10 },
        { k: 'direct.overlapKeep', label: 'Value of overlapping arcs (0–1)', type: 'number', def: D.direct.overlapKeep, min: 0, max: 1, step: 0.05, show: (v) => weaponCat(v) !== 'indirect' },
        { k: 'direct.rangeDecay', label: 'Range decay (0–1)', type: 'number', def: D.direct.rangeDecay, min: 0, max: 1, step: 0.05, show: (v) => weaponCat(v) !== 'indirect' },
        { k: 'direct.lfWeights', label: 'Landform preference', type: 'weights', def: D.direct.lfWeights, show: (v) => weaponCat(v) === 'direct' },
        { k: 'ad.lfWeights', label: 'Landform preference (site)', type: 'weights', def: D.ad.lfWeights, show: (v) => weaponCat(v) === 'ad' },
        { k: 'ad.airValue', label: 'Air corridor value by landform', type: 'weights', def: D.ad.airValue, show: (v) => weaponCat(v) === 'ad', help: 'Where low-flying aircraft are expected (helicopters follow valleys).' },
        { k: 'indirect.lfWeights', label: 'Landform preference', type: 'weights', def: D.indirect.lfWeights, show: (v) => weaponCat(v) === 'indirect' },
        { k: 'indirect.wClear', label: 'Weight — crest clearance', type: 'number', def: D.indirect.wClear, min: 0, max: 5, step: 0.05, show: (v) => weaponCat(v) === 'indirect' },
        { k: 'indirect.wDefilade', label: 'Weight — defilade from enemy view', type: 'number', def: D.indirect.wDefilade, min: 0, max: 5, step: 0.05, show: (v) => weaponCat(v) === 'indirect' },
        { k: 'indirect.wRange', label: 'Weight — range suitability', type: 'number', def: D.indirect.wRange, min: 0, max: 5, step: 0.05, show: (v) => weaponCat(v) === 'indirect' },
        { k: 'indirect.wFlat', label: 'Weight — flat ground', type: 'number', def: D.indirect.wFlat, min: 0, max: 5, step: 0.05, show: (v) => weaponCat(v) === 'indirect' },
        { k: 'indirect.wAccess', label: 'Weight — access time', type: 'number', def: D.indirect.wAccess, min: 0, max: 5, step: 0.05, show: (v) => weaponCat(v) === 'indirect' },
        ...VALUE(false).map((p) => Object.assign({}, p, { show: (v) => weaponCat(v) === 'direct' })),
      ],
    },
    mfd: {
      name: 'Suggest Minefields', icon: 'mine',
      desc: 'Sites AT / AP minefields at the narrowest defiles on enemy avenues of approach, tied into NO-GO ground and within reach of own troops.',
      params: [
        { k: 'own', type: 'marker' }, { k: 'threat', type: 'marker' },
        { k: 'type', label: 'Minefield type', type: 'select', def: 'AT', options: [['AT', 'Anti-tank (AT)'], ['AP', 'Anti-personnel (AP)']] },
        { k: 'count', label: 'Number of minefields', type: 'number', def: D.mfd.count, min: 1, max: 30, step: 1 },
        { k: 'profile', label: 'Enemy movement class', type: 'select', def: 'auto', options: () => [['auto', 'Automatic (AT: armour/wheeled, AP: dismounted)'], ...profOpts()] },
        sec('Obstacle geometry', false),
        { k: 'maxGapM', label: 'Maximum gap width (0 = 600 AT / 300 AP)', type: 'number', def: 0, min: 0, max: 5000, step: 25, unit: 'm' },
        { k: 'depthM', label: 'Depth (0 = 100 AT / 40 AP)', type: 'number', def: 0, min: 0, max: 2000, step: 5, unit: 'm' },
        { k: 'densityPerM', label: 'Density (0 = 1 AT / 3 AP)', type: 'number', def: 0, min: 0, max: 20, step: 0.25, unit: 'mines/m' },
        { k: 'tieM', label: 'Tie-in into NO-GO ground', type: 'number', def: () => cfg('an.mfdTieM'), min: 0, max: 500, step: 5, unit: 'm' },
        sec('Siting constraints'),
        { k: 'minDistOwnM', label: 'Minimum distance from own position', type: 'number', def: D.mfd.minDistOwnM, min: 0, max: 20000, step: 50, unit: 'm' },
        { k: 'maxDistOwnM', label: 'Maximum distance from own position', type: 'number', def: D.mfd.maxDistOwnM, min: 100, max: 50000, step: 250, unit: 'm' },
        { k: 'minSepM', label: 'Minimum separation', type: 'number', def: D.mfd.minSepM, min: 50, max: 10000, step: 50, unit: 'm' },
        { k: 'avenues', label: 'Avenues of approach considered', type: 'number', def: D.mfd.avenues, min: 1, max: 4, step: 1 },
        { k: 'onePerAvenue', label: 'Block every avenue at least once', type: 'bool', def: D.mfd.onePerAvenue },
        { k: 'requireCovered', label: 'Only sites under own observation / fire', type: 'bool', def: D.mfd.requireCovered },
        sec('Search & scoring'),
        { k: 'orientations', label: 'Orientations tested at each defile', type: 'select', def: D.mfd.orientations, options: [[4, '4'], [8, '8'], [16, '16'], [32, '32']] },
        { k: 'narrowWeight', label: 'Weight of narrowness (0–1)', type: 'number', def: D.mfd.narrowWeight, min: 0, max: 1, step: 0.05 },
        { k: 'uncoveredFactor', label: 'Factor if not observed (0–1)', type: 'number', def: D.mfd.uncoveredFactor, min: 0, max: 1, step: 0.05 },
        { k: 'rearFactor', label: 'Factor behind own position (0–1)', type: 'number', def: D.mfd.rearFactor, min: 0, max: 1, step: 0.05 },
        { k: 'outOfRangeFactor', label: 'Factor outside distance band (0–1)', type: 'number', def: D.mfd.outOfRangeFactor, min: 0, max: 1, step: 0.05 },
      ],
    },
    route: {
      name: 'Least-Time Route', icon: 'route',
      desc: 'Anisotropic least-time route between A and B with alternatives, checkpoints and exposure to enemy observation.',
      params: [
        { k: 'a', type: 'marker' }, { k: 'b', type: 'marker' },
        { k: 'profile', label: 'Movement class', type: 'select', def: 'foot', options: profOpts },
        { k: 'mode', label: 'Optimisation', type: 'select', def: 'fastest', options: [['fastest', 'Fastest'], ['balanced', 'Balanced (time vs exposure)'], ['covered', 'Covered (avoid enemy observation)'], ['custom', 'Custom weights']] },
        { k: 'exposureW', label: 'Exposure penalty', type: 'number', def: 3, min: 0, max: 100, step: 0.5, unit: '×', show: (v) => v.mode === 'custom' },
        { k: 'skylineW', label: 'Skyline (crest) penalty', type: 'number', def: 0.8, min: 0, max: 20, step: 0.1, unit: '×', show: (v) => v.mode === 'custom' },
        { k: 'alternatives', label: 'Alternative routes', type: 'number', def: 2, min: 1, max: 4, step: 1 },
        { k: 'separationM', label: 'Separation of alternatives', type: 'number', def: () => cfg('an.altSepM'), min: 50, max: 5000, step: 50, unit: 'm' },
        { k: 'cpEveryM', label: 'Checkpoint interval (0 = none)', type: 'number', def: 1000, min: 0, max: 20000, step: 250, unit: 'm' },
      ],
    },
    picquets: {
      name: 'Route Picquets', icon: 'post',
      desc: 'Picquets on the heights dominating the selected route ("crowning the heights").',
      params: [
        { k: 'rangeM', label: 'Picquet observation range', type: 'number', def: D.picquets.rangeM, min: 200, max: 10000, step: 100, unit: 'm' },
        { k: 'count', label: 'Number of picquets (0 = automatic)', type: 'number', def: D.picquets.count, min: 0, max: 60, step: 1 },
        { k: 'kmPerPicquet', label: 'Automatic: route length per picquet', type: 'number', def: D.picquets.kmPerPicquet, min: 0.25, max: 20, step: 0.25, unit: 'km', show: (v) => !+v.count },
        { k: 'maxCount', label: 'Automatic: maximum picquets', type: 'number', def: D.picquets.maxCount, min: 1, max: 60, step: 1, show: (v) => !+v.count },
        { k: 'minSepM', label: 'Minimum separation', type: 'number', def: D.picquets.minSepM, min: 50, max: 10000, step: 50, unit: 'm' },
        sec('Site constraints'),
        { k: 'maxOffsetM', label: 'Maximum distance from route', type: 'number', def: D.picquets.maxOffsetM, min: 100, max: 20000, step: 100, unit: 'm' },
        { k: 'minLandform', label: 'Lowest landform allowed', type: 'select', def: D.picquets.minLandform, options: LF_NAMES.map((n, i) => [i, n]) },
        { k: 'maxSlope', label: 'Maximum site slope', type: 'number', def: D.picquets.maxSlope, min: 1, max: 80, step: 1, unit: '°' },
        { k: 'maxClimbH', label: 'Maximum climb time from route', type: 'number', def: D.picquets.maxClimbH, min: 0.25, max: 24, step: 0.25, unit: 'h' },
        sec('Search & scoring'),
        { k: 'candidates', label: 'Candidate sites evaluated', type: 'number', def: D.picquets.candidates, min: 10, max: 600, step: 10 },
        { k: 'overlapKeep', label: 'Value of overlapping coverage (0–1)', type: 'number', def: D.picquets.overlapKeep, min: 0, max: 1, step: 0.05 },
        { k: 'obsH', label: 'Observer height', type: 'number', def: D.picquets.obsH, min: 0, max: 50, step: 0.5, unit: 'm' },
        { k: 'tgtH', label: 'Target height', type: 'number', def: D.picquets.tgtH, min: 0, max: 50, step: 0.5, unit: 'm' },
      ],
    },
    fly: {
      name: 'Fly Route (3D)', icon: 'fly',
      desc: 'Animated fly-through of the selected route in the Scene view. Esc stops.',
      params: [
        { k: 'speed', label: 'Speed', type: 'number', def: () => cfg('v3.flySpeed'), min: 20, max: 5000, step: 10, unit: 'm/s' },
        { k: 'height', label: 'Height above route', type: 'number', def: () => cfg('v3.flyHeight'), min: 10, max: 5000, step: 10, unit: 'm' },
      ],
    },
    convert: {
      name: 'Convert Coordinates', icon: 'target',
      desc: 'Converts a reference in any supported format to all others (MGRS, UTM, lat/lon, GARS, GEOREF, secondary CRS).',
      params: [{ k: 'input', label: 'Input reference', type: 'text', def: '', help: 'e.g. 43S DV 1950 5100 · 35°42\'30"N 74°06\'00"E · 509LM32 · E/N in the secondary CRS' }],
    },
  };

  // ---------------------------------------------------------------- values
  let store = {};
  try { store = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { store = {}; }
  const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch (e) { /* unavailable */ } };
  const defOf = (p) => (typeof p.def === 'function' ? p.def() : p.def);

  /** Current flat values of a tool (stored or defaults). */
  const flatValues = (id) => {
    const t = TOOLS[id], s = store[id] || {}, v = {};
    for (const p of t.params) if (p.k && p.type !== 'section' && p.type !== 'marker' && p.type !== 'info') v[p.k] = p.k in s ? s[p.k] : defOf(p);
    // dynamic and weapon-bound values
    for (const p of t.params) {
      if (p.dynamic && (v[p.k] === null || v[p.k] === undefined)) v[p.k] = p.dynamic(v);
      if (p.weapon) v[p.k] = UI.app.weaponOf(v.weaponId)[p.weapon];
    }
    return v;
  };
  /** Nested values for the handler: "a.b" -> {a: {b}}. */
  const nest = (flat) => {
    const out = {};
    for (const [k, val] of Object.entries(flat)) {
      const parts = k.split('.');
      let o = out;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
      o[parts[parts.length - 1]] = val;
    }
    return out;
  };

  // ---------------------------------------------------------------- pane rendering
  const handlers = {};
  let current = null, lastMsg = {}, collapsed = {};
  const GP = (UI.GP = { TOOLS, BOXES, handle: (id, fn) => (handlers[id] = fn), values: (id) => nest(flatValues(id)), current: () => current });

  const control = (p, v) => {
    const val = v[p.k];
    switch (p.type) {
      case 'select': {
        const opts = typeof p.options === 'function' ? p.options() : p.options;
        return `<select data-k="${p.k}">${opts.map(([o, l]) => `<option value="${esc(o)}" ${String(o) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      }
      case 'bool': return `<label class="chk"><input type="checkbox" data-k="${p.k}" ${val ? 'checked' : ''}> ${esc(p.label)}</label>`;
      case 'password': return `<input type="password" data-k="${p.k}" value="${esc(val)}" autocomplete="off">`;
      case 'text': return `<input type="text" data-k="${p.k}" value="${esc(val)}" spellcheck="false">`;
      case 'checks': {
        const opts = typeof p.options === 'function' ? p.options() : p.options;
        const set = new Set((val || []).map(String));
        return `<div class="checks2">${opts.map(([o, l]) => `<label class="chk"><input type="checkbox" data-kc="${p.k}" value="${esc(o)}" ${set.has(String(o)) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>`;
      }
      case 'weights': return `<table class="wtab">${LF_NAMES.map((n, i) => `<tr><td>${n}</td><td><input type="number" step="0.05" min="0" max="5" data-kw="${p.k}" data-i="${i}" value="${(val || [])[i] ?? 0}"></td></tr>`).join('')}</table>`;
      case 'point': {
        const pt = val;
        const txt = pt && UI.S.grid ? UI.F.listRef(pt.r, pt.c) : '';
        return `<div class="ptrow"><input type="text" data-kp="${p.k}" value="${esc(txt)}" placeholder="Pick on map or type a reference" spellcheck="false"><button class="btn sm" data-pick="${p.k}" title="Pick on map">Pick</button></div>`;
      }
      default: return `<div class="numrow"><input type="number" data-k="${p.k}" value="${esc(val)}" ${p.min !== undefined ? `min="${p.min}"` : ''} ${p.max !== undefined ? `max="${p.max}"` : ''} step="${p.step || 'any'}">${p.unit ? `<span class="unit">${esc(p.unit)}</span>` : ''}</div>`;
    }
  };
  const MARKER_NAMES = { own: 'Own position', threat: 'Enemy position', target: 'Target area (optional — else enemy)', a: 'Start (A)', b: 'End (B)' };

  GP.home = () => {
    current = null;
    const q = (document.getElementById('gpFind') || {}).value || '';
    const el = document.getElementById('gpPane');
    const ql = q.trim().toLowerCase();
    el.innerHTML = `<div class="gp-find"><input id="gpFind" placeholder="Find tools" value="${esc(q)}" spellcheck="false"></div>
      <div class="gp-boxes">${BOXES.map((b) => {
        const tools = b.tools.filter((id) => !ql || (TOOLS[id].name + ' ' + TOOLS[id].desc + ' ' + b.name).toLowerCase().includes(ql));
        if (!tools.length) return '';
        return `<div class="gp-box"><div class="gp-box-h">${UI.icon('data', 14)}<span>${esc(b.name)}</span></div>${tools.map((id) =>
          `<button class="gp-tool" data-tool="${id}">${UI.icon(TOOLS[id].icon, 15)}<span><b>${esc(TOOLS[id].name)}</b><small>${esc(TOOLS[id].desc)}</small></span></button>`).join('')}</div>`;
      }).join('')}</div>`;
    const f = document.getElementById('gpFind');
    f.addEventListener('input', () => { GP.home(); const g = document.getElementById('gpFind'); g.focus(); g.setSelectionRange(g.value.length, g.value.length); });
    el.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => GP.open(b.dataset.tool)));
  };

  GP.open = (id) => {
    current = id;
    UI.app.showRightTab('gp');
    GP.render();
  };

  GP.render = () => {
    const id = current;
    if (!id) return GP.home();
    const t = TOOLS[id];
    const v = flatValues(id);
    const el = document.getElementById('gpPane');
    const scroll = (el.querySelector('.gp-form') || {}).scrollTop || 0;
    let html = `<div class="gp-head"><button class="ghost-ic" data-back title="Back to toolboxes">‹</button><span>${esc(t.name)}</span><button class="ghost-ic" data-help title="Tool help">?</button></div>
      <div class="gp-desc" hidden>${esc(t.desc)}</div><div class="gp-tabs"><span class="on">Parameters</span><button class="link" data-env>Environments…</button></div><div class="gp-form">`;
    let inSec = false, secId = '';
    for (const p of t.params) {
      if (p.show && !p.show(v)) continue;
      if (p.type === 'section') {
        if (inSec) html += '</div>';
        secId = `${id}:${p.label}`;
        const isCol = secId in collapsed ? collapsed[secId] : p.collapsed;
        html += `<div class="gp-sec${isCol ? ' col' : ''}"><button class="gp-sec-h" data-sec="${esc(secId)}">${esc(p.label)}</button>`;
        inSec = true;
        continue;
      }
      if (p.type === 'marker') {
        const m = UI.S.markers[p.k];
        html += `<div class="gp-p marker"><label>${esc(MARKER_NAMES[p.k])}</label><div class="ptrow"><code>${m && UI.S.grid ? esc(UI.F.listRef(m.r, m.c)) : '<span class="warn">not placed</span>'}</code><button class="btn sm" data-marker="${p.k}">Set on map</button></div></div>`;
        continue;
      }
      html += `<div class="gp-p">${p.type === 'bool' ? '' : `<label>${esc(p.label)}</label>`}${control(p, v)}${p.help ? `<div class="gp-help">${esc(p.help)}</div>` : ''}</div>`;
    }
    if (inSec) html += '</div>';
    const msg = lastMsg[id];
    html += `</div>${msg ? `<div class="gp-msg ${msg.err ? 'err' : msg.running ? 'run' : 'ok'}">${msg.running ? '<span class="pbar"><i id="gpBar"></i></span>' : ''}<b>${esc(msg.title)}</b>${msg.text ? `<div>${esc(msg.text).replace(/\n/g, '<br>')}</div>` : ''}</div>` : ''}
      <div class="gp-foot"><button class="btn" data-reset>Reset parameters</button><span class="grow"></span><button class="btn primary" data-run ${msg && msg.running ? 'disabled' : ''}>Run</button></div>`;
    el.innerHTML = html;
    el.querySelector('.gp-form').scrollTop = scroll;
    // wiring
    const save = (k, val) => {
      const p = t.params.find((x) => x.k === k);
      if (p && p.weapon) { UI.app.setWeaponField(flatValues(id).weaponId, p.weapon, val); return; }
      if (id === 'mobility' && ['go', 'slow', 'speed', 'road'].includes(k)) { UI.app.setProfileField(flatValues(id).profile, k, +val); return; }
      (store[id] = store[id] || {})[k] = val; persist();
    };
    el.querySelector('[data-back]').onclick = () => GP.home();
    el.querySelector('[data-help]').onclick = () => { const d = el.querySelector('.gp-desc'); d.hidden = !d.hidden; };
    el.querySelector('[data-env]').onclick = () => UI.Settings.open('an');
    el.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
      const p = t.params.find((x) => x.k === inp.dataset.k);
      let val = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (p.type === 'number') val = inp.value === '' ? null : +val;
      if (p.type === 'select' && typeof defOf(p) === 'number') val = +val;
      save(inp.dataset.k, val);
      if (id === 'mobility' && inp.dataset.k === 'profile') ['go', 'slow', 'speed', 'road'].forEach((k) => { if (store[id]) delete store[id][k]; });
      if (p.rerender || p.type === 'select' || p.type === 'bool') GP.render();
    }));
    el.querySelectorAll('[data-kc]').forEach((inp) => inp.addEventListener('change', () => {
      const k = inp.dataset.kc;
      const vals = [...el.querySelectorAll(`[data-kc="${k}"]:checked`)].map((x) => +x.value);
      save(k, vals);
    }));
    el.querySelectorAll('[data-kw]').forEach((inp) => inp.addEventListener('change', () => {
      const k = inp.dataset.kw;
      const vals = [...el.querySelectorAll(`[data-kw="${k}"]`)].map((x) => +x.value);
      save(k, vals);
    }));
    el.querySelectorAll('[data-kp]').forEach((inp) => inp.addEventListener('change', () => {
      const ll = UI.F.parse(inp.value);
      if (!ll || !UI.S.grid) { inp.classList.add('bad'); return; }
      const c = M.latLonToCell(UI.S.grid, ll.lat, ll.lon);
      save(inp.dataset.kp, { r: c.r, c: c.c });
      GP.render();
    }));
    el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.pick, p = t.params.find((x) => x.k === k);
      UI.app.pickPoint(p.label, (cell) => { save(k, cell); GP.render(); });
    }));
    el.querySelectorAll('[data-marker]').forEach((b) => b.addEventListener('click', () => UI.app.runCmd('tool:' + b.dataset.marker)));
    el.querySelectorAll('[data-sec]').forEach((b) => b.addEventListener('click', () => {
      const s = b.dataset.sec;
      collapsed[s] = !b.parentElement.classList.contains('col');
      b.parentElement.classList.toggle('col', collapsed[s]);
    }));
    el.querySelector('[data-reset]').onclick = () => {
      delete store[id]; persist();
      if (id === 'weapons') UI.app.setWeaponField(v.weaponId, null);
      if (id === 'mobility') UI.app.setProfileField(v.profile, null);
      lastMsg[id] = null; GP.render();
    };
    el.querySelector('[data-run]').onclick = () => GP.run(id);
  };

  /** Set one stored parameter value (e.g. a point picked with a ribbon tool). */
  GP.set = (id, k, val) => { (store[id] = store[id] || {})[k] = val; persist(); if (current === id) GP.render(); };

  GP.progress = (p) => { const b = document.getElementById('gpBar'); if (b) b.style.width = `${Math.round(p * 100)}%`; };

  GP.run = async (id) => {
    const t0 = performance.now();
    lastMsg[id] = { running: true, title: `Running ${TOOLS[id].name}…` };
    if (current === id) GP.render();
    try {
      const text = await handlers[id](GP.values(id));
      lastMsg[id] = { title: `Completed — ${TOOLS[id].name} (${((performance.now() - t0) / 1000).toFixed(1)} s)`, text: text || '' };
    } catch (e) {
      lastMsg[id] = { err: true, title: `Failed — ${TOOLS[id].name}`, text: e.message };
    }
    if (current === id) GP.render();
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
