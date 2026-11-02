// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Run from demo/ (npm test); the sources the build copies to the site root.
const src = (p: string) => join(process.cwd(), 'src', p);
const manifest = JSON.parse(readFileSync(src('pwa/manifest.webmanifest'), 'utf8'));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
    const b = readFileSync(file);
    assert.equal(b.toString('ascii', 1, 4), 'PNG', `${file} is a PNG`);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('the site installs as the ROBOLANCE app, without the browser bar', () => {
    assert.equal(manifest.name, 'ROBOLANCE');
    assert.equal(manifest.short_name, 'ROBOLANCE');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
});

test('the manifest icons exist at the sizes it declares, including a maskable one', () => {
    for (const icon of manifest.icons) {
        const [w, h] = icon.sizes.split('x').map(Number);
        assert.deepEqual(pngSize(src('pwa/' + icon.src.replace('/icons/', ''))), [w, h], icon.src);
    }
    assert.ok(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512'));
    assert.ok(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable'));
});

test('every page links the manifest and registers the service worker', () => {
    for (const page of ['index.html', 'replay.html', 'gallery.html']) {
        const html = readFileSync(src(page), 'utf8');
        assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/, page);
        assert.match(html, /serviceWorker\.register\('\/sw\.js'\)/, page);
        assert.match(html, /apple-mobile-web-app-title" content="ROBOLANCE"/, page);
    }
});

test('the service worker only answers page loads, so runs and the API are never served stale', () => {
    const sw = readFileSync(src('pwa/sw.js'), 'utf8');
    assert.match(sw, /req\.mode !== 'navigate'/);
    assert.match(sw, /fetch\(req\)\.then/, 'pages come from the network first');
});
