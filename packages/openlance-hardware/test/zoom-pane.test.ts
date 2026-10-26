// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampScale, fitView, MAX_SCALE, MIN_SCALE, pan, pinch, wheelFactor, zoomAt } from '../src/browser/zoom-pane';

const near = (actual: number, expected: number, message?: string): void => {
    assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} is not ${expected}`);
};

test('zoomAt keeps the point under the cursor in place', () => {
    const view = { scale: 1, x: 10, y: 20 };
    // Content point under the cursor before: ((100 - 10) / 1, (60 - 20) / 1) = (90, 40).
    const zoomed = zoomAt(view, 2, 100, 60);
    assert.equal(zoomed.scale, 2);
    near(zoomed.x + 90 * zoomed.scale, 100);
    near(zoomed.y + 40 * zoomed.scale, 60);
    // Zooming back out around the same point restores the view.
    const back = zoomAt(zoomed, 0.5, 100, 60);
    near(back.scale, 1);
    near(back.x, 10);
    near(back.y, 20);
});

test('scale stays within limits and a bad factor cannot break the view', () => {
    assert.equal(clampScale(100), MAX_SCALE);
    assert.equal(clampScale(0), MIN_SCALE);
    assert.equal(clampScale(Number.NaN), MIN_SCALE);
    assert.equal(zoomAt({ scale: 1, x: 0, y: 0 }, 1000, 0, 0).scale, MAX_SCALE);
    assert.equal(zoomAt({ scale: 1, x: 0, y: 0 }, 2, 0, 0, { max: 1.5 }).scale, 1.5);
});

test('fitView by width fills the pane width, starts at the top and never enlarges past maxScale', () => {
    const content = { width: 600, height: 400 };
    const narrow = fitView(content, { width: 308, height: 800 }, { mode: 'width', maxScale: 1, padding: 4 });
    near(narrow.scale, 300 / 600);
    assert.equal(narrow.x, 4);
    assert.equal(narrow.y, 4);
    const wide = fitView(content, { width: 1000, height: 800 }, { mode: 'width', maxScale: 1, padding: 4 });
    assert.equal(wide.scale, 1);
    // Natural size in a wider pane: centred horizontally, still at the top.
    near(wide.x, 4 + (992 - 600) / 2);
    assert.equal(wide.y, 4);
});

test('fitView contain shows all the content, centred, and can enlarge small content', () => {
    const view = fitView({ width: 120, height: 100 }, { width: 400, height: 300 }, { mode: 'contain', maxScale: 12, padding: 8 });
    near(view.scale, Math.min(384 / 120, 284 / 100));
    near(view.x + (120 * view.scale) / 2, 200);
    near(view.y + (100 * view.scale) / 2, 150);
});

test('pinch zooms by the spread of the fingers and follows their midpoint', () => {
    const view = { scale: 1, x: 0, y: 0 };
    const before: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
    const after: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 60, y: 120 }, { x: 260, y: 120 }];
    const pinched = pinch(view, before, after);
    near(pinched.scale, 2);
    // The content point that was under the old midpoint (150, 100) is now under the new one (160, 120).
    near(pinched.x + 150 * 2, 160);
    near(pinched.y + 100 * 2, 120);
    // Fingers that have not spread only pan.
    const same = pinch(view, before, [{ x: 110, y: 130 }, { x: 210, y: 130 }]);
    assert.equal(same.scale, 1);
    assert.deepEqual(same, pan(view, 10, 30));
});

test('wheel notches zoom in for negative deltas, out for positive, within bounds', () => {
    assert.ok(wheelFactor(-100) > 1);
    assert.ok(wheelFactor(100) < 1);
    near(wheelFactor(-100) * wheelFactor(100), 1);
    assert.equal(wheelFactor(-100000), 2);
    assert.equal(wheelFactor(100000), 0.5);
    assert.ok(wheelFactor(-1, 1) > wheelFactor(-1, 0), 'a line is a bigger step than a pixel');
});
