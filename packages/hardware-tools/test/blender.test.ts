// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { blenderArgs, createHardwareServer, exportScriptPath, parseBlenderResult } from '../src/index.js';

test('parseBlenderResult reads the last result line among Blender\'s noise', () => {
    const out = 'Blender 4.5.15\nRead blend: x.blend\nROBOLANCE_RESULT {"scene":"old.xml"}\nsaving\nROBOLANCE_RESULT {"scene":"scene.xml","bodies":3}\nBlender quit\n';
    assert.deepEqual(parseBlenderResult(out), { scene: 'scene.xml', bodies: 3, warnings: [] });
    assert.equal(parseBlenderResult('no result here'), undefined);
    assert.equal(parseBlenderResult('ROBOLANCE_RESULT {broken'), undefined);
});

test('Blender runs headless, without the user\'s add-ons, failing on a script error', () => {
    const argv = blenderArgs('/p/a.blend', '/s/export_scene.py', { mode: 'mjcf' });
    assert.deepEqual(argv.slice(0, 7), ['-b', '/p/a.blend', '--factory-startup', '--python-exit-code', '1', '-P', '/s/export_scene.py']);
    assert.equal(argv[7], '--');
    assert.deepEqual(JSON.parse(argv[8]), { mode: 'mjcf' });
    assert.ok(existsSync(exportScriptPath()), 'the exporter ships with the package');
});

/**
 * A stand-in for Blender: writes a one-body MJCF (mjcf mode) or two boxes
 * (obstacles mode), the way the real exporter reports them.
 */
