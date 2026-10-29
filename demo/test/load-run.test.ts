// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trimDuckRunForShare } from 'robolance-openlance-hardware/lib/browser/duck-share';
import { encodeShare, trimRunForShare } from 'robolance-openlance-hardware/lib/browser/share-run';
import { duckHeadline, headline, loadRecordText, loadShare, loadStoredShare, runFromRecordText, runFromShare, runSource } from '../src/load-run';

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
    assert.deepEqual(runSource({ hash: '', search: '?s=a8Kx2pQ9zZ' }), { kind: 'stored', id: 'a8Kx2pQ9zZ' }, 'a short link');
    assert.deepEqual(runSource({ hash: '', search: '?s=../etc' }), { kind: 'none' }, 'an id that is not one');
});

test('a short link loads the stored run like a long link', async () => {
    const encoded = await encodeShare(trimRunForShare(runFromRecordText(JSON.stringify(record), '1761566400000-001.json')));
    const asked: string[] = [];
    const fake = (async (url: string) => {
        asked.push(url);
        if (url.endsWith('/gone000000')) {
            return new Response('{"error":"no"}', { status: 404 });
        }
        return new Response(JSON.stringify({ id: 'a8Kx2pQ9zZ', kind: 'arduino', encoded }), { status: 200 });
    }) as unknown as typeof fetch;
    const loaded = await loadStoredShare('a8Kx2pQ9zZ', fake, 'https://api.test/api/v1/public/shared-runs');
    assert.equal(loaded.kind, 'arduino');
    assert.equal(loaded.kind === 'arduino' && loaded.run.trace.arena!.score, 97);
    assert.deepEqual(asked, ['https://api.test/api/v1/public/shared-runs/a8Kx2pQ9zZ']);
    await assert.rejects(loadStoredShare('gone000000', fake, 'https://api.test/x'), /does not exist/);
    const offline = (async () => { throw new TypeError('network'); }) as unknown as typeof fetch;
    await assert.rejects(loadStoredShare('a8Kx2pQ9zZ', offline), /Could not reach OpenLance/);
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

const field = { duck: { x: 0, y: 0, heading: 0 }, ball: { x: 0.5, y: 0.2 }, goal: { x: 0.95, y: 0, width: 0.6 }, bounds: { xMin: -0.4, xMax: 1.3, yMin: -0.7, yMax: 0.7 } };
const duckRecord = {
    version: 1, kind: 'duck', at: '2026-10-28T10:00:00.000Z', missionSha: 'x', mission: 'await duck.kick("right");',
    result: {
        outcome: 'goal', score: 95, scoredAtS: 10.5, simS: 11.5, logs: ['hi'], events: [], notes: ['Goal at 10.5 s. Score 95/100.'],
        kicks: [{ atS: 9, side: 'right', ballForward: 0.07, ballLeft: -0.04, ballMoved: 0.5, ballDirection: -3, goalDirection: -20 }],
        final: { duck: { x: 0.4, y: 0.1, heading: 0 }, ball: { x: 1, y: 0 } }, ballToGoalStart: 0.45, closestBallToGoal: 0,
        field, limitS: 40, path: [[0, 0], [0.4, 0.1]],
        replay: { frameHz: 25, qposSize: 3, frames: [[0, 0, 0.125], [0.01, 0, 0.125], [0.02, 0.001, 0.124], [0.03, 0.002, 0.124]] },
    },
};

test('Microduck runs load from a file and from a share link, and get their own headline', async () => {
    const fromFile = loadRecordText(JSON.stringify(duckRecord), '1761645600000-001.json');
    assert.equal(fromFile.kind, 'duck');
    assert.equal(fromFile.run.stamp, 1761645600000);
    assert.equal(duckHeadline(fromFile.kind === 'duck' ? fromFile.run : (undefined as never)), 'score 95 · goal in 10.5 s · 1 kick');
    assert.throws(() => loadRecordText('{"kind":"duck","result":{}}'), /not a complete Microduck run/);

    const shared = await loadShare(await encodeShare(trimDuckRunForShare(fromFile.run as never)));
    assert.equal(shared.kind, 'duck');
    if (shared.kind === 'duck') {
        assert.equal(shared.run.result.replay!.frames.length, 2, 'one frame in two');
        assert.deepEqual(shared.run.result.replay!.frames[1], [0.02, 0.001, 0.124]);
        assert.equal(shared.run.mission, duckRecord.mission);
    }
    await assert.rejects(loadShare(await encodeShare({ v: 1, kind: 'duck', result: {} })), /no result/);

    const arduino = await loadShare(await encodeShare(trimRunForShare(runFromRecordText(JSON.stringify(record), 'run.json'))));
    assert.equal(arduino.kind, 'arduino', 'Arduino links still load as before');
    assert.equal(loadRecordText(JSON.stringify(record), 'run.json').kind, 'arduino');
});
