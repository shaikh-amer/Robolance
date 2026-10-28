// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * What the Hardware tab shows, read from the project's files: the diagram,
 * the firmware the tools last built, and the runs they recorded. Pure
 * functions over the file map, so the panel re-derives its model on every
 * file change and nothing else has to be kept in sync.
 */

import { validateDiagram, type Diagram, type RunTrace, type ScriptedEvent } from 'robolance-hardware-sim';

export interface BuildInfo {
    at?: string;
    sketchSha?: string;
    backend?: string;
    size?: { flashBytes: number; ramBytes: number } | null;
}

/** One recorded run (the shape hardware_run writes). */
export interface RunEntry {
    path: string;
    /** From the file name: milliseconds since the epoch. */
    stamp: number;
    at?: string;
    sketchSha?: string;
    diagram?: Diagram;
    durationMs: number;
    events: ScriptedEvent[];
    trace: RunTrace;
}

export interface HardwareProject {
    sketchPath?: string;
    diagramPath?: string;
    diagram?: Diagram;
    /** Why the diagram cannot be shown, when it cannot. */
    diagramError?: string;
    hex?: string;
    build?: BuildInfo;
    /** Newest first. */
    runs: RunEntry[];
}

const RUN_FILE = /(?:^|\/)\.robolance\/runs\/(\d+)(?:-\d+)?\.json$/;

export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.?\/+/, '');
}

/** Whether a project looks like a hardware project: a diagram or a sketch. */
export function isHardwareProject(files: ReadonlyMap<string, string>): boolean {
    for (const key of files.keys()) {
        const path = normalizePath(key);
        if (path === 'diagram.json' || path.endsWith('/diagram.json') || path.endsWith('.ino')) {
            return true;
        }
    }
    return false;
}

export function readHardwareProject(files: ReadonlyMap<string, string>): HardwareProject {
    const project: HardwareProject = { runs: [] };
    const byPath = new Map<string, string>();
    for (const [key, text] of files) {
        byPath.set(normalizePath(key), text);
    }
    project.diagramPath = pick(byPath, p => p === 'diagram.json' || p.endsWith('/diagram.json'));
    project.sketchPath = pick(byPath, p => p === 'sketch.ino' || p.endsWith('.ino'));
    if (project.diagramPath) {
        const text = byPath.get(project.diagramPath) ?? '';
        try {
            const parsed = JSON.parse(text) as unknown;
            const problem = validateDiagram(parsed);
            if (problem) {
                project.diagramError = problem;
            } else {
                project.diagram = parsed as Diagram;
            }
        } catch (err) {
            project.diagramError = `diagram.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
        }
    }
    const hexPath = pick(byPath, p => p === '.robolance/firmware.hex' || p.endsWith('/.robolance/firmware.hex'));
    if (hexPath) {
        project.hex = byPath.get(hexPath);
    }
    const buildPath = pick(byPath, p => p === '.robolance/build.json' || p.endsWith('/.robolance/build.json'));
    if (buildPath) {
        try {
            project.build = JSON.parse(byPath.get(buildPath) ?? '') as BuildInfo;
        } catch {
            // A half-written build.json is simply not shown.
        }
    }
    for (const [path, text] of byPath) {
        const m = RUN_FILE.exec(path);
        if (!m) {
            continue;
        }
        const run = parseRun(path, Number(m[1]), text);
        if (run) {
            project.runs.push(run);
        }
    }
    project.runs.sort((a, b) => b.path.localeCompare(a.path));
    return project;
}

function pick(byPath: Map<string, string>, test: (path: string) => boolean): string | undefined {
    let best: string | undefined;
    for (const path of byPath.keys()) {
        if (test(path) && (best === undefined || path.length < best.length)) {
            best = path;
        }
    }
    return best;
}

function parseRun(path: string, stamp: number, text: string): RunEntry | undefined {
    try {
        const raw = JSON.parse(text) as Partial<RunEntry> & { trace?: RunTrace };
        const trace = raw.trace;
        if (!trace || typeof trace !== 'object' || !Array.isArray(trace.samples) || !Array.isArray(trace.serial)) {
            return undefined;
        }
        return {
            path,
            stamp,
            at: raw.at,
            sketchSha: raw.sketchSha,
            diagram: raw.diagram,
            durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : trace.durationMs,
            events: Array.isArray(raw.events) ? raw.events : [],
            trace,
        };
    } catch {
        return undefined;
    }
}

/** The part states recorded at or before `atMs` (the last sample, else the first). */
export function statesAt(trace: RunTrace, atMs: number): Record<string, Record<string, unknown>> {
    let chosen = trace.samples[0]?.parts ?? {};
    for (const sample of trace.samples) {
        if (sample.atMs > atMs) {
            break;
        }
        chosen = sample.parts;
    }
    if (atMs >= trace.ranMs) {
        return trace.final;
    }
    return chosen;
}

/** Index into the run's path of the pose at or before `atMs`. */
export function poseIndexAt(path: { atMs?: number }[], atMs: number, durationMs: number): number {
    if (path.length === 0) {
        return -1;
    }
    if (path[0].atMs === undefined) {
        // Older records without timestamps: poses are 100 ms apart.
        return Math.max(0, Math.min(path.length - 1, Math.floor(atMs / Math.max(1, Math.min(100, durationMs / path.length)))));
    }
    let index = 0;
    for (let i = 0; i < path.length; i++) {
        if ((path[i].atMs ?? 0) > atMs) {
            break;
        }
        index = i;
    }
    return index;
}

export function formatRunTime(run: { at?: string; stamp: number }): string {
    const date = run.at ? new Date(run.at) : new Date(run.stamp);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** One line that says how a run went. */
export function describeRun(run: RunEntry): string {
    const arena = run.trace.arena;
    const seconds = `${(run.trace.ranMs / 1000).toFixed(1)} s`;
    if (!arena) {
        const notes = run.trace.notes.length;
        return `${seconds} · ${run.trace.serial.length} serial lines${notes ? ` · ${notes} note${notes === 1 ? '' : 's'}` : ''}`;
    }
    const goal = arena.reachedGoalAtMs !== null ? `goal at ${(arena.reachedGoalAtMs / 1000).toFixed(1)} s` : `${arena.bestDistanceToGoalCm} cm from goal`;
    const line = arena.line ? ` · line ${Math.round(arena.line.coverage * 100)}%` : '';
    return `${seconds} · score ${arena.score} · ${goal}${line} · ${arena.collisions} collision${arena.collisions === 1 ? '' : 's'}`;
}
