// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * A controller is a small script the agent writes: it defines
 * `control(sim)`, called at the control rate, and optionally `init(sim)`,
 * called once. Top-level variables keep their values between calls, so
 * state machines and filters are plain code. It runs in its own V8
 * context, so its globals and mistakes stay out of the tool's, and every
 * call has a time limit, so a loop that never ends stops the run instead
 * of the tool. (A V8 context is not a security boundary; the tool runs in
 * the project's sandbox, where the agent can run code anyway.)
 */

import vm from 'node:vm';

export interface ControllerApi {
    /** Simulated time, s. */
    readonly t: number;
    joint(name: string): { q: number | number[]; v: number | number[] };
    body(name: string): { pos: number[]; quat: number[] };
    site(name: string): number[];
    sensor(name: string): number[];
    actuators(): string[];
    /** Sets an actuator's control (clamped to its ctrlrange). */
    ctrl(actuator: string | number, value: number): void;
    ctrlRange(actuator: string | number): [number, number] | null;
    contacts(): Array<{ a: string; b: string; depth: number }>;
    /** Records a named time series for the run's charts and the agent's report. */
    metric(name: string, value: number): void;
    log(...values: unknown[]): void;
    /** Ends the run (a goal reached, a failure detected). */
    stop(reason?: string): void;
}

export interface Controller {
    init?: (sim: ControllerApi) => void;
    control: (sim: ControllerApi) => void;
}

/** Per call, ms. A controller that needs more is doing something wrong at 50 Hz. */
const CALL_LIMIT_MS = 250;

export function createController(source: string): Controller {
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    // Math, JSON and friends come with every context; nothing from Node is added.
    new vm.Script(source, { filename: 'controller.js' }).runInContext(context, { timeout: 1000 });
    const call = (name: string) => {
        const fn = vm.runInContext(`typeof ${name} === 'function' ? ${name} : undefined`, context, { timeout: 50 }) as unknown;
        if (!fn) {
            return undefined;
        }
        // Calls go through the context with a timeout, so an endless loop in control() ends the run.
        const invoke = new vm.Script(`${name}(globalThis.__sim)`);
        return (sim: ControllerApi) => {
            (context as Record<string, unknown>).__sim = sim;
            invoke.runInContext(context, { timeout: CALL_LIMIT_MS });
        };
    };
    const control = call('control');
    if (!control) {
        throw new Error('the controller must define function control(sim)');
    }
    return { control, init: call('init') };
}
