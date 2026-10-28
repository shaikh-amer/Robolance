// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * A mission is a short async JavaScript program that drives the duck. It
 * runs in a worker thread inside its own VM context with only `duck`,
 * `field` and `log` in scope, under a simulated-time limit and a
 * wall-clock limit. The result says what happened, scores it and explains
 * misses in words an agent can act on.
 *
 * The VM context keeps a mission from reaching Node by accident; it is not
 * a security boundary. Missions come from the user's own agent and run
 * with the same trust as the commands it already runs in that workspace.
 */

import { Worker } from 'node:worker_threads';
import { DEFAULT_FIELD, validateField, type FieldSpec } from './field.js';
import type { DuckEvent, KickRecord, Pose } from './world.js';

/** What the mission program can call; shown to the agent as the API. */
export const MISSION_API = `Your mission is the body of an async function. In scope:

field                 the pitch: { duck: {x, y, heading}, ball: {x, y}, goal: {x, y, width}, bounds }
                      metres; x points at the goal line, y to the left; headings in degrees, counter-clockwise from +x
log(...values)        writes a line to the run's log

duck.pose()           -> { x, y, heading }
duck.ball()           -> { x, y }        the ball on the field
duck.ballRelative()   -> { forward, left, distance, bearing }   the ball from the duck: metres ahead, metres to its left
duck.time()           -> simulated seconds so far
duck.scored()         -> true once the ball is in the goal

await duck.turnTo(heading)          turns on the spot to a field heading; ends within ~8 degrees -> the error left.
                                    It cannot turn less than ~13 degrees on the spot
await duck.walkTo(x, y)             walks to a point, steering as it goes; stops within ~4 cm -> true if it got there.
                                    Turns first when the point is off to the side or behind
await duck.walkForward(m, shift)    walks m metres ahead on the line it faces, or on a parallel line shift metres to its
                                    left (negative: right, at most 0.1) -> metres travelled. 5 cm steps work
await duck.walk(forward, turn, s)   raw velocity command: forward 0-0.6 m/s, turn ±1.5 rad/s (left positive) for s seconds.
                                    Below 0.3 m/s or under a second it barely moves; it cannot step sideways or backwards
await duck.stand(s)                 stands still
await duck.kick('left' | 'right')   kicks with that foot -> { ballForward, ballLeft, ballMoved, ballDirection, goalDirection }.
                                    It first stands until settled (a kick straight out of a walk does not connect)

await duck.skill(name, seconds, command?)
                                    runs a trained skill as it is for that long: one of the project's own policies passed
                                    to the run (getUp, roll, ...), or walk, stand, kickLeft, kickRight. command is up to
                                    13 numbers: [forward m/s, sideways m/s, turn rad/s, head pose (4), body pose (6)],
                                    zero when left out. Tipping over during a project skill is part of the move; the run
                                    counts a fall only if the duck is still down once it stands again
duck.skills()         -> the project's own skill names in this run

A kick connects when the ball is 6-8 cm ahead and 1.5-8 cm to the kicking foot's side, and sends the ball 0.4-0.8 m.
Where the ball sits across the foot changes the direction it goes.
The feet are 6 cm either side of the duck's centre line. Walking up to a ball more than ~2 cm off the centre line, the
swinging foot can nudge it a few cm further ahead: check ballRelative() before kicking and step up again if needed.
The duck falls if it is driven too hard; a fall ends the run. So does the time limit, and the run stops a second after
a goal or after the ball goes out (wide of the posts or off the pitch).`;

export interface MissionOptions {
    field?: FieldSpec;
    /** Longest simulated time, seconds (default 40, at most 120). */
    limitS?: number;
    /** Longest real time, milliseconds (default 60 000). */
    wallMs?: number;
    /** Replay samples per second (default 25). */
    frameHz?: number;
    /** Where the model and skills are (default: the package's assets). */
    assetsDir?: string;
    /**
     * The project's own trained policies (ONNX bytes) by name: walk, stand,
     * kickLeft and kickRight replace the built-ins, other names become skills
     * the mission runs with duck.skill(name, seconds).
     */
    skills?: Record<string, Uint8Array>;
}

