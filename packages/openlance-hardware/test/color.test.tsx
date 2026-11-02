// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ColorSwatches } from '../src/browser/ColorSwatches';
import { COLOR_PRESETS, loadColor, randomColor, saveColor } from '../src/browser/robot-color';

test('the colour presets are the model colours, white, black, grey and random', () => {
    assert.deepEqual(COLOR_PRESETS.map(p => p.id), ['original', 'white', 'black', 'grey', 'random']);
    for (const p of COLOR_PRESETS) {
        if (p.id === 'original' || p.id === 'random') {
            assert.equal(p.hex, undefined);
        } else {
            assert.match(p.hex!, /^#[0-9a-f]{6}$/);
        }
    }
});

test('a random colour is a saturated #rrggbb, different each time, and deterministic for a given source', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
        const c = randomColor();
        assert.match(c, /^#[0-9a-f]{6}$/);
        seen.add(c);
    }
    assert.ok(seen.size > 10, 'random colours vary');
    let n = 0;
    const seq = () => [0.1, 0.5, 0.5][n++ % 3];
    n = 0; const a = randomColor(seq);
    n = 0; const b = randomColor(seq);
    assert.equal(a, b);
});

test('without storage the remembered colour is simply none, and saving does not throw', () => {
    assert.equal(loadColor(), undefined);
    saveColor('#123456');
    saveColor(undefined);
});

test('the swatches mark the active preset, and an off-preset colour counts as the random one', () => {
    const none = renderToStaticMarkup(<ColorSwatches value={undefined} onChange={() => undefined} />);
    assert.match(none, /aria-label="Robot colour"/);
    assert.equal(none.match(/class="robolance-swatch /g)?.length, 5);
    assert.match(none, /robolance-swatch-original active/);
    const black = renderToStaticMarkup(<ColorSwatches value="#1e2024" onChange={() => undefined} />);
    assert.match(black, /robolance-swatch-black active/);
    assert.doesNotMatch(black, /robolance-swatch-random active/);
    const odd = renderToStaticMarkup(<ColorSwatches value="#3b82f6" onChange={() => undefined} />);
    assert.match(odd, /robolance-swatch-random active" style="background:#3b82f6"/);
});
