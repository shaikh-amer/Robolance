// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * A room around the pitch and the furniture in it, at real size: a fridge,
 * a table the duck walks under, a desk with a laptop on it. Each piece is
 * one entry (kind, place, optional size and colour); the simulator turns
 * the parts that stand on the floor (legs, a fridge's body, a sofa's base)
 * into solid boxes, and the viewer draws the whole piece. Everything above
 * the duck's head (a table top, a chair seat) is for the eye only: the duck
 * is 26 cm tall and never reaches it.
 */

import type { Obstacle } from './field.js';

export type FloorKind = 'grass' | 'wood' | 'tile' | 'carpet' | 'concrete';

/** The room: what the floor is made of and whether walls close it in along the bounds. */
export interface RoomSpec {
    floor?: FloorKind;
    /** Walls along the pitch's bounds (default true when a room is given). */
    walls?: boolean;
    /** The walls' paint, "#rrggbb". */
    wallColor?: string;
}

export type FurnitureKind = 'table' | 'desk' | 'chair' | 'fridge' | 'shelf' | 'sofa' | 'box';

/** What can stand on a desk or table (drawn only). */
export type FurnitureItem = 'laptop' | 'monitor' | 'lamp' | 'books' | 'mug' | 'plant';

/**
 * One piece of furniture. x, y is the middle of its footprint; heading
 * (degrees, default 0) is the way its front faces: a fridge's door, a
 * chair's seat, a sofa's cushions, a desk's knee space. width runs across
 * the front, depth front to back. Sizes default to the kind's real size.
 */
export interface Furniture {
    kind: FurnitureKind;
    x: number;
    y: number;
    heading?: number;
    width?: number;
    depth?: number;
    height?: number;
    /** The main colour, "#rrggbb" (wood, paint or fabric). */
    color?: string;
    /** Used in notes ("the duck walked into the kitchen table's leg"). */
    name?: string;
    /** Desk or table only: what stands on top. */
    items?: FurnitureItem[];
}

/** Real sizes, metres: width across the front, depth front to back, height. */
export const FURNITURE_SIZES: Record<FurnitureKind, { width: number; depth: number; height: number }> = {
    table: { width: 1.2, depth: 0.75, height: 0.75 },
    desk: { width: 1.2, depth: 0.6, height: 0.75 },
    chair: { width: 0.45, depth: 0.45, height: 0.9 },
    fridge: { width: 0.7, depth: 0.65, height: 1.8 },
    shelf: { width: 0.8, depth: 0.3, height: 1.8 },
    sofa: { width: 1.8, depth: 0.85, height: 0.8 },
    box: { width: 0.4, depth: 0.3, height: 0.3 },
};

export const FURNITURE_KINDS = Object.keys(FURNITURE_SIZES) as FurnitureKind[];
export const FURNITURE_ITEMS: FurnitureItem[] = ['laptop', 'monitor', 'lamp', 'books', 'mug', 'plant'];
export const FLOOR_KINDS: FloorKind[] = ['grass', 'wood', 'tile', 'carpet', 'concrete'];
export const MAX_FURNITURE = 12;

/** Leg and panel sizes, metres. */
export const TABLE_LEG = 0.05;
export const CHAIR_LEG = 0.035;
export const DESK_PANEL = 0.03;
/** A chair's seat height. */
export const CHAIR_SEAT = 0.45;
/** A sofa's seat height: the base that stands on the floor. */
export const SOFA_SEAT = 0.42;

/** The piece's size, its own or the kind's. */
export function furnitureSize(f: Furniture): { width: number; depth: number; height: number } {
    const d = FURNITURE_SIZES[f.kind];
    return { width: f.width ?? d.width, depth: f.depth ?? d.depth, height: f.height ?? d.height };
}

/** The piece's name in notes. */
export function furnitureName(f: Furniture, i: number, all: Furniture[]): string {
    if (f.name?.trim()) {
        return f.name.trim();
    }
    const same = all.filter(o => o.kind === f.kind && !o.name?.trim());
    return same.length > 1 ? `${f.kind} ${same.indexOf(f) + 1}` : `the ${f.kind}`;
}

/**
 * The parts of a piece that stand on the floor, as solid boxes in field
 * coordinates: four legs for a table or chair, two side panels for a desk,
 * the whole body for a fridge, shelf, sofa base or box.
 */
