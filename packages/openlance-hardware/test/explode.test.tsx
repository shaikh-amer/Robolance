// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import * as THREE from 'three';
import { renderToStaticMarkup } from 'react-dom/server';
import { duckModel } from 'robolance-duck-sim/viewer/duck-model';
import { EXPLODE_SPREAD, RobotParts, bodyLabel, describeBody, describeJoint, describeMaterial, describeRole, explodeOffsets } from '../src/browser/robot-parts';
import { PartCard, ViewerRail } from '../src/browser/ViewerRail';
import { partEntriesOf } from '../src/browser/viewer-rail-state';

const restFrame = () => { const f = new Float64Array(duckModel.nq); f[3] = 1; f[2] = 0.3; return f; };

test('explode offsets fan bodies out sideways and lift them from the lowest one; nothing sinks and the world never moves', () => {
    const poses = [
        { pos: [0, 0, 0] as [number, number, number], quat: [1, 0, 0, 0] as [number, number, number, number] },
        { pos: [1, 0, 0.1] as [number, number, number], quat: [1, 0, 0, 0] as [number, number, number, number] },
        { pos: [3, 0, 1.1] as [number, number, number], quat: [1, 0, 0, 0] as [number, number, number, number] },
    ];
    const o = explodeOffsets(poses, 1);
    assert.deepEqual(o[0], [0, 0, 0]);
    // middle is x = 2: body 1 goes left, body 2 goes right, by their own distance.
    // body 1 is the lowest, so it stays at its height; body 2 rises by its height above it.
    assert.deepEqual(o[1], [-1, 0, 0]);
    assert.deepEqual(o[2], [1, 0, 1]);
    assert.deepEqual(explodeOffsets(poses, 0.5)[2], [0.5, 0, 0.5]);
    assert.ok(explodeOffsets(poses, 1).every(v => v[2] >= 0), 'no body moves down');
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
    // The lowest part is no lower than when assembled: the feet stay on the floor.
    const lowest = () => { robot.group.updateMatrixWorld(true); return new THREE.Box3().setFromObject(robot.group).min.z; };
    const explodedLow = lowest();
    robot.setExplode(0); robot.pose(restFrame());
    assert.ok(explodedLow >= lowest() - 1e-6, `exploded min z ${explodedLow} vs assembled ${lowest()}`);
    robot.setExplode(1); robot.pose(restFrame());
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
    // Collapsed: the name tile and the chevron only, no details.
    const card = renderToStaticMarkup(<PartCard hit={{ body: 3, bodyName: 'head', parentName: 'trunk', meshName: 'head_shell', parts: 2, joint: 'Hinge about z', material: 'Light shell plastic (#d9d9d6)', role: 'The head' }} onClear={() => undefined} />);
    assert.match(card, /robolance-part-name">head</);
    assert.match(card, /aria-expanded="false"/);
    assert.doesNotMatch(card, /Hinge about z|Light shell|trunk/);
});

test('a body is described by its joint, its material and its name', () => {
    assert.equal(describeJoint({ name: 'x', parent: 1, pos: [0, 0, 0], quat: [1, 0, 0, 0], joint: { type: 'hinge', qpos: 7, axis: [0, 0, 1], pos: [0, 0, 0] } }), 'Hinge about z');
    assert.equal(describeJoint({ name: 'x', parent: 1, pos: [0, 0, 0], quat: [1, 0, 0, 0], joint: { type: 'hinge', qpos: 7, axis: [0, -1, 0], pos: [0, 0, 0] } }), 'Hinge about -y');
    assert.match(describeJoint({ name: 'x', parent: 0, pos: [0, 0, 0], quat: [1, 0, 0, 0], joint: { type: 'free', qpos: 0 } }), /Free-floating/);
    assert.match(describeJoint({ name: 'x', parent: 1, pos: [0, 0, 0], quat: [1, 0, 0, 0], joint: null }), /Fixed/);
    assert.match(describeMaterial({ body: 1, mesh: -1, pos: [0, 0, 0], quat: [1, 0, 0, 0], rgba: [0.85, 0.85, 0.84, 1] }), /^Light shell plastic .*#d9d9d6/);
    assert.match(describeMaterial({ body: 1, mesh: -1, pos: [0, 0, 0], quat: [1, 0, 0, 0], rgba: [0.2, 0.2, 0.2, 1] }), /^Dark plastic/);
    assert.match(describeMaterial({ body: 1, mesh: -1, pos: [0, 0, 0], quat: [1, 0, 0, 0], rgba: [1, 0.4, 0.1, 1] }), /^Coloured plastic/);
    assert.match(describeMaterial({ body: 1, mesh: -1, pos: [0, 0, 0], quat: [1, 0, 0, 0], rgba: [0.7, 0.7, 0.7, 1], surface: { specular: 0.5, shininess: 0.9, reflectance: 0.8 } }), /^Metal, glossy/);
    assert.match(describeRole('left hip yaw link')!, /hip.*turns left and right/);
    assert.match(describeRole('left knee link')!, /knee/);
    assert.equal(describeRole('body 7'), undefined);
    const d = describeBody(duckModel, 1);
    assert.ok(d.joint && d.material && d.meshes && d.meshes.length === d.parts, JSON.stringify(d));
});
