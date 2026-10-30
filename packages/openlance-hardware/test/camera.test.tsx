// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraButton } from '../src/browser/DuckPanel';
import { trunkHeading } from '../src/browser/duck-stage';
import { CAMERA_FOV, CAMERA_LABELS, CAMERA_MODES, chaseShot, easeAngle, eyesShot, nextCameraMode } from '../src/browser/stage-base';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('the camera button goes broadcast → third person → first person → wide angle → broadcast', () => {
    assert.deepEqual(CAMERA_MODES, ['orbit', 'chase', 'eyes', 'wide']);
    let mode = CAMERA_MODES[0];
    const seen = [CAMERA_LABELS[mode]];
    for (let i = 0; i < 4; i++) {
        mode = nextCameraMode(mode);
        seen.push(CAMERA_LABELS[mode]);
    }
    assert.deepEqual(seen, ['Broadcast', 'Third person', 'First person', 'Wide angle', 'Broadcast']);
    // Wider lenses up close, as in a game.
    assert.ok(CAMERA_FOV.eyes > CAMERA_FOV.chase && CAMERA_FOV.chase > CAMERA_FOV.orbit);
});

test('third person sits behind the robot and turns with it; first person looks the way it walks', () => {
    // Facing +y (90°) from (1, 2).
    const chase = chaseShot(1, 2, Math.PI / 2);
    near(chase.position[0], 1);
    assert.ok(chase.position[1] < 2, 'behind');
    assert.ok(chase.lookAt[1] > 2, 'looking ahead');
    assert.ok(chase.position[2] > chase.lookAt[2], 'from above');
    const eyes = eyesShot(1, 2, Math.PI / 2);
    assert.ok(eyes.position[1] > 2 && eyes.position[1] < 2.2, 'just in front of the face');
    assert.ok(eyes.lookAt[1] > eyes.position[1], 'forward');
    assert.ok(eyes.lookAt[2] < eyes.position[2], 'tilted down to the ball');
});

test('the heading is the trunk\'s x axis on the ground, and eases the short way round', () => {
    near(trunkHeading([1, 0, 0, 0]), 0);
    // 90° about z: w = cos 45°, z = sin 45°.
    near(trunkHeading([Math.SQRT1_2, 0, 0, Math.SQRT1_2]), Math.PI / 2);
    // From 170° toward -170° goes through 180°, not back through 0°.
    const deg = (d: number) => (d * Math.PI) / 180;
    const eased = easeAngle(deg(170), deg(-170), 0.5);
    near(Math.cos(eased), Math.cos(deg(180)), 1e-9);
});

test('the camera button names the view it shows and the next one', () => {
    const html = renderToStaticMarkup(<CameraButton mode="chase" onClick={() => undefined} />);
    assert.match(html, /data-camera="chase"/);
    assert.match(html, /Camera: Third person\. Click for First person\./);
    assert.match(html, /<svg/);
});
