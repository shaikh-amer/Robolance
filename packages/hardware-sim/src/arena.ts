// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * A top-down world for a two-wheel robot: walls, a start, a goal, and a
 * distance sensor looking ahead. The robot's motors are the board's Motor
 * components; its sensor is the board's Ultrasonic. Physics are simple and
 * deterministic (fixed time step), which is what an agent iterating on
 * firmware needs: the same code gives the same run.
 */

import type { LineSensor, Motor, Ultrasonic } from './components.js';

export interface Wall {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/** A dark line painted on the floor for line sensors to find. */
export interface LinePath {
    points: { x: number; y: number }[];
    /** Line width, cm. */
    widthCm: number;
}

export interface ArenaSpec {
    /** Size in centimetres. */
    width: number;
    height: number;
    walls: Wall[];
    start: { x: number; y: number; headingDeg: number };
    goal: { x: number; y: number; radius: number };
    line?: LinePath;
}

/** A line sensor and where it sits on the robot (cm from the centre). */
export interface LineSensorMount {
    sensor: LineSensor;
    forwardCm: number;
    leftCm: number;
}

/** The result of following the line so far. */
export interface LineState {
    onLine: boolean;
    /** Fraction of the line the robot's centre has passed over, 0-1. */
    coverage: number;
    onLineMs: number;
    /** When the robot lost the line for good (1.5 s off it), ms, if it did. */
    lostAtMs: number | null;
}

/** How far along the line a sample point is placed, cm. */
const LINE_SAMPLE_CM = 2;
/** Off the line for this long counts as lost, ms. */
const LINE_LOST_MS = 1500;

export interface RobotSpec {
    /** Distance between the wheels, cm. */
    track: number;
    /** Body radius for collisions, cm. */
    radius: number;
    /** Wheel speed at full duty, cm/s. */
    maxSpeed: number;
}

export interface RobotPose {
    x: number;
    y: number;
    headingDeg: number;
    /** Simulated time of this pose, ms (present on recorded path entries). */
    atMs?: number;
}

export interface ArenaEvent {
    atMs: number;
    kind: 'collision' | 'goal';
    pose: RobotPose;
}

export const DEFAULT_ROBOT: RobotSpec = { track: 12, radius: 8, maxSpeed: 25 };

/** The built-in arenas a diagram can name with `arena.preset`. */
export const ARENA_PRESET_NAMES = ['corner', 'line'] as const;
export type ArenaPreset = (typeof ARENA_PRESET_NAMES)[number];

/** The arena a preset name stands for. */
export function arenaPreset(name: ArenaPreset | undefined): ArenaSpec {
    return name === 'line' ? lineCourse() : cornerMaze();
}

/** An open room with a winding 2 cm line from the start to the goal. */
export function lineCourse(): ArenaSpec {
    return {
        width: 200,
        height: 120,
        walls: [
            { x1: 0, y1: 0, x2: 200, y2: 0 },
            { x1: 200, y1: 0, x2: 200, y2: 120 },
            { x1: 200, y1: 120, x2: 0, y2: 120 },
            { x1: 0, y1: 120, x2: 0, y2: 0 },
        ],
        start: { x: 20, y: 60, headingDeg: 0 },
        goal: { x: 180, y: 80, radius: 12 },
        line: {
            widthCm: 2,
            points: [
                { x: 20, y: 60 }, { x: 60, y: 60 }, { x: 80, y: 50 }, { x: 100, y: 40 }, { x: 120, y: 50 },
                { x: 140, y: 60 }, { x: 160, y: 70 }, { x: 180, y: 80 },
            ],
        },
    };
}

/** A simple corridor with one turn: start bottom-left, goal top-right. */
export function cornerMaze(): ArenaSpec {
    return {
        width: 200,
        height: 120,
        walls: [
            { x1: 0, y1: 0, x2: 200, y2: 0 },
            { x1: 200, y1: 0, x2: 200, y2: 120 },
            { x1: 200, y1: 120, x2: 0, y2: 120 },
            { x1: 0, y1: 120, x2: 0, y2: 0 },
            { x1: 60, y1: 0, x2: 60, y2: 70 },
            { x1: 130, y1: 120, x2: 130, y2: 50 },
        ],
        start: { x: 30, y: 95, headingDeg: 0 },
        goal: { x: 170, y: 25, radius: 15 },
    };
}

export class Arena {
    pose: RobotPose;
    readonly path: RobotPose[] = [];
    readonly events: ArenaEvent[] = [];
    collisions = 0;
    reachedGoalAtMs?: number;
    /** Closest the robot got to the goal, cm. */
    bestDistanceToGoal: number;
    private timeMs = 0;

