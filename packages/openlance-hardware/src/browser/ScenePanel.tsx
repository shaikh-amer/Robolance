// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The Hardware tab for robots the agent describes in MJCF: the robot in
 * 3D replaying a run scene_run recorded, the values its controller
 * measured, and the runs with how each ended, the checks, the log and
 * the controller. Same footer as the other views: play and scrub.
 */

import * as React from 'react';
import { formatRunTime } from './hardware-project';
import { advanceReplay } from './replay';
import {
    describeSceneRun, metricAt, readSceneRuns, sceneFiles, sceneFrameAt, sceneModel, sceneOutcomeLabel, sceneRunMs,
    type SceneRunData, type SceneRunEntry,
} from './scene-project';
import { SceneView } from './SceneView';
import type { PreviewTabContext } from './preview-tab';
import { PlayerShell, Transport } from './player';

export type SceneViewName = 'robot' | 'runs';

/** The first thing to ask for in a project with no robot yet. */
export const SCENE_STARTER_PROMPT = 'Design a robot for my task as a MuJoCo MJCF scene (read scene_api first). Check it with scene_check, write a controller, run it with scene_run, measure how well it does the task with sim.metric, and keep improving the robot and the controller until it works. Show me the run.';

export function ScenePanel(context: PreviewTabContext): React.ReactElement {
    const runs = React.useMemo(() => readSceneRuns(context.files), [context.files]);
    const scenes = React.useMemo(() => sceneFiles(context.files), [context.files]);
    return <ScenePanelBody runs={runs} scenes={scenes} context={context} />;
}

export interface ScenePanelBodyProps {
    runs: SceneRunEntry[];
    scenes: string[];
    context: PreviewTabContext;
}

