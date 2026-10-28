// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Projects with robots described in MJCF: the scenes in the project and
 * the runs scene_run recorded, each with the viewer model it replays
 * with. Pure functions over the file map, like duck-project.ts.
 */

import type { ViewerModel } from 'robolance-duck-sim/viewer';
import { normalizePath } from './hardware-project';

/** What scene_run records about a run (robolance-mujoco's SceneRun, the parts a viewer reads). */
export interface SceneRunData {
    outcome: 'done' | 'stopped' | 'unstable' | 'error' | 'timeout';
    message?: string;
    simS: number;
    frameHz: number;
    nq: number;
    frames: number[][];
    metrics: Record<string, Array<[number, number]>>;
    logs: string[];
    check: { ok: boolean; actuators: string[]; sensors: string[]; issues: Array<{ kind: string; message: string }> };
}

export interface SceneRunEntry {
    path: string;
    stamp: number;
    at?: string;
    /** The scene's main MJCF, relative to the project. */
    scene: string;
    /** The viewer model's path in the project. */
    modelPath: string;
    controller: string;
    run: SceneRunData;
}

const RUN_FILE = /(?:^|\/)\.robolance\/runs\/(\d+)(?:-\d+)?\.json$/;
const SKIP = /(?:^|\/)(?:node_modules|\.robolance|\.git)\//;

/** MJCF files in the project: .xml files whose root is <mujoco>. */
export function sceneFiles(files: ReadonlyMap<string, string>): string[] {
    const out: string[] = [];
    for (const [key, text] of files) {
        const path = normalizePath(key);
        if (path.endsWith('.xml') && !SKIP.test(path) && /<mujoco[\s>]/.test(text.slice(0, 4000))) {
            out.push(path);
        }
    }
    // Top-level scenes (shortest paths) first: those are what the agent runs.
    return out.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/** A project the scene view applies to: an MJCF file, or recorded scene runs. */
export function isSceneProject(files: ReadonlyMap<string, string>): boolean {
    for (const [key, text] of files) {
        if (RUN_FILE.test(normalizePath(key)) && text.includes('"kind":"scene"')) {
            return true;
        }
    }
    return sceneFiles(files).length > 0;
}

/** Recorded scene runs, newest first. Other kinds of runs and broken files are skipped. */
export function readSceneRuns(files: ReadonlyMap<string, string>): SceneRunEntry[] {
    const runs: SceneRunEntry[] = [];
    for (const [key, text] of files) {
        const path = normalizePath(key);
        const m = RUN_FILE.exec(path);
        if (!m || !text.includes('"kind":"scene"')) {
            continue;
        }
        try {
            const raw = JSON.parse(text) as { kind?: string; at?: string; scene?: string; model?: string; controller?: string; run?: SceneRunData };
            const r = raw.run;
            if (raw.kind !== 'scene' || !r || !Array.isArray(r.frames) || typeof r.outcome !== 'string' || typeof raw.model !== 'string') {
                continue;
            }
            // The model path is relative to the record folder, which holds runs/.
            const recordDir = path.slice(0, path.lastIndexOf('runs/'));
            runs.push({
                path,
                stamp: Number(m[1]),
                at: raw.at,
                scene: raw.scene ?? '',
                modelPath: `${recordDir}${raw.model}`,
                controller: raw.controller ?? '',
                run: { ...r, metrics: r.metrics ?? {}, logs: r.logs ?? [] },
            });
        } catch {
            // A half-written file; the next refresh has it whole.
        }
    }
    return runs.sort((a, b) => b.path.localeCompare(a.path));
}

/** The viewer model a run replays with, or undefined when it is missing or unreadable. */
export function sceneModel(files: ReadonlyMap<string, string>, run: SceneRunEntry): ViewerModel | undefined {
    const text = files.get(run.modelPath) ?? files.get(`/${run.modelPath}`);
    if (!text) {
        return undefined;
    }
    try {
        const model = JSON.parse(text) as ViewerModel;
        return Array.isArray(model.bodies) && Array.isArray(model.geoms) && Array.isArray(model.meshes) ? model : undefined;
    } catch {
        return undefined;
    }
}

export function sceneRunMs(run: SceneRunData): number {
    return Math.round(run.simS * 1000);
}

/** The replay frame at `atMs`, linearly between the two recorded frames around it. */
export function sceneFrameAt(run: SceneRunData, atMs: number): number[] | undefined {
    if (run.frames.length === 0) {
        return undefined;
    }
    const at = Math.max(0, (atMs / 1000) * run.frameHz);
    const i = Math.min(run.frames.length - 1, Math.floor(at));
    const j = Math.min(run.frames.length - 1, i + 1);
    const t = Math.min(1, at - i);
    const a = run.frames[i];
    const b = run.frames[j];
    if (t === 0 || i === j) {
        return a;
    }
    return a.map((v, k) => v + (b[k] - v) * t);
}

/** A metric's value at `atMs`: the last sample at or before it. */
export function metricAt(series: Array<[number, number]>, atMs: number): number | undefined {
    const t = atMs / 1000;
    let lo = 0;
    let hi = series.length - 1;
    if (hi < 0 || series[0][0] > t) {
        return undefined;
    }
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (series[mid][0] <= t) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return series[lo][1];
}

const OUTCOME: Record<SceneRunData['outcome'], string> = {
    done: 'ran to the end',
    stopped: 'stopped by the controller',
    unstable: 'blew up',
    error: 'error',
    timeout: 'timed out',
};

export function sceneOutcomeLabel(run: SceneRunData): string {
    return OUTCOME[run.outcome] ?? run.outcome;
}

/** One line that says how a run went. */
export function describeSceneRun(entry: SceneRunEntry): string {
    const r = entry.run;
    const scene = entry.scene ? `${entry.scene} · ` : '';
    return `${scene}${r.simS.toFixed(1)} s · ${sceneOutcomeLabel(r)}${r.message && r.outcome !== 'done' ? `: ${r.message}` : ''}`;
}
