// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    DEFAULT_FIELD, DuckFell, DuckWorld, HOME, RunOver, missionNotes, missionScore, observation, runMission, sceneXml, targets,
    validateField, type FieldSpec,
} from '../src/index.js';
import { loadAssets } from '../src/node-assets.js';

const REFERENCE = readFileSync(new URL('../../examples/score-a-goal.js', import.meta.url), 'utf8');

/** A wide pitch with the ball out of the way, for tests that place it themselves. */
const OPEN: FieldSpec = {
    duck: { x: 0, y: 0, heading: 0 },
    ball: { x: 1, y: 0.6 },
    goal: { x: 1.5, y: 0, width: 0.6 },
    bounds: { xMin: -1, xMax: 2, yMin: -1, yMax: 1 },
};

// The world's internals, for tests that set the scene directly.
interface Internals {
    data: { qpos: Float64Array; qvel: Float64Array };
    model: unknown;
    mj: { mj_forward(m: unknown, d: unknown): void };
    ballPos: number;
    ballDof: number;
    trunk: number;
}

function placeBall(world: DuckWorld, x: number, y: number, vx = 0, vy = 0): void {
    const w = world as unknown as Internals;
    w.data.qpos[w.ballPos] = x;
    w.data.qpos[w.ballPos + 1] = y;
    for (let i = 0; i < 6; i++) {
        w.data.qvel[w.ballDof + i] = 0;
    }
    w.data.qvel[w.ballDof] = vx;
    w.data.qvel[w.ballDof + 1] = vy;
    w.mj.mj_forward(w.model, w.data);
}

test('observation follows the trained layout and skips the beak', () => {
    const positions = HOME.map((h, j) => h + j / 100);
    const obs = observation(
        { positions, velocities: positions.map((_, j) => j), gyro: [1, 2, 3], gravity: [0, 0, -1] },
        new Float32Array(14).fill(0.5),
        [0.3, 0, 0.1],
    );
    assert.equal(obs.length, 61);
    assert.deepEqual(Array.from(obs.slice(0, 6)), [1, 2, 3, 0, 0, -1]);
    assert.ok(Math.abs(obs[6 + 9] - 0.1) < 1e-6, 'index 9 of the skill is joint 10 (the beak is skipped)');
    assert.equal(obs[20 + 9], 10);
    assert.equal(obs[34], 0.5);
    assert.ok(Math.abs(obs[48] - 0.3) < 1e-6);
    assert.ok(Math.abs(obs[50] - 0.1) < 1e-6);
});

test('targets are offsets from the standing pose, smoothed more for the head', () => {
    const first = targets(new Float32Array(14).fill(0.1), 1, null);
    assert.ok(Math.abs(first[0] - (HOME[0] + 0.1)) < 1e-6);
    assert.equal(first[9], HOME[9], 'the beak is not driven');
    const next = targets(new Float32Array(14), 1, first);
    assert.ok(Math.abs(next[0] - (0.7 * HOME[0] + 0.3 * first[0])) < 1e-9, 'legs: a = 0.7');
    assert.ok(Math.abs(next[6] - (0.5 * HOME[6] + 0.5 * first[6])) < 1e-9, 'head: a = 0.5');
});

test('field validation and the scene', () => {
    assert.equal(validateField(DEFAULT_FIELD), undefined);
    assert.match(validateField({ ...DEFAULT_FIELD, ball: { x: 0.05, y: 0 } }) ?? '', /15 cm/);
    assert.match(validateField({ ...DEFAULT_FIELD, ball: { x: 1.1, y: 0 } }) ?? '', /in front of the goal/);
    assert.match(validateField({ ...DEFAULT_FIELD, goal: { x: 1.25, y: 0, width: 0.6 } }) ?? '', /net sit inside/);
    assert.match(validateField({ ...DEFAULT_FIELD, ball: { x: Number.NaN, y: 0 } }) ?? '', /finite/);
    const xml = sceneXml(DEFAULT_FIELD);
    for (const name of ['post_left', 'post_right', 'crossbar', 'net_back', 'football_free']) {
        assert.ok(xml.includes(name), name);
    }
});

test('scoring', () => {
    const base = { limitS: 40, ballToGoalStart: 0.45 };
    assert.equal(missionScore({ ...base, scoredAtS: 10, fell: false, closestBallToGoal: 0 }), 95);
    assert.equal(missionScore({ ...base, scoredAtS: 10, fell: true, closestBallToGoal: 0 }), 85);
    assert.equal(missionScore({ ...base, scoredAtS: null, fell: false, closestBallToGoal: 0.45 }), 0);
    assert.equal(missionScore({ ...base, scoredAtS: null, fell: false, closestBallToGoal: 0.09 }), 40);
    assert.equal(missionScore({ ...base, scoredAtS: null, fell: true, closestBallToGoal: 0.09 }), 25);
});

