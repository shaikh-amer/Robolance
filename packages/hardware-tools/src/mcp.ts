// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The agent's hardware tools as an MCP server (stdio). OpenLance, or any
 * MCP client, gets: compile a sketch, run it on a circuit in the simulator
 * with scripted inputs, and a description of the parts and the diagram
 * format. Every run returns what the firmware did (serial, part states,
 * the robot's path and score) so the agent can fix what it wrote. The
 * duck_* tools do the same for a Microduck mission on a football pitch,
 * and the scene_* tools for any robot the agent describes in MJCF.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import {
    ARENA_PRESET_NAMES,
    PART_TYPES,
    arenaPreset,
    runScenario,
    validateDiagram,
    type Diagram,
    type RunTrace,
    type ScriptedEvent,
} from 'robolance-hardware-sim';
import { DEFAULT_FIELD, MISSION_API, runMission, validateField, type FieldSpec, type MissionResult } from 'robolance-duck-sim';
import { Scene, meshoptSimplifier, type SceneRun } from 'robolance-mujoco';
import { readSceneDir } from 'robolance-mujoco/node-files';
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

- linesensor: { "type": "linesensor", "id": "leftEye", "pin": 2, "forwardCm": 9, "leftCm": 2.5 }  — a reflectance (IR line) sensor under the robot, forwardCm/leftCm from its centre (negative leftCm is right). On a digital pin it reads HIGH over the dark line and LOW over the floor ("activeHigh": false for the opposite kind); on an analog pin (A0-A5) analogRead gives about 120 over the line and 900 over the floor. Mount one 2.5 cm left and one 2.5 cm right of centre, 9 cm forward: on a 2 cm line neither sees it while the robot is centred, and the one that does says which way it drifted.

Robot arena (optional): "arena": { "preset": "corner", "left": "<motor id>", "right": "<motor id>", "sensor": "<ultrasonic id>" }
puts a two-wheel robot (12 cm track, 8 cm radius, 25 cm/s at full speed) with the sensor facing forward in a maze. The "corner" preset is a 200×120 cm room with two inner walls: start at (30, 95) facing east (heading 0°, counter-clockwise positive), goal at (170, 25) radius 15. The run reports the path, collisions, whether the goal was reached and a score 0-100 (80 for reaching the goal + up to 20 for speed, else up to 60 for progress; 5 off per collision).
The "line" preset is an open 200×120 cm room with a 2 cm dark line winding from the start (20, 60), facing east, to the goal at (180, 80): a line-following task for linesensor parts. Its run also reports line.coverage (fraction of the line the robot's centre passed over), line.onLineMs and line.lostAtMs, and the score is 60 × coverage + 30 for reaching the end (+ up to 10 for speed), 5 off per collision.
A diagram may carry "arena": { "spec": {...} } instead of a preset: the user drew that arena in the IDE; keep it unchanged. hardware_arena returns a preset's geometry.

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
    /** Real-time limit for one duck_run, ms (default 60 000). */
    duckWallMs?: number;
    /** The project folder scene paths are relative to (default: the working directory). */
    projectDir?: string;
    /** Real-time limit for one scene_run, ms (default 60 000). */
    sceneWallMs?: number;
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

/** A Microduck mission run as recorded for the IDE: the program and everything it did, replay included. */
export interface DuckRunRecord {
    version: 1;
    kind: 'duck';
    at: string;
    missionSha: string;
    mission: string;
    /** The project's own policies the run used, by skill name. */
    skills?: Record<string, { path: string; sha: string }>;
    result: MissionResult;
}

/** A run of any MJCF scene as recorded for the IDE: what ran, and the frames to replay it with the scene's model. */
export interface SceneRunRecord {
    version: 1;
    kind: 'scene';
    at: string;
    /** The scene's main MJCF, relative to the project. */
    scene: string;
    /** The viewer model, relative to the record dir (shared by runs of the same scene files). */
    model: string;
    controller: string;
    controllerSha: string;
    run: SceneRun;
}

export const DEFAULT_RECORD_DIR = '.robolance';

export const SCENE_HELP = `Any robot, described in MuJoCo's MJCF (https://mujoco.readthedocs.io/en/stable/XMLreference.html), simulated with MuJoCo.

Write the scene as an .xml file in the project (meshes and textures it names sit next to it or under its meshdir), then:
- scene_check {scene}: does it load (MuJoCo's own error if not), its actuators and sensors by name, parts that start inside each other, and whether it stays stable when left alone for a second.
- scene_run {scene, controller, seconds}: runs it under your controller and records the run; the IDE's Hardware tab replays it in 3D.

A controller is JavaScript that defines function control(sim), called at controlHz (default 50), and optionally function init(sim), called once.
Top-level variables keep their values between calls. sim gives:
  sim.t                              simulated seconds
  sim.joint(name) -> {q, v}          position and velocity (arrays for ball and free joints)
  sim.body(name) -> {pos, quat}      world pose, quaternion w first
  sim.site(name) -> [x, y, z]
  sim.sensor(name) -> number[]
  sim.actuators() -> names
  sim.ctrl(actuator, value)          by name or index, clamped to its ctrlrange
  sim.ctrlRange(actuator) -> [lo, hi] or null
  sim.contacts() -> [{a, b, depth}]  what touches what, by geom (body)
  sim.metric(name, value)            a time series for the report and the charts
  sim.log(...)                       a line in the run's log
  sim.stop(reason)                   ends the run (goal reached, failure detected)
Each call has 250 ms of real time; an endless loop ends the run with an error.

Tips: z is up. Give every moving body mass (a geom with size gives it one). Start parts apart, not inside each other.
Position actuators (<position joint=... kp=...>) are the simplest to control; keep kp moderate (tens to hundreds for a small arm)
or the simulation blows up; a smaller timestep (0.002) helps. Name the joints, actuators, sites and geoms you will refer to.
Measure what "done" means with sim.metric and stop the run when it is reached.`;

export const DUCK_HELP = `${MISSION_API}

The default pitch (metres): ${JSON.stringify(DEFAULT_FIELD)}
Pass "field" to duck_run for another layout (same shape). Each run takes a few seconds; read its notes, change the
mission, run again. Use log() to see positions while you work out the approach.

A policy the project trained (an ONNX file exported from microduck_rl: 61 values in, 14 out) runs in the simulator by
passing "skills" to duck_run, e.g. {"walk": "policies/walk/policy.onnx", "getUp": "policies/standup/policy.onnx"}:
walk, stand, kickLeft and kickRight replace the built-in skills (walk then drives duck.walk, walkTo and turnTo);
any other name is a new skill the mission runs with duck.skill(name, seconds, command). Try a newly trained policy
here before calling it done.`;

const fieldSchema = z.object({
    duck: z.object({ x: z.number(), y: z.number(), heading: z.number() }),
    ball: z.object({ x: z.number(), y: z.number() }),
    goal: z.object({ x: z.number(), y: z.number(), width: z.number() }),
    bounds: z.object({ xMin: z.number(), xMax: z.number(), yMin: z.number(), yMax: z.number() }),
});

/** Builds the MCP server; the caller connects it to a transport. */
export function createHardwareServer(options: ServerOptions = {}): McpServer {
    const server = new McpServer({ name: 'robolance-hardware', version: '0.1.0' });
    const maxDurationMs = options.maxDurationMs ?? 60_000;
    const hexCache = new Map<string, string>();
    const compile = options.compile ?? ((sketch: string) => buildSketch(sketch, options));
    const recorder = new Recorder(options.recordDir ?? process.env.ROBOLANCE_RECORD_DIR ?? join(process.cwd(), DEFAULT_RECORD_DIR), options.keepRuns ?? 30);
    const projectDir = resolve(options.projectDir ?? process.cwd());
    const sceneSimplifier = meshoptSimplifier(0.0005);

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
                    preset: z.enum(ARENA_PRESET_NAMES).optional(),
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

    server.registerTool('duck_api', {
        description: 'Microduck (the Pollen Robotics duck robot) on a football pitch: the mission API, what the duck can and cannot do, and the default pitch. Read it before writing a mission for duck_run.',
        inputSchema: {},
    }, async () => ({ content: [{ type: 'text', text: DUCK_HELP }] }));

    server.registerTool('duck_run', {
        description: 'Runs a Microduck mission in the physics simulator (MuJoCo, with the robot\'s own trained walking and kicking skills, or policies the project trained, passed as skills): the body of an async JavaScript function using duck, field and log, see duck_api. Returns the outcome (goal, no-goal, fell, time-up, error, timeout), a score 0-100, notes that say why a kick missed, the mission\'s log, every kick and the duck\'s path. Every run is recorded for the IDE to replay.',
        inputSchema: {
            mission: z.string().min(1).max(64 * 1024).describe('The mission: the body of an async function'),
            field: fieldSchema.optional().describe('The pitch; default in duck_api'),
            limitS: z.number().min(1).max(120).default(40).describe('Longest simulated time, seconds'),
            skills: z.record(z.string(), z.string()).optional()
                .describe('The project\'s own trained policies by skill name: {"walk": "policies/walk/policy.onnx", "getUp": "..."}; see duck_api'),
        },
    }, async ({ mission, field, limitS, skills }) => {
        const pitch = (field ?? DEFAULT_FIELD) as FieldSpec;
        const problem = validateField(pitch);
        if (problem) {
            return { content: [{ type: 'text', text: `field: ${problem}` }], isError: true };
        }
        let policies: { bytes: Record<string, Uint8Array>; used: Record<string, { path: string; sha: string }> } | undefined;
        try {
            policies = skills ? await readPolicies(projectDir, skills) : undefined;
        } catch (err) {
            return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
        }
        let result: MissionResult;
        try {
            result = await runMission(mission, { field: pitch, limitS, wallMs: options.duckWallMs, skills: policies?.bytes });
        } catch (err) {
            return { content: [{ type: 'text', text: `run failed: ${err instanceof Error ? err.message : err}` }], isError: true };
        }
        const recorded = await recorder.run({
            version: 1, kind: 'duck', at: new Date().toISOString(), missionSha: sha(mission), mission, result,
            ...(policies ? { skills: policies.used } : {}),
        });
        const summary = summarizeDuck(result);
        return { content: [{ type: 'text', text: JSON.stringify(recorded ? { ...summary, recordedAs: recorded } : summary, null, 1) }] };
    });

    server.registerTool('scene_api', {
        description: 'How to simulate any robot: the MJCF scene, the controller script API (sim.joint, sim.ctrl, sim.sensor, sim.metric...), and tips that keep a simulation stable. Read it before writing a scene for scene_check and scene_run.',
        inputSchema: {},
    }, async () => ({ content: [{ type: 'text', text: SCENE_HELP }] }));

    server.registerTool('scene_check', {
        description: 'Loads an MJCF scene from the project and checks it: MuJoCo\'s error if it does not load, its bodies, actuators and sensors by name, total mass, parts that start inside each other, and whether it stays stable left alone. Use before scene_run, and after every change to the scene.',
        inputSchema: {
            scene: z.string().min(1).describe('Path of the main MJCF file, relative to the project (e.g. "robot/scene.xml")'),
        },
    }, async ({ scene }) => {
        let loaded: Scene;
        try {
            loaded = await loadProjectScene(projectDir, scene);
        } catch (err) {
            return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
        }
        try {
            return { content: [{ type: 'text', text: JSON.stringify(loaded.check(), null, 1) }] };
        } finally {
            loaded.dispose();
        }
    });

    server.registerTool('scene_run', {
        description: 'Runs an MJCF scene from the project under a controller (JavaScript defining control(sim), see scene_api) and records the run for the IDE to replay in 3D. Returns the outcome (done, stopped, unstable, error, timeout), why it ended, the checks, every metric the controller recorded (first, last, min, max) and its log.',
        inputSchema: {
            scene: z.string().min(1).describe('Path of the main MJCF file, relative to the project'),
            controller: z.string().max(64 * 1024).optional().describe('Controller source; omit to watch the scene fall under gravity'),
            controllerFile: z.string().optional().describe('Or a project file holding the controller'),
            seconds: z.number().min(0.1).max(120).default(10),
            controlHz: z.number().min(1).max(1000).default(50),
            keyframe: z.number().int().min(0).optional().describe('Start from this keyframe instead of the default pose'),
        },
    }, async ({ scene, controller, controllerFile, seconds, controlHz, keyframe }) => {
        let source = controller ?? '';
        if (!source && controllerFile) {
            try {
                source = await readFile(insideProject(projectDir, controllerFile), 'utf8');
            } catch (err) {
                return { content: [{ type: 'text', text: `controllerFile: ${err instanceof Error ? err.message : err}` }], isError: true };
            }
        }
        let loaded: Scene;
        let files: Map<string, Uint8Array | string>;
        try {
            ({ scene: loaded, files } = await loadProjectSceneWithFiles(projectDir, scene));
        } catch (err) {
            return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
        }
        try {
            const run = await loaded.run({ controller: source || undefined, seconds, controlHz, keyframe, wallMs: options.sceneWallMs });
            const modelSha = filesSha(files);
            const simplify = await sceneSimplifier;
            const modelPath = await recorder.model(modelSha, () => JSON.stringify(loaded.viewerModel({ simplify })));
            const recorded = modelPath
                ? await recorder.run({
                    version: 1, kind: 'scene', at: new Date().toISOString(), scene: toPosix(scene), model: modelPath,
                    controller: source, controllerSha: sha(source), run,
                })
                : undefined;
            const summary = summarizeScene(run);
            return { content: [{ type: 'text', text: JSON.stringify(recorded ? { ...summary, recordedAs: recorded } : summary, null, 1) }] };
        } finally {
            loaded.dispose();
        }
    });

    server.registerTool('hardware_arena', {
        description: 'The geometry of an arena preset: walls, start, goal and (for "line") the line on the floor, in centimetres.',
        inputSchema: { preset: z.enum(ARENA_PRESET_NAMES).default('corner') },
    }, async ({ preset }) => ({ content: [{ type: 'text', text: JSON.stringify(arenaPreset(preset)) }] }));

    return server;
}

/** A mission result without the replay frames, the path thinned to about 30 points. */
export function summarizeDuck(r: MissionResult): Record<string, unknown> {
    const every = Math.max(1, Math.ceil(r.path.length / 30));
    const logs = r.logs.length > 60 ? [...r.logs.slice(0, 20), `… ${r.logs.length - 60} more lines …`, ...r.logs.slice(-40)] : r.logs;
    return {
        outcome: r.outcome,
        score: r.score,
        scoredAtS: r.scoredAtS,
        simS: r.simS,
        ...(r.error ? { error: r.error } : {}),
        notes: r.notes,
        logs,
        kicks: r.kicks,
        events: r.events,
        final: r.final,
        ballToGoalStart: r.ballToGoalStart,
        closestBallToGoal: r.closestBallToGoal,
        path: r.path.filter((_, i) => i % every === 0 || i === r.path.length - 1),
    };
}

/** The trace cut down to what the agent needs on a normal turn. */
export function summarize(trace: RunTrace): Record<string, unknown> {
    const serial = trace.serial.length > 60
        ? [...trace.serial.slice(0, 20), `… ${trace.serial.length - 60} more lines …`, ...trace.serial.slice(-40)]
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
            ...(trace.arena.line ? { line: trace.arena.line } : {}),
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

/** A scene run without its frames: what happened, the checks, each metric's shape and the log. */
export function summarizeScene(r: SceneRun): Record<string, unknown> {
    const metrics: Record<string, unknown> = {};
    for (const [name, series] of Object.entries(r.metrics)) {
        const values = series.map(([, v]) => v);
        metrics[name] = {
            first: values[0],
            last: values[values.length - 1],
            min: Math.min(...values),
            max: Math.max(...values),
            samples: values.length,
        };
    }
    const logs = r.logs.length > 60 ? [...r.logs.slice(0, 20), `… ${r.logs.length - 60} more lines …`, ...r.logs.slice(-40)] : r.logs;
    return {
        outcome: r.outcome,
        ...(r.message ? { message: r.message } : {}),
        simS: r.simS,
        frames: r.frames.length,
        check: { ok: r.check.ok, actuators: r.check.actuators, sensors: r.check.sensors, issues: r.check.issues },
        metrics,
        logs,
    };
}

/** Most policies one duck_run takes, and the largest file. */
export const MAX_SKILLS = 8;
export const MAX_POLICY_BYTES = 32 * 1024 * 1024;

/** Reads the project's policy files a duck_run names, with each file's hash for the record. */
export async function readPolicies(projectDir: string, skills: Record<string, string>): Promise<{ bytes: Record<string, Uint8Array>; used: Record<string, { path: string; sha: string }> }> {
    const names = Object.keys(skills);
    if (names.length > MAX_SKILLS) {
        throw new Error(`at most ${MAX_SKILLS} skills per run`);
    }
    const bytes: Record<string, Uint8Array> = {};
    const used: Record<string, { path: string; sha: string }> = {};
    for (const name of names) {
        const path = skills[name];
        const full = insideProject(projectDir, path);
        const info = await stat(full).catch(() => null);
        if (!info?.isFile()) {
            throw new Error(`skill "${name}": ${path} does not exist in the project`);
        }
        if (info.size > MAX_POLICY_BYTES) {
            throw new Error(`skill "${name}": ${path} is over ${MAX_POLICY_BYTES >> 20} MB; a Microduck policy is well under 1 MB`);
        }
        const data = new Uint8Array(await readFile(full));
        bytes[name] = data;
        used[name] = { path, sha: createHash('sha256').update(data).digest('hex').slice(0, 16) };
    }
    return { bytes, used };
}

/** A path inside the project, or an error that says why not. */
export function insideProject(projectDir: string, path: string): string {
    const full = resolve(projectDir, path);
    const rel = relative(projectDir, full);
    if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..') || resolve(rel) === rel) {
        throw new Error(`${path} is not inside the project`);
    }
    return full;
}

async function loadProjectSceneWithFiles(projectDir: string, scene: string): Promise<{ scene: Scene; files: Map<string, Uint8Array | string> }> {
    const main = insideProject(projectDir, scene);
    if (!(await stat(main).catch(() => null))?.isFile()) {
        throw new Error(`${scene} does not exist in the project`);
    }
    const files = await readSceneDir(dirname(main));
    return { scene: await Scene.load(files, basename(main)), files };
}

async function loadProjectScene(projectDir: string, scene: string): Promise<Scene> {
    return (await loadProjectSceneWithFiles(projectDir, scene)).scene;
}

/** One hash for a scene's files, so runs of an unchanged scene share one viewer model. */
function filesSha(files: Map<string, Uint8Array | string>): string {
    const h = createHash('sha256');
    for (const [path, contents] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
        h.update(path).update('\0').update(contents).update('\0');
    }
    return h.digest('hex').slice(0, 16);
}

function toPosix(path: string): string {
    return path.split(sep).join('/').replace(/^\.\//, '');
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
    run(record: RunRecord | DuckRunRecord | SceneRunRecord): Promise<string | undefined> {
        if (!this.enabled) {
            return Promise.resolve(undefined);
        }
        return this.serialized(() => this.writeRun(record));
    }

    /**
     * Writes a scene's viewer model as `models/<sha>.json` unless it is
     * already there; returns its path relative to the record dir.
     */
    model(sha: string, produce: () => string): Promise<string | undefined> {
        if (!this.enabled) {
            return Promise.resolve(undefined);
        }
        return this.serialized(async () => {
            try {
                const models = join(this.dir, 'models');
                await mkdir(models, { recursive: true });
                const file = join(models, `${sha}.json`);
                if (!(await stat(file).catch(() => null))) {
                    await writeFile(file, produce());
                    // Keep a few more models than runs: a model is shared by every run of the same scene files.
                    const all = await Promise.all((await readdir(models)).filter(f => f.endsWith('.json'))
                        .map(async f => ({ f, at: (await stat(join(models, f))).mtimeMs })));
                    all.sort((a, b) => b.at - a.at);
                    for (const old of all.slice(this.keepRuns + 10)) {
                        await rm(join(models, old.f), { force: true });
                    }
                }
                return `models/${sha}.json`;
            } catch {
                return undefined;
            }
        });
    }

    private async writeRun(record: RunRecord | DuckRunRecord | SceneRunRecord): Promise<string | undefined> {
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
