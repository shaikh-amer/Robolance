// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Sharing a run of any MuJoCo robot (a Unitree G1, an arm, a rover…): the
 * run, thinned to what a replay needs, travels with its 3D model, so the
 * replay page and the runs gallery show the same robot the Hardware tab did,
 * for anyone, with no account and no project. A humanoid's meshes are
 * large: when the link would pass the share limit the model's meshes are
 * simplified (a shape-preserving pass, see scene-shrink.ts) until it fits.
 */

import type { ViewerModel } from 'robolance-duck-sim/viewer';
import type { SceneRunData, SceneRunEntry } from './scene-project';
import { encodeShare, REPLAY_PAGE_URL, shareLink, thinPath } from './share-run';
import type { StoreShare } from './preview-tab';

/** Frames kept on a shared run: 20 s at 25 Hz. */
export const SCENE_SHARE_MAX_FRAMES = 500;
/** Points kept per metric. */
export const SCENE_SHARE_MAX_METRIC_POINTS = 200;
/** The largest link payload (encoded characters) a server stores: 1 MiB, less headroom. */
export const SCENE_SHARE_BUDGET = 1000 * 1000;
/** Mesh error budgets tried in turn when a model is too large, metres. */
export const SCENE_SHRINK_STEPS = [0.001, 0.002, 0.004, 0.008];

export interface SharedSceneRun {
    v: 1;
    kind: 'scene';
    at?: string;
    /** The scene's main MJCF path in the project it came from, e.g. "unitree_g1/scene.xml". */
    scene: string;
    controller?: string;
    model: ViewerModel;
    run: SceneRunData;
}

/** Shrinks a model's meshes to a surface error of `maxErrorM` metres. */
export type ModelShrinker = (model: ViewerModel, maxErrorM: number) => Promise<ViewerModel>;

function round(values: number[], digits = 4): number[] {
    const k = 10 ** digits;
    return values.map(v => Math.round(v * k) / k);
}

export function trimSceneRunForShare(entry: SceneRunEntry, model: ViewerModel): SharedSceneRun {
    const r = entry.run;
    const frames = thinPath(r.frames, SCENE_SHARE_MAX_FRAMES).map(f => round(f));
    // Fewer frames over the same time: the replay reads the rate from frames / time.
    const frameHz = frames.length > 1 && r.simS > 0 ? (frames.length - 1) / r.simS : r.frameHz;
    const metrics: SceneRunData['metrics'] = {};
    for (const [name, series] of Object.entries(r.metrics).slice(0, 12)) {
        metrics[name] = thinPath(series, SCENE_SHARE_MAX_METRIC_POINTS).map(([t, v]) => [Math.round(t * 1000) / 1000, Math.round(v * 10000) / 10000]);
    }
    return {
        v: 1,
        kind: 'scene',
        at: entry.at,
        scene: entry.scene,
        controller: entry.controller ? entry.controller.slice(0, 16 * 1024) : undefined,
        model,
        run: {
            outcome: r.outcome,
            message: r.message?.slice(0, 2000),
            simS: r.simS,
            frameHz,
            nq: r.nq,
            frames,
            metrics,
            logs: r.logs.slice(-60),
            check: { ok: r.check.ok, actuators: r.check.actuators.slice(0, 200), sensors: r.check.sensors.slice(0, 200), issues: r.check.issues.slice(0, 20) },
        },
    };
}

/**
 * The encoded share of a scene run, its model shrunk step by step until it
 * fits the budget. Throws when even the coarsest model does not fit.
 */
export async function encodeSceneShare(entry: SceneRunEntry, model: ViewerModel, shrink?: ModelShrinker, budget = SCENE_SHARE_BUDGET): Promise<string> {
    let encoded = await encodeShare(trimSceneRunForShare(entry, model));
    if (encoded.length <= budget) {
        return encoded;
    }
    if (shrink) {
        for (const maxErrorM of SCENE_SHRINK_STEPS) {
            encoded = await encodeShare(trimSceneRunForShare(entry, await shrink(model, maxErrorM)));
            if (encoded.length <= budget) {
                return encoded;
            }
        }
    }
    throw new Error(`This robot is too detailed to share (${Math.round(encoded.length / 1024)} KB, the limit is ${Math.round(budget / 1024)} KB).`);
}

