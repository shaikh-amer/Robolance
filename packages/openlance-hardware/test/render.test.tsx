// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cornerMaze } from '@robolance/hardware-sim';
import { ArenaView } from '../src/browser/ArenaView';
import { describeState } from '../src/browser/CircuitView';
import { HardwarePanelBody } from '../src/browser/HardwarePanel';
import { hardwarePreviewTab } from '../src/browser/hardware-preview-tab';
import { readHardwareProject } from '../src/browser/hardware-project';
import { RunsView } from '../src/browser/RunsView';

const robotDiagram = {
    parts: [
        { type: 'motor', id: 'left', in1: 4, in2: 5, en: 6 },
        { type: 'motor', id: 'right', in1: 7, in2: 8, en: 10 },
        { type: 'ultrasonic', id: 'eyes', trig: 12, echo: 11 },
    ],
    arena: { preset: 'corner', left: 'left', right: 'right', sensor: 'eyes' },
};

function arenaRun(score: number, stamp: number): [string, string] {
    return [`.robolance/runs/${stamp}-001.json`, JSON.stringify({
        version: 1,
        at: new Date(stamp).toISOString(),
        durationMs: 2000,
        events: [],
        diagram: robotDiagram,
        trace: {
            durationMs: 2000,
            ranMs: 2000,
            serial: ['cm=100', 'cm=80'],
            samples: [{ atMs: 0, parts: { left: { speed: 0 }, right: { speed: 0 }, eyes: { distanceCm: 100 } } }, { atMs: 1000, parts: { left: { speed: 1 }, right: { speed: 1 }, eyes: { distanceCm: 60 } } }],
            final: { left: { speed: 1 }, right: { speed: 1 }, eyes: { distanceCm: 40 } },
            notes: ['the robot did not reach the goal; it got within 90 cm, with 1 collision(s)'],
            arena: {
                path: [{ x: 30, y: 95, headingDeg: 0, atMs: 0 }, { x: 40, y: 95, headingDeg: 0, atMs: 1000 }, { x: 50, y: 95, headingDeg: 10, atMs: 2000 }],
                events: [{ atMs: 1500, kind: 'collision', pose: { x: 45, y: 95, headingDeg: 0 } }],
                collisions: 1,
                reachedGoalAtMs: null,
                bestDistanceToGoalCm: 90,
                finalDistanceToGoalCm: 95,
                score,
                state: {},
            },
        },
    })];
}

test('ArenaView draws walls, goal, path, collisions and the robot', () => {
    const html = renderToStaticMarkup(<ArenaView spec={cornerMaze()} path={[{ x: 30, y: 95, headingDeg: 0 }, { x: 50, y: 95, headingDeg: 45 }]} events={[{ atMs: 1, kind: 'collision', pose: { x: 40, y: 95, headingDeg: 0 } }]} distanceAheadCm={30} />);
    assert.equal((html.match(/robolance-arena-wall/g) ?? []).length, 6);
    assert.match(html, /robolance-arena-goal/);
    assert.match(html, /points="30.0,95.0 50.0,95.0"/);
    assert.match(html, /robolance-arena-collision/);
    assert.match(html, /robolance-arena-ray/);
    assert.match(html, /translate\(50 95\)/);
});

test('RunsView lists runs newest first with scores and a chart when there are several', () => {
    const project = readHardwareProject(new Map([arenaRun(21, 1000), arenaRun(64, 2000)]));
    const html = renderToStaticMarkup(<RunsView runs={project.runs} selected={0} onSelect={() => undefined} />);
    assert.match(html, /robolance-score-chart/);
    assert.ok(html.indexOf('>64<') < html.indexOf('>21<'), 'newest run first');
    assert.match(html, /aria-current="true"/);
    assert.match(html, /cm=100\ncm=80/);
    assert.match(html, /did not reach the goal/);
});

test('HardwarePanel renders the arena of the newest run at its end, and the empty states', () => {
    const files = new Map<string, string>([['diagram.json', JSON.stringify(robotDiagram)], ['.robolance/firmware.hex', ':00000001FF'], arenaRun(33, 5000)]);
    const project = readHardwareProject(files);
    const html = renderToStaticMarkup(<HardwarePanelBody project={project} context={{ files, theme: 'dark' }} />);
    assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>Arena</);
    assert.match(html, /Runs \(1\)/);
    assert.match(html, /score 33/);
    assert.match(html, /1 collision</);
    assert.match(html, /Go live/);
    assert.doesNotMatch(html, /disabled=""[^>]*>Go live/, 'live mode is offered when firmware exists');

    const empty = renderToStaticMarkup(<HardwarePanelBody project={readHardwareProject(new Map([['sketch.ino', '']]))} context={{ files: new Map(), theme: 'light', askAgent: () => undefined }} />);
    assert.match(empty, /No <code>diagram.json<\/code> yet/);
    assert.match(empty, /Ask the agent to build/);

    const broken = renderToStaticMarkup(<HardwarePanelBody project={readHardwareProject(new Map([['diagram.json', '{']]))} context={{ files: new Map(), theme: 'light' }} />);
    assert.match(broken, /not valid JSON/);
});

test('the preview tab applies to hardware projects only', () => {
    assert.equal(hardwarePreviewTab.id, 'hardware');
    assert.equal(hardwarePreviewTab.applies(new Map([['src/app.tsx', '']])), false);
    assert.equal(hardwarePreviewTab.applies(new Map([['sketch.ino', '']])), true);
});

test('describeState words each part', () => {
    assert.equal(describeState({ type: 'led', id: 'l', pin: 13 }, { on: true, brightness: 0.25 }), 'on 25%');
    assert.equal(describeState({ type: 'motor', id: 'm', in1: 1, in2: 2, en: 3 }, { speed: -0.5 }), 'backward 50%');
    assert.equal(describeState({ type: 'servo', id: 's', pin: 9 }, { angle: null }), 'no pulse');
});
