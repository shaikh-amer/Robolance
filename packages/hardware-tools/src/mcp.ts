// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The agent's hardware tools as an MCP server (stdio). OpenLance, or any
 * MCP client, gets: compile a sketch, run it on a circuit in the simulator
 * with scripted inputs, and a description of the parts and the diagram
 * format. Every run returns what the firmware did (serial, part states,
 * the robot's path and score) so the agent can fix what it wrote.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
    PART_TYPES,
    cornerMaze,
    runScenario,
    validateDiagram,
    type Diagram,
    type RunTrace,
    type ScriptedEvent,
} from 'robolance-hardware-sim';
import { buildSketch, type BuildOptions, type BuildResult } from './avrbuild.js';

const pinSchema = z.union([z.number().int().min(0).max(13), z.enum(['A0', 'A1', 'A2', 'A3', 'A4', 'A5'])]);

const eventSchema = z.union([
    z.object({ atMs: z.number().min(0), action: z.enum(['press', 'release']), part: z.string() }),
    z.object({ atMs: z.number().min(0), action: z.literal('tap'), part: z.string(), holdMs: z.number().min(1).optional() }),
    z.object({ atMs: z.number().min(0), action: z.literal('set'), part: z.string(), value: z.number() }),
    z.object({ atMs: z.number().min(0), action: z.literal('serial'), text: z.string() }),
]);

export const PARTS_HELP = `Parts a diagram can hold (every pin is an Uno pin: 0-13 or A0-A5; a pin belongs to one part):
- led: { "type": "led", "id": "led1", "pin": 13, "color": "green", "activeLow": false }  — on when the pin is HIGH; analogWrite dims it (brightness 0-1).
- button: { "type": "button", "id": "btn", "pin": 2 }  — wired to GND, so use pinMode(pin, INPUT_PULLUP) and treat LOW as pressed; set "activeHigh": true for a button to 5 V.
- servo: { "type": "servo", "id": "arm", "pin": 9 }  — a hobby servo; use the Servo library (attach + write), angle 0-180 is read from the pulse width.
- ultrasonic: { "type": "ultrasonic", "id": "eyes", "trig": 12, "echo": 11 }  — HC-SR04: a 10 µs HIGH pulse on trig, then pulseIn(echo, HIGH) / 58 gives centimetres.
- potentiometer: { "type": "potentiometer", "id": "pot", "pin": "A0" }  — analogRead gives 0-1023 for position 0-1.
- motor: { "type": "motor", "id": "left", "in1": 4, "in2": 5, "en": 6 }  — one H-bridge channel: in1 HIGH/in2 LOW forward, in2 HIGH/in1 LOW backward, analogWrite(en, 0-255) speed. Use a PWM pin for en (3, 5, 6, 9, 10, 11).

Robot arena (optional): "arena": { "preset": "corner", "left": "<motor id>", "right": "<motor id>", "sensor": "<ultrasonic id>" }
puts a two-wheel robot (12 cm track, 8 cm radius, 25 cm/s at full speed) with the sensor facing forward in a maze. The "corner" preset is a 200×120 cm room with two inner walls: start at (30, 95) facing east (heading 0°, counter-clockwise positive), goal at (170, 25) radius 15. The run reports the path, collisions, whether the goal was reached and a score 0-100 (80 for reaching the goal + up to 20 for speed, else up to 60 for progress; 5 off per collision).

Scripted events for a run: press/release/tap a button, set a potentiometer (0-1) or an ultrasonic sensor's distance (cm), or send serial text.`;

export interface ServerOptions extends BuildOptions {
    /** Longest simulated run a tool call may ask for, ms. */
    maxDurationMs?: number;
    /** Replaces the compiler (tests, or a remote build service). */
    compile?: (sketch: string) => Promise<BuildResult>;
    /**
     * Where compile and run results are written for the IDE to show:
     * `firmware.hex`, `build.json` and `runs/<timestamp>.json`. Default
     * ROBOLANCE_RECORD_DIR, else `.robolance` under the working directory;
     * an empty string records nothing.
     */
    recordDir?: string;
    /** How many run records to keep (oldest are removed). */
    keepRuns?: number;
}

/** A run as recorded for the IDE: the trace plus what produced it. */
export interface RunRecord {
    version: 1;
    at: string;
    sketchSha: string;
    diagram: Diagram;
    durationMs: number;
    events: ScriptedEvent[];
    trace: RunTrace;
}

export const DEFAULT_RECORD_DIR = '.robolance';

