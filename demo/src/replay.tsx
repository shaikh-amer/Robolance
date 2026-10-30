// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The replay page. A share link from the IDE's Hardware tab opens here:
 * the same Circuit, Arena and Runs views replay the run, with no account
 * and nothing uploaded (the link carries the run).
 */

import 'robolance-openlance-hardware/src/browser/style/hardware.css';
import './site.css';
import './replay.css';
import { SiteHeader } from './brand';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DuckPanelBody } from 'robolance-openlance-hardware/lib/browser/DuckPanel';
import { HardwarePanelBody } from 'robolance-openlance-hardware/lib/browser/HardwarePanel';
import type { HardwareProject } from 'robolance-openlance-hardware/lib/browser/hardware-project';
import { duckHeadline, headline, loadRecordText, loadShare, loadStoredShare, runSource, type LoadedRun } from './load-run';


type State =
    | { kind: 'loading' }
    | { kind: 'empty' }
    | { kind: 'error'; message: string }
    | { kind: 'run'; loaded: LoadedRun; source: string };

function theme(): 'light' | 'dark' {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function App(): React.ReactElement {
    const [state, setState] = React.useState<State>({ kind: 'loading' });
    const [dragging, setDragging] = React.useState(false);

    const load = React.useCallback(async () => {
        const source = runSource(window.location);
        try {
            if (source.kind === 'share') {
                setState({ kind: 'run', loaded: await loadShare(source.encoded), source: 'shared link' });
            } else if (source.kind === 'stored') {
                setState({ kind: 'run', loaded: await loadStoredShare(source.id), source: 'shared link' });
            } else if (source.kind === 'url') {
                const response = await fetch(source.url);
                if (!response.ok) {
                    throw new Error(`Could not fetch the run (${response.status}).`);
                }
                setState({ kind: 'run', loaded: loadRecordText(await response.text(), source.url), source: source.url });
            } else {
                setState({ kind: 'empty' });
            }
        } catch (err) {
            setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
    }, []);

    React.useEffect(() => {
        void load();
        window.addEventListener('hashchange', load);
        return () => window.removeEventListener('hashchange', load);
    }, [load]);

    const openFile = async (file: File): Promise<void> => {
        try {
            setState({ kind: 'run', loaded: loadRecordText(await file.text(), file.name), source: file.name });
        } catch (err) {
            setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
    };

    const onDrop = (event: React.DragEvent): void => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) {
            void openFile(file);
        }
    };

    const loaded = state.kind === 'run' ? state.loaded : undefined;
    const project: HardwareProject | undefined = loaded?.kind === 'arduino'
        ? { diagram: loaded.run.diagram, diagramPath: loaded.run.diagram ? 'diagram.json' : undefined, runs: [loaded.run] }
        : undefined;

    return (
        <div
            className={`replay-page${dragging ? ' dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
        >
            <SiteHeader home="../" current="replay" />
            <div className="replay-header">
                <span className="replay-title">Run replay</span>
                {loaded && (
                    <span className="replay-headline">
                        {loaded.kind === 'duck' ? duckHeadline(loaded.run) : headline(loaded.run)}
                        {loaded.run.at && <span className="replay-when"> · {new Date(loaded.run.at).toLocaleString()}</span>}
                    </span>
                )}
                <a className="replay-open" href="../runs/">More runs</a>
                <label className="replay-open">
                    Open a run file
                    <input type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { void openFile(f); } }} />
                </label>
            </div>
            {state.kind === 'loading' && <p className="replay-note">Loading the run…</p>}
            {state.kind === 'error' && <p className="replay-note replay-error">{state.message}</p>}
            {(state.kind === 'empty' || state.kind === 'error') && (
                <div className="replay-empty">
                    <p>Open a run shared from OpenLance's Hardware tab (an Arduino robot or the Microduck), or drop a <code>.robolance/runs/&lt;time&gt;.json</code> file here.</p>
                    <p>A share link carries the whole run in its fragment: nothing is uploaded, and it works without an account.</p>
                    <p><a href="../runs/">See runs people made</a> · <a href="../">What is robolance?</a></p>
                </div>
            )}
            {project && (
                <div className="replay-panel">
                    <HardwarePanelBody project={project} context={{ files: new Map(), theme: theme() }} shareBase={false} />
                </div>
            )}
            {loaded?.kind === 'duck' && (
                <div className="replay-panel">
                    <DuckPanelBody runs={[loaded.run]} context={{ files: new Map(), theme: theme() }} shareBase={false} />
                </div>
            )}
        </div>
    );
}

createRoot(document.getElementById('root')!).render(<App />);
