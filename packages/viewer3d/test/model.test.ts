// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { clipPlanes, fitDistance, narrowHalfAngle } from '../src/model-fit';
import { modelFormat, parseModel } from '../src/model-load';
import { modelStats, statsLine } from '../src/model-stats';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'test', 'fixtures', name));

test('modelFormat knows the formats it opens and nothing else', () => {
    assert.equal(modelFormat('art/Robot.GLB'), 'glb');
    assert.equal(modelFormat('chair.fbx'), 'fbx');
    assert.equal(modelFormat('scene.blend'), undefined);
    assert.equal(modelFormat('notes.txt'), undefined);
});

test('a GLB exported by Blender opens upright with its real triangle count', async () => {
    const model = await parseModel(fixture('monkey-and-box.glb'), 'glb');
    const stats = modelStats(model.root);
    // Blender reported 3936 (subdivided Suzanne) + 12 (box) = 3948 for this scene.
    assert.equal(stats.triangles, 3948);
    assert.equal(stats.meshes, 2);
    assert.ok(stats.materials.length >= 1);
    // Blender is z-up and glTF y-up; upright again here, the box (2 x 4 x 2 m) is 2 m tall.
    assert.ok(Math.abs(stats.size[2] - 2) < 0.05, `height ${stats.size[2]}`);
    assert.ok(stats.size[1] >= 3.9, `depth ${stats.size[1]}`);
});

test('an ASCII STL keeps z up and gets a clay material', async () => {
    const stl = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 0 3
endloop
endfacet
endsolid t`;
    const model = await parseModel(new TextEncoder().encode(stl), 'stl');
    const stats = modelStats(model.root);
    assert.equal(stats.triangles, 1);
    assert.equal(stats.size[2], 3, 'STL is z-up: not rotated');
    assert.deepEqual(stats.materials, ['MeshStandardMaterial']);
});

test('an OBJ is turned upright (y-up to z-up)', async () => {
    const obj = 'v 0 0 0\nv 1 0 0\nv 0 2 0\nf 1 2 3\n';
    const model = await parseModel(new TextEncoder().encode(obj), 'obj');
    const stats = modelStats(model.root);
    assert.equal(stats.triangles, 1);
    assert.ok(Math.abs(stats.size[2] - 2) < 1e-6, `y became z: ${stats.size}`);
});

test('statsLine reads like a person wrote it', () => {
    assert.equal(
        statsLine({ meshes: 2, triangles: 12430, vertices: 7000, drawCalls: 3, materials: ['a', 'b', 'c'], textures: [{ name: 't', width: 2048, height: 1024 }, { name: 'n', width: 512, height: 512 }], animations: 1, size: [1, 1, 1], center: [0, 0, 0] }),
        '12,430 triangles · 3 materials · 2 textures (largest 2048 px) · 1 animation',
    );
    assert.equal(statsLine({ meshes: 1, triangles: 1, vertices: 3, drawCalls: 1, materials: ['m'], textures: [], animations: 0, size: [1, 1, 1], center: [0, 0, 0] }), '1 triangle · 1 material');
});

test('fitting works from a screw to a building', () => {
    for (const radius of [0.005, 1, 250]) {
        const d = fitDistance(radius, 35, 16 / 9);
        // The sphere seen from d fits the vertical half-angle (the narrower one at 16:9).
        assert.ok(Math.asin(radius / d) < narrowHalfAngle(35, 16 / 9), `radius ${radius}`);
        const { near, far } = clipPlanes(d, radius);
        assert.ok(near > 0 && near < d - radius && far > d + radius, `clip for ${radius}`);
    }
    // A tall phone panel is narrower horizontally, so the camera stands further back.
    assert.ok(fitDistance(1, 35, 9 / 16) > fitDistance(1, 35, 16 / 9));
});
