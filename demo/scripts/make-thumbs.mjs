// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance
// Draws the Featured runs' gallery thumbnails in a headless browser, the
// same close-up the IDE takes when someone publishes a run, into
// src/thumbs/<id>.jpg, and points featured.json's cards at them. Run from demo/ after `npm run build` in
// packages/openlance-hardware: node scripts/make-thumbs.mjs
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// Playwright is a tool on the machine, not a dependency of the site.
const { chromium } = createRequire(import.meta.url)('playwright');

const dir = mkdtempSync(join(tmpdir(), 'robolance-thumbs-'));
await build({
    entryPoints: ['scripts/thumbs-entry.ts'],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    outfile: join(dir, 'thumbs.js'),
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.json': 'json' },
    logLevel: 'warning',
});
writeFileSync(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><body><script src="thumbs.js"></script>');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', e => console.error(e));
await page.goto(`file://${join(dir, 'index.html')}`);
const thumbs = await page.evaluate(() => window.thumbs);
await browser.close();

mkdirSync('src/thumbs', { recursive: true });
const featured = JSON.parse(readFileSync('src/featured.json', 'utf8'));
for (const card of featured) {
    const thumb = thumbs[card.id];
    if (!thumb) {
        continue;
    }
    writeFileSync(`src/thumbs/${card.id}.jpg`, Buffer.from(thumb.url.split(',')[1], 'base64'));
    card.thumb = `thumbs/${card.id}.jpg`;
    card.summary = { ...card.summary, lengthS: thumb.lengthS };
    console.log(`src/thumbs/${card.id}.jpg`);
}
writeFileSync('src/featured.json', `${JSON.stringify(featured, null, 1)}\n`);
