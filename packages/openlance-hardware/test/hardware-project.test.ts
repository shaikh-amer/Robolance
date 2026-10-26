// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeRun, isHardwareProject, poseIndexAt, readHardwareProject, statesAt, type RunEntry } from '../src/browser/hardware-project';

const diagram = { parts: [{ type: 'led', id: 'led1', pin: 13 }] };

function runFile(ranMs: number, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
        version: 1,
        at: '2026-10-26T10:00:00.000Z',
        durationMs: ranMs,
        events: [],
        diagram,
        trace: {
            durationMs: ranMs,
            ranMs,
            serial: ['ready'],
            samples: [
                { atMs: 0, parts: { led1: { on: false } } },
                { atMs: 250, parts: { led1: { on: true } } },
                { atMs: 500, parts: { led1: { on: false } } },
            ],
            final: { led1: { on: true, pin: 13 } },
            notes: [],
            ...extra,
        },
    });
}

test('isHardwareProject looks for a diagram or a sketch anywhere', () => {
    assert.equal(isHardwareProject(new Map([['index.html', '']])), false);
    assert.equal(isHardwareProject(new Map([['/diagram.json', '{}']])), true);
    assert.equal(isHardwareProject(new Map([['firmware/blink.ino', '']])), true);
});

test('readHardwareProject finds the diagram, firmware and runs, newest first', () => {
    const files = new Map<string, string>([
        ['./diagram.json', JSON.stringify(diagram)],
        ['sketch.ino', 'void setup(){} void loop(){}'],
        ['.robolance/firmware.hex', ':00000001FF'],
        ['.robolance/build.json', JSON.stringify({ size: { flashBytes: 1234, ramBytes: 9 } })],
        ['.robolance/runs/1000-001.json', runFile(500)],
        ['.robolance/runs/2000-001.json', runFile(800)],
        ['.robolance/runs/broken.json', '{'],
        ['.robolance/runs/3000-001.json', '{"trace": "nope"}'],
    ]);
    const project = readHardwareProject(files);
    assert.equal(project.diagramPath, 'diagram.json');
    assert.equal(project.sketchPath, 'sketch.ino');
    assert.deepEqual(project.diagram, diagram);
    assert.equal(project.hex, ':00000001FF');
    assert.equal(project.build?.size?.flashBytes, 1234);
    assert.deepEqual(project.runs.map(r => r.path), ['.robolance/runs/2000-001.json', '.robolance/runs/1000-001.json']);
    assert.equal(project.runs[0].stamp, 2000);
    assert.equal(project.runs[0].trace.ranMs, 800);
});

test('a bad diagram is reported instead of shown', () => {
    assert.match(readHardwareProject(new Map([['diagram.json', '{']])).diagramError ?? '', /not valid JSON/);
    assert.equal(readHardwareProject(new Map([['diagram.json', '{"parts": [{"type": "laser", "id": "x"}]}']])).diagramError, 'unknown part type "laser"; use one of led, button, servo, ultrasonic, potentiometer, motor');
});

test('statesAt picks the last sample at or before the time, and the final state at the end', () => {
    const run = readHardwareProject(new Map([['.robolance/runs/1-001.json', runFile(500)]])).runs[0];
    assert.equal(statesAt(run.trace, 0).led1.on, false);
    assert.equal(statesAt(run.trace, 260).led1.on, true);
    assert.equal(statesAt(run.trace, 499).led1.on, true, 'the 250 ms sample still applies at 499 ms');
    assert.equal(statesAt(run.trace, 500).led1.pin, 13);
});

test('poseIndexAt uses timestamps when present and spacing otherwise', () => {
    const stamped = [{ atMs: 0 }, { atMs: 100 }, { atMs: 200 }];
    assert.equal(poseIndexAt(stamped, 150, 1000), 1);
    assert.equal(poseIndexAt(stamped, 5000, 1000), 2);
    const bare = [{}, {}, {}, {}];
    assert.equal(poseIndexAt(bare, 150, 400), 1);
    assert.equal(poseIndexAt(bare, 9999, 400), 3);
    assert.equal(poseIndexAt([], 10, 400), -1);
});

test('describeRun summarises bench and arena runs', () => {
    const bench = readHardwareProject(new Map([['.robolance/runs/1-001.json', runFile(500, { notes: ['led1 never turned on'] })]])).runs[0];
    assert.equal(describeRun(bench), '0.5 s · 1 serial lines · 1 note');
    const arena: RunEntry = { ...bench, trace: { ...bench.trace, arena: { path: [], events: [], collisions: 2, reachedGoalAtMs: null, bestDistanceToGoalCm: 42.5, finalDistanceToGoalCm: 50, score: 31, state: {} } } };
    assert.equal(describeRun(arena), '0.5 s · score 31 · 42.5 cm from goal · 2 collisions');
    const won: RunEntry = { ...arena, trace: { ...arena.trace, arena: { ...arena.trace.arena!, reachedGoalAtMs: 3200, collisions: 1, score: 91 } } };
    assert.equal(describeRun(won), '0.5 s · score 91 · goal at 3.2 s · 1 collision');
});
