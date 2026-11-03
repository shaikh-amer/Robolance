// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The 3D pitch as a React component: mounts a DuckStage and feeds it the
 * run's pitch and the frame for the current replay time.
 */

import * as React from 'react';
import type { PartHit } from './robot-parts';
import type { MissionResult } from 'robolance-duck-sim/viewer';
import { duckModel } from 'robolance-duck-sim/viewer/duck-model';
import { beakOpening } from './duck-beak';
import { frameAt, pathUntil } from './duck-project';
import { DuckStage } from './duck-stage';
import type { CameraMode } from './stage-base';

export interface DuckSceneProps {
    result: MissionResult;
    timeMs: number;
    theme: 'light' | 'dark';
    /** Keep the camera on the duck (orbit mode only). */
    follow?: boolean;
    /** How the camera films the duck (DuckPanel's camera button). */
    camera?: CameraMode;
    /** Bumped to put the camera back where it started. */
    resetKey?: number;
    /** The viewer's shell colour ("#rrggbb"), over the field's. */
    color?: string;
    /** 0 assembled, 1 exploded. */
    explode?: number;
    /** The body lit up (from the parts list), or undefined. */
    highlightBody?: number;
    /** What a tap on the duck picked, or undefined for a tap on nothing. */
    onPick?(hit: PartHit | undefined): void;
}

export function DuckScene({ result, timeMs, theme, follow = false, camera = 'orbit', resetKey = 0, color, explode = 0, highlightBody, onPick }: DuckSceneProps): React.ReactElement {
    const host = React.useRef<HTMLDivElement>(null);
    const stage = React.useRef<DuckStage>();
    const [failed, setFailed] = React.useState<string>();

    React.useEffect(() => {
        if (!host.current) {
            return;
        }
        try {
            // Built in an effect, so server-side rendering never touches WebGL.
            stage.current = new DuckStage(host.current, duckModel);
        } catch (err) {
            setFailed(err instanceof Error ? err.message : String(err));
        }
        return () => {
            stage.current?.dispose();
            stage.current = undefined;
        };
    }, []);

    React.useEffect(() => stage.current?.setTheme(theme), [theme, failed]);
    React.useEffect(() => stage.current?.setField(result.field), [result.field, failed]);
    React.useEffect(() => stage.current?.setFollow(follow), [follow, failed]);
    React.useEffect(() => stage.current?.setCameraMode(camera), [camera, failed]);
    React.useEffect(() => stage.current?.setColor(color), [color, result.field, failed]);
    React.useEffect(() => stage.current?.setExplode(explode), [explode, result.field, failed]);
    React.useEffect(() => stage.current?.highlightBody(highlightBody), [highlightBody, result.field, failed]);
    React.useEffect(() => stage.current?.setPickListener(onPick), [onPick, result.field, failed]);
    React.useEffect(() => {
        if (resetKey) {
            stage.current?.resetView();
        }
    }, [resetKey]);
    React.useEffect(() => {
        stage.current?.setBeak(beakOpening(result, timeMs / 1000));
        stage.current?.show(frameAt(result, timeMs), pathUntil(result, timeMs));
    }, [result, timeMs, failed]);

    if (failed) {
        return (
            <div className="robolance-empty">
                <p>The 3D view needs WebGL, which this browser could not start.</p>
                <code>{failed}</code>
            </div>
        );
    }
    return <div ref={host} className="robolance-duck-scene" aria-label="Microduck on the pitch" role="img" />;
}
