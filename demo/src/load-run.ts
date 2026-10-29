// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Where the replay page gets its run: the share link's fragment (the run
 * itself, deflated), a `?run=<url>` to a recorded run file, or a file the
 * user drops on the page. Pure functions; the page wires them to the DOM.
 */

import { outcomeLabel, parseDuckRun, type DuckRun } from 'robolance-openlance-hardware/lib/browser/duck-project';
import { isSharedDuckRun, sharedDuckRunToRun, validateSharedDuckRun } from 'robolance-openlance-hardware/lib/browser/duck-share';
import { readHardwareProject, type RunEntry } from 'robolance-openlance-hardware/lib/browser/hardware-project';
import { decodeShare, parseShareHash, parseShortShare, sharedRunToEntry, validateSharedRun, type SharedRun } from 'robolance-openlance-hardware/lib/browser/share-run';

/** Where a short link's run is read: OpenLance's public shared-runs endpoint. */
export const SHARED_RUNS_API = 'https://api.openlance.ai/api/v1/public/shared-runs';

/** A run the page can show: an Arduino run (circuit, arena) or a Microduck run (the pitch). */
export type LoadedRun = { kind: 'arduino'; run: RunEntry } | { kind: 'duck'; run: DuckRun };

export type RunSource =
    | { kind: 'share'; encoded: string }
    | { kind: 'stored'; id: string }
    | { kind: 'url'; url: string }
    | { kind: 'none' };

/** What the page's URL says to load. */
export function runSource(location: { hash: string; search: string }): RunSource {
    const encoded = parseShareHash(location.hash);
    if (encoded) {
        return { kind: 'share', encoded };
    }
    const id = parseShortShare(location.search);
    if (id) {
        return { kind: 'stored', id };
    }
    const url = new URLSearchParams(location.search).get('run');
    if (url) {
        return { kind: 'url', url };
    }
    return { kind: 'none' };
}

/**
 * The run a short link names, read from OpenLance. It is stored exactly as a
 * long link encodes it, so it loads like one. Throws with a readable message.
 */
export async function loadStoredShare(id: string, fetchImpl: typeof fetch = fetch, api: string = SHARED_RUNS_API): Promise<LoadedRun> {
    let response: Response;
    try {
        response = await fetchImpl(`${api}/${encodeURIComponent(id)}`);
    } catch {
        throw new Error('Could not reach OpenLance to load this shared run. Check the connection and reload.');
    }
    if (response.status === 404) {
        throw new Error('This shared run does not exist (the link is wrong, or whoever shared it deleted it).');
    }
    if (!response.ok) {
        throw new Error(`Could not load this shared run (${response.status}).`);
    }
    const body = await response.json() as { encoded?: unknown };
    if (typeof body.encoded !== 'string' || !body.encoded) {
        throw new Error('This shared run is empty.');
    }
    return loadShare(body.encoded);
}

/** Whatever run a share link carries. Throws with a readable message. */
export async function loadShare(encoded: string): Promise<LoadedRun> {
    const decoded = await decodeFragment(encoded);
    if (isSharedDuckRun(decoded)) {
        const problem = validateSharedDuckRun(decoded);
        if (problem) {
            throw new Error(`This link does not carry a run: ${problem}.`);
        }
        return { kind: 'duck', run: sharedDuckRunToRun(decoded) };
    }
    return { kind: 'arduino', run: arduinoFromShare(decoded) };
}

/** Whatever run a recorded `.robolance/runs/<time>.json` file holds. */
export function loadRecordText(text: string, fileName: string = 'run.json'): LoadedRun {
    let kind: unknown;
    try {
        kind = (JSON.parse(text) as { kind?: unknown }).kind;
    } catch {
        kind = undefined;
    }
    if (kind === 'duck') {
        const run = parseDuckRun(`.robolance/runs/${stampOf(text, fileName)}.json`, stampOf(text, fileName), text);
        if (!run) {
            throw new Error('That file is not a complete Microduck run (expected the JSON duck_run writes under .robolance/runs/).');
        }
        return { kind: 'duck', run };
    }
    return { kind: 'arduino', run: runFromRecordText(text, fileName) };
}

async function decodeFragment(encoded: string): Promise<unknown> {
    try {
        return await decodeShare(encoded);
    } catch {
        throw new Error('This link does not carry a run (the fragment is damaged or truncated).');
    }
}

/** A shared Arduino run from the fragment. Throws with a readable message. */
export async function runFromShare(encoded: string): Promise<RunEntry> {
    return arduinoFromShare(await decodeFragment(encoded));
}

function arduinoFromShare(decoded: unknown): RunEntry {
    const problem = validateSharedRun(decoded);
    if (problem) {
        throw new Error(`This link does not carry a run: ${problem}.`);
    }
    return sharedRunToEntry(decoded as SharedRun);
}

/** A run from the text of a recorded `.robolance/runs/<time>.json` file. */
export function runFromRecordText(text: string, fileName: string = 'run.json'): RunEntry {
    const stamp = stampOf(text, fileName);
    const project = readHardwareProject(new Map([[`.robolance/runs/${stamp}.json`, text]]));
    const run = project.runs[0];
    if (!run) {
        throw new Error('That file is not a recorded run (expected the JSON hardware_run writes under .robolance/runs/).');
    }
    return run;
}

/** The run's time: from the file name, else the record, else now. */
function stampOf(text: string, fileName: string): number {
    const stampFromName = /(\d{10,})/.exec(fileName)?.[1];
    let stamp = stampFromName ? Number(stampFromName) : NaN;
    if (!Number.isFinite(stamp)) {
        try {
            const at = (JSON.parse(text) as { at?: string }).at;
            stamp = at ? Date.parse(at) : NaN;
        } catch {
            stamp = NaN;
        }
    }
    return Number.isFinite(stamp) ? stamp : Date.now();
}

/** One line about a Microduck run for the page header. */
export function duckHeadline(run: DuckRun): string {
    const r = run.result;
    const parts = [`score ${r.score}`];
    parts.push(r.scoredAtS !== null ? `goal in ${r.scoredAtS.toFixed(1)} s` : `${outcomeLabel(r)} after ${r.simS.toFixed(1)} s`);
    parts.push(r.kicks.length === 1 ? '1 kick' : `${r.kicks.length} kicks`);
    return parts.join(' · ');
}

/** One line about the run for the page header. */
export function headline(run: RunEntry): string {
    const arena = run.trace.arena;
    const seconds = (run.trace.ranMs / 1000).toFixed(1);
    if (!arena) {
        return `${seconds} s on the bench`;
    }
    const parts = [`score ${arena.score}`];
    if (arena.reachedGoalAtMs !== null && arena.reachedGoalAtMs !== undefined) {
        parts.push(`goal reached in ${(arena.reachedGoalAtMs / 1000).toFixed(1)} s`);
    } else {
        parts.push(`goal not reached in ${seconds} s`);
    }
    if (arena.line) {
        parts.push(`line ${Math.round(arena.line.coverage * 100)}%`);
    }
    parts.push(arena.collisions === 1 ? '1 collision' : `${arena.collisions} collisions`);
    return parts.join(' · ');
}