export function ScenePanelBody({ runs, scenes, context }: ScenePanelBodyProps): React.ReactElement {
    const [view, setView] = React.useState<SceneViewName>('robot');
    const [selected, setSelected] = React.useState(0);
    const [timeMs, setTimeMs] = React.useState(0);
    const [playing, setPlaying] = React.useState(false);
    const [follow, setFollow] = React.useState(false);
    const [resetKey, setResetKey] = React.useState(0);

    const entry: SceneRunEntry | undefined = runs[Math.min(selected, Math.max(0, runs.length - 1))];
    const duration = entry ? sceneRunMs(entry.run) : 0;
    const modelText = entry ? context.files.get(entry.modelPath) : undefined;
    // Parsed once per model file, not per frame: a model with meshes can be a few hundred KB.
    const model = React.useMemo(() => (entry ? sceneModel(context.files, entry) : undefined), [entry?.modelPath, modelText]);

    const newestPath = runs[0]?.path;
    React.useEffect(() => {
        setSelected(0);
        setTimeMs(0);
        setPlaying(Boolean(newestPath));
    }, [newestPath]);

    React.useEffect(() => {
        if (!playing || !entry) {
            return;
        }
        let last = performance.now();
        let current = timeMs;
        let frame = requestAnimationFrame(function tick(now) {
            const next = advanceReplay(current, now - last, duration);
            last = now;
            current = next;
            setTimeMs(next);
            if (next >= duration) {
                setPlaying(false);
                return;
            }
            frame = requestAnimationFrame(tick);
        });
        return () => cancelAnimationFrame(frame);
        // timeMs is read once per start; the frame loop carries it forward.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playing, entry, duration]);

    const select = (i: number) => {
        setSelected(i);
        setTimeMs(0);
        setPlaying(false);
    };
    const sceneFile = entry?.scene || scenes[0];

    if (!entry) {
        return (
            <div className="robolance-panel robolance-empty" data-theme={context.theme}>
                <p>No robot runs yet.</p>
                <p>
                    {scenes.length > 0
                        ? `The project has ${scenes.length === 1 ? 'a scene' : `${scenes.length} scenes`} (${scenes.slice(0, 3).join(', ')}). Ask the agent to run it: it checks the model, writes a controller, runs it in the physics simulator and improves it. Every run replays here in 3D.`
                        : 'Describe the robot you want and its task. The agent designs it as a MuJoCo scene, writes its controller, runs it in the physics simulator and improves both until it works. Every run replays here in 3D.'}
                </p>
                {context.askAgent && (
                    <button type="button" onClick={() => context.askAgent?.(scenes.length > 0
                        ? `Check ${scenes[0]} with scene_check, write a controller for it, run it with scene_run and show me the run.`
                        : SCENE_STARTER_PROMPT)}
                    >
                        {scenes.length > 0 ? 'Ask the agent to run it' : 'Ask the agent to design a robot'}
                    </button>
                )}
                {sceneFile && context.openFile && (
                    <button type="button" onClick={() => context.openFile?.(sceneFile)}>Open {sceneFile}</button>
                )}
            </div>
        );
    }

    const toggle = () => { if (timeMs >= duration) { setTimeMs(0); } setPlaying(p => !p); };
    const seek = (ms: number) => { setPlaying(false); setTimeMs(ms); };
    const sceneTools = (
        <>
            <button
                type="button"
                className={`robolance-edit-btn${follow ? ' active' : ''}`}
                aria-pressed={follow}
                title="Keep the camera on the robot"
                onClick={() => setFollow(f => !f)}
            >
                Follow
            </button>
            <button type="button" className="robolance-edit-btn" title="Back to the starting camera (or double-click the view)" onClick={() => setResetKey(k => k + 1)}>
                Reset view
            </button>
        </>
    );
    const views: [SceneViewName, string][] = [['robot', 'Robot'], ['runs', `Runs (${runs.length})`]];
    return (
        <div className="robolance-panel" data-theme={context.theme}>
            <div className="robolance-toolbar">
                <div className="robolance-views" role="tablist" aria-label="Robot views">
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
                    {view === 'robot' && sceneTools}
                    {sceneFile && context.openFile && (
                        <button type="button" className="robolance-edit-btn" onClick={() => context.openFile?.(sceneFile)}>{sceneFile.split('/').pop()}</button>
                    )}
                </div>
            </div>

            <div className="robolance-body">
                {view === 'robot' && (
                    <PlayerShell
                        className="robolance-duck-wrap"
                        viewport={context.viewport}
                        playing={playing}
                        timeMs={timeMs}
                        durationMs={duration}
                        onToggle={toggle}
                        onSeek={seek}
                        fullscreenTools={sceneTools}
                        label={`run #${runs.length - selected}`}
                    >
                        {model
                            ? <SceneView model={model} frame={sceneFrameAt(entry.run, timeMs)} theme={context.theme} follow={follow} resetKey={resetKey} />
                            : <div className="robolance-empty"><p>This run's 3D model ({entry.modelPath}) is missing; run the scene again to record it.</p></div>}
                        <SceneReadout run={entry.run} timeMs={timeMs} />
                    </PlayerShell>
                )}
                {view === 'runs' && <SceneRunsView runs={runs} selected={selected} onSelect={select} onWatch={i => { select(i); setView('robot'); setPlaying(true); }} />}
            </div>

            <div className="robolance-footer">
                <Transport playing={playing} timeMs={timeMs} durationMs={duration} onToggle={toggle} onSeek={seek} label={`run #${runs.length - selected}`} />
            </div>
        </div>
    );
}

/** Time, the first few metrics at that time, and how the run ended once it has. */
export function SceneReadout({ run, timeMs }: { run: SceneRunData; timeMs: number }): React.ReactElement {
    const t = timeMs / 1000;
    const ended = t >= run.simS - 0.01;
    const metrics = Object.entries(run.metrics).slice(0, 3);
    return (
        <div className="robolance-arena-readout robolance-duck-readout">
            <span>{t.toFixed(2)} s</span>
            {metrics.map(([name, series]) => {
                const v = metricAt(series, timeMs);
                return <span key={name}>{name} {v === undefined ? '–' : formatValue(v)}</span>;
            })}
            {ended && <span className={run.outcome === 'done' || run.outcome === 'stopped' ? undefined : 'robolance-error'}>{sceneOutcomeLabel(run)}</span>}
        </div>
    );
}

interface SceneRunsViewProps {
    runs: SceneRunEntry[];
    selected: number;
    onSelect(index: number): void;
    onWatch(index: number): void;
}

export function SceneRunsView({ runs, selected, onSelect, onWatch }: SceneRunsViewProps): React.ReactElement {
    const entry = runs[selected];
    const r = entry?.run;
    return (
        <div className="robolance-runs">
            <ol className="robolance-runs-list" aria-label="Runs">
                {runs.map((e, i) => (
                    <li key={e.path}>
                        <button
                            type="button"
                            className={`robolance-run${i === selected ? ' selected' : ''}`}
                            onClick={() => onSelect(i)}
                            aria-current={i === selected ? 'true' : undefined}
                        >
                            <span className="robolance-run-index">#{runs.length - i}</span>
                            <span className="robolance-run-time">{formatRunTime({ at: e.at, stamp: e.stamp })}</span>
                            <span className="robolance-run-summary">{describeSceneRun(e)}</span>
                        </button>
                    </li>
                ))}
            </ol>
            {entry && r && (
                <div className="robolance-run-detail">
                    <div className="robolance-run-actions">
                        <button type="button" className="robolance-edit-btn" onClick={() => onWatch(selected)}>Watch this run</button>
                    </div>
                    {r.message && r.outcome !== 'done' && <pre className={r.outcome === 'stopped' ? 'robolance-run-serial' : 'robolance-error'}>{r.message}</pre>}
                    {r.check.issues.length > 0 && (
                        <ul className="robolance-run-notes" aria-label="Checks">
                            {r.check.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}
                        </ul>
                    )}
                    {Object.keys(r.metrics).length > 0 && (
                        <div className="robolance-scene-metrics" aria-label="Metrics">
                            {Object.entries(r.metrics).map(([name, series]) => <MetricChart key={name} name={name} series={series} durationS={r.simS} />)}
                        </div>
                    )}
                    <pre className="robolance-run-serial" aria-label="Controller log">
                        {r.logs.length > 0 ? r.logs.join('\n') : '(the controller logged nothing)'}
                    </pre>
                    {entry.controller && (
                        <details className="robolance-duck-mission">
                            <summary>The controller this run used</summary>
                            <pre>{entry.controller}</pre>
                        </details>
                    )}
                </div>
            )}
        </div>
    );
}

/** A small line chart of one metric over the run, with its first, last, lowest and highest values. */
export function MetricChart({ name, series, durationS }: { name: string; series: Array<[number, number]>; durationS: number }): React.ReactElement {
    const values = series.map(([, v]) => v);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    const w = 220;
    const h = 44;
    const points = series.map(([t, v]) => `${((t / (durationS || 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
    return (
        <figure className="robolance-metric">
            <figcaption>
                <strong>{name}</strong> {formatValue(values[0])} → {formatValue(values[values.length - 1])} <span>(min {formatValue(lo)}, max {formatValue(hi)})</span>
            </figcaption>
            <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`${name} over the run`}>
                <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} />
            </svg>
        </figure>
    );
}

export function formatValue(v: number): string {
    const a = Math.abs(v);
    return a !== 0 && (a < 0.01 || a >= 10000) ? v.toExponential(2) : Number(v.toFixed(a < 1 ? 3 : 2)).toString();
}
