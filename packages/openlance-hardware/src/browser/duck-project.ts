// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Microduck projects in the Hardware tab: the runs duck_run recorded and
 * the replay frame for a moment in a run. Pure functions over the file
 * map, like hardware-project.ts.
 */

import type { MissionResult } from 'robolance-duck-sim/viewer';
import { normalizePath } from './hardware-project';

/** One recorded Microduck run (the shape duck_run writes). */
export interface DuckRun {
    path: string;
    stamp: number;
    at?: string;
    mission: string;
    /** The project's own policies the run used, by skill name (path in the project). */
    skills?: Record<string, { path: string; sha?: string }>;
    result: MissionResult;
}

const RUN_FILE = /(?:^|\/)\.robolance\/runs\/(\d+)(?:-\d+)?\.json$/;
const MISSION_FILE = /(?:^|\/)mission\.js$/;

/** A project the duck view applies to: a mission.js, or recorded duck runs. */
export function isDuckProject(files: ReadonlyMap<string, string>): boolean {
    for (const [key, text] of files) {
        const path = normalizePath(key);
        if (MISSION_FILE.test(path) && !path.includes('node_modules/')) {
            return true;
        }
        if (RUN_FILE.test(path) && text.includes('"kind":"duck"')) {
            return true;
        }
    }
    return false;
}

/** The mission file the agent edits, shortest path first. */
export function missionPath(files: ReadonlyMap<string, string>): string | undefined {
    let best: string | undefined;
    for (const key of files.keys()) {
        const path = normalizePath(key);
        if (MISSION_FILE.test(path) && !path.includes('node_modules/') && (best === undefined || path.length < best.length)) {
            best = path;
        }
    }
    return best;
}

/** Recorded duck runs, newest first. Arduino runs and broken files are skipped. */
export function readDuckRuns(files: ReadonlyMap<string, string>): DuckRun[] {
    const runs: DuckRun[] = [];
    for (const [key, text] of files) {
        const path = normalizePath(key);
        const m = RUN_FILE.exec(path);
        if (!m || !text.includes('"kind":"duck"')) {
            continue;
        }
        const run = parseDuckRun(path, Number(m[1]), text);
        if (run) {
            runs.push(run);
        }
    }
    return runs.sort((a, b) => b.path.localeCompare(a.path));
}

export function parseDuckRun(path: string, stamp: number, text: string): DuckRun | undefined {
    try {
        const raw = JSON.parse(text) as Partial<DuckRun> & { kind?: string };
        const r = raw.result;
        if (raw.kind !== 'duck' || !r || typeof r !== 'object' || typeof r.outcome !== 'string' || !Array.isArray(r.notes) || !r.field) {
            return undefined;
        }
        const skills = raw.skills && typeof raw.skills === 'object' ? raw.skills : undefined;
        return { path, stamp, at: raw.at, mission: typeof raw.mission === 'string' ? raw.mission : '', ...(skills ? { skills } : {}), result: r };
    } catch {
        return undefined;
    }
}

/** How long a run lasted, ms. */
export function duckRunMs(run: DuckRun): number {
    return Math.round(run.result.simS * 1000);
}

/**
 * The replay frame at `atMs`, linearly between the two recorded frames
 * around it (quaternions are re-normalised by the viewer's kinematics).
 */
export function frameAt(result: MissionResult, atMs: number): number[] | undefined {
    const replay = result.replay;
    if (!replay || replay.frames.length === 0) {
        return undefined;
    }
    const at = Math.max(0, (atMs / 1000) * replay.frameHz);
    const i = Math.min(replay.frames.length - 1, Math.floor(at));
    const j = Math.min(replay.frames.length - 1, i + 1);
    const t = Math.min(1, at - i);
    const a = replay.frames[i];
    const b = replay.frames[j];
    if (t === 0 || i === j) {
        return a;
    }
    return a.map((v, k) => v + (b[k] - v) * t);
}

/** The duck's path up to `atMs` (the record keeps two points a second). */
export function pathUntil(result: MissionResult, atMs: number): Array<[number, number]> {
    const n = Math.min(result.path.length, Math.floor(atMs / 500) + 1);
    return result.path.slice(0, Math.max(1, n));
}

const OUTCOME: Record<MissionResult['outcome'], string> = {
    'goal': 'goal',
    'no-goal': 'no goal',
    'closed': 'laptop closed',
    'still-open': 'laptop still open',
    'fell': 'fell over',
    'time-up': 'time up',
    'error': 'mission error',
    'timeout': 'timed out',
};

export function outcomeLabel(result: MissionResult): string {
    return OUTCOME[result.outcome] ?? result.outcome;
}

/** One line that says how a run went. */
export function describeDuckRun(run: DuckRun): string {
    const r = run.result;
    if (r.field.laptop) {
        const closed = typeof r.closedAtS === 'number' ? `laptop closed at ${r.closedAtS.toFixed(1)} s` : outcomeLabel(r);
        return `${r.simS.toFixed(1)} s · score ${r.score} · ${closed}`;
    }
    const goal = r.scoredAtS !== null ? `goal at ${r.scoredAtS.toFixed(1)} s` : outcomeLabel(r);
    const kicks = r.kicks.length;
    return `${r.simS.toFixed(1)} s · score ${r.score} · ${goal} · ${kicks} kick${kicks === 1 ? '' : 's'}`;
}

/** "walk: policies/walk/policy.onnx · getUp: …", or '' when the run used only the built-in skills. */
export function describeDuckSkills(run: DuckRun): string {
    return Object.entries(run.skills ?? {})
        .filter(([, v]) => v && typeof v.path === 'string')
        .map(([name, v]) => `${name}: ${v.path}`)
        .join(' · ');
}
