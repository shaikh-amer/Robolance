// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scene, bodyPoses, createController, decodeMesh, extractViewerModel } from '../src/index.js';

/** A two-joint arm on a table with a box to reach for, written the way an agent would. */
const ARM = `
<mujoco model="arm">
  <option timestep="0.002"/>
  <worldbody>
    <light pos="0 0 2"/>
    <geom name="floor" type="plane" size="1 1 0.05" rgba="0.8 0.8 0.8 1"/>
    <body name="base" pos="0 0 0.05">
      <geom name="base_geom" type="cylinder" size="0.05 0.05" rgba="0.2 0.2 0.2 1"/>
      <body name="upper" pos="0 0 0.075">
        <joint name="shoulder" type="hinge" axis="0 0 1" damping="0.5"/>
        <geom name="upper_geom" type="capsule" fromto="0 0 0 0.2 0 0" size="0.02" rgba="1 0.5 0.1 1"/>
        <body name="fore" pos="0.2 0 0">
          <joint name="elbow" type="hinge" axis="0 0 1" damping="0.5"/>
          <geom name="fore_geom" type="capsule" fromto="0 0 0 0.15 0 0" size="0.015" rgba="1 0.5 0.1 1"/>
          <site name="tip" pos="0.15 0 0"/>
        </body>
      </body>
    </body>
    <body name="box" pos="0.3 0.1 0.03">
      <freejoint/>
      <geom name="box_geom" type="box" size="0.03 0.03 0.03" rgba="0.1 0.4 0.9 1" mass="0.1"/>
    </body>
  </worldbody>
  <actuator>
    <position name="shoulder_motor" joint="shoulder" kp="20" ctrlrange="-3 3"/>
    <position name="elbow_motor" joint="elbow" kp="10" ctrlrange="-2.5 2.5"/>
  </actuator>
  <sensor>
    <framepos name="tip_pos" objtype="site" objname="tip"/>
  </sensor>
</mujoco>`;

const files = (xml: string) => new Map<string, string>([['scene.xml', xml]]);

test('a scene loads, reports what it has, and its checks pass', async () => {
    const scene = await Scene.load(files(ARM), 'scene.xml');
    try {
        const check = scene.check();
        assert.equal(check.ok, true, JSON.stringify(check.issues));
        assert.deepEqual(check.actuators, ['shoulder_motor', 'elbow_motor']);
        assert.deepEqual(check.sensors, ['tip_pos']);
        assert.equal(check.bodies, 4);
        assert.equal(check.dof, 8);
        assert.ok(check.mass > 0.1);
    } finally {
        scene.dispose();
    }
});

test('MuJoCo errors come back in words, and paths cannot leave the scene folder', async () => {
    await assert.rejects(Scene.load(files('<mujoco><worldbody><body><geom type="nonsense"/></body></worldbody></mujoco>'), 'scene.xml'), /could not load scene\.xml/);
    await assert.rejects(Scene.load(new Map([['../escape.xml', '<mujoco/>']]), '../escape.xml'), /leaves the scene folder/);
});

test('parts that start inside each other and an exploding scene are reported', async () => {
    const overlapping = ARM.replace('<body name="box" pos="0.3 0.1 0.03">', '<body name="box" pos="0.06 0 0.09">');
    const scene = await Scene.load(files(overlapping), 'scene.xml');
    try {
        const check = scene.check();
        assert.equal(check.ok, false);
        assert.ok(check.issues.some(i => i.kind === 'penetration' && /box_geom/.test(i.message)), JSON.stringify(check.issues));
    } finally {
        scene.dispose();
    }
    const exploding = ARM.replace('<option timestep="0.002"/>', '<option timestep="0.5"/>').replace('kp="20"', 'kp="200000"');
    const unstable = await Scene.load(files(exploding), 'scene.xml');
    try {
        const run = await unstable.run({ seconds: 5, controller: 'function control(sim) { sim.ctrl("shoulder_motor", 3); }' });
        assert.ok(run.outcome === 'unstable' || run.check.issues.some(i => i.kind === 'unstable' || i.kind === 'warning'), JSON.stringify({ outcome: run.outcome, issues: run.check.issues }));
    } finally {
        unstable.dispose();
    }
});

test('a controller moves the arm, keeps state between calls, records metrics and can stop the run', async () => {
    const scene = await Scene.load(files(ARM), 'scene.xml');
    try {
        const run = await scene.run({
            seconds: 3,
            controller: `
                let calls = 0;
                function init(sim) { sim.log('actuators', sim.actuators()); }
                function control(sim) {
                    calls++;
                    sim.ctrl('shoulder_motor', 1.0);
                    sim.ctrl('elbow_motor', 99); // clamped to 2.5
                    const tip = sim.sensor('tip_pos');
                    sim.metric('tip_y', tip[1]);
                    if (Math.abs(sim.joint('shoulder').q - 1.0) < 0.01 && sim.t > 1) {
                        sim.stop('reached after ' + calls + ' calls');
                    }
                }`,
        });
        assert.equal(run.outcome, 'stopped', `${run.message}`);
        assert.match(run.message ?? '', /reached after \d+ calls/);
        assert.ok(run.simS > 1 && run.simS < 3);
        assert.ok(run.frames.length >= run.simS * 25 - 1, `${run.frames.length} frames`);
        assert.equal(run.frames[0].length, run.nq);
        const series = run.metrics.tip_y;
        assert.ok(series.length > 40 && Math.abs(series[0][1]) < 0.01 && series[series.length - 1][1] > 0.08, 'the tip swung round');
        assert.match(run.logs[0], /shoulder_motor/);
        const last = run.frames[run.frames.length - 1];
        assert.ok(Math.abs(last[1] - 2.5) < 0.1, `elbow clamped to its range, got ${last[1]}`);
    } finally {
        scene.dispose();
    }
});

