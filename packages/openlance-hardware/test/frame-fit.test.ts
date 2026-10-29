// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FRAME_MARGIN, distanceToFit, orbitPosition } from '../src/browser/frame-fit';

// The default pitch: duck at the origin, goal ~1 m away, seen from the broadcast angle.
const points = [
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0.26), new THREE.Vector3(0.5, 0.2, 0),
    new THREE.Vector3(0.95, -0.3, 0.12), new THREE.Vector3(1.07, 0.3, 0.12),
];
const target = new THREE.Vector3(0.53, 0, 0.05);
const angles = { azimuth: 72, elevation: 30 };

function inFrame(d: number, aspect: number): boolean {
    const cam = new THREE.PerspectiveCamera(38, aspect, 0.01, 100);
    cam.up.set(0, 0, 1);
    orbitPosition(target, angles, d, cam.position);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    return points.every(q => {
        const p = q.clone().project(cam);
        return Math.abs(p.x) <= FRAME_MARGIN + 1e-6 && Math.abs(p.y) <= FRAME_MARGIN + 1e-6;
    });
}

test('the fitted distance keeps every point in frame, and no closer distance does', () => {
    for (const aspect of [390 / 640, 1, 1280 / 650]) {
        const d = distanceToFit(points, target, angles, 38, aspect);
        assert.ok(inFrame(d, aspect), `aspect ${aspect}: points in frame at ${d}`);
        assert.ok(!inFrame(d * 0.97, aspect), `aspect ${aspect}: tight fit`);
    }
});

test('a tall phone panel stands further back than a wide desktop one', () => {
    const phone = distanceToFit(points, target, angles, 38, 390 / 640);
    const desktop = distanceToFit(points, target, angles, 38, 1280 / 650);
    assert.ok(phone > desktop * 1.3, `${phone} vs ${desktop}`);
});
