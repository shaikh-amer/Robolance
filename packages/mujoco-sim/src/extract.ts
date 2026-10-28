// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Builds the browser viewer model from a loaded MuJoCo model: bodies and
 * their joints, the geoms MuJoCo's own viewer shows by default (groups
 * 0-2, not fully transparent), meshes simplified, and each part's
 * surface. Works for any MJCF; nothing here knows what the robot is.
 */

import type { MainModule, MjModel } from '@mujoco/mujoco';
import { decimate } from './decimate.js';
import type { MeshSimplifier, Quat, Vec3, ViewerBody, ViewerGeom, ViewerJoint, ViewerMesh, ViewerModel, ViewerShape } from './viewer.js';

export const OBJ_BODY = 1;
export const OBJ_JOINT = 3;
export const OBJ_GEOM = 5;
export const OBJ_SITE = 6;
export const OBJ_MESH = 10;
export const OBJ_ACTUATOR = 19;
export const OBJ_SENSOR = 20;

const JOINT_TYPES = ['free', 'ball', 'slide', 'hinge'] as const;
const SHAPES: Record<number, ViewerShape['type']> = { 0: 'plane', 2: 'sphere', 3: 'capsule', 4: 'ellipsoid', 5: 'cylinder', 6: 'box' };
const GEOM_MESH = 7;

export interface ExtractOptions {
    /** Reduces each visual mesh (default: vertex clustering on a 3 mm grid). */
    simplify?: MeshSimplifier;
    /** Which geoms to draw (default: groups 0-2 with any opacity, as MuJoCo's viewer shows them). */
    include?: (geom: number, model: MjModel) => boolean;
}

export function defaultInclude(g: number, m: MjModel): boolean {
    const mat = m.geom_matid[g];
    const alpha = mat >= 0 ? m.mat_rgba[4 * mat + 3] : m.geom_rgba[4 * g + 3];
    return m.geom_group[g] <= 2 && alpha > 0;
}

export function round(v: number, digits: number): number {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
}

export function extractViewerModel(mj: MainModule, m: MjModel, options: ExtractOptions = {}): ViewerModel {
    const simplify = options.simplify ?? ((p, i) => decimate(p, i, 0.003));
    const include = options.include ?? defaultInclude;
    const v3 = (arr: ArrayLike<number>, i: number): Vec3 => [arr[3 * i], arr[3 * i + 1], arr[3 * i + 2]].map(x => round(x, 6)) as Vec3;
    const q4 = (arr: ArrayLike<number>, i: number): Quat => [arr[4 * i], arr[4 * i + 1], arr[4 * i + 2], arr[4 * i + 3]].map(x => round(x, 6)) as Quat;
    const bodies: ViewerBody[] = [];
    for (let b = 0; b < m.nbody; b++) {
        const joints: ViewerJoint[] = [];
        for (let k = 0; k < m.body_jntnum[b]; k++) {
            const j = m.body_jntadr[b] + k;
            const type = JOINT_TYPES[m.jnt_type[j]];
            const qpos = m.jnt_qposadr[j];
            const ref = round(m.qpos0[qpos], 6);
            if (type === 'free') {
                joints.push({ type, qpos });
            } else if (type === 'ball') {
                joints.push({ type, qpos, pos: v3(m.jnt_pos, j) });
            } else if (type === 'hinge') {
                joints.push({ type, qpos, axis: v3(m.jnt_axis, j), pos: v3(m.jnt_pos, j), ...(ref ? { ref } : {}) });
            } else {
                joints.push({ type, qpos, axis: v3(m.jnt_axis, j), ...(ref ? { ref } : {}) });
            }
        }
        bodies.push({
            name: mj.mj_id2name(m, OBJ_BODY, b) ?? `body${b}`,
            parent: m.body_parentid[b],
            pos: v3(m.body_pos, b),
            quat: q4(m.body_quat, b),
            joint: joints[0] ?? null,
            ...(joints.length > 1 ? { joints } : {}),
        });
    }
    const geoms: ViewerGeom[] = [];
    const meshes: ViewerMesh[] = [];
    const meshIndex = new Map<number, number>();
    for (let g = 0; g < m.ngeom; g++) {
        const type = m.geom_type[g];
        if (!include(g, m) || (type !== GEOM_MESH && !(type in SHAPES))) {
            continue;
        }
        let mesh = -1;
        let shape: ViewerShape | undefined;
        if (type === GEOM_MESH) {
            const id = m.geom_dataid[g];
            let index = meshIndex.get(id);
            if (index === undefined) {
                const va = m.mesh_vertadr[id];
                const fa = m.mesh_faceadr[id];
                const small = simplify(
                    Float32Array.from(m.mesh_vert.subarray(3 * va, 3 * (va + m.mesh_vertnum[id]))),
                    Uint32Array.from(m.mesh_face.subarray(3 * fa, 3 * (fa + m.mesh_facenum[id]))),
                );
                const wide = small.positions.length / 3 > 65535;
                index = meshes.length;
                meshIndex.set(id, index);
                meshes.push({
                    name: mj.mj_id2name(m, OBJ_MESH, id) ?? `mesh${id}`,
                    positions: base64(new Uint8Array(small.positions.buffer, small.positions.byteOffset, small.positions.byteLength)),
                    indices: base64(bytesOf(wide ? small.indices : Uint16Array.from(small.indices))),
                    indexType: wide ? 'u32' : 'u16',
                });
            }
            mesh = index;
        } else {
            shape = { type: SHAPES[type], size: v3(m.geom_size, g) };
        }
        const mat = m.geom_matid[g];
        const rgbaSource: ArrayLike<number> = mat >= 0 ? m.mat_rgba.subarray(4 * mat, 4 * mat + 4) : m.geom_rgba.subarray(4 * g, 4 * g + 4);
        const rgba = Array.from(rgbaSource, x => round(x, 3)) as ViewerGeom['rgba'];
        const surface = mat >= 0
            ? { specular: round(m.mat_specular[mat], 3), shininess: round(m.mat_shininess[mat], 3), reflectance: round(m.mat_reflectance[mat], 3) }
            : undefined;
        const name = mj.mj_id2name(m, OBJ_GEOM, g);
        geoms.push({
            body: m.geom_bodyid[g],
            mesh,
            ...(shape ? { shape } : {}),
            ...(name ? { name } : {}),
            pos: v3(m.geom_pos, g),
            quat: q4(m.geom_quat, g),
            rgba,
            ...(surface ? { surface } : {}),
        });
    }
    return { version: 1, nq: m.nq, bodies, geoms, meshes };
}

function bytesOf(a: Uint16Array | Uint32Array): Uint8Array {
    return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

/** Base64 without Node's Buffer, so the module also runs in a browser worker. */
export function base64(bytes: Uint8Array): string {
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        out += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(out);
}
