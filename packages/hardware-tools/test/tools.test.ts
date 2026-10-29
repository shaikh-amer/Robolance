// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildSketch, createHardwareServer, obstaclesFromSegments, summarize, withPrototypes, type BuildResult } from '../src/index.js';
import { Recorder } from '../src/mcp.js';
import { DEFAULT_FIELD } from 'robolance-duck-sim';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'hardware-sim', 'fixtures');
const benchHex = readFileSync(join(fixtures, 'bench.hex'), 'utf8');
const benchSketch = readFileSync(join(fixtures, 'bench.ino'), 'utf8');

test('withPrototypes declares functions used before their definition', () => {
    const out = withPrototypes('void setup() { blink(3); }\nvoid loop() {}\nvoid blink(int times) {\n}\nlong readCm() {\n  if (x) {\n  }\n}\n');
    assert.ok(out.startsWith('#include <Arduino.h>\nvoid blink(int times);\nlong readCm();\n'));
    assert.ok(!out.includes('if (x);'), 'control statements are not prototypes');
});

test('withPrototypes keeps #include lines first', () => {
    const out = withPrototypes('#include <Servo.h>\nServo s;\nvoid go() {}\nvoid setup() {}\nvoid loop() {}\n');
    assert.equal(out.split('\n')[0], '#include <Servo.h>');
    assert.equal(out.split('\n')[1], '#include <Arduino.h>');
});

const haveToolchain = Boolean(process.env.ROBOLANCE_ARDUINO_CORE);

test('buildSketch compiles the bench fixture (needs the AVR toolchain)', { skip: !haveToolchain && 'set ROBOLANCE_ARDUINO_CORE to run' }, async () => {
    const result = await buildSketch(benchSketch);
    assert.equal(result.ok, true, result.output);
    assert.ok(result.hex?.startsWith(':'));
    assert.ok(result.size && result.size.flashBytes > 1000);
});

test('buildSketch reports compiler errors (needs the AVR toolchain)', { skip: !haveToolchain && 'set ROBOLANCE_ARDUINO_CORE to run' }, async () => {
    const result = await buildSketch('void setup() { digitalWrite(13, HIGH) }\nvoid loop() {}\n');
    assert.equal(result.ok, false);
    assert.match(result.output, /expected ';'/);
});

/** A compiler that answers from the fixture, so the MCP tests need no toolchain. */
const fakeCompile = async (sketch: string): Promise<BuildResult> => sketch.includes('BROKEN')
    ? { ok: false, output: "sketch.ino:3:1: error: expected ';' before '}' token", backend: 'avr-gcc' }
    : { ok: true, hex: benchHex, output: '', size: { flashBytes: 4358, ramBytes: 200 }, backend: 'avr-gcc' };

async function connect() {
    const server = createHardwareServer({ compile: fakeCompile, maxDurationMs: 10_000, recordDir: '' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientSide);
    return { client, close: () => Promise.all([client.close(), server.close()]) };
}

function text(result: unknown): string {
    const content = (result as { content: { type: string; text?: string }[] }).content;
    return content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n');
}

test('the MCP server lists the hardware tools', async () => {
    const { client, close } = await connect();
    try {
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(t => t.name).sort(), ['duck_api', 'duck_obstacles_from_photo', 'duck_run', 'hardware_arena', 'hardware_compile', 'hardware_parts', 'hardware_run', 'scene_api', 'scene_check', 'scene_run']);
        const parts = await client.callTool({ name: 'hardware_parts', arguments: {} });
        assert.match(text(parts), /INPUT_PULLUP/);
        const arena = await client.callTool({ name: 'hardware_arena', arguments: {} });
        assert.equal(JSON.parse(text(arena)).width, 200);
    } finally {
        await close();
    }
});

test('hardware_compile returns ok and size, or the error', async () => {
    const { client, close } = await connect();
    try {
        const good = await client.callTool({ name: 'hardware_compile', arguments: { sketch: benchSketch } });
        assert.equal(good.isError ?? false, false);
        assert.equal(JSON.parse(text(good)).size.flashBytes, 4358);
        const bad = await client.callTool({ name: 'hardware_compile', arguments: { sketch: 'BROKEN' } });
        assert.equal(bad.isError, true);
        assert.match(text(bad), /expected ';'/);
    } finally {
        await close();
    }
});

