// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The laptop on the duck's pitch: an aluminium base with a keyboard, and a
 * lid on a hinge along the base's back edge whose screen shows an editor
 * mid-session. The lid's angle comes from each replay frame.
 */

import * as THREE from 'three';
import { LAPTOP, type LaptopSpec } from 'robolance-duck-sim/viewer';

export class LaptopModel {
    readonly group = new THREE.Group();
    private readonly hinge = new THREE.Group();
    private readonly disposables: Array<{ dispose(): void }> = [];

    constructor(spec: LaptopSpec) {
        const L = LAPTOP;
        const aluminium = new THREE.MeshStandardMaterial({ color: 0xb4b8be, metalness: 0.55, roughness: 0.38 });
        const keys = new THREE.MeshStandardMaterial({ color: 0x1f2125, roughness: 0.7 });
        this.disposables.push(aluminium, keys);

        const base = this.box(L.depth, L.width, L.baseHeight, aluminium);
        base.position.set(0, 0, L.baseHeight / 2);
        const deck = this.box(L.depth * 0.5, L.width * 0.86, 0.0006, keys);
        deck.position.set(-L.depth * 0.12, 0, L.baseHeight + 0.0003);
        const pad = this.box(L.depth * 0.22, L.width * 0.32, 0.0006, new THREE.MeshStandardMaterial({ color: 0x9da1a7, metalness: 0.4, roughness: 0.45 }));
        pad.position.set(L.depth * 0.3, 0, L.baseHeight + 0.0003);
        this.group.add(base, deck, pad);

        // The lid turns about the base's back edge; closed it lies along +x on the base.
        this.hinge.position.set(-L.depth / 2, 0, L.baseHeight);
        const lid = this.box(L.lidLength, L.width, L.lidThickness, aluminium);
        lid.position.set(L.lidLength / 2, 0, L.lidThickness / 2);
        // The picture's width runs along the hinge, its height up the lid.
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(L.width * 0.92, L.lidLength * 0.9), screenMaterial());
        this.disposables.push(screen.geometry, screen.material as THREE.Material);
        // On the lid's underside, which lies on the keyboard when shut and faces it when
        // open: picture right along +y, picture up towards the lid's free edge (+x).
        screen.position.set(L.lidLength / 2, 0, -0.0004);
        screen.quaternion.setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)),
        );
        this.hinge.add(lid, screen);
        this.group.add(this.hinge);

        this.group.position.set(spec.x, spec.y, 0);
        this.group.rotation.z = (spec.heading * Math.PI) / 180;
        this.setLid(((spec.openDeg ?? L.defaultOpenDeg) * Math.PI) / 180);
    }

    /** The lid's opening angle, radians (0 shut). */
    setLid(angle: number): void {
        // MuJoCo's hinge axis is -y: opening lifts the lid's free edge (+x) towards +z.
        this.hinge.rotation.y = -angle;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }

    private box(x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
        const geometry = new THREE.BoxGeometry(x, y, z);
        this.disposables.push(geometry);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }
}

/** The screen: a dark editor with a file tree, code and a chat, glowing a little. */
function screenMaterial(): THREE.Material {
    if (typeof document === 'undefined') {
        return new THREE.MeshBasicMaterial({ color: 0x10131a });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.fillStyle = '#0e1117';
        ctx.fillRect(0, 0, 640, 420);
        ctx.fillStyle = '#161b22';
        ctx.fillRect(0, 0, 640, 26);
        ctx.fillRect(0, 26, 120, 394);
        ctx.fillRect(470, 26, 170, 394);
        ctx.fillStyle = '#e6edf3';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText('openlance.ai', 10, 18);
        const palette = ['#c792ea', '#82aaff', '#f78c6c', '#c3e88d', '#89ddff', '#ffcb6b'];
        let seed = 7;
        const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
        for (let row = 0; row < 22; row++) {
            ctx.fillStyle = '#3b4252';
            ctx.fillRect(14, 40 + row * 17, 70 + rand() * 30, 6);
            let x = 136 + (row % 4) * 14;
            for (let k = 0; k < 4; k++) {
                const w = 20 + rand() * 70;
                ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
                ctx.fillRect(x, 40 + row * 17, w, 7);
                x += w + 8;
                if (x > 450) {
                    break;
                }
            }
        }
        for (let row = 0; row < 7; row++) {
            ctx.fillStyle = row % 2 ? '#1f6feb' : '#30363d';
            ctx.fillRect(482, 50 + row * 48, 140, 34);
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.55, roughness: 0.25 });
}
