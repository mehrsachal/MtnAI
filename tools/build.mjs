#!/usr/bin/env node
/*
 * Builds dist/MtnAI.html — the whole application in ONE self-contained HTML file
 * (CSS and every script inlined). Copy it to any computer and double-click: it
 * runs fully offline with no installation, server or internet connection.
 *
 *   node tools/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let html = read('index.html');
const pkg = JSON.parse(read('package.json'));

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>\n${read(href)}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
  `<script>/* ${src} */\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`);
html = html.replace('<head>', `<head>\n<!-- MtnAI ${pkg.version} — single-file offline build generated ${new Date().toISOString().slice(0, 10)} -->`);

if (/<script src=|<link rel="stylesheet" href=/.test(html)) throw new Error('Unresolved external reference left in build output.');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'MtnAI.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
