// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Normals for CAD meshes: smooth across gentle curves, hard across real
 * edges. Averaging every face around a shared vertex (plain vertex
 * normals) smears light across a part's sharp edges and leaves dark
 * blotches on its faces; here a corner only takes faces that meet within
 * `creaseAngle` of its own face, so each triangle corner gets its own
 * normal. Returns unindexed positions and normals (three per triangle).
 */
export function creasedNormals(
    positions: ArrayLike<number>,
    indices: ArrayLike<number>,
    creaseAngle = (35 * Math.PI) / 180,
): { positions: Float32Array; normals: Float32Array } {
    const triCount = Math.floor(indices.length / 3);
    const faceNormals = new Float32Array(triCount * 3);
    const faceAreas = new Float32Array(triCount);
    for (let t = 0; t < triCount; t++) {
        const a = indices[3 * t];
        const b = indices[3 * t + 1];
        const c = indices[3 * t + 2];
        const ux = positions[3 * b] - positions[3 * a];
        const uy = positions[3 * b + 1] - positions[3 * a + 1];
        const uz = positions[3 * b + 2] - positions[3 * a + 2];
        const vx = positions[3 * c] - positions[3 * a];
        const vy = positions[3 * c + 1] - positions[3 * a + 1];
        const vz = positions[3 * c + 2] - positions[3 * a + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        faceAreas[t] = len / 2;
        if (len > 0) {
            faceNormals[3 * t] = nx / len;
            faceNormals[3 * t + 1] = ny / len;
            faceNormals[3 * t + 2] = nz / len;
        }
    }
    // Faces around each vertex.
    const vertexCount = positions.length / 3;
    const start = new Uint32Array(vertexCount + 1);
    for (let i = 0; i < triCount * 3; i++) {
        start[indices[i] + 1]++;
    }
    for (let v = 0; v < vertexCount; v++) {
        start[v + 1] += start[v];
    }
    const fill = start.slice(0, vertexCount);
    const around = new Uint32Array(triCount * 3);
    for (let t = 0; t < triCount; t++) {
        for (let k = 0; k < 3; k++) {
            around[fill[indices[3 * t + k]]++] = t;
        }
    }

    const cos = Math.cos(creaseAngle);
    const outPos = new Float32Array(triCount * 9);
    const outNrm = new Float32Array(triCount * 9);
    for (let t = 0; t < triCount; t++) {
        for (let k = 0; k < 3; k++) {
            const v = indices[3 * t + k];
            let nx = 0;
            let ny = 0;
            let nz = 0;
            for (let j = start[v]; j < start[v + 1]; j++) {
                const f = around[j];
                const dot = faceNormals[3 * f] * faceNormals[3 * t] + faceNormals[3 * f + 1] * faceNormals[3 * t + 1] + faceNormals[3 * f + 2] * faceNormals[3 * t + 2];
                if (f === t || dot >= cos) {
                    // Weighted by area, so slivers from CAD tessellation do not tip the normal.
                    nx += faceNormals[3 * f] * faceAreas[f];
                    ny += faceNormals[3 * f + 1] * faceAreas[f];
                    nz += faceNormals[3 * f + 2] * faceAreas[f];
                }
            }
            const len = Math.hypot(nx, ny, nz) || 1;
            const o = 9 * t + 3 * k;
            outPos[o] = positions[3 * v];
            outPos[o + 1] = positions[3 * v + 1];
            outPos[o + 2] = positions[3 * v + 2];
            outNrm[o] = nx / len;
            outNrm[o + 1] = ny / len;
            outNrm[o + 2] = nz / len;
        }
    }
    return { positions: outPos, normals: outNrm };
}
