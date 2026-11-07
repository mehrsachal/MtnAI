#!/usr/bin/env node
/*
 * Builds docs/guide/MtnAI_User_Guide.docx — Arial 12 pt, black only.
 *   node tools/guide/params.mjs docs/guide/params.json
 *   python3 tools/guide/flowcharts.py docs/guide/img
 *   node tools/doc-shots.cjs docs/guide/img
 *   python3 tools/guide/prepare_images.py docs/guide/img
 *   node tools/guide/build-guide.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, HeadingLevel, LevelFormat, PageBreak, Footer, PageNumber, TableLayoutType,
} = require('docx');

const ROOT = path.resolve(__dirname, '..', '..');
const IMG = path.join(ROOT, 'docs/guide/img');
const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/guide/params.json'), 'utf8'));
const FONT = 'Arial', SIZE = 24, COLOR = '000000';
const TEXT_W = 9638; // A4 with 2 cm margins, in DXA

// ------------------------------------------------------------ helpers
const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: SIZE, color: COLOR, ...o });
/** Inline **bold** markup. */
const runs = (s) => s.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((x) => (x.startsWith('**') ? run(x.slice(2, -2), { bold: true }) : run(x)));
const para = (s, o = {}) => new Paragraph({ children: runs(s), spacing: { after: 120 }, ...o });
const h1 = (s) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(s.toUpperCase(), { bold: true })], pageBreakBefore: true });
const h2 = (s) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(s, { bold: true })] });
const h3 = (s) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [run(s, { bold: true, italics: true })] });
const bullet = (s, level = 0) => new Paragraph({ children: runs(s), numbering: { reference: 'bullets', level }, spacing: { after: 60 } });
let listNo = 0;
const steps = (items) => { const ref = `steps${listNo++}`; numberingRefs.push(ref); return items.map((s) => new Paragraph({ children: runs(s), numbering: { reference: ref, level: 0 }, spacing: { after: 60 } })); };
const numberingRefs = [];
let fig = 0;
const pngSize = (file) => { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const image = (name, caption, widthIn = 6.5, maxHeightIn = 8.6) => {
  const file = path.join(IMG, name);
  const { w, h } = pngSize(file);
  const fitIn = Math.min(widthIn, (maxHeightIn * w) / h); // keep image + caption on one page
  const W = Math.round(fitIn * 96), H = Math.round((W * h) / w);
  fig++;
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 }, children: [new ImageRun({ type: 'png', data: fs.readFileSync(file), transformation: { width: W, height: H }, altText: { title: caption, description: caption, name } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [run(`Figure ${fig}. ${caption}`, { italics: true })] }),
  ];
};
const flow = (name, caption) => image(`fc_${name}.png`, `Flowchart — ${caption}`, 6.0);
const shot = (name, caption) => image(`${name}.png`, caption, 6.5);

const border = { style: BorderStyle.SINGLE, size: 4, color: COLOR };
const borders = { top: border, bottom: border, left: border, right: border };
const cell = (t, w, o = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA }, borders, margins: { top: 60, bottom: 60, left: 100, right: 100 }, columnSpan: o.span,
  children: [new Paragraph({ children: o.bold ? [run(t, { bold: true })] : runs(t) })],
});
const table = (head, rows, widths) => new Table({
  width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
  rows: [new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, widths[i], { bold: true })) })]
    .concat(rows.map((r) => new TableRow({ cantSplit: true, children: r.section ? [cell(r.section, TEXT_W, { bold: true, span: widths.length })] : r.map((t, i) => cell(String(t), widths[i])) }))),
});
const gap = () => new Paragraph({ children: [run('')], spacing: { after: 60 } });

/** Parameter table for a geoprocessing tool, straight from the app's tool definitions. */
const params = (id) => {
  const t = P[id];
  const rows = t.rows.map((r) => (r.section ? { section: r.section } : [r.label, String(r.def).replace(' °', '°'), [r.help, r.only].filter(Boolean).join(' ')]));
  return [table(['Setting', 'Default', 'Notes'], rows, [3900, 2300, 3438]), gap()];
};
const doctrine = (id) => (P[id].gsp ? [para(`**Doctrine.** ${P[id].gsp}`)] : []);

