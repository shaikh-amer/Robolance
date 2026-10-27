// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cornerMaze, type Diagram } from 'robolance-hardware-sim';
import {
    ARENA_PRESETS, addWall, applyArenaSpec, clientToArena, diagramText, hitTest, isBorderWall, moveGoal, moveStart,
    openRoom, removeWall, resizeArena, setGoalRadius, setStartHeading, slalom, snap, validateArenaSpec,
} from '../src/browser/arena-editor';

test('presets are valid arenas with a closed border', () => {
    for (const preset of ARENA_PRESETS) {
        const spec = preset.spec();
        assert.equal(validateArenaSpec(spec), undefined, preset.id);
        assert.equal(spec.walls.filter(w => isBorderWall(spec, w)).length, 4, `${preset.id} border`);
    }
    assert.equal(openRoom().walls.length, 4);
    assert.equal(slalom().walls.length, 7);
});

test('start and goal move on the grid and stay inside the arena', () => {
    let spec = cornerMaze();
    spec = moveStart(spec, 101, 47);
    assert.deepEqual([spec.start.x, spec.start.y], [100, 45]);
    spec = moveStart(spec, -20, 500);
    assert.deepEqual([spec.start.x, spec.start.y], [10, 110], 'the robot keeps its radius inside the walls');
    spec = moveGoal(spec, 999, -3);
    assert.deepEqual([spec.goal.x, spec.goal.y], [200, 0]);
    assert.equal(setStartHeading(spec, 370).start.headingDeg, 10);
    assert.equal(setStartHeading(spec, -90).start.headingDeg, 270);
    assert.equal(setGoalRadius(spec, 2).goal.radius, 5);
    assert.equal(snap(12.6), 15);
});

test('walls are drawn snapped, taps add nothing, and the border cannot be deleted', () => {
    const base = cornerMaze();
    const drawn = addWall(base, 81, 22, 81, 68);
    assert.equal(drawn.walls.length, base.walls.length + 1);
    assert.deepEqual(drawn.walls[drawn.walls.length - 1], { x1: 80, y1: 20, x2: 80, y2: 70 });
    assert.equal(addWall(base, 50, 50, 51, 51).walls.length, base.walls.length, 'a tap is not a wall');
    assert.equal(removeWall(drawn, 0).walls.length, drawn.walls.length, 'border walls stay');
    assert.equal(removeWall(drawn, drawn.walls.length - 1).walls.length, base.walls.length);
    assert.equal(removeWall(drawn, 99).walls.length, drawn.walls.length);
});

test('hit testing finds the robot, the goal and the nearest inner wall', () => {
    const spec = cornerMaze();
    assert.deepEqual(hitTest(spec, 31, 96), { kind: 'start' });
    assert.deepEqual(hitTest(spec, 172, 26), { kind: 'goal' });
    assert.deepEqual(hitTest(spec, 61, 30), { kind: 'wall', index: 4 });
    assert.equal(hitTest(spec, 1, 60), undefined, 'the border is not selectable');
    assert.equal(hitTest(spec, 100, 100), undefined);
});

test('resizing rebuilds the border, clamps inner walls and keeps the start inside', () => {
    const spec = resizeArena(cornerMaze(), 100, 60);
    assert.equal(spec.width, 100);
    assert.equal(spec.height, 60);
    assert.equal(spec.walls.filter(w => isBorderWall(spec, w)).length, 4);
    assert.ok(spec.walls.every(w => w.x1 <= 100 && w.x2 <= 100 && w.y1 <= 60 && w.y2 <= 60));
    assert.equal(validateArenaSpec(spec), undefined);
    assert.equal(resizeArena(spec, 10, 10).width, 50, 'never smaller than the minimum');
});

test('validation names what is wrong', () => {
    const spec = cornerMaze();
    assert.match(validateArenaSpec({ ...spec, width: 10 })!, /between 50 and 1000/);
    assert.match(validateArenaSpec({ ...spec, walls: [...spec.walls, { x1: 5, y1: 5, x2: 5, y2: 5 }] })!, /no length/);
    assert.match(validateArenaSpec({ ...spec, start: { x: 2, y: 2, headingDeg: 0 } })!, /room for the robot/);
    assert.match(validateArenaSpec({ ...spec, goal: { x: 500, y: 5, radius: 10 } })!, /inside the arena/);
    assert.match(validateArenaSpec({ ...spec, goal: { x: 50, y: 50, radius: 0 } })!, /radius/);
});

test('pointer positions map through the centred viewBox', () => {
    const spec = cornerMaze(); // viewBox 208 x 128
    // Twice the size, letterboxed horizontally: 416 x 256 content in a 500 x 256 box.
    const rect = { left: 10, top: 20, width: 500, height: 256 };
    const p = clientToArena(rect, spec, 10 + 42 + (30 + 4) * 2, 20 + (95 + 4) * 2);
    assert.equal(Math.round(p.x), 30);
    assert.equal(Math.round(p.y), 95);
});

test('saving writes the spec into the diagram in place of the preset', () => {
    const diagram: Diagram = {
        parts: [{ type: 'motor', id: 'l', in1: 4, in2: 5, en: 6 }, { type: 'motor', id: 'r', in1: 7, in2: 8, en: 10 }],
        arena: { preset: 'corner', left: 'l', right: 'r' },
    };
    const saved = applyArenaSpec(diagram, slalom());
    assert.equal(saved.arena?.preset, undefined);
    assert.equal(saved.arena?.spec?.width, 240);
    assert.equal(saved.arena?.left, 'l');
    assert.equal(diagram.arena?.preset, 'corner', 'the original is untouched');
    const text = diagramText(saved);
    assert.ok(text.endsWith('}\n'));
    assert.deepEqual(JSON.parse(text).arena.spec.goal, { x: 215, y: 95, radius: 15 });
    assert.equal(applyArenaSpec({ parts: [] }, slalom()).arena, undefined, 'no arena binding, nothing to write');
});
