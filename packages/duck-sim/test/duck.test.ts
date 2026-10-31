// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    DEFAULT_FIELD, DuckFell, DuckWorld, HOME, RunOver, missionNotes, missionScore, observation, runMission, sceneXml, targets,
    validateField, bodyPoses, decodeMesh, distanceToObstacle, furnitureParts, solidObstacles, type FieldSpec, type ViewerModel,
} from '../src/index.js';
import { loadAssets } from '../src/node-assets.js';
import { meshoptSimplifier } from 'robolance-mujoco';

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

test('a project skill may tip the duck over; it is a fall only if the duck is still down after', async () => {
    const assets = await loadAssets();
    // The packaged standing policy stands in for a trained get-up policy.
    const world = await DuckWorld.create(assets, { field: OPEN, skills: { getUp: assets.policies.get('alpha_stand')! } });
    try {
        assert.deepEqual(world.extraSkills, ['getUp']);
        const w = world as unknown as Internals;
        w.data.qpos[w.trunk + 2] = 0.25;
        w.data.qpos[w.trunk + 3] = Math.SQRT1_2;
        w.data.qpos[w.trunk + 4] = Math.SQRT1_2;
        w.data.qpos[w.trunk + 6] = 0;
        await world.runSkill('getUp', 2);
        assert.equal(world.fallen, false, 'lying down during a project skill is part of the move');
        // The standing policy rights the duck from its side within a second, so standing on is fine.
        await world.walk(0, 0, 1);
        assert.equal(world.fallen, false);
        await assert.rejects(world.runSkill('flip', 1), /no skill "flip"; the project's skills are getUp/);
    } finally {
        world.dispose();
    }
});

test('project policies replace built-in skills or add new ones, and bad ones are refused', async () => {
    const assets = await loadAssets();
    const walk = assets.policies.get('alpha_walking')!;
    const r = await runMission(`
        log(duck.skills());
        await duck.skill('jog', 1.5, [0.4, 0, 0]);
        await duck.walk(0.4, 0, 2);
        log(duck.pose().x > 0.2);
    `, { field: OPEN, limitS: 10, skills: { walk, jog: walk } });
    assert.equal(r.error, undefined, r.notes.join('\n'));
    assert.deepEqual(r.logs, ['["jog"]', 'true']);
    assert.notEqual(r.outcome, 'fell');

    const broken = await runMission('await duck.stand(1);', { limitS: 5, skills: { walk: new Uint8Array([1, 2, 3]) } });
    assert.equal(broken.outcome, 'error');
    assert.match(broken.error ?? '', /skill "walk" is not an ONNX model/);
    const badName = await runMission('await duck.stand(1);', { limitS: 5, skills: { '../x': walk } });
    assert.match(badName.error ?? '', /skill name "..\/x"/);
    const badCommand = await runMission(`await duck.skill('walk', 1, ['fast']);`, { limitS: 5 });
    assert.match(badCommand.error ?? '', /command\[0\] must be a finite number/);
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

test('viewer kinematics match MuJoCo while the duck walks', async () => {
    const world = await DuckWorld.create(await loadAssets(), { field: OPEN });
    try {
        const model = world.viewerModel();
        await world.walk(0.4, 0.6, 1.2);
        for (let i = 0; i < 3; i++) {
            await world.walk(0.3, -0.5, 0.3);
            const mine = bodyPoses(model, world.qpos());
            const ref = world.bodyWorldPoses();
            for (let b = 0; b < ref.length; b++) {
                const dp = Math.hypot(...mine[b].pos.map((v, k) => v - ref[b].pos[k]));
                const dq = 1 - Math.abs(mine[b].quat.reduce((s, v, k) => s + v * ref[b].quat[k], 0));
                assert.ok(dp < 1e-5 && dq < 1e-5, `body ${model.bodies[b].name}: ${dp} m, ${dq}`);
            }
        }
    } finally {
        world.dispose();
    }
});

test('viewer/duck-model.js is current (regenerate with npm run export-viewer)', async () => {
    const world = await DuckWorld.create(await loadAssets());
    try {
        const shipped = (await import(new URL('../../viewer/duck-model.js', import.meta.url).href)).default as ViewerModel;
        assert.deepEqual(shipped, JSON.parse(JSON.stringify(world.viewerModel(await meshoptSimplifier(0.0002)))), 'compared as JSON, where -0 is 0');
        assert.equal(shipped.nq, world.qposSize);
        const mesh = decodeMesh(shipped.meshes[0]);
        assert.ok(mesh.positions.length > 0 && mesh.indices.length % 3 === 0);
        assert.ok(Math.max(...mesh.indices) < mesh.positions.length / 3);
    } finally {
        world.dispose();
    }
});

test('obstacles: validation and the scene', () => {
    const box = { name: 'box', x: 0.3, y: -0.3, width: 0.2, depth: 0.15, height: 0.2, heading: 30 };
    assert.equal(validateField({ ...DEFAULT_FIELD, obstacles: [box] }), undefined);
    assert.match(validateField({ ...DEFAULT_FIELD, obstacles: [{ ...box, x: 0.05, y: 0 }] }) ?? '', /duck's start/);
    assert.match(validateField({ ...DEFAULT_FIELD, obstacles: [{ ...box, x: 0.5, y: 0.2 }] }) ?? '', /covers the ball/);
    assert.match(validateField({ ...DEFAULT_FIELD, obstacles: [{ ...box, height: 5 }] }) ?? '', /height/);
    assert.match(validateField({ ...DEFAULT_FIELD, obstacles: [{ ...box, x: 9 }] }) ?? '', /inside the bounds/);
    assert.match(validateField({ ...DEFAULT_FIELD, obstacles: Array.from({ length: 30 }, (_, i) => ({ ...box, y: -0.6 + i * 0.001 })) }) ?? '', /at most/);
    const xml = sceneXml({ ...DEFAULT_FIELD, obstacles: [box] });
    assert.match(xml, /<geom name="obstacle_0" type="box" size="0.1 0.075 0.1" pos="0.3 -0.3 0.1" quat="0.9659 0 0 0.2588"/);
    assert.equal(distanceToObstacle(box, 0.3, -0.3), 0);
    assert.ok(Math.abs(distanceToObstacle({ ...box, heading: 0 }, 0.6, -0.3) - 0.2) < 1e-9);
});

test('walking into an obstacle is noted; going round it is not', async () => {
    const field: FieldSpec = { ...DEFAULT_FIELD, obstacles: [{ name: 'the cardboard box', x: 0.3, y: 0, width: 0.12, depth: 0.3, height: 0.25 }] };
    const straight = await runMission('await duck.walkTo(0.6, 0);', { field, limitS: 12 });
    const hit = straight.events.find(e => e.kind === 'obstacle');
    assert.ok(hit, JSON.stringify(straight.events));
    assert.match(straight.notes.join('\n'), /walked into the cardboard box.*add a waypoint/);
    const around = await runMission('await duck.walkTo(0.1, 0.3); await duck.walkTo(0.55, 0.3);', { field, limitS: 20 });
    assert.equal(around.events.filter(e => e.kind === 'obstacle').length, 0, around.notes.join('\n'));
    assert.deepEqual(around.field.obstacles, field.obstacles);
});

const LAPTOP_FIELD: FieldSpec = { ...DEFAULT_FIELD, ball: { x: 0.2, y: 0.45 }, laptop: { x: 0.75, y: 0, heading: 0 } };

test('the laptop: validation and the scene', () => {
    assert.equal(validateField(LAPTOP_FIELD), undefined);
    assert.match(validateField({ ...LAPTOP_FIELD, laptop: { x: 0.12, y: 0, heading: 0 } }) ?? '', /clear of the duck/);
    assert.match(validateField({ ...LAPTOP_FIELD, laptop: { x: 1.25, y: 0, heading: 0 } }) ?? '', /inside the bounds/);
    assert.match(validateField({ ...LAPTOP_FIELD, laptop: { x: 0.75, y: 0, heading: 0, openDeg: 170 } }) ?? '', /openDeg/);
    assert.match(validateField({ ...DEFAULT_FIELD, laptop: { x: 0.6, y: 0.2, heading: 0 } }) ?? '', /covers the ball/);
    const xml = sceneXml(LAPTOP_FIELD);
    assert.ok(xml.indexOf('football_free') < xml.indexOf('name="laptop_lid"'), 'the lid comes after the ball in qpos');
    assert.match(xml, /<joint name="laptop_lid" type="hinge" axis="0 -1 0" range="0 1.7453"/);
});

test('the duck closes the laptop with its head, and the run says so', async () => {
    const mission = readFileSync(new URL('../../examples/close-the-laptop.js', import.meta.url), 'utf8');
    const r = await runMission(mission, { field: LAPTOP_FIELD, limitS: 25 });
    assert.equal(r.outcome, 'closed', r.notes.join('\n') + r.logs.join('\n'));
    assert.ok(r.score >= 85, `score ${r.score}`);
    assert.ok(r.closedAtS !== null && r.closedAtS! > 2);
    assert.ok(r.final.lidDeg! < 10);
    assert.match(r.notes[0], /laptop closed at/);
    assert.match(r.logs[0], /"lidDeg":100/);
    assert.equal(r.replay!.frames[0].length, r.replay!.qposSize);
    // The lid angle is the last value of a frame: open at the start, shut at the end.
    const first = r.replay!.frames[0];
    const last = r.replay!.frames[r.replay!.frames.length - 1];
    assert.ok(Math.abs(first[first.length - 1] - (100 * Math.PI) / 180) < 0.01);
    assert.ok(last[last.length - 1] < 0.18);
});

test('the example closes a laptop facing the duck, going round it first', async () => {
    const mission = readFileSync(new URL('../../examples/close-the-laptop.js', import.meta.url), 'utf8');
    const field: FieldSpec = { ...LAPTOP_FIELD, laptop: { x: 0.45, y: 0, heading: 180 } };
    const r = await runMission(mission, { field, limitS: 40 });
    assert.equal(r.outcome, 'closed', r.notes.join('\n') + r.logs.join('\n'));
    // It never walked through the laptop: the path stays clear of the base on the way round.
    const crossed = r.path.some(([x, y]) => Math.abs(x - 0.45) < 0.11 && Math.abs(y) < 0.16);
    assert.ok(!crossed, 'walked through the laptop');
});

test('a laptop left open is explained and scored on how far the lid went', async () => {
    const r = await runMission('await duck.stand(1);', { field: LAPTOP_FIELD, limitS: 8 });
    assert.equal(r.outcome, 'still-open');
    assert.equal(r.score, 0);
    assert.match(r.notes.join('\n'), /lid never moved.*behind the screen/);
});

/** A room 3.5 x 3 m with a wood floor, a table the duck can walk under and a fridge by the wall. */
const ROOM: FieldSpec = {
    duck: { x: 0, y: 0, heading: 0 },
    ball: { x: 1.9, y: 0.4 },
    goal: { x: 2.6, y: 0, width: 0.6 },
    bounds: { xMin: -0.5, xMax: 3, yMin: -1.5, yMax: 1.5 },
    room: { floor: 'wood' },
    furniture: [
        { kind: 'table', x: 0.9, y: 0, items: ['laptop', 'mug'] },
        { kind: 'fridge', x: 1.4, y: -1.1, heading: 90, name: 'the fridge' },
    ],
};

test('furniture: real-size floor parts, validation and the scene', () => {
    assert.equal(validateField(ROOM), undefined);
    const legs = furnitureParts({ kind: 'table', x: 0.9, y: 0 });
    assert.equal(legs.length, 4);
    assert.ok(legs.every(l => l.width === 0.05 && l.height === 0.72 && l.name === "the table's leg"));
    assert.deepEqual(legs.map(l => [l.x, l.y]).sort(), [[0.58, -0.545], [0.58, 0.545], [1.22, -0.545], [1.22, 0.545]]);
    // Turned 90 degrees, the fridge's 70 cm width runs along x and its 65 cm depth along y.
    const [fridge] = furnitureParts({ kind: 'fridge', x: 1.4, y: -1.1, heading: 90 });
    assert.equal(distanceToObstacle(fridge, 1.4 + 0.349, -1.1), 0);
    assert.ok(distanceToObstacle(fridge, 1.4, -1.1 + 0.34) > 0);
    assert.equal(furnitureParts({ kind: 'desk', x: 0, y: 1 }).length, 2);
    assert.equal(solidObstacles(ROOM).length, 5);

    const bad = (patch: Partial<FieldSpec>) => validateField({ ...ROOM, ...patch }) ?? '';
    assert.match(bad({ furniture: [{ kind: 'piano' as 'table', x: 1, y: 1 }] }), /kind is one of/);
    assert.match(bad({ furniture: [{ kind: 'fridge', x: 0.1, y: 0 }] }), /the fridge: it covers the duck's start/);
    assert.match(bad({ furniture: [{ kind: 'box', x: 1.9, y: 0.4 }] }), /covers the ball/);
    assert.match(bad({ furniture: [{ kind: 'sofa', x: 2.9, y: 1.4 }] }), /outside the bounds/);
    assert.match(bad({ furniture: [{ kind: 'chair', x: 1, y: 1, items: ['lamp'] }] }), /only a desk or a table/);
    assert.match(bad({ furniture: [{ kind: 'table', x: 1, y: 1, color: 'red' }] }), /#rrggbb/);
    assert.match(bad({ room: { floor: 'lava' as 'wood' } }), /room.floor/);

    const xml = sceneXml(ROOM);
    assert.match(xml, /name="floor"[^>]*rgba="0.55 0.38 0.22 1"/);
    assert.equal((xml.match(/<geom name="wall_/g) ?? []).length, 4);
    assert.equal((xml.match(/<geom name="obstacle_/g) ?? []).length, 5);
    assert.doesNotMatch(sceneXml({ ...ROOM, room: { floor: 'tile', walls: false } }), /wall_/);
});

test('the duck walks under a table, and a fridge in its way is noted by name', async () => {
    const under = await runMission('log(field.obstacles.length); await duck.walkTo(1.5, 0);', { field: ROOM, limitS: 20 });
    assert.equal(under.events.filter(e => e.kind === 'obstacle').length, 0, under.notes.join('\n'));
    assert.ok(under.final.duck.x > 1.3, `the duck got to x=${under.final.duck.x}`);
    assert.equal(under.logs[0], '5', 'a mission sees the furniture\'s floor parts in field.obstacles');
    assert.deepEqual(under.field.furniture, ROOM.furniture, 'the record keeps the furniture as given, for the viewer');

    const blocked: FieldSpec = { ...ROOM, furniture: [{ kind: 'fridge', x: 0.6, y: 0, heading: 180, name: 'the fridge' }] };
    const hit = await runMission('await duck.walkTo(1.2, 0);', { field: blocked, limitS: 12 });
    assert.match(hit.events.map(e => e.detail).join('\n'), /walked into the fridge/);
});
