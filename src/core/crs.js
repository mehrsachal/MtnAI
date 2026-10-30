/*
 * MtnAI core — coordinate reference systems and military grid references.
 *
 *  - Ellipsoids and datums (WGS 84, Kalianpur 1937 / 1962 / 1975 on the Everest
 *    1830 ellipsoids) with 3-parameter geocentric (Helmert) datum shifts.
 *  - Projections: geographic, UTM, Transverse Mercator, Lambert Conformal Conic
 *    (1SP / 2SP), Web Mercator.
 *  - CRS presets incl. the India / Pakistan Lambert grid zones, plus a custom CRS.
 *  - Reference formats: MGRS, UTM, DD / DM / DMS, GARS, GEOREF, projected E/N grid
 *    references — and a parser that accepts all of them.
 *
 * All public functions take / return WGS 84 latitude & longitude in degrees.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function crs(M) {
  'use strict';

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  M.ELLIPSOIDS = {
    WGS84: { name: 'WGS 84', a: 6378137, rf: 298.257223563 },
    EVEREST1962: { name: 'Everest 1830 (1962 Definition)', a: 6377301.243, rf: 300.8017255 },
    EVEREST1975: { name: 'Everest 1830 (1975 Definition)', a: 6377299.151, rf: 300.8017255 },
    EVEREST1937: { name: 'Everest 1830 (1937 Adjustment)', a: 6377276.345, rf: 300.8017 },
    INTL1924: { name: 'International 1924', a: 6378388, rf: 297 },
    GRS80: { name: 'GRS 1980', a: 6378137, rf: 298.257222101 },
  };

  /** towgs84: geocentric translation (m) from the local datum to WGS 84. */
  M.DATUMS = {
    WGS84: { name: 'WGS 84', ellipsoid: 'WGS84', towgs84: [0, 0, 0] },
    KALIANPUR1962: { name: 'Kalianpur 1962 (Pakistan)', ellipsoid: 'EVEREST1962', towgs84: [283, 682, 231] },
    KALIANPUR1975: { name: 'Kalianpur 1975 (India)', ellipsoid: 'EVEREST1975', towgs84: [295, 736, 257] },
    KALIANPUR1937: { name: 'Kalianpur 1937', ellipsoid: 'EVEREST1937', towgs84: [282, 726, 254] },
  };

  const ellOf = (e) => {
    const E = typeof e === 'string' ? M.ELLIPSOIDS[e] : e;
    const f = 1 / E.rf;
    return { a: E.a, f, e2: f * (2 - f), e: Math.sqrt(f * (2 - f)) };
  };
  /** Resolve a datum spec (id or object with ellipsoid / towgs84) to {ell, t}. */
  const datumOf = (d) => {
    const D = typeof d === 'string' ? M.DATUMS[d] || M.DATUMS.WGS84 : d;
    return { ell: ellOf(D.ellipsoid || 'WGS84'), t: D.towgs84 || [0, 0, 0] };
  };

  // ------------------------------------------------------------------ datum shift
  const toECEF = (lat, lon, h, el) => {
    const p = lat * D2R, l = lon * D2R, s = Math.sin(p);
    const N = el.a / Math.sqrt(1 - el.e2 * s * s);
    return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - el.e2) + h) * s];
  };
  const fromECEF = (X, Y, Z, el) => {
    const p = Math.hypot(X, Y);
    let lat = Math.atan2(Z, p * (1 - el.e2)), h = 0;
    for (let k = 0; k < 6; k++) {
      const s = Math.sin(lat), N = el.a / Math.sqrt(1 - el.e2 * s * s);
      h = p / Math.cos(lat) - N;
      lat = Math.atan2(Z, p * (1 - (el.e2 * N) / (N + h)));
    }
    return { lat: lat * R2D, lon: Math.atan2(Y, X) * R2D, h };
  };
  const W84 = ellOf('WGS84');
  /** WGS 84 -> local datum (lat/lon degrees). */
  M.toDatum = (lat, lon, datum) => {
    const d = datumOf(datum);
    if (!d.t[0] && !d.t[1] && !d.t[2] && d.ell.a === W84.a && d.ell.f === W84.f) return { lat, lon };
    const [X, Y, Z] = toECEF(lat, lon, 0, W84);
    const r = fromECEF(X - d.t[0], Y - d.t[1], Z - d.t[2], d.ell);
    return { lat: r.lat, lon: r.lon };
  };
  /** Local datum -> WGS 84. */
  M.fromDatum = (lat, lon, datum) => {
    const d = datumOf(datum);
    if (!d.t[0] && !d.t[1] && !d.t[2] && d.ell.a === W84.a && d.ell.f === W84.f) return { lat, lon };
    const [X, Y, Z] = toECEF(lat, lon, 0, d.ell);
    const r = fromECEF(X + d.t[0], Y + d.t[1], Z + d.t[2], W84);
    return { lat: r.lat, lon: r.lon };
  };

  // ------------------------------------------------------------------ Transverse Mercator (any ellipsoid)
  const arc = (el, phi) => {
    const e2 = el.e2, e4 = e2 * e2, e6 = e4 * e2;
    return el.a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) - ((35 * e6) / 3072) * Math.sin(6 * phi));
  };
  M.tmForward = (el, lat, lon, p) => {
    const ep2 = el.e2 / (1 - el.e2);
    const phi = lat * D2R, s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
    const N = el.a / Math.sqrt(1 - el.e2 * s * s), T = t * t, C = ep2 * c * c;
    let dl = (lon - p.lon0) * D2R;
    dl = Math.atan2(Math.sin(dl), Math.cos(dl));
    const A = c * dl, A2 = A * A;
    const x = p.k0 * N * (A + ((1 - T + C) * A2 * A) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A2 * A2 * A) / 120);
    const y = p.k0 * (arc(el, phi) - arc(el, (p.lat0 || 0) * D2R) + N * t * (A2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A2 * A2) / 24 +
      ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A2 * A2 * A2) / 720));
    return { x: p.fe + x, y: p.fn + y };
  };
  M.tmInverse = (el, X, Y, p) => {
    const ep2 = el.e2 / (1 - el.e2), e2 = el.e2;
    const m = arc(el, (p.lat0 || 0) * D2R) + (Y - p.fn) / p.k0;
    const mu = m / (el.a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const p1 = mu + (1.5 * e1 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
      ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
    const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
    const N1 = el.a / Math.sqrt(1 - e2 * s * s), T1 = t * t, C1 = ep2 * c * c, R1 = (el.a * (1 - e2)) / Math.pow(1 - e2 * s * s, 1.5);
    const Dd = (X - p.fe) / (N1 * p.k0), D2 = Dd * Dd;
    const lat = p1 - ((N1 * t) / R1) * (D2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D2 * D2) / 24 +
      ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D2 * D2 * D2) / 720);
    const lon = (Dd - ((1 + 2 * T1 + C1) * D2 * Dd) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D2 * D2 * Dd) / 120) / c;
    return { lat: lat * R2D, lon: p.lon0 + lon * R2D };
  };

  // ------------------------------------------------------------------ Lambert Conformal Conic
  const lccM = (el, phi) => Math.cos(phi) / Math.sqrt(1 - el.e2 * Math.sin(phi) ** 2);
  const lccT = (el, phi) => Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - el.e * Math.sin(phi)) / (1 + el.e * Math.sin(phi)), el.e / 2);
  const lccParams = (el, p) => {
    let n, F, r0, k0 = p.k0 ?? 1;
    if (p.type === 'lcc2') {
      const p1 = p.lat1 * D2R, p2 = p.lat2 * D2R;
      const m1 = lccM(el, p1), m2 = lccM(el, p2), t1 = lccT(el, p1), t2 = lccT(el, p2);
      n = Math.abs(p1 - p2) < 1e-12 ? Math.sin(p1) : (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
      F = m1 / (n * Math.pow(t1, n));
      k0 = 1;
    } else {
      const p0 = p.lat0 * D2R;
      n = Math.sin(p0);
      F = lccM(el, p0) / (n * Math.pow(lccT(el, p0), n));
    }
    r0 = el.a * F * Math.pow(lccT(el, p.lat0 * D2R), n) * k0;
    return { n, F, r0, k0 };
  };
  M.lccForward = (el, lat, lon, p) => {
    const q = lccParams(el, p);
    const r = el.a * q.F * Math.pow(lccT(el, lat * D2R), q.n) * q.k0;
    const th = q.n * (lon - p.lon0) * D2R;
    return { x: p.fe + r * Math.sin(th), y: p.fn + q.r0 - r * Math.cos(th) };
  };
  M.lccInverse = (el, X, Y, p) => {
    const q = lccParams(el, p);
    const dx = X - p.fe, dy = q.r0 - (Y - p.fn);
    const sgn = Math.sign(q.n) || 1;
    const r = sgn * Math.hypot(dx, dy);
    const th = Math.atan2(sgn * dx, sgn * dy);
    const t = Math.pow(r / (el.a * q.k0 * q.F), 1 / q.n);
    let phi = Math.PI / 2 - 2 * Math.atan(t);
    for (let k = 0; k < 12; k++) {
      const s = Math.sin(phi);
      phi = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - el.e * s) / (1 + el.e * s), el.e / 2));
    }
    return { lat: phi * R2D, lon: (th / q.n) * R2D + p.lon0 };
  };

  // ------------------------------------------------------------------ CRS definitions
  /**
   * proj.type: geo | utm (zone from context or proj.zone) | tm | lcc1 | lcc2 | merc
   * EPSG codes are given where the definition matches the EPSG registry.
   */
  M.CRS_PRESETS = {
    'EPSG:4326': { name: 'WGS 84 — geographic', datum: 'WGS84', proj: { type: 'geo' } },
    'WGS84-UTM': { name: 'WGS 84 / UTM (analysis zone)', datum: 'WGS84', proj: { type: 'utm' } },
    'EPSG:3857': { name: 'WGS 84 / Pseudo-Mercator', datum: 'WGS84', proj: { type: 'merc' } },
    'EPSG:4145': { name: 'Kalianpur 1962 — geographic', datum: 'KALIANPUR1962', proj: { type: 'geo' } },
    'EPSG:24376': { name: 'Kalianpur 1962 / India zone I', datum: 'KALIANPUR1962', proj: { type: 'lcc1', lat0: 32.5, lon0: 68, k0: 0.99878641, fe: 2743196.4, fn: 914398.8 } },
    'EPSG:24377': { name: 'Kalianpur 1962 / India zone IIa', datum: 'KALIANPUR1962', proj: { type: 'lcc1', lat0: 26, lon0: 74, k0: 0.99878641, fe: 2743196.4, fn: 914398.8 } },
    'KAL62-UTM': { name: 'Kalianpur 1962 / UTM (analysis zone)', datum: 'KALIANPUR1962', proj: { type: 'utm' } },
    'EPSG:4146': { name: 'Kalianpur 1975 — geographic', datum: 'KALIANPUR1975', proj: { type: 'geo' } },
  };

  /** Resolve a CRS id / object; `ctx.zone` supplies the UTM zone for 'utm' types. */
  M.resolveCRS = (crs, ctx = {}) => {
    const c = typeof crs === 'string' ? (crs === 'CUSTOM' ? ctx.custom : M.CRS_PRESETS[crs]) : crs;
    if (!c) return M.CRS_PRESETS['EPSG:4326'];
    if (c.proj.type !== 'utm') return c;
    const zone = c.proj.zone || ctx.zone || 43;
    const north = c.proj.north ?? ctx.north ?? true;
    return Object.assign({}, c, { proj: { type: 'tm', lat0: 0, lon0: M.centralMeridian(zone), k0: 0.9996, fe: 500000, fn: north ? 0 : 10000000, zone, north } });
  };
  M.isGeographic = (crs) => crs.proj.type === 'geo';

  /** WGS 84 lat/lon -> CRS coordinates: {x, y} (projected) or {lat, lon} (geographic, on the CRS datum). */
  M.crsForward = (crs, lat, lon) => {
    const ll = M.toDatum(lat, lon, crs.datum);
    const el = datumOf(crs.datum).ell;
    const p = crs.proj;
    switch (p.type) {
      case 'geo': return { lat: ll.lat, lon: ll.lon };
      case 'tm': return M.tmForward(el, ll.lat, ll.lon, p);
      case 'lcc1': case 'lcc2': return M.lccForward(el, ll.lat, ll.lon, p);
      case 'merc': return { x: 6378137 * ll.lon * D2R, y: 6378137 * Math.log(Math.tan(Math.PI / 4 + (ll.lat * D2R) / 2)) };
      default: throw new Error('Unsupported projection ' + p.type);
    }
  };
  /** CRS coordinates -> WGS 84 lat/lon. For geographic CRSs pass (lon, lat) as (x, y). */
  M.crsInverse = (crs, x, y) => {
    const el = datumOf(crs.datum).ell;
    const p = crs.proj;
    let ll;
    switch (p.type) {
      case 'geo': ll = { lat: y, lon: x }; break;
      case 'tm': ll = M.tmInverse(el, x, y, p); break;
      case 'lcc1': case 'lcc2': ll = M.lccInverse(el, x, y, p); break;
      case 'merc': ll = { lat: (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * R2D, lon: (x / 6378137) * R2D }; break;
      default: throw new Error('Unsupported projection ' + p.type);
    }
    return M.fromDatum(ll.lat, ll.lon, crs.datum);
  };

  /** Human-readable description (WKT-like summary) of a CRS. */
  M.describeCRS = (crs) => {
    const d = typeof crs.datum === 'string' ? M.DATUMS[crs.datum] : crs.datum;
    const e = M.ELLIPSOIDS[d.ellipsoid] || d.ellipsoid;
    const p = crs.proj;
    const f = (v) => (+v).toString();
    let pr = 'Geographic (lat / lon)';
    if (p.type === 'tm') pr = `Transverse Mercator: lat₀ ${f(p.lat0 || 0)}°, lon₀ ${f(p.lon0)}°, k₀ ${f(p.k0)}, FE ${f(p.fe)} m, FN ${f(p.fn)} m`;
    if (p.type === 'lcc1') pr = `Lambert Conformal Conic (1SP): lat₀ ${f(p.lat0)}°, lon₀ ${f(p.lon0)}°, k₀ ${f(p.k0)}, FE ${f(p.fe)} m, FN ${f(p.fn)} m`;
    if (p.type === 'lcc2') pr = `Lambert Conformal Conic (2SP): φ₁ ${f(p.lat1)}°, φ₂ ${f(p.lat2)}°, lat₀ ${f(p.lat0)}°, lon₀ ${f(p.lon0)}°, FE ${f(p.fe)} m, FN ${f(p.fn)} m`;
    if (p.type === 'merc') pr = 'Popular visualisation Mercator (sphere)';
    return { datum: d.name || 'Custom datum', ellipsoid: `${e.name || 'Custom'} (a ${e.a}, 1/f ${e.rf})`, towgs84: (d.towgs84 || [0, 0, 0]).join(', '), projection: pr };
  };

  // ------------------------------------------------------------------ angles & lat/lon formats
  const pad = (n, w) => String(n).padStart(w, '0');
  M.formatLatLon = (lat, lon, style = 'dms', dec) => {
    const one = (v, pos, neg, w) => {
      const h = v >= 0 ? pos : neg;
      const a = Math.abs(v);
      if (style === 'dd') return `${a.toFixed(dec ?? 5)}° ${h}`;
      const d = Math.floor(a);
      if (style === 'dm') {
        const m = (a - d) * 60;
        const mm = m.toFixed(dec ?? 3);
        return mm.startsWith('60') ? `${pad(d + 1, w)}° ${(0).toFixed(dec ?? 3).padStart(6, '0')}' ${h}` : `${pad(d, w)}° ${mm.padStart((dec ?? 3) + 3, '0')}' ${h}`;
      }
      let m = Math.floor((a - d) * 60);
      let s = ((a - d) * 60 - m) * 60;
      let sd = +s.toFixed(dec ?? 1), dd = d;
      if (sd >= 60) { sd = 0; m += 1; }
      if (m >= 60) { m = 0; dd += 1; }
      return `${pad(dd, w)}°${pad(m, 2)}'${sd.toFixed(dec ?? 1).padStart((dec ?? 1) + 3, '0')}"${h}`;
    };
    return `${one(lat, 'N', 'S', 2)} ${one(lon, 'E', 'W', 3)}`;
  };

  // ------------------------------------------------------------------ GARS (Global Area Reference System)
  const GARS_L1 = 'ABCDEFGHJKLMNPQ', GARS_L2 = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  /** precision: 30 (min), 15 (quadrant) or 5 (keypad). */
  M.toGARS = (lat, lon, precision = 5) => {
    lat = Math.min(89.999999, Math.max(-90, lat)); lon = ((lon + 180) % 360 + 360) % 360 - 180;
    const lonIdx = Math.floor((lon + 180) * 2), latIdx = Math.floor((lat + 90) * 2);
    let s = pad(lonIdx + 1, 3) + GARS_L1[Math.floor(latIdx / 24)] + GARS_L2[latIdx % 24];
    if (precision <= 15) {
      const fx = (lon + 180) * 2 - lonIdx, fy = (lat + 90) * 2 - latIdx; // 0..1 within the 30' cell
      const qx = fx >= 0.5 ? 1 : 0, qy = fy >= 0.5 ? 0 : 1; // quadrant 1 = NW
      s += String(qy * 2 + qx + 1);
      if (precision <= 5) {
        const kx = Math.min(2, Math.floor((fx * 2 - qx) * 3)), ky = Math.min(2, Math.floor((1 - (fy * 2 - (1 - qy))) * 3));
        s += String(ky * 3 + kx + 1);
      }
    }
    return s;
  };
  M.parseGARS = (str) => {
    const m = /^(\d{3})([A-HJ-NP-Q])([A-HJ-NP-Z])([1-4])?([1-9])?$/i.exec(String(str).trim());
    if (!m) return null;
    const lonIdx = +m[1] - 1, latIdx = GARS_L1.indexOf(m[2].toUpperCase()) * 24 + GARS_L2.indexOf(m[3].toUpperCase());
    if (lonIdx < 0 || lonIdx > 719 || latIdx < 0 || latIdx > 359) return null;
    let lon = lonIdx / 2 - 180, lat = latIdx / 2 - 90, size = 0.5;
    if (m[4]) { const q = +m[4] - 1; size = 0.25; lon += (q % 2) * size; lat += (q < 2 ? 1 : 0) * size; }
    if (m[5]) { const k = +m[5] - 1; const s5 = size / 3; lon += (k % 3) * s5; lat += (2 - Math.floor(k / 3)) * s5; size = s5; }
    return { lat: lat + size / 2, lon: lon + size / 2 };
  };

  // ------------------------------------------------------------------ GEOREF (World Geographic Reference System)
  const GEO_L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  /** digits: minutes digits per axis (2 = 1', 3 = 0.1', 4 = 0.01'). */
  M.toGEOREF = (lat, lon, digits = 2) => {
    lat = Math.min(89.999999, Math.max(-90, lat));
    const x = ((lon + 180) % 360 + 360) % 360, y = lat + 90;
    const lx = Math.floor(x / 15), ly = Math.floor(y / 15);
    const dx = Math.floor(x - lx * 15), dy = Math.floor(y - ly * 15);
    const scale = Math.pow(10, digits - 2);
    const mx = Math.floor((x - Math.floor(x)) * 60 * scale), my = Math.floor((y - Math.floor(y)) * 60 * scale);
    return GEO_L[lx] + GEO_L[ly] + GEO_L[dx] + GEO_L[dy] + pad(mx, digits) + pad(my, digits);
  };
  M.parseGEOREF = (str) => {
    const m = /^([A-HJ-NP-Z])([A-HJ-M])([A-HJ-NP-Q])([A-HJ-NP-Q])(\d*)$/i.exec(String(str).trim().replace(/\s+/g, ''));
    if (!m || m[5].length % 2) return null;
    const u = (ch) => GEO_L.indexOf(ch.toUpperCase());
    let lon = u(m[1]) * 15 + u(m[3]) - 180, lat = u(m[2]) * 15 + u(m[4]) - 90, size = 1;
    const d = m[5].length / 2;
    if (d) { const sc = Math.pow(10, d - 2); size = 1 / 60 / sc; lon += (+m[5].slice(0, d) / sc) / 60; lat += (+m[5].slice(d) / sc) / 60; }
    return { lat: lat + size / 2, lon: lon + size / 2 };
  };

  // ------------------------------------------------------------------ unified formatter / parser
  /**
   * Format a WGS 84 position as a reference.
   * kind: mgrs | utm | dd | dm | dms | gars | georef | proj
   * opts: {digits (MGRS / GR digits per axis), decimals, zone (force UTM zone), crs (resolved, for 'proj'), garsPrecision}
   */
  M.formatRef = (kind, lat, lon, opts = {}) => {
    switch (kind) {
      case 'mgrs': return M.toMGRS(lat, lon, opts.digits ?? 5, { zone: opts.zone });
      case 'utm': {
        const u = M.toUTM(lat, lon, opts.zone);
        return `${u.zone}${M.latBand(lat) || (u.north ? 'N' : 'S')} ${Math.floor(u.E)}mE ${Math.floor(u.N)}mN`;
      }
      case 'dd': case 'dm': case 'dms': return M.formatLatLon(lat, lon, kind, opts.decimals);
      case 'gars': return M.toGARS(lat, lon, opts.garsPrecision ?? 5);
      case 'georef': return M.toGEOREF(lat, lon, opts.georefDigits ?? 2);
      case 'proj': {
        const c = opts.crs;
        const p = M.crsForward(c, lat, lon);
        if (M.isGeographic(c)) return M.formatLatLon(p.lat, p.lon, opts.geoStyle || 'dms', opts.decimals);
        if (opts.gr) {
          // military grid reference: truncated easting / northing digits inside the 100 km square
          const dg = opts.digits ?? 4, div = Math.pow(10, 5 - dg);
          const e = Math.floor((((p.x % 1e5) + 1e5) % 1e5) / div), n = Math.floor((((p.y % 1e5) + 1e5) % 1e5) / div);
          return `${pad(e, dg)} ${pad(n, dg)}`;
        }
        return `${Math.floor(p.x)}mE ${Math.floor(p.y)}mN`;
      }
      default: return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
  };

  /** Parse any supported reference to WGS 84 {lat, lon} (null if not recognised). opts.crs = projected CRS for "E N" input. */
  M.parseRef = (input, opts = {}) => {
    const s = String(input).trim();
    if (!s) return null;
    // MGRS
    const mg = M.parseMGRS(s);
    if (mg) return M.fromUTM(mg.E, mg.N, mg.zone, mg.north);
    // UTM: "43S 412345 3954321" / "43N 412345mE 3954321mN"
    let m = /^(\d{1,2})\s*([C-HJ-NP-X])?\s+(\d{5,7}(?:\.\d+)?)\s*m?E?[\s,]+(\d{6,8}(?:\.\d+)?)\s*m?N?$/i.exec(s);
    if (m) {
      const band = (m[2] || 'N').toUpperCase();
      return M.fromUTM(+m[3], +m[4], +m[1], band >= 'N');
    }
    // GARS / GEOREF
    const ga = M.parseGARS(s.replace(/\s+/g, ''));
    if (ga) return ga;
    const ge = M.parseGEOREF(s);
    if (ge) return ge;
    // DMS / DM / DD with hemisphere letters, or signed decimal pair
    const num = '(-?\\d+(?:\\.\\d+)?)';
    const part = `${num}\\s*[°d:\\s]?\\s*(?:${num}\\s*['m:\\s]?\\s*)?(?:${num}\\s*(?:"|''|s)?\\s*)?([NSEW])?`;
    m = new RegExp(`^${part}[\\s,;/]+${part}$`, 'i').exec(s);
    if (m) {
      const val = (d, mi, se, h) => {
        let v = Math.abs(+d) + (mi ? +mi / 60 : 0) + (se ? +se / 3600 : 0);
        if (+d < 0 || (h && /[SW]/i.test(h))) v = -v;
        return v;
      };
      let a = val(m[1], m[2], m[3], m[4]), b = val(m[5], m[6], m[7], m[8]);
      if ((m[4] && /[EW]/i.test(m[4])) || (m[8] && /[NS]/i.test(m[8]))) [a, b] = [b, a];
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
    }
    // projected easting / northing in the given CRS
    if (opts.crs && !M.isGeographic(opts.crs)) {
      m = /^E?\s*(\d{4,8}(?:\.\d+)?)\s*m?E?[\s,;/]+N?\s*(\d{4,8}(?:\.\d+)?)\s*m?N?$/i.exec(s);
      if (m) return M.crsInverse(opts.crs, +m[1], +m[2]);
    }
    return null;
  };

  /** Bearing conversions. gridDeg -> true / magnetic using convergence (deg) and declination (deg, east +). */
  M.northRef = (gridDeg, ref, convergenceDeg, declinationDeg) => {
    let b = gridDeg;
    if (ref === 'true') b = gridDeg + convergenceDeg;
    else if (ref === 'magnetic') b = gridDeg + convergenceDeg - declinationDeg;
    return ((b % 360) + 360) % 360;
  };
});
