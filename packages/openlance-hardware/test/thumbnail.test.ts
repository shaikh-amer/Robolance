// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MissionResult } from 'robolance-duck-sim/viewer';
import { thumbnailMomentMs } from '../src/browser/duck-thumbnail';
import { portraitShot } from '../src/browser/stage-base';

const base = { simS: 20, kicks: [], scoredAtS: null, field: {} } as unknown as MissionResult;

test('the thumbnail is taken just before the first kick, as the lid comes down, or late in the run', () => {
    assert.equal(thumbnailMomentMs({ ...base, kicks: [{ atS: 8 }, { atS: 12 }] } as unknown as MissionResult), 7850);
    assert.equal(thumbnailMomentMs({ ...base, scoredAtS: 15 } as unknown as MissionResult), 14000);
    assert.equal(thumbnailMomentMs({ ...base, field: { laptop: { x: 0, y: 0, heading: 0 } }, closedAtS: 6 } as unknown as MissionResult), 5600);
    assert.equal(thumbnailMomentMs(base), 12000);
    // Never before the start or after the end.
    assert.equal(thumbnailMomentMs({ ...base, kicks: [{ atS: 0.05 }] } as unknown as MissionResult), 0);
});

test('the portrait shot is in front of the robot and to its side, looking toward what it goes for', () => {
    // Facing +x from the origin, the ball 0.3 m ahead.
    const shot = portraitShot(0, 0, 0, [0.3, 0]);
    assert.ok(shot.position[0] > 0, 'in front');
    assert.ok(shot.position[1] > 0, 'to the left');
    assert.ok(shot.position[2] > 0.15 && shot.position[2] < 0.3, 'about eye height');
    assert.ok(shot.lookAt[0] > 0 && shot.lookAt[0] < 0.3, 'between the robot and the ball');
});
