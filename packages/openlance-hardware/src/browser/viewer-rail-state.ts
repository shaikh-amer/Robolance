// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/** The state behind ViewerRail: the explode amount, the open menu and the picked part. */

import * as React from 'react';
import type { PartEntry, PartHit } from './robot-parts';
import type { RailMenu } from './ViewerRail';

export interface ViewerRailState {
    explode: number;
    setExplode(t: number): void;
    open?: RailMenu;
    setOpen(menu: RailMenu | undefined): void;
    picked?: PartHit;
    /** From a tap on the 3D view. */
    onPick(hit: PartHit | undefined): void;
    /** From the parts list: resolves the body to a hit with `entries`. */
    pickBody(body: number | undefined): void;
    clear(): void;
}

export function useViewerRail(entries: PartEntry[], modelKey: unknown): ViewerRailState {
    const [explode, setExplode] = React.useState(0);
    const [open, setOpen] = React.useState<RailMenu>();
    const [picked, setPicked] = React.useState<PartHit>();
    // A new model: nothing is picked and the parts are assembled.
    React.useEffect(() => { setPicked(undefined); setExplode(0); }, [modelKey]);
    const onPick = React.useCallback((hit: PartHit | undefined) => setPicked(hit), []);
    const pickBody = React.useCallback((body: number | undefined) => {
        const e = body === undefined ? undefined : entries.find(x => x.body === body);
        setPicked(e ? { body: e.body, bodyName: e.name, parts: e.parts } : undefined);
    }, [entries]);
    const clear = React.useCallback(() => setPicked(undefined), []);
    return { explode, setExplode, open, setOpen, picked, onPick, pickBody, clear };
}

/** The bodies with visual parts of a viewer model, for the parts list. */
export function partEntriesOf(model: { bodies: Array<{ name: string }>; geoms: Array<{ body: number; shape?: { type: string } }> }): PartEntry[] {
    const counts = new Map<number, number>();
    for (const g of model.geoms) {
        if (g.shape?.type === 'plane') {
            continue;
        }
        counts.set(g.body, (counts.get(g.body) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([body, parts]) => {
        const name = model.bodies[body]?.name?.trim();
        return { body, name: name ? name.replace(/_/g, ' ') : `body ${body}`, parts };
    });
}
