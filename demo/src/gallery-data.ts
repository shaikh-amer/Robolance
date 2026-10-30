// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The runs gallery's data: published runs from OpenLance (newest or best
 * first), the Featured runs recorded with the site, and what a card draws
 * from a run's summary. Pure functions; gallery.tsx wires them to the page.
 */

import type { DuckGallerySummary, DuckMission } from 'robolance-openlance-hardware/lib/browser/gallery';
import { REPLAY_PAGE_URL, SHORT_SHARE_PARAM } from 'robolance-openlance-hardware/lib/browser/share-run';

export const GALLERY_API = 'https://api.openlance.ai/api/v1/public/gallery';
export const PAGE_SIZE = 24;

export interface GalleryCard {
    id: string;
    title: string;
    author?: string;
    /** The owner's photo, when they chose to show it (https). */
    avatar?: string;
    summary?: DuckGallerySummary;
    score: number;
    featured?: boolean;
    publishedAt: string;
    /** Featured runs recorded with the site carry their own replay link. */
    href?: string;
    /** A close-up picture of the run (16:9): a file of the site, or an OpenLance URL. */
    thumb?: string;
}

export interface GalleryPage {
    featured: GalleryCard[];
    runs: GalleryCard[];
}

export type GallerySort = 'new' | 'best';
export type MissionFilter = DuckMission | 'all';

/** Where a card opens: its own link, or the short link of a published share. */
export function cardHref(card: GalleryCard, replay: string = REPLAY_PAGE_URL): string {
    return card.href ?? `${replay}?${SHORT_SHARE_PARAM}=${encodeURIComponent(card.id)}`;
}

/** One page of published Microduck runs. Throws with a readable message. */
export async function fetchGallery(sort: GallerySort, offset: number, fetchImpl: typeof fetch = fetch, api: string = GALLERY_API): Promise<GalleryPage> {
    const query = new URLSearchParams({ kind: 'duck', sort, limit: String(PAGE_SIZE), offset: String(offset) });
    let response: Response;
    try {
        response = await fetchImpl(`${api}?${query.toString()}`);
    } catch {
        throw new Error('Could not reach OpenLance to list the runs. The featured runs still play.');
    }
    if (!response.ok) {
        throw new Error(`Could not list the runs (${response.status}). The featured runs still play.`);
    }
    const body = await response.json() as Partial<GalleryPage>;
    return { featured: validCards(body.featured), runs: validCards(body.runs) };
}

function validCards(value: unknown): GalleryCard[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((c): c is GalleryCard =>
        !!c && typeof c === 'object' && typeof (c as GalleryCard).id === 'string' && typeof (c as GalleryCard).title === 'string');
}

/** The site's featured runs first, then the server's, without repeats. */
export function mergeFeatured(local: GalleryCard[], server: GalleryCard[]): GalleryCard[] {
    const seen = new Set(local.map(c => c.id));
    return [...local, ...server.filter(c => !seen.has(c.id))];
}

/** The cards for a mission filter (all, goal, obstacles, laptop). */
export function filterCards(cards: GalleryCard[], mission: MissionFilter): GalleryCard[] {
    return mission === 'all' ? cards : cards.filter(c => c.summary?.mission === mission);
}

export interface PitchDrawing {
    width: number;
    height: number;
    /** SVG path of the duck's walk. */
    walk: string;
    start?: [number, number];
    ball: [number, number];
    goal: { x: number; y1: number; y2: number };
    boxes: Array<{ x: number; y: number; w: number; h: number; rotate: number }>;
}

/**
 * The pitch from above in an SVG of `width` × height: x to the right, y up
 * (flipped for SVG), the playing area fitted with a small margin.
 */
export function pitchDrawing(summary: DuckGallerySummary, width = 240): PitchDrawing {
    const b = summary.field.bounds;
    const spanX = b.xMax - b.xMin;
    const spanY = b.yMax - b.yMin;
    const scale = width / spanX;
    const height = Math.round(spanY * scale);
    const px = (x: number): number => round((x - b.xMin) * scale);
    const py = (y: number): number => round((b.yMax - y) * scale);
    const walk = summary.path.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${px(x)} ${py(y)}`).join(' ');
    const g = summary.field.goal;
    const boxes = (summary.field.obstacles ?? []).map(o => ({
        x: px(o.x), y: py(o.y), w: round(o.width * scale), h: round(o.depth * scale), rotate: -(o.heading ?? 0),
    }));
    const l = summary.field.laptop;
    if (l) {
        // 32 × 22 cm, the hinge across the heading.
        boxes.push({ x: px(l.x), y: py(l.y), w: round(0.22 * scale), h: round(0.32 * scale), rotate: -l.heading });
    }
    return {
        width,
        height,
        walk,
        start: summary.path[0] ? [px(summary.path[0][0]), py(summary.path[0][1])] : undefined,
        ball: [px(summary.field.ball.x), py(summary.field.ball.y)],
        goal: { x: px(g.x), y1: py(g.y + g.width / 2), y2: py(g.y - g.width / 2) },
        boxes,
    };
}

const round = (v: number): number => Math.round(v * 10) / 10;

/** A photo URL the page may show: https only, else none. */
export function safeAvatar(url: string | undefined): string | undefined {
    if (!url) {
        return undefined;
    }
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : undefined;
    } catch {
        return undefined;
    }
}

/**
 * A card's picture, or undefined to draw the pitch instead: a thumbnail
 * that ships with the site, or one OpenLance serves.
 */
export function safeThumb(url: string | undefined, api: string = GALLERY_API): string | undefined {
    if (!url) {
        return undefined;
    }
    if (/^thumbs\/[a-z0-9-]{1,64}\.jpg$/.test(url)) {
        return url;
    }
    try {
        // OpenLance lists its pictures as paths on its API.
        const u = url.startsWith('/api/v1/public/gallery/') ? new URL(url, api) : new URL(url);
        return u.origin === new URL(api).origin && !u.username && !u.password ? u.toString() : undefined;
    } catch {
        return undefined;
    }
}

/** A run's length as a video's: "0:21", "1:05". */
export function formatLength(seconds: number | undefined): string | undefined {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
        return undefined;
    }
    const s = Math.round(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "3 days ago", "just now": when a run was published. */
export function ago(iso: string, now: number = Date.now()): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) {
        return '';
    }
    const s = Math.max(0, Math.round((now - t) / 1000));
    const units: Array<[number, string]> = [[86400 * 30, 'month'], [86400 * 7, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [size, name] of units) {
        if (s >= size) {
            const n = Math.floor(s / size);
            return `${n} ${name}${n === 1 ? '' : 's'} ago`;
        }
    }
    return 'just now';
}
