// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Scene } from 'robolance-mujoco';
import { hardwareKind, hardwareTabApplies, HardwarePanel } from '../src/browser/HardwarePanel';
import { MetricChart, ScenePanelBody, formatValue } from '../src/browser/ScenePanel';
import { describeSceneRun, isSceneProject, metricAt, readSceneRuns, sceneFiles, sceneFrameAt, sceneModel } from '../src/browser/scene-project';
import { floorColor, gridColors } from '../src/browser/scene-stage';

const ARM = `<mujoco model="arm">
  <worldbody>
    <geom name="floor" type="plane" size="0 0 0.05"/>
    <body name="upper" pos="0 0 0.1">
      <joint name="shoulder" type="hinge" axis="0 0 1"/>
      <geom type="capsule" fromto="0 0 0 0.2 0 0" size="0.02"/>
      <site name="tip" pos="0.2 0 0"/>
    </body>
  </worldbody>
  <actuator><position name="motor" joint="shoulder" kp="10" ctrlrange="-3 3"/></actuator>
</mujoco>`;

let files: Map<string, string>;

before(async () => {
    const scene = await Scene.load(new Map([['scene.xml', ARM]]), 'scene.xml');
    try {
        const run = await scene.run({ seconds: 2, controller: 'function control(sim) { sim.ctrl("motor", 1); sim.metric("tip_y", sim.site("tip")[1]); sim.log("t", sim.t); }' });
        files = new Map([
            ['robot/scene.xml', ARM],
            ['.robolance/models/abc.json', JSON.stringify(scene.viewerModel())],
            ['.robolance/runs/1761645600000-001.json', JSON.stringify({ version: 1, kind: 'scene', at: '2026-10-28T10:00:00.000Z', scene: 'robot/scene.xml', model: 'models/abc.json', controller: 'function control(sim) {}', controllerSha: 'x', run })],
            // An Arduino run and a half-written file in the same folder are skipped.
            ['.robolance/runs/1761645500000-001.json', JSON.stringify({ version: 1, durationMs: 10, events: [], trace: { serial: [], samples: [] } })],
            ['.robolance/runs/1761645700000-001.json', '{"kind":"scene","run":'],
            ['node_modules/pkg/model.xml', ARM],
        ]);
    } finally {
        scene.dispose();
    }
});

test('MJCF projects are found and their runs read with the model they replay with', () => {
    assert.deepEqual(sceneFiles(files), ['robot/scene.xml'], 'node_modules is not the project');
    assert.equal(isSceneProject(files), true);
    assert.equal(isSceneProject(new Map([['index.html', '<html/>'], ['data.xml', '<root/>']])), false);
    assert.equal(hardwareKind(files), 'scene');
    assert.equal(hardwareTabApplies(files), true);
    assert.equal(hardwareKind(new Map([['mission.js', ''], ['robot/scene.xml', ARM]])), 'duck', 'a duck project stays a duck project');

    const runs = readSceneRuns(files);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].modelPath, '.robolance/models/abc.json');
    assert.match(describeSceneRun(runs[0]), /robot\/scene\.xml · 2\.0 s · ran to the end/);
    const model = sceneModel(files, runs[0]);
    assert.ok(model && model.geoms.some(g => g.shape?.type === 'capsule'));
    assert.equal(sceneModel(new Map(), runs[0]), undefined);
});

test('frames interpolate and metrics read back at a time', () => {
    const r = readSceneRuns(files)[0].run;
    const step = 1000 / r.frameHz;
    assert.deepEqual(sceneFrameAt(r, 0), r.frames[0]);
    const mid = sceneFrameAt(r, step * 3.5)!;
    assert.ok(Math.abs(mid[0] - (r.frames[3][0] + r.frames[4][0]) / 2) < 1e-9);
    const series = r.metrics.tip_y;
    assert.equal(metricAt(series, -1), undefined);
    assert.equal(metricAt(series, 1e9), series[series.length - 1][1]);
    assert.equal(metricAt(series, series[5][0] * 1000), series[5][1]);
});

test('the scene panel shows the robot view, the readout and the runs, and asks the agent when there are none', () => {
    const runs = readSceneRuns(files);
    const html = renderToStaticMarkup(<ScenePanelBody runs={runs} scenes={sceneFiles(files)} context={{ files, theme: 'dark', openFile: () => undefined }} />);
    assert.match(html, /Robot/);
    assert.match(html, /Runs \(1\)/);
    assert.match(html, /robolance-duck-scene/);
    assert.match(html, /tip_y/);
    assert.match(html, /scene\.xml/);
    const viaTab = renderToStaticMarkup(<HardwarePanel files={files} theme="light" />);
    assert.match(viaTab, /Runs \(1\)/);

    const noRuns = renderToStaticMarkup(<ScenePanelBody runs={[]} scenes={['robot/scene.xml']} context={{ files, theme: 'dark', askAgent: () => undefined }} />);
    assert.match(noRuns, /Ask the agent to run it/);
    const nothing = renderToStaticMarkup(<ScenePanelBody runs={[]} scenes={[]} context={{ files: new Map(), theme: 'dark', askAgent: () => undefined }} />);
    assert.match(nothing, /Ask the agent to design a robot/);
});

test('metric charts and values read well', () => {
    const html = renderToStaticMarkup(<MetricChart name="tip_y" series={[[0, 0], [1, 0.15], [2, 0.2]]} durationS={2} />);
    assert.match(html, /<polyline/);
    assert.match(html, /0 → 0\.2/);
    assert.equal(formatValue(0.000012), '1.20e-5');
    assert.equal(formatValue(12.3456), '12.35');
    assert.equal(formatValue(0.12345), '0.123');
});

test('the studio floor takes the model\'s ground colour and keeps its grid readable', () => {
    assert.deepEqual(floorColor([0.4, 0.4, 0.4]), [0.4, 0.4, 0.4]);
    assert.deepEqual(floorColor([0.4, 0.4, 0.4], [1, 0, 0]), [0.7, 0.2, 0.2]);
    assert.match(gridColors([0.9, 0.9, 0.9]).major, /^rgba\(20,/, 'dark lines on a light floor');
    assert.match(gridColors([0.2, 0.2, 0.2]).major, /^rgba\(255,/, 'light lines on a dark floor');
});
