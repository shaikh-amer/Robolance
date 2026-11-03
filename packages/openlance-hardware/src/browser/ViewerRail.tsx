// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The column of round buttons under the fullscreen button on the 3D
 * picture: an exploded view (a vertical slider from assembled to exploded)
 * and a parts list (tap a part to light it up and read its name). A tap on
 * the robot itself picks a part too; the card at the top left names it.
 */

import * as React from 'react';
import type { PartEntry, PartHit } from './robot-parts';

export type RailMenu = 'explode' | 'parts';

export interface ViewerRailProps {
    /** 0 assembled, 1 exploded. */
    explode: number;
    onExplode(t: number): void;
    parts: PartEntry[];
    picked?: PartHit;
    onPickBody(body: number | undefined): void;
    /** Which menu is open, if any. */
    open?: RailMenu;
    onOpen(menu: RailMenu | undefined): void;
}

export function ViewerRail({ explode, onExplode, parts, picked, onPickBody, open, onOpen }: ViewerRailProps): React.ReactElement {
    const toggle = (menu: RailMenu) => onOpen(open === menu ? undefined : menu);
    const pct = Math.round(explode * 100);
    return (
        <div className="robolance-rail" role="toolbar" aria-label="3D view tools">
            <button
                type="button"
                className={`robolance-fs-btn${explode > 0 || open === 'explode' ? ' active' : ''}`}
                aria-label={`Exploded view${explode > 0 ? ` (${pct}%)` : ''}`}
                title="Exploded view: slide the parts apart"
                aria-pressed={open === 'explode'}
                onClick={() => toggle('explode')}
            >
                <ExplodeIcon />
            </button>
            <button
                type="button"
                className={`robolance-fs-btn${picked || open === 'parts' ? ' active' : ''}`}
                aria-label="Parts list"
                title="Parts: tap one to light it up, or tap the robot"
                aria-pressed={open === 'parts'}
                onClick={() => toggle('parts')}
            >
                <PartsIcon />
            </button>
            {open === 'explode' && (
                <div className="robolance-rail-menu robolance-rail-explode" role="group" aria-label="Exploded view">
                    <span className="robolance-rail-cap">Exploded</span>
                    <input
                        type="range"
                        className="robolance-rail-slider"
                        min={0}
                        max={100}
                        step={1}
                        value={pct}
                        aria-label="How far apart the parts are"
                        aria-valuetext={pct === 0 ? 'Assembled' : `${pct}% exploded`}
                        onChange={e => onExplode(Number(e.target.value) / 100)}
                    />
                    <span className="robolance-rail-cap">Assembled</span>
                    {explode > 0 && (
                        <button type="button" className="robolance-rail-reset" onClick={() => onExplode(0)}>Reassemble</button>
                    )}
                </div>
            )}
            {open === 'parts' && (
                <div className="robolance-rail-menu robolance-rail-parts" role="listbox" aria-label="Parts">
                    <div className="robolance-rail-head">{parts.length} parts</div>
                    <div className="robolance-rail-list">
                        {parts.map(p => (
                            <button
                                key={p.body}
                                type="button"
                                role="option"
                                aria-selected={picked?.body === p.body}
                                className={`robolance-rail-item${picked?.body === p.body ? ' active' : ''}`}
                                onClick={() => onPickBody(picked?.body === p.body ? undefined : p.body)}
                            >
                                <span>{p.name}</span>
                                {p.parts > 1 && <small>{p.parts}</small>}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/** The card naming the picked part, at the top left of the picture. */
export function PartCard({ hit, onClear }: { hit: PartHit; onClear(): void }): React.ReactElement {
    return (
        <div className="robolance-part-card" role="status">
            <div className="robolance-part-name">{hit.bodyName}</div>
            <div className="robolance-part-meta">
                {hit.parts === 1 ? '1 part' : `${hit.parts} parts`}
                {hit.parentName ? ` · joined to ${hit.parentName}` : ''}
                {hit.meshName ? ` · ${hit.meshName}` : ''}
            </div>
            <button type="button" className="robolance-part-clear" onClick={onClear} aria-label="Clear the selection">×</button>
        </div>
    );
}

function ExplodeIcon(): React.ReactElement {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="6" height="6" rx="1" />
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.5 5.5l2 2M16.5 16.5l2 2M18.5 5.5l-2 2M7.5 16.5l-2 2" />
        </svg>
    );
}

function PartsIcon(): React.ReactElement {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
            <circle cx="7.5" cy="7.5" r="1.5" />
        </svg>
    );
}
