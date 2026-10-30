// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance
// Records the gallery's Featured runs: real Microduck runs from the
// simulator, saved as card summaries and replay links that carry the run
// (so they play with no server). Run from demo/: node scripts/make-featured.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DEFAULT_FIELD, runMission } from 'robolance-duck-sim';
import { trimDuckRunForShare } from 'robolance-openlance-hardware/lib/browser/duck-share.js';
import { duckGallerySummary } from 'robolance-openlance-hardware/lib/browser/gallery.js';
import { encodeShare, REPLAY_PAGE_URL, SHARE_PARAM } from 'robolance-openlance-hardware/lib/browser/share-run.js';

const require = createRequire(import.meta.url);
const example = name => readFileSync(require.resolve(`robolance-duck-sim/examples/${name}.js`), 'utf8');
const goal = example('score-a-goal');

const missions = [
    {
        title: 'Microduck scores a goal',
        code: goal,
        field: DEFAULT_FIELD,
    },
    {
        title: 'Microduck goes round a box and scores',
        // A box on the straight line to the ball: a waypoint past it, then the goal mission.
        code: `// Go round the box first, then line up and kick.\nawait duck.walkTo(-0.08, 0.38);\n${goal}`,
        field: { ...DEFAULT_FIELD, obstacles: [{ name: 'box', x: 0.18, y: 0.13, width: 0.12, depth: 0.12, height: 0.12 }] },
    },
    {
        title: 'Microduck closes the laptop so I come and play',
        code: example('close-the-laptop'),
        field: { ...DEFAULT_FIELD, laptop: { x: 0.75, y: 0, heading: 0 } },
    },
];

const featured = [];
for (const m of missions) {
    const result = await runMission(m.code, { field: m.field });
    const at = new Date().toISOString();
    const run = { path: `.robolance/runs/${Date.now()}.json`, stamp: Date.now(), at, mission: m.code, result };
    const hits = result.events.filter(e => e.kind === 'obstacle').length;
    console.log(`${m.title}: ${result.outcome}, score ${result.score}, ${result.simS.toFixed(1)} s${hits ? `, ${hits} obstacle hits` : ''}`);
    if (result.score < 80) {
        throw new Error(`${m.title} is not good enough to feature (score ${result.score})`);
    }
    const encoded = await encodeShare(trimDuckRunForShare(run));
    featured.push({
        id: `featured-${featured.length + 1}`,
        title: m.title,
        author: 'robolance',
        summary: duckGallerySummary(run),
        score: result.score,
        featured: true,
        publishedAt: at,
        href: `${REPLAY_PAGE_URL}#${SHARE_PARAM}=${encoded}`,
    });
}
writeFileSync('src/featured.json', `${JSON.stringify(featured, null, 1)}\n`);
console.log(`src/featured.json: ${featured.length} runs, ${Math.round(readFileSync('src/featured.json').length / 1024)} KB`);
