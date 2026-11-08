// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * A photo-studio light box, rendered once into an environment map: a
 * grey room with a large soft panel overhead and a few smaller ones
 * around, like the softboxes of a product shot. Robot parts pick up
 * believable reflections and soft fill from it. Built for this stage's
 * world, where +z is up. (After three.js's RoomEnvironment, which is
 * y-up and lives in a separate module copy of three.)
 */

import * as THREE from 'three';

interface Panel {
    pos: [number, number, number];
    size: [number, number, number];
    /** Brightness relative to white; above 1 makes a light source. */
    intensity: number;
}

const PANELS: Panel[] = [
    { pos: [0, 0, 9], size: [6, 6, 0.1], intensity: 18 }, // overhead softbox
    { pos: [-9, -3, 4], size: [0.1, 4, 3], intensity: 9 }, // key, front left
    { pos: [8, 4, 5], size: [0.1, 5, 3], intensity: 5 }, // fill, back right
    { pos: [2, 9, 3], size: [4, 0.1, 2], intensity: 4 }, // rim
    { pos: [-3, -9, 2], size: [3, 0.1, 1.5], intensity: 3 },
];

export function createStudioScene(): THREE.Scene {
    const scene = new THREE.Scene();
    const box = new THREE.BoxGeometry();
    box.deleteAttribute('uv');
    const walls = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ side: THREE.BackSide, color: 0x9a9a9a, roughness: 1 }));
    walls.scale.set(22, 22, 14);
    walls.position.set(0, 0, 5);
    scene.add(walls);
    // A darker floor, so reflections read as ground below and light above.
    const floor = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: 0x3a3d3a, roughness: 1 }));
    floor.scale.set(22, 22, 0.1);
    floor.position.set(0, 0, -1.9);
    scene.add(floor);
    for (const p of PANELS) {
        const material = new THREE.MeshBasicMaterial();
        material.color.setScalar(p.intensity);
        const panel = new THREE.Mesh(box, material);
        panel.position.set(...p.pos);
        panel.scale.set(...p.size);
        scene.add(panel);
    }
    const bulb = new THREE.PointLight(0xffffff, 400, 30, 2);
    bulb.position.set(0, 0, 8);
    scene.add(bulb);
    return scene;
}

/** The studio as a prefiltered environment map for `scene.environment`. */
export function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const studio = createStudioScene();
    const texture = pmrem.fromScene(studio, 0.04).texture;
    const seen = new Set<{ dispose(): void }>();
    studio.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
            seen.add(mesh.geometry);
            seen.add(mesh.material as THREE.Material);
        }
    });
    seen.forEach(r => r.dispose());
    pmrem.dispose();
    return texture;
}
