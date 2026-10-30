// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runMission, type MissionResult } from 'robolance-duck-sim';
import { DuckRunsView, galleryActions, PublishForm, SHOW_CHOICES } from '../src/browser/DuckPanel';
import type { DuckRun } from '../src/browser/duck-project';
import { duckGallerySummary, PUBLISHED_FILE, readPublished, suggestedTitle, SUMMARY_PATH_POINTS, writePublished } from '../src/browser/gallery';
import type { PreviewTabContext } from '../src/browser/preview-tab';
import { decodeShare } from '../src/browser/share-run';

const MISSION = readFileSync(require.resolve('robolance-duck-sim/examples/score-a-goal.js'), 'utf8');
let result: MissionResult;
let run: DuckRun;

before(async () => {
    result = await runMission(MISSION);
    run = { path: '.robolance/runs/1761645600000-001.json', stamp: 1761645600000, at: '2026-10-28T10:00:00.000Z', mission: MISSION, result };
});

test('a gallery card carries what it draws, never the code or the log', () => {
    const s = duckGallerySummary(run);
    assert.equal(s.kind, 'duck');
    assert.equal(s.mission, 'goal');
    assert.equal(s.score, result.score);
    assert.ok(s.path.length <= SUMMARY_PATH_POINTS && s.path.length >= 2);
    const whole = (v: number): boolean => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
    assert.ok(s.path.every(([x, y]) => whole(x) && whole(y)), 'centimetres');
    const text = JSON.stringify(s);
    assert.ok(!text.includes('walkTo') && !text.includes('lined up'), 'no mission code, no log lines');
    assert.ok(text.length < 4096, `small: ${text.length} bytes`);
    assert.match(suggestedTitle(run), /^Microduck scores in \d+(\.\d)? s$/);
    const laptop = { ...run, result: { ...result, outcome: 'closed' as const, closedAtS: 9.4, field: { ...result.field, laptop: { x: 0.75, y: 0, heading: 0 } } } };
    assert.equal(duckGallerySummary(laptop).mission, 'laptop');
    assert.equal(suggestedTitle(laptop), 'Microduck closes the laptop in 9.4 s');
});

test('the project remembers which runs it published, and ignores a broken record', () => {
    const files = new Map<string, string>();
    const text = writePublished(files, run.path, { id: 'abc123XYZ', title: 'Goal!', at: '2026-10-30T00:00:00Z' });
    files.set(PUBLISHED_FILE, text);
    assert.deepEqual(readPublished(files)[run.path], { id: 'abc123XYZ', title: 'Goal!', at: '2026-10-30T00:00:00Z', visibility: 'public' });
    files.set(PUBLISHED_FILE, writePublished(files, run.path, undefined));
    assert.deepEqual(readPublished(files), {});
    files.set(PUBLISHED_FILE, '{"runs":{"x":{"id":"../../etc","title":"bad"}}}');
    assert.deepEqual(readPublished(files), {}, 'an id that is not a share id is ignored');
    files.set(PUBLISHED_FILE, 'not json');
    assert.deepEqual(readPublished(files), {});
});

test('publishing stores the run (without the code when asked), publishes it, and records it in the project', async () => {
    const stored: string[] = [];
    const published: Array<{ id: string; title: string; show: string; visibility: string; summary: Record<string, unknown> }> = [];
    const written = new Map<string, string>();
    const unpublished: string[] = [];
    const files = new Map<string, string>();
    const context: PreviewTabContext = {
        files,
        theme: 'dark',
        storeShare: async encoded => { stored.push(encoded); return `share${stored.length}AB`; },
        publishShare: async (id, p) => { published.push({ id, ...p }); return { title: p.title, visibility: p.visibility }; },
        unpublishShare: async id => { unpublished.push(id); },
        writeFile: (path, content) => { written.set(path, content); files.set(path, content); },
    };
    const gallery = galleryActions(context)!;
    await gallery.publish(run, { title: 'No code please', show: 'anonymous', includeCode: false });
    const shared = await decodeShare(stored[0]) as { mission: string; result: { score: number } };
    assert.equal(shared.mission, '', 'the code was left out of the published share');
    assert.equal(shared.result.score, result.score);
    assert.equal(published[0].id, 'share1AB');
    assert.equal(published[0].show, 'anonymous');
    assert.equal(published[0].visibility, 'public');
    assert.equal(published[0].summary.mission, 'goal');
    assert.equal(readPublished(files)[run.path].id, 'share1AB');

    await galleryActions(context)!.publish(run, { title: 'With code', show: 'name_photo', includeCode: true });
    assert.equal(((await decodeShare(stored[1])) as { mission: string }).mission, MISSION);
    assert.equal(published[1].show, 'name_photo');

    // Only me: saved private, anonymous, and recorded as private.
    await galleryActions(context)!.publish(run, { title: 'Just mine', show: 'private', includeCode: true });
    assert.equal(published[2].visibility, 'private');
    assert.equal(published[2].show, 'anonymous');
    assert.equal(readPublished(files)[run.path].visibility, 'private');

    await galleryActions(context)!.unpublish(run);
    assert.deepEqual(unpublished, ['share3AB']);
    assert.deepEqual(readPublished(files), {});
    assert.ok(written.has(PUBLISHED_FILE));

    // A host without the gallery shows no Publish button.
    assert.equal(galleryActions({ files, theme: 'dark' }), undefined);
});

