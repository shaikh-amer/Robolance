// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Board, cornerMaze, loadHex, runScenario, validateDiagram, type Diagram } from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');
const benchHex = readFileSync(join(fixtures, 'bench.hex'), 'utf8');
const followerHex = readFileSync(join(fixtures, 'wall-follower.hex'), 'utf8');

const benchDiagram: Diagram = {
    parts: [
        { type: 'led', id: 'led13', pin: 13, color: 'green' },
        { type: 'led', id: 'dim', pin: 6 },
        { type: 'button', id: 'btn', pin: 2 },
        { type: 'servo', id: 'arm', pin: 9 },
        { type: 'potentiometer', id: 'pot', pin: 'A0' },
    ],
};

test('loadHex writes the fixture into flash', () => {
    const flash = new Uint8Array(32 * 1024);
    const loaded = loadHex(benchHex, flash);
    assert.equal(loaded, 4358, 'bytes loaded match the fixture size');
    assert.notEqual(flash[0] | flash[1], 0, 'the reset vector is a jump');
});

test('the board runs firmware and prints on Serial', () => {
    const board = new Board(benchHex);
    board.step(300_000);
    assert.equal(board.serialLines[0], 'ready');
    assert.ok(board.nowUs >= 300_000);
});

test('bench sketch: LED blinks, servo follows the button, pot is read, PWM dims', () => {
    const trace = runScenario(benchHex, benchDiagram, {
        durationMs: 3000,
        events: [
            { atMs: 1000, action: 'tap', part: 'btn', holdMs: 500 },
            { atMs: 1500, action: 'set', part: 'pot', value: 0.75 },
        ],
    });
    assert.equal(trace.ranMs, 3000);
    assert.equal(trace.serial[0], 'ready');
    assert.ok(trace.serial.includes('pressed'), 'button press was seen by the firmware');
    assert.ok(trace.serial.some(l => l === 'pot=768' || l === 'pot=767'), `pot read after set: ${trace.serial.slice(-3)}`);
    const ledStates = new Set(trace.samples.map(s => s.parts.led13.on));
    assert.deepEqual([...ledStates].sort(), [false, true], 'LED was seen both on and off');
    assert.equal(trace.final.arm.angle, 150);
    assert.equal(trace.final.pot.position, 0.75);
    const dim = trace.final.dim.brightness as number;
    assert.ok(dim > 0.2 && dim < 0.3, `analogWrite(6, 64) gives ~25% duty, got ${dim}`);
    assert.deepEqual(trace.notes, []);
});

test('a sketch that never drives its parts gets notes', () => {
    const trace = runScenario(benchHex, {
        parts: [
            { type: 'led', id: 'unused', pin: 7 },
            { type: 'servo', id: 'idle', pin: 10 },
        ],
    }, { durationMs: 500 });
    assert.ok(trace.notes.some(n => n.startsWith('unused (led on pin 7) never turned on')));
    assert.ok(trace.notes.some(n => n.startsWith('idle (servo on pin 10) never received a pulse')));
});

test('scripted events that do not fit a part are reported, not dropped silently', () => {
    const trace = runScenario(benchHex, benchDiagram, {
        durationMs: 300,
        events: [
            { atMs: 10, action: 'press', part: 'nothing' },
            { atMs: 20, action: 'set', part: 'btn', value: 1 },
            { atMs: 30, action: 'serial', text: 'hi\n' },
        ],
    });
    assert.ok(trace.notes.some(n => n.includes('unknown part nothing')));
    assert.ok(trace.notes.some(n => n.includes('set does not apply to button btn')));
});