    private readonly lineSamples: { x: number; y: number }[] = [];
    private readonly lineVisited: boolean[] = [];
    private onLine = false;
    private onLineMs = 0;
    private lastOnLineAtMs?: number;
    private lostAtMs?: number;

    constructor(
        readonly spec: ArenaSpec,
        readonly left: Motor,
        readonly right: Motor,
        readonly sensor: Ultrasonic | undefined,
        readonly robot: RobotSpec = DEFAULT_ROBOT,
        readonly lineSensors: LineSensorMount[] = [],
    ) {
        this.pose = { ...spec.start };
        this.bestDistanceToGoal = this.distanceToGoal();
        this.path.push({ ...this.pose, atMs: 0 });
        if (spec.line) {
            this.lineSamples = sampleLine(spec.line, LINE_SAMPLE_CM);
            this.lineVisited = this.lineSamples.map(() => false);
        }
        this.updateSensor();
        this.trackLine(0);
    }

    get nowMs(): number {
        return this.timeMs;
    }

    /** Advances the world by `dtMs`, reading the motors as they are now. */
    tick(dtMs: number): void {
        const dt = dtMs / 1000;
        const vl = this.left.sample() * this.robot.maxSpeed;
        const vr = this.right.sample() * this.robot.maxSpeed;
        const v = (vl + vr) / 2;
        const omega = (vr - vl) / this.robot.track; // rad/s
        const heading = (this.pose.headingDeg * Math.PI) / 180;
        const next: RobotPose = {
            x: this.pose.x + v * Math.cos(heading) * dt,
            y: this.pose.y - v * Math.sin(heading) * dt,
            headingDeg: normalizeDeg(this.pose.headingDeg + (omega * dt * 180) / Math.PI),
        };
        this.timeMs += dtMs;
        if (this.hitsWall(next)) {
            // Stop at the wall; a hit while already touching counts once per second.
            const last = this.events[this.events.length - 1];
            if (!last || last.kind !== 'collision' || this.timeMs - last.atMs >= 1000) {
                this.collisions += 1;
                this.events.push({ atMs: this.timeMs, kind: 'collision', pose: { ...this.pose } });
            }
            this.pose = { ...this.pose, headingDeg: next.headingDeg };
        } else {
            this.pose = next;
        }
        this.bestDistanceToGoal = Math.min(this.bestDistanceToGoal, this.distanceToGoal());
        if (this.reachedGoalAtMs === undefined && this.distanceToGoal() <= this.spec.goal.radius) {
            this.reachedGoalAtMs = this.timeMs;
            this.events.push({ atMs: this.timeMs, kind: 'goal', pose: { ...this.pose } });
        }
        if (this.timeMs - (this.path[this.path.length - 1]?.atMs ?? 0) >= 100) {
            this.path.push({ ...this.pose, atMs: this.timeMs });
        }
        this.updateSensor();
        this.trackLine(dtMs);
    }

