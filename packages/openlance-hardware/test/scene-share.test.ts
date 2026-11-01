// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ViewerModel } from 'robolance-duck-sim/viewer';
import { decodeMesh } from 'robolance-duck-sim/viewer';
import type { SceneRunEntry } from '../src/browser/scene-project';
import { decodeShare } from '../src/browser/share-run';
import {
    encodeSceneShare, sceneGallerySummary, sceneRobotName, sharedSceneToEntry, suggestedSceneTitle,
    SCENE_SHARE_MAX_FRAMES, trimSceneRunForShare, validateSharedSceneRun, type SharedSceneRun,
} from '../src/browser/scene-share';
import { meshoptShrinker } from '../src/browser/scene-shrink';

/** A finely tessellated sphere: many triangles on a smooth surface, like a CAD shell. */
function sphereMesh(name: string, n = 120): ViewerModel['meshes'][number] {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
        const th = (i / n) * Math.PI;
        for (let j = 0; j <= n; j++) {
            const ph = (j / n) * 2 * Math.PI;
            pos.push(0.1 * Math.sin(th) * Math.cos(ph), 0.1 * Math.sin(th) * Math.sin(ph), 0.1 * Math.cos(th));
        }
    }
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const a = i * (n + 1) + j;
            idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
        }
    }
    const p = Float32Array.from(pos);
    const ix = Uint16Array.from(idx);
    return {
        name,
        positions: Buffer.from(p.buffer).toString('base64'),
        indices: Buffer.from(ix.buffer).toString('base64'),
        indexType: 'u16',
    };
}

function model(): ViewerModel {
    return {
        version: 1,
        nq: 7,
        bodies: [{ name: 'world', parent: 0, pos: [0, 0, 0], quat: [1, 0, 0, 0], joint: null }, { name: 'pelvis', parent: 0, pos: [0, 0, 0.79], quat: [1, 0, 0, 0], joint: { type: 'free', qpos: 0 } }],
        geoms: [],
        meshes: [sphereMesh('a'), sphereMesh('b'), sphereMesh('c')],
    } as unknown as ViewerModel;
}

function entry(frames = 1201): SceneRunEntry {
    return {
        path: '.robolance/runs/1700000000000.json',
        stamp: 1700000000000,
        at: new Date(1700000000000).toISOString(),
        scene: 'unitree_g1/scene.xml',
        modelPath: '.robolance/models/g1.json',
        controller: 'function control(sim) {}',
        run: {
            outcome: 'done',
            simS: 12,
            frameHz: 100,
            nq: 7,
            frames: Array.from({ length: frames }, (_, i) => [0, 0, 0.79 + i * 1e-6, 1, 0, 0, 0.123456789]),
            metrics: { pelvis_z: Array.from({ length: 1000 }, (_, i) => [i * 0.012, 0.79] as [number, number]) },
            logs: Array.from({ length: 100 }, (_, i) => `log ${i}`),
            check: { ok: true, actuators: ['a'], sensors: [], issues: [] },
        },
    };
}

test('a shared robot run keeps what the replay needs: thinned frames at a matching rate, the model, the last logs', () => {
    const s = trimSceneRunForShare(entry(), model());
    assert.equal(s.kind, 'scene');
    assert.equal(s.run.frames.length, SCENE_SHARE_MAX_FRAMES);
    assert.ok(Math.abs(s.run.frameHz - (SCENE_SHARE_MAX_FRAMES - 1) / 12) < 1e-9, 'frames still span the whole run');
    assert.equal(s.run.frames[0][6], 0.1235, 'values are rounded');
    assert.equal(s.run.metrics.pelvis_z.length, 200);
    assert.equal(s.run.logs.length, 60);
    assert.equal(validateSharedSceneRun(s), undefined);
});

test('a model too large for a link is simplified until it fits, and the replay decodes it', async () => {
    const big = model();
    const plain = await encodeSceneShare(entry(), big);
    const budget = Math.floor(plain.length * 0.6);
    await assert.rejects(encodeSceneShare(entry(), big, undefined, budget), /too detailed to share/);
    const encoded = await encodeSceneShare(entry(), big, meshoptShrinker, budget);
    assert.ok(encoded.length <= budget);
    const shared = await decodeShare(encoded) as SharedSceneRun;
    assert.equal(validateSharedSceneRun(shared), undefined);
    const before = decodeMesh(big.meshes[0]).indices.length;
    const after = decodeMesh(shared.model.meshes[0]).indices.length;
    assert.ok(after < before / 2, `fewer triangles (${before / 3} → ${after / 3})`);
    const { entry: back, model: m } = sharedSceneToEntry(shared);
    assert.equal(back.scene, 'unitree_g1/scene.xml');
    assert.equal(m.meshes.length, 3);
});

test('damaged payloads are refused with a reason', () => {
    const s = trimSceneRunForShare(entry(10), model());
    assert.match(validateSharedSceneRun({ ...s, kind: 'duck' })!, /not a robot run/);
    assert.match(validateSharedSceneRun({ ...s, model: { ...s.model, meshes: 'x' } })!, /model is damaged/);
    assert.match(validateSharedSceneRun({ ...s, run: { ...s.run, frames: [[1, 2]] } })!, /do not fit the robot/);
    assert.match(validateSharedSceneRun({ ...s, run: { ...s.run, frames: [[0, 0, 0, 1, 0, 0, NaN]] } })!, /do not fit the robot/);
});

test('gallery card and title name the robot', () => {
    assert.equal(sceneRobotName('unitree_g1/scene.xml'), 'unitree g1');
    assert.equal(sceneRobotName('arm.xml'), 'arm');
    assert.deepEqual(sceneGallerySummary(entry()), { kind: 'scene', robot: 'unitree g1', outcome: 'done', seconds: 12, score: 100 });
    assert.equal(suggestedSceneTitle(entry()), 'Unitree G1 in the simulator (12 s)');
});
