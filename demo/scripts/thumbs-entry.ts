// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance
// In a browser: draws each Featured run's thumbnail (see make-thumbs.mjs).
import { duckThumbnail } from 'robolance-openlance-hardware/lib/browser/duck-thumbnail';
import featured from '../src/featured.json';
import { loadShare } from '../src/load-run';

const out: Record<string, { url: string; lengthS: number }> = {};
(window as unknown as { thumbs: Promise<typeof out> }).thumbs = (async () => {
    for (const card of featured as Array<{ id: string; href: string }>) {
        const loaded = await loadShare(card.href.slice(card.href.indexOf('#r=') + 3));
        if (loaded.kind === 'duck') {
            out[card.id] = { url: await duckThumbnail(loaded.run.result), lengthS: Math.round(loaded.run.result.simS * 10) / 10 };
        }
    }
    return out;
})();
