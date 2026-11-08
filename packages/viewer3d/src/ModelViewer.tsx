// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * A 3D model on a studio stage with a small toolbar: wireframe, reset view,
 * animation playback, and the model's cost in triangles, materials and
 * textures. Give it the file's bytes and name.
 */

import * as React from 'react';
import { modelFormat, parseModel } from './model-load';
import { ModelStage, type StageColors } from './model-stage';
import { modelStats, statsLine, type ModelStats } from './model-stats';

export interface ModelViewerProps {
    data: ArrayBuffer | Uint8Array | undefined;
    fileName: string;
    /** Where a .gltf's external files resolve from (URL ending in "/"). */
    resourcePath?: string;
    colors?: StageColors;
    onStats?: (stats: ModelStats) => void;
    onError?: (message: string) => void;
}

type Status = { kind: 'loading' } | { kind: 'ready'; stats: ModelStats } | { kind: 'error'; message: string };

export function ModelViewer(props: ModelViewerProps): React.ReactElement {
    const host = React.useRef<HTMLDivElement>(null);
    const stage = React.useRef<ModelStage>();
    const [status, setStatus] = React.useState<Status>({ kind: 'loading' });
    const [wireframe, setWireframe] = React.useState(false);
    const [animations, setAnimations] = React.useState<string[]>([]);
    const [playing, setPlaying] = React.useState<number | undefined>();

    React.useEffect(() => {
        if (!host.current) {
            return undefined;
        }
        try {
            stage.current = new ModelStage(host.current, props.colors);
        } catch (err) {
            setStatus({ kind: 'error', message: `3D is not available in this browser (${(err as Error).message})` });
        }
        return () => {
            stage.current?.dispose();
            stage.current = undefined;
        };
    }, []);

    React.useEffect(() => {
        let cancelled = false;
        if (!stage.current) {
            // No stage (no WebGL): keep the error the first effect showed.
            return undefined;
        }
        const format = modelFormat(props.fileName);
        if (!props.data) {
            setStatus({ kind: 'loading' });
            return undefined;
        }
        if (!format) {
            setStatus({ kind: 'error', message: `${props.fileName} is not a model this viewer opens (.glb, .gltf, .obj, .stl, .fbx)` });
            return undefined;
        }
        setStatus({ kind: 'loading' });
        parseModel(props.data, format, props.resourcePath).then(
            (model) => {
                if (cancelled || !stage.current) {
                    return;
                }
                stage.current.setModel(model.root, model.animations);
                const stats = modelStats(model.root, model.animations.length);
                setAnimations(stage.current.animationNames);
                setPlaying(undefined);
                setStatus({ kind: 'ready', stats });
                props.onStats?.(stats);
            },
            (err: unknown) => {
                if (cancelled) {
                    return;
                }
                const message = `Could not open ${props.fileName}: ${err instanceof Error ? err.message : String(err)}`;
                setStatus({ kind: 'error', message });
                props.onError?.(message);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [props.data, props.fileName, props.resourcePath]);

    const toggleWireframe = () => {
        const next = !wireframe;
        setWireframe(next);
        stage.current?.setWireframe(next);
    };
    const choose = (index: number | undefined) => {
        setPlaying(index);
        stage.current?.playAnimation(index);
    };

    return (
        <div className='rl-model-viewer' style={{ position: 'relative', width: '100%', height: '100%', minHeight: 160 }}>
            <div ref={host} className='rl-model-viewer-stage' style={{ position: 'absolute', inset: 0 }} />
            <div className='rl-model-viewer-bar' role='toolbar' aria-label='3D view' style={barStyle}>
                <button type='button' aria-pressed={wireframe} title='Show the mesh wires' onClick={toggleWireframe} style={buttonStyle}>
                    Wireframe
                </button>
                <button type='button' title='Back to the starting view (or double-click the model)' onClick={() => stage.current?.resetView()} style={buttonStyle}>
                    Reset view
                </button>
                {animations.length > 0 && (
                    <select
                        aria-label='Animation'
                        value={playing === undefined ? '' : String(playing)}
                        onChange={(e) => choose(e.target.value === '' ? undefined : Number(e.target.value))}
                        style={buttonStyle}
                    >
                        <option value=''>No animation</option>
                        {animations.map((name, i) => (
                            <option key={i} value={i}>
                                {name}
                            </option>
                        ))}
                    </select>
                )}
            </div>
            <div className='rl-model-viewer-status' aria-live='polite' style={statusStyle}>
                {status.kind === 'loading' && 'Opening the model…'}
                {status.kind === 'ready' && statsLine(status.stats)}
                {status.kind === 'error' && <span role='alert'>{status.message}</span>}
            </div>
        </div>
    );
}

const barStyle: React.CSSProperties = { position: 'absolute', top: 8, left: 8, display: 'flex', gap: 6, flexWrap: 'wrap' };
const buttonStyle: React.CSSProperties = {
    font: 'inherit',
    fontSize: 12,
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(0,0,0,0.45)',
    color: '#eee',
    cursor: 'pointer',
};
const statusStyle: React.CSSProperties = {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    fontSize: 12,
    color: '#ddd',
    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
    pointerEvents: 'none',
};