function fakeBlender(dir: string): string {
    const bin = join(dir, 'fake-blender.mjs');
    writeFileSync(bin, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
const args = JSON.parse(process.argv[process.argv.indexOf('--') + 1]);
console.log('Blender 4.5.15 (fake)');
if (args.mode === 'mjcf') {
  mkdirSync(args.out, { recursive: true });
  writeFileSync(args.out + '/scene.xml', '<mujoco model="fake"><worldbody><geom type="plane" size="2 2 0.1"/><body name="crate" pos="0 0 0.2"><freejoint/><geom type="box" size="0.1 0.1 0.1" mass="1"/></body></worldbody></mujoco>');
  console.log('ROBOLANCE_RESULT ' + JSON.stringify({ scene: 'scene.xml', bodies: 1, joints: 1, warnings: [], args }));
} else {
  const obstacles = [{ name: 'Leg 1', x: 1 + (args.offsetX ?? 0), y: 0.5, width: 0.05, depth: 0.05, height: 0.7, heading: 20 }];
  if (args.out) writeFileSync(args.out, JSON.stringify({ obstacles }));
  console.log('ROBOLANCE_RESULT ' + JSON.stringify({ obstacles, warnings: ['Top: nothing below 0.30 m, left out'] }));
}
`);
    chmodSync(bin, 0o755);
    return bin;
}

async function connect(projectDir: string, blender: string) {
    const server = createHardwareServer({ maxDurationMs: 10_000, recordDir: '', projectDir, blender });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientSide);
    return { client, close: () => Promise.all([client.close(), server.close()]) };
}

function body(result: unknown): { text: string; isError: boolean } {
    const r = result as { content: Array<{ text: string }>; isError?: boolean };
    return { text: r.content[0].text, isError: Boolean(r.isError) };
}

test('scene_from_blender exports next to the .blend and checks the scene in MuJoCo', async () => {
    const project = mkdtempSync(join(tmpdir(), 'rl-blend-'));
    execFileSync('mkdir', ['-p', join(project, 'models')]);
    writeFileSync(join(project, 'models', 'arm.blend'), 'BLENDER');
    const { client, close } = await connect(project, fakeBlender(project));
    try {
        const res = body(await client.callTool({ name: 'scene_from_blender', arguments: { blend: 'models/arm.blend', density: 500 } }));
        assert.equal(res.isError, false, res.text);
        const out = JSON.parse(res.text);
        assert.equal(out.scene, 'models/arm-mjcf/scene.xml');
        assert.equal(out.check.ok, true, res.text);
        assert.equal(out.exported.args.density, 500);
        assert.equal(out.exported.args.floor, true);

        const outside = body(await client.callTool({ name: 'scene_from_blender', arguments: { blend: 'models/arm.blend', out: '../elsewhere' } }));
        assert.equal(outside.isError, true);
        assert.match(outside.text, /not inside the project/);
        const notBlend = body(await client.callTool({ name: 'scene_from_blender', arguments: { blend: 'models/none.blend' } }));
        assert.match(notBlend.text, /is not a \.blend in the project/);
    } finally {
        await close();
    }
});

test('duck_obstacles_from_blender returns boxes, shifted and written when asked', async () => {
    const project = mkdtempSync(join(tmpdir(), 'rl-blend-'));
    writeFileSync(join(project, 'room.blend'), 'BLENDER');
    const { client, close } = await connect(project, fakeBlender(project));
    try {
        const res = body(await client.callTool({ name: 'duck_obstacles_from_blender', arguments: { blend: 'room.blend', offset: { x: 2, y: 0 }, out: 'field/room.json' } }));
        assert.equal(res.isError, false, res.text);
        const out = JSON.parse(res.text);
        assert.equal(out.obstacles[0].x, 3);
        assert.equal(out.written, 'field/room.json');
        assert.deepEqual(out.warnings, ['Top: nothing below 0.30 m, left out']);
        assert.equal(JSON.parse(readFileSync(join(project, 'field', 'room.json'), 'utf8')).obstacles.length, 1);
    } finally {
        await close();
    }
});

test('a missing Blender says so', async () => {
    const project = mkdtempSync(join(tmpdir(), 'rl-blend-'));
    writeFileSync(join(project, 'room.blend'), 'BLENDER');
    const { client, close } = await connect(project, join(project, 'no-such-blender'));
    try {
        const res = body(await client.callTool({ name: 'duck_obstacles_from_blender', arguments: { blend: 'room.blend' } }));
        assert.equal(res.isError, true);
        assert.match(res.text, /Blender is not installed here/);
    } finally {
        await close();
    }
});

// --- with the real Blender ------------------------------------------------
const realBlender = process.env.ROBOLANCE_BLENDER;

/** An arm on a fixed base (a motor and a position servo), a table at 20°, a free crate and a flat sign. */
const MAKE_SCENE = `
import bpy, math, sys
out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
def cube(name, loc, scale, parent=None, **props):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale  # left unapplied on purpose: the exporter bakes scale into the meshes
    bpy.context.view_layer.update()
    if parent:
        mw = o.matrix_world.copy()
        o.parent = parent
        o.matrix_world = mw
    for k, v in props.items():
        o[k] = v
    return o
base = cube("Base", (0, 0, 0.05), (0.1, 0.1, 0.05))
link1 = cube("Link 1", (0, 0, 0.25), (0.03, 0.03, 0.15), base, joint="hinge", joint_axis="z", actuator="motor", ctrl_range="-2,2", mass=0.5)
cube("Link 2", (0.12, 0, 0.42), (0.12, 0.025, 0.025), link1, joint="hinge", joint_axis="y", joint_range="-90,90", actuator="position", kp=20, mass=0.3)
bpy.ops.mesh.primitive_cube_add(location=(1.0, 0.5, 0.73)); top = bpy.context.object; top.scale = (0.6, 0.4, 0.02)
parts = [top]
for dx in (-0.55, 0.55):
    for dy in (-0.35, 0.35):
        bpy.ops.mesh.primitive_cube_add(location=(1.0 + dx, 0.5 + dy, 0.355)); l = bpy.context.object; l.scale = (0.025, 0.025, 0.355); parts.append(l)
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = top
bpy.ops.object.join()
top.name = "Table"; top["collision"] = "parts"
top.rotation_euler = (0, 0, math.radians(20))
cube("Crate", (-0.6, 0.4, 0.2), (0.15, 0.15, 0.15), None, joint="free", mass=2.0)
bpy.ops.mesh.primitive_plane_add(location=(0, -1, 0.3), size=0.4); bpy.context.object.name = "Sign"
bpy.ops.wm.save_as_mainfile(filepath=out)
`;

test('real Blender: a rigged .blend becomes a MuJoCo scene whose motors move, and a room becomes duck obstacles', { skip: !realBlender && 'set ROBOLANCE_BLENDER to run', timeout: 300_000 }, async () => {
    const project = mkdtempSync(join(tmpdir(), 'rl-blend-real-'));
    const maker = join(project, 'make.py');
    writeFileSync(maker, MAKE_SCENE);
    execFileSync(realBlender!, ['-b', '--factory-startup', '--python-exit-code', '1', '-P', maker, '--', join(project, 'robot.blend')], { stdio: 'ignore' });
    const { client, close } = await connect(project, realBlender!);
    try {
        const res = body(await client.callTool({ name: 'scene_from_blender', arguments: { blend: 'robot.blend' } }));
        assert.equal(res.isError, false, res.text);
        const out = JSON.parse(res.text);
        assert.equal(out.check.ok, true, res.text);
        assert.deepEqual(out.check.actuators, ['Link_1', 'Link_2']);
        assert.equal(out.check.issues.length, 0, res.text);
        assert.equal(out.exported.bodies, 6);
        assert.equal(out.exported.hulls, 9, 'one hull per table part (5), base, two links and the crate');
        assert.ok(out.exported.warnings.some((w: string) => /Sign: flat/.test(w)));

        const run = body(await client.callTool({
            name: 'scene_run', arguments: {
                scene: out.scene, seconds: 1.5,
                controller: `function control(sim){ sim.ctrl('Link_1', 0.3); sim.ctrl('Link_2', 0.8); sim.metric('j1', sim.joint('Link_1_joint').q); sim.metric('j2', sim.joint('Link_2_joint').q); sim.metric('crate', sim.body('Crate').pos[2]); }`,
            },
        }));
        assert.equal(run.isError, false, run.text);
        const metrics = JSON.parse(run.text).metrics;
        assert.ok(metrics.j1.last > 1, `the motor turns the base joint (fixed-base contact excluded): ${run.text}`);
        assert.ok(Math.abs(metrics.j2.last - 0.8) < 0.05, `the position servo holds its target: ${run.text}`);
        assert.ok(Math.abs(metrics.crate.last - 0.15) < 0.01, `the crate rests on the floor: ${run.text}`);

        const obs = body(await client.callTool({ name: 'duck_obstacles_from_blender', arguments: { blend: 'robot.blend' } }));
        const boxes = JSON.parse(obs.text).obstacles as Array<{ name: string; x: number; y: number; heading: number; height: number }>;
        const legs = boxes.filter(b => b.name.startsWith('Table'));
        assert.equal(legs.length, 4, obs.text);
        assert.ok(legs.every(l => l.heading === 20 && Math.abs(l.height - 0.71) < 0.01), obs.text);
        const leg = legs.find(l => l.x < 0.7)!;
        assert.ok(Math.abs(leg.x - 0.6029) < 0.01 && Math.abs(leg.y + 0.017) < 0.01, `a leg turned 20° about the table centre: ${obs.text}`);
        assert.ok(!boxes.some(b => b.name === 'Sign'), 'the sign is above the duck');
    } finally {
        await close();
    }
});
