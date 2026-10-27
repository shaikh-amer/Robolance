// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The arena editor's model: pure functions over an ArenaSpec so the drawing
 * component stays thin and the rules (snapping, hit testing, bounds, what
 * gets written to diagram.json) are tested without a DOM.
 *
 * Coordinates are centimetres, y down, as in ArenaSpec. The user draws
 * walls, moves the start and the goal, picks a preset to begin from, and
 * saves; the saved diagram carries the arena as `arena.spec`, which the
 * simulator already accepts, so the agent's next run happens on the user's
 * layout with no tool change.
 */

import { cornerMaze, DEFAULT_ROBOT, lineCourse, type ArenaSpec, type Diagram, type Wall } from 'robolance-hardware-sim';

export const GRID_CM = 5;
export const MIN_SIZE_CM = 50;
export const MAX_SIZE_CM = 1000;

export type ArenaSelection =
    | { kind: 'wall'; index: number }
    | { kind: 'start' }
    | { kind: 'goal' };

export interface ArenaPresetEntry {
    id: string;
    label: string;
    spec: () => ArenaSpec;
}

function border(width: number, height: number): Wall[] {
    return [
        { x1: 0, y1: 0, x2: width, y2: 0 },
        { x1: width, y1: 0, x2: width, y2: height },
        { x1: width, y1: height, x2: 0, y2: height },
        { x1: 0, y1: height, x2: 0, y2: 0 },
    ];
}

/** An empty room: nothing between start and goal but distance. */
export function openRoom(): ArenaSpec {
    return {
        width: 200,
        height: 120,
        walls: border(200, 120),
        start: { x: 30, y: 60, headingDeg: 0 },
        goal: { x: 170, y: 60, radius: 15 },
    };
}

/** Three staggered walls the robot has to weave through. */
export function slalom(): ArenaSpec {
    return {
        width: 240,
        height: 120,
        walls: [
            ...border(240, 120),
            { x1: 60, y1: 0, x2: 60, y2: 75 },
            { x1: 120, y1: 120, x2: 120, y2: 45 },
            { x1: 180, y1: 0, x2: 180, y2: 75 },
        ],
        start: { x: 25, y: 95, headingDeg: 0 },
        goal: { x: 215, y: 95, radius: 15 },
    };
}

export const ARENA_PRESETS: readonly ArenaPresetEntry[] = [
    { id: 'corner', label: 'Corner', spec: cornerMaze },
    { id: 'room', label: 'Open room', spec: openRoom },
    { id: 'slalom', label: 'Slalom', spec: slalom },
    { id: 'line', label: 'Line course', spec: lineCourse },
];

