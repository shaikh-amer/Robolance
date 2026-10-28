// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partSurface } from 'robolance-duck-sim/viewer';
import { creasedNormals } from '../src/browser/crease';
import { seededRandom, turfNoise } from '../src/browser/stage-textures';

test('creased normals keep a box hard-edged and a curved shell smooth', () => {
    // A unit cube with 8 shared corners: plain vertex normals would point diagonally.
    const p = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
    const faces = [
        0, 2, 1, 0, 3, 2, // bottom (-z)
        4, 5, 6, 4, 6, 7, // top (+z)
        0, 1, 5, 0, 5, 4, // -y
        2, 3, 7, 2, 7, 6, // +y
        1, 2, 6, 1, 6, 5, // +x
        0, 4, 7, 0, 7, 3, // -x
    ];
    const cube = creasedNormals(p, faces);
    assert.equal(cube.positions.length, faces.length * 3);
    // Every corner of the top face points straight up.
    for (let c = 6; c < 12; c++) {
        assert.deepEqual(Array.from(cube.normals.slice(3 * c, 3 * c + 3)), [0, 0, 1]);
    }

    // A finely tessellated arc: neighbours meet at a few degrees, so normals blend.
    const arc: number[] = [];
    const tris: number[] = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
        const a = (Math.PI / 2) * (i / n);
        arc.push(Math.cos(a), 0, Math.sin(a), Math.cos(a), 1, Math.sin(a));
    }
    for (let i = 0; i < n; i++) {
        tris.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    }
    const smooth = creasedNormals(arc, tris);
    // The shared edge between strip 3 and strip 4 gets the same normal from both sides.
    const fromLeft = Array.from(smooth.normals.slice(9 * 6 + 3, 9 * 6 + 6)); // triangle 6, its second corner (vertex 8)
    const fromRight = Array.from(smooth.normals.slice(9 * 8, 9 * 8 + 3)); // triangle 8, its first corner (vertex 8)
    fromLeft.forEach((v, k) => assert.ok(Math.abs(v - fromRight[k]) < 1e-6));
    // ...and that normal is the arc's own outward direction there.
    const a = (Math.PI / 2) * (4 / n);
    assert.ok(Math.abs(fromLeft[0] * Math.cos(a) + fromLeft[2] * Math.sin(a)) > 0.99);
});

test('turf noise is deterministic, bounded and has blade-like vertical runs', () => {
    const a = turfNoise(64, 64, seededRandom(3));
    const b = turfNoise(64, 64, seededRandom(3));
    assert.deepEqual(a, b, 'the same pitch every time');
    assert.ok(a.every(v => v >= -1 && v <= 1));
    // Vertically neighbouring pixels share most of their blade; horizontal ones do not.
    let vertical = 0;
    let horizontal = 0;
    for (let y = 1; y < 64; y++) {
        for (let x = 1; x < 64; x++) {
            vertical += a[y * 64 + x] * a[(y - 1) * 64 + x];
            horizontal += a[y * 64 + x] * a[y * 64 + x - 1];
        }
    }
    assert.ok(vertical > 3 * Math.abs(horizontal), `vertical ${vertical}, horizontal ${horizontal}`);
});

test('MuJoCo surfaces map to plausible physically based materials', () => {
    const plastic = partSurface({});
    assert.ok(plastic.roughness > 0.3 && plastic.roughness < 0.6 && plastic.metalness === 0, 'defaults read as satin plastic');
    const polished = partSurface({ surface: { specular: 1, shininess: 1, reflectance: 0.9 } });
    assert.ok(polished.roughness < plastic.roughness && polished.metalness === 0.9 && polished.clearcoat > plastic.clearcoat);
    const matte = partSurface({ surface: { specular: 0, shininess: 0, reflectance: 0 } });
    assert.ok(matte.roughness >= 0.85 && matte.clearcoat === 0);
});
