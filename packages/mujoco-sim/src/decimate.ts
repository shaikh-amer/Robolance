// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Vertex clustering: snaps vertices to a grid of `cell` metres, merges
 * those that land in the same cell (at their average), and drops the
 * triangles that collapse. Crude, but it keeps a part's silhouette and
 * cuts CAD meshes by an order of magnitude, which is what a replay needs.
 */
export function decimate(positions: ArrayLike<number>, indices: ArrayLike<number>, cell: number): { positions: Float32Array; indices: Uint32Array } {
    const key = (i: number) =>
        `${Math.floor(positions[3 * i] / cell)},${Math.floor(positions[3 * i + 1] / cell)},${Math.floor(positions[3 * i + 2] / cell)}`;
    const clusterOf = new Map<string, number>();
    const sums: number[] = [];
    const counts: number[] = [];
    const remap = new Uint32Array(positions.length / 3);
    for (let i = 0; i < remap.length; i++) {
        const k = key(i);
        let c = clusterOf.get(k);
        if (c === undefined) {
            c = counts.length;
            clusterOf.set(k, c);
            sums.push(0, 0, 0);
            counts.push(0);
        }
        sums[3 * c] += positions[3 * i];
        sums[3 * c + 1] += positions[3 * i + 1];
        sums[3 * c + 2] += positions[3 * i + 2];
        counts[c]++;
        remap[i] = c;
    }
    const seen = new Set<string>();
    const tris: number[] = [];
    for (let t = 0; t + 2 < indices.length; t += 3) {
        const a = remap[indices[t]];
        const b = remap[indices[t + 1]];
        const c = remap[indices[t + 2]];
        if (a === b || b === c || a === c) {
            continue;
        }
        // The same triangle can come out of several originals; keep one per winding.
        const lo = Math.min(a, b, c);
        const id = lo === a ? `${a},${b},${c}` : lo === b ? `${b},${c},${a}` : `${c},${a},${b}`;
        if (!seen.has(id)) {
            seen.add(id);
            tris.push(a, b, c);
        }
    }
    // Keep only clusters a triangle uses, renumbered densely.
    const used = new Int32Array(counts.length).fill(-1);
    const out: number[] = [];
    const outIdx = new Uint32Array(tris.length);
    for (let i = 0; i < tris.length; i++) {
        const c = tris[i];
        if (used[c] < 0) {
            used[c] = out.length / 3;
            out.push(sums[3 * c] / counts[c], sums[3 * c + 1] / counts[c], sums[3 * c + 2] / counts[c]);
        }
        outIdx[i] = used[c];
    }
    return { positions: Float32Array.from(out), indices: outIdx };
}