export function snap(value: number, grid: number = GRID_CM): number {
    return Math.round(value / grid) * grid;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** A deep copy the editor can change without touching the project's spec. */
export function cloneSpec(spec: ArenaSpec): ArenaSpec {
    return {
        width: spec.width,
        height: spec.height,
        walls: spec.walls.map(w => ({ ...w })),
        start: { ...spec.start },
        goal: { ...spec.goal },
        ...(spec.line ? { line: { widthCm: spec.line.widthCm, points: spec.line.points.map(p => ({ ...p })) } } : {}),
    };
}

/** Why a spec cannot be saved, or undefined when it can. */
export function validateArenaSpec(spec: ArenaSpec, robotRadius: number = DEFAULT_ROBOT.radius): string | undefined {
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    if (!finite(spec.width) || !finite(spec.height) || spec.width < MIN_SIZE_CM || spec.height < MIN_SIZE_CM || spec.width > MAX_SIZE_CM || spec.height > MAX_SIZE_CM) {
        return `the arena must be between ${MIN_SIZE_CM} and ${MAX_SIZE_CM} cm on each side`;
    }
    for (const [i, w] of spec.walls.entries()) {
        if (![w.x1, w.y1, w.x2, w.y2].every(finite)) {
            return `wall ${i + 1} has a non-numeric coordinate`;
        }
        if (w.x1 === w.x2 && w.y1 === w.y2) {
            return `wall ${i + 1} has no length`;
        }
    }
    const inside = (p: { x: number; y: number }, margin: number): boolean =>
        finite(p.x) && finite(p.y) && p.x >= margin && p.y >= margin && p.x <= spec.width - margin && p.y <= spec.height - margin;
    if (!inside(spec.start, robotRadius)) {
        return 'the start must leave room for the robot inside the arena';
    }
    // A robot placed over an inner wall cannot take its first step: the
    // simulator refuses every move that keeps it overlapping.
    if (spec.walls.some(w => !isBorderWall(spec, w) && pointSegmentDistance(spec.start.x, spec.start.y, w) < robotRadius)) {
        return 'the start overlaps a wall; move the robot clear of it';
    }
    if (!finite(spec.goal.radius) || spec.goal.radius <= 0) {
        return 'the goal needs a radius';
    }
    if (!inside(spec.goal, 0)) {
        return 'the goal must be inside the arena';
    }
    if (!finite(spec.start.headingDeg)) {
        return 'the start heading must be a number';
    }
    return undefined;
}

export function moveStart(spec: ArenaSpec, x: number, y: number, robotRadius: number = DEFAULT_ROBOT.radius): ArenaSpec {
    const margin = Math.ceil(robotRadius / GRID_CM) * GRID_CM;
    return {
        ...spec,
        start: {
            ...spec.start,
            x: clamp(snap(x), margin, spec.width - margin),
            y: clamp(snap(y), margin, spec.height - margin),
        },
    };
}

export function moveGoal(spec: ArenaSpec, x: number, y: number): ArenaSpec {
    return {
        ...spec,
        goal: {
            ...spec.goal,
            x: clamp(snap(x), 0, spec.width),
            y: clamp(snap(y), 0, spec.height),
        },
    };
}

export function setStartHeading(spec: ArenaSpec, headingDeg: number): ArenaSpec {
    const deg = ((Math.round(headingDeg) % 360) + 360) % 360;
    return { ...spec, start: { ...spec.start, headingDeg: deg } };
}

export function setGoalRadius(spec: ArenaSpec, radius: number): ArenaSpec {
    return { ...spec, goal: { ...spec.goal, radius: clamp(Math.round(radius), 5, 50) } };
}

/** Adds a wall drawn from (x1,y1) to (x2,y2), snapped; a tap (no length) adds nothing. */
export function addWall(spec: ArenaSpec, x1: number, y1: number, x2: number, y2: number): ArenaSpec {
    const wall: Wall = {
        x1: clamp(snap(x1), 0, spec.width),
        y1: clamp(snap(y1), 0, spec.height),
        x2: clamp(snap(x2), 0, spec.width),
        y2: clamp(snap(y2), 0, spec.height),
    };
    if (wall.x1 === wall.x2 && wall.y1 === wall.y2) {
        return spec;
    }
    return { ...spec, walls: [...spec.walls, wall] };
}

/** Removes a wall; the four border walls (the first four of a preset) are kept. */
export function removeWall(spec: ArenaSpec, index: number): ArenaSpec {
    if (index < 0 || index >= spec.walls.length || isBorderWall(spec, spec.walls[index]!)) {
        return spec;
    }
    return { ...spec, walls: spec.walls.filter((_, i) => i !== index) };
}

/** Whether a wall runs along the arena's edge. */
export function isBorderWall(spec: ArenaSpec, w: Wall): boolean {
    const onEdge = (a: number, b: number, edge: number): boolean => a === edge && b === edge;
    return onEdge(w.x1, w.x2, 0) || onEdge(w.x1, w.x2, spec.width) || onEdge(w.y1, w.y2, 0) || onEdge(w.y1, w.y2, spec.height);
}

/** Resizes the arena, rebuilding the border and keeping what still fits. */
export function resizeArena(spec: ArenaSpec, width: number, height: number): ArenaSpec {
    const w = clamp(snap(width), MIN_SIZE_CM, MAX_SIZE_CM);
    const h = clamp(snap(height), MIN_SIZE_CM, MAX_SIZE_CM);
    const frame: ArenaSpec = { ...spec, width: w, height: h, walls: border(w, h) };
    // An inner wall squeezed onto the new edge is the border now, not a wall.
    const inner = spec.walls.filter(wall => !isBorderWall(spec, wall)).map(wall => ({
        x1: clamp(wall.x1, 0, w), y1: clamp(wall.y1, 0, h), x2: clamp(wall.x2, 0, w), y2: clamp(wall.y2, 0, h),
    })).filter(wall => (wall.x1 !== wall.x2 || wall.y1 !== wall.y2) && !isBorderWall(frame, wall));
    const resized: ArenaSpec = {
        ...frame,
        walls: [...frame.walls, ...inner],
        ...(spec.line ? { line: { ...spec.line, points: spec.line.points.map(pt => ({ x: clamp(pt.x, 0, w), y: clamp(pt.y, 0, h) })) } } : {}),
    };
    return moveGoal(moveStart(resized, spec.start.x, spec.start.y), spec.goal.x, spec.goal.y);
}

function pointSegmentDistance(px: number, py: number, w: Wall): number {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : clamp(((px - w.x1) * dx + (py - w.y1) * dy) / len2, 0, 1);
    return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy));
}

