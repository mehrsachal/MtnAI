/* Written script — MtnEye: GIS decision aid for mountain warfare. Format follows the "Written Script" sample:
 * Arial, US Letter, 1" margins, 1.5 line spacing, headings 14 pt bold underlined centred, body 12 pt justified,
 * paragraphs numbered continuously, sub-paras a. b. c., figures centred below the paragraph. */
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, Footer, PageNumber, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType } = require('docx');

const IMG = process.argv[2], OUT = process.argv[3];
const SUM = JSON.parse(fs.readFileSync(path.join(IMG, '..', 'ws_img', 'summary.json'), 'utf8'));
const FONT = 'Arial';
const LINE = { line: 360, lineRule: 'auto' };
const r = (t, o = {}) => new TextRun({ text: t, font: FONT, size: 24, ...o });
/** inline markup: [[lead-in]] = bold underlined, **bold** */
const runs = (s) => s.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/).filter(Boolean).map((x) =>
  x.startsWith('[[') ? r(x.slice(2, -2), { bold: true, underline: {} }) : x.startsWith('**') ? r(x.slice(2, -2), { bold: true }) : r(x));
const C = [];
const head = (t) => C.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { ...LINE, before: 240, after: 120 }, keepNext: true,
  children: [new TextRun({ text: t, font: FONT, size: 28, bold: true, underline: {} })] }));
let N = 0;
/** numbered paragraph, optional sub-paras (a., b., ...) and sub-sub (i), (ii) as nested arrays */
const para = (text, subs) => {
  N++;
  C.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { ...LINE, after: 120 }, indent: { left: 720, hanging: 720 },
    children: [r(`${N}.`), new TextRun({ text: '\t', font: FONT, size: 24 }), ...runs(text)], tabStops: [{ type: 'left', position: 720 }] }));
  if (subs) sub(subs, 0);
};
const sub = (items, lvl) => {
  let k = 0;
  for (const it of items) {
    if (Array.isArray(it)) { sub(it, lvl + 1); continue; }
    const lab = lvl === 0 ? `${String.fromCharCode(97 + k)}.` : `(${['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][k]})`;
    k++;
    const left = 720 * (lvl + 2);
    C.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { ...LINE, after: 80 }, indent: { left, hanging: 720 }, tabStops: [{ type: 'left', position: left }],
      children: [r(lab), new TextRun({ text: '\t', font: FONT, size: 24 }), ...runs(it)] }));
  }
};
let F = 0;
const fig = (file, caption, widthIn = 6.0) => {
  const f = path.join(IMG, file);
  const b = fs.readFileSync(f);
  // jpeg size
  let i = 2, w = 0, h = 0;
  while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xc3) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; } i += 2 + b.readUInt16BE(i + 2); }
  const W = Math.round(widthIn * 96), H = Math.round((W * h) / w);
  const maxH = 4.6 * 96, scale = H > maxH ? maxH / H : 1;
  F++;
  C.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 40 }, keepNext: true,
    children: [new ImageRun({ type: 'jpg', data: b, transformation: { width: Math.round(W * scale), height: Math.round(H * scale) } })] }));
  C.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [r(`Fig ${F}: ${caption}`, { italics: true, size: 20 })] }));
};
const cellB = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const table = (head, rows, widths) => {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (t, w, bold) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders: { top: cellB, bottom: cellB, left: cellB, right: cellB },
    margins: { top: 60, bottom: 60, left: 100, right: 100 }, shading: bold ? { type: ShadingType.CLEAR, fill: 'E7E6E6', color: 'auto' } : undefined,
    children: [new Paragraph({ children: [r(t, { size: 20, bold })] })] });
  C.push(new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: head.map((t, k) => cell(t, widths[k], true)) }), ...rows.map((row) => new TableRow({ children: row.map((t, k) => cell(t, widths[k])) }))] }));
  C.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
};

// ====================================================================== TITLE
C.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { ...LINE, after: 60 }, children: [new TextRun({ text: 'MTNEYE', font: FONT, size: 32, bold: true, underline: {} })] }));
C.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { ...LINE, after: 240 }, children: [new TextRun({ text: 'GIS DECISION AID FOR MOUNTAIN WARFARE — EXPLANATION OF ALL TOOLS', font: FONT, size: 24, bold: true })] }));