export type MissionOutcome = 'goal' | 'no-goal' | 'fell' | 'time-up' | 'error' | 'timeout';

export interface MissionReplay {
    frameHz: number;
    /** Values per frame: the duck's free joint (7), its joints, then the ball's free joint (7). */
    qposSize: number;
    frames: number[][];
}

export interface MissionResult {
    outcome: MissionOutcome;
    /** 0-100: a goal is 70 plus up to 20 for speed and 10 for staying up. */
    score: number;
    scoredAtS: number | null;
    simS: number;
    wallMs: number;
    /** The mission's own error (syntax, a thrown exception), if any. */
    error?: string;
    logs: string[];
    events: DuckEvent[];
    kicks: KickRecord[];
    notes: string[];
    final: { duck: Pose; ball: { x: number; y: number } };
    /** Metres from the ball to the goal mouth at the start, and at its closest. */
    ballToGoalStart: number;
    closestBallToGoal: number;
    field: FieldSpec;
    limitS: number;
    path: Array<[number, number]>;
    replay?: MissionReplay;
}

/** What the worker hands back; the main thread adds timing. */
export type WorkerReply = { ok: true; result: Omit<MissionResult, 'wallMs'> } | { ok: false; error: string };

export interface WorkerInput {
    code: string;
    field: FieldSpec;
    limitS: number;
    frameHz: number;
    assetsDir?: string;
    skills?: Record<string, Uint8Array>;
}

export const MAX_LIMIT_S = 120;
export const MAX_CODE_BYTES = 64 * 1024;

