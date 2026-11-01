// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Makes a robot's meshes lighter for a shared link: meshoptimizer's
 * shape-preserving simplifier collapses edges only while the surface moves
 * less than the given error, so a humanoid keeps its silhouette at a
 * fraction of the triangles (a Unitree G1 goes from about 1.3 MB to under
 * 300 KB compressed at 1 mm).
 */

import { MeshoptSimplifier } from 'meshoptimizer';
import { decodeMesh, type ViewerMesh, type ViewerModel } from 'robolance-duck-sim/viewer';
import type { ModelShrinker } from './scene-share';

function base64(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
}

function extent(p: Float32Array): number {
    let e = 0;
    for (let k = 0; k < 3; k++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = k; i < p.length; i += 3) {
            lo = Math.min(lo, p[i]);
            hi = Math.max(hi, p[i]);
        }
        if (hi > lo) {
            e = Math.max(e, hi - lo);
        }
    }
    return e;
}

/** One mesh simplified to `maxErrorM`, unused vertices dropped. */
export function shrinkMesh(mesh: ViewerMesh, maxErrorM: number): ViewerMesh {
    const { positions, indices } = decodeMesh(mesh);
    const size = extent(positions);
    if (size === 0 || indices.length < 3) {
        return mesh;
    }
    const kept = MeshoptSimplifier.simplify(Uint32Array.from(indices), positions, 3, 0, maxErrorM / size, ['LockBorder'])[0];
    if (kept.length >= indices.length) {
        return mesh;
    }
    const remap = new Map<number, number>();
    const outPos: number[] = [];
    const outIdx = new Uint32Array(kept.length);
    for (let i = 0; i < kept.length; i++) {
        const v = kept[i];
        let n = remap.get(v);
        if (n === undefined) {
            n = remap.size;
            remap.set(v, n);
            outPos.push(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]);
        }
        outIdx[i] = n;
    }
    const wide = remap.size > 65535;
    const idx = wide ? outIdx : Uint16Array.from(outIdx);
    const pos = Float32Array.from(outPos);
    return {
        name: mesh.name,
        positions: base64(new Uint8Array(pos.buffer)),
        indices: base64(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength)),
        indexType: wide ? 'u32' : 'u16',
    };
}

export const meshoptShrinker: ModelShrinker = async (model: ViewerModel, maxErrorM: number) => {
    await MeshoptSimplifier.ready;
    return { ...model, meshes: model.meshes.map(m => shrinkMesh(m, maxErrorM)) };
};