/** Builds the MCP server; the caller connects it to a transport. */
export function createHardwareServer(options: ServerOptions = {}): McpServer {
    const server = new McpServer({ name: 'robolance-hardware', version: '0.1.0' });
    const maxDurationMs = options.maxDurationMs ?? 60_000;
    const hexCache = new Map<string, string>();
    const compile = options.compile ?? ((sketch: string) => buildSketch(sketch, options));
    const recorder = new Recorder(options.recordDir ?? process.env.ROBOLANCE_RECORD_DIR ?? join(process.cwd(), DEFAULT_RECORD_DIR), options.keepRuns ?? 30);

    server.registerTool('hardware_parts', {
        description: 'The parts and the diagram.json format the simulator understands, with wiring conventions the sketch must follow.',
        inputSchema: {},
    }, async () => ({ content: [{ type: 'text', text: PARTS_HELP }] }));

    server.registerTool('hardware_compile', {
        description: 'Compiles an Arduino Uno sketch (.ino contents). Returns ok, the compiler messages (errors first) and the flash/RAM size.',
        inputSchema: { sketch: z.string().min(1).describe('The full sketch source, with setup() and loop()') },
    }, async ({ sketch }) => {
        const result = await compile(sketch);
        if (result.ok && result.hex) {
            hexCache.set(sketch, result.hex);
            await recorder.build(sketch, result);
        }
        return {
            content: [{ type: 'text', text: JSON.stringify({ ok: result.ok, backend: result.backend, size: result.size ?? null, output: result.output }, null, 2) }],
            isError: !result.ok,
        };
    });

    server.registerTool('hardware_run', {
        description: 'Compiles the sketch (if needed) and runs it on the circuit in the simulator for durationMs of simulated time with the scripted events. Returns serial output, part states over time, final states, and for an arena the robot path, collisions and score. Read the notes: they say what went wrong.',
        inputSchema: {
            sketch: z.string().min(1).describe('The full sketch source'),
            diagram: z.object({
                board: z.literal('uno').optional(),
                parts: z.array(z.object({ type: z.enum(PART_TYPES), id: z.string() }).passthrough()),
                arena: z.object({
                    preset: z.literal('corner').optional(),
                    left: z.string(),
                    right: z.string(),
                    sensor: z.string().optional(),
                }).passthrough().optional(),
            }).passthrough().describe('The circuit, see hardware_parts'),
            durationMs: z.number().int().min(10).max(maxDurationMs).default(5000),
            events: z.array(eventSchema).optional(),
            sampleEveryMs: z.number().int().min(10).optional().describe('How often part states are recorded (default 250)'),
            detail: z.enum(['summary', 'full']).default('summary').describe('summary keeps serial to 60 lines and samples to 40'),
        },
    }, async ({ sketch, diagram, durationMs, events, sampleEveryMs, detail }) => {
        const problem = validateDiagram(diagram as unknown);
        if (problem) {
            return { content: [{ type: 'text', text: `diagram: ${problem}` }], isError: true };
        }
        let hex = hexCache.get(sketch);
        let buildOutput = '';
        if (!hex) {
            const result = await compile(sketch);
            if (!result.ok || !result.hex) {
                return { content: [{ type: 'text', text: JSON.stringify({ ok: false, stage: 'compile', output: result.output }, null, 2) }], isError: true };
            }
            hex = result.hex;
            buildOutput = result.output;
            hexCache.set(sketch, hex);
            await recorder.build(sketch, result);
        }
        let trace: RunTrace;
        try {
            trace = runScenario(hex, diagram as unknown as Diagram, { durationMs, events: events as ScriptedEvent[] | undefined, sampleEveryMs, maxRealMs: 30_000 });
        } catch (err) {
            return { content: [{ type: 'text', text: `run failed: ${err instanceof Error ? err.message : err}` }], isError: true };
        }
        const recorded = await recorder.run({
            version: 1,
            at: new Date().toISOString(),
            sketchSha: sha(sketch),
            diagram: diagram as unknown as Diagram,
            durationMs,
            events: (events ?? []) as ScriptedEvent[],
            trace,
        });
        const summary = detail === 'full' ? trace : summarize(trace);
        const text = JSON.stringify(recorded ? { ...summary, recordedAs: recorded } : summary, null, 1);
        return { content: [{ type: 'text', text: buildOutput ? `${buildOutput}\n${text}` : text }] };
    });

    server.registerTool('hardware_arena', {
        description: 'The geometry of an arena preset: walls, start and goal, in centimetres.',
        inputSchema: { preset: z.literal('corner').default('corner') },
    }, async () => ({ content: [{ type: 'text', text: JSON.stringify(cornerMaze()) }] }));

    return server;
}

