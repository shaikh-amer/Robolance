// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeShare, trimRunForShare } from 'robolance-openlance-hardware/lib/browser/share-run';
import { headline, runFromRecordText, runFromShare, runSource } from '../src/load-run';

const record = {
    version: 1,
    at: '2026-10-27T12:00:00.000Z',
    sketchSha: 'abc',
    diagram: { parts: [{ type: 'motor', id: 'left', in1: 4, in2: 5, en: 6 }, { type: 'motor', id: 'right', in1: 7, in2: 8, en: 10 }], arena: { preset: 'corner', left: 'left', right: 'right' } },
    durationMs: 2000,
    events: [],
    trace: {
        durationMs: 2000, ranMs: 2000, serial: ['hi'], samples: [], final: {}, notes: ['reached the goal'],
        arena: { path: [{ x: 30, y: 95, headingDeg: 0, atMs: 0 }, { x: 170, y: 25, headingDeg: 0, atMs: 1800 }], events: [], collisions: 0, reachedGoalAtMs: 1800, bestDistanceToGoalCm: 0, finalDistanceToGoalCm: 0, score: 97, state: {} },
    },
};

test('the URL says where the run comes from', () => {
    assert.deepEqual(runSource({ hash: '#r=abc', search: '' }), { kind: 'share', encoded: 'abc' });
    assert.deepEqual(runSource({ hash: '', search: '?run=https%3A%2F%2Fx.test%2Frun.json' }), { kind: 'url', url: 'https://x.test/run.json' });
    assert.deepEqual(runSource({ hash: '#r=abc', search: '?run=x' }), { kind: 'share', encoded: 'abc' }, 'the fragment wins');
    assert.deepEqual(runSource({ hash: '', search: '' }), { kind: 'none' });
});

test('a recorded run file and a shared link both become the run the views replay', async () => {
    const fromFile = runFromRecordText(JSON.stringify(record), '1761566400000-001.json');
    assert.equal(fromFile.stamp, 1761566400000, 'the stamp comes from the file name');
    assert.equal(fromFile.trace.arena!.score, 97);
    const byDate = runFromRecordText(JSON.stringify(record), 'run.json');
    assert.equal(byDate.stamp, Date.parse(record.at), 'else from the record');
    assert.throws(() => runFromRecordText('{"hello":1}'), /not a recorded run/);

    const encoded = await encodeShare(trimRunForShare(fromFile));
    const shared = await runFromShare(encoded);
    assert.equal(shared.trace.arena!.score, 97);
    assert.equal(shared.diagram!.parts.length, 2);
    await assert.rejects(runFromShare('not-base64-deflate'), /does not carry a run/);
    await assert.rejects(runFromShare(await encodeShare({ v: 7 })), /unknown share version/);
});

test('the headline sums up the run', () => {
    const run = runFromRecordText(JSON.stringify(record), 'run.json');
    assert.equal(headline(run), 'score 97 · goal reached in 1.8 s · 0 collisions');
    const bench = runFromRecordText(JSON.stringify({ ...record, diagram: { parts: [] }, trace: { ...record.trace, arena: undefined } }), 'run.json');
    assert.equal(headline(bench), '2.0 s on the bench');
    const lost = runFromRecordText(JSON.stringify({ ...record, trace: { ...record.trace, arena: { ...record.trace.arena, reachedGoalAtMs: null, score: 40, collisions: 1, line: { onLine: false, coverage: 0.5, onLineMs: 900, lostAtMs: 1000 } } } }), 'run.json');
    assert.equal(headline(lost), 'score 40 · goal not reached in 2.0 s · line 50% · 1 collision');
});
