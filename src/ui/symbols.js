/*
 * MtnAI ui — lightweight NATO APP-6(D) / MIL-STD-2525D symbol renderer.
 *
 * Draws only the symbols this tool needs (land units, land equipment and a few
 * control-measure points) as SVG in the standard 200 x 200 symbol space.
 * Frame and icon geometry follows the published standard as implemented in the
 * MIT-licensed milsymbol library (c) Måns Beckman, spatialillusions.com.
 *
 * spec = { set: 'unit'|'equip'|'cm', affil: 'F'|'H'|'N'|'U', icon, mods: ['mountain'],
 *          rng: 0..3, echelon, planned, text, sub }
 */
(function (UI) {
  'use strict';

  const FILL = { F: '#80E0FF', H: '#FF8080', N: '#AAFFAA', U: '#FFFF80' };
  const CM_COLOR = { F: '#000000', H: '#FF0000', N: '#00A000', U: '#C0A000' };

  const FRAMES = {
    unit: {
      F: { d: 'M25,50 l150,0 0,100 -150,0 z', box: [25, 50, 175, 150] },
      H: { d: 'M100,28 L172,100 100,172 28,100 Z', box: [28, 28, 172, 172] },
      N: { d: 'M45,45 l110,0 0,110 -110,0 z', box: [45, 45, 155, 155] },
      U: { d: 'M63,63 C63,20 137,20 137,63 C180,63 180,137 137,137 C137,180 63,180 63,137 C20,137 20,63 63,63 Z', box: [31, 31, 169, 169] },
    },
  };
  FRAMES.equip = Object.assign({}, FRAMES.unit, { F: { circle: [100, 100, 60], box: [40, 40, 160, 160] } });

  const p = (d, extra) => Object.assign({ d }, extra || {});
  const circle = (cx, cy, r, fill) => ({ circle: [cx, cy, r], fill: !!fill });

  /** Icons: arrays of {d | circle, fill?}. Affiliation-specific where the standard differs. */
  const ICONS = {
    inf: { F: [p('M25,50 L175,150 M25,150 L175,50')], H: [p('M60,70L140,130M60,130L140,70')], N: [p('M45,45L155,155M45,155L155,45')], U: [p('M50,65L150,135M50,135L150,65')] },
    armr: [p('M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z')],
    mech: { F: [p('M25,50 L175,150 M25,150 L175,50'), p('M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z')],
      H: [p('M60,70L140,130M60,130L140,70'), p('M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z')] },
    at: { F: [p('M25,150 L100,52 175,150')], H: [p('M60,132 L100,30 140,132')], N: [p('M45,150 L100,47 155,150')], U: [p('M55,135 L100,33 145,135')] },
    recce: { F: [p('M25,150L175,50')], H: [p('M60,130L140,70')], N: [p('M45,155L155,45')], U: [p('M50,135L150,65')] },
    arty: [circle(100, 100, 15, true)],
    mortarUnit: [circle(100, 115, 5), p('M100,111 l0,-30 M90,90 l10,-10 10,10')],
    ad: { F: [p('M25,150 C25,110 175,110 175,150')], H: [p('M70,140 C70,115 130,115 130,140')], N: [p('M45,150 C45,110 155,110 155,150')], U: [p('m 55,135 c 10,-20 80,-20 90,0')] },
    engr: [p('M 60,118 V 83 h 80 v 35  M 100,83 V 110')],
    // land equipment
    mg: [p('m 100,60 0,80 M 85,75 100,60 115,75 M 80,140 120,140')],
    atrl: [p('m 85,140 15,-15 15,15 M 85,85 100,70 115,85 m -15,-15 0,55 M 85,75 100,60 115,75')],
    rcl: [p('m 85,75 15,-15 15,15 m 0,5 0,40 m -30,-40 0,40 m 15,-60 0,80')],
    atgm: [p('m 85,140 15,-15 15,15 M 85,120 85,75 c 0,-20 30,-20 30,0 l 0,45 m -15,5 0,-65')],
    mortar: [p('m 100,60 0,60 M 85,75 100,60 115,75'), circle(100, 130, 10)],
    how: [circle(100, 130, 10), p('m 115,80 0,40 m -30,-40 0,40 m 15,-60 0,60')],
    sam: [p('m 85,140 30,0 c 0,-20 -30,-20 -30,0 z m 15,-15 0,-65 m -15,80 0,-65 c 0,-20 30,-20 30,0 l 0,65')],
    adgun: [p('m 85,140 30,0 c 0,-20 -30,-20 -30,0 z m 15,-80 0,65 m 15,-45 0,40 m -30,-40 0,40')],
  };
  const RANGE_BARS = [null, 'm 85,100 30,0', 'm 85,105 30,0 m -30,-10 30,0', 'm 85,110 30,0 m -30,-20 30,0 m -30,10 30,0'];
  const MOUNTAIN = 'm 87,142 10,-20 5,10 3,-5 8,15';

  /** Control-measure points: geometry, bbox and anchor (symbol space). */
  const PIN = 'm 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z';
  const CM = {
    op: { parts: [p('m 100,45 47.6,82.5 -95.2,0 z')], box: [48, 40, 152, 132], anchor: [100, 100] },
    fo: { parts: [p('m 100,45 48,83 H 52.4 Z'), circle(100, 100, 15, true)], box: [48, 40, 152, 132], anchor: [100, 100] },
    cp: { parts: [p(PIN)], label: 'CKP', box: [55, -65, 145, 104], anchor: [100, 100] },
    sp: { parts: [p(PIN)], label: 'SP', box: [55, -65, 145, 104], anchor: [100, 100] },
    rp: { parts: [p(PIN)], label: 'RP', box: [55, -65, 145, 104], anchor: [100, 100] },
    trp: { parts: [p('m 50,100 100,0 m -50,-50 0,100')], box: [45, 45, 155, 155], anchor: [100, 100] },
    atmine: { parts: [circle(100, 100, 29, true)], box: [66, 66, 134, 134], anchor: [100, 100] },
    apmine: { parts: [circle(100, 100, 29, true), p('m 50,50 29.5,29.5 m 41,0 L 150,50')], box: [45, 45, 155, 134], anchor: [100, 100] },
  };

  const ECHELON = {
    team: (y) => [circle(100, y - 20, 15), p(`M80,${y - 10} L120,${y - 30}`)],
    squad: (y) => [circle(100, y - 20, 7.5, true)],
    section: (y) => [circle(85, y - 20, 7.5, true), circle(115, y - 20, 7.5, true)],
    platoon: (y) => [circle(70, y - 20, 7.5, true), circle(100, y - 20, 7.5, true), circle(130, y - 20, 7.5, true)],
    company: (y) => [p(`M100,${y - 5} L100,${y - 40}`)],
    battalion: (y) => [p(`M90,${y - 5} L90,${y - 40} M110,${y - 5} L110,${y - 40}`)],
    regiment: (y) => [p(`M80,${y - 5} L80,${y - 40} M100,${y - 5} L100,${y - 40} M120,${y - 5} L120,${y - 40}`)],
    brigade: (y) => [p(`M87.5,${y - 5} l25,-35 m0,35 l-25,-35`)],
  };
  UI.ECHELONS = Object.keys(ECHELON);

  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  const partSVG = (part, stroke, sw, fillColor, extra = '') => {
    const fill = part.fill ? fillColor : 'none';
    if (part.circle) {
      const [cx, cy, r] = part.circle;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${extra}/>`;
    }
    return `<path d="${part.d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" ${extra}/>`;
  };

  /** Build the SVG for a symbol. Returns {svg, box:[x1,y1,x2,y2], anchor:[x,y]}. */
  UI.symbolSVG = (spec) => {
    const affil = spec.affil || 'F';
    const sw = 4, halo = 'rgba(255,255,255,0.92)', hw = sw + 7;
    let parts = [], frame = null, box, anchor = [100, 100], labels = [];
    const icon = ICONS[spec.icon];
    if (spec.set === 'cm') {
      const cm = CM[spec.icon];
      parts = cm.parts.slice();
      box = cm.box.slice(); anchor = cm.anchor;
      if (cm.label) labels.push({ x: 100, y: -30, text: cm.label, size: 34 });
      if (spec.text) labels.push({ x: 100, y: cm.label ? 18 : 100, text: spec.text, size: 34 });
    } else {
      const set = FRAMES[spec.set] || FRAMES.unit;
      frame = set[affil] || set.F;
      box = frame.box.slice();
      if (icon) parts = (Array.isArray(icon) ? icon : icon[affil] || icon.F).slice();
      if (spec.rng && RANGE_BARS[spec.rng]) parts.push(p(RANGE_BARS[spec.rng]));
      if ((spec.mods || []).includes('mountain')) parts.push(p(MOUNTAIN, { fill: true, noStroke: true }));
      if (spec.echelon && ECHELON[spec.echelon]) {
        const top = frame.box[1];
        parts.push(...ECHELON[spec.echelon](top).map((x) => Object.assign(x, { echelon: true })));
        box[1] = Math.min(box[1], top - 45);
      }
      if (spec.text) labels.push({ x: 100, y: 108, text: spec.text, size: 42 });
    }
    const color = spec.set === 'cm' ? CM_COLOR[affil] : '#000';
    const dash = spec.planned ? 'stroke-dasharray="10,8"' : '';
    let body = '';
    // halo (outline) for legibility on any background
    if (frame) body += frame.circle
      ? `<circle cx="100" cy="100" r="60" fill="none" stroke="${halo}" stroke-width="${hw}"/>`
      : `<path d="${frame.d}" fill="none" stroke="${halo}" stroke-width="${hw}" stroke-linejoin="round"/>`;
    for (const pt of parts) if (!frame || pt.echelon || spec.set === 'cm') body += partSVG(pt, halo, hw, halo);
    // frame fill + outline
    if (frame) {
      const fill = spec.unfilled ? 'none' : FILL[affil];
      body += frame.circle
        ? `<circle cx="100" cy="100" r="60" fill="${fill}" stroke="#000" stroke-width="${sw}" ${dash}/>`
        : `<path d="${frame.d}" fill="${fill}" stroke="#000" stroke-width="${sw}" stroke-linejoin="round" ${dash}/>`;
    }
    for (const pt of parts) {
      if (pt.noStroke) body += `<path d="${pt.d}" fill="${color}" stroke="none"/>`;
      else body += partSVG(pt, color, sw, color, spec.set === 'cm' && spec.planned ? dash : '');
    }
    for (const l of labels) {
      body += `<text x="${l.x}" y="${l.y}" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="${l.size}" text-anchor="middle" dominant-baseline="middle" stroke="${halo}" stroke-width="8" paint-order="stroke" fill="${color}">${esc(l.text)}</text>`;
    }
    const pad = 8;
    box = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
    const W = box[2] - box[0], H = box[3] - box[1];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${box[0]} ${box[1]} ${W} ${H}">${body}</svg>`;
    return { svg, box, anchor };
  };

  /** Inline SVG markup scaled so the frame is `px` pixels tall (for lists / legends). */
  UI.symbolHTML = (spec, px = 28) => {
    const s = UI.symbolSVG(spec);
    const k = px / 100;
    const W = (s.box[2] - s.box[0]) * k, H = (s.box[3] - s.box[1]) * k;
    return s.svg.replace(/width="[^"]+" height="[^"]+"/, `width="${W.toFixed(1)}" height="${H.toFixed(1)}"`);
  };

  // ---- raster cache for the map renderers
  const cache = new Map();
  let onReady = null;
  UI.onSymbolReady = (fn) => { onReady = fn; };

  /**
   * Returns {img, w, h, ax, ay} (pixels; ax/ay = anchor offset inside the image)
   * or null while the image is still decoding (a redraw is requested once ready).
   */
  UI.symbolImage = (spec, px = 32) => {
    const key = JSON.stringify(spec) + '|' + px;
    let e = cache.get(key);
    if (!e) {
      const s = UI.symbolSVG(spec);
      const k = px / 100;
      const ratio = Math.min(3, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1) * 1.5;
      const W = (s.box[2] - s.box[0]) * k, H = (s.box[3] - s.box[1]) * k;
      e = { img: null, w: W, h: H, ax: (s.anchor[0] - s.box[0]) * k, ay: (s.anchor[1] - s.box[1]) * k };
      cache.set(key, e);
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = Math.ceil(W * ratio); cv.height = Math.ceil(H * ratio);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        e.img = cv;
        if (onReady) onReady();
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.svg.replace(/width="[^"]+" height="[^"]+"/, `width="${W * ratio}" height="${H * ratio}"`));
    }
    return e.img ? e : null;
  };

  // ---- symbol specs used across the app
  UI.SYM = {
    own: (echelon = 'battalion') => ({ set: 'unit', affil: 'F', icon: 'inf', mods: ['mountain'], echelon }),
    threat: (type = 'foot') => ({ set: 'unit', affil: 'H', icon: type === 'tracked' ? 'armr' : type === 'jeep' || type === 'truck' ? 'mech' : 'inf', echelon: 'battalion' }),
    post: (echelon = 'platoon') => ({ set: 'unit', affil: 'F', icon: 'inf', mods: ['mountain'], echelon, planned: true }),
    op: () => ({ set: 'cm', affil: 'F', icon: 'op', planned: true }),
    picquet: () => ({ set: 'unit', affil: 'F', icon: 'inf', mods: ['mountain'], echelon: 'section', planned: true }),
    weapon: (w) => ({ set: 'equip', affil: 'F', icon: w.icon, rng: w.rng, planned: true }),
    mine: (type) => ({ set: 'cm', affil: 'F', icon: type === 'AP' ? 'apmine' : 'atmine' }),
    sp: () => ({ set: 'cm', affil: 'F', icon: 'sp' }),
    rp: () => ({ set: 'cm', affil: 'F', icon: 'rp' }),
    cp: (n) => ({ set: 'cm', affil: 'F', icon: 'cp', text: String(n) }),
    target: () => ({ set: 'cm', affil: 'H', icon: 'trp' }),
    hostileOP: () => ({ set: 'cm', affil: 'H', icon: 'op' }),
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
