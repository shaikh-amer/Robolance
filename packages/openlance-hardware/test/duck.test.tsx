// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runMission, type MissionResult } from 'robolance-duck-sim';
import { bodyPoses } from 'robolance-duck-sim/viewer';
import { duckModel } from 'robolance-duck-sim/viewer/duck-model';
import { DuckPanel, DuckReadout, DuckRunsView } from '../src/browser/DuckPanel';
import { describeDuckRun, frameAt, isDuckProject, pathUntil, readDuckRuns } from '../src/browser/duck-project';
import { isSharedDuckRun, packFrames, shareDuckRunUrl, sharedDuckRunToRun, trimDuckRunForShare, unpackFrames, validateSharedDuckRun } from '../src/browser/duck-share';
import { HardwarePanel } from '../src/browser/HardwarePanel';
import { decodeShare, parseShareHash } from '../src/browser/share-run';
import { hardwarePreviewTab } from '../src/browser/hardware-preview-tab';

const MISSION = readFileSync(require.resolve('robolance-duck-sim/examples/score-a-goal.js'), 'utf8');
let result: MissionResult;
let files: Map<string, string>;

before(async () => {
    result = await runMission(MISSION);
    files = new Map([
        ['mission.js', MISSION],
        ['.robolance/runs/1761645600000-001.json', JSON.stringify({ version: 1, kind: 'duck', at: '2026-10-28T10:00:00.000Z', missionSha: 'x', mission: MISSION, result })],
        // An Arduino run and a half-written file in the same folder are skipped.
        ['.robolance/runs/1761645500000-001.json', JSON.stringify({ version: 1, durationMs: 10, events: [], trace: { serial: [], samples: [], notes: [], final: {}, ranMs: 10, durationMs: 10 } })],
        ['.robolance/runs/1761645700000-001.json', '{"kind":"duck","result":'],
    ]);
});

test('duck projects are recognised and their runs read, newest first', () => {
    assert.equal(isDuckProject(new Map([['mission.js', '']])), true);
    assert.equal(isDuckProject(new Map([['src/app.tsx', '']])), false);
    assert.equal(isDuckProject(new Map([['node_modules/x/mission.js', '']])), false);
    assert.equal(hardwarePreviewTab.applies(new Map([['mission.js', '']])), true);
    const runs = readDuckRuns(files);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].result.outcome, 'goal');
    assert.match(describeDuckRun(runs[0]), /score \d+ · goal at [\d.]+ s · 1 kick/);
});

test('frames are interpolated between recordings and pose the duck through the viewer model', () => {
    const replay = result.replay!;
    const step = 1000 / replay.frameHz;
    assert.deepEqual(frameAt(result, 0), replay.frames[0]);
    const mid = frameAt(result, step * 10.5)!;
    assert.ok(Math.abs(mid[0] - (replay.frames[10][0] + replay.frames[11][0]) / 2) < 1e-9);
    assert.deepEqual(frameAt(result, 1e9), replay.frames[replay.frames.length - 1], 'past the end holds the last frame');

    const start = bodyPoses(duckModel, frameAt(result, 0)!);
    const trunk = start[duckModel.bodies.findIndex(b => b.name === 'trunk_base')];
    assert.ok(Math.hypot(trunk.pos[0] - result.field.duck.x, trunk.pos[1] - result.field.duck.y) < 0.02);
    assert.ok(trunk.pos[2] > 0.08 && trunk.pos[2] < 0.2, 'standing');
    const ball = start[duckModel.bodies.findIndex(b => b.name === 'football')];
    assert.ok(Math.hypot(ball.pos[0] - result.field.ball.x, ball.pos[1] - result.field.ball.y) < 1e-3);
    assert.equal(pathUntil(result, 0).length, 1);
    assert.ok(pathUntil(result, 2000).length <= 5);
});

