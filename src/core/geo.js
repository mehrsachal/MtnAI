/*
 * MtnAI core — geodesy: WGS84 <-> UTM (Snyder / USGS series) and MGRS.
 * Accuracy is sub-metre inside a zone and well below DEM resolution in the
 * one-zone overlap the app permits.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function geo(M) {
  'use strict';

  const A = 6378137.0;
  const F = 1 / 298.257223563;
  const E2 = F * (2 - F);
  const EP2 = E2 / (1 - E2);
  const K0 = 0.9996;
  const E4 = E2 * E2, E6 = E4 * E2;
  const M1 = 1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256;
  const M2 = (3 * E2) / 8 + (3 * E4) / 32 + (45 * E6) / 1024;
  const M3 = (15 * E4) / 256 + (45 * E6) / 1024;
  const M4 = (35 * E6) / 3072;

  M.utmZoneFor = (lat, lon) => {
    let z = Math.floor((lon + 180) / 6) + 1;
    if (z > 60) z = 60;
    // Norway / Svalbard exceptions
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) z = 32;
    if (lat >= 72 && lat < 84) {
      if (lon >= 0 && lon < 9) z = 31;
      else if (lon >= 9 && lon < 21) z = 33;
      else if (lon >= 21 && lon < 33) z = 35;
      else if (lon >= 33 && lon < 42) z = 37;
    }
    return z;
  };

  M.centralMeridian = (zone) => (zone - 1) * 6 - 180 + 3;

  /** lat/lon (deg) -> {E, N, zone, north}. `zone` may be forced. */
  M.toUTM = (lat, lon, zone) => {
    zone = zone || M.utmZoneFor(lat, lon);
    const phi = (lat * Math.PI) / 180;
    const lam = (lon * Math.PI) / 180;
    const lam0 = (M.centralMeridian(zone) * Math.PI) / 180;
    const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
    const N = A / Math.sqrt(1 - E2 * s * s);
    const T = t * t;
    const C = EP2 * c * c;
    const Aa = c * (lam - lam0);
    const Mm = A * (M1 * phi - M2 * Math.sin(2 * phi) + M3 * Math.sin(4 * phi) - M4 * Math.sin(6 * phi));
    const A2 = Aa * Aa, A3 = A2 * Aa, A4 = A3 * Aa, A5 = A4 * Aa, A6 = A5 * Aa;
    const E = K0 * N * (Aa + ((1 - T + C) * A3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * A5) / 120) + 500000;
    let Nn = K0 * (Mm + N * t * (A2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A4) / 24 +
      ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * A6) / 720));
    const north = lat >= 0;
    if (!north) Nn += 10000000;
    return { E, N: Nn, zone, north };
  };

  /** UTM -> {lat, lon} (deg). */
  M.fromUTM = (E, N, zone, north = true) => {
    const x = E - 500000;
    const y = north ? N : N - 10000000;
    const Mm = y / K0;
    const mu = Mm / (A * M1);
    const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
    const phi1 = mu + (1.5 * e1 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
      ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
      ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
    const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
    const N1 = A / Math.sqrt(1 - E2 * s * s);
    const T1 = t * t;
    const C1 = EP2 * c * c;
    const R1 = (A * (1 - E2)) / Math.pow(1 - E2 * s * s, 1.5);
    const D = x / (N1 * K0);
    const D2 = D * D, D3 = D2 * D, D4 = D3 * D, D5 = D4 * D, D6 = D5 * D;
    const phi = phi1 - ((N1 * t) / R1) * (D2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D4) / 24 +
      ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D6) / 720);
    const lam = (D - ((1 + 2 * T1 + C1) * D3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D5) / 120) / c;
    return { lat: (phi * 180) / Math.PI, lon: M.centralMeridian(zone) + (lam * 180) / Math.PI };
  };

  /** Grid convergence (deg): angle from grid north to true north at a point. */
  M.convergence = (lat, lon, zone) => {
    const dl = M.rad(lon - M.centralMeridian(zone));
    return M.deg(Math.atan(Math.tan(dl) * Math.sin(M.rad(lat))));
  };

  const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
  const COLS = ['STUVWXYZ', 'ABCDEFGH', 'JKLMNPQR']; // indexed by zone % 3
  const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

  M.latBand = (lat) => {
    if (lat < -80 || lat > 84) return null;
    return BANDS[Math.min(19, Math.floor((lat + 80) / 8))];
  };

  /**
   * lat/lon -> MGRS string. digits per axis: 5 = 1 m, 4 = 10 m (8-figure), 3 = 100 m.
   * `opts.zone` forces a UTM zone (keeps references consistent with the analysis grid).
   */
  M.toMGRS = (lat, lon, digits = 5, opts = {}) => {
    const band = M.latBand(lat);
    if (!band) return 'outside MGRS (polar)';
    const u = M.toUTM(lat, lon, opts.zone);
    return M.utmToMGRS(u.E, u.N, u.zone, band, digits, opts.compact);
  };

  M.utmToMGRS = (E, N, zone, band, digits = 5, compact = false) => {
    const col = COLS[zone % 3][Math.floor(E / 100000) - 1] || '?';
    const row = ROWS[(Math.floor(N / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20];
    const div = Math.pow(10, 5 - digits);
    const pad = (v) => String(Math.floor((((v % 100000) + 100000) % 100000) / div)).padStart(digits, '0');
    const sq = col + row;
    return compact
      ? `${zone}${band}${sq}${pad(E)}${pad(N)}`
      : `${zone}${band} ${sq} ${pad(E)} ${pad(N)}`;
  };

  /** Parse MGRS (e.g. "43S CV 12345 67890" or "43SCV1234567890") -> UTM {E, N, zone, north}. */
  M.parseMGRS = (str) => {
    const s = String(str).toUpperCase().replace(/\s+/g, '');
    const m = /^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/.exec(s);
    if (!m) return null;
    const zone = +m[1], band = m[2], digits = m[5];
    if (digits.length % 2) return null;
    const half = digits.length / 2;
    const scale = Math.pow(10, 5 - half);
    const e100 = COLS[zone % 3].indexOf(m[3]) + 1;
    if (e100 < 1) return null;
    let rIdx = ROWS.indexOf(m[4]) - (zone % 2 === 0 ? 5 : 0);
    rIdx = ((rIdx % 20) + 20) % 20;
    const e = half ? +digits.slice(0, half) * scale : 0;
    const n = half ? +digits.slice(half) * scale : 0;
    const E = e100 * 100000 + e + (half ? scale / 2 : 50000);
    // pick the 2,000 km northing cycle that matches the latitude band
    const bandLat = -80 + BANDS.indexOf(band) * 8 + 4;
    const north = bandLat >= 0;
    const approxN = M.toUTM(bandLat, M.centralMeridian(zone), zone).N;
    let N = rIdx * 100000 + n + (half ? scale / 2 : 50000);
    while (N < approxN - 1000000) N += 2000000;
    return { E, N, zone, north };
  };

  /** Format lat/lon as degrees-minutes-seconds. */
  M.toDMS = (lat, lon) => {
    const f = (v, pos, neg) => {
      const h = v >= 0 ? pos : neg;
      v = Math.abs(v);
      const d = Math.floor(v), mF = (v - d) * 60, m = Math.floor(mF), s = (mF - m) * 60;
      return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${h}`;
    };
    return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
  };

  /** WKT for WGS 84 / UTM, used for .prj side-car files. */
  M.utmWKT = (zone, north = true) =>
    `PROJCS["WGS 84 / UTM zone ${zone}${north ? 'N' : 'S'}",GEOGCS["WGS 84",DATUM["WGS_1984",` +
    `SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],` +
    `PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",${M.centralMeridian(zone)}],` +
    `PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",${north ? 0 : 10000000}],UNIT["metre",1]]`;
});
