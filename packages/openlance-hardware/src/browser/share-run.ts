// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Sharing a run: the recorded run, trimmed to what a replay needs, is
 * deflated and base64url-encoded into the fragment of the replay page's
 * URL. Nothing is uploaded; the link carries the run. The replay page
 * (demo/) decodes it with the same module.
 */

import type { Diagram, RunTrace, Sample, ScriptedEvent } from 'robolance-hardware-sim';
import type { RunEntry } from './hardware-project';

/** Where shared runs open. */
export const REPLAY_PAGE_URL = 'https://robolance.openlance.ai/replay/';

/** The fragment parameter that carries a run. */
export const SHARE_PARAM = 'r';

/** Poses kept on a shared path; a 20 s run records thousands. */
export const SHARE_MAX_POSES = 600;

/** Part-state samples kept, so the circuit replays over time too (one every 250 ms in a recording). */
export const SHARE_MAX_SAMPLES = 120;

/** What a link carries: the trace with its path and samples thinned. */
export interface SharedRun {
    v: 1;
    at?: string;
    sketchSha?: string;
    diagram?: Diagram;
    durationMs: number;
    events: ScriptedEvent[];
    trace: Omit<RunTrace, 'samples'> & { samples?: Sample[] };
}

export function trimRunForShare(run: RunEntry, maxPoses: number = SHARE_MAX_POSES, maxSamples: number = SHARE_MAX_SAMPLES): SharedRun {
    const { samples, ...rest } = run.trace;
    const trace: SharedRun['trace'] = { ...rest, serial: run.trace.serial.slice(-200), notes: [...run.trace.notes] };
    if (samples?.length) {
        trace.samples = thinPath(samples, maxSamples);
    }
    if (run.trace.arena) {
        trace.arena = { ...run.trace.arena, path: thinPath(run.trace.arena.path, maxPoses) };
    }
    return {
        v: 1,
        at: run.at,
        sketchSha: run.sketchSha,
        diagram: run.diagram,
        durationMs: run.durationMs,
        events: run.events,
        trace,
    };
}

/** Keeps at most maxPoses poses, evenly spaced, always including the first and the last. */
export function thinPath<T>(path: T[], maxPoses: number): T[] {
    if (path.length <= maxPoses || maxPoses < 2) {
        return path.slice();
    }
    const out: T[] = [];
    const step = (path.length - 1) / (maxPoses - 1);
    for (let i = 0; i < maxPoses; i++) {
        out.push(path[Math.round(i * step)]);
    }
    return out;
}

/** A shared run as the panel's RunEntry, so the same views replay it. */
export function sharedRunToEntry(shared: SharedRun): RunEntry {
    const stamp = shared.at ? Date.parse(shared.at) : NaN;
    const trace: RunTrace = { ...shared.trace, samples: shared.trace.samples ?? [] };
    return {
        path: `.robolance/runs/${Number.isFinite(stamp) ? stamp : 0}.json`,
        stamp: Number.isFinite(stamp) ? stamp : 0,
        at: shared.at,
        sketchSha: shared.sketchSha,
        diagram: shared.diagram,
        durationMs: shared.durationMs,
        events: shared.events ?? [],
        trace,
    };
}

/** Says why a decoded payload is not a shared run, or returns undefined. */
export function validateSharedRun(value: unknown): string | undefined {
    const s = value as SharedRun | null;
    if (!s || typeof s !== 'object') {
        return 'not an object';
    }
    if (s.v !== 1) {
        return `unknown share version ${String(s.v)}`;
    }
    if (!s.trace || typeof s.trace !== 'object' || !Array.isArray(s.trace.serial) || !Array.isArray(s.trace.notes)) {
        return 'the run has no trace';
    }
    if (s.trace.arena && !Array.isArray(s.trace.arena.path)) {
        return 'the arena trace has no path';
    }
    return undefined;
}

export async function encodeShare(payload: unknown): Promise<string> {
    const json = new TextEncoder().encode(JSON.stringify(payload));
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return base64url(bytes);
}

export async function decodeShare(text: string): Promise<unknown> {
    const bytes = fromBase64url(text);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const json = await new Response(stream).text();
    return JSON.parse(json) as unknown;
}

/** The link for a run; `base` is the replay page. */
export async function shareRunUrl(run: RunEntry, base: string = REPLAY_PAGE_URL): Promise<string> {
    const encoded = await encodeShare(trimRunForShare(run));
    return `${base}#${SHARE_PARAM}=${encoded}`;
}

/** The encoded run in a replay URL's fragment, if any. */
export function parseShareHash(hash: string): string | undefined {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    for (const part of raw.split('&')) {
        const eq = part.indexOf('=');
        if (eq > 0 && part.slice(0, eq) === SHARE_PARAM) {
            const value = part.slice(eq + 1).trim();
            return value || undefined;
        }
    }
    return undefined;
}

function base64url(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}
