// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Sharing a Microduck run the way Arduino runs are shared: the run rides
 * in the replay link's fragment, deflated, and nothing is uploaded. The
 * replay frames are what makes a duck run big (about 100 KB), so a link
 * keeps one frame in two (12.5 a second; the viewer interpolates) and
 * stores each value as a whole number of thousandths, as the change from
 * the frame before. A 20 s run fits in a link of about 12 KB.
 */

import type { MissionResult } from 'robolance-duck-sim/viewer';
import type { DuckRun } from './duck-project';
import { REPLAY_PAGE_URL, SHARE_PARAM, encodeShare, thinPath } from './share-run';

/** Frames a link keeps at most; one in two of a 40 s run is 500. */
export const SHARE_MAX_FRAMES = 600;
/** 1 mm, 1 mrad, 0.001 of a quaternion component. */
const SCALE = 1000;

export interface PackedFrames {
    hz: number;
    /** Values per frame. */
    size: number;
    scale: number;
    /** Frame after frame, each value as round(v × scale) minus the same value in the frame before. */
    q: number[];
}

/** What a duck link carries. */
export interface SharedDuckRun {
    v: 1;
    kind: 'duck';
    at?: string;
    mission: string;
    result: Omit<MissionResult, 'replay'>;
    frames?: PackedFrames;
}

export function packFrames(replay: NonNullable<MissionResult['replay']>, maxFrames = SHARE_MAX_FRAMES): PackedFrames {
    const every = Math.max(2, Math.ceil(replay.frames.length / maxFrames));
    const kept = replay.frames.filter((_, i) => i % every === 0);
    const q: number[] = [];
    const prev = new Array<number>(replay.qposSize).fill(0);
    for (const frame of kept) {
        for (let k = 0; k < replay.qposSize; k++) {
            const v = Math.round(frame[k] * SCALE);
            q.push(v - prev[k]);
            prev[k] = v;
        }
    }
    return { hz: replay.frameHz / every, size: replay.qposSize, scale: SCALE, q };
}

export function unpackFrames(packed: PackedFrames): NonNullable<MissionResult['replay']> {
    const frames: number[][] = [];
    const current = new Array<number>(packed.size).fill(0);
    for (let at = 0; at + packed.size <= packed.q.length; at += packed.size) {
        for (let k = 0; k < packed.size; k++) {
            current[k] += packed.q[at + k];
        }
        frames.push(current.map(v => v / packed.scale));
    }
    return { frameHz: packed.hz, qposSize: packed.size, frames };
}

export function trimDuckRunForShare(run: DuckRun): SharedDuckRun {
    const { replay, ...result } = run.result;
    return {
        v: 1,
        kind: 'duck',
        at: run.at,
        mission: run.mission.slice(0, 16 * 1024),
        result: { ...result, logs: result.logs.slice(-60), path: thinPath(result.path, 200) },
        ...(replay && replay.frames.length > 0 ? { frames: packFrames(replay) } : {}),
    };
}

export async function shareDuckRunUrl(run: DuckRun, base: string = REPLAY_PAGE_URL): Promise<string> {
    return `${base}#${SHARE_PARAM}=${await encodeShare(trimDuckRunForShare(run))}`;
}

export function isSharedDuckRun(value: unknown): value is SharedDuckRun {
    return Boolean(value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'duck');
}

/** Says why a decoded duck payload cannot be replayed, or returns undefined. */
export function validateSharedDuckRun(value: unknown): string | undefined {
    const s = value as SharedDuckRun;
    if (!isSharedDuckRun(value)) {
        return 'not a duck run';
    }
    if (s.v !== 1) {
        return `unknown share version ${String(s.v)}`;
    }
    const r = s.result;
    if (!r || typeof r !== 'object' || typeof r.outcome !== 'string' || !Array.isArray(r.notes) || !r.field || !Array.isArray(r.path)) {
        return 'the run has no result';
    }
    const f = s.frames;
    if (f && (!Array.isArray(f.q) || !(f.size > 0) || !(f.hz > 0) || !(f.scale > 0) || f.q.length % f.size !== 0)) {
        return 'the replay frames are damaged';
    }
    return undefined;
}

/** A shared duck run as the panel's DuckRun, so the same views replay it. */
export function sharedDuckRunToRun(shared: SharedDuckRun): DuckRun {
    const stamp = shared.at ? Date.parse(shared.at) : NaN;
    const result: MissionResult = { ...shared.result, ...(shared.frames ? { replay: unpackFrames(shared.frames) } : {}) };
    return {
        path: `.robolance/runs/${Number.isFinite(stamp) ? stamp : 0}.json`,
        stamp: Number.isFinite(stamp) ? stamp : 0,
        at: shared.at,
        mission: shared.mission ?? '',
        result,
    };
}