test('hardware_run simulates the sketch on the circuit with scripted inputs', async () => {
    const { client, close } = await connect();
    try {
        const result = await client.callTool({
            name: 'hardware_run',
            arguments: {
                sketch: benchSketch,
                diagram: {
                    parts: [
                        { type: 'led', id: 'led13', pin: 13 },
                        { type: 'button', id: 'btn', pin: 2 },
                        { type: 'servo', id: 'arm', pin: 9 },
                        { type: 'potentiometer', id: 'pot', pin: 'A0' },
                    ],
                },
                durationMs: 2000,
                events: [{ atMs: 500, action: 'tap', part: 'btn', holdMs: 400 }],
            },
        });
        assert.equal(result.isError ?? false, false, text(result));
        const out = JSON.parse(text(result));
        assert.equal(out.ranMs, 2000);
        assert.equal(out.serial[0], 'ready');
        assert.ok(out.serial.includes('pressed'));
        assert.equal(out.final.arm.angle, 150);
        assert.ok(out.samples.length > 0 && out.samples.length <= 41);
        assert.ok(['on', 'off'].includes(out.samples[0].led13));
    } finally {
        await close();
    }
});

test('hardware_run rejects a bad diagram and a sketch that does not compile', async () => {
    const { client, close } = await connect();
    try {
        const bad = await client.callTool({
            name: 'hardware_run',
            arguments: { sketch: benchSketch, diagram: { parts: [{ type: 'led', id: 'a', pin: 13 }, { type: 'led', id: 'b', pin: 13 }] } },
        });
        assert.equal(bad.isError, true);
        assert.match(text(bad), /both use pin 13/);
        const broken = await client.callTool({ name: 'hardware_run', arguments: { sketch: 'BROKEN', diagram: { parts: [] } } });
        assert.equal(broken.isError, true);
        assert.equal(JSON.parse(text(broken)).stage, 'compile');
        const tooLong = await client.callTool({ name: 'hardware_run', arguments: { sketch: benchSketch, diagram: { parts: [] }, durationMs: 99_999 } });
        assert.equal(tooLong.isError, true);
    } finally {
        await close();
    }
});

test('summarize keeps a trace short enough for a model turn', () => {
    const serial = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const samples = Array.from({ length: 400 }, (_, i) => ({ atMs: i * 10, parts: { led: { on: i % 2 === 0, brightness: 1 }, arm: { angle: 90 } } }));
    const out = summarize({ durationMs: 4000, ranMs: 4000, serial, samples, final: {}, notes: [] });
    assert.equal((out.serial as string[]).length, 61);
    assert.equal((out.serial as string[])[20], '… 140 more lines …', '200 lines, 60 shown');
    assert.equal((out.serial as string[])[21], 'line 160');
    assert.ok((out.samples as unknown[]).length <= 40);
    assert.deepEqual((out.samples as Record<string, unknown>[])[0], { atMs: 0, led: 'on', arm: '90°' });
});

