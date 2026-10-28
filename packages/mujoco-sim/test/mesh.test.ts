// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compact, decimate, meshExtent, meshoptSimplifier } from '../src/index.js';

test('the shape-preserving simplifier keeps a curved shell within its error and drops unused vertices', async () => {
    // A dense hemisphere (radius 5 cm) like a CAD head shell.
    const positions: number[] = [];
    const indices: number[] = [];
    const n = 40;
    for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
            const th = (Math.PI / 2) * (i / n);
            const ph = 2 * Math.PI * (j / n);
            positions.push(0.05 * Math.sin(th) * Math.cos(ph), 0.05 * Math.sin(th) * Math.sin(ph), 0.05 * Math.cos(th));
        }
    }
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const a = i * (n + 1) + j;
            indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
        }
    }
    const simplify = await meshoptSimplifier(0.0005);
    const out = simplify(Float32Array.from(positions), Uint32Array.from(indices));
    assert.ok(out.indices.length < indices.length / 2, `kept ${out.indices.length / 3} of ${indices.length / 3} triangles`);
    assert.ok(Math.max(...out.indices) === out.positions.length / 3 - 1, 'every kept vertex is used');
    for (let v = 0; v < out.positions.length; v += 3) {
        const r = Math.hypot(out.positions[v], out.positions[v + 1], out.positions[v + 2]);
        assert.ok(Math.abs(r - 0.05) < 1e-6, 'vertices stay on the surface');
    }
    assert.equal(meshExtent([0, 0, 0, 0.1, 0.02, 0.03]), 0.1);
    assert.deepEqual(Array.from(compact([0, 0, 0, 1, 1, 1, 2, 2, 2], [2, 0, 2]).indices), [0, 1, 0]);
});

test('decimate merges vertices in one cell and drops collapsed triangles', () => {
    // Two triangles sharing an edge, plus a sliver that collapses at 1 cm.
    const positions = [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0.1, 0.1, 0, 0.1, 0.1, 0.001];
    const out = decimate(positions, [0, 1, 2, 1, 3, 2, 3, 4, 1], 0.01);
    assert.equal(out.indices.length, 6);
    assert.equal(out.positions.length, 12);
});