/** The trace cut down to what the agent needs on a normal turn. */
export function summarize(trace: RunTrace): Record<string, unknown> {
    const serial = trace.serial.length > 60
        ? [...trace.serial.slice(0, 20), `… ${trace.serial.length - 40} more lines …`, ...trace.serial.slice(-40)]
        : trace.serial;
    const every = Math.max(1, Math.ceil(trace.samples.length / 40));
    const samples = trace.samples.filter((_, i) => i % every === 0).map(s => ({ atMs: s.atMs, ...compactParts(s.parts) }));
    const out: Record<string, unknown> = {
        ranMs: trace.ranMs,
        notes: trace.notes,
        serial,
        final: trace.final,
        samples,
    };
    if (trace.arena) {
        const pathEvery = Math.max(1, Math.ceil(trace.arena.path.length / 30));
        out.arena = {
            score: trace.arena.score,
            reachedGoalAtMs: trace.arena.reachedGoalAtMs,
            collisions: trace.arena.collisions,
            bestDistanceToGoalCm: trace.arena.bestDistanceToGoalCm,
            finalDistanceToGoalCm: trace.arena.finalDistanceToGoalCm,
            state: trace.arena.state,
            events: trace.arena.events.slice(0, 20),
            path: trace.arena.path.filter((_, i) => i % pathEvery === 0).map(p => [Math.round(p.x), Math.round(p.y), Math.round(p.headingDeg)]),
        };
    }
    return out;
}

function compactParts(parts: Record<string, Record<string, unknown>>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [id, state] of Object.entries(parts)) {
        if ('on' in state) {
            out[id] = state.on ? (typeof state.brightness === 'number' && state.brightness < 0.98 ? `on ${Math.round((state.brightness as number) * 100)}%` : 'on') : 'off';
        } else if ('angle' in state) {
            out[id] = state.angle === null ? 'no pulse' : `${state.angle}°`;
        } else if ('pressed' in state) {
            out[id] = state.pressed ? 'pressed' : 'released';
        } else if ('speed' in state) {
            out[id] = `speed ${state.speed}`;
        } else if ('distanceCm' in state) {
            out[id] = `${state.distanceCm} cm`;
        } else if ('position' in state) {
            out[id] = `${state.position}`;
        } else {
            out[id] = state;
        }
    }
    return out;
}

function sha(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Writes what the tools produced into the project so the IDE's Hardware
 * tab can show the firmware running and the history of runs. Failures to
 * write never fail a tool call.
 */
export class Recorder {
    private seq = 0;
    /** Writes run one after another, so firmware.hex and build.json always describe the same build. */
    private queue: Promise<unknown> = Promise.resolve();

    constructor(readonly dir: string, readonly keepRuns = 30) {}

    get enabled(): boolean {
        return this.dir !== '';
    }

    private serialized<T>(work: () => Promise<T>): Promise<T> {
        const next = this.queue.then(work, work);
        this.queue = next.catch(() => undefined);
        return next;
    }

    async build(sketch: string, result: BuildResult): Promise<void> {
        if (!this.enabled || !result.hex) {
            return;
        }
        const hex = result.hex;
        const record = JSON.stringify({
            version: 1,
            at: new Date().toISOString(),
            sketchSha: sha(sketch),
            backend: result.backend,
            size: result.size ?? null,
        }, null, 2);
        await this.serialized(async () => {
            try {
                await mkdir(this.dir, { recursive: true });
                await writeFile(join(this.dir, 'firmware.hex'), hex);
                await writeFile(join(this.dir, 'build.json'), record);
            } catch {
                // The workspace is not writable here; the tool result still has everything.
            }
        });
    }

    /** Returns the path the run was written to, relative to the record dir. */
    run(record: RunRecord): Promise<string | undefined> {
        if (!this.enabled) {
            return Promise.resolve(undefined);
        }
        return this.serialized(() => this.writeRun(record));
    }

    private async writeRun(record: RunRecord): Promise<string | undefined> {
        try {
            const runs = join(this.dir, 'runs');
            await mkdir(runs, { recursive: true });
            this.seq = (this.seq + 1) % 1000;
            const name = `${Date.now().toString().padStart(13, '0')}-${this.seq.toString().padStart(3, '0')}.json`;
            await writeFile(join(runs, name), JSON.stringify(record));
            const existing = (await readdir(runs)).filter(f => /^\d+-\d+\.json$/.test(f)).sort();
            for (const old of existing.slice(0, Math.max(0, existing.length - this.keepRuns))) {
                await rm(join(runs, old), { force: true });
            }
            return `runs/${name}`;
        } catch {
            return undefined;
        }
    }
}
