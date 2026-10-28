// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/** Any MJCF robot in 3D as a React component: mounts a SceneStage and feeds it the frame for the replay time. */

import * as React from 'react';
import type { ViewerModel } from 'robolance-duck-sim/viewer';
import { SceneStage } from './scene-stage';

export interface SceneViewProps {
    model: ViewerModel;
    frame: number[] | undefined;
    theme: 'light' | 'dark';
    follow?: boolean;
    /** Bumped to put the camera back where it started. */
    resetKey?: number;
}

export function SceneView({ model, frame, theme, follow = false, resetKey = 0 }: SceneViewProps): React.ReactElement {
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
    React.useEffect(() => stage.current?.setFollow(follow), [follow, model, failed]);
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
