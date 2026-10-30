/*
 * MtnAI core — weapon planning data (Pakistan Army inventory, open-source figures).
 *
 * Ranges are INDICATIVE planning values from public sources and are editable in
 * the UI. Always confirm with the unit's current weapon data before use.
 *   cat:     direct | indirect | ad
 *   role:    pers (anti-personnel) | veh (anti-armour) | air
 *   minR / maxR (m): engagement band used for siting; obsH / tgtH (m AGL)
 *   siteSlope: max ground slope (deg) for the weapon position
 *   access:  movement class that must be able to reach the site from own position
 *   angle:   low | high | both (indirect fire trajectory groups)
 *   elev:    [min, max] barrel elevation (deg) for indirect weapons
 *   icon:    APP-6D land-equipment icon key; rng: range amplifier bars (1-3)
 */
(globalThis.MTN_CORE = globalThis.MTN_CORE || []).push(function weapons(M) {
  'use strict';

  M.WEAPONS = {
    // ---------------- direct fire, anti-personnel
    mg3: { id: 'mg3', name: '7.62 mm MG3 GPMG (SF role)', short: 'MG3', cat: 'direct', role: 'pers', minR: 0, maxR: 1200, obsH: 0.6, tgtH: 1.0, siteSlope: 30, access: 'foot', enfilade: 1, icon: 'mg', rng: 2 },
    hmg: { id: 'hmg', name: '12.7 mm HMG (Type 54 / W-85)', short: 'HMG', cat: 'direct', role: 'pers', minR: 0, maxR: 1600, obsH: 0.8, tgtH: 1.5, siteSlope: 25, access: 'mule', enfilade: 0.8, icon: 'mg', rng: 3 },
    // ---------------- direct fire, anti-armour
    rpg7: { id: 'rpg7', name: 'RPG-7 (AT rocket launcher)', short: 'RPG-7', cat: 'direct', role: 'veh', minR: 30, maxR: 300, obsH: 0.8, tgtH: 2.4, siteSlope: 35, access: 'foot', enfilade: 0.5, icon: 'atrl', rng: 1 },
    rcl106: { id: 'rcl106', name: '106 mm RCL (M40)', short: '106 RCL', cat: 'direct', role: 'veh', minR: 50, maxR: 1100, obsH: 1.0, tgtH: 2.4, siteSlope: 12, access: 'jeep', enfilade: 0.5, icon: 'rcl', rng: 2 },
    baktar: { id: 'baktar', name: 'Baktar-Shikan ATGM', short: 'BKT-SKN', cat: 'direct', role: 'veh', minR: 100, maxR: 3000, obsH: 0.8, tgtH: 2.4, siteSlope: 20, access: 'mule', enfilade: 0.5, icon: 'atgm', rng: 2 },
    tow: { id: 'tow', name: 'TOW-2A ATGM', short: 'TOW', cat: 'direct', role: 'veh', minR: 65, maxR: 3750, obsH: 1.0, tgtH: 2.4, siteSlope: 15, access: 'jeep', enfilade: 0.5, icon: 'atgm', rng: 3 },
    // ---------------- indirect fire
    mor60: { id: 'mor60', name: '60 mm light mortar', short: '60 MOR', cat: 'indirect', minR: 100, maxR: 2500, siteSlope: 15, access: 'foot', angle: 'high', elev: [45, 85], icon: 'mortar', rng: 1 },
    mor81: { id: 'mor81', name: '81 mm mortar', short: '81 MOR', cat: 'indirect', minR: 100, maxR: 5600, siteSlope: 12, access: 'mule', angle: 'high', elev: [45, 85], icon: 'mortar', rng: 2 },
    mor120: { id: 'mor120', name: '120 mm mortar', short: '120 MOR', cat: 'indirect', minR: 450, maxR: 7200, siteSlope: 10, access: 'jeep', angle: 'high', elev: [45, 85], icon: 'mortar', rng: 3 },
    m56: { id: 'm56', name: '105 mm M56 pack howitzer (mountain arty)', short: '105 PACK', cat: 'indirect', minR: 1000, maxR: 10500, siteSlope: 10, access: 'mule', angle: 'both', elev: [-5, 65], icon: 'how', rng: 1 },
    t541: { id: 't541', name: '122 mm Type 54-1 howitzer', short: '122 HOW', cat: 'indirect', minR: 2000, maxR: 11800, siteSlope: 8, access: 'truck', angle: 'both', elev: [-3, 63], icon: 'how', rng: 2 },
    t591: { id: 't591', name: '130 mm Type 59-1 field gun', short: '130 GUN', cat: 'indirect', minR: 3000, maxR: 27000, siteSlope: 6, access: 'truck', angle: 'low', elev: [-2, 45], icon: 'how', rng: 3 },
    m198: { id: 'm198', name: '155 mm M198 howitzer', short: '155 HOW', cat: 'indirect', minR: 2500, maxR: 22400, siteSlope: 6, access: 'truck', angle: 'both', elev: [-5, 72], icon: 'how', rng: 3 },
    // ---------------- air defence (target = helicopter flying ~100 m above ground)
    anza2: { id: 'anza2', name: 'Anza Mk-II MANPADS', short: 'ANZA-II', cat: 'ad', role: 'air', minR: 500, maxR: 5000, obsH: 1.8, tgtH: 100, siteSlope: 35, access: 'foot', icon: 'sam', rng: 1 },
    anza3: { id: 'anza3', name: 'Anza Mk-III MANPADS', short: 'ANZA-III', cat: 'ad', role: 'air', minR: 500, maxR: 6000, obsH: 1.8, tgtH: 100, siteSlope: 35, access: 'foot', icon: 'sam', rng: 1 },
    gdf35: { id: 'gdf35', name: '35 mm Oerlikon GDF twin AD gun', short: '35 AD', cat: 'ad', role: 'air', minR: 0, maxR: 4000, obsH: 2.5, tgtH: 100, siteSlope: 8, access: 'truck', icon: 'adgun', rng: 2 },
  };

  M.WEAPON_GROUPS = [
    { name: 'Direct fire — anti-personnel', ids: ['mg3', 'hmg'] },
    { name: 'Direct fire — anti-armour', ids: ['rpg7', 'rcl106', 'baktar', 'tow'] },
    { name: 'Indirect fire — mortars', ids: ['mor60', 'mor81', 'mor120'] },
    { name: 'Indirect fire — artillery', ids: ['m56', 't541', 't591', 'm198'] },
    { name: 'Air defence', ids: ['anza2', 'anza3', 'gdf35'] },
  ];

  M.weapon = (id, overrides) => Object.assign({}, M.WEAPONS[id], overrides || {});
});
