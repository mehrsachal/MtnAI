// Loads the browser-style core modules (globalThis.MTN_CORE factories) into Node.
import fs from 'node:fs';
import vm from 'node:vm';

export const CORE_FILES = [
  'core/util', 'core/geo', 'core/grid', 'core/terrain', 'core/mobility', 'core/visibility',
  'core/routing', 'core/weapons', 'core/tactical', 'core/synthetic', 'core/jobs', 'io/dem-io',
];

export function loadCore() {
  globalThis.MTN_CORE = [];
  for (const f of CORE_FILES) {
    const url = new URL(`../../src/${f}.js`, import.meta.url);
    vm.runInThisContext(fs.readFileSync(url, 'utf8'), { filename: url.pathname });
  }
  const M = {};
  for (const factory of globalThis.MTN_CORE) factory(M);
  return M;
}