// ====================================================================== INTRO
head('INTRO');
para('Mountain warfare is a contest for heights, routes and time. The side which holds the dominating ground, watches every approach and knows how long a move will really take dictates the battle. GSP Mountain Warfare lays down that, at bde level and below, objs are the seizure or retention of specific dominating heights, and that every conceivable appr, incl nullahs, has to be guarded. Applying these rules on a map sheet is slow: slopes, intervisibility, dead ground and march times have to be worked out by hand for every feature.');
para('MtnEye is an offline GIS decision aid built to do this work in minutes. It reads a Digital Elevation Model (DEM) of the AO, and every tool turns one GSP / IPB rule into an analysis on the ground: where tps and animals can move, what can be seen from where, where the en will come from, where posts, wpns, m fds and helipads should go, and how a sector along the LoC should be held. Every result is rated Good / Marginal / Not good with the reasons, and every tool can be opened as a model to show exactly how the answer was reached.');
para('The software runs as a single file in any browser, without installation, server or internet. The internet is used only to download a DEM or satellite imagery for a new area; once saved, the work continues fully offline.');

head('AIM');
para('To explain the working of every tool of MtnEye, its inputs and outputs, and how its results are to be read and used in the planning of ops in mountains.');

head('SEQ');
para('The script shall unfold in fol seq:', [
  'Part I — The workspace and data',
  'Part II — Terrain analysis tools',
  'Part III — Tac siting tools',
  'Part IV — Mov tools',
  'Part V — Sector planning tools (LoC)',
  'Part VI — Explaining and sharing results',
  'Part VII — Limitations and recoms',
]);

// ====================================================================== PART I
head('PART-I');
head('THE WORKSPACE AND DATA');
para('[[Layout]]. MtnEye is laid out like ArcGIS Pro so that a trained GIS operator is at home and a new user learns one place for everything:', [
  '[[Ribbon]]. Tabs Project, Map, Insert, Analysis, Edit, View, Imagery, Terrain, Symbology, Share and Help. Every tool is one click away; Ctrl + K searches all commands by name.',
  '[[Contents pane]] (left). Lists every layer — situation, sector plan, analysis rasters, grids and the elevation model — with legend, on / off tick and right-click options (zoom, properties, attribute table, remove).',
  '[[Geoprocessing pane]] (right). Opens the selected tool with its parameters. Each parameter has a default from GSP / IPB; changed values are remembered. After a run the result summary appears below with “Explain this result” and “Open as a model”.',
  '[[Map, Scene and ModelBuilder views]]. 2D map, 3D scene (draped imagery, vertical exaggeration, fly-through) and the ModelBuilder diagram of the current analysis.',
  '[[Bottom dock]]. Attribute table of every result (sortable, filterable, CSV export), processing history, terrain profile, route information and the GSP route card.',
]);
fig('01_workspace.jpg', 'MtnEye workspace — ribbon, Contents, map and Geoprocessing pane (demo terrain)');
para('[[Data Tools]]. The analysis starts from a DEM; three tools manage the data:', [
  '[[Add Data]]. Loads a DEM already held: SRTM .hgt, GeoTIFF, ESRI ASCII grid or a .zip of these. It is reprojected to UTM in the correct zone automatically.',
  '[[Download DEM]]. Downloads elevation for a centre point and size (e.g. 16 × 16 km) or a bounding box from AWS Terrain Tiles (≈ 30 m) or, with a key, OpenTopography (Copernicus 30 m). A GeoTIFF copy is saved so that the same area works offline later. This is the only tool that needs the network.',
  '[[Export Raster]]. Writes the DEM or any analysis raster (slope, Go / No-Go, viewshed, etc.) to GeoTIFF or ESRI ASCII grid for use in ArcGIS / QGIS.',
  '[[Convert Coordinates]]. Converts any reference — MGRS, UTM, lat / long (DD, DM, DMS), GARS, GEOREF or the secondary CRS (Kalianpur 1962 / India zone I) — to all the others. Every result in MtnEye is listed with MGRS and the secondary CRS grid ref.',
]);
fig('02_download.jpg', 'Download DEM — centre point and size of the area; a GeoTIFF copy is kept for offline use');
para('[[Situation]]. Own posn, en posn, tgt and route start / end (A, B) are placed from the Insert tab with APP-6(D) symbols. No-Go areas (obstacles) and tracks are digitised as polygons / lines; tracks are moved on at track speed and obstacles block mov in every tool. The sector boundary and the border line (LoC) are drawn for sector planning.');

