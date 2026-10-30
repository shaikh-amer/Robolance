// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance
// Bundles the replay page and the runs gallery into site/ (what GitHub Pages serves).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('site/replay', { recursive: true });
mkdirSync('site/runs', { recursive: true });
await build({
    entryPoints: ['src/replay.tsx'],
    bundle: true,
    minify: true,
    sourcemap: true,
    format: 'iife',
    target: 'es2020',
    outfile: 'site/replay/replay.js',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'css', '.svg': 'text' },
    logLevel: 'info',
});
await build({
    entryPoints: ['src/gallery.tsx'],
    bundle: true,
    minify: true,
    sourcemap: true,
    format: 'iife',
    target: 'es2020',
    outfile: 'site/runs/gallery.js',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'css', '.json': 'json', '.svg': 'text' },
    logLevel: 'info',
});
cpSync('src/replay.html', 'site/replay/index.html');
cpSync('src/gallery.html', 'site/runs/index.html');
cpSync('src/site.css', 'site/site.css');
// The home page is plain HTML; its header gets the same OpenLance mark the bundles carry.
const mark = readFileSync('src/openlance-mark.svg', 'utf8').trim();
writeFileSync('site/index.html', readFileSync('src/index.html', 'utf8').replace('<!--OPENLANCE_MARK-->', mark));