export function furnitureParts(f: Furniture, label = `the ${f.kind}`): Obstacle[] {
    const { width, depth, height } = furnitureSize(f);
    const heading = f.heading ?? 0;
    const h = (heading * Math.PI) / 180;
    // Local x is front-back (towards the front: +x), local y across. A part at
    // (fx, fy) local goes to the field through the heading.
    const at = (fx: number, fy: number, w: number, d: number, ht: number, name: string): Obstacle => ({
        name, x: round(f.x + fx * Math.cos(h) - fy * Math.sin(h)), y: round(f.y + fx * Math.sin(h) + fy * Math.cos(h)),
        width: w, depth: d, height: ht, heading,
    });
    const legs = (leg: number, ht: number): Obstacle[] => {
        const inset = leg / 2 + 0.03;
        const out: Obstacle[] = [];
        for (const fx of [depth / 2 - inset, -(depth / 2 - inset)]) {
            for (const fy of [width / 2 - inset, -(width / 2 - inset)]) {
                out.push(at(fx, fy, leg, leg, ht, `${label}'s leg`));
            }
        }
        return out;
    };
    switch (f.kind) {
        case 'table':
            return legs(TABLE_LEG, height - 0.03);
        case 'chair':
            return legs(CHAIR_LEG, CHAIR_SEAT);
        case 'desk':
            return [1, -1].map(side => at(0, side * (width / 2 - DESK_PANEL / 2), depth, DESK_PANEL, height - 0.03, `${label}'s side`));
        case 'sofa':
            return [at(0, 0, depth, width, SOFA_SEAT, label)];
        default:
            return [at(0, 0, depth, width, height, label)];
    }
}

/** Every piece's floor parts, named for notes. */
export function allFurnitureParts(list: Furniture[] | undefined): Obstacle[] {
    const all = list ?? [];
    return all.flatMap((f, i) => furnitureParts(f, furnitureName(f, i, all)));
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Checks the room and the furniture entries; the parts' places are checked with the obstacles. */
export function validateFurniture(room: RoomSpec | undefined, list: Furniture[] | undefined): string | undefined {
    if (room !== undefined) {
        if (typeof room !== 'object' || room === null) {
            return 'room is an object: { floor, walls, wallColor }';
        }
        if (room.floor !== undefined && !FLOOR_KINDS.includes(room.floor)) {
            return `room.floor is one of ${FLOOR_KINDS.join(', ')}`;
        }
        if (room.walls !== undefined && typeof room.walls !== 'boolean') {
            return 'room.walls is true or false';
        }
        if (room.wallColor !== undefined && !HEX.test(room.wallColor)) {
            return 'room.wallColor is "#rrggbb"';
        }
    }
    if (list === undefined) {
        return undefined;
    }
    if (!Array.isArray(list)) {
        return 'furniture is a list';
    }
    if (list.length > MAX_FURNITURE) {
        return `at most ${MAX_FURNITURE} pieces of furniture`;
    }
    for (const [i, f] of list.entries()) {
        const label = `furniture ${i + 1}${f?.kind ? ` (${f.kind})` : ''}`;
        if (!f || !FURNITURE_KINDS.includes(f.kind)) {
            return `${label}: kind is one of ${FURNITURE_KINDS.join(', ')}`;
        }
        const { width, depth, height } = furnitureSize(f);
        if (![f.x, f.y, f.heading ?? 0, width, depth, height].every(v => typeof v === 'number' && Number.isFinite(v))) {
            return `${label}: every value must be a finite number`;
        }
        if (width < 0.2 || width > 3 || depth < 0.2 || depth > 3) {
            return `${label}: width and depth are 0.2-3 m`;
        }
        if (height < 0.2 || height > 2.5) {
            return `${label}: height is 0.2-2.5 m`;
        }
        if ((f.kind === 'table' || f.kind === 'desk') && height < 0.4) {
            return `${label}: a ${f.kind} is at least 0.4 m high`;
        }
        if (f.kind === 'chair' && height < CHAIR_SEAT + 0.05) {
            return `${label}: a chair is at least ${CHAIR_SEAT + 0.05} m high (the seat is at ${CHAIR_SEAT})`;
        }
        if (f.color !== undefined && !HEX.test(f.color)) {
            return `${label}: color is "#rrggbb"`;
        }
        if (f.name !== undefined && (typeof f.name !== 'string' || f.name.length > 40)) {
            return `${label}: the name is up to 40 characters`;
        }
        if (f.items !== undefined) {
            if (f.kind !== 'desk' && f.kind !== 'table') {
                return `${label}: only a desk or a table has items`;
            }
            if (!Array.isArray(f.items) || f.items.length > 6 || f.items.some(it => !FURNITURE_ITEMS.includes(it))) {
                return `${label}: items is up to 6 of ${FURNITURE_ITEMS.join(', ')}`;
            }
        }
    }
    return undefined;
}

function round(v: number): number {
    return Number(v.toFixed(4));
}