test('runs and builds are recorded in the project for the IDE', async () => {
    const { mkdtemp, readFile, readdir, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'robolance-record-'));
    try {
        const server = createHardwareServer({ compile: fakeCompile, recordDir: dir, keepRuns: 2 });
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'test', version: '0.0.0' });
        await client.connect(clientSide);
        try {
            await client.callTool({ name: 'hardware_compile', arguments: { sketch: benchSketch } });
            assert.equal(await readFile(join(dir, 'firmware.hex'), 'utf8'), benchHex);
            assert.equal(JSON.parse(await readFile(join(dir, 'build.json'), 'utf8')).size.flashBytes, 4358);
            for (let i = 0; i < 3; i++) {
                const result = await client.callTool({ name: 'hardware_run', arguments: { sketch: benchSketch, diagram: { parts: [{ type: 'led', id: 'led13', pin: 13 }] }, durationMs: 100 } });
                assert.match(JSON.parse(text(result)).recordedAs, /^runs\/\d+-\d+\.json$/);
            }
            const runs = (await readdir(join(dir, 'runs'))).sort();
            assert.equal(runs.length, 2, 'only keepRuns records are kept');
            const record = JSON.parse(await readFile(join(dir, 'runs', runs[1]), 'utf8'));
            assert.equal(record.version, 1);
            assert.equal(record.durationMs, 100);
            assert.equal(record.trace.ranMs, 100);
            assert.deepEqual(record.diagram.parts[0], { type: 'led', id: 'led13', pin: 13 });
        } finally {
            await Promise.all([client.close(), server.close()]);
        }
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('concurrent builds never leave firmware.hex and build.json from different builds', async () => {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'robolance-record-'));
    try {
        const recorder = new Recorder(dir);
        const a: BuildResult = { ok: true, hex: ':A', output: '', size: { flashBytes: 1, ramBytes: 1 }, backend: 'avr-gcc' };
        const b: BuildResult = { ok: true, hex: ':B', output: '', size: { flashBytes: 2, ramBytes: 2 }, backend: 'avr-gcc' };
        await Promise.all([recorder.build('sketch a', a), recorder.build('sketch b', b), recorder.run({ version: 1, at: '', sketchSha: 'x', diagram: { parts: [] }, durationMs: 1, events: [], trace: { durationMs: 1, ranMs: 1, serial: [], samples: [], final: {}, notes: [] } })]);
        assert.equal(await readFile(join(dir, 'firmware.hex'), 'utf8'), ':B', 'the last build wins');
        assert.equal(JSON.parse(await readFile(join(dir, 'build.json'), 'utf8')).size.flashBytes, 2, 'and build.json describes that same build');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('the default run summary keeps the line metrics of a line course', () => {
    const trace = {
        durationMs: 1000, ranMs: 1000, serial: [], samples: [], final: {}, notes: [],
        arena: {
            path: [], events: [], collisions: 0, reachedGoalAtMs: null, bestDistanceToGoalCm: 10, finalDistanceToGoalCm: 10, score: 42, state: {},
            line: { onLine: true, coverage: 0.7, onLineMs: 900, lostAtMs: null },
        },
    } as unknown as Parameters<typeof summarize>[0];
    const summary = summarize(trace) as { arena: { line?: unknown; score: number } };
    assert.deepEqual(summary.arena.line, { onLine: true, coverage: 0.7, onLineMs: 900, lostAtMs: null });
    assert.equal(summary.arena.score, 42);
    const plain = summarize({ ...trace, arena: { ...trace.arena!, line: undefined } }) as { arena: { line?: unknown } };
    assert.equal('line' in plain.arena, false, 'no line, no line key');
});

test('duck_api describes the mission API and the default pitch', async () => {
    const { client, close } = await connect();
    try {
        const help = text(await client.callTool({ name: 'duck_api', arguments: {} }));
        assert.match(help, /await duck\.kick\('left' \| 'right'\)/);
        assert.match(help, /"goal":\{"x":0\.95/);
        assert.match(help, /Closing the laptop[^]*const hinge = [^]*duck\.skill\('walk', 0\.4,/, 'the laptop example is included');
    } finally {
        await close();
    }
});

test('duck_run runs a mission, explains it and records the run with its replay', async () => {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'robolance-duck-'));
    try {
        const server = createHardwareServer({ compile: fakeCompile, recordDir: dir });
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'test', version: '0.0.0' });
        await client.connect(clientSide);
        try {
            const mission = readFileSync(fileURLToPath(import.meta.resolve('robolance-duck-sim/examples/score-a-goal.js')), 'utf8');
            const result = JSON.parse(text(await client.callTool({ name: 'duck_run', arguments: { mission } })));
            assert.equal(result.outcome, 'goal', result.notes.join('\n'));
            assert.ok(result.score >= 80);
            assert.ok(result.path.length <= 32, 'path thinned');
            assert.equal(result.replay, undefined, 'no replay frames in the tool result');
            const record = JSON.parse(await readFile(join(dir, result.recordedAs), 'utf8'));
            assert.equal(record.kind, 'duck');
            assert.equal(record.mission, mission);
            assert.ok(record.result.replay.frames.length > 100);

            const quiet = JSON.parse(text(await client.callTool({ name: 'duck_run', arguments: { mission: 'log(duck.pose());', limitS: 3 } })));
            assert.equal(quiet.outcome, 'no-goal');
            assert.match(quiet.notes.join('\n'), /never kicked/);
            assert.deepEqual(quiet.logs, ['{"x":0,"y":0,"heading":0}']);
        } finally {
            await client.close();
            await server.close();
        }
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('duck_run runs the project\'s own policies and records which files it used', async () => {
    const { mkdtemp, mkdir, readFile, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const project = await mkdtemp(join(tmpdir(), 'robolance-policies-'));
    const record = join(project, '.robolance');
    try {
        // The packaged walking policy stands in for one the project trained.
        const { ASSETS_DIR } = await import('robolance-duck-sim/node-assets');
        const walking = await readFile(join(ASSETS_DIR, 'policies', 'alpha_walking.onnx'));
        await mkdir(join(project, 'policies/walk'), { recursive: true });
        await writeFile(join(project, 'policies/walk/policy.onnx'), walking);
        await writeFile(join(project, 'policies/bad.onnx'), 'not a model');
        const server = createHardwareServer({ compile: fakeCompile, recordDir: record, projectDir: project });
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'test', version: '0.0.0' });
        await client.connect(clientSide);
        try {
            const mission = "log(duck.skills()); await duck.skill('jog', 1, [0.4, 0, 0]);";
            const result = JSON.parse(text(await client.callTool({
                name: 'duck_run',
                arguments: { mission, limitS: 5, skills: { walk: 'policies/walk/policy.onnx', jog: 'policies/walk/policy.onnx' } },
            })));
            assert.deepEqual(result.logs, ['["jog"]']);
            const saved = JSON.parse(await readFile(join(record, result.recordedAs), 'utf8'));
            assert.equal(saved.skills.walk.path, 'policies/walk/policy.onnx');
            assert.match(saved.skills.walk.sha, /^[0-9a-f]{16}$/);

            const outside = await client.callTool({ name: 'duck_run', arguments: { mission, skills: { walk: '../elsewhere.onnx' } } });
            assert.equal((outside as { isError?: boolean }).isError, true);
            assert.match(text(outside), /not inside the project/);
            const missing = await client.callTool({ name: 'duck_run', arguments: { mission, skills: { walk: 'policies/nope.onnx' } } });
            assert.match(text(missing), /does not exist in the project/);
            const bad = JSON.parse(text(await client.callTool({ name: 'duck_run', arguments: { mission, limitS: 3, skills: { walk: 'policies/bad.onnx' } } })));
            assert.equal(bad.outcome, 'error');
            assert.match(bad.notes.join('\n'), /not an ONNX model/);
        } finally {
            await client.close();
            await server.close();
        }
    } finally {
        await rm(project, { recursive: true, force: true });
    }
});

test('duck_run rejects a pitch that breaks the rules', async () => {
    const { client, close } = await connect();
    try {
        const bad = await client.callTool({
            name: 'duck_run',
            arguments: { mission: 'log(1)', field: { duck: { x: 0, y: 0, heading: 0 }, ball: { x: 0.05, y: 0 }, goal: { x: 0.95, y: 0, width: 0.6 }, bounds: { xMin: -0.4, xMax: 1.3, yMin: -0.7, yMax: 0.7 } } },
        });
        assert.equal((bad as { isError?: boolean }).isError, true);
        assert.match(text(bad), /15 cm/);
    } finally {
        await close();
    }
});

const PENDULUM = `
<mujoco model="pendulum">
  <option timestep="0.002"/>
  <worldbody>
    <geom name="floor" type="plane" size="1 1 0.05"/>
    <body name="pole" pos="0 0 0.5">
      <joint name="hinge" type="hinge" axis="0 1 0" damping="0.05"/>
      <geom name="rod" type="capsule" fromto="0 0 0 0 0 -0.3" size="0.01"/>
      <geom name="bob" type="sphere" pos="0 0 -0.3" size="0.03"/>
    </body>
  </worldbody>
  <actuator><motor name="torque" joint="hinge" gear="1" ctrlrange="-2 2"/></actuator>
</mujoco>`;

test('scene_check and scene_run simulate any MJCF in the project and record it for the IDE', async () => {
    const { mkdtemp, mkdir, readFile, readdir, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const project = await mkdtemp(join(tmpdir(), 'robolance-scene-'));
    const record = join(project, '.robolance');
    try {
        await mkdir(join(project, 'robot'));
        await writeFile(join(project, 'robot', 'scene.xml'), PENDULUM);
        await writeFile(join(project, 'robot', 'swing.js'), 'function control(sim) { sim.ctrl("torque", sim.t < 0.5 ? 2 : 0); sim.metric("angle", sim.joint("hinge").q); }');
        const server = createHardwareServer({ compile: fakeCompile, recordDir: record, projectDir: project });
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'test', version: '0.0.0' });
        await client.connect(clientSide);
        try {
            assert.match(text(await client.callTool({ name: 'scene_api', arguments: {} })), /function control\(sim\)/);
            const check = JSON.parse(text(await client.callTool({ name: 'scene_check', arguments: { scene: 'robot/scene.xml' } })));
            assert.equal(check.ok, true, JSON.stringify(check.issues));
            assert.deepEqual(check.actuators, ['torque']);

            const run = JSON.parse(text(await client.callTool({ name: 'scene_run', arguments: { scene: 'robot/scene.xml', controllerFile: 'robot/swing.js', seconds: 2 } })));
            assert.equal(run.outcome, 'done', run.message);
            assert.ok(run.metrics.angle.max > 0.3, JSON.stringify(run.metrics));
            const saved = JSON.parse(await readFile(join(record, run.recordedAs), 'utf8'));
            assert.equal(saved.kind, 'scene');
            assert.equal(saved.scene, 'robot/scene.xml');
            assert.ok(saved.run.frames.length >= 50);
            const model = JSON.parse(await readFile(join(record, saved.model), 'utf8'));
            assert.deepEqual(model.geoms.map((g: { shape?: { type: string } }) => g.shape?.type), ['plane', 'capsule', 'sphere']);

            // The same scene files share one model; a run without a controller just falls.
            const again = JSON.parse(text(await client.callTool({ name: 'scene_run', arguments: { scene: 'robot/scene.xml', seconds: 0.5 } })));
            assert.equal(JSON.parse(await readFile(join(record, again.recordedAs), 'utf8')).model, saved.model);
            assert.equal((await readdir(join(record, 'models'))).length, 1);

            const outside = await client.callTool({ name: 'scene_check', arguments: { scene: '../elsewhere.xml' } });
            assert.equal((outside as { isError?: boolean }).isError, true);
            assert.match(text(outside), /not inside the project/);
            const broken = await client.callTool({ name: 'scene_run', arguments: { scene: 'robot/scene.xml', controller: 'function control(sim) { sim.ctrl("wrist", 1); }', seconds: 1 } });
            assert.match(text(broken), /no actuator named \\"wrist\\"/);
        } finally {
            await client.close();
            await server.close();
        }
    } finally {
        await rm(project, { recursive: true, force: true });
    }
});