test('validateDiagram names the first problem', () => {
    assert.equal(validateDiagram(null), 'diagram must be an object');
    assert.equal(validateDiagram({ parts: [{ type: 'laser', id: 'x' }] }), 'unknown part type "laser"; use one of led, button, servo, ultrasonic, potentiometer, motor');
    assert.equal(validateDiagram({ parts: [{ type: 'led', id: 'a', pin: 13 }, { type: 'led', id: 'b', pin: 13 }] }), 'led b and led a both use pin 13');
    assert.equal(validateDiagram({ parts: [{ type: 'led', id: 'a', pin: 14 }] }), 'led a: 14 is not an Uno pin (0-13 or A0-A5)');
    assert.equal(validateDiagram({ parts: [{ type: 'potentiometer', id: 'p', pin: 3 }] }), 'potentiometer p: a potentiometer needs an analog pin (A0-A5)');
    assert.equal(validateDiagram({ parts: [{ type: 'led', id: 'l', pin: 1 }], arena: { preset: 'corner', left: 'l', right: 'l' } }), 'arena.left must name a motor part');
    assert.equal(validateDiagram(benchDiagram), undefined);
});

const robotDiagram: Diagram = {
    parts: [
        { type: 'motor', id: 'left', in1: 4, in2: 5, en: 6 },
        { type: 'motor', id: 'right', in1: 7, in2: 8, en: 10 },
        { type: 'ultrasonic', id: 'eyes', trig: 12, echo: 11 },
    ],
    arena: { preset: 'corner', left: 'left', right: 'right', sensor: 'eyes' },
};

test('wall follower drives the robot through the arena and is scored', () => {
    const trace = runScenario(followerHex, robotDiagram, { durationMs: 4000, maxRealMs: 60_000 });
    const arena = trace.arena!;
    assert.ok(trace.serial.some(l => /^cm=\d+$/.test(l)), 'the sensor was read');
    assert.ok(arena.path.length > 10, 'the path was recorded');
    const last = arena.path[arena.path.length - 1];
    assert.ok(Math.hypot(last.x - 30, last.y - 95) > 20, `the robot moved from the start: ${JSON.stringify(last)}`);
    assert.ok(arena.bestDistanceToGoalCm < 150, 'the robot got closer to the goal');
    assert.ok(arena.score >= 0 && arena.score <= 100);
    assert.equal(arena.reachedGoalAtMs, null);
    assert.ok(trace.notes.some(n => n.includes('did not reach the goal')));
    assert.equal(typeof trace.final.eyes.pings, 'number');
    assert.ok((trace.final.eyes.pings as number) > 10, 'the firmware pinged the sensor');
});

test('a robot whose motors are not driven never moves', () => {
    const trace = runScenario(benchHex, robotDiagram, { durationMs: 1000 });
    const arena = trace.arena!;
    assert.equal(arena.collisions, 0);
    assert.ok(trace.notes.some(n => n.includes('the robot never moved')));
    assert.equal(arena.score, 0);
});

test('the corner maze is bounded by its outer walls', () => {
    const maze = cornerMaze();
    assert.equal(maze.walls.length, 6);
    assert.equal(maze.width, 200);
    assert.ok(maze.goal.x < maze.width && maze.goal.y < maze.height);
});

test('Simulation steps the board and the arena together and takes live inputs', async () => {
    const { Simulation } = await import('../src/index.js');
    const sim = new Simulation(benchHex, benchDiagram);
    sim.advance(300);
    assert.equal(sim.timeMs, 300);
    assert.equal(sim.serialLines[0], 'ready');
    assert.equal(sim.apply({ action: 'press', part: 'btn' }), undefined);
    sim.advance(600);
    assert.ok(sim.serialLines.includes('pressed'));
    assert.equal(sim.snapshot().arm.angle, 150);
    assert.equal(sim.apply({ action: 'set', part: 'nothing', value: 1 }), 'unknown part nothing');
    assert.equal(sim.apply({ action: 'set', part: 'btn', value: 1 }), 'set does not apply to button btn');
    const robot = new Simulation(followerHex, robotDiagram);
    robot.advance(1000);
    assert.equal(robot.arena!.path[0].atMs, 0);
    assert.ok(robot.arena!.path.length >= 10 && robot.arena!.path.every((p, i) => i === 0 || p.atMs! > robot.arena!.path[i - 1].atMs!), 'path poses are timestamped in order');
});
