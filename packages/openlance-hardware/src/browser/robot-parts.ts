// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Any robot's parts as three.js meshes, built from a viewer model: CAD
 * meshes with creased normals, MuJoCo primitives at their sizes, each
 * with a physical material from its MuJoCo surface. `pose(frame)` places
 * every part for a replay frame and returns the body poses.
 */

import * as THREE from 'three';
import { bodyPoses, decodeMesh, geomPose, partSurface, type BodyPose, type ViewerGeom, type ViewerModel } from 'robolance-duck-sim/viewer';
import { creasedNormals } from './crease';

export interface RobotPartsOptions {
    /** Which geoms to draw (default all). Ground planes are usually drawn by the stage. */
    include?: (geom: ViewerGeom) => boolean;
    /** Parts the viewer can swing on a hinge of its own (the duck's beak), by name. */
    hinges?: Record<string, PartHinge>;
}

/**
 * A hinge the viewer adds to a body: the named meshes of `body` turn
 * together by an angle about `axis` through `pivot`, both in the body's
 * frame. It is a drawing device, not physics: the replay's poses are
 * unchanged and the rest of the body stays where the record puts it.
 */
export interface PartHinge {
    body: number;
    meshes: string[];
    pivot: [number, number, number];
    axis: [number, number, number];
}

export class RobotParts {
    readonly group = new THREE.Group();
    private readonly parts: Array<{ mesh: THREE.Mesh; geom: ViewerGeom }> = [];
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly materials = new Map<string, THREE.MeshPhysicalMaterial>();
    /** Each material's model colour, kept so paint() can be undone. */
    private readonly baseColors = new Map<THREE.MeshPhysicalMaterial, THREE.Color>();
    private readonly hinges = new Map<string, { hinge: PartHinge; angle: number; geoms: Set<ViewerGeom> }>();
    private readonly hingeOf = new Map<ViewerGeom, string>();

    constructor(readonly model: ViewerModel, options: RobotPartsOptions = {}) {
        const meshGeometries = model.meshes.map(mesh => {
            const { positions, indices } = decodeMesh(mesh);
            // Hard edges where the CAD part has them, smooth shells elsewhere.
            const shaded = creasedNormals(positions, indices);
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(shaded.positions, 3));
            g.setAttribute('normal', new THREE.BufferAttribute(shaded.normals, 3));
            this.geometries.push(g);
            return g;
        });
        for (const [name, hinge] of Object.entries(options.hinges ?? {})) {
            this.hinges.set(name, { hinge, angle: 0, geoms: new Set() });
        }
        for (const geom of model.geoms) {
            if (options.include && !options.include(geom)) {
                continue;
            }
            for (const [name, h] of this.hinges) {
                if (geom.body === h.hinge.body && geom.mesh >= 0 && h.hinge.meshes.includes(model.meshes[geom.mesh].name)) {
                    h.geoms.add(geom);
                    this.hingeOf.set(geom, name);
                }
            }
            const geometry = geom.mesh >= 0 ? meshGeometries[geom.mesh] : this.primitive(geom);
            if (!geometry) {
                continue;
            }
            const mesh = new THREE.Mesh(geometry, this.material(geom));
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.parts.push({ mesh, geom });
            this.group.add(mesh);
        }
    }

    /** Places every part for a replay frame; undefined when the frame is too short to pose this model. */
    pose(frame: ArrayLike<number> | undefined): BodyPose[] | undefined {
        if (!frame || frame.length < this.model.nq) {
            this.group.visible = false;
            return undefined;
        }
        this.group.visible = true;
        const poses = bodyPoses(this.model, frame);
        for (const { mesh, geom } of this.parts) {
            const name = this.hingeOf.get(geom);
            const h = name ? this.hinges.get(name) : undefined;
            if (h && h.angle !== 0) {
                placeHinged(mesh, poses[geom.body], geom, h.hinge, h.angle);
            } else {
                place(mesh, geomPose(poses[geom.body], geom));
            }
        }
        return poses;
    }

    /** Swings a viewer hinge (see RobotPartsOptions.hinges) to `angle` radians; shown by the next pose(). */
    setHinge(name: string, angle: number): void {
        const h = this.hinges.get(name);
        if (h) {
            h.angle = angle;
        }
    }

    /** The geoms a viewer hinge moves (for tests and tools). */
    hingedGeoms(name: string): ViewerGeom[] {
        return [...(this.hinges.get(name)?.geoms ?? [])];
    }

    /**
     * Paints the robot's light shell parts (white or light grey plastic) with
     * `hex` ("#rrggbb"); dark parts, joints and coloured trim keep their own
     * colour. Without `hex` every part gets its model colour back.
     */
    paint(hex?: string): void {
        const tint = hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? new THREE.Color(hex) : undefined;
        this.materials.forEach(m => {
            let base = this.baseColors.get(m);
            if (!base) {
                base = m.color.clone();
                this.baseColors.set(m, base);
            }
            m.color.copy(tint && isShell(base) ? tint : base);
        });
    }

    dispose(): void {
        this.geometries.forEach(g => g.dispose());
        this.materials.forEach(m => m.dispose());
    }

    private material(geom: ViewerGeom): THREE.MeshPhysicalMaterial {
        const surface = partSurface(geom);
        const key = `${geom.rgba.join(',')}|${surface.roughness},${surface.metalness},${surface.clearcoat}`;
        let material = this.materials.get(key);
        if (!material) {
            material = new THREE.MeshPhysicalMaterial({
                // MuJoCo colours are display colours; three.js wants them linear.
                color: new THREE.Color().setRGB(geom.rgba[0], geom.rgba[1], geom.rgba[2], THREE.SRGBColorSpace),
                roughness: surface.roughness,
                metalness: surface.metalness,
                clearcoat: surface.clearcoat,
                clearcoatRoughness: 0.35,
                transparent: geom.rgba[3] < 1,
                opacity: geom.rgba[3],
            });
            this.materials.set(key, material);
        }
        return material;
    }

    /** MuJoCo's primitives at MuJoCo's sizes: half-extents, radii and half-lengths, long axis along local z. */
    private primitive(geom: ViewerGeom): THREE.BufferGeometry | undefined {
        const shape = geom.shape;
        if (!shape) {
            return undefined;
        }
        const [a, b, c] = shape.size;
        let g: THREE.BufferGeometry;
        switch (shape.type) {
            case 'sphere':
                g = new THREE.SphereGeometry(a, 32, 20);
                break;
            case 'ellipsoid':
                g = new THREE.SphereGeometry(1, 32, 20).scale(a, b, c);
                break;
            case 'box':
                g = new THREE.BoxGeometry(2 * a, 2 * b, 2 * c);
                break;
            case 'cylinder':
                // three's cylinders stand along y; MuJoCo's along z.
                g = new THREE.CylinderGeometry(a, a, 2 * b, 32).rotateX(Math.PI / 2);
                break;
            case 'capsule':
                g = new THREE.CapsuleGeometry(a, 2 * b, 8, 24).rotateX(Math.PI / 2);
                break;
            case 'plane':
                // Size 0 means an infinite plane; draw a generous one.
                g = new THREE.PlaneGeometry(a > 0 ? 2 * a : 20, b > 0 ? 2 * b : 20);
                break;
        }
        this.geometries.push(g);
        return g;
    }
}

