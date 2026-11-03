// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/** Any MJCF robot in 3D as a React component: mounts a SceneStage and feeds it the frame for the replay time. */

import * as React from 'react';
import type { PartHit } from './robot-parts';
import type { ViewerModel } from 'robolance-duck-sim/viewer';
import { SceneStage } from './scene-stage';
import type { CameraMode } from './stage-base';

export interface SceneViewProps {
    model: ViewerModel;
    frame: number[] | undefined;
    theme: 'light' | 'dark';
    /** Broadcast (orbit), third person, first person or wide angle. */
    camera?: CameraMode;
    /** Bumped to put the camera back where it started. */
    resetKey?: number;
    /** The viewer's shell colour ("#rrggbb"), over the model's. */
    color?: string;
    /** 0 assembled, 1 exploded. */
    explode?: number;
    /** The body lit up (from the parts list), or undefined. */
    highlightBody?: number;
    /** What a tap on the robot picked, or undefined for a tap on nothing. */
    onPick?(hit: PartHit | undefined): void;
}

export function SceneView({ model, frame, theme, camera = 'orbit', resetKey = 0, color, explode = 0, highlightBody, onPick }: SceneViewProps): React.ReactElement {
    const host = React.useRef<HTMLDivElement>(null);
    const stage = React.useRef<SceneStage>();
    const [failed, setFailed] = React.useState<string>();

    React.useEffect(() => {
        if (!host.current) {
            return;
        }
        try {
            // Built in an effect, so server-side rendering never touches WebGL.
            stage.current = new SceneStage(host.current, model);
            setFailed(undefined);
        } catch (err) {
            setFailed(err instanceof Error ? err.message : String(err));
        }
        return () => {
            stage.current?.dispose();
            stage.current = undefined;
        };
    }, [model]);

    React.useEffect(() => stage.current?.setTheme(theme), [theme, model, failed]);
    React.useEffect(() => stage.current?.setCameraMode(camera), [camera, model, failed]);
    React.useEffect(() => stage.current?.setColor(color), [color, model, failed]);
    React.useEffect(() => stage.current?.setExplode(explode), [explode, model, failed]);
    React.useEffect(() => stage.current?.highlightBody(highlightBody), [highlightBody, model, failed]);
    React.useEffect(() => stage.current?.setPickListener(onPick), [onPick, model, failed]);
    React.useEffect(() => {
        if (resetKey) {
            stage.current?.resetView();
        }
    }, [resetKey]);
    React.useEffect(() => stage.current?.show(frame), [frame, model, failed]);

    if (failed) {
        return (
            <div className="robolance-empty">
                <p>The 3D view needs WebGL, which this browser could not start.</p>
                <code>{failed}</code>
            </div>
        );
    }
    return <div ref={host} className="robolance-duck-scene" aria-label="The robot in its scene" role="img" />;
}