export async function shareSceneRunUrl(
    entry: SceneRunEntry, model: ViewerModel, base: string = REPLAY_PAGE_URL, store?: StoreShare, shrink?: ModelShrinker,
): Promise<string> {
    return shareLink(await encodeSceneShare(entry, model, shrink), 'scene', base, store);
}

export function isSharedSceneRun(value: unknown): value is SharedSceneRun {
    return Boolean(value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'scene');
}

/** Says why a decoded scene payload cannot be replayed, or returns undefined. */
export function validateSharedSceneRun(value: unknown): string | undefined {
    if (!isSharedSceneRun(value)) {
        return 'not a robot run';
    }
    const s = value;
    if (s.v !== 1) {
        return `unknown share version ${String(s.v)}`;
    }
    const m = s.model;
    if (!m || m.version !== 1 || !Array.isArray(m.bodies) || !Array.isArray(m.geoms) || !Array.isArray(m.meshes) || !Number.isInteger(m.nq)) {
        return 'the robot model is damaged';
    }
    const r = s.run;
    if (!r || !Array.isArray(r.frames) || !(r.simS >= 0) || !(r.frameHz > 0) || typeof r.outcome !== 'string') {
        return 'the run is damaged';
    }
    if (r.frames.some(f => !Array.isArray(f) || f.length !== m.nq || f.some(v => typeof v !== 'number' || !Number.isFinite(v)))) {
        return 'the run\'s frames do not fit the robot';
    }
    if (!r.metrics || typeof r.metrics !== 'object' || !Array.isArray(r.logs) || !r.check || !Array.isArray(r.check.issues)) {
        return 'the run is damaged';
    }
    return undefined;
}

/** A shared scene run as the panel's entry and model, so the same views replay it. */
export function sharedSceneToEntry(shared: SharedSceneRun): { entry: SceneRunEntry; model: ViewerModel } {
    const stamp = shared.at ? Date.parse(shared.at) : NaN;
    return {
        entry: {
            path: `.robolance/runs/${Number.isFinite(stamp) ? stamp : 0}.json`,
            stamp: Number.isFinite(stamp) ? stamp : 0,
            at: shared.at,
            scene: shared.scene,
            modelPath: '(shared)',
            controller: shared.controller ?? '',
            run: shared.run,
        },
        model: shared.model,
    };
}

/** The robot's name from its scene path: "unitree_g1/scene.xml" → "unitree g1". */
export function sceneRobotName(scene: string): string {
    const parts = scene.split('/').filter(Boolean);
    const dir = parts.length > 1 ? parts[parts.length - 2] : (parts[0] ?? 'robot').replace(/\.xml$/i, '');
    return dir.replace(/[_-]+/g, ' ').trim() || 'robot';
}

/** What a gallery card shows for a robot run (kind "scene"). */
export interface SceneGallerySummary {
    kind: 'scene';
    robot: string;
    outcome: SceneRunData['outcome'];
    seconds: number;
    /** 100 when the run went to its end without blowing up, else 0: there is no mission to score. */
    score: number;
}

export function sceneGallerySummary(entry: SceneRunEntry): SceneGallerySummary {
    const ok = entry.run.outcome === 'done' || entry.run.outcome === 'stopped';
    return { kind: 'scene', robot: sceneRobotName(entry.scene), outcome: entry.run.outcome, seconds: Math.round(entry.run.simS * 10) / 10, score: ok ? 100 : 0 };
}

export function suggestedSceneTitle(entry: SceneRunEntry): string {
    const name = sceneRobotName(entry.scene).replace(/\b\w/g, c => c.toUpperCase());
    return `${name} in the simulator (${Math.round(entry.run.simS)} s)`;
}
