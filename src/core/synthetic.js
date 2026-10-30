/*
 * MtnAI core — procedural mountain terrain for training and offline demos.
 * Ridged multifractal noise, domain warping and carved valleys produce a
 * Karakoram-style massif: a main E-W river valley, side nullahs, a southern
 * enemy valley and passes over the dividing ridge. The terrain is fictional.
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function synthetic(M) {
  'use strict';

  const makeNoise = (seed) => {
    const rand = M.rng(seed);
    const p = new Uint8Array(512);
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const grad = (h, x, y) => { const v = h & 7; const u = v < 4 ? x : y, w = v < 4 ? y : x; return ((v & 1) ? -u : u) + ((v & 2) ? -2 * w : 2 * w); };
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    return (x, y) => {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      x -= Math.floor(x); y -= Math.floor(y);
      const u = fade(x), v = fade(y);
      const a = p[X] + Y, b = p[X + 1] + Y;
      return 0.5 * M.lerp(M.lerp(grad(p[a], x, y), grad(p[b], x - 1, y), u), M.lerp(grad(p[a + 1], x, y - 1), grad(p[b + 1], x - 1, y - 1), u), v);
    };
  };

  /** Distance from point to segment, plus along-segment parameter t. */
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = M.clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    return { d: Math.hypot(px - ax - t * dx, py - ay - t * dy), t };
  };

  /**
   * Generate a synthetic DEM grid.
   * opts: {size=640 cells, cs=25 m, seed=7}
   * Returns {grid, markers: {own, threat, a, b} in cell coords}.
   */
  M.syntheticTerrain = (opts = {}) => {
    const n = opts.size || 640, cs = opts.cs || 25, seed = opts.seed || 7;
    const S = (n * cs) / 1000; // km
    const noise = makeNoise(seed), noise2 = makeNoise(seed + 101);
    const fbm = (x, y, oct = 5) => { let s = 0, a = 1, f = 1, t = 0; for (let o = 0; o < oct; o++) { s += a * noise(x * f, y * f); t += a; a *= 0.5; f *= 2.03; } return s / t; };
    const ridged = (x, y) => {
      let s = 0, a = 1, f = 1, wgt = 1, t = 0;
      for (let o = 0; o < 7; o++) {
        let v = 1 - Math.abs(noise2(x * f, y * f) * 1.6);
        v = v * v * wgt;
        wgt = M.clamp(v * 1.6, 0, 1);
        s += v * a; t += a; a *= 0.52; f *= 2.1;
      }
      return s / t;
    };
    const vc = (u) => 0.5 + 0.055 * Math.sin(2 * Math.PI * 1.05 * u + 0.7) + 0.018 * Math.sin(2 * Math.PI * 3.3 * u + 1.9);
    const vs = (u) => 0.9 + 0.03 * Math.sin(2 * Math.PI * 0.8 * u + 2.1);
    // side nullahs [u0, v0, u1, v1, floor rise (m), half-width (km)]
    const pass1 = [0.42, 0.705], pass2 = [0.78, 0.69];
    const nullahs = [
      [0.42, vc(0.42), pass1[0], pass1[1], 1350, 0.75],
      [0.40, vs(0.40), pass1[0], pass1[1], 1500, 0.75],
      [0.78, vc(0.78), pass2[0], pass2[1], 1550, 0.65],
      [0.80, vs(0.80), pass2[0], pass2[1], 1650, 0.65],
      [0.20, vc(0.20), 0.14, 0.12, 2000, 0.7],
      [0.58, vc(0.58), 0.66, 0.16, 1900, 0.65],
      [0.90, vc(0.90), 0.97, 0.22, 1700, 0.6],
      [0.08, vc(0.08), 0.02, 0.33, 1500, 0.55],
    ];
    const z = new Float32Array(n * n);
    for (let r = 0; r < n; r++) {
      const v = r / (n - 1);
      for (let c = 0; c < n; c++) {
        const u = c / (n - 1);
        const wu = u + 0.06 * fbm(u * 3 + 11, v * 3 + 3, 3), wv = v + 0.06 * fbm(u * 3 + 5, v * 3 + 17, 3);
        const massif = 0.6 + 0.4 * fbm(wu * 1.3 + 2, wv * 1.3 + 7, 4);
        const rid = ridged(wu * 3.2, wv * 3.2);
        let h = 2500 + 3300 * massif * (0.35 + 0.65 * rid);
        // main valley
        const fMain = 2350 - 260 * u;
        const dMain = Math.abs(v - vc(u)) * S;
        const tMain = M.smoothstep(0.12, 2.2, dMain);
        h = fMain + (h - fMain) * Math.pow(tMain, 0.85);
        // southern (enemy) valley
        const fS = 2550 - 200 * u;
        const dS = Math.abs(v - vs(u)) * S;
        const tS = M.smoothstep(0.1, 1.6, dS);
        if (h > fS) h = fS + (h - fS) * Math.pow(tS, 0.85);
        // nullahs rising towards their heads / passes
        for (const [u0, v0, u1, v1, rise, hw] of nullahs) {
          const { d, t } = segDist(u * S, v * S, u0 * S, v0 * S, u1 * S, v1 * S);
          if (d > hw * 2.5) continue;
          const base = (Math.abs(v0 - vc(u0)) < 0.01 ? 2350 - 260 * u0 : 2550 - 200 * u0) + rise * Math.pow(t, 1.15);
          if (h <= base) continue;
          const k = M.smoothstep(0.05, hw * 2.5, d);
          h = base + (h - base) * Math.pow(k, 0.9);
        }
        // fine texture, suppressed on valley floors so terraces/tracks stay trafficable
        const floorK = Math.min(tMain, tS);
        h += (4 + 16 * floorK) * noise(u * 60, v * 60) + (1.5 + 5 * floorK) * noise(u * 160, v * 160);
        z[r * n + c] = h;
      }
    }
    const grid = M.makeGrid({
      w: n, h: n, cs, x0: 412000, y0: 3960000, zone: 43, north: true, z,
      name: 'Synthetic training area (fictional terrain)', source: 'procedural', synthetic: true,
    });
    const P = (u, v) => ({ c: Math.round(u * (n - 1)), r: Math.round(v * (n - 1)) });
    const C = (u, v) => [u * (n - 1), v * (n - 1)];
    // jeep track along the main valley floor and a switchback mule track up to the own locality
    const valleyTrack = [];
    for (let u = 0.01; u <= 0.99; u += 0.02) valleyTrack.push(C(u, vc(u)));
    const own = [0.47, vc(0.47) + 0.045];
    const muleTrack = [C(0.47, vc(0.47))];
    for (let k = 1; k <= 6; k++) muleTrack.push(C(0.47 + (k % 2 ? 0.012 : -0.012), vc(0.47) + (k / 6.5) * 0.045));
    muleTrack.push(C(own[0], own[1]));
    return {
      grid,
      tracks: [valleyTrack, muleTrack],
      markers: {
        own: P(0.47, vc(0.47) + 0.045),
        threat: P(0.41, vs(0.41) - 0.01),
        target: P(pass1[0], pass1[1] + 0.01),
        a: P(0.04, vc(0.04)),
        b: P(0.62, 0.24),
      },
    };
  };
});
