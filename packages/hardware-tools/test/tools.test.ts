// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildSketch, createHardwareServer, summarize, withPrototypes, type BuildResult } from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'hardware-sim', 'fixtures');
const benchHex = readFileSync(join(fixtures, 'bench.hex'), 'utf8');
const benchSketch = readFileSync(join(fixtures, 'bench.ino'), 'utf8');

test('withPrototypes declares functions used before their definition', () => {
    const out = withPrototypes('void setup() { blink(3); }\nvoid loop() {}\nvoid blink(int times) {\n}\nlong readCm() {\n  if (x) {\n  }\n}\n');
    assert.ok(out.startsWith('#include <Arduino.h>\nvoid blink(int times);\nlong readCm();\n'));
    assert.ok(!out.includes('if (x);'), 'control statements are not prototypes');
});

test('withPrototypes keeps #include lines first', () => {
    const out = withPrototypes('#include <Servo.h>\nServo s;\nvoid go() {}\nvoid setup() {}\nvoid loop() {}\n');
    assert.equal(out.split('\n')[0], '#include <Servo.h>');
    assert.equal(out.split('\n')[1], '#include <Arduino.h>');
});

const haveToolchain = Boolean(process.env.ROBOLANCE_ARDUINO_CORE);

test('buildSketch compiles the bench fixture (needs the AVR toolchain)', { skip: !haveToolchain && 'set ROBOLANCE_ARDUINO_CORE to run' }, async () => {
    const result = await buildSketch(benchSketch);
    assert.equal(result.ok, true, result.output);
    assert.ok(result.hex?.startsWith(':'));
    assert.ok(result.size && result.size.flashBytes > 1000);
});

test('buildSketch reports compiler errors (needs the AVR toolchain)', { skip: !haveToolchain && 'set ROBOLANCE_ARDUINO_CORE to run' }, async () => {
    const result = await buildSketch('void setup() { digitalWrite(13, HIGH) }\nvoid loop() {}\n');
    assert.equal(result.ok, false);
    assert.match(result.output, /expected ';'/);
});

/** A compiler that answers from the fixture, so the MCP tests need no toolchain. */
const fakeCompile = async (sketch: string): Promise<BuildResult> => sketch.includes('BROKEN')
    ? { ok: false, output: "sketch.ino:3:1: error: expected ';' before '}' token", backend: 'avr-gcc' }
    : { ok: true, hex: benchHex, output: '', size: { flashBytes: 4358, ramBytes: 200 }, backend: 'avr-gcc' };

async function connect() {
    const server = createHardwareServer({ compile: fakeCompile, maxDurationMs: 10_000 });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientSide);
    return { client, close: () => Promise.all([client.close(), server.close()]) };
}

function text(result: unknown): string {
    const content = (result as { content: { type: string; text?: string }[] }).content;
    return content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n');
}

test('the MCP server lists the hardware tools', async () => {
    const { client, close } = await connect();
    try {
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(t => t.name).sort(), ['hardware_arena', 'hardware_compile', 'hardware_parts', 'hardware_run']);
        const parts = await client.callTool({ name: 'hardware_parts', arguments: {} });
        assert.match(text(parts), /INPUT_PULLUP/);
        const arena = await client.callTool({ name: 'hardware_arena', arguments: {} });
        assert.equal(JSON.parse(text(arena)).width, 200);
    } finally {
        await close();
    }
});

test('hardware_compile returns ok and size, or the error', async () => {
    const { client, close } = await connect();
    try {
        const good = await client.callTool({ name: 'hardware_compile', arguments: { sketch: benchSketch } });
        assert.equal(good.isError ?? false, false);
        assert.equal(JSON.parse(text(good)).size.flashBytes, 4358);
        const bad = await client.callTool({ name: 'hardware_compile', arguments: { sketch: 'BROKEN' } });
        assert.equal(bad.isError, true);
        assert.match(text(bad), /expected ';'/);
    } finally {
        await close();
    }
});

test('hardware_run simulates the sketch on the circuit with scripted inputs', async () => {
    const { client, close } = await connect();
    try {
        const result = await client.callTool({
            name: 'hardware_run',
            arguments: {
                sketch: benchSketch,
                diagram: {
                    parts: [
                        { type: 'led', id: 'led13', pin: 13 },
                        { type: 'button', id: 'btn', pin: 2 },
                        { type: 'servo', id: 'arm', pin: 9 },
                        { type: 'potentiometer', id: 'pot', pin: 'A0' },
                    ],
                },
                durationMs: 2000,
                events: [{ atMs: 500, action: 'tap', part: 'btn', holdMs: 400 }],
            },
        });
        assert.equal(result.isError ?? false, false, text(result));
        const out = JSON.parse(text(result));
        assert.equal(out.ranMs, 2000);
        assert.equal(out.serial[0], 'ready');
        assert.ok(out.serial.includes('pressed'));
        assert.equal(out.final.arm.angle, 150);
        assert.ok(out.samples.length > 0 && out.samples.length <= 41);
        assert.ok(['on', 'off'].includes(out.samples[0].led13));
    } finally {
        await close();
    }
});

test('hardware_run rejects a bad diagram and a sketch that does not compile', async () => {
    const { client, close } = await connect();
    try {
        const bad = await client.callTool({
            name: 'hardware_run',
            arguments: { sketch: benchSketch, diagram: { parts: [{ type: 'led', id: 'a', pin: 13 }, { type: 'led', id: 'b', pin: 13 }] } },
        });
        assert.equal(bad.isError, true);
        assert.match(text(bad), /both use pin 13/);
        const broken = await client.callTool({ name: 'hardware_run', arguments: { sketch: 'BROKEN', diagram: { parts: [] } } });
        assert.equal(broken.isError, true);
        assert.equal(JSON.parse(text(broken)).stage, 'compile');
        const tooLong = await client.callTool({ name: 'hardware_run', arguments: { sketch: benchSketch, diagram: { parts: [] }, durationMs: 99_999 } });
        assert.equal(tooLong.isError, true);
    } finally {
        await close();
    }
});

test('summarize keeps a trace short enough for a model turn', () => {
    const serial = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const samples = Array.from({ length: 400 }, (_, i) => ({ atMs: i * 10, parts: { led: { on: i % 2 === 0, brightness: 1 }, arm: { angle: 90 } } }));
    const out = summarize({ durationMs: 4000, ranMs: 4000, serial, samples, final: {}, notes: [] });
    assert.equal((out.serial as string[]).length, 61);
    assert.ok((out.samples as unknown[]).length <= 40);
    assert.deepEqual((out.samples as Record<string, unknown>[])[0], { atMs: 0, led: 'on', arm: '90°' });
});
