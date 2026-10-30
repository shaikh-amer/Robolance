// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The public runs gallery (robolance.openlance.ai/runs/). A run is shown
 * there only when its owner publishes it from the Runs view. The gallery
 * lists small summaries (what a card draws), never the runs themselves;
 * a card opens the replay page. Which runs a project published is kept in
 * the project (`.robolance/published.json`), so the Runs view knows on
 * any device.
 */

import type { FieldSpec, MissionResult } from 'robolance-duck-sim/viewer';
import type { DuckRun } from './duck-project';
import { outcomeLabel } from './duck-project';
import { thinPath } from './share-run';

export const GALLERY_PAGE_URL = 'https://robolance.openlance.ai/runs/';
export const PUBLISHED_FILE = '.robolance/published.json';
/** Points a card's path keeps (enough to draw the walk, small enough to list dozens). */
export const SUMMARY_PATH_POINTS = 48;

export type DuckMission = 'goal' | 'obstacles' | 'laptop';

/** What a gallery card shows for a Microduck run. */
export interface DuckGallerySummary {
    kind: 'duck';
    mission: DuckMission;
    outcome: MissionResult['outcome'];
    outcomeLabel: string;
    score: number;
    /** When the goal went in or the lid closed, else how long the run lasted. */
    seconds: number;
    kicks: number;
    /** The duck's walk, centimetre-rounded [x, y] metres. */
    path: Array<[number, number]>;
    field: {
        bounds: FieldSpec['bounds'];
        goal: FieldSpec['goal'];
        ball: FieldSpec['ball'];
        duck: { x: number; y: number };
        laptop?: { x: number; y: number; heading: number };
        obstacles?: Array<{ x: number; y: number; width: number; depth: number; heading?: number }>;
    };
}

export function duckMission(field: FieldSpec): DuckMission {
    if (field.laptop) {
        return 'laptop';
    }
    return (field.obstacles?.length ?? 0) > 0 ? 'obstacles' : 'goal';
}

const cm = (v: number): number => Math.round(v * 100) / 100;

/** A card's worth of a run: no mission code, no logs, no replay frames. */
export function duckGallerySummary(run: DuckRun): DuckGallerySummary {
    const r = run.result;
    const f = r.field;
    const mission = duckMission(f);
    const done = mission === 'laptop' ? r.closedAtS : r.scoredAtS;
    return {
        kind: 'duck',
        mission,
        outcome: r.outcome,
        outcomeLabel: outcomeLabel(r),
        score: r.score,
        seconds: Math.round((typeof done === 'number' ? done : r.simS) * 10) / 10,
        kicks: r.kicks.length,
        path: thinPath(r.path, SUMMARY_PATH_POINTS).map(([x, y]) => [cm(x), cm(y)] as [number, number]),
        field: {
            bounds: f.bounds,
            goal: f.goal,
            ball: f.ball,
            duck: { x: f.duck.x, y: f.duck.y },
            ...(f.laptop ? { laptop: { x: f.laptop.x, y: f.laptop.y, heading: f.laptop.heading } } : {}),
            ...(f.obstacles?.length
                ? { obstacles: f.obstacles.slice(0, 12).map(o => ({ x: o.x, y: o.y, width: o.width, depth: o.depth, heading: o.heading })) }
                : {}),
        },
    };
}

/** A title to start from: what happened, in a few words. */
export function suggestedTitle(run: DuckRun): string {
    const s = duckGallerySummary(run);
    if (s.mission === 'laptop') {
        return s.outcome === 'closed' ? `Microduck closes the laptop in ${s.seconds} s` : 'Microduck tries to close the laptop';
    }
    const around = s.mission === 'obstacles' ? ' around the boxes' : '';
    return s.outcome === 'goal' ? `Microduck scores${around} in ${s.seconds} s` : `Microduck goes for goal${around}`;
}

export interface PublishedEntry {
    /** The share id the gallery lists. */
    id: string;
    title: string;
    at: string;
}

/** The runs this project published, by run path. */
export function readPublished(files: ReadonlyMap<string, string>): Record<string, PublishedEntry> {
    const text = files.get(PUBLISHED_FILE);
    if (!text) {
        return {};
    }
    try {
        const parsed = JSON.parse(text) as { runs?: Record<string, PublishedEntry> };
        const out: Record<string, PublishedEntry> = {};
        for (const [path, entry] of Object.entries(parsed.runs ?? {})) {
            if (entry && typeof entry.id === 'string' && /^[0-9A-Za-z]{6,32}$/.test(entry.id) && typeof entry.title === 'string') {
                out[path] = { id: entry.id, title: entry.title, at: typeof entry.at === 'string' ? entry.at : '' };
            }
        }
        return out;
    } catch {
        return {};
    }
}

/** The file's text with `path` published as `entry`, or taken off when `entry` is undefined. */
export function writePublished(files: ReadonlyMap<string, string>, path: string, entry: PublishedEntry | undefined): string {
    const runs = { ...readPublished(files) };
    if (entry) {
        runs[path] = entry;
    } else {
        delete runs[path];
    }
    return `${JSON.stringify({ runs }, null, 2)}\n`;
}