    /** Distance from a point to the painted line's centre, cm (Infinity without a line). */
    distanceToLine(x: number, y: number): number {
        const line = this.spec.line;
        if (!line || line.points.length === 0) {
            return Infinity;
        }
        if (line.points.length === 1) {
            return Math.hypot(x - line.points[0].x, y - line.points[0].y);
        }
        let best = Infinity;
        for (let i = 1; i < line.points.length; i++) {
            const a = line.points[i - 1];
            const b = line.points[i];
            best = Math.min(best, pointSegmentDistance(x, y, { x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
        }
        return best;
    }

    /** How the line following is going; coverage 0 without a line. */
    lineState(): LineState {
        const total = this.lineVisited.length;
        const visited = this.lineVisited.filter(Boolean).length;
        return {
            onLine: this.onLine,
            coverage: total === 0 ? 0 : Math.round((visited / total) * 1000) / 1000,
            onLineMs: this.onLineMs,
            lostAtMs: this.lostAtMs ?? null,
        };
    }

    private trackLine(dtMs: number): void {
        const line = this.spec.line;
        if (!line) {
            return;
        }
        const half = line.widthCm / 2;
        const d = this.distanceToLine(this.pose.x, this.pose.y);
        this.onLine = d <= half + 1;
        if (this.onLine) {
            this.onLineMs += dtMs;
            this.lastOnLineAtMs = this.timeMs;
            const reach = Math.max(line.widthCm, 4);
            for (let i = 0; i < this.lineSamples.length; i++) {
                if (!this.lineVisited[i] && Math.hypot(this.pose.x - this.lineSamples[i].x, this.pose.y - this.lineSamples[i].y) <= reach) {
                    this.lineVisited[i] = true;
                }
            }
        } else if (this.lastOnLineAtMs !== undefined && this.lostAtMs === undefined && this.timeMs - this.lastOnLineAtMs >= LINE_LOST_MS) {
            this.lostAtMs = this.lastOnLineAtMs;
        }
        for (const mount of this.lineSensors) {
            const { x, y } = this.mountPosition(mount);
            mount.sensor.set(this.distanceToLine(x, y) <= half);
        }
    }

    /** Where a part mounted on the robot is in the arena. */
    mountPosition(mount: { forwardCm: number; leftCm: number }): { x: number; y: number } {
        const h = (this.pose.headingDeg * Math.PI) / 180;
        // Forward is (cos h, -sin h) with y down; left is that turned 90° anticlockwise.
        return {
            x: this.pose.x + mount.forwardCm * Math.cos(h) - mount.leftCm * Math.sin(h),
            y: this.pose.y - mount.forwardCm * Math.sin(h) - mount.leftCm * Math.cos(h),
        };
    }

    distanceToGoal(): number {
        return Math.hypot(this.pose.x - this.spec.goal.x, this.pose.y - this.spec.goal.y);
    }

    /** Distance from the robot's front to the nearest wall along its heading, cm. */
    distanceAhead(): number {
        const heading = (this.pose.headingDeg * Math.PI) / 180;
        const dx = Math.cos(heading);
        const dy = -Math.sin(heading);
        const ox = this.pose.x + dx * this.robot.radius;
        const oy = this.pose.y + dy * this.robot.radius;
        let best = Infinity;
        for (const wall of this.spec.walls) {
            const d = raySegment(ox, oy, dx, dy, wall);
            if (d !== undefined && d < best) {
                best = d;
            }
        }
        return best === Infinity ? 400 : best;
    }

    private updateSensor(): void {
        if (this.sensor) {
            this.sensor.distanceCm = this.distanceAhead();
        }
    }

    private hitsWall(pose: RobotPose): boolean {
        const r = this.robot.radius;
        if (pose.x < r || pose.y < r || pose.x > this.spec.width - r || pose.y > this.spec.height - r) {
            return true;
        }
        return this.spec.walls.some(w => pointSegmentDistance(pose.x, pose.y, w) < r);
    }

    state(): Record<string, unknown> {
        return {
            timeMs: this.timeMs,
            pose: { x: round(this.pose.x), y: round(this.pose.y), headingDeg: round(this.pose.headingDeg) },
            distanceAheadCm: round(this.distanceAhead()),
            distanceToGoalCm: round(this.distanceToGoal()),
            collisions: this.collisions,
            reachedGoalAtMs: this.reachedGoalAtMs ?? null,
        };
    }
}

function normalizeDeg(d: number): number {
    return ((d % 360) + 360) % 360;
}

function round(n: number): number {
    return Math.round(n * 10) / 10;
}

/** Distance along the ray (ox,oy)+(dx,dy)·t to the segment, or undefined when it misses. */
function raySegment(ox: number, oy: number, dx: number, dy: number, w: Wall): number | undefined {
    const ex = w.x2 - w.x1;
    const ey = w.y2 - w.y1;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) {
        return undefined;
    }
    const fx = w.x1 - ox;
    const fy = w.y1 - oy;
    const t = (fx * ey - fy * ex) / denom;
    const u = (fx * dy - fy * dx) / denom;
    return t >= 0 && u >= 0 && u <= 1 ? t : undefined;
}

/** Points every `stepCm` along a polyline, for coverage. */
function sampleLine(line: LinePath, stepCm: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let i = 1; i < line.points.length; i++) {
        const a = line.points[i - 1];
        const b = line.points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.round(len / stepCm));
        for (let k = 0; k < n; k++) {
            const t = k / n;
            out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
    }
    const last = line.points[line.points.length - 1];
    if (last) {
        out.push({ x: last.x, y: last.y });
    }
    return out;
}

function pointSegmentDistance(px: number, py: number, w: Wall): number {
    const ex = w.x2 - w.x1;
    const ey = w.y2 - w.y1;
    const len2 = ex * ex + ey * ey;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.x1) * ex + (py - w.y1) * ey) / len2));
    return Math.hypot(px - (w.x1 + t * ex), py - (w.y1 + t * ey));
}