/** What is under the pointer: the start, the goal, a wall (nearest first), or nothing. */
export function hitTest(spec: ArenaSpec, x: number, y: number, tolerance: number = 4, robotRadius: number = DEFAULT_ROBOT.radius): ArenaSelection | undefined {
    if (Math.hypot(x - spec.start.x, y - spec.start.y) <= robotRadius) {
        return { kind: 'start' };
    }
    if (Math.hypot(x - spec.goal.x, y - spec.goal.y) <= spec.goal.radius) {
        return { kind: 'goal' };
    }
    let best: { index: number; d: number } | undefined;
    spec.walls.forEach((w, index) => {
        if (isBorderWall(spec, w)) {
            return;
        }
        const d = pointSegmentDistance(x, y, w);
        if (d <= tolerance && (!best || d < best.d)) {
            best = { index, d };
        }
    });
    return best ? { kind: 'wall', index: best.index } : undefined;
}

/**
 * Maps a pointer position on the arena SVG to arena centimetres. The SVG's
 * viewBox is "-4 -4 (w+8) (h+8)" and preserveAspectRatio keeps it centred,
 * so the scale is the same on both axes.
 */
export function clientToArena(rect: { left: number; top: number; width: number; height: number }, spec: ArenaSpec, clientX: number, clientY: number): { x: number; y: number } {
    const vbW = spec.width + 8;
    const vbH = spec.height + 8;
    const scale = Math.min(rect.width / vbW, rect.height / vbH) || 1;
    const offsetX = (rect.width - vbW * scale) / 2;
    const offsetY = (rect.height - vbH * scale) / 2;
    return {
        x: (clientX - rect.left - offsetX) / scale - 4,
        y: (clientY - rect.top - offsetY) / scale - 4,
    };
}

/** The diagram with this arena written in: the spec replaces any preset. */
export function applyArenaSpec(diagram: Diagram, spec: ArenaSpec): Diagram {
    if (!diagram.arena) {
        return diagram;
    }
    const { preset: _preset, ...rest } = diagram.arena;
    return { ...diagram, arena: { ...rest, spec: cloneSpec(spec) } };
}

/** diagram.json text as the editor writes it. */
export function diagramText(diagram: Diagram): string {
    return JSON.stringify(diagram, null, 2) + '\n';
}

/** The prompt that asks the agent to prove the firmware on the saved arena. */
export function runOnArenaPrompt(): string {
    return 'I changed the arena in diagram.json (arena.spec). Run the sketch on it with the hardware tools and fix the firmware until the robot reaches the goal without collisions. Keep arena.spec as it is.';
}