test('obstacles from a photo: SAM boxes mapped onto the floor the photo shows', () => {
    // A 400x200 photo of the floor x 0..2 m (far edge at the top), y -1..1 m (left edge = y 1).
    const seg = {
        prompt: 'cardboard box', width: 400, height: 200, objects: [
            { id: '0', box: { x1: 0, y1: 0, x2: 99, y2: 49 }, confidence: 0.9 },
            { id: '1', box: { x1: 300, y1: 150, x2: 399, y2: 199 }, confidence: 0.2 },
            { id: '2', box: { x1: 200, y1: 100, x2: 201, y2: 101 }, confidence: 0.95 },
        ],
    };
    const r = obstaclesFromSegments(seg, { xMin: 0, xMax: 2, yMin: -1, yMax: 1 });
    assert.deepEqual(r.obstacles, [{ name: 'cardboard box 1', x: 1.75, y: 0.75, width: 0.5, depth: 0.5, height: 0.25 }]);
    assert.match(r.skipped.join('\n'), /confidence 0.20/);
    assert.match(r.skipped.join('\n'), /too small/);
    assert.throws(() => obstaclesFromSegments(seg, { xMin: 1, xMax: 0, yMin: 0, yMax: 1 }), /floor area/);
    assert.throws(() => obstaclesFromSegments({ width: 0, height: 0, objects: [] }, { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }), /segmentImage/);
});

