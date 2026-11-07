// Dump every geoprocessing tool's parameters (label, default, unit, help) for the user guide.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { loadCore } from '../../test/helpers/load-core.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const M = loadCore();
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.MTN_UI = { M };
for (const f of ['src/ui/settings.js', 'src/ui/gp.js']) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const UI = globalThis.MTN_UI;
const weapon = (id) => M.weapon(id);
UI.app = { weaponOf: weapon, profileOf: (id) => M.MOVEMENT_PROFILES[id] };
const out = {};
for (const [id, t] of Object.entries(UI.GP.TOOLS)) {
  const v = {};
  for (const p of t.params) if (p.k) v[p.k] = typeof p.def === 'function' ? p.def() : p.def;
  if (v.weaponId === undefined && t.params.some((p) => p.k === 'weaponId')) v.weaponId = 'mg3';
  const rows = [];
  for (const p of t.params) {
    if (p.type === 'section') { rows.push({ section: p.label }); continue; }
    if (p.type === 'marker') { rows.push({ label: { own: 'Own position', threat: 'Enemy position', target: 'Target area', a: 'Start A', b: 'End B' }[p.k], def: 'set on the map', marker: true }); continue; }
    let def = typeof p.def === 'function' ? p.def() : p.def;
    if (p.dynamic) def = 'from movement class';
    if (p.weapon) def = 'from weapon data';
    if (Array.isArray(def)) def = def.join(', ');
    if (p.type === 'select') {
      const opts = typeof p.options === 'function' ? p.options() : p.options;
      const o = opts.find(([k]) => String(k) === String(def));
      def = o ? o[1] : def;
    }
    if (p.type === 'checks' && Array.isArray(p.def)) def = p.def.map((i) => ['Valley', 'Lower slope', 'Flat', 'Mid slope', 'Upper slope', 'Ridge'][i]).join(', ');
    if (p.type === 'bool') def = def ? 'Yes' : 'No';
    if (p.type === 'point') def = 'pick on the map';
    if (def === null || def === undefined || def === '') def = '—';
    const only = p.show ? (id === 'weapons' ? (p.k.startsWith('indirect') ? 'indirect fire only' : p.k.startsWith('ad.') ? 'air defence only' : '') : 'only shown for some choices') : '';
    rows.push({ label: p.label, def: `${def}${p.unit && typeof def !== 'string' ? ' ' + p.unit : p.unit && /^[\d.\-]+$/.test(def) ? ' ' + p.unit : ''}`, help: p.help || '', only });
  }
  out[id] = { name: t.name, desc: t.desc, gsp: t.gsp || '', rows };
}
out._weapons = M.WEAPON_GROUPS.flatMap((gr) => gr.ids.map((id) => { const w = M.WEAPONS[id]; return { name: w.name, group: gr.name, minR: w.minR, maxR: w.maxR, siteSlope: w.siteSlope, access: M.MOVEMENT_PROFILES[w.access].name, aim: w.aimUp != null ? `+${w.aimUp}° / −${w.aimDown}°` : '' }; }));
out._profiles = Object.values(M.MOVEMENT_PROFILES).map((p) => ({ name: p.name, go: p.go, slow: p.slow, speed: p.speed, road: p.road }));
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, 'tools');
