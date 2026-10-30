/*
 * MtnAI ui — formatting of coordinates, bearings and quantities according to the
 * user's settings (reference format & precision, secondary CRS, north reference,
 * angular / distance / elevation / area / time units).
 */
(function (UI) {
  'use strict';
  const M = UI.M, cfg = UI.cfg;
  const F = (UI.F = {});

  // ---------------------------------------------------------------- CRS
  let crsKey = '', crsVal = null;
  /** Resolved secondary CRS (or null). */
  F.secondaryCRS = () => {
    const id = cfg('crs.secondary');
    if (!id || id === 'none') return null;
    const g = UI.S && UI.S.grid;
    const custom = {};
    for (const k of ['name', 'datum', 'ellipsoid', 'towgs84', 'proj', 'zone', 'lat0', 'lon0', 'lat1', 'lat2', 'k0', 'fe', 'fn']) custom[k] = cfg('crs.custom.' + k);
    const key = JSON.stringify([id, g && g.zone, g && g.north, id === 'CUSTOM' ? custom : 0]);
    if (key === crsKey) return crsVal;
    let def;
    if (id === 'CUSTOM') {
      const t = String(custom.towgs84).split(/[\s,;]+/).map(Number).filter((v) => Number.isFinite(v));
      const datum = custom.datum === 'CUSTOM' ? { name: 'Custom datum', ellipsoid: custom.ellipsoid, towgs84: [t[0] || 0, t[1] || 0, t[2] || 0] } : custom.datum;
      const proj = { type: custom.proj, lat0: custom.lat0, lon0: custom.lon0, lat1: custom.lat1, lat2: custom.lat2, k0: custom.k0, fe: custom.fe, fn: custom.fn };
      if (custom.proj === 'utm') Object.assign(proj, { zone: custom.zone });
      if (custom.proj === 'lcc2') proj.k0 = 1;
      def = { name: custom.name || 'Custom CRS', datum, proj };
    }
    try { crsVal = M.resolveCRS(id === 'CUSTOM' ? def : id, { zone: g ? g.zone : 43, north: g ? g.north : true }); }
    catch (e) { crsVal = null; }
    if (crsVal && crsVal.proj.type === 'tm' && crsVal.proj.zone && !/zone \d/.test(crsVal.name)) crsVal = Object.assign({}, crsVal, { name: crsVal.name.replace('(analysis zone)', `zone ${crsVal.proj.zone}${crsVal.proj.north ? 'N' : 'S'}`) });
    crsKey = key;
    return crsVal;
  };
  F.analysisCRSName = () => {
    const g = UI.S && UI.S.grid;
    return g ? `WGS 84 / UTM ${g.zone}${g.north ? 'N' : 'S'}` : 'WGS 84 / UTM';
  };

  // ---------------------------------------------------------------- references
  const LL_DEC = { low: { dd: 4, dm: 2, dms: 0 }, std: { dd: 5, dm: 3, dms: 1 }, high: { dd: 7, dm: 5, dms: 3 } };
  F.REF_NAMES = { mgrs: 'MGRS', utm: 'UTM', dms: 'Lat/Lon', dm: 'Lat/Lon', dd: 'Lat/Lon', gars: 'GARS', georef: 'GEOREF', proj: 'E/N', gr: 'GR' };
  F.refName = () => {
    const k = cfg('ref.primary');
    if ((k === 'proj' || k === 'gr') && F.secondaryCRS()) return k === 'gr' ? 'GR' : 'E/N';
    return F.REF_NAMES[k] || 'Ref';
  };

  /** Primary reference of a WGS 84 position. opts: {digits, kind} */
  F.ref = (lat, lon, opts = {}) => {
    const g = UI.S && UI.S.grid;
    let kind = opts.kind || cfg('ref.primary');
    const digits = opts.digits ?? cfg('ref.digits');
    const zone = cfg('ref.forceZone') && g ? g.zone : undefined;
    const crs = F.secondaryCRS();
    if ((kind === 'proj' || kind === 'gr') && !crs) kind = 'mgrs';
    switch (kind) {
      case 'mgrs': return M.toMGRS(lat, lon, digits, { zone, compact: !cfg('ref.mgrsSpaced') });
      case 'utm': return M.formatRef('utm', lat, lon, { zone });
      case 'dd': case 'dm': case 'dms': return M.formatLatLon(lat, lon, kind, LL_DEC[cfg('ref.llDecimals')][kind]);
      case 'gars': return M.toGARS(lat, lon, cfg('ref.gars'));
      case 'georef': return M.toGEOREF(lat, lon, cfg('ref.georef'));
      case 'gr': return M.formatRef('proj', lat, lon, { crs, gr: true, digits, geoStyle: 'dms', decimals: LL_DEC[cfg('ref.llDecimals')].dms });
      default: return M.formatRef('proj', lat, lon, { crs, geoStyle: 'dms', decimals: LL_DEC[cfg('ref.llDecimals')].dms });
    }
  };
  /** Reference of a grid cell (fractional cell coords allowed). */
  F.refCell = (r, c, opts) => {
    const g = UI.S.grid;
    const ll = M.cellToLatLon(g, r, c);
    return F.ref(ll.lat, ll.lon, opts);
  };
  /** Reference at list / table / report precision. */
  F.listRef = (r, c) => F.refCell(r, c, { digits: cfg('ref.listDigits') });
  /** Secondary CRS coordinates of a cell ('' if none). */
  F.secondaryCell = (r, c, gr) => {
    const crs = F.secondaryCRS();
    if (!crs) return '';
    const ll = M.cellToLatLon(UI.S.grid, r, c);
    return M.formatRef('proj', ll.lat, ll.lon, { crs, gr, digits: cfg('ref.listDigits'), geoStyle: 'dms', decimals: LL_DEC[cfg('ref.llDecimals')].dms });
  };
  /** Parse user input (any supported format, incl. secondary CRS E/N) -> WGS 84. */
  F.parse = (s) => M.parseRef(s, { crs: F.secondaryCRS() });

  // ---------------------------------------------------------------- angles & north
  const UNIT = {
    mil6400: { k: 6400 / 360, s: ' mils' }, mil6000: { k: 6000 / 360, s: ' mils' }, deg: { k: 1, s: '°' }, grad: { k: 400 / 360, s: ' gon' },
  };
  F.angleRaw = (deg) => {
    const u = UNIT[cfg('north.unit')] || UNIT.mil6400;
    const full = 360 * u.k;
    return (((deg * u.k) % full) + full) % full;
  };
  F.angle = (deg, noUnit) => {
    const u = UNIT[cfg('north.unit')] || UNIT.mil6400;
    const d = +cfg('north.decimals');
    let v = F.angleRaw(deg);
    let s = v.toFixed(d);
    if (+s >= 360 * u.k) s = (0).toFixed(d);
    if (u.s === ' mils') s = s.padStart(4 + (d ? d + 1 : 0), '0');
    return noUnit ? s : s + u.s;
  };
  /** Magnetic declination (deg, east +) for today from epoch value and annual change. */
  F.declination = () => {
    const now = new Date();
    const year = now.getFullYear() + now.getMonth() / 12;
    return +cfg('north.declination') + (+cfg('north.annual') / 60) * (year - +cfg('north.epoch'));
  };
  F.convergence = (r, c) => {
    const g = UI.S.grid;
    const ll = M.cellToLatLon(g, r, c);
    return M.convergence(ll.lat, ll.lon, g.zone);
  };
  F.northTag = () => ({ grid: 'GN', true: 'TN', magnetic: 'MN' }[cfg('north.ref')]);
  /** A grid bearing at a cell expressed in the configured north reference and unit. */
  F.bearing = (gridDeg, r, c, noTag) => {
    const b = M.northRef(gridDeg, cfg('north.ref'), F.convergence(r, c), F.declination());
    return F.angle(b) + (noTag ? '' : ` ${F.northTag()}`);
  };
  F.bearingDeg = (gridDeg, r, c) => M.northRef(gridDeg, cfg('north.ref'), F.convergence(r, c), F.declination());

  // ---------------------------------------------------------------- quantities
  F.dist = (m) => {
    const u = cfg('units.distance');
    if (u === 'nautical') return `${(m / 1852).toFixed(m < 1852 * 10 ? 2 : 1)} NM`;
    if (u === 'yards') { const yd = m / 0.9144; return yd < 1760 ? `${Math.round(yd)} yd` : `${(yd / 1760).toFixed(yd < 17600 ? 2 : 1)} mi`; }
    if (u === 'imperial') { const ft = m / 0.3048; return ft < 5280 ? `${Math.round(ft)} ft` : `${(ft / 5280).toFixed(ft < 52800 ? 2 : 1)} mi`; }
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 100000 ? 1 : 0)} km`;
  };
  F.elevUnit = () => (cfg('units.elevation') === 'ft' ? 'ft' : 'm');
  F.elevNum = (m) => Math.round((m + +cfg('units.elevOffset')) / (cfg('units.elevation') === 'ft' ? 0.3048 : 1));
  F.elev = (m) => `${F.elevNum(m)} ${F.elevUnit()}`;
  F.height = (dm) => `${dm >= 0 ? '+' : '−'}${Math.round(Math.abs(dm) / (cfg('units.elevation') === 'ft' ? 0.3048 : 1))} ${F.elevUnit()}`;
  F.area = (km2) => {
    const u = cfg('units.area');
    if (u === 'ha') return `${Math.round(km2 * 100)} ha`;
    if (u === 'mi2') return `${(km2 / 2.589988).toFixed(km2 < 25 ? 2 : 1)} mi²`;
    return `${km2.toFixed(km2 < 10 ? 2 : 1)} km²`;
  };
  F.time = (h) => {
    if (h == null || !Number.isFinite(h)) return '—';
    const u = cfg('units.time');
    if (u === 'dec') return `${h.toFixed(1)} h`;
    const H = Math.floor(h), Mi = Math.round((h - H) * 60) % 60, HH = H + (Math.round((h - H) * 60) === 60 ? 1 : 0);
    return u === 'clock' ? `${String(HH).padStart(2, '0')}:${String(Mi).padStart(2, '0')}` : `${HH} h ${String(Mi).padStart(2, '0')} min`;
  };
  F.pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
  F.vdatum = () => ({ EGM96: 'EGM96 geoid', EGM2008: 'EGM2008 geoid', WGS84: 'WGS 84 ellipsoid', MSL: 'local MSL' }[cfg('units.vdatum')] || '');
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
