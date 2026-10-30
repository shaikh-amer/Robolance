// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance
// Bundles the replay page and the runs gallery into site/ (what GitHub Pages serves).
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

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
    loader: { '.css': 'css' },
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
    loader: { '.css': 'css', '.json': 'json' },
    logLevel: 'info',
});
cpSync('src/replay.html', 'site/replay/index.html');
cpSync('src/gallery.html', 'site/runs/index.html');
cpSync('src/index.html', 'site/index.html');
