/*
 * MtnAI ui — user settings: schema, persistent store and the Settings dialog.
 *
 * Every option is declared once in SCHEMA (key, type, default, description and an
 * `apply` tag telling the app what to refresh). Values persist in localStorage and
 * can be exported / imported as JSON for standardising a unit's configuration.
 */
(function (UI) {
  'use strict';
  const M = UI.M;
  const STORE_KEY = 'mtnai.settings.v1';

  const zoneOpts = [['auto', 'Automatic (zone of DEM centre)']].concat(Array.from({ length: 60 }, (_, i) => [String(i + 1), `Zone ${i + 1} (CM ${M.centralMeridian(i + 1)}°)`]));
  const crsOpts = () => [['none', 'None']].concat(Object.entries(M.CRS_PRESETS).map(([k, v]) => [k, `${v.name}${k.startsWith('EPSG') ? ` — ${k}` : ''}`]), [['CUSTOM', 'Custom CRS (defined below)']]);
  const datumOpts = () => Object.entries(M.DATUMS).map(([k, v]) => [k, v.name]).concat([['CUSTOM', 'Custom (ellipsoid + towgs84)']]);
  const ellOpts = () => Object.entries(M.ELLIPSOIDS).map(([k, v]) => [k, v.name]);

  /**
   * Item: {key, label, type: select|number|bool|color|text|info|editor, def, options, min, max, step, unit, desc, apply}
   * apply tags: ui · refs · grid · base · hs · contours · sym · ovl · 3d · mesh · analysis · reanalyse · zone · none
   */
  const SCHEMA = [
    { id: 'crs', title: 'Coordinate systems', items: [
      { type: 'info', key: 'crs.info' },
      { key: 'crs.zone', label: 'Analysis projection — UTM zone', type: 'select', def: 'auto', options: zoneOpts, apply: 'zone',
        desc: 'All analysis runs on a square-metre grid in WGS 84 / UTM. Force a zone to match unit maps or a DEM that straddles two zones. Applies when the DEM is (re)loaded.' },
      { key: 'crs.hemisphere', label: 'Analysis projection — hemisphere', type: 'select', def: 'auto', options: [['auto', 'Automatic'], ['N', 'Northern'], ['S', 'Southern']], apply: 'zone' },
      { key: 'crs.secondary', label: 'Secondary coordinate system', type: 'select', def: 'EPSG:24376', options: crsOpts, apply: 'crs',
        desc: 'Shown in the status bar, properties, attribute table, reports and as an optional map grid. The India / Pakistan Lambert zones use the Kalianpur 1962 datum (Everest 1830 ellipsoid).' },
      { key: 'crs.custom.name', label: 'Custom CRS — name', type: 'text', def: 'Custom CRS', apply: 'crs' },
      { key: 'crs.custom.datum', label: 'Custom CRS — datum', type: 'select', def: 'KALIANPUR1962', options: datumOpts, apply: 'crs' },
      { key: 'crs.custom.ellipsoid', label: 'Custom datum — ellipsoid', type: 'select', def: 'EVEREST1962', options: ellOpts, apply: 'crs', desc: 'Used when the datum is "Custom".' },
      { key: 'crs.custom.towgs84', label: 'Custom datum — towgs84 (dX, dY, dZ m)', type: 'text', def: '283, 682, 231', apply: 'crs', desc: 'Geocentric translation from the local datum to WGS 84.' },
      { key: 'crs.custom.proj', label: 'Custom CRS — projection', type: 'select', def: 'lcc1', apply: 'crs',
        options: [['geo', 'Geographic (lat / lon)'], ['utm', 'UTM'], ['tm', 'Transverse Mercator'], ['lcc1', 'Lambert Conformal Conic (1 SP)'], ['lcc2', 'Lambert Conformal Conic (2 SP)']] },
      { key: 'crs.custom.zone', label: 'Custom CRS — UTM zone', type: 'number', def: 43, min: 1, max: 60, step: 1, apply: 'crs' },
      { key: 'crs.custom.lat0', label: 'Latitude of origin', type: 'number', def: 32.5, step: 0.0001, unit: '°', apply: 'crs' },
      { key: 'crs.custom.lon0', label: 'Central meridian / longitude of origin', type: 'number', def: 68, step: 0.0001, unit: '°', apply: 'crs' },
      { key: 'crs.custom.lat1', label: 'Standard parallel 1 (2 SP)', type: 'number', def: 30, step: 0.0001, unit: '°', apply: 'crs' },
      { key: 'crs.custom.lat2', label: 'Standard parallel 2 (2 SP)', type: 'number', def: 35, step: 0.0001, unit: '°', apply: 'crs' },
      { key: 'crs.custom.k0', label: 'Scale factor at origin', type: 'number', def: 0.99878641, step: 0.00000001, apply: 'crs' },
      { key: 'crs.custom.fe', label: 'False easting', type: 'number', def: 2743196.4, step: 0.1, unit: 'm', apply: 'crs' },
      { key: 'crs.custom.fn', label: 'False northing', type: 'number', def: 914398.8, step: 0.1, unit: 'm', apply: 'crs' },
    ] },
    { id: 'refs', title: 'Grid references', items: [
      { key: 'ref.primary', label: 'Primary reference format', type: 'select', def: 'mgrs', apply: 'refs',
        options: [['mgrs', 'MGRS (Military Grid Reference System)'], ['utm', 'UTM easting / northing'], ['dms', 'Lat / lon — degrees minutes seconds'], ['dm', 'Lat / lon — degrees decimal minutes'],
          ['dd', 'Lat / lon — decimal degrees'], ['gars', 'GARS (Global Area Reference System)'], ['georef', 'GEOREF (World Geographic Reference System)'], ['proj', 'Secondary CRS — easting / northing'], ['gr', 'Secondary CRS — grid reference (figures)']],
        desc: 'Used in the status bar, lists, properties, attribute table, measurements and reports.' },
      { key: 'ref.digits', label: 'MGRS / GR precision (status bar)', type: 'select', def: 5, apply: 'refs',
        options: [[1, '2-figure — 10 km'], [2, '4-figure — 1 km'], [3, '6-figure — 100 m'], [4, '8-figure — 10 m'], [5, '10-figure — 1 m']] },
      { key: 'ref.listDigits', label: 'MGRS / GR precision (lists, tables, reports)', type: 'select', def: 4, apply: 'refs',
        options: [[2, '4-figure — 1 km'], [3, '6-figure — 100 m'], [4, '8-figure — 10 m'], [5, '10-figure — 1 m']] },
      { key: 'ref.mgrsSpaced', label: 'Space-separate MGRS components', type: 'bool', def: true, apply: 'refs' },
      { key: 'ref.llDecimals', label: 'Lat / lon decimals', type: 'select', def: 'std', apply: 'refs',
        options: [['low', 'Low (DD 4 · DM 2 · DMS 0)'], ['std', 'Standard (DD 5 · DM 3 · DMS 1)'], ['high', 'High (DD 7 · DM 5 · DMS 3)']] },
      { key: 'ref.gars', label: 'GARS precision', type: 'select', def: 5, options: [[30, "30' cell"], [15, "15' quadrant"], [5, "5' keypad"]], apply: 'refs' },
      { key: 'ref.georef', label: 'GEOREF precision', type: 'select', def: 2, options: [[2, "1' (2 + 2 digits)"], [3, "0.1' (3 + 3)"], [4, "0.01' (4 + 4)"]], apply: 'refs' },
      { key: 'ref.secondaryReadout', label: 'Show secondary CRS in status bar', type: 'bool', def: true, apply: 'refs' },
      { key: 'ref.forceZone', label: 'MGRS / UTM in analysis zone', type: 'bool', def: true, apply: 'refs',
        desc: 'Keep references in the analysis UTM zone across zone boundaries (consistent with the map grid). Off = standard zone of each point.' },
    ] },
    { id: 'north', title: 'North reference & angles', items: [
      { key: 'north.ref', label: 'Bearing reference', type: 'select', def: 'grid', apply: 'refs',
        options: [['grid', 'Grid north (GN)'], ['true', 'True north (TN)'], ['magnetic', 'Magnetic north (MN)']],
        desc: 'Bearings, arcs of fire and measurements are converted with grid convergence (computed) and magnetic declination (entered below).' },
      { key: 'north.declination', label: 'Magnetic declination at epoch', type: 'number', def: 0, step: 0.1, unit: '° (E +)', apply: 'refs',
        desc: 'From the map margin or a magnetic model; east positive. Leave 0 if unknown (magnetic bearings will then equal true).' },
      { key: 'north.annual', label: 'Annual change', type: 'number', def: 0, step: 0.1, unit: "' / yr (E +)", apply: 'refs' },
      { key: 'north.epoch', label: 'Declination epoch (year)', type: 'number', def: 2025, step: 1, min: 1900, max: 2100, apply: 'refs' },
      { key: 'north.unit', label: 'Angular unit', type: 'select', def: 'mil6400', apply: 'refs',
        options: [['mil6400', 'Mils — NATO (6400)'], ['mil6000', 'Mils — 6000'], ['deg', 'Degrees'], ['grad', 'Gradians (400)']] },
      { key: 'north.decimals', label: 'Angle decimals', type: 'select', def: 0, options: [[0, '0'], [1, '1'], [2, '2']], apply: 'refs' },
      { key: 'north.diagram', label: 'Declination diagram on map', type: 'bool', def: true, apply: 'grid' },
    ] },
    { id: 'units', title: 'Units & vertical datum', items: [
      { key: 'units.distance', label: 'Distance', type: 'select', def: 'metric', apply: 'refs',
        options: [['metric', 'Metric (m, km)'], ['yards', 'Yards / miles'], ['imperial', 'Feet / miles'], ['nautical', 'Nautical miles']] },
      { key: 'units.elevation', label: 'Elevation', type: 'select', def: 'm', options: [['m', 'Metres'], ['ft', 'Feet']], apply: 'refs' },
      { key: 'units.area', label: 'Area', type: 'select', def: 'km2', options: [['km2', 'km²'], ['ha', 'Hectares'], ['mi2', 'mi²']], apply: 'refs' },
      { key: 'units.time', label: 'Duration', type: 'select', def: 'hmin', options: [['hmin', '4 h 46 min'], ['clock', '04:46'], ['dec', '4.8 h']], apply: 'refs' },
      { key: 'units.vdatum', label: 'Vertical datum of the DEM', type: 'select', def: 'EGM96', apply: 'refs',
        options: [['EGM96', 'EGM96 geoid (SRTM)'], ['EGM2008', 'EGM2008 geoid (Copernicus DEM)'], ['WGS84', 'WGS 84 ellipsoid'], ['MSL', 'Local mean sea level']],
        desc: 'Recorded in exports and reports.' },
      { key: 'units.elevOffset', label: 'Elevation offset for display', type: 'number', def: 0, step: 0.1, unit: 'm', apply: 'refs',
        desc: 'Added to every displayed height, e.g. a local geoid / MSL correction. Analysis is unaffected.' },
    ] },
    { id: 'grid', title: 'Map grids & graticule', items: [
      { key: 'grid.mgrs', label: 'MGRS / UTM grid', type: 'bool', def: true, apply: 'grid' },
      { key: 'grid.mgrsInterval', label: 'Grid interval', type: 'select', def: 'auto', apply: 'grid',
        options: [['auto', 'Automatic'], [100, '100 m'], [500, '500 m'], [1000, '1 km'], [2000, '2 km'], [5000, '5 km'], [10000, '10 km']] },
      { key: 'grid.mgrsLabels', label: 'Grid line labels', type: 'select', def: 'principal', apply: 'grid',
        options: [['none', 'None'], ['principal', 'Principal digits (e.g. 47)'], ['full', 'Full easting / northing']] },
      { key: 'grid.squareIds', label: 'Label 100 km square identifiers', type: 'bool', def: true, apply: 'grid' },
      { key: 'grid.mgrsColor', label: 'Grid colour', type: 'color', def: '#3d7bff', apply: 'grid' },
      { key: 'grid.graticule', label: 'Lat / lon graticule', type: 'bool', def: false, apply: 'grid' },
      { key: 'grid.graticuleInterval', label: 'Graticule interval', type: 'select', def: 'auto', apply: 'grid',
        options: [['auto', 'Automatic'], [1, "1'"], [2, "2'"], [5, "5'"], [10, "10'"], [15, "15'"], [30, "30'"], [60, '1°']] },
      { key: 'grid.graticuleColor', label: 'Graticule colour', type: 'color', def: '#e0a63a', apply: 'grid' },
      { key: 'grid.secondary', label: 'Secondary CRS grid', type: 'bool', def: false, apply: 'grid' },
      { key: 'grid.secondaryInterval', label: 'Secondary grid interval', type: 'select', def: 'auto', apply: 'grid',
        options: [['auto', 'Automatic'], [1000, '1 km'], [2000, '2 km'], [5000, '5 km'], [10000, '10 km'], [20000, '20 km']] },
      { key: 'grid.secondaryColor', label: 'Secondary grid colour', type: 'color', def: '#d24dff', apply: 'grid' },
      { key: 'grid.width', label: 'Grid line width', type: 'number', def: 0.8, min: 0.3, max: 3, step: 0.1, unit: 'px', apply: 'grid' },
      { key: 'grid.in3d', label: 'Drape grids on 3D terrain', type: 'bool', def: true, apply: 'grid' },
    ] },
    { id: 'map', title: 'Map display', items: [
      { key: 'map.base', label: 'Default base layer', type: 'select', def: 'relief', apply: 'base',
        options: [['relief', 'Shaded relief'], ['elevation', 'Elevation (hypsometric)'], ['slope', 'Slope'], ['aspect', 'Aspect'], ['landform', 'Landforms'], ['tri', 'Ruggedness']] },
      { key: 'map.hsAzimuth', label: 'Hillshade sun azimuth', type: 'number', def: 315, min: 0, max: 359, step: 1, unit: '°', apply: 'hs' },
      { key: 'map.hsAltitude', label: 'Hillshade sun altitude', type: 'number', def: 45, min: 5, max: 85, step: 1, unit: '°', apply: 'hs' },
      { key: 'map.hsMulti', label: 'Multi-directional hillshade', type: 'bool', def: true, apply: 'hs' },
      { key: 'map.hsZ', label: 'Hillshade z-factor', type: 'number', def: 1, min: 0.2, max: 5, step: 0.1, apply: 'hs' },
      { key: 'map.blend', label: 'Hillshade blend under colour layers', type: 'number', def: 0.58, min: 0, max: 1, step: 0.05, apply: 'base' },
      { key: 'map.contours', label: 'Contours', type: 'bool', def: true, apply: 'base' },
      { key: 'map.contourInterval', label: 'Contour interval', type: 'select', def: 0, apply: 'contours',
        options: [[0, 'Automatic'], [10, '10 m'], [20, '20 m'], [25, '25 m'], [40, '40 m'], [50, '50 m'], [100, '100 m'], [200, '200 m']] },
      { key: 'map.contourIndex', label: 'Index contour every', type: 'number', def: 5, min: 2, max: 10, step: 1, unit: 'lines', apply: 'contours' },
      { key: 'map.contourColor', label: 'Contour colour', type: 'color', def: '#7a4a22', apply: 'base' },
      { key: 'map.spotHeights', label: 'Spot heights & cols', type: 'bool', def: true, apply: 'grid' },
      { key: 'map.scaleBar', label: 'Scale bar', type: 'bool', def: true, apply: 'grid' },
      { key: 'map.background', label: 'Map background', type: 'color', def: '#15171c', apply: 'grid' },
    ] },
    { id: 'sym', title: 'Symbology', items: [
      { key: 'sym.size', label: 'Symbol size', type: 'number', def: 30, min: 16, max: 64, step: 1, unit: 'px', apply: 'sym' },
      { key: 'sym.colorMode', label: 'Affiliation colour mode (APP-6D)', type: 'select', def: 'light', apply: 'sym',
        options: [['light', 'Light (default)'], ['medium', 'Medium'], ['dark', 'Dark']] },
      { key: 'sym.filled', label: 'Filled frames', type: 'bool', def: true, apply: 'sym' },
      { key: 'sym.planned', label: 'Show suggestions as planned (dashed frame)', type: 'bool', def: true, apply: 'sym' },
      { key: 'sym.labels', label: 'Labels', type: 'bool', def: true, apply: 'sym' },
      { key: 'sym.labelSize', label: 'Label size', type: 'number', def: 12, min: 9, max: 18, step: 1, unit: 'px', apply: 'sym' },
      { key: 'sym.routeColor', label: 'Own route colour', type: 'color', def: '#27c4ff', apply: 'sym' },
      { key: 'sym.avenueColor', label: 'Enemy avenue colour', type: 'color', def: '#ff3b30', apply: 'sym' },
      { key: 'sym.sectorColor', label: 'Arc-of-fire colour', type: 'color', def: '#1f6fff', apply: 'sym' },
    ] },
    { id: 'ovl', title: 'Analysis overlays', items: [
      { key: 'ovl.goColor', label: 'GO colour', type: 'color', def: '#2ea043', apply: 'ovl' },
      { key: 'ovl.slowColor', label: 'SLOW-GO colour', type: 'color', def: '#e8aa28', apply: 'ovl' },
      { key: 'ovl.nogoColor', label: 'NO-GO colour', type: 'color', def: '#d93a32', apply: 'ovl' },
      { key: 'ovl.goAlpha', label: 'GO opacity', type: 'number', def: 0.3, min: 0, max: 1, step: 0.05, apply: 'ovl' },
      { key: 'ovl.restrictedAlpha', label: 'SLOW-GO / NO-GO opacity', type: 'number', def: 0.6, min: 0, max: 1, step: 0.05, apply: 'ovl' },
      { key: 'ovl.mobStyle', label: 'Mobility style', type: 'select', def: 'fill', options: [['fill', 'Colour fill'], ['hatch', 'Doctrinal hatching']], apply: 'ovl' },
      { key: 'ovl.viewshedColor', label: 'Viewshed colour', type: 'color', def: '#ffe246', apply: 'ovl' },
      { key: 'ovl.hostileColor', label: 'Enemy observation colour', type: 'color', def: '#ff3232', apply: 'ovl' },
      { key: 'ovl.deadColor', label: 'Dead ground colour', type: 'color', def: '#dc3cdc', apply: 'ovl' },
      { key: 'ovl.fireColor', label: 'Fields of fire colour', type: 'color', def: '#ff9628', apply: 'ovl' },
      { key: 'ovl.exclusive', label: 'Show one analysis overlay at a time', type: 'bool', def: true, apply: 'none',
        desc: 'New results hide other overlays (they remain in the Layers panel).' },
    ] },
    { id: 'v3', title: '3D view', items: [
      { key: 'v3.vex', label: 'Vertical exaggeration', type: 'number', def: 1.5, min: 1, max: 5, step: 0.1, unit: '×', apply: '3d' },
      { key: 'v3.mesh', label: 'Mesh resolution', type: 'select', def: 512, options: [[256, '256 × 256 (fast)'], [384, '384 × 384'], [512, '512 × 512'], [768, '768 × 768 (detailed)']], apply: 'mesh' },
      { key: 'v3.fov', label: 'Field of view', type: 'number', def: 45, min: 20, max: 80, step: 1, unit: '°', apply: '3d' },
      { key: 'v3.light', label: 'Sun lighting strength', type: 'number', def: 0.42, min: 0, max: 1, step: 0.05, apply: '3d' },
      { key: 'v3.haze', label: 'Atmospheric haze', type: 'number', def: 0.55, min: 0, max: 1, step: 0.05, apply: '3d' },
      { key: 'v3.sky', label: 'Background', type: 'color', def: '#1b2029', apply: '3d' },
      { key: 'v3.skirts', label: 'Terrain block sides', type: 'bool', def: true, apply: '3d' },
      { key: 'v3.lift', label: 'Symbol leader height', type: 'number', def: 26, min: 0, max: 80, step: 1, unit: 'px', apply: '3d' },
      { key: 'v3.flySpeed', label: 'Fly-through speed', type: 'number', def: 260, min: 50, max: 2000, step: 10, unit: 'm/s', apply: 'none' },
      { key: 'v3.flyHeight', label: 'Fly-through height above route', type: 'number', def: 140, min: 20, max: 2000, step: 10, unit: 'm', apply: 'none' },
    ] },
    { id: 'an', title: 'Analysis parameters', items: [
      { key: 'an.curvature', label: 'Earth curvature in intervisibility', type: 'bool', def: true, apply: 'analysis' },
      { key: 'an.refraction', label: 'Refraction coefficient k', type: 'number', def: 0.13, min: 0, max: 1, step: 0.01, apply: 'analysis', desc: 'Standard atmosphere 0.13; 0 = no refraction.' },
      { key: 'an.obsH', label: 'Default observer height (tools)', type: 'number', def: 2, min: 0, max: 100, step: 0.5, unit: 'm', apply: 'none' },
      { key: 'an.tgtH', label: 'Default target height (tools)', type: 'number', def: 1.5, min: 0, max: 200, step: 0.5, unit: 'm', apply: 'none' },
      { key: 'an.tpiSmallM', label: 'Landform scale (local TPI radius)', type: 'number', def: 250, min: 50, max: 2000, step: 25, unit: 'm', apply: 'reanalyse' },
      { key: 'an.tpiLargeM', label: 'Dominance scale (regional TPI radius)', type: 'number', def: 1500, min: 300, max: 10000, step: 100, unit: 'm', apply: 'reanalyse' },
      { key: 'an.altStart', label: 'Altitude penalty starts at', type: 'number', def: 2500, min: 0, max: 8000, step: 100, unit: 'm', apply: 'analysis' },
      { key: 'an.altRate', label: 'Altitude penalty per 1000 m', type: 'number', def: 8, min: 0, max: 40, step: 1, unit: '%', apply: 'analysis' },
      { key: 'an.routeNeighbours', label: 'Route search connectivity', type: 'select', def: 16, options: [[8, '8 neighbours'], [16, '16 neighbours (smoother headings)']], apply: 'analysis' },
      { key: 'an.altSepM', label: 'Alternative route separation', type: 'number', def: 350, min: 50, max: 3000, step: 50, unit: 'm', apply: 'analysis' },
      { key: 'an.expBalanced', label: 'Exposure penalty — balanced', type: 'number', def: 1.5, min: 0, max: 20, step: 0.1, unit: '×', apply: 'analysis' },
      { key: 'an.expCovered', label: 'Exposure penalty — covered', type: 'number', def: 6, min: 0, max: 50, step: 0.5, unit: '×', apply: 'analysis' },
      { key: 'an.skyCovered', label: 'Skyline (crest) penalty — covered', type: 'number', def: 1.2, min: 0, max: 10, step: 0.1, unit: '×', apply: 'analysis' },
      { key: 'an.hostileCount', label: 'Likely enemy OPs modelled', type: 'number', def: 5, min: 0, max: 30, step: 1, apply: 'analysis' },
      { key: 'an.hostileSearchM', label: 'Enemy OP search radius', type: 'number', def: 3000, min: 500, max: 20000, step: 250, unit: 'm', apply: 'analysis' },
      { key: 'an.hostileRangeM', label: 'Enemy observation range', type: 'number', def: 8000, min: 1000, max: 30000, step: 500, unit: 'm', apply: 'analysis' },
      { key: 'an.hostileObsH', label: 'Enemy observer height', type: 'number', def: 3, min: 0, max: 50, step: 0.5, unit: 'm', apply: 'analysis' },
      { key: 'an.mfdTieM', label: 'Minefield tie-in into No-Go ground', type: 'number', def: 30, min: 0, max: 300, step: 5, unit: 'm', apply: 'analysis' },
    ] },
    { id: 'mov', title: 'Movement classes', items: [{ type: 'editor', key: 'profiles', def: {}, apply: 'analysis' }] },
    { id: 'wpn', title: 'Weapon data', items: [{ type: 'editor', key: 'weapons', def: {}, apply: 'none' }] },
    { id: 'data', title: 'Data import', items: [
      { key: 'data.maxCells', label: 'Maximum analysis grid', type: 'select', def: 1048576, apply: 'none',
        options: [[262144, '512 × 512'], [589824, '768 × 768'], [1048576, '1024 × 1024'], [2359296, '1536 × 1536'], [4194304, '2048 × 2048 (slow)']] },
      { key: 'data.resample', label: 'Resampling method', type: 'select', def: 'bilinear', options: [['bilinear', 'Bilinear (smooth)'], ['nearest', 'Nearest neighbour (preserve values)']], apply: 'none' },
      { key: 'data.cellSize', label: 'Target cell size (0 = native)', type: 'number', def: 0, min: 0, max: 500, step: 1, unit: 'm', apply: 'none' },
      { key: 'data.ascZone', label: 'UTM zone for projected ASCII grids', type: 'text', def: '43N', apply: 'none' },
    ] },
    { id: 'rep', title: 'Reports & export', items: [
      { key: 'rep.banner', label: 'Handling / classification banner', type: 'text', def: 'FOR PLANNING — VERIFY BY GROUND RECONNAISSANCE', apply: 'none' },
      { key: 'rep.org', label: 'Unit / formation', type: 'text', def: '', apply: 'none' },
      { key: 'rep.author', label: 'Prepared by', type: 'text', def: '', apply: 'none' },
      { key: 'rep.map2d', label: 'Include 2D map in report', type: 'bool', def: true, apply: 'none' },
      { key: 'rep.map3d', label: 'Include 3D view in report', type: 'bool', def: true, apply: 'none' },
      { key: 'rep.geojsonDecimals', label: 'GeoJSON coordinate decimals', type: 'number', def: 7, min: 4, max: 9, step: 1, apply: 'none' },
      { key: 'rep.prefix', label: 'File name prefix', type: 'text', def: '', apply: 'none' },
    ] },
    { id: 'ui', title: 'Interface', items: [
      { key: 'ui.theme', label: 'Theme', type: 'select', def: 'dark', apply: 'ui',
        options: [['dark', 'Dark (graphite)'], ['light', 'Light'], ['contrast', 'High contrast'], ['night', 'Night (red, preserves dark adaptation)']] },
      { key: 'ui.density', label: 'Density', type: 'select', def: 'compact', options: [['compact', 'Compact'], ['comfortable', 'Comfortable']], apply: 'ui' },
      { key: 'ui.fontSize', label: 'Interface font size', type: 'number', def: 12.5, min: 11, max: 16, step: 0.5, unit: 'px', apply: 'ui' },
      { key: 'ui.startup', label: 'On start-up', type: 'select', def: 'welcome', options: [['welcome', 'Show start page'], ['demo', 'Load the demo terrain']], apply: 'none' },
      { key: 'ui.toastSec', label: 'Notification duration', type: 'number', def: 5, min: 1, max: 30, step: 1, unit: 's', apply: 'none' },
    ] },
  ];

  const ITEMS = {};
  for (const sec of SCHEMA) for (const it of sec.items) if (it.key) ITEMS[it.key] = Object.assign({ section: sec.id }, it);

  // ---------------------------------------------------------------- store
  let values = {};
  try { values = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { values = {}; }
  const listeners = [];
  const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(values)); } catch (e) { /* storage unavailable */ } };
  const coerce = (it, v) => {
    if (!it) return v;
    if (it.type === 'number') { const n = +v; return Number.isFinite(n) ? n : it.def; }
    if (it.type === 'bool') return !!v;
    if (it.type === 'select' && typeof it.def === 'number' && v !== 'auto') return +v;
    return v;
  };

  const Settings = {
    SCHEMA, ITEMS,
    get(key) { return key in values ? values[key] : ITEMS[key] ? ITEMS[key].def : undefined; },
    isModified(key) { return key in values && JSON.stringify(values[key]) !== JSON.stringify(ITEMS[key] && ITEMS[key].def); },
    set(key, v, silent) {
      v = coerce(ITEMS[key], v);
      const item = ITEMS[key];
      if (item && JSON.stringify(v) === JSON.stringify(item.def)) delete values[key]; else values[key] = v;
      persist();
      if (!silent) listeners.forEach((fn) => fn([key]));
    },
    reset(keys) {
      const ks = keys || Object.keys(values);
      for (const k of ks) delete values[k];
      persist();
      listeners.forEach((fn) => fn(ks));
    },
    on(fn) { listeners.push(fn); },
    exportJSON() { return JSON.stringify({ format: 'mtnai-settings', version: M.VERSION, values }, null, 2); },
    importJSON(text) {
      const o = JSON.parse(text);
      if (o.format !== 'mtnai-settings') throw new Error('Not an MtnAI settings file.');
      const ks = Object.keys(values).concat(Object.keys(o.values || {}));
      values = Object.assign({}, o.values);
      persist();
      listeners.forEach((fn) => fn(ks));
    },
    /** Apply tags touched by a list of keys. */
    tags(keys) { return new Set(keys.map((k) => (ITEMS[k] ? ITEMS[k].apply : 'none'))); },
  };
  UI.Settings = Settings;
  UI.cfg = (k) => Settings.get(k);

  // ---------------------------------------------------------------- dialog
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  let activeSection = 'crs';

  const control = (it) => {
    const v = Settings.get(it.key);
    const id = 'set_' + it.key.replace(/\W/g, '_');
    switch (it.type) {
      case 'select': {
        const opts = typeof it.options === 'function' ? it.options() : it.options;
        return `<select id="${id}" data-key="${it.key}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      }
      case 'bool': return `<label class="switch"><input type="checkbox" id="${id}" data-key="${it.key}" ${v ? 'checked' : ''}><span></span></label>`;
      case 'color': return `<input type="color" id="${id}" data-key="${it.key}" value="${esc(v)}"><code>${esc(v)}</code>`;
      case 'number': return `<input type="number" id="${id}" data-key="${it.key}" value="${esc(v)}" ${it.min !== undefined ? `min="${it.min}"` : ''} ${it.max !== undefined ? `max="${it.max}"` : ''} step="${it.step || 'any'}">${it.unit ? `<span class="unit">${esc(it.unit)}</span>` : ''}`;
      default: return `<input type="text" id="${id}" data-key="${it.key}" value="${esc(v)}" spellcheck="false">`;
    }
  };

  const crsInfo = () => {
    const g = UI.S && UI.S.grid;
    const ana = g ? `WGS 84 / UTM zone ${g.zone}${g.north ? 'N' : 'S'} (EPSG:${g.north ? 326 : 327}${String(g.zone).padStart(2, '0')}) · cell ${g.cs} m` : 'WGS 84 / UTM — zone set when a DEM is loaded';
    const sc = UI.F ? UI.F.secondaryCRS() : null;
    const d = sc ? M.describeCRS(sc) : null;
    return `<div class="crs-card"><div><b>Analysis CRS</b><span>${esc(ana)}</span></div>
      <div><b>Secondary CRS</b><span>${sc ? esc(sc.name) : 'None'}</span></div>
      ${d ? `<div><b>Datum</b><span>${esc(d.datum)} — ${esc(d.ellipsoid)}</span></div><div><b>towgs84</b><span>${esc(d.towgs84)} m</span></div><div><b>Projection</b><span>${esc(d.projection)}</span></div>` : ''}
      <p class="hint">Datum-shift parameters are 3-parameter approximations (metre-level). Confirm local parameters with your survey authority; use a custom CRS to override.</p></div>`;
  };

  const profilesEditor = () => {
    const ov = Settings.get('profiles') || {};
    const rows = Object.values(M.MOVEMENT_PROFILES).map((p) => {
      const o = ov[p.id] || {};
      const cell = (k, step) => `<input type="number" step="${step}" data-prof="${p.id}" data-pk="${k}" value="${o[k] ?? p[k]}" class="${o[k] !== undefined && o[k] !== p[k] ? 'mod' : ''}">`;
      return `<tr><td>${esc(p.name)}</td><td>${cell('go', 1)}</td><td>${cell('slow', 1)}</td><td>${cell('speed', 0.5)}</td><td>${cell('road', 0.5)}</td></tr>`;
    }).join('');
    return `<p class="hint">Slope limits (degrees) for GO and SLOW-GO, and speeds (km/h) cross-country and on digitised tracks. Used by mobility, routing, access and avenues of approach.</p>
      <table class="ed"><thead><tr><th>Movement class</th><th>GO ≤ °</th><th>SLOW-GO ≤ °</th><th>X-country km/h</th><th>Track km/h</th></tr></thead><tbody>${rows}</tbody></table>
      <button class="btn" data-reset-editor="profiles">Restore defaults</button>`;
  };

  const weaponsEditor = () => {
    const ov = Settings.get('weapons') || {};
    const acc = Object.values(M.MOVEMENT_PROFILES);
    const rows = M.WEAPON_GROUPS.map((gr) => `<tr class="grp"><td colspan="6">${esc(gr.name)}</td></tr>` + gr.ids.map((id) => {
      const w = M.WEAPONS[id], o = ov[id] || {};
      const cell = (k, step) => `<input type="number" step="${step}" data-wpn="${id}" data-wk="${k}" value="${o[k] ?? w[k]}" class="${o[k] !== undefined && o[k] !== w[k] ? 'mod' : ''}">`;
      const a = o.access ?? w.access;
      return `<tr><td>${esc(w.name)}</td><td>${cell('minR', 50)}</td><td>${cell('maxR', 50)}</td><td>${cell('siteSlope', 1)}</td><td>${w.obsH !== undefined ? cell('obsH', 0.1) : '—'}</td>
        <td><select data-wpn="${id}" data-wk="access">${acc.map((p) => `<option value="${p.id}" ${p.id === a ? 'selected' : ''}>${esc(p.name.split(' (')[0])}</option>`).join('')}</select></td></tr>`;
    }).join('')).join('');
    return `<p class="hint">Indicative open-source values — replace with current unit data. Ranges in metres, site slope in degrees, sight height in metres above ground.</p>
      <table class="ed"><thead><tr><th>Weapon</th><th>Min range</th><th>Max range</th><th>Max site slope</th><th>Sight ht</th><th>Access</th></tr></thead><tbody>${rows}</tbody></table>
      <button class="btn" data-reset-editor="weapons">Restore defaults</button>`;
  };

  const rowHTML = (it) => {
    if (it.type === 'info') return `<div class="set-info">${crsInfo()}</div>`;
    if (it.type === 'editor') return `<div class="set-editor">${it.key === 'profiles' ? profilesEditor() : weaponsEditor()}</div>`;
    const mod = Settings.isModified(it.key);
    return `<div class="set-row${mod ? ' mod' : ''}" data-row="${it.key}">
      <div class="set-l"><div class="set-t">${esc(it.label)}${mod ? ` <button class="link" data-reset="${it.key}" title="Restore default">reset</button>` : ''}</div>${it.desc ? `<div class="set-d">${esc(it.desc)}</div>` : ''}<div class="set-k">${esc(it.key)}</div></div>
      <div class="set-c">${control(it)}</div></div>`;
  };

  Settings.render = () => {
    const dlg = document.getElementById('settings');
    const q = document.getElementById('setSearch').value.trim().toLowerCase();
    document.getElementById('setNav').innerHTML = SCHEMA.map((s) => {
      const n = s.items.filter((it) => it.key && Settings.isModified(it.key)).length +
        (s.items.some((it) => it.type === 'editor' && Object.keys(Settings.get(it.key) || {}).length) ? 1 : 0);
      return `<button data-sec="${s.id}" class="${s.id === activeSection && !q ? 'on' : ''}">${esc(s.title)}${n ? `<i>${n}</i>` : ''}</button>`;
    }).join('');
    let body;
    if (q) {
      body = SCHEMA.map((s) => {
        const rows = s.items.filter((it) => it.label && (it.label + ' ' + (it.desc || '') + ' ' + it.key).toLowerCase().includes(q));
        return rows.length ? `<h4>${esc(s.title)}</h4>` + rows.map(rowHTML).join('') : '';
      }).join('') || '<p class="hint">No matching setting.</p>';
    } else {
      const s = SCHEMA.find((x) => x.id === activeSection);
      body = `<h3>${esc(s.title)}</h3>` + s.items.map(rowHTML).join('');
    }
    const box = document.getElementById('setBody');
    const scroll = box.scrollTop;
    box.innerHTML = body;
    box.scrollTop = scroll;
    // custom CRS rows only matter when CUSTOM is selected
    const customOn = Settings.get('crs.secondary') === 'CUSTOM';
    box.querySelectorAll('[data-row^="crs.custom"]').forEach((r) => r.classList.toggle('dim', !customOn));
    dlg.querySelectorAll('#setNav [data-sec]').forEach((b) => (b.onclick = () => { activeSection = b.dataset.sec; document.getElementById('setSearch').value = ''; Settings.render(); box.scrollTop = 0; }));
    box.querySelectorAll('[data-key]').forEach((el) => {
      const ev = el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'change';
      el.addEventListener(ev, () => {
        Settings.set(el.dataset.key, el.type === 'checkbox' ? el.checked : el.value);
        Settings.render();
      });
    });
    box.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = () => { Settings.reset([b.dataset.reset]); Settings.render(); }));
    box.querySelectorAll('[data-reset-editor]').forEach((b) => (b.onclick = () => { Settings.set(b.dataset.resetEditor, {}); Settings.render(); }));
    box.querySelectorAll('[data-prof]').forEach((el) => el.addEventListener('change', () => {
      const o = JSON.parse(JSON.stringify(Settings.get('profiles') || {}));
      const p = (o[el.dataset.prof] = o[el.dataset.prof] || {});
      p[el.dataset.pk] = +el.value;
      if (p.slow !== undefined && p.go !== undefined && p.slow <= p.go) p.slow = p.go + 1;
      Settings.set('profiles', o);
      Settings.render();
    }));
    box.querySelectorAll('[data-wpn]').forEach((el) => el.addEventListener('change', () => {
      const o = JSON.parse(JSON.stringify(Settings.get('weapons') || {}));
      const w = (o[el.dataset.wpn] = o[el.dataset.wpn] || {});
      w[el.dataset.wk] = el.tagName === 'SELECT' ? el.value : +el.value;
      Settings.set('weapons', o);
      Settings.render();
    }));
  };

  Settings.open = (section) => {
    if (section) activeSection = section;
    document.getElementById('setSearch').value = '';
    Settings.render();
    const d = document.getElementById('settings');
    if (!d.open) d.showModal();
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