// ====================================================================== PART II
head('PART-II');
head('TERRAIN ANALYSIS TOOLS');
para('[[Go / No-Go (Mobility)]]. Answers “where can this class of tps or veh move freely, slowly, or not at all?”', [
  '[[Inputs]]. DEM, mov class (inf, mule / animal tpt, jeep, truck / towed gun, tracked), snow line, digitised obstacles and tracks.',
  '[[Working]]. The slope of every cell is compared with the IPB limits: GO below 30 % (16.7°), SLOW-GO 30–45 %, NO-GO 45 % (24.2°) or more. Mules take the same limits as a man (GSP Annex H: a laden mule climbs what a man can climb without using his hands). Optionally the IPB elevation-variation rule (relief per km) and a snow line are applied.',
  '[[Output]]. Green / yellow / red raster with the share of each class. NO-GO caused only by slope is not treated as a wall in the mov tools: IPB states that such ground is crossed at greatly reduced speed, so routes and approaches cross it four times slower; cliffs over 45° and drawn obstacles stay impassable.',
]);
fig('03_mobility.jpg', 'Go / No-Go for dismounted inf — green GO, yellow SLOW-GO, red NO-GO');
para('[[Key Terrain]]. Finds the dominating heights and the passes (cols) between them.', [
  '[[Working]]. A height is a cell that is the highest within the search radius (600 m) and stands well above its surroundings (regional Topographic Position Index). A pass is a saddle: high ground on two sides and low ground on the other two, tested on a ring round each cell.',
  '[[Output]]. Up to 20 heights (▲) and 15 passes ()( ) ranked best first, each with grid ref and height. GSP Sec 4: routes are overlooked by dominating heights; passes are held from the heights on either side.',
]);
fig('04_key.jpg', 'Key terrain — dominating heights and passes');
para('[[Viewshed and Line of Sight]]. The two basic visibility tools.', [
  '[[Viewshed]]. Ground visible from an observer point within a radius (default 5 km), with observer and tgt heights above ground and earth curvature / refraction. The shaded area is what an OP at that point can see; the rest is dead ground.',
  '[[Line of Sight]]. Intervisibility between two points with the terrain profile in the dock: visible or masked, the point where the ground masks the line, clearance and range. For fire, the angle of sight and the GSP Sec 18 sight correction (slant range ÷ factor) are given.',
]);
fig('05_viewshed.jpg', 'Viewshed from the own posn — yellow ground is visible, the rest is dead ground');
fig('06_los.jpg', 'Line of sight own posn to en posn with the terrain profile and masking point');
para('[[Enemy Observation]]. Shows which of our ground the en can see. The likely en OPs are placed on the most commanding ground near the en posn (default 5 OPs within 3 km of the en, spaced apart; viewing range 8 km) and a viewshed is computed from each. Shaded ground is overlooked; unshaded ground is in defilade — suitable for HQs, mortars, admin areas and covered routes (GSP Sec 12: dig down and conceal; use reverse slopes).');
fig('07_hostile.jpg', 'Ground overlooked by likely en OPs (shaded) — the rest is hidden from the en');
para('[[Route Viewshed]]. The viewshed of a whole route. Stations are placed every 250 m along a route (computed route, en avenue, appr or a drawn line) and the views are added up:', [
  '[[Exposure]]. Every place from which the route can be seen — where the en would put OPs, or where we must picquet.',
  '[[What the column sees]]. The ground a column moving on the route can observe.',
  '[[Watch points]]. The best 5 points from which the most of the route is seen (for picquets or likely en OPs).',
]);
fig('15_routevs.jpg', 'Route viewshed — darker ground sees more of the route; W1–W5 best watch points');

