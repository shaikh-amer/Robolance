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
import { shareDuckRunUrl, trimDuckRunForShare } from './duck-share';
import { duckGallerySummary, GALLERY_PAGE_URL, PUBLISHED_FILE, readPublished, suggestedTitle, writePublished, type PublishedEntry } from './gallery';
import { Score, ScoreCurve, ShareLink } from './RunsView';
import { encodeShare, REPLAY_PAGE_URL } from './share-run';
import type { PreviewTabContext, StoreShare } from './preview-tab';
import { CAMERA_LABELS, nextCameraMode, type CameraMode } from './stage-base';

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
    const [camera, setCamera] = React.useState<CameraMode>('orbit');
    /** The mode's name shown on the pitch for a moment after a switch. */
    const [cameraToast, setCameraToast] = React.useState(0);
    const [resetKey, setResetKey] = React.useState(0);
    React.useEffect(() => {
        if (!cameraToast) {
            return;
        }
        const t = setTimeout(() => setCameraToast(0), 1400);
        return () => clearTimeout(t);
    }, [cameraToast]);

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
                            <CameraButton mode={camera} onClick={() => { setCamera(nextCameraMode); setCameraToast(t => t + 1); }} />
                            <button type="button" className="robolance-edit-btn" title="Back to the starting camera (or double-click the pitch)" onClick={() => { setCamera('orbit'); setResetKey(k => k + 1); }}>
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
                    <div className="robolance-duck-wrap robolance-player" data-viewport={context.viewport ?? 'desktop'}>
                        <DuckScene result={r} timeMs={timeMs} theme={context.theme} camera={camera} resetKey={resetKey} />
                        {cameraToast > 0 && <span className="robolance-camera-toast" role="status">{CAMERA_LABELS[camera]}</span>}
                        <DuckReadout result={r} timeMs={timeMs} />
                    </div>
                )}
                {view === 'runs' && <DuckRunsView runs={runs} selected={selected} onSelect={i => { select(i); }} onWatch={i => { select(i); setView('pitch'); setPlaying(true); }} shareBase={shareBase} storeShare={context.storeShare} gallery={galleryActions(context)} />}
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

/**
 * The camera button, as in a game: each click moves to the next view
 * (broadcast, third person, first person, wide angle).
 */
export function CameraButton({ mode, onClick }: { mode: CameraMode; onClick(): void }): React.ReactElement {
    const next = CAMERA_LABELS[nextCameraMode(mode)];
    return (
        <button
            type="button"
            className={`robolance-edit-btn robolance-camera-btn${mode !== 'orbit' ? ' active' : ''}`}
            title={`Camera: ${CAMERA_LABELS[mode]}. Click for ${next}.`}
            aria-label={`Camera: ${CAMERA_LABELS[mode]}. Click for ${next}.`}
            data-camera={mode}
            onClick={onClick}
        >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            <span className="robolance-camera-name">{CAMERA_LABELS[mode]}</span>
        </button>
    );
}

