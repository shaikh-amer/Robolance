// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The Hardware tab: Circuit, Arena and Runs views over the project's files,
 * with a time scrubber to replay what the agent's last run recorded, and a
 * live mode that runs the built firmware in the browser.
 */

import * as React from 'react';
import { arenaPreset, DEFAULT_ROBOT, type ArenaSpec, type Diagram } from 'robolance-hardware-sim';
import { ArenaEditor } from './ArenaEditor';
import { ArenaView } from './ArenaView';
import { CircuitView, type CircuitInputs, type PartStates } from './CircuitView';
import { poseIndexAt, readHardwareProject, statesAt, type HardwareProject, type RunEntry } from './hardware-project';
import { RunsView } from './RunsView';
import { ZoomPane } from './ZoomPane';
import { useLiveSimulation } from './use-live-simulation';
import { WiringCheck } from './WiringCheck';
import type { PreviewTabContext } from './preview-tab';

export type HardwareView = 'circuit' | 'arena' | 'runs';

export function HardwarePanel(context: PreviewTabContext): React.ReactElement {
    const project = React.useMemo(() => readHardwareProject(context.files), [context.files]);
    return <HardwarePanelBody project={project} context={context} />;
}

export interface HardwarePanelBodyProps {
    project: HardwareProject;
    context: PreviewTabContext;
    /** The replay page share links open; false hides sharing. */
    shareBase?: string | false;
}

