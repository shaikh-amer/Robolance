// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The history of runs the agent made: a score curve (the "training" view),
 * the list to pick a run from, and the selected run's notes and serial log.
 */

import * as React from 'react';
import { describeRun, formatRunTime, type RunEntry } from './hardware-project';
import { REPLAY_PAGE_URL, shareRunUrl } from './share-run';

export interface RunsViewProps {
    runs: RunEntry[];
    selected: number;
    onSelect(index: number): void;
    /** The replay page a share link opens; false hides sharing (the replay page itself). */
    shareBase?: string | false;
}

export function RunsView({ runs, selected, onSelect, shareBase = REPLAY_PAGE_URL }: RunsViewProps): React.ReactElement {
    const run = runs[selected];
    const scored = runs.filter(r => r.trace.arena);
    return (
        <div className="robolance-runs">
            {scored.length > 1 && <ScoreChart runs={scored} selectedPath={run?.path} onSelect={path => onSelect(runs.findIndex(r => r.path === path))} />}
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
                            <span className="robolance-run-time">{formatRunTime(r)}</span>
                            <span className="robolance-run-summary">{describeRun(r)}</span>
                            {r.trace.arena && <Score value={r.trace.arena.score} />}
                        </button>
                    </li>
                ))}
            </ol>
            {run && (
                <div className="robolance-run-detail">
                    {shareBase && <ShareRun run={run} base={shareBase} />}
                    {run.trace.notes.length > 0 && (
                        <ul className="robolance-run-notes">
                            {run.trace.notes.map((note, i) => <li key={i}>{note}</li>)}
                        </ul>
                    )}
                    <pre className="robolance-run-serial" aria-label="Serial output">
                        {run.trace.serial.length > 0 ? run.trace.serial.join('\n') : '(nothing printed on Serial)'}
                    </pre>
                </div>
            )}
        </div>
    );
}

/**
 * "Share this run": the link carries the run itself (deflated into the
 * fragment), so anyone can open the replay without an account.
 */
export function ShareRun({ run, base }: { run: RunEntry; base: string }): React.ReactElement {
    const [state, setState] = React.useState<{ kind: 'idle' | 'working' | 'copied' | 'failed' | 'show'; url?: string }>({ kind: 'idle' });
    const timer = React.useRef<ReturnType<typeof setTimeout>>();
    const mounted = React.useRef(true);
    React.useEffect(() => () => {
        mounted.current = false;
        if (timer.current) {
            clearTimeout(timer.current);
        }
    }, []);
    React.useEffect(() => { setState({ kind: 'idle' }); }, [run.path]);

    const share = async (): Promise<void> => {
        setState({ kind: 'working' });
        let next: typeof state;
        try {
            const url = await shareRunUrl(run, base);
            try {
                await navigator.clipboard.writeText(url);
                next = { kind: 'copied', url };
            } catch {
                // No clipboard (an iframe without the permission, an insecure page): show the link instead.
                next = { kind: 'show', url };
            }
        } catch {
            next = { kind: 'failed' };
        }
        if (!mounted.current) {
            return;
        }
        setState(next);
        if (next.kind === 'copied' || next.kind === 'failed') {
            if (timer.current) {
                clearTimeout(timer.current);
            }
            timer.current = setTimeout(() => setState({ kind: 'idle' }), 4000);
        }
    };

    return (
        <div className="robolance-share">
            <button type="button" className="robolance-share-btn" disabled={state.kind === 'working'} title="Copy a link that replays this run; the link carries the run, nothing is uploaded" onClick={() => { void share(); }}>
                {state.kind === 'working' ? 'Making link…' : 'Share this run'}
            </button>
            {state.kind === 'copied' && <span className="robolance-share-status" role="status">Link copied.</span>}
            {state.kind === 'failed' && <span className="robolance-share-status robolance-error" role="status">Could not make the link.</span>}
            {state.kind === 'show' && state.url && (
                <input className="robolance-share-url" readOnly value={state.url} aria-label="Share link" onFocus={e => e.currentTarget.select()} />
            )}
        </div>
    );
}

export function Score({ value }: { value: number }): React.ReactElement {
    const tone = value >= 80 ? 'good' : value >= 40 ? 'mid' : 'low';
    return <span className={`robolance-score ${tone}`}>{value}</span>;
}

interface ScoreChartProps {
    /** Newest first. */
    runs: RunEntry[];
    selectedPath?: string;
    onSelect(path: string): void;
}

/** Score per run, oldest to newest, so progress reads left to right. */
export function ScoreChart({ runs, selectedPath, onSelect }: ScoreChartProps): React.ReactElement {
    return <ScoreCurve scores={runs.map(r => ({ id: r.path, score: r.trace.arena!.score }))} selected={selectedPath} onSelect={onSelect} />;
}

export interface ScoreCurveProps {
    /** Newest first, like the runs list. */
    scores: Array<{ id: string; score: number }>;
    selected?: string;
    onSelect(id: string): void;
}

/** Scores 0-100 as a line, oldest on the left, with the 80 mark drawn. */
export function ScoreCurve({ scores, selected, onSelect }: ScoreCurveProps): React.ReactElement {
    const ordered = [...scores].reverse();
    const width = 320;
    const height = 72;
    const pad = 10;
    const step = ordered.length > 1 ? (width - pad * 2) / (ordered.length - 1) : 0;
    const x = (i: number): number => pad + i * step;
    const y = (score: number): number => height - pad - (score / 100) * (height - pad * 2);
    const points = ordered.map((r, i) => `${x(i).toFixed(1)},${y(r.score).toFixed(1)}`).join(' ');
    return (
        <svg className="robolance-score-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Score over ${ordered.length} runs`}>
            <line x1={pad} y1={y(0)} x2={width - pad} y2={y(0)} className="robolance-score-axis" />
            <line x1={pad} y1={y(80)} x2={width - pad} y2={y(80)} className="robolance-score-goal-line" />
            <polyline points={points} className="robolance-score-line" />
            {ordered.map((r, i) => (
                <circle
                    key={r.id}
                    cx={x(i)}
                    cy={y(r.score)}
                    r={r.id === selected ? 4 : 2.5}
                    className={`robolance-score-dot${r.id === selected ? ' selected' : ''}`}
                    onClick={() => onSelect(r.id)}
                >
                    <title>{`run ${i + 1}: ${r.score}`}</title>
                </circle>
            ))}
        </svg>
    );
}
