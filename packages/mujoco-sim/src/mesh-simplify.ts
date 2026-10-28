// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Shape-preserving mesh reduction for the viewer model (meshoptimizer's
 * quadric simplifier): collapses edges only while the surface moves less
 * than `maxErrorM` metres, so curved shells stay smooth and edges stay
 * sharp, where vertex clustering leaves a speckled surface. Used when the
 * viewer model is exported, not at run time.
 */

import { MeshoptSimplifier } from 'meshoptimizer';
import type { MeshSimplifier } from './viewer.js';

export async function meshoptSimplifier(maxErrorM = 0.0002): Promise<MeshSimplifier> {
    await MeshoptSimplifier.ready;
    return (positions, indices) => {
        const extent = meshExtent(positions);
        if (extent === 0 || indices.length === 0) {
            return { positions: new Float32Array(), indices: new Uint32Array() };
        }
        // The simplifier's error is relative to the mesh's size; open CAD edges stay where they are.
        const [kept] = MeshoptSimplifier.simplify(indices, positions, 3, 0, maxErrorM / extent, ['LockBorder']);
        return compact(positions, kept);
    };
}

/** Largest side of the mesh's bounding box. */
export function meshExtent(positions: ArrayLike<number>): number {
    let extent = 0;
    for (let k = 0; k < 3; k++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = k; i < positions.length; i += 3) {
            lo = Math.min(lo, positions[i]);
            hi = Math.max(hi, positions[i]);
        }
        if (hi > lo) {
            extent = Math.max(extent, hi - lo);
        }
    }
    return extent;
}

/** Keeps only the vertices the triangles use, renumbered in first-use order. */
export function compact(positions: ArrayLike<number>, indices: ArrayLike<number>): { positions: Float32Array; indices: Uint32Array } {
    const remap = new Map<number, number>();
    const out: number[] = [];
    const outIdx = new Uint32Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
        const v = indices[i];
        let n = remap.get(v);
        if (n === undefined) {
            n = remap.size;
            remap.set(v, n);
            out.push(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]);
        }
        outIdx[i] = n;
    }
    return { positions: Float32Array.from(out), indices: outIdx };
}