test('notes explain a missed kick and the wrong foot', () => {
    const kick = { atS: 3, ballMoved: 0, ballDirection: null, goalDirection: -20, ballForward: 0.071 };
    const common = { outcome: 'no-goal' as const, events: [], scoredAtS: null, simS: 6, limitS: 40, score: 0 };
    const wrongFoot = missionNotes({ ...common, kicks: [{ ...kick, side: 'right', ballLeft: 0.04 }] });
    assert.match(wrongFoot.join('\n'), /on the left side: kick\('left'\)/);
    const tooCentral = missionNotes({ ...common, kicks: [{ ...kick, side: 'right', ballLeft: -0.005 }] });
    assert.match(tooCentral.join('\n'), /6-8 cm ahead and 1.5-8 cm to the right/);
    const wide = missionNotes({ ...common, kicks: [{ ...kick, side: 'right', ballLeft: -0.05, ballMoved: 0.6, ballDirection: 10 }] });
    assert.match(wide.join('\n'), /30 degrees too far left/);
    assert.match(missionNotes({ ...common, kicks: [] }).join('\n'), /never kicked/);
});

test('a right kick from a settled stance sends the ball', async () => {
    const world = await DuckWorld.create(await loadAssets(), { field: OPEN });
    try {
        await world.walk(0, 0, 0.4);
        placeBall(world, 0.07, -0.035);
        const kick = await world.kick('right');
        assert.ok(kick.ballMoved > 0.4, `ball moved ${kick.ballMoved} m`);
        assert.ok(Math.abs(kick.ballDirection ?? 99) < 30, `direction ${kick.ballDirection}`);
        assert.equal(world.fallen, false);
    } finally {
        world.dispose();
    }
});

test('the goal line: in between the posts is a goal, outside is out', async () => {
    const assets = await loadAssets();
    for (const [y, kind] of [[0.1, 'goal'], [0.45, 'out']] as const) {
        const world = await DuckWorld.create(assets, { field: OPEN });
        try {
            placeBall(world, 1.4, y, 1.2, 0);
            await world.walk(0, 0, 0.8);
            assert.equal(world.over, false);
            await assert.rejects(world.walk(0, 0, 1), RunOver, 'the run stops a second after the ball is decided');
            assert.equal(world.over, true);
            assert.deepEqual(world.events.map(e => e.kind), [kind]);
            assert.equal(world.scoredAtS !== null, kind === 'goal');
        } finally {
            world.dispose();
        }
    }
});

test('a duck lying on its side is a fall', async () => {
    const world = await DuckWorld.create(await loadAssets(), { field: OPEN });
    try {
        const w = world as unknown as Internals;
        // Roll the trunk 90 degrees about x.
        w.data.qpos[w.trunk + 2] = 0.25; // dropped from above, so it lands on its side
        w.data.qpos[w.trunk + 3] = Math.SQRT1_2;
        w.data.qpos[w.trunk + 4] = Math.SQRT1_2;
        w.data.qpos[w.trunk + 6] = 0;
        await assert.rejects(world.walk(0, 0, 2), DuckFell);
        assert.equal(world.fallen, true);
        assert.ok(world.events.some(e => e.kind === 'fell'));
    } finally {
        world.dispose();
    }
});

test('the reference mission scores on the default field', async () => {
    const r = await runMission(REFERENCE);
    assert.equal(r.outcome, 'goal', r.notes.join('\n'));
    assert.ok(r.score >= 80, `score ${r.score}`);
    assert.ok(r.kicks.length >= 1);
    assert.ok(r.logs.some(l => l.startsWith('attempt 1')));
    assert.ok(r.replay && r.replay.frames.length > 100);
    assert.equal(r.replay.frames[0].length, r.replay.qposSize);
});

test('a mission that does nothing gets no goal and is told so', async () => {
    const r = await runMission('log("hello", { a: 1 });', { limitS: 5 });
    assert.equal(r.outcome, 'no-goal');
    assert.equal(r.score, 0);
    assert.deepEqual(r.logs, ['hello {"a":1}']);
    assert.match(r.notes.join('\n'), /never kicked/);
});

test('mission errors carry the line they came from', async () => {
    const syntax = await runMission('const a = 1;\nawait duck.walk(0.3, 0,\n', { limitS: 5 });
    assert.equal(syntax.outcome, 'error');
    assert.match(syntax.error ?? '', /SyntaxError/);
    const thrown = await runMission('await duck.stand(0.2);\nduck.kick("middle");', { limitS: 5 });
    assert.equal(thrown.outcome, 'error');
    assert.match(thrown.error ?? '', /kick takes 'left' or 'right' \(line 2\)/);
    const missing = await runMission('require("fs")', { limitS: 5 });
    assert.equal(missing.outcome, 'error', 'no Node APIs in scope');
});

test('limits: simulated time and real time', async () => {
    const long = await runMission('await duck.stand(10);', { limitS: 2 });
    assert.equal(long.outcome, 'time-up');
    assert.ok(long.simS <= 2.02);
    const spin = await runMission('while (true) {}', { wallMs: 2000 });
    assert.equal(spin.outcome, 'timeout');
    assert.match(spin.error ?? '', /real time/);
});

test('the run ends a second after a goal, even if the mission carries on', async () => {
    const r = await runMission(`${REFERENCE}\nwhile (true) { try { await duck.stand(1); } catch {} }`, { wallMs: 30_000 });
    assert.equal(r.outcome, 'goal', r.notes.join('\n'));
    assert.ok(r.scoredAtS !== null && r.simS <= r.scoredAtS + 1.05, `ran to ${r.simS} s after a goal at ${r.scoredAtS} s`);
});

test('a mission that swallows the time limit still reports', async () => {
    const r = await runMission('while (true) { try { await duck.stand(1); } catch {} }', { limitS: 3, wallMs: 30_000 });
    assert.equal(r.outcome, 'time-up');
});
