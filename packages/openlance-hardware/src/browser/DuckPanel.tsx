// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The Hardware tab for a Microduck project: the pitch in 3D replaying a
 * recorded run, and the runs the agent made with their scores, notes, logs
 * and missions. Same footer as the Arduino view: play and scrub.
 */

import * as React from 'react';
import type { MissionResult } from 'robolance-duck-sim/viewer';
import { DuckScene } from './DuckScene';
import { describeDuckRun, describeDuckSkills, duckRunMs, outcomeLabel, readDuckRuns, missionPath, type DuckRun } from './duck-project';
import { formatRunTime } from './hardware-project';
import { advanceReplay } from './replay';
import { shareDuckRunUrl } from './duck-share';
import { Score, ScoreCurve, ShareLink } from './RunsView';
import { REPLAY_PAGE_URL } from './share-run';
import type { PreviewTabContext } from './preview-tab';

export type DuckView = 'pitch' | 'runs';

/** The first thing to ask for in an empty duck project. */
export const DUCK_STARTER_PROMPT = 'Make the Microduck score a goal: write mission.js, run it with duck_run, read the notes and keep improving it until the ball goes in. Show me the run.';

export function DuckPanel(context: PreviewTabContext): React.ReactElement {
    const runs = React.useMemo(() => readDuckRuns(context.files), [context.files]);
    const mission = React.useMemo(() => missionPath(context.files), [context.files]);
    return <DuckPanelBody runs={runs} missionPath={mission} context={context} />;
}

export interface DuckPanelBodyProps {
    runs: DuckRun[];
    missionPath?: string;
    context: PreviewTabContext;
    /** The replay page share links open; false hides sharing (the replay page itself). */
    shareBase?: string | false;
}