/** Runs a mission program and reports what happened. */
export async function runMission(code: string, options: MissionOptions = {}): Promise<MissionResult> {
    const field = options.field ?? DEFAULT_FIELD;
    const problem = validateField(field);
    if (problem) {
        throw new Error(`field: ${problem}`);
    }
    if (Buffer.byteLength(code) > MAX_CODE_BYTES) {
        throw new Error(`the mission is limited to ${MAX_CODE_BYTES / 1024} KB`);
    }
    const limitS = Math.min(MAX_LIMIT_S, Math.max(1, options.limitS ?? 40));
    const wallMs = Math.max(1000, options.wallMs ?? 60_000);
    const input: WorkerInput = { code, field, limitS, frameHz: options.frameHz ?? 25, assetsDir: options.assetsDir, skills: options.skills };
    const started = Date.now();
    const worker = new Worker(new URL('./mission-worker.js', import.meta.url), {
        workerData: input,
        resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    const reply = await new Promise<WorkerReply | 'timeout'>(resolve => {
        const timer = setTimeout(() => resolve('timeout'), wallMs);
        const done = (r: WorkerReply | 'timeout') => {
            clearTimeout(timer);
            resolve(r);
        };
        worker.once('message', (m: WorkerReply) => done(m));
        worker.once('error', err => done({ ok: false, error: err instanceof Error ? err.message : String(err) }));
        worker.once('exit', exitCode => done({ ok: false, error: `the mission worker stopped (exit ${exitCode})` }));
    });
    await worker.terminate();
    const elapsed = Date.now() - started;
    if (reply === 'timeout') {
        return failed(field, limitS, elapsed, 'timeout', `the mission ran for more than ${Math.round(wallMs / 1000)} s of real time; it probably loops without calling a duck action`);
    }
    if (!reply.ok) {
        return failed(field, limitS, elapsed, 'error', reply.error);
    }
    return { ...reply.result, wallMs: elapsed };
}

function failed(field: FieldSpec, limitS: number, wallMs: number, outcome: MissionOutcome, error: string): MissionResult {
    const d = ballToGoal(field.ball, field);
    return {
        outcome, score: 0, scoredAtS: null, simS: 0, wallMs, error, logs: [], events: [], kicks: [],
        notes: [error], final: { duck: { ...field.duck }, ball: { ...field.ball } },
        ballToGoalStart: d, closestBallToGoal: d, field, limitS, path: [],
    };
}

/** Distance from a point to the goal mouth (0 on or past the line between the posts). */
export function ballToGoal(b: { x: number; y: number }, f: FieldSpec): number {
    const g = f.goal;
    const dy = Math.max(0, Math.abs(b.y - g.y) - g.width / 2);
    return Math.hypot(Math.max(0, g.x - b.x), dy);
}

export interface ScoreInput {
    scoredAtS: number | null;
    fell: boolean;
    limitS: number;
    ballToGoalStart: number;
    closestBallToGoal: number;
}

export function missionScore(s: ScoreInput): number {
    if (s.scoredAtS !== null) {
        return Math.round(70 + 20 * Math.max(0, 1 - s.scoredAtS / s.limitS) + (s.fell ? 0 : 10));
    }
    const progress = s.ballToGoalStart > 0 ? Math.min(1, Math.max(0, 1 - s.closestBallToGoal / s.ballToGoalStart)) : 0;
    return Math.max(0, Math.round(50 * progress - (s.fell ? 15 : 0)));
}

export interface NotesInput {
    outcome: MissionOutcome;
    error?: string;
    events: DuckEvent[];
    kicks: KickRecord[];
    scoredAtS: number | null;
    simS: number;
    limitS: number;
    score: number;
}

/** Plain-language feedback: what happened and what to change. */
export function missionNotes(r: NotesInput): string[] {
    const notes: string[] = [];
    if (r.outcome === 'goal') {
        notes.push(`Goal at ${r.scoredAtS} s. Score ${r.score}/100.`);
    } else if (r.outcome === 'error' && r.error) {
        notes.push(`The mission threw: ${r.error}`);
    }
    for (const e of r.events) {
        if (e.kind === 'bump') {
            notes.push(`At ${e.atS} s ${e.detail}. A swinging foot reaches a ball more than ~2 cm off the duck's centre line, so the ball now sits further ahead than planned: check ballRelative() and step up again before kicking.`);
        }
    }
    for (const k of r.kicks) {
        const side = k.ballLeft >= 0 ? 'left' : 'right';
        const where = `${cm(k.ballForward)} cm ahead and ${cm(Math.abs(k.ballLeft))} cm to the ${side}`;
        if (k.ballMoved < 0.05) {
            if (side !== k.side && Math.abs(k.ballLeft) > 0.01) {
                notes.push(`${k.atS} s: ${k.side} kick missed - the ball was ${where}. It was on the ${side} side: kick('${side}').`);
            } else {
                notes.push(`${k.atS} s: ${k.side} kick missed - the ball was ${where}. It needs to be 6-8 cm ahead and 1.5-8 cm to the ${k.side}.`);
            }
            continue;
        }
        let line = `${k.atS} s: ${k.side} kick with the ball ${where} sent it ${cm(k.ballMoved)} cm`;
        if (k.ballDirection !== null && r.outcome !== 'goal') {
            const off = wrapDeg(k.ballDirection - k.goalDirection);
            line += ` at ${k.ballDirection} degrees; the goal centre was at ${k.goalDirection} degrees from the ball`;
            if (Math.abs(off) > 8) {
                line += ` (${Math.abs(Math.round(off))} degrees too far ${off > 0 ? 'left' : 'right'})`;
            }
        }
        notes.push(`${line}.`);
    }
    for (const e of r.events) {
        if (e.kind === 'out' || e.kind === 'fell') {
            notes.push(`${e.atS} s: ${e.detail}.`);
        }
    }
    if (r.outcome !== 'goal' && r.kicks.length === 0 && r.outcome !== 'error') {
        notes.push('The duck never kicked the ball.');
    }
    if (r.outcome === 'fell') {
        notes.push('A fall ends the run. Keep forward at or below 0.5 m/s and turn at or below 1.3 rad/s, and let the duck settle (stand) before kicking.');
    }
    if (r.outcome === 'time-up') {
        notes.push(`The mission used the whole ${r.limitS} s.`);
    }
    if (r.outcome === 'no-goal' && r.kicks.some(k => k.ballMoved >= 0.05)) {
        notes.push(`No goal. Score ${r.score}/100 for getting the ball closer.`);
    }
    return notes;
}

function wrapDeg(d: number): number {
    return ((((d + 180) % 360) + 360) % 360) - 180;
}

function cm(m: number): number {
    return Math.round(m * 100);
}
