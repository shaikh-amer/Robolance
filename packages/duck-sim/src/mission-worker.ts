// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Worker side of runMission: builds the world, runs the mission program in
 * its own VM context with only the duck API in scope, and posts the result.
 */

import { parentPort, workerData } from 'node:worker_threads';
import * as vm from 'node:vm';
import { loadAssets } from './node-assets.js';
import { DuckFell, DuckWorld, RunOver, TimeUp, round } from './world.js';
import { LAPTOP } from './field.js';
import { ballToGoal, laptopScore, missionNotes, missionScore, type MissionOutcome, type WorkerInput, type WorkerReply } from './mission.js';

const MAX_LOG_LINES = 200;
const MAX_LOG_CHARS = 500;
const SETTLE_S = 2;

async function main(input: WorkerInput): Promise<void> {
    const assets = await loadAssets(input.assetsDir);
    const world = await DuckWorld.create(assets, { field: input.field, limitS: input.limitS, frameHz: input.frameHz, skills: input.skills });
    const logs: string[] = [];
    const log = (...values: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) {
            logs.push(values.map(show).join(' ').slice(0, MAX_LOG_CHARS));
        } else if (logs.length === MAX_LOG_LINES) {
            logs.push(`... log limited to ${MAX_LOG_LINES} lines`);
        }
    };
    const r3 = (v: number) => round(v, 3);
    const num = (v: unknown, name: string) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            throw new TypeError(`${name} must be a finite number`);
        }
        return v;
    };
    // When the run is over (a fall, the time limit, a goal or an out) the result is
    // sent at once: a mission that catches the error and carries on would
    // otherwise spin until the wall-clock limit and lose it.
    const act = <T>(run: () => Promise<T>): Promise<T> =>
        run().catch((err: unknown) => {
            if (world.over) {
                void finish(err);
            }
            throw err;
        });
    const duck = Object.freeze({
        pose: () => {
            const p = world.pose();
            return { x: r3(p.x), y: r3(p.y), heading: round(p.heading, 1) };
        },
        ball: () => {
            const b = world.ball();
            return { x: r3(b.x), y: r3(b.y) };
        },
        ballRelative: () => {
            const b = world.ballRelative();
            return { forward: r3(b.forward), left: r3(b.left), distance: r3(b.distance), bearing: round(b.bearing, 1) };
        },
        time: () => world.time,
        scored: () => world.scoredAtS !== null,
        laptop: () => {
            const l = input.field.laptop;
            const deg = world.lidDeg();
            return l && deg !== null ? { x: l.x, y: l.y, heading: l.heading, lidDeg: round(deg, 1), closed: world.closedAtS !== null } : null;
        },
        turnTo: (heading: unknown) => act(() => world.turnTo(num(heading, 'heading'))),
        walkTo: (x: unknown, y: unknown) => act(() => world.walkTo(num(x, 'x'), num(y, 'y'))),
        walkForward: (metres: unknown, shiftLeft: unknown = 0) =>
            act(() => world.walkForward(num(metres, 'metres'), num(shiftLeft, 'shiftLeft')).then(r3)),
        walk: (forward: unknown, turn: unknown, seconds: unknown) =>
            act(() => world.walk(num(forward, 'forward'), num(turn, 'turn'), Math.min(num(seconds, 'seconds'), input.limitS))),
        stand: (seconds: unknown) => act(() => world.walk(0, 0, Math.min(num(seconds, 'seconds'), input.limitS))),
        skill: (name: unknown, seconds: unknown, command: unknown = []) => {
            if (typeof name !== 'string') {
                throw new TypeError('skill takes a skill name');
            }
            if (!Array.isArray(command)) {
                throw new TypeError('command is an array of numbers');
            }
            const cmd = command.map((v, i) => num(v, `command[${i}]`));
            return act(() => world.runSkill(name, Math.min(num(seconds, 'seconds'), input.limitS), cmd));
        },
        skills: () => world.extraSkills,
        kick: (side: unknown) => {
            if (side !== 'left' && side !== 'right') {
                throw new TypeError("kick takes 'left' or 'right'");
            }
            return act(() => world.kick(side));
        },
    });
    const context = vm.createContext({ duck, field: structuredClone(input.field), log, console: Object.freeze({ log }) });

    let finished: Promise<WorkerReply> | undefined;
    const finish = (thrown: unknown): Promise<WorkerReply> => (finished ??= report(thrown));
    const report = async (thrown: unknown): Promise<WorkerReply> => {
        // Let a ball that is still rolling reach the line.
        if (!world.over) {
            try {
                await world.walk(0, 0, Math.min(SETTLE_S, world.limitS - world.time));
            } catch {
                // the run ended meanwhile; the world records why
            }
        }
        let outcome: MissionOutcome;
        let error: string | undefined;
        const laptopTask = Boolean(input.field.laptop);
        if (laptopTask && world.closedAtS !== null) {
            outcome = 'closed';
        } else if (!laptopTask && world.scoredAtS !== null) {
            outcome = 'goal';
        } else if (world.fallen) {
            outcome = 'fell';
        } else if (thrown instanceof TimeUp || world.time >= world.limitS) {
            outcome = 'time-up';
        } else if (thrown !== undefined && !(thrown instanceof DuckFell) && !(thrown instanceof RunOver)) {
            outcome = 'error';
            error = describe(thrown);
        } else {
            outcome = laptopTask ? 'still-open' : 'no-goal';
        }
        const start = ballToGoal(input.field.ball, input.field);
        const openDeg = input.field.laptop ? (input.field.laptop.openDeg ?? LAPTOP.defaultOpenDeg) : 0;
        const score = laptopTask
            ? laptopScore({ closedAtS: world.closedAtS, fell: world.fallen, limitS: world.limitS, openDeg, lowestLidDeg: world.lowestLidDeg ?? openDeg })
            : missionScore({
                scoredAtS: world.scoredAtS, fell: world.fallen, limitS: world.limitS,
                ballToGoalStart: start, closestBallToGoal: world.closestBallToGoal,
            });
        const events = [...world.events].sort((a, b) => a.atS - b.atS);
        const kicks = world.kicks.map(k => ({ ...k }));
        const p = world.pose();
        const b = world.ball();
        const reply: WorkerReply = {
            ok: true,
            result: {
                outcome, score, scoredAtS: world.scoredAtS, simS: round(world.time, 2), error, logs: [...logs],
                events: events.map(e => ({ ...e })), kicks,
                notes: missionNotes({
                    outcome, error, events, kicks, scoredAtS: world.scoredAtS, simS: world.time, limitS: world.limitS, score,
                    ...(laptopTask ? { laptop: { openDeg, lowestLidDeg: round(world.lowestLidDeg ?? openDeg, 1), closedAtS: world.closedAtS } } : {}),
                }),
                final: {
                    duck: { x: r3(p.x), y: r3(p.y), heading: round(p.heading, 1) }, ball: { x: r3(b.x), y: r3(b.y) },
                    ...(laptopTask ? { lidDeg: round(world.lidDeg() ?? 0, 1) } : {}),
                },
                ...(laptopTask ? { closedAtS: world.closedAtS } : {}),
                ballToGoalStart: r3(start), closestBallToGoal: r3(world.closestBallToGoal),
                field: input.field, limitS: world.limitS, path: [...world.path],
                replay: { frameHz: input.frameHz, qposSize: world.qposSize, frames: [...world.frames] },
            },
        };
        parentPort!.postMessage(reply);
        return reply;
    };

    try {
        const script = new vm.Script(`(async () => {${input.code}\n})()`, { filename: 'mission.js' });
        await script.runInContext(context);
        await finish(undefined);
    } catch (err) {
        await finish(err);
    }
}

/** An error's message with the mission line it came from. */
function describe(err: unknown): string {
    const message = err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : String(err);
    const stack = err && typeof err === 'object' && 'stack' in err ? String((err as Error).stack) : '';
    const line = /mission\.js:(\d+)/.exec(stack)?.[1];
    const name = err && typeof err === 'object' && 'name' in err ? String((err as Error).name) : 'Error';
    return `${name}: ${message}${line ? ` (line ${line})` : ''}`;
}

function show(v: unknown): string {
    if (typeof v === 'string') {
        return v;
    }
    try {
        return JSON.stringify(v) ?? String(v);
    } catch {
        return String(v);
    }
}

main(workerData as WorkerInput).catch(err => parentPort!.postMessage({ ok: false, error: describe(err) } satisfies WorkerReply));