export function HardwarePanelBody({ project, context, shareBase }: HardwarePanelBodyProps): React.ReactElement {
    const diagram = project.diagram;
    const hasArena = Boolean(diagram?.arena);
    const [view, setView] = React.useState<HardwareView>(() => (hasArena ? 'arena' : 'circuit'));
    const [selectedRun, setSelectedRun] = React.useState(0);
    const [timeMs, setTimeMs] = React.useState(() => project.runs[0]?.trace.ranMs ?? 0);
    const [playing, setPlaying] = React.useState(false);
    const [liveMode, setLiveMode] = React.useState(false);
    const [editingArena, setEditingArena] = React.useState(false);
    const live = useLiveSimulation(liveMode ? project.hex : undefined, liveMode ? diagram : undefined);
    const canEditArena = hasArena && !!context.writeFile && !!project.diagramPath;

    const run: RunEntry | undefined = project.runs[Math.min(selectedRun, Math.max(0, project.runs.length - 1))];
    const runDuration = run?.trace.ranMs ?? 0;

    // A new newest run (the agent just ran) is shown from its end, where the result is.
    const newestPath = project.runs[0]?.path;
    React.useEffect(() => {
        setSelectedRun(0);
        setTimeMs(project.runs[0]?.trace.ranMs ?? 0);
        setPlaying(false);
    }, [newestPath]);

    // Replay: advance the scrubber in real time.
    React.useEffect(() => {
        if (!playing || !run) {
            return;
        }
        let last = performance.now();
        let current = timeMs;
        let frame = requestAnimationFrame(function tick(now) {
            const next = advanceReplay(current, now - last, runDuration);
            last = now;
            current = next;
            setTimeMs(next);
            if (next >= runDuration) {
                setPlaying(false);
                return;
            }
            frame = requestAnimationFrame(tick);
        });
        return () => cancelAnimationFrame(frame);
        // timeMs is read once per start; the frame loop carries it forward.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playing, run, runDuration]);

    React.useEffect(() => {
        if (liveMode) {
            live.start();
        } else {
            live.stop();
        }
        // live.start/stop are stable per hex+diagram; re-running on them restarts correctly.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveMode, live.start, live.stop]);

    const inputs = React.useMemo<CircuitInputs | undefined>(() => liveMode ? {
        press: id => live.apply({ action: 'press', part: id }),
        release: id => live.apply({ action: 'release', part: id }),
        set: (id, value) => live.apply({ action: 'set', part: id, value }),
    } : undefined, [liveMode, live.apply]);

    const arenaSpec: ArenaSpec | undefined = diagram?.arena ? (diagram.arena.spec ?? arenaPreset(diagram.arena.preset)) : undefined;
    const robotRadius = diagram?.arena?.robot?.radius ?? DEFAULT_ROBOT.radius;

    let states: PartStates = {};
    if (liveMode && live.live) {
        states = live.live.states;
    } else if (run) {
        states = statesAt(run.trace, timeMs);
    }

    const replayPath = React.useMemo(() => {
        const path = run?.trace.arena?.path ?? [];
        const index = poseIndexAt(path, timeMs, runDuration);
        return index < 0 ? [] : path.slice(0, index + 1);
    }, [run, timeMs, runDuration]);

    if (!diagram) {
        return (
            <div className="robolance-panel robolance-empty">
                {project.diagramError ? (
                    <>
                        <p>The circuit cannot be shown.</p>
                        <code>{project.diagramError}</code>
                        {project.diagramPath && context.openFile && (
                            <button type="button" onClick={() => context.openFile?.(project.diagramPath!)}>Open {project.diagramPath}</button>
                        )}
                    </>
                ) : (
                    <>
                        <p>No <code>diagram.json</code> yet.</p>
                        <p>Describe the circuit and the agent will write the sketch and the diagram.</p>
                        {context.askAgent && (
                            <button type="button" onClick={() => context.askAgent?.('Build a blinking LED on pin 13 with a button on pin 2 that makes it blink faster. Write sketch.ino and diagram.json, then run it and show me the result.')}>
                                Ask the agent to build
                            </button>
                        )}
                    </>
                )}
            </div>
        );
    }

    const liveAvailable = Boolean(project.hex);
    const views: [HardwareView, string][] = [['circuit', 'Circuit'], ...(hasArena ? [['arena', 'Arena'] as [HardwareView, string]] : []), ['runs', `Runs${project.runs.length ? ` (${project.runs.length})` : ''}`]];

    return (
        <div className="robolance-panel" data-theme={context.theme}>
            <div className="robolance-toolbar">
                <div className="robolance-views" role="tablist" aria-label="Hardware views">
                    {views.map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={view === id}
                            className={`robolance-view-btn${view === id ? ' active' : ''}`}
                            onClick={() => setView(id)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="robolance-toolbar-right">
                    {view === 'circuit' && context.askAgent && diagram.parts.length > 0 && (
                        <WiringCheck diagram={diagram} askAgent={context.askAgent} />
                    )}
                    {view === 'arena' && canEditArena && !liveMode && (
                        <button
                            type="button"
                            className={`robolance-edit-btn${editingArena ? ' active' : ''}`}
                            title={editingArena ? 'Back to the recorded run' : 'Draw walls, move the start and the goal'}
                            onClick={() => setEditingArena(v => !v)}
                        >
                            {editingArena ? 'Editing' : 'Edit arena'}
                        </button>
                    )}
                    {project.build?.size && (
                        <span className="robolance-build" title={`built with ${project.build.backend ?? 'the toolchain'}`}>
                            {Math.round(project.build.size.flashBytes / 1024 * 10) / 10} KB flash
                        </span>
                    )}
                    <button
                        type="button"
                        className={`robolance-live-btn${liveMode ? ' active' : ''}`}
                        disabled={!liveAvailable}
                        title={liveAvailable ? (liveMode ? 'Back to the recorded run' : 'Run the firmware here and operate the parts') : 'Compile the sketch first (the agent does this when it runs it)'}
                        onClick={() => setLiveMode(v => !v)}
                    >
                        {liveMode ? 'Live' : 'Go live'}
                    </button>
                </div>
            </div>

            <div className="robolance-body">
                {view === 'circuit' && <CircuitView diagram={diagram} states={states} inputs={inputs} />}
                {view === 'arena' && arenaSpec && editingArena && diagram && context.writeFile && project.diagramPath && (
                    <ArenaEditor
                        diagram={diagram}
                        spec={arenaSpec}
                        diagramPath={project.diagramPath}
                        writeFile={context.writeFile}
                        askAgent={context.askAgent}
                        onClose={() => setEditingArena(false)}
                    />
                )}
                {view === 'arena' && arenaSpec && !editingArena && (
                    <div className="robolance-arena-wrap">
                        <ZoomPane className="robolance-arena-pane" contentWidth={arenaSpec.width + 8} contentHeight={arenaSpec.height + 8} mode="contain" maxScale={12} label="Arena">
                            <ArenaView
                                spec={arenaSpec}
                                path={liveMode && live.live ? live.live.path : replayPath}
                                events={liveMode ? undefined : run?.trace.arena?.events.filter(e => e.atMs <= timeMs)}
                                distanceAheadCm={liveMode ? live.live?.distanceAheadCm : undefined}
                                robotRadius={robotRadius}
                                reachedGoal={liveMode ? live.live?.reachedGoal : (run?.trace.arena?.reachedGoalAtMs ?? Infinity) <= timeMs}
                            />
                        </ZoomPane>
                        <ArenaReadout
                            timeMs={liveMode ? live.live?.timeMs ?? 0 : timeMs}
                            collisions={liveMode ? live.live?.collisions ?? 0 : (run?.trace.arena?.events.filter(e => e.kind === 'collision' && e.atMs <= timeMs).length ?? 0)}
                            score={liveMode ? undefined : run?.trace.arena?.score}
                            reachedGoal={liveMode ? live.live?.reachedGoal ?? false : (run?.trace.arena?.reachedGoalAtMs ?? Infinity) <= timeMs}
                            lineCoverage={liveMode ? undefined : run?.trace.arena?.line?.coverage}
                        />
                    </div>
                )}
                {view === 'runs' && (
                    project.runs.length > 0
                        ? <RunsView runs={project.runs} selected={selectedRun} onSelect={i => { setSelectedRun(i); setTimeMs(project.runs[i].trace.ranMs); setPlaying(false); }} shareBase={shareBase} />
                        : <div className="robolance-empty"><p>No runs yet. When the agent runs the sketch, each run shows up here with its serial output, notes and score.</p></div>
                )}
            </div>

            {liveMode ? (
                <div className="robolance-footer">
                    <span className="robolance-time">{((live.live?.timeMs ?? 0) / 1000).toFixed(1)} s live</span>
                    {live.live?.error && <span className="robolance-error">{live.live.error}</span>}
                    <button type="button" onClick={() => (live.running ? live.stop() : live.start())}>{live.running ? 'Pause' : 'Resume'}</button>
                    <button type="button" onClick={() => { live.reset(); live.start(); }}>Restart</button>
                    <pre className="robolance-live-serial" aria-label="Serial output">{(live.live?.serial ?? []).slice(-6).join('\n')}</pre>
                </div>
            ) : run ? (
                <div className="robolance-footer">
                    <button type="button" onClick={() => { if (timeMs >= runDuration) { setTimeMs(0); } setPlaying(p => !p); }} aria-label={playing ? 'Pause' : 'Play'}>
                        {playing ? '❚❚' : '▶'}
                    </button>
                    <input
                        className="robolance-scrubber"
                        type="range"
                        min={0}
                        max={runDuration}
                        step={10}
                        value={Math.min(timeMs, runDuration)}
                        onChange={e => { setPlaying(false); setTimeMs(Number(e.target.value)); }}
                        aria-label="Time in the recorded run"
                    />
                    <span className="robolance-time">{(Math.min(timeMs, runDuration) / 1000).toFixed(2)} / {(runDuration / 1000).toFixed(1)} s</span>
                    <span className="robolance-run-name">run #{project.runs.length - selectedRun}</span>
                </div>
            ) : (
                <div className="robolance-footer"><span className="robolance-time">No run recorded yet</span></div>
            )}
        </div>
    );
}

function ArenaReadout({ timeMs, collisions, score, reachedGoal, lineCoverage }: { timeMs: number; collisions: number; score?: number; reachedGoal: boolean; lineCoverage?: number }): React.ReactElement {
    return (
        <div className="robolance-arena-readout">
            <span>{(timeMs / 1000).toFixed(1)} s</span>
            <span>{collisions} collision{collisions === 1 ? '' : 's'}</span>
            <span className={reachedGoal ? 'robolance-goal-yes' : ''}>{reachedGoal ? 'goal reached' : 'goal not reached'}</span>
            {lineCoverage !== undefined && <span>line {Math.round(lineCoverage * 100)}%</span>}
            {score !== undefined && <span>score {score}</span>}
        </div>
    );
}

/** The replay position after `elapsedMs` more wall-clock time, clamped to the run. */
export function advanceReplay(currentMs: number, elapsedMs: number, durationMs: number): number {
    return Math.min(durationMs, Math.max(0, currentMs + Math.max(0, elapsedMs)));
}

export function hardwareTabApplies(files: ReadonlyMap<string, string>): boolean {
    for (const key of files.keys()) {
        const path = key.replace(/^\.?\/+/, '');
        if (path === 'diagram.json' || path.endsWith('/diagram.json') || path.endsWith('.ino')) {
            return true;
        }
    }
    return false;
}

export function diagramOf(project: HardwareProject): Diagram | undefined {
    return project.diagram;
}
