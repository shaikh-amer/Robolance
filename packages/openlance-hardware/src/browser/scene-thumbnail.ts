// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * A robot run's gallery thumbnail: the robot in 3D at the middle of its
 * run, drawn off screen at 16:9, like duck-thumbnail.ts for the Microduck.
 */

import type { ViewerModel } from 'robolance-duck-sim/viewer';
import type { SceneRunData } from './scene-project';
import { sceneFrameAt, sceneRunMs } from './scene-project';
import { SceneStage } from './scene-stage';
import { THUMB_HEIGHT, THUMB_WIDTH } from './duck-thumbnail';

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/** The thumbnail as a JPEG data URL. Needs a browser with WebGL. */
export async function sceneThumbnail(model: ViewerModel, run: SceneRunData, theme: 'light' | 'dark' = 'dark'): Promise<string> {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${THUMB_WIDTH}px;height:${THUMB_HEIGHT}px;pointer-events:none;`;
    document.body.appendChild(host);
    let stage: SceneStage | undefined;
    try {
        stage = new SceneStage(host, model);
        stage.setTheme(theme);
        stage.show(sceneFrameAt(run, Math.round(sceneRunMs(run) * 0.5)));
        await nextFrame();
        return stage.portrait(THUMB_WIDTH, THUMB_HEIGHT);
    } finally {
        stage?.renderer.forceContextLoss();
        stage?.dispose();
        host.remove();
    }
}
