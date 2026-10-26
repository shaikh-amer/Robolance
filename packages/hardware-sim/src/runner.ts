// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Runs firmware on a circuit for a span of simulated time with scripted
 * inputs, and records what happened: serial output, part states over time,
 * the robot's path and a score. The agent reads the trace; the display
 * replays it.
 */

import { Board } from './board.js';
import { Button, Potentiometer, type Component } from './components.js';
import { buildCircuit, type Diagram } from './diagram.js';
import type { ArenaEvent, RobotPose } from './arena.js';

export type ScriptedEvent =
    | { atMs: number; action: 'press' | 'release'; part: string }
    | { atMs: number; action: 'tap'; part: string; holdMs?: number }
    | { atMs: number; action: 'set'; part: string; value: number }
    | { atMs: number; action: 'serial'; text: string };

export interface RunOptions {
    /** Simulated time to run, ms. */
    durationMs: number;
    events?: ScriptedEvent[];
    /** How often part states are recorded, ms. */
    sampleEveryMs?: number;
    /** Physics step, ms. */
    tickMs?: number;
    /** Give up after this much wall-clock time. */
    maxRealMs?: number;
    /** Called after every tick (for a live display). */
    onTick?: (timeMs: number) => void;
}

export interface Sample {
    atMs: number;
    parts: Record<string, Record<string, unknown>>;
}

export interface RunTrace {
    durationMs: number;
    /** Simulated time actually covered (less than durationMs when the wall-clock limit hit). */
    ranMs: number;
    serial: string[];
    samples: Sample[];
    final: Record<string, Record<string, unknown>>;
    arena?: {
        path: RobotPose[];
        events: ArenaEvent[];
        collisions: number;
        reachedGoalAtMs: number | null;
        bestDistanceToGoalCm: number;
        finalDistanceToGoalCm: number;
        score: number;
        state: Record<string, unknown>;
    };
    /** What the agent should know that the numbers do not say. */
    notes: string[];
}

/** Runs `hex` on the circuit described by `diagram`. */
export function runScenario(hex: string, diagram: Diagram, options: RunOptions): RunTrace {
    const board = new Board(hex);
    const circuit = buildCircuit(diagram, board);
    const tickMs = options.tickMs ?? 5;
    const sampleEveryMs = options.sampleEveryMs ?? 250;
    const events = [...(options.events ?? [])].sort((a, b) => a.atMs - b.atMs);
    const expanded: ScriptedEvent[] = [];
    for (const event of events) {
        if (event.action === 'tap') {
            expanded.push({ atMs: event.atMs, action: 'press', part: event.part });
            expanded.push({ atMs: event.atMs + (event.holdMs ?? 100), action: 'release', part: event.part });
        } else {
            expanded.push(event);
        }
    }
    expanded.sort((a, b) => a.atMs - b.atMs);

    const notes: string[] = [];
    const samples: Sample[] = [];
    const started = Date.now();
    const maxRealMs = options.maxRealMs ?? 20_000;
    let timeMs = 0;
    let nextSampleMs = 0;
    let nextEvent = 0;
    let timedOut = false;

    const snapshot = (): Record<string, Record<string, unknown>> => {
        const parts: Record<string, Record<string, unknown>> = {};
        for (const [id, part] of circuit.parts) {
            parts[id] = part.state();
        }
        return parts;
    };

    while (timeMs < options.durationMs) {
        while (nextEvent < expanded.length && expanded[nextEvent].atMs <= timeMs) {
            apply(expanded[nextEvent], circuit.parts, board, notes);
            nextEvent += 1;
        }
        if (timeMs >= nextSampleMs) {
            samples.push({ atMs: timeMs, parts: snapshot() });
            nextSampleMs += sampleEveryMs;
        }
        board.step(tickMs * 1000);
        timeMs += tickMs;
        circuit.arena?.tick(tickMs);
        options.onTick?.(timeMs);
        if (Date.now() - started > maxRealMs) {
            timedOut = true;
            break;
        }
    }
    if (timedOut) {
        notes.push(`the simulation stopped at ${timeMs} ms of ${options.durationMs} ms: the wall-clock limit was reached`);
    }
    const final = snapshot();
    const serial = board.serialLines.filter((line, i, all) => line !== '' || i < all.length - 1);
    if (serial.length === 0) {
        notes.push('nothing was printed on Serial');
    }
    for (const [id, part] of circuit.parts) {
        if (part.kind === 'led' && !samples.some(s => s.parts[id]?.on === true) && final[id]?.on !== true) {
            notes.push(`${id} (led on pin ${final[id]?.pin}) never turned on`);
        }
        if (part.kind === 'servo' && final[id]?.angle === null) {
            notes.push(`${id} (servo on pin ${final[id]?.pin}) never received a pulse: is it attached and written?`);
        }
    }
    const trace: RunTrace = { durationMs: options.durationMs, ranMs: timeMs, serial, samples, final, notes };
    const arena = circuit.arena;
    if (arena) {
        const reached = arena.reachedGoalAtMs !== undefined;
        const startDistance = Math.hypot(arena.spec.start.x - arena.spec.goal.x, arena.spec.start.y - arena.spec.goal.y);
        const progress = Math.max(0, Math.min(1, 1 - arena.bestDistanceToGoal / startDistance));
        const timeBonus = reached ? Math.max(0, 20 * (1 - arena.reachedGoalAtMs! / options.durationMs)) : 0;
        const score = Math.round(Math.max(0, (reached ? 80 : progress * 60) + timeBonus - arena.collisions * 5));
        trace.arena = {
            path: arena.path,
            events: arena.events,
            collisions: arena.collisions,
            reachedGoalAtMs: arena.reachedGoalAtMs ?? null,
            bestDistanceToGoalCm: Math.round(arena.bestDistanceToGoal * 10) / 10,
            finalDistanceToGoalCm: Math.round(arena.distanceToGoal() * 10) / 10,
            score,
            state: arena.state(),
        };
        if (!reached) {
            const moved = arena.path.length > 1 && Math.hypot(arena.path[arena.path.length - 1].x - arena.spec.start.x, arena.path[arena.path.length - 1].y - arena.spec.start.y) > 1;
            notes.push(moved
                ? `the robot did not reach the goal; it got within ${trace.arena.bestDistanceToGoalCm} cm, with ${arena.collisions} collision(s)`
                : 'the robot never moved: check the motor pins (in1/in2 direction, en PWM) and that the sketch drives them');
        }
    }
    return trace;
}

function apply(event: ScriptedEvent, parts: Map<string, Component>, board: Board, notes: string[]): void {
    if (event.action === 'serial') {
        board.serialIn(event.text);
        return;
    }
    const part = parts.get(event.part);
    if (!part) {
        notes.push(`scripted event at ${event.atMs} ms names an unknown part ${event.part}`);
        return;
    }
    if ((event.action === 'press' || event.action === 'release') && part instanceof Button) {
        if (event.action === 'press') {
            part.press();
        } else {
            part.release();
        }
        return;
    }
    if (event.action === 'set' && part instanceof Potentiometer) {
        part.set(event.value);
        return;
    }
    if (event.action === 'set' && 'distanceCm' in part) {
        (part as { distanceCm: number }).distanceCm = event.value;
        return;
    }
    notes.push(`scripted event at ${event.atMs} ms: ${event.action} does not apply to ${part.kind} ${event.part}`);
}
