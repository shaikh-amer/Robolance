// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The history of runs the agent made: a score curve (the "training" view),
 * the list to pick a run from, and the selected run's notes and serial log.
 */

import * as React from 'react';
import { describeRun, formatRunTime, type RunEntry } from './hardware-project';

export interface RunsViewProps {
    runs: RunEntry[];
    selected: number;
    onSelect(index: number): void;
}

export function RunsView({ runs, selected, onSelect }: RunsViewProps): React.ReactElement {
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

function Score({ value }: { value: number }): React.ReactElement {
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
    const ordered = [...runs].reverse();
    const width = 320;
    const height = 72;
    const pad = 10;
    const step = ordered.length > 1 ? (width - pad * 2) / (ordered.length - 1) : 0;
    const x = (i: number): number => pad + i * step;
    const y = (score: number): number => height - pad - (score / 100) * (height - pad * 2);
    const points = ordered.map((r, i) => `${x(i).toFixed(1)},${y(r.trace.arena!.score).toFixed(1)}`).join(' ');
    return (
        <svg className="robolance-score-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Score over ${ordered.length} runs`}>
            <line x1={pad} y1={y(0)} x2={width - pad} y2={y(0)} className="robolance-score-axis" />
            <line x1={pad} y1={y(80)} x2={width - pad} y2={y(80)} className="robolance-score-goal-line" />
            <polyline points={points} className="robolance-score-line" />
            {ordered.map((r, i) => (
                <circle
                    key={r.path}
                    cx={x(i)}
                    cy={y(r.trace.arena!.score)}
                    r={r.path === selectedPath ? 4 : 2.5}
                    className={`robolance-score-dot${r.path === selectedPath ? ' selected' : ''}`}
                    onClick={() => onSelect(r.path)}
                >
                    <title>{`run ${i + 1}: ${r.trace.arena!.score}`}</title>
                </circle>
            ))}
        </svg>
    );
}
