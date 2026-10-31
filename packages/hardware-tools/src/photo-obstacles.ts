// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Obstacles for the duck's pitch from a photo: the boxes Segment Anything
 * (SAM 3.1) found in it, mapped onto the floor the photo shows.
 *
 * The photo is taken as a top-down view of a floor rectangle given in pitch
 * metres: the image's top edge is the far side (xMax), its bottom edge the
 * near side (xMin), its left edge the duck's left (yMax) and its right edge
 * yMin. A photo taken at an angle stretches things towards the far side;
 * the result is a footprint good enough to plan around, not a measurement.
 *
 * When what was found is a kind of furniture the pitch knows (a chair, a
 * table, a fridge...), each match becomes that piece at its footprint, at
 * the kind's real height, instead of a plain box: a table the duck walks
 * under rather than a block it walks round.
 */

import { FURNITURE_SIZES, MAX_FURNITURE, MAX_OBSTACLES, type Furniture, type FurnitureKind, type Obstacle } from 'robolance-duck-sim';

/** What openlance_segmentImage saves: the image size and every match's pixel box. */
export interface SegmentsFile {
    prompt?: string;
    width: number;
    height: number;
    objects: Array<{ id?: string; box: { x1: number; y1: number; x2: number; y2: number }; confidence?: number }>;
}

export interface FloorArea {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
}

export interface PhotoObstacleOptions {
    /** Box height, metres (default 0.25). */
    height?: number;
    /** Names are "<name> 1", "<name> 2"... (default: the prompt SAM was given). */
    name?: string;
    /** Matches below this confidence are left out (default 0.3). */
    minConfidence?: number;
    /** Footprints smaller than this on either side are left out, metres (default 0.03). */
    minSize?: number;
    /** Plain boxes even when the name is a kind of furniture (default false). */
    boxesOnly?: boolean;
}

/**
 * Words a segmentation prompt uses for each kind of furniture the pitch
 * knows. Boxes stay plain obstacles: the photo already gives their size.
 */
const FURNITURE_WORDS: Array<[RegExp, FurnitureKind]> = [
    [/\b(fridge|refrigerator|freezer)\b/, 'fridge'],
    [/\b(sofa|couch|settee)\b/, 'sofa'],
    [/\b(book ?shelf|book ?case|shelf|shelves|shelving)\b/, 'shelf'],
    [/\b(desk|workstation)\b/, 'desk'],
    [/\b(chair|stool|seat)\b/, 'chair'],
    [/\b(table)\b/, 'table'],
];

/** The furniture kind a name means ("dining table" -> table), if any. */
export function furnitureKindOf(name: string): FurnitureKind | undefined {
    const n = name.toLowerCase();
    return FURNITURE_WORDS.find(([re]) => re.test(n))?.[1];
}

export interface PhotoObstacles {
    obstacles: Obstacle[];
    /** Matches that are a kind of furniture, as furniture for field.furniture. */
    furniture: Furniture[];
    /** Why matches were left out, for the agent. */
    skipped: string[];
}

export function obstaclesFromSegments(seg: SegmentsFile, area: FloorArea, options: PhotoObstacleOptions = {}): PhotoObstacles {
    if (!(seg.width > 0) || !(seg.height > 0) || !Array.isArray(seg.objects)) {
        throw new Error('the segments file has no image size or objects; run openlance_segmentImage on the photo first');
    }
    const spanX = area.xMax - area.xMin;
    const spanY = area.yMax - area.yMin;
    if (!(spanX > 0) || !(spanY > 0) || spanX > 10 || spanY > 10) {
        throw new Error('the floor area needs xMax > xMin and yMax > yMin, at most 10 m on a side');
    }
    const height = clamp(options.height ?? 0.25, 0.02, 2);
    const minConfidence = options.minConfidence ?? 0.3;
    const minSize = options.minSize ?? 0.03;
    const base = (options.name ?? seg.prompt ?? 'obstacle').trim().slice(0, 30) || 'obstacle';
    const kind = options.boxesOnly ? undefined : furnitureKindOf(base);
    const obstacles: Obstacle[] = [];
    const furniture: Furniture[] = [];
    const skipped: string[] = [];
    for (const o of seg.objects) {
        const label = `match ${o.id ?? obstacles.length + skipped.length}`;
        if (typeof o.confidence === 'number' && o.confidence < minConfidence) {
            skipped.push(`${label}: confidence ${o.confidence.toFixed(2)} is below ${minConfidence}`);
            continue;
        }
        const u1 = o.box.x1 / seg.width;
        const u2 = (o.box.x2 + 1) / seg.width;
        const v1 = o.box.y1 / seg.height;
        const v2 = (o.box.y2 + 1) / seg.height;
        const width = (v2 - v1) * spanX;
        const depth = (u2 - u1) * spanY;
        if (width < minSize || depth < minSize) {
            skipped.push(`${label}: ${cm(width)} × ${cm(depth)} cm is too small to matter`);
            continue;
        }
        const x = round(area.xMax - ((v1 + v2) / 2) * spanX);
        const y = round(area.yMax - ((u1 + u2) / 2) * spanY);
        if (kind) {
            if (furniture.length >= MAX_FURNITURE) {
                skipped.push(`${label}: the pitch takes at most ${MAX_FURNITURE} pieces of furniture`);
                continue;
            }
            // Facing the near side (the duck's start, -x): its front-back runs along x, its width across.
            furniture.push({
                kind, name: `${base} ${furniture.length + 1}`, x, y, heading: 180,
                width: round(clamp(depth, 0.2, 3)), depth: round(clamp(width, 0.2, 3)),
                height: FURNITURE_SIZES[kind].height,
            });
            continue;
        }
        if (obstacles.length >= MAX_OBSTACLES) {
            skipped.push(`${label}: the pitch takes at most ${MAX_OBSTACLES} obstacles`);
            continue;
        }
        obstacles.push({
            name: `${base} ${obstacles.length + 1}`,
            x,
            y,
            width: round(clamp(width, 0.02, 3)),
            depth: round(clamp(depth, 0.02, 3)),
            height: round(height),
        });
    }
    return { obstacles, furniture, skipped };
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}

function round(v: number): number {
    return Math.round(v * 1000) / 1000;
}

function cm(m: number): number {
    return Math.round(m * 100);
}
