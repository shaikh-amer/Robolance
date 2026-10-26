// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * A top-down world for a two-wheel robot: walls, a start, a goal, and a
 * distance sensor looking ahead. The robot's motors are the board's Motor
 * components; its sensor is the board's Ultrasonic. Physics are simple and
 * deterministic (fixed time step), which is what an agent iterating on
 * firmware needs: the same code gives the same run.
 */

import type { Motor, Ultrasonic } from './components.js';

export interface Wall {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface ArenaSpec {
    /** Size in centimetres. */
    width: number;
    height: number;
    walls: Wall[];
    start: { x: number; y: number; headingDeg: number };
    goal: { x: number; y: number; radius: number };
}

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
}

export interface ArenaEvent {
    atMs: number;
    kind: 'collision' | 'goal';
    pose: RobotPose;
}

export const DEFAULT_ROBOT: RobotSpec = { track: 12, radius: 8, maxSpeed: 25 };

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

    constructor(
        readonly spec: ArenaSpec,
        readonly left: Motor,
        readonly right: Motor,
        readonly sensor: Ultrasonic | undefined,
        readonly robot: RobotSpec = DEFAULT_ROBOT,
    ) {
        this.pose = { ...spec.start };
        this.bestDistanceToGoal = this.distanceToGoal();
        this.path.push({ ...this.pose });
        this.updateSensor();
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
        if (this.path.length === 0 || this.timeMs - this.pathTimes[this.pathTimes.length - 1] >= 100) {
            this.path.push({ ...this.pose });
            this.pathTimes.push(this.timeMs);
        }
        this.updateSensor();
    }

    private readonly pathTimes: number[] = [0];

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

function pointSegmentDistance(px: number, py: number, w: Wall): number {
    const ex = w.x2 - w.x1;
    const ey = w.y2 - w.y1;
    const len2 = ex * ex + ey * ey;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.x1) * ex + (py - w.y1) * ey) / len2));
    return Math.hypot(px - (w.x1 + t * ex), py - (w.y1 + t * ey));
}