test('duck_obstacles_from_photo reads the saved segments and the obstacles run in duck_run', async () => {
    const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const project = await mkdtemp(join(tmpdir(), 'robolance-photo-'));
    try {
        await mkdir(join(project, 'segments'), { recursive: true });
        await writeFile(join(project, 'segments/room-box.json'), JSON.stringify({
            prompt: 'box', width: 100, height: 100, objects: [{ id: '0', box: { x1: 40, y1: 60, x2: 59, y2: 69 }, confidence: 0.8 }],
        }));
        const server = createHardwareServer({ compile: fakeCompile, recordDir: '', projectDir: project });
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'test', version: '0.0.0' });
        await client.connect(clientSide);
        try {
            const area = { xMin: -0.4, xMax: 1.3, yMin: -0.7, yMax: 0.7 };
            const res = JSON.parse(text(await client.callTool({ name: 'duck_obstacles_from_photo', arguments: { segments: 'segments/room-box.json', area } })));
            assert.equal(res.obstacles.length, 1);
            assert.equal(res.obstacles[0].name, 'box 1');
            const field = { ...DEFAULT_FIELD, obstacles: res.obstacles };
            const run = JSON.parse(text(await client.callTool({ name: 'duck_run', arguments: { mission: 'log(field.obstacles.length);', field, limitS: 2 } })));
            assert.deepEqual(run.logs, ['1']);
            const outside = await client.callTool({ name: 'duck_obstacles_from_photo', arguments: { segments: '../x.json', area } });
            assert.equal(outside.isError, true);
        } finally {
            await client.close();
            await server.close();
        }
    } finally {
        await rm(project, { recursive: true, force: true });
    }
});
