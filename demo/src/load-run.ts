// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Where the replay page gets its run: the share link's fragment (the run
 * itself, deflated), a `?run=<url>` to a recorded run file, or a file the
 * user drops on the page. Pure functions; the page wires them to the DOM.
 */

import { readHardwareProject, type RunEntry } from 'robolance-openlance-hardware/lib/browser/hardware-project';
import { decodeShare, parseShareHash, sharedRunToEntry, validateSharedRun, type SharedRun } from 'robolance-openlance-hardware/lib/browser/share-run';

export type RunSource =
    | { kind: 'share'; encoded: string }
    | { kind: 'url'; url: string }
    | { kind: 'none' };

/** What the page's URL says to load. */
export function runSource(location: { hash: string; search: string }): RunSource {
    const encoded = parseShareHash(location.hash);
    if (encoded) {
        return { kind: 'share', encoded };
    }
    const url = new URLSearchParams(location.search).get('run');
    if (url) {
        return { kind: 'url', url };
    }
    return { kind: 'none' };
}

/** A shared run from the fragment. Throws with a readable message. */
export async function runFromShare(encoded: string): Promise<RunEntry> {
    let decoded: unknown;
    try {
        decoded = await decodeShare(encoded);
    } catch {
        throw new Error('This link does not carry a run (the fragment is damaged or truncated).');
    }
    const problem = validateSharedRun(decoded);
    if (problem) {
        throw new Error(`This link does not carry a run: ${problem}.`);
    }
    return sharedRunToEntry(decoded as SharedRun);
}

/** A run from the text of a recorded `.robolance/runs/<time>.json` file. */
export function runFromRecordText(text: string, fileName: string = 'run.json'): RunEntry {
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
    if (!Number.isFinite(stamp)) {
        stamp = Date.now();
    }
    const project = readHardwareProject(new Map([[`.robolance/runs/${stamp}.json`, text]]));
    const run = project.runs[0];
    if (!run) {
        throw new Error('That file is not a recorded run (expected the JSON hardware_run writes under .robolance/runs/).');
    }
    return run;
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