test('controller mistakes end the run with a message instead of throwing', async () => {
    const scene = await Scene.load(files(ARM), 'scene.xml');
    try {
        const missing = await scene.run({ seconds: 1, controller: 'function control(sim) { sim.ctrl("wrist", 1); }' });
        assert.equal(missing.outcome, 'error');
        assert.match(missing.message ?? '', /no actuator named "wrist"/);
        const looping = await scene.run({ seconds: 1, controller: 'function control(sim) { while (true) {} }' });
        assert.equal(looping.outcome, 'error');
        assert.match(looping.message ?? '', /timed out/i);
        assert.throws(() => createController('const x = 1;'), /must define function control/);
        const noCodegen = await scene.run({ seconds: 0.1, controller: 'function control(sim) { eval("1"); }' });
        assert.equal(noCodegen.outcome, 'error');
    } finally {
        scene.dispose();
    }
});

test('the viewer model draws primitives, and its kinematics match MuJoCo for every joint type', async () => {
    const xml = `
<mujoco>
  <worldbody>
    <body name="cart" pos="0.1 0 0.2">
      <joint name="rail" type="slide" axis="1 0 0" ref="0.05"/>
      <geom type="box" size="0.05 0.03 0.02"/>
      <body name="pole" pos="0 0 0.02" euler="0 20 0">
        <joint name="pivot" type="hinge" axis="0 1 0" pos="0 0 0.01" ref="0.3"/>
        <joint name="twist" type="hinge" axis="0 0 1"/>
        <geom type="capsule" fromto="0 0 0 0 0 0.3" size="0.01"/>
        <body name="head" pos="0 0 0.3">
          <joint name="neck" type="ball" pos="0 0 -0.02"/>
          <geom type="sphere" size="0.03"/>
          <geom type="ellipsoid" size="0.02 0.01 0.015" pos="0.03 0 0"/>
        </body>
      </body>
    </body>
    <body name="drop" pos="0.5 0 0.5"><freejoint/><geom type="cylinder" size="0.02 0.04"/></body>
  </worldbody>
</mujoco>`;
    const scene = await Scene.load(files(xml), 'scene.xml');
    try {
        const model = scene.viewerModel();
        const shapes = model.geoms.map(g => g.shape?.type);
        assert.deepEqual(shapes, ['box', 'capsule', 'sphere', 'ellipsoid', 'cylinder']);
        assert.ok(model.geoms.every(g => g.mesh === -1));
        assert.equal(model.bodies.find(b => b.name === 'pole')?.joints?.length, 2);
        const { mj, model: m, data: d } = scene;
        const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
        for (let trial = 0; trial < 20; trial++) {
            for (let i = 0; i < m.nq; i++) {
                d.qpos[i] = rand(-1, 1);
            }
            // Ball and free quaternions must be unit length.
            const norm = (a: number) => {
                const n = Math.hypot(d.qpos[a], d.qpos[a + 1], d.qpos[a + 2], d.qpos[a + 3]);
                for (let k = 0; k < 4; k++) {
                    d.qpos[a + k] /= n;
                }
            };
            norm(3);
            norm(10);
            mj.mj_kinematics(m, d);
            const mine = bodyPoses(model, d.qpos as ArrayLike<number>);
            for (let b = 1; b < m.nbody; b++) {
                const dp = Math.hypot(mine[b].pos[0] - d.xpos[3 * b], mine[b].pos[1] - d.xpos[3 * b + 1], mine[b].pos[2] - d.xpos[3 * b + 2]);
                const dot = Math.abs(mine[b].quat.reduce((s, v, k) => s + v * d.xquat[4 * b + k], 0));
                assert.ok(dp < 1e-5 && 1 - dot < 1e-5, `${model.bodies[b].name}: ${dp} m, ${1 - dot}`);
            }
        }
    } finally {
        scene.dispose();
    }
});

test('meshes in a scene are simplified and decodable', async () => {
    // A tetrahedron as an inline mesh asset.
    const xml = `
<mujoco>
  <asset><mesh name="tet" vertex="0 0 0  0.1 0 0  0 0.1 0  0 0 0.1"/></asset>
  <worldbody><body pos="0 0 0.1"><freejoint/><geom type="mesh" mesh="tet"/></body></worldbody>
</mujoco>`;
    const scene = await Scene.load(files(xml), 'scene.xml');
    try {
        const model = extractViewerModel(scene.mj, scene.model);
        assert.equal(model.meshes.length, 1);
        assert.equal(model.meshes[0].name, 'tet');
        const mesh = decodeMesh(model.meshes[0]);
        assert.equal(mesh.indices.length % 3, 0);
        assert.ok(mesh.indices.length >= 12);
    } finally {
        scene.dispose();
    }
});
