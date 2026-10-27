// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * `diagram.json`: the circuit the agent (or the user) describes next to the
 * sketch. Parts are wired by Arduino pin numbers; an optional arena puts two
 * motors and a distance sensor on a robot in a maze.
 */

import { Arena, ARENA_PRESET_NAMES, arenaPreset, DEFAULT_ROBOT, type ArenaPreset, type ArenaSpec, type LineSensorMount, type RobotSpec } from './arena.js';
import type { Board, PinName } from './board.js';
import { Button, Led, LineSensor, Motor, Potentiometer, Servo, Ultrasonic, type Component } from './components.js';

export type PartSpec =
    | { type: 'led'; id: string; pin: PinName; color?: string; activeLow?: boolean }
    | { type: 'button'; id: string; pin: PinName; activeHigh?: boolean }
    | { type: 'servo'; id: string; pin: PinName }
    | { type: 'ultrasonic'; id: string; trig: PinName; echo: PinName }
    | { type: 'potentiometer'; id: string; pin: `A${0 | 1 | 2 | 3 | 4 | 5}` }
    | { type: 'motor'; id: string; in1: PinName; in2: PinName; en: PinName }
    /** A reflectance sensor under the robot; forwardCm/leftCm say where (defaults: at the front, centred). */
    | { type: 'linesensor'; id: string; pin: PinName; forwardCm?: number; leftCm?: number; activeHigh?: boolean };

export interface ArenaBinding {
    /** A built-in arena, or a full spec. */
    preset?: ArenaPreset;
    spec?: ArenaSpec;
    robot?: Partial<RobotSpec>;
    /** Part ids of the two motors and the forward-facing distance sensor. */
    left: string;
    right: string;
    sensor?: string;
}

export interface Diagram {
    board?: 'uno';
    parts: PartSpec[];
    arena?: ArenaBinding;
}

export const PART_TYPES = ['led', 'button', 'servo', 'ultrasonic', 'potentiometer', 'motor', 'linesensor'] as const;

/** Checks a diagram and names the first problem, or returns undefined. */
export function validateDiagram(diagram: unknown): string | undefined {
    if (!diagram || typeof diagram !== 'object') {
        return 'diagram must be an object';
    }
    const d = diagram as Diagram;
    if (!Array.isArray(d.parts)) {
        return 'diagram.parts must be an array';
    }
    const ids = new Set<string>();
    const pins = new Map<string, string>();
    const claim = (pin: unknown, owner: string): string | undefined => {
        const key = String(pin);
        if (!validPin(pin)) {
            return `${owner}: ${key} is not an Uno pin (0-13 or A0-A5)`;
        }
        const other = pins.get(key);
        if (other) {
            return `${owner} and ${other} both use pin ${key}`;
        }
        pins.set(key, owner);
        return undefined;
    };
    for (const part of d.parts) {
        if (!part || typeof part !== 'object' || !PART_TYPES.includes(part.type)) {
            return `unknown part type ${JSON.stringify((part as { type?: unknown })?.type)}; use one of ${PART_TYPES.join(', ')}`;
        }
        if (!part.id || ids.has(part.id)) {
            return `part ids must be unique and non-empty (${part.id})`;
        }
        ids.add(part.id);
        const owner = `${part.type} ${part.id}`;
        const pinFields = part.type === 'ultrasonic' ? [part.trig, part.echo]
            : part.type === 'motor' ? [part.in1, part.in2, part.en]
            : [part.pin];
        for (const pin of pinFields) {
            const problem = claim(pin, owner);
            if (problem) {
                return problem;
            }
        }
        if (part.type === 'potentiometer' && typeof part.pin !== 'string') {
            return `${owner}: a potentiometer needs an analog pin (A0-A5)`;
        }
    }
    if (d.arena) {
        for (const role of ['left', 'right'] as const) {
            const part = d.parts.find(p => p.id === d.arena![role]);
            if (!part || part.type !== 'motor') {
                return `arena.${role} must name a motor part`;
            }
        }
        if (d.arena.sensor) {
            const part = d.parts.find(p => p.id === d.arena!.sensor);
            if (!part || part.type !== 'ultrasonic') {
                return 'arena.sensor must name an ultrasonic part';
            }
        }
        if (!d.arena.preset && !d.arena.spec) {
            return 'arena needs a preset or a spec';
        }
        if (d.arena.preset && !ARENA_PRESET_NAMES.includes(d.arena.preset)) {
            return `arena.preset must be one of ${ARENA_PRESET_NAMES.join(', ')}`;
        }
    }
    return undefined;
}

function validPin(pin: unknown): boolean {
    return (typeof pin === 'number' && Number.isInteger(pin) && pin >= 0 && pin <= 13)
        || (typeof pin === 'string' && /^A[0-5]$/.test(pin));
}

export interface Circuit {
    parts: Map<string, Component>;
    arena?: Arena;
}

/** Builds the parts (and the arena) of a diagram and attaches them to the board. */
export function buildCircuit(diagram: Diagram, board: Board): Circuit {
    const problem = validateDiagram(diagram);
    if (problem) {
        throw new Error(problem);
    }
    const parts = new Map<string, Component>();
    for (const spec of diagram.parts) {
        const part = makePart(spec);
        part.attach(board);
        parts.set(spec.id, part);
    }
    let arena: Arena | undefined;
    if (diagram.arena) {
        const spec = diagram.arena.spec ?? arenaPreset(diagram.arena.preset);
        const robot = { ...DEFAULT_ROBOT, ...diagram.arena.robot };
        const mounts: LineSensorMount[] = [];
        for (const part of diagram.parts) {
            if (part.type === 'linesensor') {
                mounts.push({ sensor: parts.get(part.id) as LineSensor, forwardCm: part.forwardCm ?? robot.radius, leftCm: part.leftCm ?? 0 });
            }
        }
        arena = new Arena(
            spec,
            parts.get(diagram.arena.left) as Motor,
            parts.get(diagram.arena.right) as Motor,
            diagram.arena.sensor ? parts.get(diagram.arena.sensor) as Ultrasonic : undefined,
            robot,
            mounts,
        );
    }
    return { parts, arena };
}

function makePart(spec: PartSpec): Component {
    switch (spec.type) {
        case 'led': return new Led(spec.id, spec.pin, spec.color, spec.activeLow);
        case 'button': return new Button(spec.id, spec.pin, spec.activeHigh);
        case 'servo': return new Servo(spec.id, spec.pin);
        case 'ultrasonic': return new Ultrasonic(spec.id, spec.trig, spec.echo);
        case 'potentiometer': return new Potentiometer(spec.id, spec.pin);
        case 'motor': return new Motor(spec.id, spec.in1, spec.in2, spec.en);
        case 'linesensor': return new LineSensor(spec.id, spec.pin, spec.activeHigh ?? true);
    }
}
