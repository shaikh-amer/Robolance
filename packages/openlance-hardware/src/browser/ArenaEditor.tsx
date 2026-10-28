// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Draw the arena the robot has to solve: drag the start and the goal, draw
 * walls, start from a preset, resize. Saving writes `arena.spec` into
 * diagram.json, where the simulator picks it up on the agent's next run.
 */

import * as React from 'react';
import { DEFAULT_ROBOT, type ArenaSpec, type Diagram } from 'robolance-hardware-sim';
import { ArenaView } from './ArenaView';
import { ZoomPane } from './ZoomPane';
import {
    ARENA_PRESETS, addWall, applyArenaSpec, clientToArena, cloneSpec, diagramText, hitTest, isBorderWall,
    moveGoal, moveStart, removeWall, resizeArena, runOnArenaPrompt, setGoalRadius, setStartHeading, snap,
    validateArenaSpec, type ArenaSelection,
} from './arena-editor';

export interface ArenaEditorProps {
    diagram: Diagram;
    spec: ArenaSpec;
    diagramPath: string;
    writeFile: (path: string, content: string) => Promise<void> | void;
    askAgent?: (prompt: string) => void;
    onClose: () => void;
}

type Tool = 'select' | 'wall';

interface Drag {
    pointerId: number;
    kind: 'start' | 'goal' | 'wall';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export function ArenaEditor({ diagram, spec: initial, diagramPath, writeFile, askAgent, onClose }: ArenaEditorProps): React.ReactElement {
    const [spec, setSpec] = React.useState<ArenaSpec>(() => cloneSpec(initial));
    const [tool, setTool] = React.useState<Tool>('select');
    const [selected, setSelected] = React.useState<ArenaSelection | undefined>();
    const [drag, setDrag] = React.useState<Drag | undefined>();
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>();
    const svgRef = React.useRef<SVGSVGElement>(null);
    const robotRadius = diagram.arena?.robot?.radius ?? DEFAULT_ROBOT.radius;
    const problem = validateArenaSpec(spec, robotRadius);

    const toArena = (event: React.PointerEvent): { x: number; y: number } => {
        const rect = svgRef.current?.getBoundingClientRect();
        return clientToArena(rect ?? { left: 0, top: 0, width: spec.width + 8, height: spec.height + 8 }, spec, event.clientX, event.clientY);
    };

    const onPointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
            return;
        }
        const p = toArena(event);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (tool === 'wall') {
            setDrag({ pointerId: event.pointerId, kind: 'wall', x1: snap(p.x), y1: snap(p.y), x2: snap(p.x), y2: snap(p.y) });
            setSelected(undefined);
            return;
        }
        const hit = hitTest(spec, p.x, p.y, 4, robotRadius);
        setSelected(hit);
        if (hit?.kind === 'start' || hit?.kind === 'goal') {
            setDrag({ pointerId: event.pointerId, kind: hit.kind, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
        }
    };

    const onPointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }
        const p = toArena(event);
        if (drag.kind === 'start') {
            setSpec(s => moveStart(s, p.x, p.y, robotRadius));
        } else if (drag.kind === 'goal') {
            setSpec(s => moveGoal(s, p.x, p.y));
        } else {
            setDrag({ ...drag, x2: snap(p.x), y2: snap(p.y) });
        }
    };

    const onPointerUp = (event: React.PointerEvent<SVGSVGElement>): void => {
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }
        if (drag.kind === 'wall') {
            setSpec(s => addWall(s, drag.x1, drag.y1, drag.x2, drag.y2));
        }
        setDrag(undefined);
    };

    const deleteSelected = (): void => {
        if (selected?.kind === 'wall') {
            setSpec(s => removeWall(s, selected.index));
            setSelected(undefined);
        }
    };

    const save = async (andRun: boolean): Promise<void> => {
        if (problem) {
            setError(problem);
            return;
        }
        setSaving(true);
        setError(undefined);
        try {
            await writeFile(diagramPath, diagramText(applyArenaSpec(diagram, spec)));
            if (andRun) {
                askAgent?.(runOnArenaPrompt());
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const pending = drag?.kind === 'wall' && (drag.x1 !== drag.x2 || drag.y1 !== drag.y2) ? drag : undefined;

    return (
        <div className="robolance-arena-editor">
            <div className="robolance-editor-bar" role="toolbar" aria-label="Arena editor">
                <label>
                    Preset
                    <select
                        value=""
                        onChange={e => {
                            const preset = ARENA_PRESETS.find(p => p.id === e.target.value);
                            if (preset) {
                                setSpec(preset.spec());
                                setSelected(undefined);
                            }
                        }}
                        aria-label="Start from a preset"
                    >
                        <option value="" disabled>Start from…</option>
                        {ARENA_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                </label>
                <div className="robolance-editor-tools" role="radiogroup" aria-label="Tool">
                    <button type="button" role="radio" aria-checked={tool === 'select'} className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')}>Move</button>
                    <button type="button" role="radio" aria-checked={tool === 'wall'} className={tool === 'wall' ? 'active' : ''} onClick={() => setTool('wall')}>Draw wall</button>
                </div>
                <button type="button" disabled={selected?.kind !== 'wall'} onClick={deleteSelected}>Delete wall</button>
                <label>
                    W
                    <input type="number" min={50} max={1000} step={5} value={spec.width} aria-label="Arena width in centimetres" onChange={e => setSpec(s => resizeArena(s, Number(e.target.value), s.height))} />
                </label>
                <label>
                    H
                    <input type="number" min={50} max={1000} step={5} value={spec.height} aria-label="Arena height in centimetres" onChange={e => setSpec(s => resizeArena(s, s.width, Number(e.target.value)))} />
                </label>
                <label>
                    Heading
                    <input type="number" min={0} max={359} step={15} value={spec.start.headingDeg} aria-label="Start heading in degrees" onChange={e => setSpec(s => setStartHeading(s, Number(e.target.value)))} />
                </label>
                <label>
                    Goal r
                    <input type="number" min={5} max={50} step={5} value={spec.goal.radius} aria-label="Goal radius in centimetres" onChange={e => setSpec(s => setGoalRadius(s, Number(e.target.value)))} />
                </label>
            </div>
            {/* Only the drawing is zoomed; the controls above and below keep
                their size (inside the zoom they grew with it on a phone). The
                canvas ignores the pane's own drag-to-pan, which is for viewing. */}
            <ZoomPane className="robolance-arena-pane robolance-editor-pane" contentWidth={spec.width + 8} contentHeight={spec.height + 8} mode="contain" maxScale={12} label="Arena editor">
                <div className="robolance-editor-canvas" data-zoom-ignore>
                <ArenaView
                    spec={spec}
                    path={[]}
                    robotRadius={robotRadius}
                    svgRef={svgRef}
                    svgProps={{
                        onPointerDown,
                        onPointerMove,
                        onPointerUp,
                        onPointerCancel: onPointerUp,
                        className: `robolance-arena editing tool-${tool}`,
                    }}
                >
                    {selected?.kind === 'wall' && spec.walls[selected.index] && (
                        <line
                            x1={spec.walls[selected.index]!.x1}
                            y1={spec.walls[selected.index]!.y1}
                            x2={spec.walls[selected.index]!.x2}
                            y2={spec.walls[selected.index]!.y2}
                            className="robolance-arena-wall selected"
                        />
                    )}
                    {pending && <line x1={pending.x1} y1={pending.y1} x2={pending.x2} y2={pending.y2} className="robolance-arena-wall pending" />}
                    {spec.walls.map((w, i) => !isBorderWall(spec, w) && (
                        <g key={`h${i}`} className="robolance-wall-ends">
                            <circle cx={w.x1} cy={w.y1} r={1.5} />
                            <circle cx={w.x2} cy={w.y2} r={1.5} />
                        </g>
                    ))}
                </ArenaView>
                </div>
            </ZoomPane>
            <div className="robolance-editor-footer">
                <span className="robolance-editor-hint">
                    {tool === 'wall' ? 'Drag to draw a wall (snaps to 5 cm).' : 'Drag the robot or the goal; click a wall to select it.'}
                    {' '}{spec.walls.length - 4} inner wall{spec.walls.length - 4 === 1 ? '' : 's'}.
                </span>
                {(error ?? problem) && <span className="robolance-error">{error ?? problem}</span>}
                <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
                <button type="button" onClick={() => { void save(false); }} disabled={saving || !!problem}>Save</button>
                {askAgent && (
                    <button type="button" className="robolance-primary" onClick={() => { void save(true); }} disabled={saving || !!problem}>
                        Save and ask the agent to run it
                    </button>
                )}
            </div>
        </div>
    );
}
