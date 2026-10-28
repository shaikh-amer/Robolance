// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * What a viewer needs to draw any MuJoCo model without MuJoCo: the body
 * tree with its joints, the visual geoms (meshes simplified, primitives
 * by shape and size) and each part's surface, plus forward kinematics
 * from a replay frame (qpos) to every body's world pose. Browser-safe:
 * no Node or MuJoCo imports.
 */

export type Vec3 = [number, number, number];
/** Unit quaternion, w first (MuJoCo's order). */
export type Quat = [number, number, number, number];

/** How a joint moves its body. Hinge and slide positions are measured from `ref` (MuJoCo's qpos0). */
export type ViewerJoint =
    | { type: 'free'; qpos: number }
    | { type: 'ball'; qpos: number; pos: Vec3 }
    | { type: 'hinge'; qpos: number; axis: Vec3; pos: Vec3; ref?: number }
    | { type: 'slide'; qpos: number; axis: Vec3; ref?: number };

export interface ViewerBody {
    name: string;
    /** Index of the parent body; the world (0) is its own parent. */
    parent: number;
    /** Pose in the parent's frame. */
    pos: Vec3;
    quat: Quat;
    /** The joint that moves this body (the first, when there are several). */
    joint: ViewerJoint | null;
    /** All of the body's joints in order, when it has more than one. */
    joints?: ViewerJoint[];
}

/** A MuJoCo primitive, sized as MuJoCo sizes it (half-extents, radius, half-length...). */
export interface ViewerShape {
    type: 'plane' | 'sphere' | 'capsule' | 'ellipsoid' | 'cylinder' | 'box';
    size: Vec3;
}

export interface ViewerGeom {
    body: number;
    /** Index into `meshes`, or -1 for a primitive (see `shape`). */
    mesh: number;
    shape?: ViewerShape;
    /** The geom's name in the model, when it has one. */
    name?: string;
    /** Pose in the body's frame. */
    pos: Vec3;
    quat: Quat;
    rgba: [number, number, number, number];
    /** The part's surface from its MuJoCo material (0-1 each), when it has one. */
    surface?: { specular: number; shininess: number; reflectance: number };
}

/** Reduces one visual mesh for the browser: xyz positions and triangle indices in, the same out. */
export type MeshSimplifier = (positions: Float32Array, indices: Uint32Array) => { positions: Float32Array; indices: Uint32Array };

/** Physically based material settings for a part, from its colour and MuJoCo surface. */
export interface PartSurface {
    roughness: number;
    metalness: number;
    /** A thin glossy coat (0-1), as on moulded plastic. */
    clearcoat: number;
}

/**
 * Maps MuJoCo's Phong-style material (specular, shininess, reflectance)
 * to physically based settings. With MuJoCo's defaults (0.5, 0.5, 0)
 * a part reads as satin moulded plastic; shinier materials get less
 * roughness and more coat, reflective ones turn metallic.
 */
export function partSurface(geom: Pick<ViewerGeom, 'surface'>): PartSurface {
    const s = geom.surface ?? { specular: 0.5, shininess: 0.5, reflectance: 0 };
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    return {
        roughness: clamp(0.85 - 0.75 * s.shininess, 0.15, 0.9),
        metalness: clamp(s.reflectance, 0, 1),
        clearcoat: clamp(s.specular * 0.6, 0, 1),
    };
}

export interface ViewerMesh {
    name: string;
    /** Float32 xyz triples, base64. */
    positions: string;
    /** Uint16 (or Uint32 when there are more than 65 535 vertices) triangle indices, base64. */
    indices: string;
    indexType: 'u16' | 'u32';
}

export interface ViewerModel {
    version: 1;
    /** qpos values per replay frame. */
    nq: number;
    bodies: ViewerBody[];
    geoms: ViewerGeom[];
    meshes: ViewerMesh[];
}

export interface BodyPose {
    pos: Vec3;
    quat: Quat;
}

export function quatMul(a: Quat, b: Quat): Quat {
    return [
        a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
        a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
        a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
        a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ];
}

export function rotate(q: Quat, v: Vec3): Vec3 {
    // v' = q v q*, expanded.
    const [w, x, y, z] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [
        v[0] + w * tx + (y * tz - z * ty),
        v[1] + w * ty + (z * tx - x * tz),
        v[2] + w * tz + (x * ty - y * tx),
    ];
}

function normalize(q: Quat): Quat {
    const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/**
 * Every body's world pose for one replay frame, the way MuJoCo computes
 * it: parent pose, then the body's offset, then its joints in order.
 * Bodies are listed parents first, so one pass is enough.
 */
export function bodyPoses(model: ViewerModel, qpos: ArrayLike<number>): BodyPose[] {
    const poses: BodyPose[] = [];
    for (let i = 0; i < model.bodies.length; i++) {
        const b = model.bodies[i];
        if (i === 0) {
            poses.push({ pos: [0, 0, 0], quat: [1, 0, 0, 0] });
            continue;
        }
        const parent = poses[b.parent];
        const offset = rotate(parent.quat, b.pos);
        let pos: Vec3 = [parent.pos[0] + offset[0], parent.pos[1] + offset[1], parent.pos[2] + offset[2]];
        let quat = quatMul(parent.quat, b.quat);
        for (const j of b.joints ?? (b.joint ? [b.joint] : [])) {
            const a = j.qpos;
            if (j.type === 'free') {
                pos = [qpos[a], qpos[a + 1], qpos[a + 2]];
                quat = normalize([qpos[a + 3], qpos[a + 4], qpos[a + 5], qpos[a + 6]]);
            } else if (j.type === 'slide') {
                const d = qpos[a] - (j.ref ?? 0);
                const step = rotate(quat, [j.axis[0] * d, j.axis[1] * d, j.axis[2] * d]);
                pos = [pos[0] + step[0], pos[1] + step[1], pos[2] + step[2]];
            } else {
                let local: Quat;
                if (j.type === 'hinge') {
                    const angle = qpos[a] - (j.ref ?? 0);
                    const s = Math.sin(angle / 2);
                    local = [Math.cos(angle / 2), j.axis[0] * s, j.axis[1] * s, j.axis[2] * s];
                } else {
                    local = [qpos[a], qpos[a + 1], qpos[a + 2], qpos[a + 3]];
                }
                const turned = normalize(quatMul(quat, local));
                // Rotate about the joint's anchor, not the body origin.
                const before = rotate(quat, j.pos);
                const after = rotate(turned, j.pos);
                pos = [pos[0] + before[0] - after[0], pos[1] + before[1] - after[1], pos[2] + before[2] - after[2]];
                quat = turned;
            }
        }
        poses.push({ pos, quat });
    }
    return poses;
}

/** A geom's world pose from its body's. */
export function geomPose(body: BodyPose, geom: ViewerGeom): BodyPose {
    const offset = rotate(body.quat, geom.pos);
    return {
        pos: [body.pos[0] + offset[0], body.pos[1] + offset[1], body.pos[2] + offset[2]],
        quat: quatMul(body.quat, geom.quat),
    };
}

/** Decodes a mesh's base64 buffers. */
export function decodeMesh(mesh: ViewerMesh): { positions: Float32Array; indices: Uint16Array | Uint32Array } {
    const bytes = (b64: string) => {
        const raw = atob(b64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            out[i] = raw.charCodeAt(i);
        }
        return out.buffer;
    };
    return {
        positions: new Float32Array(bytes(mesh.positions)),
        indices: mesh.indexType === 'u16' ? new Uint16Array(bytes(mesh.indices)) : new Uint32Array(bytes(mesh.indices)),
    };
}
