// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Runs the firmware in the browser in real time, so the user can press the
 * buttons and turn the knobs of the circuit the agent built. The board is
 * stepped from requestAnimationFrame; if a frame comes late the simulation
 * lags rather than racing ahead, which keeps interaction smooth.
 */

import * as React from 'react';
import { Simulation, type Diagram, type RobotPose, type SimulationInput } from '@robolance/hardware-sim';
import type { PartStates } from './CircuitView';

export interface LiveState {
    timeMs: number;
    states: PartStates;
    serial: string[];
    path: RobotPose[];
    distanceAheadCm?: number;
    reachedGoal: boolean;
    collisions: number;
    error?: string;
}

const MAX_STEP_MS = 60;

export interface LiveSimulation {
    live: LiveState | undefined;
    running: boolean;
    start(): void;
    stop(): void;
    reset(): void;
    apply(input: SimulationInput): void;
}

export function useLiveSimulation(hex: string | undefined, diagram: Diagram | undefined): LiveSimulation {
    const simRef = React.useRef<Simulation | undefined>(undefined);
    const frameRef = React.useRef<number | undefined>(undefined);
    const lastRef = React.useRef<number>(0);
    const [live, setLive] = React.useState<LiveState | undefined>(undefined);
    const [running, setRunning] = React.useState(false);

    const publish = React.useCallback((sim: Simulation, error?: string) => {
        const arena = sim.arena;
        setLive({
            timeMs: sim.timeMs,
            states: sim.snapshot(),
            serial: sim.serialLines.slice(-200),
            path: arena ? [...arena.path, { ...arena.pose, atMs: sim.timeMs }] : [],
            distanceAheadCm: arena?.distanceAhead(),
            reachedGoal: arena?.reachedGoalAtMs !== undefined,
            collisions: arena?.collisions ?? 0,
            error,
        });
    }, []);

    const stop = React.useCallback(() => {
        if (frameRef.current !== undefined) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = undefined;
        }
        setRunning(false);
    }, []);

    const reset = React.useCallback(() => {
        stop();
        simRef.current = undefined;
        setLive(undefined);
    }, [stop]);

    const start = React.useCallback(() => {
        if (!hex || !diagram) {
            return;
        }
        if (!simRef.current) {
            try {
                simRef.current = new Simulation(hex, diagram);
            } catch (err) {
                setLive({ timeMs: 0, states: {}, serial: [], path: [], reachedGoal: false, collisions: 0, error: err instanceof Error ? err.message : String(err) });
                return;
            }
        }
        const sim = simRef.current;
        lastRef.current = performance.now();
        setRunning(true);
        const frame = (now: number): void => {
            const elapsed = Math.min(MAX_STEP_MS, now - lastRef.current);
            lastRef.current = now;
            try {
                sim.advance(elapsed);
                publish(sim);
            } catch (err) {
                publish(sim, err instanceof Error ? err.message : String(err));
                stop();
                return;
            }
            frameRef.current = requestAnimationFrame(frame);
        };
        frameRef.current = requestAnimationFrame(frame);
    }, [hex, diagram, publish, stop]);

    const apply = React.useCallback((input: SimulationInput) => {
        const sim = simRef.current;
        if (sim) {
            sim.apply(input);
            publish(sim);
        }
    }, [publish]);

    // New firmware or a new circuit means a fresh board.
    React.useEffect(() => {
        reset();
    }, [hex, diagram, reset]);

    React.useEffect(() => stop, [stop]);

    return { live, running, start, stop, reset, apply };
}
