// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * What a model costs to draw, as a game engine or a web page sees it:
 * triangles, vertices, draw calls, materials and textures.
 */

import * as THREE from 'three';

export interface TextureInfo {
    name: string;
    width: number;
    height: number;
}

export interface ModelStats {
    meshes: number;
    triangles: number;
    vertices: number;
    /** One per mesh and material: what the GPU draws separately. */
    drawCalls: number;
    materials: string[];
    textures: TextureInfo[];
    animations: number;
    /** World-space size along x, y and z (z up). */
    size: [number, number, number];
    center: [number, number, number];
}

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap'] as const;

export function modelStats(root: THREE.Object3D, animations = 0): ModelStats {
    let meshes = 0;
    let triangles = 0;
    let vertices = 0;
    let drawCalls = 0;
    const materials = new Map<string, string>();
    const textures = new Map<string, TextureInfo>();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) {
            return;
        }
        meshes++;
        const geometry = mesh.geometry as THREE.BufferGeometry;
        const position = geometry.getAttribute('position');
        const count = position ? position.count : 0;
        vertices += count;
        const tris = geometry.index ? geometry.index.count / 3 : count / 3;
        const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
        triangles += Math.floor(tris) * instances;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        drawCalls += Math.max(1, list.length);
        for (const material of list) {
            if (!material) {
                continue;
            }
            materials.set(material.uuid, material.name || material.type);
            for (const slot of TEXTURE_SLOTS) {
                const tex = (material as unknown as Record<string, THREE.Texture | null | undefined>)[slot];
                const image = tex?.image as { width?: number; height?: number } | undefined;
                if (tex && !textures.has(tex.uuid)) {
                    textures.set(tex.uuid, { name: tex.name || slot, width: image?.width ?? 0, height: image?.height ?? 0 });
                }
            }
        }
    });
    const box = new THREE.Box3().setFromObject(root);
    const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const round = (v: number) => Math.round(v * 1e4) / 1e4;
    return {
        meshes,
        triangles,
        vertices,
        drawCalls,
        materials: [...new Set(materials.values())].sort(),
        textures: [...textures.values()],
        animations,
        size: [round(size.x), round(size.y), round(size.z)],
        center: [round(center.x), round(center.y), round(center.z)],
    };
}

/** "12,430 triangles · 3 materials · 2 textures (largest 2048 px)". */
export function statsLine(stats: ModelStats): string {
    const n = (v: number) => v.toLocaleString('en-US');
    const parts = [`${n(stats.triangles)} triangle${stats.triangles === 1 ? '' : 's'}`];
    parts.push(`${stats.materials.length} material${stats.materials.length === 1 ? '' : 's'}`);
    if (stats.textures.length > 0) {
        const largest = Math.max(...stats.textures.map((t) => Math.max(t.width, t.height)));
        parts.push(`${stats.textures.length} texture${stats.textures.length === 1 ? '' : 's'}${largest > 0 ? ` (largest ${largest} px)` : ''}`);
    }
    if (stats.animations > 0) {
        parts.push(`${stats.animations} animation${stats.animations === 1 ? '' : 's'}`);
    }
    return parts.join(' · ');
}
