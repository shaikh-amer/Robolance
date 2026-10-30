// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerShell, playerKey, SEEK_STEP_MS, Transport } from '../src/browser/player';

const on = (tagName: string, type?: string) => ({ tagName, type });

test('player keys: space or K plays, arrows seek, Home restarts, C camera, F fullscreen', () => {
    const page = on('DIV');
    assert.deepEqual(playerKey(' ', page), { kind: 'toggle' });
    assert.deepEqual(playerKey('k', page), { kind: 'toggle' });
    assert.deepEqual(playerKey('ArrowLeft', page), { kind: 'seek', deltaMs: -SEEK_STEP_MS });
    assert.deepEqual(playerKey('ArrowRight', page), { kind: 'seek', deltaMs: SEEK_STEP_MS });
    assert.deepEqual(playerKey('Home', page), { kind: 'restart' });
    assert.deepEqual(playerKey('c', page), { kind: 'camera' });
    assert.deepEqual(playerKey('F', page), { kind: 'fullscreen' });
    assert.deepEqual(playerKey('Escape', page), { kind: 'exit' });
    assert.equal(playerKey('x', page), undefined);
});

test('player keys never take typing, shortcuts with modifiers, or a focused control\'s own keys', () => {
    assert.equal(playerKey('k', on('INPUT', 'text')), undefined);
    assert.equal(playerKey(' ', on('TEXTAREA')), undefined);
    assert.equal(playerKey('c', { tagName: 'DIV', isContentEditable: true }), undefined);
    assert.equal(playerKey('f', on('DIV'), { ctrl: true }), undefined);
    // A focused button clicks itself on Space; the player must not toggle too.
    assert.equal(playerKey(' ', on('BUTTON')), undefined);
    assert.deepEqual(playerKey('k', on('BUTTON')), { kind: 'toggle' });
    // The scrubber moves itself with the arrows, but Space still plays.
    assert.equal(playerKey('ArrowRight', on('INPUT', 'range')), undefined);
    assert.deepEqual(playerKey(' ', on('INPUT', 'range')), { kind: 'toggle' });
});

test('the player shows a fullscreen button on the picture, and the transport plays and scrubs', () => {
    const noop = () => undefined;
    const html = renderToStaticMarkup(
        <PlayerShell playing={false} timeMs={1500} durationMs={10000} onToggle={noop} onSeek={noop} viewport="tablet" className="robolance-duck-wrap">
            <div className="picture" />
        </PlayerShell>,
    );
    assert.match(html, /class="robolance-duck-wrap robolance-player"/);
    assert.match(html, /data-viewport="tablet"/);
    assert.match(html, /aria-label="Fullscreen"/);
    assert.doesNotMatch(html, /robolance-fs-bar/, 'fullscreen controls only in fullscreen');
    const transport = renderToStaticMarkup(<Transport playing timeMs={12000} durationMs={10000} onToggle={noop} onSeek={noop} label="run #2" />);
    assert.match(transport, /aria-label="Pause"/);
    assert.match(transport, /10\.00 \/ 10\.0 s/, 'time clamps to the run');
    assert.match(transport, /run #2/);
});
