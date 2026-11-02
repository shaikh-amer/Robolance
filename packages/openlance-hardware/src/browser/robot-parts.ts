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
}

export class RobotParts {
    readonly group = new THREE.Group();
    private readonly parts: Array<{ mesh: THREE.Mesh; geom: ViewerGeom }> = [];
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly materials = new Map<string, THREE.MeshPhysicalMaterial>();
    /** Each material's model colour, kept so paint() can be undone. */
    private readonly baseColors = new Map<THREE.MeshPhysicalMaterial, THREE.Color>();

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
        for (const geom of model.geoms) {
            if (options.include && !options.include(geom)) {
                continue;
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
            place(mesh, geomPose(poses[geom.body], geom));
        }
        if (this.stickers.length > 0 && poses[1]) {
            this.poseStickers(poses[1]);
        }
        return poses;
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

    private stickers: Array<{ mesh: THREE.Mesh; offset: THREE.Vector3; turn: THREE.Quaternion }> = [];
    private readonly trunkQuat = new THREE.Quaternion();
    private readonly trunkPos = new THREE.Vector3();

    /**
     * One round sticker on each shoulder of the robot's trunk (body 1), just
     * under the head: `left` on its left flank (+y), `right` on its right, or
     * none. The discs sit in the trunk's frame and follow it in pose().
     */
    sticker(materials?: { left: THREE.Material; right: THREE.Material }): void {
        for (const s of this.stickers) {
            this.group.remove(s.mesh);
            s.mesh.geometry.dispose();
        }
        this.stickers = [];
        if (!materials || this.model.bodies.length < 2) {
            return;
        }
        const r = 0.011;
        for (const [side, material] of [[1, materials.left], [-1, materials.right]] as Array<[number, THREE.Material]>) {
            const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 32), material);
            mesh.castShadow = false;
            // On the shell's upper flank towards the neck, facing out along ±y; picture up along +z.
            const offset = new THREE.Vector3(0.004, side * 0.0325, 0.028);
            const turn = new THREE.Quaternion().setFromRotationMatrix(
                new THREE.Matrix4().makeBasis(new THREE.Vector3(-side, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, side, 0)),
            );
            this.group.add(mesh);
            this.stickers.push({ mesh, offset, turn });
        }
    }

    private poseStickers(trunk: BodyPose): void {
        this.trunkQuat.set(trunk.quat[1], trunk.quat[2], trunk.quat[3], trunk.quat[0]);
        this.trunkPos.set(trunk.pos[0], trunk.pos[1], trunk.pos[2]);
        for (const s of this.stickers) {
            s.mesh.position.copy(s.offset).applyQuaternion(this.trunkQuat).add(this.trunkPos);
            s.mesh.quaternion.copy(this.trunkQuat).multiply(s.turn);
        }
    }

    dispose(): void {
        this.sticker(undefined);
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

export function place(object: THREE.Object3D, pose: BodyPose): void {
    object.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    // MuJoCo stores w first; three.js takes x, y, z, w.
    object.quaternion.set(pose.quat[1], pose.quat[2], pose.quat[3], pose.quat[0]);
}

/** A light, unsaturated part (the shell plastic): bright and close to grey. */
export function isShell(c: THREE.Color): boolean {
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    return lum >= 0.45 && spread <= 0.15;
}
