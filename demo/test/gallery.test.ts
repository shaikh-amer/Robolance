// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseShareHash } from 'robolance-openlance-hardware/lib/browser/share-run';
import featured from '../src/featured.json';
import { ago, cardHref, fetchGallery, filterCards, formatLength, mergeFeatured, pitchDrawing, safeAvatar, safeThumb, type GalleryCard } from '../src/gallery-data';
import { loadShare } from '../src/load-run';

const fakeFetch = (status: number, body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('the gallery lists published runs and drops what is not a card', async () => {
    const page = await fetchGallery('best', 0, fakeFetch(200, {
        featured: [{ id: 'F1', title: 'Pinned', score: 99, publishedAt: '' }],
        runs: [{ id: 'abc123', title: 'A run', score: 90, publishedAt: '' }, { title: 'no id' }, 'junk'],
    }));
    assert.deepEqual(page.runs.map(r => r.id), ['abc123']);
    assert.deepEqual(page.featured.map(r => r.id), ['F1']);
    await assert.rejects(fetchGallery('new', 0, fakeFetch(503, {})), /Could not list the runs \(503\)\. The featured runs still play\./);
    const offline = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    await assert.rejects(fetchGallery('new', 0, offline), /Could not reach OpenLance/);
});

test('a published run opens by its short link; a featured one by the link it carries', () => {
    assert.equal(cardHref({ id: 'abc123', title: 't', score: 1, publishedAt: '' }), 'https://robolance.openlance.ai/replay/?s=abc123');
    assert.equal(cardHref({ id: 'x', title: 't', score: 1, publishedAt: '', href: 'https://e/#r=zz' }), 'https://e/#r=zz');
});

test('featured runs come first, once; filters pick a mission', () => {
    const card = (id: string, mission?: string): GalleryCard => ({ id, title: id, score: 1, publishedAt: '', summary: mission ? { mission } as GalleryCard['summary'] : undefined });
    assert.deepEqual(mergeFeatured([card('a'), card('b')], [card('b'), card('c')]).map(c => c.id), ['a', 'b', 'c']);
    const cards = [card('g', 'goal'), card('l', 'laptop'), card('n')];
    assert.deepEqual(filterCards(cards, 'laptop').map(c => c.id), ['l']);
    assert.equal(filterCards(cards, 'all').length, 3);
});

test('a card draws the pitch from above: goal on the right, y up, the laptop as a box', () => {
    const laptopRun = (featured as GalleryCard[]).find(c => c.summary?.mission === 'laptop')!;
    const d = pitchDrawing(laptopRun.summary!, 240);
    const f = laptopRun.summary!.field;
    assert.equal(d.width, 240);
    assert.equal(d.height, Math.round(((f.bounds.yMax - f.bounds.yMin) / (f.bounds.xMax - f.bounds.xMin)) * 240));
    // x = 0.95 m on a pitch from -0.4 to 1.3 m.
    assert.equal(d.goal.x, Math.round(((f.goal.x - f.bounds.xMin) / (f.bounds.xMax - f.bounds.xMin)) * 240 * 10) / 10);
    assert.ok(d.goal.x > d.width * 0.7, 'the goal is on the right');
    assert.ok(d.goal.y1 < d.goal.y2, 'the goal mouth spans up the picture (y flipped)');
    assert.equal(d.boxes.length, 1, 'the laptop');
    assert.match(d.walk, /^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+)+$/);
});

test('the featured runs are real, good runs that replay from their own links', async () => {
    const cards = featured as GalleryCard[];
    assert.deepEqual(cards.map(c => c.summary?.mission), ['goal', 'obstacles', 'laptop']);
    for (const card of cards) {
        assert.ok(card.score >= 80, `${card.title}: ${card.score}`);
        const encoded = parseShareHash(new URL(card.href!).hash);
        const loaded = await loadShare(encoded!);
        assert.equal(loaded.kind, 'duck');
        if (loaded.kind === 'duck') {
            assert.equal(loaded.run.result.score, card.score);
            assert.ok(loaded.run.result.outcome === 'goal' || loaded.run.result.outcome === 'closed');
        }
        // A card summary is not the run: no code, no log.
        assert.ok(!('mission' in (card.summary as object)) || typeof (card.summary as { mission: unknown }).mission === 'string');
        assert.ok(!JSON.stringify(card.summary).includes('duck.walkTo'));
    }
});

test('when a run was published reads as a short phrase', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    assert.equal(ago('2026-10-30T11:59:40Z', now), 'just now');
    assert.equal(ago('2026-10-30T09:00:00Z', now), '3 hours ago');
    assert.equal(ago('2026-10-29T12:00:00Z', now), '1 day ago');
    assert.equal(ago('nope', now), '');
});

test('a card shows the owner\'s photo only from an https address', () => {
    assert.equal(safeAvatar('https://lh3.googleusercontent.com/a/x=s96'), 'https://lh3.googleusercontent.com/a/x=s96');
    assert.equal(safeAvatar('http://example.com/a.png'), undefined);
    assert.equal(safeAvatar('javascript:alert(1)'), undefined);
    assert.equal(safeAvatar('https://u:p@example.com/a.png'), undefined);
    assert.equal(safeAvatar(undefined), undefined);
});

test('a card\'s picture is a thumbnail the site ships or one OpenLance serves, nothing else', () => {
    assert.equal(safeThumb('thumbs/featured-1.jpg'), 'thumbs/featured-1.jpg');
    assert.equal(safeThumb('https://api.openlance.ai/api/v1/public/gallery/abc123/thumb.jpg'), 'https://api.openlance.ai/api/v1/public/gallery/abc123/thumb.jpg');
    assert.equal(safeThumb('https://evil.example/x.jpg'), undefined);
    assert.equal(safeThumb('thumbs/../secret.jpg'), undefined);
    assert.equal(safeThumb('javascript:alert(1)'), undefined);
    assert.equal(safeThumb(undefined), undefined);
});

test('a run\'s length reads like a video\'s', () => {
    assert.equal(formatLength(22.1), '0:22');
    assert.equal(formatLength(65), '1:05');
    assert.equal(formatLength(0), undefined);
    assert.equal(formatLength(undefined), undefined);
});

test('every Featured run has its own thumbnail and length', () => {
    for (const card of featured as GalleryCard[]) {
        assert.equal(safeThumb(card.thumb), `thumbs/${card.id}.jpg`);
        assert.ok((card.summary?.lengthS ?? 0) > 0);
    }
});
