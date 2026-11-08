// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Blender models into the simulators. A Blender file (made by the agent's
 * Blender tools or by the user) becomes either a MuJoCo scene, with each
 * mesh object a body with a convex-hull collision shape and joints and
 * motors from its custom properties, or boxes for the Microduck's pitch,
 * from the parts of each object that stand on the floor below the duck's
 * head. The work happens in Blender itself (blender/export_scene.py, run
 * headless); this module runs it and reads its result line.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BLENDER_RESULT_MARK = 'ROBOLANCE_RESULT ';

/** What the agent sets on a Blender object to make it a robot part. */
export const BLENDER_PROPERTIES_HELP = `Custom properties on a Blender object (Object Properties → Custom Properties, or obj["joint"] = "hinge" in Python) set its physics:
- joint: "hinge" | "slide" | "ball" | "free" — how it moves relative to its Blender parent (none: fixed to it). "free" only on a top-level object (a crate that can be pushed).
- joint_axis: "x" | "y" | "z" — in the object's own axes (default "z"); put the object's origin on the joint.
- joint_range: "lo,hi" — degrees for a hinge, metres for a slide. joint_damping, joint_armature: numbers.
- actuator: "motor" | "position" | "velocity" on a hinge or slide; gear, kp, kv and ctrl_range ("lo,hi") tune it. The actuator is named after the object.
- mass (kg) or density (kg/m³; default 1000) — mass is spread over the collision shapes by volume.
- collision: "hull" (default: the convex hull) | "parts" (one hull per loose part: a table's legs and top) | "box" | "none".
- skip: true leaves the object out.
Blender parents become body parents. Units are metres, Z up, the floor at z = 0. Scale and modifiers are applied on export.`;

export interface BlenderExportResult {
    [key: string]: unknown;
    warnings: string[];
}

export interface BlenderRunOptions {
    /** Absolute path of the .blend. */
    blend: string;
    /** Script arguments: mode, out and the mode's options. */
    args: Record<string, unknown>;
    /** The Blender binary (default $ROBOLANCE_BLENDER or "blender" on PATH). */
    blender?: string;
    timeoutMs?: number;
}

/** The exporter script shipped with the package. */
export function exportScriptPath(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    // lib/blender.js (published) or .build/src/blender.js (tests).
    for (const candidate of [join(here, '..', 'blender', 'export_scene.py'), join(here, '..', '..', 'blender', 'export_scene.py')]) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error('blender/export_scene.py is missing from robolance-hardware-tools');
}

/** Reads the exporter's result line from Blender's output. */
export function parseBlenderResult(output: string): BlenderExportResult | undefined {
    const lines = output.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const at = lines[i].indexOf(BLENDER_RESULT_MARK);
        if (at >= 0) {
            try {
                const parsed = JSON.parse(lines[i].slice(at + BLENDER_RESULT_MARK.length)) as BlenderExportResult;
                parsed.warnings ??= [];
                return parsed;
            } catch {
                return undefined;
            }
        }
    }
    return undefined;
}

/** The arguments Blender is started with (headless, no user add-ons). */
export function blenderArgs(blend: string, script: string, args: Record<string, unknown>): string[] {
    return ['-b', blend, '--factory-startup', '--python-exit-code', '1', '-P', script, '--', JSON.stringify(args)];
}

/** Runs the exporter in Blender and returns its result, or throws with Blender's own words. */
export async function runBlenderExport(opts: BlenderRunOptions): Promise<BlenderExportResult> {
    const bin = opts.blender || process.env.ROBOLANCE_BLENDER || 'blender';
    const argv = blenderArgs(opts.blend, exportScriptPath(), opts.args);
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const output = await new Promise<{ code: number | null; text: string }>((resolveRun, reject) => {
        const child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
        let text = '';
        const keep = (chunk: Buffer) => {
            text += chunk.toString('utf8');
            if (text.length > 2_000_000) {
                text = text.slice(-1_000_000);
            }
        };
        child.stdout.on('data', keep);
        child.stderr.on('data', keep);
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.on('error', err => {
            clearTimeout(timer);
            reject((err as NodeJS.ErrnoException).code === 'ENOENT'
                ? new Error(`Blender is not installed here (looked for "${bin}"); set ROBOLANCE_BLENDER to its path`)
                : err);
        });
        child.on('close', code => {
            clearTimeout(timer);
            resolveRun({ code, text });
        });
    });
    const result = parseBlenderResult(output.text);
    if (result && typeof result.error === 'string') {
        throw new Error(result.error);
    }
    if (!result || output.code !== 0) {
        const tail = output.text.split('\n').filter(l => /error|Error|Traceback|line \d+/.test(l)).slice(-8).join('\n')
            || output.text.trim().split('\n').slice(-8).join('\n');
        throw new Error(`Blender ${output.code === null ? 'was stopped after ' + Math.round(timeoutMs / 1000) + ' s' : 'failed (exit ' + output.code + ')'}:\n${tail}`);
    }
    return result;
}