// ====================================================================== PART III
head('PART-III');
head('TAC SITING TOOLS');
para('[[Avenues of Approach]]. Least-time routes from the en posn to own posn for the en mov class. The first avenue (AA1) is the quickest; the used ground is then made expensive and the search repeated, so the next avenues (default 3, at least 500 m apart) run on different ground. A corridor (300 m half-width) is shaded round each. GSP Sec 7 para 4: valley, nullah and ridge-line approaches.');
fig('08_avenues.jpg', 'En avenues of approach (dashed) with their corridors');
para('[[Suggest Posts / OPs]]. Sites def posts or OPs that together see the most of the ground the en must use.', [
  '[[Screening]]. Every sample point is tested: slope not over 35°, a suitable landform (ridge / upper slope), reachable from own posn, within 7 km of own posn and at least 500 m from the en. The best-placed 110 candidates (height, prominence, nearness to avenues) are kept.',
  '[[Choice]]. A viewshed is computed from each candidate; ground on the en avenues counts most. The candidate seeing the most is taken first, then the one adding the most ground not yet seen, and so on (maximum coverage). Posts at a new height band get credit so that low cloud cannot blind every post (GSP Sec 22).',
  '[[Output]]. Posts (default 5) with combined coverage (green), dead ground inside their range (hatched), mutually intervisible pairs, and a strong point on the most dominating post (GSP Sec 12 para 9).',
]);
fig('09_posts.jpg', 'Suggested posts with combined observation (green) and dead ground');
para('[[Suggest Weapon Sites]]. Sites a wpn from the wpn table (MG3, HMG, RPG-7, 106 RCL, Baktar-Shikan, TOW, 60 / 81 / 120 mm mortars, AD wpns):', [
  '[[Direct fire]]. Sites within the defended area (3 km) on ground the wpn can use, chosen by the field of fire over the en avenues, with enfilade preferred. The arc of fire is shown.',
  '[[Indirect fire]]. Sites in range of the tgt (15–92 % of max range), not too far fwd, with crest clearance for the trajectory and optionally hidden from en obsn (defilade).',
  '[[Mount limits]]. Elevation / depression limits of the mount and the GSP Sec 18 sight correction are applied.',
]);
fig('10_weapons.jpg', 'MG3 sites with fields of fire, and 81 mm mortar positions');
para('[[Suggest Minefields]]. Builds an obstacle plan and tests every field against the en:', [
  '[[AT (barrier)]]. Defiles on the veh avenues (narrow gaps between NO-GO ground, 300 m to 3 km from own tps) are candidates. Each is “mined” in turn and the en re-routed: the extra time he needs, going round or breaching (1.5 h), is what the field is worth. The best field is laid, the rest re-tested, and fields adding less than 5 min are dropped. The en time before and after the plan is reported.',
  '[[AP (protective)]]. Fields 80–800 m in front of own posts and across infiltration nullahs, judged by fire cover.',
  '[[Notes]]. Density 1 mine per metre (mountain default). Steep / rocky sites carry the GSP warning that mines wash away (use wire) and sites above the snow line lose effect. A field not under own obsn or fire is rated Not good.',
]);
fig('11_mfd.jpg', 'AP minefields in front of the posts');
para('[[Helipad Sites (HLS)]]. Finds flat, concealed landing sites near own posn: the whole pad (30 m radius) within the GSP Sec 22 para 19 slope limit — 4° for regular use, 10° (light / utility) or 20° (cargo) in emergency; hidden from en obsn, not on a crest (skyline, wind), reachable on foot and within 5 km. Sites are ranked by flatness, concealment and nearness.');
fig('16_helipads.jpg', 'Helipad sites near own posn');

