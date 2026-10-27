// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Diagram } from 'robolance-hardware-sim';
import { expectedWiring, fitWithin, imageFromDataUrl, WIRING_CHECK_DISPLAY_TEXT, wiringCheckPrompt } from '../src/browser/wiring-check';

test('every part type gets its real-world wiring', () => {
    assert.match(expectedWiring({ type: 'led', id: 'led1', pin: 13, color: 'green' }), /green LED "led1": anode .* 220 Ω resistor to pin D13, cathode .* GND/);
    assert.match(expectedWiring({ type: 'led', id: 'led2', pin: 7, activeLow: true }), /cathode .* pin D7, anode .* 5V/);
    assert.match(expectedWiring({ type: 'button', id: 'btn', pin: 2 }), /pin D2, the other side to GND; no resistor/);
    assert.match(expectedWiring({ type: 'button', id: 'btn', pin: 2, activeHigh: true }), /pull-down resistor to GND, the other side to 5V/);
    assert.match(expectedWiring({ type: 'servo', id: 'arm', pin: 9 }), /signal wire .* pin D9, red to 5V/);
    assert.match(expectedWiring({ type: 'ultrasonic', id: 'eyes', trig: 12, echo: 11 }), /TRIG to pin D12, ECHO to pin D11/);
    assert.match(expectedWiring({ type: 'potentiometer', id: 'pot', pin: 'A0' }), /wiper\) to A0/);
    assert.match(expectedWiring({ type: 'motor', id: 'left', in1: 4, in2: 5, en: 6 }), /IN1 to pin D4, IN2 to pin D5, EN to pin D6 \(PWM\)/);
    assert.match(expectedWiring({ type: 'linesensor', id: 'eyeL', pin: 2, forwardCm: 9, leftCm: 2.5 }), /OUT to pin D2; .* 9 cm forward and 2.5 cm left of centre/);
    assert.match(expectedWiring({ type: 'linesensor', id: 'eyeR', pin: 3, forwardCm: 9, leftCm: -2.5 }), /2.5 cm right of centre/);
    assert.match(expectedWiring({ type: 'linesensor', id: 'eye', pin: 3 }), /8 cm forward and centred/, 'an unplaced sensor sits where the simulator puts it');
    assert.match(expectedWiring({ type: 'linesensor', id: 'eye', pin: 3, leftCm: 2.5 }, 10), /10 cm forward and 2.5 cm left/, 'the robot radius of the diagram');
});

test('the prompt places line sensors with the diagram robot radius', () => {
    const prompt = wiringCheckPrompt({ parts: [{ type: 'linesensor', id: 'eye', pin: 2, leftCm: -2.5 }], arena: { preset: 'line', left: 'l', right: 'r', robot: { radius: 6 } } } as never);
    assert.match(prompt, /6 cm forward and 2.5 cm right of centre/);
});

test('the prompt lists the circuit, names the robot roles and asks for a verdict and fixes', () => {
    const diagram: Diagram = {
        parts: [
            { type: 'motor', id: 'left', in1: 4, in2: 5, en: 6 },
            { type: 'motor', id: 'right', in1: 7, in2: 8, en: 10 },
            { type: 'ultrasonic', id: 'eyes', trig: 12, echo: 11 },
        ],
        arena: { preset: 'corner', left: 'left', right: 'right', sensor: 'eyes' },
    };
    const prompt = wiringCheckPrompt(diagram);
    assert.match(prompt, /attached photo/);
    assert.equal((prompt.match(/^- /gm) ?? []).length, 3, 'one line per part');
    assert.match(prompt, /motors "left" \(left\) and "right" \(right\), distance sensor "eyes" facing forward/);
    assert.match(prompt, /"Wiring matches" or "N things to fix"/);
    assert.match(prompt, /do not edit files, compile or run the simulator/);
    assert.doesNotMatch(wiringCheckPrompt({ parts: [{ type: 'led', id: 'l', pin: 13 }] }), /robot/);
    assert.ok(WIRING_CHECK_DISPLAY_TEXT.length < 80, 'the chat shows a short line, not the whole prompt');
});

test('photos are scaled down to the longest edge and never up', () => {
    assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
    assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 });
    assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
    assert.deepEqual(fitWithin(0, 0, 1600), { width: 1, height: 1 });
});

test('a data URL becomes the attachment the chat takes', () => {
    assert.deepEqual(imageFromDataUrl('board.jpg', 'data:image/jpeg;base64,AAAA'), { name: 'board.jpg', mimeType: 'image/jpeg', data: 'AAAA' });
    assert.deepEqual(imageFromDataUrl('x', 'QUJD', 'image/png'), { name: 'x', mimeType: 'image/png', data: 'QUJD' });
});