/** What has happened by `timeMs`: kicks so far, the goal, the score at the end. */
export function DuckReadout({ result, timeMs }: { result: MissionResult; timeMs: number }): React.ReactElement {
    const t = timeMs / 1000;
    const kicks = result.kicks.filter(k => k.atS <= t).length;
    const laptop = Boolean(result.field.laptop);
    const scored = !laptop && result.scoredAtS !== null && result.scoredAtS <= t;
    const closed = laptop && typeof result.closedAtS === 'number' && result.closedAtS <= t;
    const fell = result.events.some(e => e.kind === 'fell' && e.atS <= t);
    const ended = t >= result.simS - 0.01;
    return (
        <div className="robolance-arena-readout robolance-duck-readout">
            <span>{t.toFixed(1)} s</span>
            {!laptop && <span>{kicks} kick{kicks === 1 ? '' : 's'}</span>}
            {scored && <span className="robolance-goal-yes robolance-goal-banner">GOAL!</span>}
            {closed && <span className="robolance-goal-yes robolance-goal-banner">LAPTOP CLOSED!</span>}
            {fell && <span className="robolance-error">fell over</span>}
            {ended && !scored && !closed && <span>{outcomeLabel(result)}</span>}
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
    /** Stores a share for a short link; see PreviewTabContext.storeShare. */
    storeShare?: StoreShare;
    /** Publishing to the public runs gallery; absent where the host cannot. */
    gallery?: GalleryActions;
}

export function DuckRunsView({ runs, selected, onSelect, onWatch, shareBase = REPLAY_PAGE_URL, storeShare, gallery }: DuckRunsViewProps): React.ReactElement {
    const run = runs[selected];
    const [publishing, setPublishing] = React.useState(false);
    React.useEffect(() => setPublishing(false), [run?.path]);
    const published = run && gallery?.published[run.path];
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
                    <div className="robolance-run-actions">
                        <button type="button" className="robolance-edit-btn" onClick={() => onWatch(selected)}>Watch this run</button>
                        {shareBase && <ShareLink id={run.path} makeUrl={() => shareDuckRunUrl(run, shareBase, storeShare)} />}
                        {gallery && !published && !publishing && (
                            <button type="button" className="robolance-edit-btn" onClick={() => setPublishing(true)}>Publish to gallery</button>
                        )}
                    </div>
                    {gallery && published && <PublishedRow run={run} entry={published} gallery={gallery} />}
                    {gallery && !published && publishing && <PublishForm run={run} gallery={gallery} onClose={() => setPublishing(false)} />}
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

/** Publishing runs to the public gallery (robolance.openlance.ai/runs/). */
export interface GalleryActions {
    /** Runs this project published, by run path. */
    published: Record<string, PublishedEntry>;
    publish(run: DuckRun, options: { title: string; showName: boolean; includeCode: boolean }): Promise<void>;
    unpublish(run: DuckRun): Promise<void>;
}

/** The gallery as the host offers it: storing a share, publishing it, and recording it in the project. */
export function galleryActions(context: PreviewTabContext): GalleryActions | undefined {
    const { storeShare, publishShare, unpublishShare, writeFile, files } = context;
    if (!storeShare || !publishShare || !unpublishShare || !writeFile) {
        return undefined;
    }
    return {
        published: readPublished(files),
        async publish(run, { title, showName, includeCode }) {
            // Without the code, the share the gallery opens carries no mission.
            const encoded = await encodeShare(trimDuckRunForShare(includeCode ? run : { ...run, mission: '' }));
            const id = await storeShare(encoded, 'duck');
            if (!/^[0-9A-Za-z]{6,32}$/.test(id ?? '')) {
                throw new Error('The run could not be stored.');
            }
            const done = await publishShare(id, { title, showName, summary: { ...duckGallerySummary(run) } });
            await writeFile(PUBLISHED_FILE, writePublished(files, run.path, { id, title: done.title, at: new Date().toISOString() }));
        },
        async unpublish(run) {
            const entry = readPublished(files)[run.path];
            if (entry) {
                try {
                    await unpublishShare(entry.id);
                } catch (err) {
                    // Already gone from the gallery (deleted, or another device took it off): forget it here too.
                    if (!/no shared run/i.test(err instanceof Error ? err.message : String(err))) {
                        throw err;
                    }
                }
            }
            await writeFile(PUBLISHED_FILE, writePublished(files, run.path, undefined));
        },
    };
}

/** Asks for a title, whether to show the account's name and whether to include the code, then publishes. */
export function PublishForm({ run, gallery, onClose }: { run: DuckRun; gallery: GalleryActions; onClose(): void }): React.ReactElement {
    const [title, setTitle] = React.useState(() => suggestedTitle(run));
    const [showName, setShowName] = React.useState(false);
    const [includeCode, setIncludeCode] = React.useState(true);
    const [state, setState] = React.useState<{ kind: 'idle' | 'working' } | { kind: 'failed'; message: string }>({ kind: 'idle' });
    const valid = title.trim().length >= 3;
    const publish = async (): Promise<void> => {
        setState({ kind: 'working' });
        try {
            await gallery.publish(run, { title: title.trim(), showName, includeCode });
            onClose();
        } catch (err) {
            setState({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
        }
    };
    return (
        <form className="robolance-publish" onSubmit={e => { e.preventDefault(); if (valid) { void publish(); } }}>
            <label className="robolance-publish-field">
                <span>Title</span>
                <input type="text" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} />
            </label>
            <label className="robolance-publish-check">
                <input type="checkbox" checked={showName} onChange={e => setShowName(e.target.checked)} />
                <span>Show my name</span>
            </label>
            <label className="robolance-publish-check">
                <input type="checkbox" checked={includeCode} onChange={e => setIncludeCode(e.target.checked)} />
                <span>Include my mission code</span>
            </label>
            <p className="robolance-publish-note">
                Anyone can watch this run on <a href={GALLERY_PAGE_URL} target="_blank" rel="noreferrer">robolance.openlance.ai/runs</a>
                {includeCode ? ', with its mission code and log' : ''}. You can take it off any time.
            </p>
            {state.kind === 'failed' && <p className="robolance-error" role="alert">{state.message}</p>}
            <div className="robolance-run-actions">
                <button type="submit" className="robolance-edit-btn robolance-primary-btn" disabled={!valid || state.kind === 'working'}>
                    {state.kind === 'working' ? 'Publishing…' : 'Publish'}
                </button>
                <button type="button" className="robolance-edit-btn" onClick={onClose} disabled={state.kind === 'working'}>Cancel</button>
            </div>
        </form>
    );
}

/** A published run: where to see it and how to take it off. */
export function PublishedRow({ run, entry, gallery }: { run: DuckRun; entry: PublishedEntry; gallery: GalleryActions }): React.ReactElement {
    const [state, setState] = React.useState<{ kind: 'idle' | 'working' } | { kind: 'failed'; message: string }>({ kind: 'idle' });
    const takeOff = async (): Promise<void> => {
        setState({ kind: 'working' });
        try {
            await gallery.unpublish(run);
        } catch (err) {
            setState({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
        }
    };
    return (
        <div className="robolance-published">
            <span className="robolance-published-badge">In the gallery</span>
            <span className="robolance-published-title" title={entry.title}>{entry.title}</span>
            <a className="robolance-edit-btn" href={GALLERY_PAGE_URL} target="_blank" rel="noreferrer">View</a>
            <button type="button" className="robolance-edit-btn" onClick={() => { void takeOff(); }} disabled={state.kind === 'working'}>
                {state.kind === 'working' ? 'Taking off…' : 'Take it off'}
            </button>
            {state.kind === 'failed' && <span className="robolance-error" role="alert">{state.message}</span>}
        </div>
    );
}