// ====================================================================== PART IV
head('PART-IV');
head('MOV TOOLS');
para('[[Least-Time Route]]. The quickest route between A and B for a mov class, with alternatives:', [
  '[[Working]]. Every step between cells costs walking or driving time from the slope of that step — uphill slower, gentle downhill fastest (Tobler hiking function for foot and animals), with reduced work capacity at altitude. SLOW-GO is slower and steep NO-GO four times slower.',
  '[[Modes]]. Fastest; Balanced; Covered (ground seen by the en costs extra) and Custom. Crest (skyline) and nullah-bed penalties keep columns off skylines and out of stream beds (GSP).',
  '[[Output]]. Two routes on different ground by default (up to 4) with length, climb, descent, model time, the GSP march time (3 km/h by day, 0.5–1 km/h by night + 30–60 min per 300 m ascent / 600 m descent), share exposed to the en, and checkpoints every 1 km.',
  '[[Route card]]. The GSP Annex E route card leg by leg (grid ref, bearing, distance, ascent / descent, time) in the dock, ready to print.',
]);
fig('12_route.jpg', 'Least-time route A to B with an alternative and checkpoints');
fig('13_routecard.jpg', 'GSP route card of the selected route in the bottom dock');
para('[[Route Picquets]]. “Crowning the heights” (GSP Sec 6). Heights near the route (within 2 km, high landform, not over 38°, climbable from the route within 4 h) are screened; the one that sees the most of the route is taken first, then the one seeing most of the still unwatched route. One picquet per 2.5 km of route is the default. The output gives each picquet, the stretch of route it covers and its climb time, and the share of the route under obsn.');
fig('14_picquets.jpg', 'Route picquets PQ1–PQ6 on the heights over the route');
para('[[Fly Route (3D)]]. A fly-through of the selected route in the Scene view at a set speed and height, for briefing the column comd on what he will see. Esc stops it.');
fig('17_scene.jpg', 'Scene view (3D) with the route, posts and picquets');

