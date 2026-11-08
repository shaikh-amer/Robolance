// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Turns a 3D file's bytes into a three.js object on this package's stage,
 * where +z is up (like MuJoCo and the Hardware tab). glTF, FBX and OBJ are
 * y-up and are turned upright; STL is taken as z-up, as CAD tools and
 * robot descriptions write it.
 *
 * Only `is*` flags are used on what the loaders return, never instanceof:
 * three's loaders are ES modules, and a bundle can hold them next to a
 * CommonJS copy of three.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'fbx';

export const MODEL_FORMATS: readonly ModelFormat[] = ['glb', 'gltf', 'obj', 'stl', 'fbx'];

/** The format of a file name, or undefined when this viewer cannot open it. */
export function modelFormat(fileName: string): ModelFormat | undefined {
    const ext = fileName.toLowerCase().split('.').pop() ?? '';
    return (MODEL_FORMATS as readonly string[]).includes(ext) ? (ext as ModelFormat) : undefined;
}

export interface LoadedModel {
    /** The model, already upright for a z-up stage. */
    root: THREE.Object3D;
    animations: THREE.AnimationClip[];
    format: ModelFormat;
}

/** A neutral clay material for formats that carry none (STL). */
export function clayMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0xb8b8bc, roughness: 0.6, metalness: 0.05 });
}

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
    if (data instanceof Uint8Array) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    }
    return data;
}

function text(data: ArrayBuffer | Uint8Array): string {
    return new TextDecoder().decode(data instanceof Uint8Array ? data : new Uint8Array(data));
}

/**
 * Parses a model. `resourcePath` is where a .gltf's external buffers and
 * textures resolve from (a URL ending in "/"); a .glb needs none.
 */
export async function parseModel(data: ArrayBuffer | Uint8Array, format: ModelFormat, resourcePath = ''): Promise<LoadedModel> {
    let root: THREE.Object3D;
    let animations: THREE.AnimationClip[] = [];
    let yUp = true;
    switch (format) {
        case 'glb':
        case 'gltf': {
            const gltf = await new GLTFLoader().parseAsync(format === 'glb' ? toArrayBuffer(data) : text(data), resourcePath);
            root = gltf.scene;
            animations = gltf.animations ?? [];
            break;
        }
        case 'stl': {
            const geometry = new STLLoader().parse(toArrayBuffer(data));
            geometry.computeVertexNormals();
            root = new THREE.Mesh(geometry, clayMaterial());
            root.name = 'STL';
            yUp = false;
            break;
        }
        case 'obj': {
            root = new OBJLoader().parse(text(data));
            root.traverse((o) => {
                const mesh = o as THREE.Mesh;
                if (mesh.isMesh && (!mesh.material || (Array.isArray(mesh.material) && mesh.material.length === 0))) {
                    mesh.material = clayMaterial();
                }
            });
            break;
        }
        case 'fbx': {
            const fbx = new FBXLoader().parse(toArrayBuffer(data), resourcePath);
            root = fbx;
            animations = (fbx as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations ?? [];
            break;
        }
        default:
            throw new Error(`unsupported model format: ${format as string}`);
    }
    const holder = new THREE.Group();
    holder.name = 'model';
    if (yUp) {
        holder.rotation.x = Math.PI / 2;
    }
    holder.add(root);
    holder.updateMatrixWorld(true);
    return { root: holder, animations, format };
}
