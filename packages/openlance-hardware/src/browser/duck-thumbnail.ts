// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * A run's gallery thumbnail: the duck in 3D, close up, at the moment that
 * tells the run (just before its first kick, or as the lid comes down),
 * drawn off screen at 16:9.
 */

import type { MissionResult } from 'robolance-duck-sim/viewer';
import { duckModel } from 'robolance-duck-sim/viewer/duck-model';
import { frameAt, pathUntil } from './duck-project';
import { DuckStage } from './duck-stage';

export const THUMB_WIDTH = 640;
export const THUMB_HEIGHT = 360;

/** When to take the picture, in ms: the moment that tells the run. */
export function thumbnailMomentMs(result: MissionResult): number {
    const endS = result.simS;
    let atS: number;
    if (result.field.laptop) {
        atS = typeof result.closedAtS === 'number' ? result.closedAtS - 0.4 : endS * 0.6;
    } else if (result.kicks.length > 0) {
        atS = result.kicks[0].atS - 0.15;
    } else if (result.scoredAtS !== null) {
        atS = result.scoredAtS - 1;
    } else {
        atS = endS * 0.6;
    }
    return Math.round(Math.max(0, Math.min(endS, atS)) * 1000);
}

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/** The thumbnail as a JPEG data URL. Needs a browser with WebGL. */
export async function duckThumbnail(result: MissionResult, theme: 'light' | 'dark' = 'light'): Promise<string> {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${THUMB_WIDTH}px;height:${THUMB_HEIGHT}px;pointer-events:none;`;
    document.body.appendChild(host);
    let stage: DuckStage | undefined;
    try {
        stage = new DuckStage(host, duckModel);
        stage.setTheme(theme);
        stage.setField(result.field);
        const at = thumbnailMomentMs(result);
        stage.show(frameAt(result, at), pathUntil(result, at));
        await nextFrame();
        return stage.portrait(THUMB_WIDTH, THUMB_HEIGHT);
    } finally {
        stage?.dispose();
        host.remove();
    }
}