// ====================================================================== PART V
head('PART-V');
head('SECTOR PLANNING TOOLS (LOC)');
para(`[[Gen]]. The sector tools plan the def of a sector along the LoC. The sector boundary and the border line are drawn first. The example used here is a 16 × 16 km area of the Neelum valley (Keran) with a notional LoC; the figures quoted are from that run (${SUM.plan.mode}).`);
para('[[Sector Assessment (Run All)]]. Runs every sector tool in order — terrain value and ridgelines, ITGs, deployment, en approaches, infiltration routes, fire coverage, border surveillance and en courses of action — and rates every item. Each tool can also be run on its own with its own parameters.');
para('[[Terrain Value & Ridgelines]]. Scores every cell 0–100 for dominance (regional and local height inside the sector) and extracts the terrain networks:', [
  '[[Ridgelines]]. Traced on the real ground by steepest-ascent flow: slopes drain upward onto the crest, which carries the flow to the summit. Only stretches where the ground falls away on both sides (a true crest) are kept, so the lines lie on the ridges seen in the 3D view. Each ridgeline is rated by its mean dominance.',
  '[[Nullahs and valleys]]. Traced by normal drainage (flow accumulation): nullahs from 0.4 km² of catchment, valleys from 15 km².',
  `[[Result]]. ${SUM.ridges} ridgelines in the Neelum example. GSP Sec 7 para 4: valley, nullah and ridge-line approaches.`,
]);
fig('21_terrain.jpg', 'Terrain value (brown, darker = more dominating) with ridgelines and nullahs');
para('[[ITGs (Important Terrain Grounds)]]. Picks the key ground to hold:', [
  '[[Selection]]. Summits on our side of the LoC inside the sector with terrain value of 60 or more, each the highest point within 500 m and at least 700 m from the next.',
  '[[Extent and force]]. The footprint is the ground within 60 m of the summit height (max 900 m radius). Its perimeter decides the force to hold it: a sec up to 1500 m, a pl up to 3500 m, a coy up to 7000 m, beyond that a bn.',
  '[[Rating]]. Score = 40 % dominance + 35 % obsn over the approaches and nullahs (3 km) + 25 % closeness to the border. Good from 0.72, Marginal from 0.58.',
  `[[Result]]. ${SUM.itgs} ITGs in the example, each with outline, area, force needed and rating (GSP Sec 4 para 7, Sec 12 para 9).`,
]);
fig('22_itgs.jpg', 'ITGs with their extent, force needed and rating');
para('[[Deployment Plan]]. Lays out the bn in the selected mode (forward, normal or strong point; default 3 coys × 3 pls):', [
  '[[Border posts]]. Along the line every 1–2.5 km (by mode) on the most dominating ground within the set depth, each checked for line of sight to its neighbours.',
  '[[Pl posts]]. Every pl post is on a ridgeline crest, at least 800 m from any other (editable), so that one shell, one OP or one infiltrating party cannot deal with two of them. Good / Marginal ITGs are held first and no ITG gets more pls than its size needs. In forward and normal def the pls are shared between the forward, intermediate and depth bands of ridgeline (GSP Sec 12 para 8 — tiered def); in strong point def each coy holds one of the most dominating ITGs with its pls on the ridgelines of that feature (Sec 12 para 9).',
  '[[HQs and mortars]]. Coy HQs behind their pls, on gentle ground hidden from the en; the bn HQ in depth; 60 mm mortars in range of their coy’s posts and the 81 mm mortar in range of the most posts.',
  `[[Result]]. In the example: ${SUM.plan.bp} border posts, ${SUM.plan.pl} pl posts in ${SUM.plan.co} coys, about ${SUM.plan.troops} all ranks. Every posn is rated with its reasons (intervisibility, dominance, spacing, seen / hidden from the en).`,
]);
fig('23_deploy.jpg', 'Deployment plan — border posts, pl posts on the ridgelines, coy / bn HQs and mortars');
fig('29_scene_plan.jpg', 'The same plan in 3D — each pl on its own crest');
para('[[Fire Coverage & Interlocking]]. Counts how many wpns can fire on every cell (pl MGs 1200 m, border-post LMGs 800 m, 60 / 81 mm mortars and any wpn sites sited earlier), checks that every post is covered by at least two others (interlocking) and marks stretches of en appr under too little fire (fire gaps). GSP Sec 4 para 16: dead space is covered by mortars, mines and obstacles.');
fig('24_firecov.jpg', 'Fire coverage (orange, darker = more wpns) and fire gaps');
para(`[[Border Surveillance]]. Measures how much of the border line (and a 500 m band beyond it) the posts can see within 3 km, lists unwatched stretches longer than 300 m and suggests up to 4 extra OPs to close them. ${SUM.watch} % of the border was observed in the example. GSP Sec 4 para 23, Sec 15: gaps are watched by OPs, LPs and patrols.`);
fig('25_border.jpg', 'Border surveillance — unwatched stretches (magenta) and suggested extra OPs');
para('[[Enemy Approaches]]. How the en can come across the LoC to each ITG:', [
  '[[Entry points]]. Every 1.5 km along the border, 1.5 km back into en ground, a spot he can move on — his forming-up places.',
  '[[Paths]]. For each of the top 6 ITGs the least-time path from every entry point is found (steep ground crossed four times slower, per IPB); the 2 fastest that start in different places and do not share the same ground are kept.',
  `[[Description]]. Type (valley, nullah, ridge line, spur), length, time (GSP day / night) and the share under own obsn. Line colour shows how well we watch it. ${SUM.appr} approaches in the example.`,
]);
fig('26_eappr.jpg', 'En approaches across the LoC to the ITGs');
para(`[[Infiltration Routes]]. The routes a small party on foot would use to reach our HQs and depth unseen. Ground seen by our posts costs six times as much and nullahs / dead ground less, so the cheapest path is the most hidden one. The ${SUM.infil} least-watched distinct routes are reported; under 15 % watched is threat High — block with an ambush, LP or mines (GSP Sec 10, 15).`);
fig('27_infil.jpg', 'Infiltration routes to the HQs');
para(`[[Enemy Courses of Action]]. Two en COAs as the GSP describes the attacker’s objs: ${SUM.opts.join('; ')}.`, [
  '[[Most likely]]. Seize the ITG easiest to reach — least observed and quickest approach, with a second thrust from another direction if the ground offers one (GSP Sec 7 para 13a: multi-directional threat).',
  '[[Most dangerous]]. Seize the height that dominates our defs — overlooking our posts and HQs, high above our layout, on the flank or in the rear — combined with infiltration to raid HQs and gun areas (GSP Sec 7 para 3, Sec 9 para 7, Sec 10 para 4).',
  '[[Recom]]. Each COA comes with counter-measures: OP / LP and DF tasks on the approach, mines in its defiles, a strong point with 30 days’ staying power and a counter-attack force.',
]);
fig('28_eopts.jpg', 'En courses of action — most likely and most dangerous');

