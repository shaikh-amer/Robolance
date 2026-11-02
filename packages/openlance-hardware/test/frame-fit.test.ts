// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FRAME_MARGIN, distanceToFit, orbitPosition, panDelta, zoomAnchorDrag } from '../src/browser/frame-fit';

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

test('fogRange: the fog backs off with the camera, never comes closer', async () => {
    const { fogRange } = await import('../src/browser/frame-fit');
    assert.deepEqual(fogRange(3, 3, 4, 14), { near: 4, far: 14 });
    // Zoomed out from 3 m to 9 m: the fog starts 6 m further away.
    assert.deepEqual(fogRange(9, 3, 4, 14), { near: 10, far: 20 });
    // Zoomed in: it stays where it was.
    assert.deepEqual(fogRange(1, 3, 4, 14), { near: 4, far: 14 });
    assert.deepEqual(fogRange(Number.NaN, 3, 4, 14), { near: 4, far: 14 });
});

test('panning moves the target so the ground under the pointer stays under it', () => {
    const cam = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    cam.up.set(0, 0, 1);
    orbitPosition(target, angles, 2, cam.position);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const forward = target.clone().sub(cam.position).setZ(0).normalize();
    // Dragging right: the scene follows the pointer, so the target goes the other way, along the camera's right, in the ground plane.
    const r = panDelta(angles, 2, 100, 0, 600, 38);
    assert.ok(r.dot(right) < -0.01 && Math.abs(r.z) < 1e-9, `drag right moves the target against the camera's right, got ${r.toArray()}`);
    assert.ok(Math.abs(r.dot(forward)) < 1e-6, 'a horizontal drag does not move the target forward');
    // Dragging down brings the far ground closer: the target moves away from the camera.
    const d = panDelta(angles, 2, 0, 100, 600, 38);
    assert.ok(d.dot(forward) > 0.01 && Math.abs(d.dot(right)) < 1e-6, `drag down moves the target forward, got ${d.toArray()}`);
    // A hundred pixels on a 600 px canvas is a sixth of the view: about that much of the visible height, scaled by the distance.
    const visible = 2 * 2 * Math.tan((38 * Math.PI) / 360);
    assert.ok(Math.abs(r.length() - visible / 6) < 1e-9, 'pans by the screen fraction dragged');
    assert.ok(Math.abs(panDelta(angles, 4, 100, 0, 600, 38).length() - 2 * r.length()) < 1e-9, 'twice as far away pans twice as much');
});

test('zooming at a point drags the target towards it by the share the zoom pushes away', () => {
    // Zoom in to half the distance at a point 100 px right, 40 px below the centre:
    // the target moves half the offset towards the point (a drag of the opposite sign).
    assert.deepEqual(zoomAnchorDrag(0.5, 100, 40), [-50, -20]);
    // Zooming out past the point pulls the target away from it.
    assert.deepEqual(zoomAnchorDrag(2, 100, 40), [100, 40]);
    // No zoom, no drag; a pinch at the centre never pans.
    assert.deepEqual(zoomAnchorDrag(1, 100, 40), [-0, -0]);
    assert.deepEqual(zoomAnchorDrag(0.5, 0, 0), [-0, -0]);
});
