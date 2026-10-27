// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunEntry } from '../src/browser/hardware-project';
import { decodeShare, encodeShare, parseShareHash, sharedRunToEntry, shareRunUrl, thinPath, trimRunForShare, validateSharedRun } from '../src/browser/share-run';

function bigRun(): RunEntry {
    const path = Array.from({ length: 4000 }, (_, i) => ({ x: 30 + i / 40, y: 95, headingDeg: 0, atMs: i * 5 }));
    const samples = Array.from({ length: 400 }, (_, i) => ({ atMs: i * 50, parts: { left: { speed: 1 }, right: { speed: 1 }, eyes: { distanceCm: 100 - i / 4 } } }));
    return {
        path: '.robolance/runs/1700000000000.json',
        stamp: 1700000000000,
        at: new Date(1700000000000).toISOString(),
        sketchSha: 'abc',
        diagram: { parts: [{ type: 'motor', id: 'left', in1: 4, in2: 5, en: 6 }, { type: 'motor', id: 'right', in1: 7, in2: 8, en: 10 }], arena: { preset: 'corner', left: 'left', right: 'right' } },
        durationMs: 20000,
        events: [{ atMs: 100, action: 'set', part: 'eyes', value: 40 }],
        trace: {
            durationMs: 20000,
            ranMs: 20000,
            serial: Array.from({ length: 500 }, (_, i) => `cm=${i}`),
            samples,
            final: { left: { speed: 1 } },
            notes: ['the robot reached the goal'],
            arena: { path, events: [{ atMs: 1500, kind: 'collision', pose: { x: 45, y: 95, headingDeg: 0 } }], collisions: 1, reachedGoalAtMs: 18000, bestDistanceToGoalCm: 0, finalDistanceToGoalCm: 0, score: 83, state: {} },
        },
    };
}

test('a shared run keeps what the replay needs and drops the rest', () => {
    const shared = trimRunForShare(bigRun());
    assert.equal(shared.v, 1);
    assert.equal(shared.trace.samples!.length, 120, 'part samples are thinned, so the circuit replays over time');
    assert.deepEqual(shared.trace.samples![0], bigRun().trace.samples[0]);
    assert.deepEqual(shared.trace.samples![119], bigRun().trace.samples[399], 'the last sample is kept');
    assert.equal(trimRunForShare({ ...bigRun(), trace: { ...bigRun().trace, samples: [] } }).trace.samples, undefined, 'no samples, nothing carried');
    assert.equal(shared.trace.arena!.path.length, 600, 'the path is thinned');
    assert.deepEqual(shared.trace.arena!.path[0], { x: 30, y: 95, headingDeg: 0, atMs: 0 });
    assert.deepEqual(shared.trace.arena!.path[599], { x: 30 + 3999 / 40, y: 95, headingDeg: 0, atMs: 3999 * 5 }, 'the last pose is kept');
    assert.equal(shared.trace.serial.length, 200, 'serial keeps its tail');
    assert.equal(shared.trace.serial[199], 'cm=499');
    assert.equal(shared.trace.arena!.score, 83);
    assert.deepEqual(shared.diagram, bigRun().diagram);
    assert.equal(validateSharedRun(shared), undefined);
});

test('thinPath keeps the ends and spaces the rest evenly', () => {
    assert.deepEqual(thinPath([1, 2, 3], 5), [1, 2, 3]);
    assert.deepEqual(thinPath([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3), [0, 5, 10]);
    assert.deepEqual(thinPath([0, 1, 2], 1), [0, 1, 2], 'fewer than two poses asked: unchanged');
});

test('a run survives the link: deflated into the fragment and back', async () => {
    const run = bigRun();
    const url = await shareRunUrl(run, 'https://example.test/replay/');
    assert.ok(url.startsWith('https://example.test/replay/#r='));
    assert.ok(url.length < 20000, `the link stays short: ${url.length}`);
    const encoded = parseShareHash(new URL(url).hash)!;
    assert.doesNotMatch(encoded, /[+/=]/, 'base64url, safe in a fragment');
    const decoded = await decodeShare(encoded);
    assert.equal(validateSharedRun(decoded), undefined);
    const entry = sharedRunToEntry(decoded as never);
    assert.equal(entry.stamp, 1700000000000);
    assert.equal(entry.trace.arena!.score, 83);
    assert.equal(entry.trace.samples.length, 120);
    assert.deepEqual(sharedRunToEntry({ ...trimRunForShare(run), trace: { ...trimRunForShare(run).trace, samples: undefined } }).trace.samples, [], 'an older link without samples still opens');
    assert.equal(entry.trace.arena!.path.length, 600);
    assert.equal(entry.diagram!.parts.length, 2);
    assert.deepEqual(entry.events, run.events);
});

test('the fragment parser and the validator reject what is not a run', async () => {
    assert.equal(parseShareHash('#x=1&r=abc'), 'abc');
    assert.equal(parseShareHash('r=abc'), 'abc');
    assert.equal(parseShareHash('#r='), undefined);
    assert.equal(parseShareHash('#other=1'), undefined);
    assert.equal(validateSharedRun(null), 'not an object');
    assert.equal(validateSharedRun({ v: 2 }), 'unknown share version 2');
    assert.equal(validateSharedRun({ v: 1 }), 'the run has no trace');
    assert.equal(validateSharedRun({ v: 1, trace: { serial: [], notes: [], arena: {} } }), 'the arena trace has no path');
    const roundTrip = await decodeShare(await encodeShare({ hello: 'wörld' }));
    assert.deepEqual(roundTrip, { hello: 'wörld' });
});