// ====================================================================== PART VI
head('PART-VI');
head('EXPLAINING AND SHARING RESULTS');
para('[[Explain This]]. Every result has an “Explain” panel built from the method actually run, the parameters used in that run and the GSP / IPB refs: what the result means, how it was computed, its assumptions and limits. Where the software cannot establish an answer it says so. The Reference Library (Shift + F1) lists the doctrine and literature used.');
fig('20_explain.jpg', 'Explain panel of a route — method, parameters and refs of the run');
para('[[ModelBuilder]]. Shows an analysis as a chain of ordinary GIS tools, exactly as in ArcGIS ModelBuilder: input data (blue), values that can be changed (light blue), tools (yellow) and derived data (green). For the route: DEM → Slope → Reclassify (IPB classes) → Go / No-Go; en OP → Viewshed → en view; Raster Calculator → cost raster; Path Distance from A → time and backlink; Cost Path to B → route; Line Statistics → route table. Any value can be edited on the diagram and the model re-run; only the tools downstream of the change are re-run. Ready models: Go / No-Go, least-cost route, en approaches across the border, hidden infiltration route and OP coverage. A tool or value can be added to build a new model.');
fig('18_modelbuilder.jpg', 'ModelBuilder — least-cost route A to B as a chain of GIS tools');
para('[[Brief on Map]]. Steps through a model on the map one tool at a time — inputs first, then each tool with only its inputs and output shown, a caption of what it does, the values used and what it produced, then the result. It is meant for briefing a senior comd on how an answer was reached.');
fig('19_brief.jpg', 'Brief on map — step 5, Path Distance, with the time raster on the map');
para('[[Reports and Exports]]. The results leave MtnEye in forms other systems and staffs can use:', [
  '[[Report]]. A printable report of the situation, every result and the sector assessment with ratings and reasons.',
  '[[Shapefile / GeoJSON / CSV]]. Every feature (posts, ITG outlines, routes, approaches, m fds, etc.) with its attributes, for ArcGIS / QGIS and C2 systems.',
  '[[PNG and GeoTIFF]]. Map images and analysis rasters.',
  '[[Plan file]]. The whole session (situation, results, sector plan) is saved and reopened later.',
]);

// ====================================================================== PART VII
head('PART-VII');
head('LIMITATIONS AND RECOMS');
para('[[Limitations]]. The results are only as good as the data and the rules:', [
  '[[DEM resolution]]. A 30 m DEM smooths small features — a 10 m cliff, a sangar site or a narrow track may not show. Results are to be confirmed on the ground or with larger-scale maps and imagery.',
  '[[Vegetation and built-up areas]]. The DEM is bare earth; trees and buildings that block view or mov are not in it unless drawn as obstacles.',
  '[[Weather]]. Snow, cloud and visibility are modelled only through the snow line and observer ranges.',
  '[[Doctrine rules]]. Planning figures (slope limits, ranges, perimeters, spacing) are defaults from GSP / IPB and can be changed in every tool; the comd’s judgement remains final.',
]);
para('[[Recoms]]. For best use:', [
  'Download and save the DEM of the AO in peace time so the tool runs offline in ops.',
  'Confirm the key results — ITGs, posts, approaches — by recce and air photo, and correct the parameters from local trials (e.g. mule loads, snow line).',
  'Use Explain and ModelBuilder when presenting a plan, so that every recom can be traced to the ground and the rule behind it.',
]);

head('CONCL');
para('MtnEye converts the GSP rules of mountain warfare into answers on the actual ground: where tps can move and how long it will take, what can be seen from where, where the en will come from, and how a sector is best held — on the ridgelines, dispersed, with every ITG covered and every approach watched. It does not replace the comd’s appreciation, but it gives him in minutes, and in a form he can check step by step, what would take a staff days to work out by hand.');

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 24 } } } },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 })] })] }) },
    children: C,
  }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT, b); console.log('wrote', OUT, 'paras', N, 'figs', F); });