test('the Hardware tab shows the pitch for a duck project, and the agent prompt when there are no runs', () => {
    const html = renderToStaticMarkup(<HardwarePanel files={files} theme="dark" openFile={() => undefined} />);
    assert.match(html, /Pitch/);
    assert.match(html, /Runs \(1\)/);
    assert.match(html, /robolance-duck-scene/);
    assert.match(html, /run #1/);
    const empty = renderToStaticMarkup(<DuckPanel files={new Map([['mission.js', '']])} theme="light" askAgent={() => undefined} />);
    assert.match(empty, /Ask the agent to score a goal/);
});

test('the readout says what has happened by the replay time', () => {
    const before = renderToStaticMarkup(<DuckReadout result={result} timeMs={0} />);
    assert.match(before, /0 kicks/);
    assert.doesNotMatch(before, /GOAL/);
    const after = renderToStaticMarkup(<DuckReadout result={result} timeMs={result.simS * 1000} />);
    assert.match(after, /GOAL!/);
    assert.match(after, new RegExp(`score ${result.score}`));
});

test('the runs view lists runs with notes, the mission log and the mission', () => {
    const runs = readDuckRuns(files);
    const html = renderToStaticMarkup(<DuckRunsView runs={runs} selected={0} onSelect={() => undefined} onWatch={() => undefined} />);
    assert.match(html, /Watch this run/);
    assert.match(html, /Goal at/);
    assert.match(html, /attempt 1: lined up/);
    assert.match(html, /The mission this run used/);
});

test('a duck run shares as a link of a few kilobytes and replays from it', async () => {
    const run = readDuckRuns(files)[0];
    const packed = packFrames(result.replay!);
    assert.equal(packed.hz, result.replay!.frameHz / 2, 'one frame in two');
    const back = unpackFrames(packed);
    for (let i = 0; i < back.frames.length; i++) {
        const original = result.replay!.frames[i * 2];
        assert.ok(original.every((v, k) => Math.abs(v - back.frames[i][k]) <= 5e-4 + 1e-9), `frame ${i} within half a thousandth`);
    }

    const url = await shareDuckRunUrl(run, 'https://replay.test/');
    assert.ok(url.length < 24_000, `link is ${url.length} characters`);
    const decoded = await decodeShare(parseShareHash(new URL(url).hash)!);
    assert.equal(isSharedDuckRun(decoded), true);
    assert.equal(validateSharedDuckRun(decoded), undefined);
    const replayed = sharedDuckRunToRun(decoded as ReturnType<typeof trimDuckRunForShare>);
    assert.equal(replayed.result.outcome, 'goal');
    assert.equal(replayed.mission, MISSION);
    const end = frameAt(replayed.result, result.simS * 1000)!;
    const original = result.replay!.frames[result.replay!.frames.length - 1];
    assert.ok(Math.hypot(end[0] - original[0], end[1] - original[1]) < 0.05, 'the duck ends where it ended');

    assert.equal(isSharedDuckRun({ v: 1, trace: {} }), false, 'an Arduino share is not a duck share');
    assert.match(validateSharedDuckRun({ v: 1, kind: 'duck', result: {} }) ?? '', /no result/);
    assert.match(validateSharedDuckRun({ ...trimDuckRunForShare(run), frames: { hz: 12.5, size: 28, scale: 1000, q: [1, 2, 3] } }) ?? '', /damaged/);
    const shared = trimDuckRunForShare(run);
    assert.match(validateSharedDuckRun({ ...shared, result: { ...shared.result, field: { ...shared.result.field, bounds: {} } } }) ?? '', /pitch is damaged/);
});

test('the duck runs view offers a share link unless sharing is off', () => {
    const runs = readDuckRuns(files);
    const on = renderToStaticMarkup(<DuckRunsView runs={runs} selected={0} onSelect={() => undefined} onWatch={() => undefined} />);
    assert.match(on, /Share this run/);
    const off = renderToStaticMarkup(<DuckRunsView runs={runs} selected={0} onSelect={() => undefined} onWatch={() => undefined} shareBase={false} />);
    assert.doesNotMatch(off, /Share this run/);
});