const H = { r: new THREE.Quaternion(), bq: new THREE.Quaternion(), gq: new THREE.Quaternion(), axis: new THREE.Vector3(), p: new THREE.Vector3(), pivot: new THREE.Vector3() };

/**
 * Places a geom of `body` turned by `angle` about the hinge, in the body's
 * frame: the geom's offset from the pivot is rotated, then the whole thing
 * is carried by the body's pose.
 */
export function placeHinged(object: THREE.Object3D, body: BodyPose, geom: ViewerGeom, hinge: PartHinge, angle: number): void {
    H.axis.set(hinge.axis[0], hinge.axis[1], hinge.axis[2]).normalize();
    H.r.setFromAxisAngle(H.axis, angle);
    H.pivot.set(hinge.pivot[0], hinge.pivot[1], hinge.pivot[2]);
    H.p.set(geom.pos[0], geom.pos[1], geom.pos[2]).sub(H.pivot).applyQuaternion(H.r).add(H.pivot);
    H.gq.set(geom.quat[1], geom.quat[2], geom.quat[3], geom.quat[0]);
    H.bq.set(body.quat[1], body.quat[2], body.quat[3], body.quat[0]);
    object.position.set(body.pos[0], body.pos[1], body.pos[2]).add(H.p.applyQuaternion(H.bq));
    object.quaternion.copy(H.bq).multiply(H.r).multiply(H.gq);
}

export function place(object: THREE.Object3D, pose: BodyPose): void {
    object.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    // MuJoCo stores w first; three.js takes x, y, z, w.
    object.quaternion.set(pose.quat[1], pose.quat[2], pose.quat[3], pose.quat[0]);
}

/**
 * A light, unsaturated part (the shell plastic): bright and close to grey,
 * judged on the display colour MuJoCo wrote (three.js keeps `c` in linear
 * light). The Unitree G1's "metal" body (0.7 grey) counts; the Microduck's
 * servos and legs (0.67/0.64/0.60 beige) and mid greys keep their colour.
 */
export function isShell(c: THREE.Color): boolean {
    const d = c.clone().convertLinearToSRGB();
    const lum = 0.2126 * d.r + 0.7152 * d.g + 0.0722 * d.b;
    const spread = Math.max(d.r, d.g, d.b) - Math.min(d.r, d.g, d.b);
    return lum >= 0.68 && spread <= 0.15;
}