export function DuckPanelBody({ runs, missionPath: mission, context, shareBase = REPLAY_PAGE_URL }: DuckPanelBodyProps): React.ReactElement {
    const [view, setView] = React.useState<DuckView>('pitch');
    const [selected, setSelected] = React.useState(0);
    const [timeMs, setTimeMs] = React.useState(0);
    const [playing, setPlaying] = React.useState(false);
    const [follow, setFollow] = React.useState(false);
    const [resetKey, setResetKey] = React.useState(0);

    const run: DuckRun | undefined = runs[Math.min(selected, Math.max(0, runs.length - 1))];
    const duration = run ? duckRunMs(run) : 0;

    // The agent just ran: show the new run from the start, playing.
    const newestPath = runs[0]?.path;
    React.useEffect(() => {
        setSelected(0);
        setTimeMs(0);
        setPlaying(Boolean(newestPath));
    }, [newestPath]);

    React.useEffect(() => {
        if (!playing || !run) {
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
    }, [playing, run, duration]);

    const select = (i: number) => {
        setSelected(i);
        setTimeMs(0);
        setPlaying(false);
    };

    if (!run) {
        return (
            <div className="robolance-panel robolance-empty" data-theme={context.theme}>
                <p>No duck runs yet.</p>
                <p>Ask the agent to make the Microduck score: it writes the mission, runs it in the physics simulator, reads what happened and tries again. Every run replays here.</p>
                {context.askAgent && (
                    <button type="button" onClick={() => context.askAgent?.(DUCK_STARTER_PROMPT)}>Ask the agent to score a goal</button>
                )}
                {mission && context.openFile && (
                    <button type="button" onClick={() => context.openFile?.(mission)}>Open {mission}</button>
                )}
            </div>
        );
    }

    const r = run.result;
    const views: [DuckView, string][] = [['pitch', 'Pitch'], ['runs', `Runs (${runs.length})`]];
    return (
        <div className="robolance-panel" data-theme={context.theme}>
            <div className="robolance-toolbar">
                <div className="robolance-views" role="tablist" aria-label="Duck views">
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
                    {view === 'pitch' && (
                        <>
                            <button
                                type="button"
                                className={`robolance-edit-btn${follow ? ' active' : ''}`}
                                aria-pressed={follow}
                                title="Keep the camera on the duck"
                                onClick={() => setFollow(f => !f)}
                            >
                                Follow
                            </button>
                            <button type="button" className="robolance-edit-btn" title="Back to the starting camera (or double-click the pitch)" onClick={() => setResetKey(k => k + 1)}>
                                Reset view
                            </button>
                        </>
                    )}
                    {mission && context.openFile && (
                        <button type="button" className="robolance-edit-btn" onClick={() => context.openFile?.(mission)}>mission.js</button>
                    )}
                </div>
            </div>

            <div className="robolance-body">
                {view === 'pitch' && (
                    <div className="robolance-duck-wrap">
                        <DuckScene result={r} timeMs={timeMs} theme={context.theme} follow={follow} resetKey={resetKey} />
                        <DuckReadout result={r} timeMs={timeMs} />
                    </div>
                )}
                {view === 'runs' && <DuckRunsView runs={runs} selected={selected} onSelect={i => { select(i); }} onWatch={i => { select(i); setView('pitch'); setPlaying(true); }} shareBase={shareBase} />}
            </div>

            <div className="robolance-footer">
                <button type="button" onClick={() => { if (timeMs >= duration) { setTimeMs(0); } setPlaying(p => !p); }} aria-label={playing ? 'Pause' : 'Play'}>
                    {playing ? '❚❚' : '▶'}
                </button>
                <input
                    className="robolance-scrubber"
                    type="range"
                    min={0}
                    max={duration}
                    step={20}
                    value={Math.min(timeMs, duration)}
                    onChange={e => { setPlaying(false); setTimeMs(Number(e.target.value)); }}
                    aria-label="Time in the recorded run"
                />
                <span className="robolance-time">{(Math.min(timeMs, duration) / 1000).toFixed(2)} / {(duration / 1000).toFixed(1)} s</span>
                <span className="robolance-run-name">run #{runs.length - selected}</span>
            </div>
        </div>
    );
}

/** What has happened by `timeMs`: kicks so far, the goal, the score at the end. */
export function DuckReadout({ result, timeMs }: { result: MissionResult; timeMs: number }): React.ReactElement {
    const t = timeMs / 1000;
    const kicks = result.kicks.filter(k => k.atS <= t).length;
    const scored = result.scoredAtS !== null && result.scoredAtS <= t;
    const fell = result.events.some(e => e.kind === 'fell' && e.atS <= t);
    const ended = t >= result.simS - 0.01;
    return (
        <div className="robolance-arena-readout robolance-duck-readout">
            <span>{t.toFixed(1)} s</span>
            <span>{kicks} kick{kicks === 1 ? '' : 's'}</span>
            {scored && <span className="robolance-goal-yes robolance-goal-banner">GOAL!</span>}
            {fell && <span className="robolance-error">fell over</span>}
            {ended && !scored && <span>{outcomeLabel(result)}</span>}
            {ended && <span>score {result.score}</span>}
        </div>
    );
}

interface DuckRunsViewProps {
    runs: DuckRun[];
    selected: number;
    onSelect(index: number): void;
    onWatch(index: number): void;
    shareBase?: string | false;
}

export function DuckRunsView({ runs, selected, onSelect, onWatch, shareBase = REPLAY_PAGE_URL }: DuckRunsViewProps): React.ReactElement {
    const run = runs[selected];
    return (
        <div className="robolance-runs">
            {runs.length > 1 && (
                <ScoreCurve
                    scores={runs.map(r => ({ id: r.path, score: r.result.score }))}
                    selected={run?.path}
                    onSelect={path => onSelect(runs.findIndex(r => r.path === path))}
                />
            )}
            <ol className="robolance-runs-list" aria-label="Runs">
                {runs.map((r, i) => (
                    <li key={r.path}>
                        <button
                            type="button"
                            className={`robolance-run${i === selected ? ' selected' : ''}`}
                            onClick={() => onSelect(i)}
                            aria-current={i === selected ? 'true' : undefined}
                        >
                            <span className="robolance-run-index">#{runs.length - i}</span>
                            <span className="robolance-run-time">{formatRunTime({ at: r.at, stamp: r.stamp })}</span>
                            <span className="robolance-run-summary">{describeDuckRun(r)}</span>
                            <Score value={r.result.score} />
                        </button>
                    </li>
                ))}
            </ol>
            {run && (
                <div className="robolance-run-detail">
                    <button type="button" className="robolance-edit-btn" onClick={() => onWatch(selected)}>Watch this run</button>
                    {shareBase && <ShareLink id={run.path} makeUrl={() => shareDuckRunUrl(run, shareBase)} />}
                    {describeDuckSkills(run) && <p className="robolance-duck-skills">Trained policies from the project: {describeDuckSkills(run)}</p>}
                    {run.result.error && <pre className="robolance-error">{run.result.error}</pre>}
                    {run.result.notes.length > 0 && (
                        <ul className="robolance-run-notes">
                            {run.result.notes.map((note, i) => <li key={i}>{note}</li>)}
                        </ul>
                    )}
                    <pre className="robolance-run-serial" aria-label="Mission log">
                        {run.result.logs.length > 0 ? run.result.logs.join('\n') : '(the mission logged nothing)'}
                    </pre>
                    {run.mission && (
                        <details className="robolance-duck-mission">
                            <summary>The mission this run used</summary>
                            <pre>{run.mission}</pre>
                        </details>
                    )}
                </div>
            )}
        </div>
    );
}
