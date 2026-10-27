// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * One firmware running on one circuit, advanced in fixed physics ticks.
 * `runScenario` drives it headless for the agent; the IDE drives it from
 * requestAnimationFrame for a live view. Both see the same world.
 */

import { Board } from './board.js';
import { Button, LineSensor, Potentiometer, Ultrasonic, type Component } from './components.js';
import { buildCircuit, type Circuit, type Diagram } from './diagram.js';
import type { Arena } from './arena.js';

export type SimulationInput =
    | { action: 'press' | 'release'; part: string }
    | { action: 'set'; part: string; value: number }
    | { action: 'serial'; text: string };

export class Simulation {
    readonly board: Board;
    readonly parts: Map<string, Component>;
    readonly arena?: Arena;
    readonly tickMs: number;
    /** Simulated time covered so far, ms. */
    timeMs = 0;

    constructor(hex: string, diagram: Diagram, tickMs = 5) {
        this.board = new Board(hex);
        const circuit: Circuit = buildCircuit(diagram, this.board);
        this.parts = circuit.parts;
        this.arena = circuit.arena;
        this.tickMs = tickMs;
    }

    /** Advances by `ms` of simulated time in whole ticks (at least one). */
    advance(ms: number): void {
        const ticks = Math.max(1, Math.round(ms / this.tickMs));
        for (let i = 0; i < ticks; i++) {
            this.board.step(this.tickMs * 1000);
            this.timeMs += this.tickMs;
            this.arena?.tick(this.tickMs);
        }
    }

    /** Applies a user or scripted input; returns a problem description when it does not fit. */
    apply(input: SimulationInput): string | undefined {
        if (input.action === 'serial') {
            this.board.serialIn(input.text);
            return undefined;
        }
        const part = this.parts.get(input.part);
        if (!part) {
            return `unknown part ${input.part}`;
        }
        if ((input.action === 'press' || input.action === 'release') && part instanceof Button) {
            if (input.action === 'press') {
                part.press();
            } else {
                part.release();
            }
            return undefined;
        }
        if (input.action === 'set' && part instanceof Potentiometer) {
            part.set(input.value);
            return undefined;
        }
        if (input.action === 'set' && part instanceof Ultrasonic) {
            part.distanceCm = input.value;
            return undefined;
        }
        if (input.action === 'set' && part instanceof LineSensor) {
            part.set(input.value >= 0.5);
            return undefined;
        }
        return `${input.action} does not apply to ${part.kind} ${input.part}`;
    }

    /** Every part's state, keyed by id. */
    snapshot(): Record<string, Record<string, unknown>> {
        const out: Record<string, Record<string, unknown>> = {};
        for (const [id, part] of this.parts) {
            out[id] = part.state();
        }
        return out;
    }

    /** Serial output as lines; a line still being printed (no newline yet) is included, an empty tail is not. */
    get serialLines(): string[] {
        const lines = this.board.serialLines;
        return lines[lines.length - 1] === '' ? lines.slice(0, lines.length - 1) : lines.slice();
    }
}
