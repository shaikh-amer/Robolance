// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import * as React from 'react';
import * as THREE from 'three';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_FIELD, runMission, type MissionResult } from 'robolance-duck-sim';
import { bodyPoses } from 'robolance-duck-sim/viewer';
import { duckModel } from 'robolance-duck-sim/viewer/duck-model';
import { DuckPanel, DuckReadout, DuckRunsView } from '../src/browser/DuckPanel';
import { describeDuckRun, describeDuckSkills, frameAt, isDuckProject, parseDuckRun, pathUntil, readDuckRuns } from '../src/browser/duck-project';
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

test('a run that used the project\'s own policies says which', () => {
    const plain = readDuckRuns(files)[0];
    assert.equal(describeDuckSkills(plain), '', 'built-in skills only');
    const trained = parseDuckRun('.robolance/runs/1.json', 1, JSON.stringify({
        version: 1, kind: 'duck', mission: MISSION, result,
        skills: { walk: { path: 'policies/walk/policy.onnx', sha: 'abc' }, getUp: { path: 'policies/standup/policy.onnx', sha: 'def' } },
    }))!;
    assert.equal(describeDuckSkills(trained), 'walk: policies/walk/policy.onnx · getUp: policies/standup/policy.onnx');
    const html = renderToStaticMarkup(<DuckRunsView runs={[trained]} selected={0} onSelect={() => undefined} onWatch={() => undefined} />);
    assert.match(html, /Trained policies from the project: walk: policies\/walk\/policy\.onnx/);
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

test('the player takes the preview\'s Desktop / Tablet / Phone size, and only the player', () => {
    const desktop = renderToStaticMarkup(<HardwarePanel files={files} theme="dark" />);
    assert.match(desktop, /class="robolance-duck-wrap robolance-player" data-viewport="desktop"/);
    const phone = renderToStaticMarkup(<HardwarePanel files={files} theme="dark" viewport="mobile" />);
    assert.match(phone, /class="robolance-duck-wrap robolance-player" data-viewport="mobile"/);
    // The toolbar and the scrubber keep the panel's width: one sized element.
    assert.equal(phone.match(/data-viewport=/g)?.length, 1);
    const css = readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'browser', 'style', 'hardware.css'), 'utf8');
    assert.match(css, /\.robolance-player\[data-viewport="tablet"\] \{\s*max-width: 768px;/);
    assert.match(css, /\.robolance-player\[data-viewport="mobile"\] \{\s*max-width: 390px;/);
    // GPU-drawn canvases ignore overflow + radius in Chrome: the corners need clip-path.
    assert.match(css, /clip-path: inset\(0 round 8px\)/);
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
    const withBox = (o: Record<string, unknown>) => ({ ...shared, result: { ...shared.result, field: { ...shared.result.field, obstacles: [o] } } });
    assert.equal(validateSharedDuckRun(withBox({ name: 'box', x: 0.3, y: -0.3, width: 0.2, depth: 0.2, height: 0.2, heading: 10 })), undefined, 'a shared obstacle replays');
    assert.match(validateSharedDuckRun(withBox({ x: 0.3, y: -0.3, width: 900, depth: 0.2, height: 0.2 })) ?? '', /obstacles are damaged/);
    assert.match(validateSharedDuckRun(withBox({ x: 'a', y: 0, width: 0.2, depth: 0.2, height: 0.2 })) ?? '', /obstacles are damaged/);
    const withLaptop = (l: Record<string, unknown>) => ({ ...shared, result: { ...shared.result, field: { ...shared.result.field, laptop: l } } });
    assert.equal(validateSharedDuckRun(withLaptop({ x: 0.75, y: 0, heading: 0, openDeg: 100 })), undefined, 'a shared laptop replays');
    assert.match(validateSharedDuckRun(withLaptop({ x: 0.75, y: 0, heading: 0, openDeg: 400 })) ?? '', /laptop is damaged/);
    assert.match(validateSharedDuckRun(withLaptop({ x: 0.75, y: null, heading: 0 })) ?? '', /laptop is damaged/);
});

test('the duck runs view offers a share link unless sharing is off', () => {
    const runs = readDuckRuns(files);
    const on = renderToStaticMarkup(<DuckRunsView runs={runs} selected={0} onSelect={() => undefined} onWatch={() => undefined} />);
    assert.match(on, /Share this run/);
    const off = renderToStaticMarkup(<DuckRunsView runs={runs} selected={0} onSelect={() => undefined} onWatch={() => undefined} shareBase={false} />);
    assert.doesNotMatch(off, /Share this run/);
});

test('Watch this run and Share this run sit in one row', () => {
    const runs = readDuckRuns(files);
    const html = renderToStaticMarkup(<DuckRunsView runs={runs} selected={0} onSelect={() => undefined} onWatch={() => undefined} />);
    assert.match(html, /<div class="robolance-run-actions"><button[^>]*>Watch this run<\/button><div class="robolance-share">/);
    const css = readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'browser', 'style', 'hardware.css'), 'utf8');
    assert.match(css, /\.robolance-run-actions \{\s*display: flex;\s*flex-wrap: nowrap;/);
    // Status colours come from the IDE theme, not fixed hex values.
    assert.doesNotMatch(css, /^\s*(color|background|fill|stroke): (#[0-9a-f]{3,6}|rgba?\([^)]*\));/im);
});

test('a duck colour paints the shell and leaves the dark parts and trim alone', async () => {
    const { RobotParts, isShell } = await import('../src/browser/robot-parts');
    const parts = new RobotParts(duckModel);
    const colours = () => {
        const seen = new Map<unknown, string>();
        parts.group.traverse(o => { const m = (o as { material?: { color?: { getHexString(): string } } }).material; if (m?.color) seen.set(m, m.color.getHexString()); });
        return [...seen.values()];
    };
    const before = colours();
    const shells = before.filter(h => isShell(new THREE.Color('#' + h)));
    assert.ok(shells.length > 0 && shells.length < before.length, 'the duck has both shell and other parts');
    parts.paint('#f5c400');
    const painted = colours();
    const yellow = new THREE.Color('#f5c400').getHexString();
    assert.equal(painted.filter(h => h === yellow).length, shells.length, 'every shell part is painted');
    assert.deepEqual(painted.filter(h => h !== yellow).sort(), before.filter(h => !isShell(new THREE.Color('#' + h))).sort(), 'other parts keep their colour');
    parts.paint(undefined);
    assert.deepEqual(colours().sort(), before.sort(), 'no colour gives the model colours back');
    parts.paint('javascript:alert(1)');
    assert.deepEqual(colours().sort(), before.sort(), 'a value that is not #rrggbb is ignored');
    parts.dispose();
});

test('room.logos puts posters on the far wall, marks on the laptop and a sticker on the duck', async () => {
    const { RobotParts } = await import('../src/browser/robot-parts');
    const { stickerMaterial, posterMaterial, lidMaterial } = await import('../src/browser/brand-marks');
    const { LaptopModel } = await import('../src/browser/laptop-model');
    // Without a document the materials are plain but still materials: the viewers never crash headless.
    for (const m of [stickerMaterial(), posterMaterial('meta'), posterMaterial('openlance'), lidMaterial()]) {
        assert.ok(m instanceof THREE.Material);
    }
    const parts = new RobotParts(duckModel);
    const discs = () => parts.group.children.filter(o => (o as THREE.Mesh).geometry instanceof THREE.CircleGeometry) as THREE.Mesh[];
    assert.equal(discs().length, 0);
    parts.sticker(stickerMaterial());
    assert.equal(discs().length, 2, 'one sticker on each flank');
    // Posed with the trunk: both discs sit the same distance from the trunk, on opposite sides.
    const poses = parts.pose(new Array(duckModel.nq).fill(0));
    assert.ok(poses);
    const trunk = new THREE.Vector3(...poses![1].pos);
    const dists = discs().map(d => d.position.distanceTo(trunk));
    assert.ok(Math.abs(dists[0] - dists[1]) < 1e-6 && dists[0] > 0.05 && dists[0] < 0.06, `symmetric stickers, got ${dists}`);
    const ys = discs().map(d => d.position.y - trunk.y);
    assert.ok(ys[0] * ys[1] < 0, 'one on each side');
    parts.sticker(undefined);
    assert.equal(discs().length, 0);
    parts.dispose();
    const plain = new LaptopModel({ x: 0, y: 0, heading: 0 });
    const branded = new LaptopModel({ x: 0, y: 0, heading: 0 }, { logos: true });
    const meshes = (g: THREE.Object3D) => { let n = 0; g.traverse((o: THREE.Object3D) => { if ((o as THREE.Mesh).isMesh) { n++; } }); return n; };
    assert.equal(meshes(branded.group), meshes(plain.group) + 1, 'the branded lid has one extra face: the marks on its outside');
    plain.dispose(); branded.dispose();
});

test('room.logos hangs an OpenLance and a Meta poster on the far wall, facing into the room', async () => {
    const { wallPosters } = await import('../src/browser/duck-stage');
    const field = { ...DEFAULT_FIELD, bounds: { xMin: -0.5, xMax: 3, yMin: -1.5, yMax: 1.5 }, room: { floor: 'wood' as const, logos: true } };
    const meshes = wallPosters(field as Parameters<typeof wallPosters>[0]);
    assert.equal(meshes.length, 4, 'two frames and two prints');
    const prints = meshes.filter(m => m.geometry instanceof THREE.PlaneGeometry);
    assert.equal(prints.length, 2);
    for (const print of prints) {
        assert.ok(print.position.x > 2.9 && print.position.x < 3.05, 'on the wall at the far end of the room');
        assert.ok(Math.abs(print.position.z - 1.45) < 0.01, 'hung at eye height');
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(print.quaternion);
        assert.ok(normal.x < -0.99, `the print faces into the room, not into the wall (normal ${normal.toArray().map(v => v.toFixed(2))})`);
    }
    const ys = prints.map(p => p.position.y).sort((a, b) => a - b);
    assert.ok(ys[1] - ys[0] > 0.6, 'the two posters hang side by side, not on top of each other');
});