test('a run still publishes when its picture cannot be drawn (no WebGL), and only public runs get one', async () => {
    const thumbs: string[] = [];
    const files = new Map<string, string>();
    const context: PreviewTabContext = {
        files,
        theme: 'dark',
        storeShare: async () => 'share1AB',
        publishShare: async (_id, p) => ({ title: p.title }),
        unpublishShare: async () => undefined,
        publishThumbnail: async id => { thumbs.push(id); },
        writeFile: (path, content) => { files.set(path, content); },
    };
    // Node has no DOM, so drawing the thumbnail fails: publishing must not.
    await galleryActions(context)!.publish(run, { title: 'Public', show: 'anonymous', includeCode: false });
    assert.equal(readPublished(files)[run.path].id, 'share1AB');
    assert.deepEqual(thumbs, []);
    await galleryActions(context)!.publish(run, { title: 'Mine', show: 'private', includeCode: false });
    assert.deepEqual(thumbs, []);
});

test('the runs view offers Publish beside Watch and Share, and says when a run is in the gallery', () => {
    const files = new Map<string, string>();
    const context: PreviewTabContext = {
        files, theme: 'dark',
        storeShare: async () => 'abcdef1', publishShare: async (_id, p) => ({ title: p.title }), unpublishShare: async () => undefined, writeFile: () => undefined,
    };
    const off = renderToStaticMarkup(<DuckRunsView runs={[run]} selected={0} onSelect={() => undefined} onWatch={() => undefined} gallery={galleryActions(context)} />);
    assert.match(off, /<div class="robolance-run-actions"><button[^>]*>Watch this run<\/button><div class="robolance-share">.*?<\/div><button[^>]*>Publish<\/button><\/div>/);
    files.set(PUBLISHED_FILE, writePublished(files, run.path, { id: 'abc123XYZ', title: 'Goal from the left', at: '' }));
    const on = renderToStaticMarkup(<DuckRunsView runs={[run]} selected={0} onSelect={() => undefined} onWatch={() => undefined} gallery={galleryActions(context)} />);
    assert.match(on, /In the gallery/);
    assert.match(on, /Goal from the left/);
    assert.match(on, /Take it off/);
    assert.doesNotMatch(on, />Publish</);
    const none = renderToStaticMarkup(<DuckRunsView runs={[run]} selected={0} onSelect={() => undefined} onWatch={() => undefined} />);
    assert.doesNotMatch(none, />Publish</);
    files.set(PUBLISHED_FILE, writePublished(files, run.path, { id: 'abc123XYZ', title: 'Mine', at: '', visibility: 'private' }));
    const mine = renderToStaticMarkup(<DuckRunsView runs={[run]} selected={0} onSelect={() => undefined} onWatch={() => undefined} gallery={galleryActions(context)} />);
    assert.match(mine, /Only you/);
    assert.match(mine, /href="https:\/\/robolance\.openlance\.ai\/replay\/\?s=abc123XYZ"/);
    assert.match(mine, />Remove</);
});

test('the publish form starts anonymous, without the code, and offers every way to appear', () => {
    const html = renderToStaticMarkup(<PublishForm run={run} gallery={{ published: {}, publish: async () => undefined, unpublish: async () => undefined }} onClose={() => undefined} />);
    for (const label of ['Name and photo', 'Photo only', 'Name only', 'Anonymous', 'Only me']) {
        assert.match(html, new RegExp(`<span>${label}</span>`));
    }
    const checked = html.match(/<input type="radio"[^>]*checked=""[^>]*>/g) ?? [];
    assert.equal(checked.length, 1);
    assert.match(checked[0], /value="anonymous"/);
    assert.doesNotMatch(html, /role="switch" checked=""/, 'the mission code is off until the user turns it on');
    assert.deepEqual(SHOW_CHOICES.map(([v]) => v), ['name_photo', 'photo', 'name', 'anonymous', 'private']);
});
