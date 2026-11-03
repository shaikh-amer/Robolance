// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import * as THREE from 'three';
import { renderToStaticMarkup } from 'react-dom/server';
import { duckModel } from 'robolance-duck-sim/viewer/duck-model';
import { EXPLODE_SPREAD, RobotParts, bodyLabel, explodeOffsets } from '../src/browser/robot-parts';
import { PartCard, ViewerRail } from '../src/browser/ViewerRail';
import { partEntriesOf } from '../src/browser/viewer-rail-state';

const restFrame = () => { const f = new Float64Array(duckModel.nq); f[3] = 1; f[2] = 0.3; return f; };

test('explode offsets push every body away from the robot\'s middle, and the world never moves', () => {
    const poses = [
        { pos: [0, 0, 0] as [number, number, number], quat: [1, 0, 0, 0] as [number, number, number, number] },
        { pos: [1, 0, 1] as [number, number, number], quat: [1, 0, 0, 0] as [number, number, number, number] },
        { pos: [3, 0, 1] as [number, number, number], quat: [1, 0, 0, 0] as [number, number, number, number] },
    ];
    const o = explodeOffsets(poses, 1);
    assert.deepEqual(o[0], [0, 0, 0]);
    // middle is x = 2: body 1 goes left, body 2 goes right, by their own distance.
    assert.deepEqual(o[1], [-1, 0, 0]);
    assert.deepEqual(o[2], [1, 0, 0]);
    assert.deepEqual(explodeOffsets(poses, 0.5)[2], [0.5, 0, 0]);
});

test('an exploded duck has its parts further from the middle; assembled again they are back', () => {
    const robot = new RobotParts(duckModel);
    const spread = () => {
        robot.group.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(robot.group);
        return box.getSize(new THREE.Vector3()).length();
    };
    robot.pose(restFrame());
    const assembled = spread();
    robot.setExplode(1);
    robot.pose(restFrame());
    const exploded = spread();
    assert.ok(exploded > assembled * 1.5, `exploded ${exploded} vs assembled ${assembled}`);
    assert.equal(robot.exploded, 1);
    robot.setExplode(0);
    robot.pose(restFrame());
    assert.ok(Math.abs(spread() - assembled) < 1e-6, 'reassembled exactly');
    assert.ok(EXPLODE_SPREAD > 0);
    robot.dispose();
});

test('a ray through the duck picks a named body and lights it up; a miss picks nothing', () => {
    const robot = new RobotParts(duckModel);
    robot.pose(restFrame());
    robot.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(robot.group);
    const c = box.getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster(new THREE.Vector3(c.x + 2, c.y, c.z), new THREE.Vector3(-1, 0, 0));
    const hit = robot.pick(ray);
    assert.ok(hit, 'something in the duck is hit');
    assert.ok(hit!.bodyName.length > 0 && hit!.parts >= 1);
    assert.equal(hit!.bodyName, bodyLabel(duckModel, hit!.body));
    robot.highlight(hit!.body);
    assert.equal(robot.highlightedBody, hit!.body);
    const glowing = (m: THREE.Object3D) => ((m as THREE.Mesh).material as THREE.MeshPhysicalMaterial).emissive.getHex() !== 0;
    const lit = robot.group.children.filter(glowing);
    assert.equal(lit.length, hit!.parts, 'every part of the body glows');
    robot.highlight(undefined);
    assert.equal(robot.group.children.filter(glowing).length, 0);
    const miss = robot.pick(new THREE.Raycaster(new THREE.Vector3(c.x + 2, c.y + 5, c.z + 5), new THREE.Vector3(-1, 0, 0)));
    assert.equal(miss, undefined);
    assert.equal(robot.hitForBody(hit!.body)?.bodyName, hit!.bodyName);
    robot.dispose();
});

test('the parts list names every body with visual parts, floor excluded, and the rail renders its menus', () => {
    const entries = partEntriesOf(duckModel);
    assert.ok(entries.length > 5);
    assert.ok(entries.every(e => e.name && e.parts >= 1));
    assert.ok(!entries.some(e => e.body === 0), 'the world body is not a part');
    const closed = renderToStaticMarkup(<ViewerRail explode={0} onExplode={() => undefined} parts={entries} onPickBody={() => undefined} onOpen={() => undefined} />);
    assert.match(closed, /aria-label="Exploded view"/);
    assert.match(closed, /aria-label="Parts list"/);
    assert.doesNotMatch(closed, /robolance-rail-menu/);
    const explode = renderToStaticMarkup(<ViewerRail explode={0.4} onExplode={() => undefined} parts={entries} onPickBody={() => undefined} open="explode" onOpen={() => undefined} />);
    assert.match(explode, /type="range"/);
    assert.match(explode, /value="40"/);
    assert.match(explode, /Reassemble/);
    const parts = renderToStaticMarkup(<ViewerRail explode={0} onExplode={() => undefined} parts={entries} picked={{ body: entries[0].body, bodyName: entries[0].name, parts: 1 }} onPickBody={() => undefined} open="parts" onOpen={() => undefined} />);
    assert.match(parts, /role="listbox"/);
    assert.match(parts, /aria-selected="true"/);
    const card = renderToStaticMarkup(<PartCard hit={{ body: 3, bodyName: 'head', parentName: 'trunk', meshName: 'head_shell', parts: 2 }} onClear={() => undefined} />);
    assert.match(card, /head/);
    assert.match(card, /2 parts · joined to trunk · head_shell/);
});