// ------------------------------------------------------------ content
const C = [];
const add = (...xs) => xs.flat().forEach((x) => C.push(x));

// Title page
add(
  new Paragraph({ spacing: { before: 2400, after: 240 }, alignment: AlignmentType.CENTER, children: [run('MTNAI', { bold: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run('Mountain Terrain Analysis — User Guide', { bold: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run('Features, how to use them, every setting and how each tool thinks')] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1200 }, children: [run('Built on the teachings of GSP Mountain Warfare (low and high altitude operations)')] }),
  para('**How to read this guide.** Each tool has four parts: what it does (in plain words), the doctrine behind it, a flowchart of how it works, and a table of every setting with its default. Screenshots use the demo terrain.'),
  para('**Contents.** 1 What MtnAI is · 2 Quick start · 3 The screen · 4 Getting terrain · 5 Coordinates and grids · 6 Setting the scene · 7 Terrain tools · 8 Visibility tools · 9 Siting tools · 10 Movement tools · 11 Layers, tables and saving · 12 Settings · 13 Doctrine in MtnAI · 14 Shortcuts and limits'),
);

// 1
add(h1('1. What MtnAI is'),
  para('MtnAI is a map program for planning fights in the mountains. You give it a height map of the ground (a DEM). It then tells you, square by square:'),
  bullet('where troops and vehicles **can go, go slowly, or cannot go**;'),
  bullet('which **heights matter** and where the **passes** are;'),
  bullet('what can be **seen** from a point, and what the **enemy can see**;'),
  bullet('the best places for **posts, OPs, weapons, minefields, picquets and helipads**;'),
  bullet('the best **route** from A to B, how long it takes, and a **route card**.'),
  para('It runs **fully offline** in a web browser. Nothing leaves the computer. The only optional internet use is the Download DEM tool.'),
  para('It looks and works like **ArcGIS Pro**: a ribbon at the top, layers on the left, tools on the right, map in the middle.'),
  para('**Doctrine.** The rules in GSP Mountain Warfare are built into the tools: march times, ridge routes, tiered defence, strong points, OPs at many heights, minefields in valleys, uphill / downhill fire, picquets and helipad slopes (Section 13 lists them all).'),
  para('**Important.** MtnAI suggests; it does not decide. Always confirm on the ground, as the pamphlet directs.'),
);

// 2
add(h1('2. Quick start (five minutes)'),
  ...steps([
    'Double-click **MtnAI.html** (or open index.html). Use Chrome, Edge or Firefox.',
    'Click **Demo terrain** to load the practice area, or **Add Data** to open your own DEM, or **Download DEM** to fetch one.',
    'On the **Map** tab, use **Situation** to place Own position, Enemy, Target, Start A and End B (the demo has them already).',
    'On the **Analysis** tab, click a tool (for example **Posts / OPs**). Its settings open on the right. Click **Run**.',
    'Look at the result on the map, in the **Attributes** pane and in the **Attribute table**. Save with **Ctrl+S**; print the report with **Ctrl+P**.',
  ]),
  shot('01_welcome', 'The start screen: Add Data, Download DEM or Demo terrain.'),
  flow('workflow', 'the whole planning job, start to finish.'),
);

// 3
add(h1('3. The screen'),
  shot('02_workspace_numbered', 'The MtnAI screen. The numbers match the table below.'),
  table(['No.', 'Part', 'What it is for'], [
    ['1', 'Ribbon', 'Tabs of buttons: Map, Analysis, Edit, View, Share, Settings, Help. Double-click a tab to hide or show it.'],
    ['2', 'Contents pane', 'Every layer with a tick box (show / hide) and a key. Right-click a layer for Zoom To, Attribute Table, Transparency, Remove, Properties.'],
    ['3', 'View tabs', 'Map (flat, 2D) or Scene (3D). The text on the right shows the coordinate systems in use.'],
    ['4', 'Map', 'Drag to move, wheel to zoom, click a symbol to see its details.'],
    ['5', 'Side pane', 'Geoprocessing (tool settings and Run), Attributes (details of what you clicked), History (every tool run).'],
    ['6', 'Bottom dock', 'Attribute table, Elevation profile and Route card.'],
    ['7', 'Status bar', 'Grid reference, height, slope, aspect, landform and Go / No-Go under the mouse; scale; progress.'],
    ['8', 'Command search', 'Type what you want (Ctrl+K), for example "minefield".'],
  ], [700, 2100, 6838]),
  gap(),
  shot('04_ribbon', 'The Analysis tab of the ribbon: every planning tool is one click away.'),
  h2('Running any tool'),
  ...steps([
    'Click the tool on the ribbon (or search for it). Its form opens in the **Geoprocessing** pane.',
    'Read the **Doctrine** note at the top (click it to open it fully).',
    'Check the settings. Points can be **picked on the map** or typed as a grid reference. Click a grey section heading to open more settings.',
    'Click **Run**. A green note shows the result; red means it failed and says why.',
    '**Reset parameters** puts every setting back to its default. Your changes are remembered between sessions.',
  ]),
);

// 4
add(h1('4. Getting terrain (the DEM)'),
  para('A DEM is a picture where each pixel is a height. MtnAI turns it into a grid of equal squares (cells) in metres (WGS 84 / UTM).'),
  h2('Add Data (offline)'),
  bullet('Files: SRTM **.hgt**, **GeoTIFF** (.tif), ESRI **ASCII grid** (.asc) or a **.zip** of these. Several tiles join together.'),
  bullet('Drag files onto the map, or Map ▸ **Add Data** (Ctrl+O).'),
  bullet('**Crop to AOI** (Edit tab) cuts out a smaller area at finer detail. **Full DEM** goes back.'),
  h2('Download DEM (needs internet)'),
  para('Fetches heights for any area. Save the GeoTIFF copy it makes, then you can work offline later with Add Data.'),
  shot('03_download', 'The Download DEM tool.'),
  flow('download', 'Download DEM.'),
  ...params('downloadDEM'),
  h2('Export Raster'),
  para('Writes the height map, slope, aspect, landforms, ruggedness or any analysis layer to a GeoTIFF or ASCII grid, for use in other GIS programs.'),
  ...params('exportRaster'),
);

// 5
add(h1('5. Coordinates, grids and measuring'),
  para('Open **Settings ▸ Coordinate Systems** (or click the coordinate text above the map).'),
  bullet('**Analysis grid:** WGS 84 / UTM, zone chosen automatically or forced.'),
  bullet('**Second system:** for example Kalianpur 1962 / India zone I or IIa, Kalianpur UTM, or your own.'),
  bullet('**Grid references:** MGRS (2 to 10 figures), UTM, latitude / longitude (DD, DM, DMS), GARS, GEOREF.'),
  bullet('**North:** grid, true or magnetic (enter declination). Angles in mils (6400 or 6000), degrees or gradians.'),
  bullet('**Map grids:** MGRS / UTM lines, a lat / long graticule and the second system\'s grid (View ▸ Grids & Labels).'),
  shot('15_settings', 'Settings ▸ Coordinate systems.'),
  h2('Go To XY and Convert Coordinates'),
  para('Type any reference in **Go To XY** (Map tab) and press Enter to jump there. **Convert Coords** shows the same point in every format.'),
  h2('Measure'),
  para('Map ▸ **Measure** (key M): click two points. You get distance, slope distance, grid / true / magnetic bearing, back bearing, height difference and the **GSP march time** by day and by night.'),
  shot('18_measure', 'Measure result with the GSP march time.'),
);

// 6
add(h1('6. Setting the scene'),
  h2('Place the units'),
  table(['Button', 'Meaning', 'Used by'], [
    ['Own Posn', 'Your defended area or HQ', 'Posts, weapons, minefields, avenues, helipads, access'],
    ['Enemy', 'Where the enemy is', 'Enemy observation, avenues, posts, minefields, routes'],
    ['Target', 'Area for mortars and guns to hit', 'Indirect-fire weapon sites'],
    ['Start A / End B', 'Start and end of a move', 'Route A→B, route card, picquets'],
  ], [2000, 3200, 4438]),
  gap(),
  para('Click the button, then click the map. **Edit ▸ Situation** also sets your echelon and the enemy type (infantry, wheeled, armour, mule).'),
  h2('Draw what the DEM does not show'),
  bullet('**No-Go Area:** click corners of a river, glacier, cliff or minefield; double-click (or Enter) to finish. Backspace removes the last corner, Esc cancels.'),
  bullet('**Track:** click along a road or mule track; double-click to finish. Tracks are always GO and faster.'),
  para('You see the shape while you draw it. Every tool respects these shapes.'),
);

// 7
add(h1('7. Terrain tools'),
  h2('7.1 Go / No-Go (Mobility)'),
  para('Colours every square: **GO** (easy), **SLOW-GO** (hard), **NO-GO** (impossible) for the chosen movement class. It works from slope, snow line, your No-Go areas and tracks.'),
  ...doctrine('mobility'),
  shot('05_mobility', 'Go / No-Go for infantry. The key for the three classes is in the Contents pane.'),
  flow('mobility', 'Go / No-Go.'),
  ...params('mobility'),
  table(['Movement class', 'GO up to', 'SLOW-GO up to', 'Speed (km/h)', 'On tracks (km/h)'],
    P._profiles.map((p) => [p.name, `${p.go}°`, `${p.slow}°`, p.speed, p.road]), [3638, 1300, 1600, 1500, 1600]),
  gap(),
  h2('7.2 Key Terrain'),
  para('Finds **dominating heights** (summits that stand high above the area around them) and **passes / cols** (low points between two heights that lead from one valley to the next).'),
  ...doctrine('keyTerrain'),
  shot('06_key', 'Key terrain: ▲ heights and )( passes.'),
  flow('keyterrain', 'Key Terrain.'),
  ...params('keyTerrain'),
);

// 8
add(h1('8. Visibility tools'),
  h2('8.1 Viewshed and Line of Sight'),
  para('**Viewshed:** shades all ground an observer can see. **Line of Sight:** answers "can A see B?" and draws the ground profile. Both allow for the earth\'s curve and the bending of light in air.'),
  para('**Uphill / downhill fire (GSP Section 18).** Shots fired steeply up or down strike **high**. Line of Sight gives the angle of sight and tells you to set the sight to **slant range ÷ factor**:'),
  table(['Angle up or down', '0°', '10°', '15°', '20°', '25°', '30°', '45°', '60°'], [['Divide range by', '1.00', '1.02', '1.04', '1.06', '1.10', '1.15', '1.41', '2.00']], [2438, 900, 900, 900, 900, 900, 900, 900, 900]),
  gap(),
  ...doctrine('viewshed'),
  flow('visibility', 'Viewshed and Line of Sight.'),
  ...params('viewshed'),
  ...params('los'),
  h2('8.2 Enemy Observation'),
  para('Guesses where the enemy would put his OPs (the high ground near him) and shades all ground they can see. **Clear ground is hidden from the enemy (defilade)** — good for mortars, guns, helipads and covered routes.'),
  ...doctrine('hostile'),
  shot('07_hostile', 'Enemy observation (shaded) and the enemy avenues of approach (dashed).'),
  flow('hostile', 'Enemy Observation.'),
  ...params('hostile'),
  h2('8.3 Avenues of Approach'),
  para('Finds the quickest ways the enemy can reach your position, for his type of movement, and how long each takes.'),
  ...doctrine('avenues'),
  flow('avenues', 'Avenues of Approach.'),
  ...params('avenues'),
);

// 9
add(h1('9. Siting tools'),
  h2('9.1 Posts and OPs'),
  para('Puts posts or OPs on the heights so that, together, they see as much of the enemy\'s likely ground as possible. It also shows **dead ground** (ground in range that no post sees), which posts can see each other, the **defence tier** of each post and the **strong point**.'),
  ...doctrine('posts'),
  shot('08_posts', 'Five suggested posts, their coverage and the result message.'),
  flow('posts', 'Posts and OPs.'),
  ...params('posts'),
  h2('9.2 Weapon Sites'),
  para('Picks positions for one weapon at a time. Run it again for each weapon; each gets its own layer.'),
  bullet('**Direct fire** (MG, HMG, RPG-7, 106 RCL, Baktar-Shikan, TOW): sees the target ground in its range band; prefers fire across the enemy\'s path (enfilade). Ground beyond the mount\'s **up / down limits** is dead to the weapon. Each site shows its arc of fire and **sight setting**.'),
  bullet('**Indirect fire** (60 / 81 / 120 mm mortars, 105 / 122 / 130 / 155 mm guns): behind own troops, in range of the target, able to **clear the crests**, ideally hidden from enemy OPs.'),
  bullet('**Air defence** (Anza, 35 mm): covers the low flying routes along valleys and defiles from dominating ground.'),
  ...doctrine('weapons'),
  shot('09_weapons', 'An MG3 site: arc of fire, mean angle of sight, sight setting and the share of ground dead to the mount limits.'),
  flow('direct', 'direct-fire weapon sites.'),
  flow('indirect', 'indirect-fire (mortar and gun) positions.'),
  ...params('weapons'),
  table(['Weapon', 'Group', 'Range (m)', 'Site slope', 'Mount limits'], P._weapons.map((w) => [w.name, w.group, `${w.minR}–${w.maxR}`, `${w.siteSlope}°`, w.aim || '—']), [3200, 2300, 1500, 1200, 1438]),
  gap(),
  para('All weapon figures are open-source planning values. Change them in **Settings ▸ Weapon data** or in the tool.'),
  h2('9.3 Minefields'),
  para('Finds the **narrowest gaps (defiles)** on the enemy\'s avenues and draws an AT or AP minefield across each, tied into No-Go ground. It counts mines and says if each field is watched by your posts or weapons.'),
  ...doctrine('mfd'),
  shot('10_mfd', 'Suggested anti-tank minefields across the enemy avenues.'),
  flow('mfd', 'Minefields.'),
  ...params('mfd'),
  h2('9.4 Helipad Sites (HLS)'),
  para('Finds flat, hidden places where a helicopter can land, near your position.'),
  ...doctrine('helipads'),
  shot('13_helipads', 'Helipad sites (H) and their details.'),
  flow('helipads', 'Helipad Sites.'),
  ...params('helipads'),
);

// 10
add(h1('10. Movement tools'),
  h2('10.1 Least-Time Route (A to B) and the Route Card'),
  para('Finds the quickest safe path between Start A and End B for the chosen movement class. It knows that walking uphill is slow, steep downhill is slow too, and NO-GO ground is impossible. It can also keep you **out of enemy view**, **off skylines** and **out of nullah beds**.'),
  para('Each route shows: length, climb and descent, steepest part, share in SLOW-GO and in enemy view, the model time and the **GSP time** (day and night). The **Route Card** (bottom dock) lists every leg as in GSP Annex E: start and end reference, magnetic bearing, height at end, height difference, distance and time. Export it as CSV.'),
  ...doctrine('route'),
  shot('11_route', 'Route A→B with checkpoints and the GSP route card in the bottom dock.'),
  flow('route', 'Least-Time Route.'),
  ...params('route'),
  h2('10.2 Route Picquets'),
  para('Puts picquets on the heights that overlook the chosen route, so the column below is safe ("crowning the heights").'),
  ...doctrine('picquets'),
  shot('12_picquets', 'Route picquets on the heights above the route.'),
  flow('picquets', 'Route Picquets.'),
  ...params('picquets'),
  h2('10.3 Fly Route (3D)'),
  para('Flies the camera along the route in the Scene view. Press Esc to stop.'),
  ...params('fly'),
  shot('16_scene', 'The Scene (3D) view.'),
);

// 11
add(h1('11. Layers, tables and saving'),
  h2('Contents pane'),
  bullet('Tick or untick a layer to show or hide it. Click ▸ to open its key.'),
  bullet('Right-click: **Zoom To Layer**, **Attribute Table**, **Transparency**, **Remove**, **Symbology settings**, **Properties**.'),
  bullet('Double-click the height layer to change the base map (shaded relief, height colours, slope, aspect, landforms, ruggedness) and see its statistics.'),
  shot('14_props', 'Layer Properties of the DEM: symbology, data source, coordinate system, extent and statistics.'),
  h2('Attribute table and Attributes pane'),
  bullet('**Attribute table** (Ctrl+T): every planned item, one row each. Choose a layer, filter, sort by clicking a column, click a row to zoom. **Export CSV** saves it.'),
  bullet('**Attributes** pane: everything about the item you clicked, with its position in every coordinate system. Buttons: Copy reference, Zoom to, Viewshed from here.'),
  h2('Saving and sharing (Share tab)'),
  table(['Button', 'Gives you'], [
    ['Save Plan / Open Plan', 'A small .json file with your markers, drawings and results. Open it again later on the same DEM.'],
    ['GeoJSON', 'All features with NATO symbol codes (SIDC) for other GIS or C2 systems.'],
    ['Table (CSV)', 'The attribute table for Excel.'],
    ['Raster', 'Any layer as GeoTIFF or ASCII grid.'],
    ['View (PNG)', 'A picture of the map or the 3D view.'],
    ['Report', 'A printable terrain assessment with maps and every result (Ctrl+P).'],
  ], [3000, 6638]),
  gap(),
);

// 12
add(h1('12. Settings'),
  para('Settings (Ctrl+,) are grouped. Changed settings are marked; you can search, export, import and restore defaults.'),
  table(['Group', 'What you can change'], [
    ['Coordinate systems', 'Analysis UTM zone and hemisphere; second system (Kalianpur etc.) or a custom one.'],
    ['Grid references', 'Main format, number of figures, spacing, lat / long decimals.'],
    ['North reference', 'Grid, true or magnetic; declination and yearly change; mils, degrees or gradians.'],
    ['Units', 'Distance, height, area and time units; vertical datum.'],
    ['Map grids', 'Which grids, their spacing, labels and colours.'],
    ['Map display', 'Base map, hillshade sun direction, contours.'],
    ['Symbology', 'NATO symbol size, colours, labels.'],
    ['Overlays', 'Colours and transparency of the analysis layers.'],
    ['3D view', 'Height exaggeration, mesh detail, light, haze, fly speed.'],
    ['Analysis', 'Earth curve and refraction, observer heights, landform scales, altitude slow-down, route options.'],
    ['Movement classes', 'GO / SLOW-GO slopes and speeds for each class.'],
    ['Weapon data', 'Range, site slope, heights, access and mount limits of each weapon.'],
    ['Data, Report, Interface', 'Import options, report header, theme (dark, light, high contrast, night red), text size.'],
  ], [2800, 6838]),
  gap(),
);

// 13
add(h1('13. Doctrine in MtnAI (GSP Mountain Warfare)'),
  para('These rules from the pamphlet are built into the tools. Help ▸ **Doctrine** shows the same table inside the app.'),
  table(['Subject', 'GSP teaching', 'Where in MtnAI'], [
    ['Planning (Sec 4)', 'Measure distance in time. Map distance + ⅓ ≈ ground distance. Avoid losing height (a 3 km ridge detour beats a 600 m down-and-up). Follow ridges, not gullies. Make a route card.', 'Route: GSP time, nullah penalty, route card. Measure: GSP time.'],
    ['Rate of march (Sec 7, Annex E)', 'Day 3 km/h; night 0.5–1 km/h; add 30–60 min for every 300 m up and every 600 m down.', 'GSP time on every route and route-card leg.'],
    ['Objectives (Sec 4, 7)', 'Seize or hold the dominating heights; objectives on the flanks and rear that dominate the enemy.', 'Key Terrain.'],
    ['Approaches (Sec 7)', 'Valley (obvious, well covered), nullah (infiltration, ambush), ridge line (easy to fight on, hard to supply). Guard every approach.', 'Avenues of Approach.'],
    ['Defence (Sec 12, 13)', 'Hold heights astride and beside the main axis; posts at platoon level; tiered defence (valley, mid slope, ridge); strong point on the most dominating feature; reverse slopes when the forward slope is under fire.', 'Posts: tier and strong point. Enemy Observation.'],
    ['Observation (Sec 4, 22)', 'Dead space at mid ranges. OPs laterally, in depth and at varying heights so cloud cannot blind them all. Voices carry 900 m up: listening posts in valleys.', 'Posts: height tiers, dead ground. Viewshed.'],
    ['Obstacles (Sec 12, 13)', 'Cover gaps with mines, fire and wire; mines thickest in valleys and foothills; mines wash away on slopes and fail in snow and rock: use wire there.', 'Minefields: valley bonus, steep and snow factors, notes.'],
    ['Fire (Sec 18)', 'Up- or downhill fire strikes high: sight = slant range ÷ factor. Plunging fire leaves dead ground. MG mount +6° / −8.5°; 75 mm RR +30° / −5°. Mortars cover dead space.', 'Weapon sites: sight factor, mount limits. LOS: sight setting.'],
    ['Artillery and AD (Sec 22)', 'High-angle weapons beat crests; light guns and mortars on reverse slopes and in valleys; harass passes and defiles. AD covers defiles, gun areas and logistic sites from heights.', 'Indirect fire: crest clearance, defilade. AD air corridors.'],
    ['Advance (Sec 6)', 'The axis runs through valleys and defiles under flanking heights: picquet them for the main body and supply route.', 'Route Picquets.'],
    ['Helicopters (Sec 22)', 'Landing sites ≤ 4° for regular use; emergency 4–10° light and 4–20° cargo. Hide site and approach. Hard ground, rock or grass.', 'Helipad Sites.'],
    ['Animal transport (Annex H)', 'A loaded mule climbs any slope a man can without using his hands; about 16 miles a day, 8 under load; 65 kg in hills.', 'Mule class: SLOW-GO up to 30°.'],
  ], [2300, 4700, 2638]),
  gap(),
  shot('17_doctrine', 'Help ▸ Doctrine inside the app.'),
);

// 14
add(h1('14. Shortcuts and limits'),
  table(['Keys', 'Action'], [
    ['Ctrl+O', 'Add Data'], ['Ctrl+S', 'Save plan'], ['Ctrl+P', 'Report'], ['Ctrl+,', 'Settings'], ['Ctrl+K or /', 'Command search'],
    ['Ctrl+G', 'Go To XY'], ['Ctrl+B', 'Contents pane'], ['Ctrl+T', 'Attribute table'], ['Ctrl+J', 'Bottom dock'], ['2 / 3', 'Map / Scene view'],
    ['F', 'Full extent'], ['+ / −', 'Zoom'], ['M / L / V', 'Measure / Line of Sight / Viewshed'], ['Esc', 'Cancel a tool, drawing or fly-through'], ['F1', 'Help'],
  ], [3000, 6638]),
  gap(),
  h2('Limits'),
  bullet('Results are only as good as the DEM. A 30 m DEM smooths cliffs, narrow nullahs and small features.'),
  bullet('Trees, snow depth, soil, rivers and buildings are not known unless you draw them.'),
  bullet('Weapon and movement figures are planning values. Use your unit\'s current data.'),
  bullet('Every suggestion is a starting point for reconnaissance, not a replacement for it.'),
);

// ------------------------------------------------------------ document
const headingStyle = (id, name) => ({ id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
  run: { font: FONT, size: SIZE, bold: true, color: COLOR }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, keepLines: true } });
const doc = new Document({
  creator: 'MtnAI', title: 'MtnAI User Guide', description: 'MtnAI user guide',
  styles: {
    default: { document: { run: { font: FONT, size: SIZE, color: COLOR } }, heading1: { run: { font: FONT, size: SIZE, bold: true, color: COLOR } } },
    paragraphStyles: [headingStyle('Heading1', 'Heading 1'), headingStyle('Heading2', 'Heading 2'), headingStyle('Heading3', 'Heading 3')],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } }, run: { font: FONT, color: COLOR } } }] },
      ...numberingRefs.map((reference) => ({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } }, run: { font: FONT, color: COLOR } } }] })),
    ],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run('MtnAI User Guide — page '), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SIZE, color: COLOR })] })] }) },
    children: C,
  }],
});
const out = path.join(ROOT, 'docs/guide/MtnAI_User_Guide.docx');
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(out, buf); console.log('wrote', out, `(${Math.round(buf.length / 1024)} KB, ${fig} figures)`); });
