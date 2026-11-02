// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Furniture on the duck's pitch, drawn at real size from duck-sim's
 * furniture entries: a fridge with a freezer door and chrome handles, a
 * wooden table or desk with a laptop, monitor and lamp on top, a chair, a
 * bookshelf, a sofa, a cardboard box. Built from simple shapes with
 * procedural wood, fabric and metal surfaces; the simulator's solid parts
 * (legs, panels, bodies) sit exactly where they are drawn.
 */

import * as THREE from 'three';
import {
    CHAIR_LEG, CHAIR_SEAT, DESK_PANEL, SOFA_SEAT, TABLE_LEG, furnitureSize, type Furniture, type FurnitureItem,
} from 'robolance-duck-sim/viewer';
import { LaptopModel, screenMaterial } from './laptop-model';
import { cardboard, fabric, shade, woodGrain, type Surface } from './room-textures';

/** Default colours by kind. */
const COLORS: Record<Furniture['kind'], string> = {
    table: '#9a6a43', desk: '#c8a27a', chair: '#7a5235', fridge: '#e9ebec', shelf: '#b88a5f', sofa: '#5d6b7a', box: '#b98a58',
};

export class FurnitureModel {
    readonly group = new THREE.Group();
    private readonly disposables: Array<{ dispose(): void }> = [];
    private readonly laptops: LaptopModel[] = [];

    constructor(readonly spec: Furniture) {
        const { width, depth, height } = furnitureSize(spec);
        const color = spec.color ?? COLORS[spec.kind];
        switch (spec.kind) {
            case 'table': this.table(width, depth, height, color, false); break;
            case 'desk': this.table(width, depth, height, color, true); break;
            case 'chair': this.chair(width, depth, height, color); break;
            case 'fridge': this.fridge(width, depth, height, color); break;
            case 'shelf': this.shelf(width, depth, height, color); break;
            case 'sofa': this.sofa(width, depth, height, color); break;
            case 'box': this.box(width, depth, height); break;
        }
        this.group.position.set(spec.x, spec.y, 0);
        this.group.rotation.z = ((spec.heading ?? 0) * Math.PI) / 180;
        this.group.traverse(o => {
            if ((o as THREE.Mesh).isMesh) {
                o.castShadow = true;
                o.receiveShadow = true;
            }
        });
    }

    dispose(): void {
        this.laptops.forEach(l => l.dispose());
        this.disposables.forEach(d => d.dispose());
    }

    // ---- pieces -------------------------------------------------------

    private table(width: number, depth: number, height: number, color: string, desk: boolean): void {
        const top = 0.03;
        const wood = this.wood(color, depth, width);
        this.block(depth, width, top, wood, 0, 0, height - top / 2);
        // A thin darker edge band under the top.
        this.block(depth - 0.02, width - 0.02, 0.05, this.wood(shade(color, -0.15), depth, width), 0, 0, height - top - 0.025);
        if (desk) {
            // Side panels and a modesty panel at the back: knee space faces the front (+x).
            const panel = this.wood(shade(color, -0.05), depth, height);
            for (const side of [1, -1]) {
                this.block(depth, DESK_PANEL, height - top, panel, 0, side * (width / 2 - DESK_PANEL / 2), (height - top) / 2);
            }
            this.block(0.018, width - 2 * DESK_PANEL, (height - top) * 0.55, panel, -depth / 2 + 0.05, 0, height - top - (height - top) * 0.275);
            // A drawer under the top on the right, with a metal pull.
            this.block(depth * 0.85, width * 0.3, 0.12, this.wood(shade(color, 0.04), depth, 0.3), 0, -width / 2 + DESK_PANEL + width * 0.15, height - top - 0.06);
            this.block(0.012, 0.1, 0.012, this.metal('#b9bcc0'), depth * 0.425 + 0.006, -width / 2 + DESK_PANEL + width * 0.15, height - top - 0.06);
        } else {
            const leg = this.wood(shade(color, -0.1), 0.1, height);
            const inset = TABLE_LEG / 2 + 0.03;
            for (const fx of [depth / 2 - inset, -(depth / 2 - inset)]) {
                for (const fy of [width / 2 - inset, -(width / 2 - inset)]) {
                    this.block(TABLE_LEG, TABLE_LEG, height - top, leg, fx, fy, (height - top) / 2);
                }
            }
        }
        this.items(this.spec.items ?? [], width, depth, height);
    }

    private chair(width: number, depth: number, height: number, color: string): void {
        const wood = this.wood(color, 0.5, 0.5);
        const inset = CHAIR_LEG / 2 + 0.03;
        for (const fx of [depth / 2 - inset, -(depth / 2 - inset)]) {
            for (const fy of [width / 2 - inset, -(width / 2 - inset)]) {
                this.block(CHAIR_LEG, CHAIR_LEG, CHAIR_SEAT, wood, fx, fy, CHAIR_SEAT / 2);
            }
        }
        // The seat with a fabric cushion, and the backrest at the back (-x): the seat faces the front.
        this.block(depth, width, 0.03, wood, 0, 0, CHAIR_SEAT + 0.015);
        this.block(depth - 0.04, width - 0.04, 0.04, this.cloth(shade(color, 0.35), depth, width), 0.01, 0, CHAIR_SEAT + 0.05);
        const back = -depth / 2 + CHAIR_LEG / 2 + 0.01;
        for (const fy of [width / 2 - inset, -(width / 2 - inset)]) {
            this.block(CHAIR_LEG, CHAIR_LEG, height - CHAIR_SEAT, wood, back, fy, CHAIR_SEAT + (height - CHAIR_SEAT) / 2);
        }
        for (const z of [height - 0.06, height - 0.22]) {
            this.block(0.02, width - 0.04, 0.08, wood, back, 0, z);
        }
    }

    private fridge(width: number, depth: number, height: number, color: string): void {
        const enamel = new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.2 });
        this.disposables.push(enamel);
        const feet = 0.03;
        const door = 0.04;
        const bodyD = depth - door;
        // The cabinet, set back by the doors' thickness; the doors face the front (+x).
        this.block(bodyD, width, height - feet, enamel, -door / 2, 0, feet + (height - feet) / 2);
        const split = height * 0.68;
        const gap = 0.006;
        const doorX = depth / 2 - door / 2;
        this.block(door, width - 0.01, split - feet - gap, enamel, doorX, 0, feet + (split - feet - gap) / 2);
        this.block(door, width - 0.01, height - split - gap, enamel, doorX, 0, split + gap / 2 + (height - split - gap) / 2);
        // The seam between the doors and a dark kick plate.
        const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6 });
        this.disposables.push(dark);
        this.block(door + 0.002, width - 0.01, gap, dark, doorX, 0, split);
        this.block(0.01, width - 0.04, feet, dark, depth / 2 - door - 0.005, 0, feet / 2);
        // Long chrome handles on the hinge-free side.
        const chrome = this.metal('#dfe3e6', 0.15);
        const hy = width / 2 - 0.07;
        this.handle(chrome, depth / 2 + 0.025, hy, split + 0.05, split + 0.05 + (height - split) * 0.55);
        this.handle(chrome, depth / 2 + 0.025, hy, split - 0.08 - (split - feet) * 0.55, split - 0.08);
        // A small logo plate.
        this.block(0.002, 0.08, 0.015, this.metal('#9aa0a6'), depth / 2 + 0.001, 0, height - 0.05);
    }

    private shelf(width: number, depth: number, height: number, color: string): void {
        const wood = this.wood(color, 1, 1);
        const t = 0.02;
        for (const side of [1, -1]) {
            this.block(depth, t, height, wood, 0, side * (width / 2 - t / 2), height / 2);
        }
        this.block(0.008, width, height, this.wood(shade(color, -0.2), 1, 1), -depth / 2 + 0.004, 0, height / 2);
        const levels = Math.max(2, Math.round(height / 0.36));
        const rand = mulberry(Math.round((this.spec.x + 7) * 1000 + this.spec.y * 100));
        for (let i = 0; i <= levels; i++) {
            const z = t / 2 + (i * (height - t)) / levels;
            this.block(depth, width - 2 * t, t, wood, 0, 0, z);
            if (i < levels) {
                this.books(width - 2 * t - 0.02, depth - 0.04, z + t / 2, Math.min(0.28, (height - t) / levels - 0.04), rand);
            }
        }
    }

    private sofa(width: number, depth: number, height: number, color: string): void {
        const cloth = this.cloth(color, depth, width);
        const darker = this.cloth(shade(color, -0.12), depth, width);
        const arm = 0.16;
        const back = 0.2;
        // The base that stands on the floor (solid in the simulator), on short dark feet.
        const foot = 0.06;
        this.block(depth, width, SOFA_SEAT - foot - 0.12, darker, 0, 0, foot + (SOFA_SEAT - foot - 0.12) / 2);
        const legMat = this.wood('#3b2a1e', 0.1, 0.1);
        for (const fx of [depth / 2 - 0.06, -depth / 2 + 0.06]) {
            for (const fy of [width / 2 - 0.06, -width / 2 + 0.06]) {
                this.block(0.04, 0.04, foot, legMat, fx, fy, foot / 2);
            }
        }
        // Seat cushions (two or three), the back cushions and the arms.
        const seats = width > 1.5 ? 3 : 2;
        const inner = width - 2 * arm;
        for (let i = 0; i < seats; i++) {
            const y = -inner / 2 + inner * (i + 0.5) / seats;
            this.cushion(depth - back - 0.02, inner / seats - 0.012, 0.12, cloth, back / 2, y, SOFA_SEAT - 0.06);
            this.cushion(back * 0.7, inner / seats - 0.012, height - SOFA_SEAT - 0.04, cloth, -depth / 2 + back * 0.7, y, SOFA_SEAT + (height - SOFA_SEAT) / 2);
        }
        this.block(back * 0.6, width, height - foot, darker, -depth / 2 + back * 0.3, 0, foot + (height - foot) / 2);
        for (const side of [1, -1]) {
            this.cushion(depth, arm, SOFA_SEAT + 0.16 - foot, darker, 0, side * (width / 2 - arm / 2), foot + (SOFA_SEAT + 0.16 - foot) / 2);
        }
    }

    private box(width: number, depth: number, height: number): void {
        const s = cardboard(depth, height);
        const mat = new THREE.MeshStandardMaterial({ map: s.color, bumpMap: s.bump, bumpScale: 0.4, roughness: 0.9 });
        this.disposables.push(mat, s.color, s.bump);
        this.block(depth, width, height, mat, 0, 0, height / 2);
        const tape = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.4, transparent: true, opacity: 0.85 });
        this.disposables.push(tape);
        this.block(depth + 0.002, 0.05, 0.002, tape, 0, 0, height + 0.001);
    }

    // ---- things on a desk or table -------------------------------------

    private items(items: FurnitureItem[], width: number, depth: number, height: number): void {
        // Spread along the top from left (+y) to right; the laptop or monitor takes the middle.
        const slots = [0, 0.32, -0.32, 0.42, -0.42, 0.2].map(k => k * width);
        let next = 0;
        for (const item of items) {
            const y = slots[next++ % slots.length];
            const g = this.item(item);
            if (g) {
                g.position.set(item === 'monitor' ? -depth * 0.2 : item === 'laptop' ? 0.02 : -depth * 0.15, y, height);
                this.group.add(g);
            }
        }
    }

    private item(item: FurnitureItem): THREE.Object3D | undefined {
        const g = new THREE.Group();
        switch (item) {
            case 'laptop': {
                const laptop = new LaptopModel({ x: 0, y: 0, heading: 0, openDeg: 105 });
                this.laptops.push(laptop);
                return laptop.group;
            }
            case 'monitor': {
                const black = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.45, metalness: 0.3 });
                this.disposables.push(black);
                this.part(g, new THREE.BoxGeometry(0.18, 0.22, 0.012), black, 0, 0, 0.006);
                this.part(g, new THREE.BoxGeometry(0.03, 0.05, 0.3), black, -0.03, 0, 0.16);
                this.part(g, new THREE.BoxGeometry(0.025, 0.6, 0.36), black, 0, 0, 0.42);
                const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.57, 0.33), screenMaterial());
                this.disposables.push(screen.geometry, screen.material as THREE.Material);
                // Facing the front (+x): picture right along +y, picture up along +z.
                screen.quaternion.setFromRotationMatrix(
                    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)),
                );
                screen.position.set(0.0135, 0, 0.42);
                g.add(screen);
                return g;
            }
            case 'lamp': {
                const metal = this.metal('#2b2d31', 0.35);
                const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.7, side: THREE.DoubleSide, emissive: 0xffd9a0, emissiveIntensity: 0.25 });
                this.disposables.push(shadeMat);
                this.part(g, new THREE.CylinderGeometry(0.07, 0.08, 0.02, 32), metal, 0, 0, 0.01, true);
                this.part(g, new THREE.CylinderGeometry(0.008, 0.008, 0.36, 12), metal, 0, 0, 0.19, true);
                this.part(g, new THREE.CylinderGeometry(0.06, 0.12, 0.14, 32, 1, true), shadeMat, 0, 0, 0.4, true);
                const bulb = new THREE.PointLight(0xffd29a, 0.35, 1.2, 2);
                bulb.position.set(0, 0, 0.36);
                g.add(bulb);
                return g;
            }
            case 'books': {
                this.books(0.3, 0.2, 0, 0.24, mulberry(41), g);
                return g;
            }
            case 'mug': {
                const ceramic = new THREE.MeshStandardMaterial({ color: 0xd9572b, roughness: 0.35 });
                this.disposables.push(ceramic);
                this.part(g, new THREE.CylinderGeometry(0.04, 0.038, 0.095, 32), ceramic, 0, 0, 0.0475, true);
                const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 10, 24, Math.PI), ceramic);
                this.disposables.push(handle.geometry);
                handle.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
                handle.position.set(0, -0.04, 0.05);
                g.add(handle);
                return g;
            }
            case 'plant': {
                const pot = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.8 });
                const leaf = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.65 });
                this.disposables.push(pot, leaf);
                this.part(g, new THREE.CylinderGeometry(0.07, 0.055, 0.12, 24), pot, 0, 0, 0.06, true);
                const rand = mulberry(77);
                for (let i = 0; i < 9; i++) {
                    const a = rand() * Math.PI * 2;
                    const r = 0.02 + rand() * 0.05;
                    const geo = new THREE.SphereGeometry(0.035 + rand() * 0.02, 12, 10);
                    geo.scale(1, 0.6, 1.4);
                    this.part(g, geo, leaf, Math.cos(a) * r, Math.sin(a) * r, 0.16 + rand() * 0.1);
                }
                return g;
            }
        }
        return undefined;
    }

    /** A row of books across `width`, `depth` deep, standing on z. */
    private books(width: number, depth: number, z: number, maxH: number, rand: () => number, into: THREE.Object3D = this.group): void {
        const covers = ['#8c2f39', '#2f4b7c', '#3b6e4f', '#c9a227', '#5b4b8a', '#d6d0c4', '#2a2a2a', '#b5562c'];
        let y = width / 2;
        const end = -width / 2 + width * (0.1 + rand() * 0.3);
        while (y > end) {
            const t = 0.02 + rand() * 0.035;
            const h = maxH * (0.65 + rand() * 0.35);
            const mat = new THREE.MeshStandardMaterial({ color: covers[Math.floor(rand() * covers.length)], roughness: 0.75 });
            this.disposables.push(mat);
            this.part(into, new THREE.BoxGeometry(depth * (0.75 + rand() * 0.2), t, h), mat, 0, y - t / 2, z + h / 2);
            y -= t + 0.002;
        }
    }

    // ---- building blocks ------------------------------------------------

    private wood(color: string, along: number, across: number): THREE.Material {
        const s: Surface = woodGrain(color, along, across);
        const mat = new THREE.MeshStandardMaterial({ map: s.color, bumpMap: s.bump, bumpScale: 0.3, roughness: 0.55, metalness: 0 });
        this.disposables.push(mat, s.color, s.bump);
        return mat;
    }

    private cloth(color: string, along: number, across: number): THREE.Material {
        const s = fabric(color, along, across);
        const mat = new THREE.MeshStandardMaterial({ map: s.color, bumpMap: s.bump, bumpScale: 0.5, roughness: 0.95 });
        this.disposables.push(mat, s.color, s.bump);
        return mat;
    }

    private metal(color: string, roughness = 0.3): THREE.Material {
        const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness });
        this.disposables.push(mat);
        return mat;
    }

    /** A box `x` deep (front-back), `y` wide, `z` high, centred at (px, py, pz) in the piece's frame. */
    private block(x: number, y: number, z: number, material: THREE.Material, px: number, py: number, pz: number): THREE.Mesh {
        return this.part(this.group, new THREE.BoxGeometry(x, y, z), material, px, py, pz);
    }

    /** A soft cushion: a box with rounded edges. */
    private cushion(x: number, y: number, z: number, material: THREE.Material, px: number, py: number, pz: number): void {
        const r = Math.min(0.04, x / 3, y / 3, z / 3);
        const shape = new THREE.Shape();
        const w = x / 2;
        const h = z / 2;
        shape.moveTo(-w + r, -h);
        shape.lineTo(w - r, -h);
        shape.quadraticCurveTo(w, -h, w, -h + r);
        shape.lineTo(w, h - r);
        shape.quadraticCurveTo(w, h, w - r, h);
        shape.lineTo(-w + r, h);
        shape.quadraticCurveTo(-w, h, -w, h - r);
        shape.lineTo(-w, -h + r);
        shape.quadraticCurveTo(-w, -h, -w + r, -h);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: y - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.6, bevelSegments: 3, curveSegments: 6 });
        geo.translate(0, 0, -(y - 2 * r) / 2);
        // Extruded along z; turn so the extrusion runs across the piece (y) and the profile stands in x-z.
        geo.rotateX(Math.PI / 2);
        this.part(this.group, geo, material, px, py, pz);
    }

    /** A bar handle standing off the door between z1 and z2. */
    private handle(material: THREE.Material, x: number, y: number, z1: number, z2: number): void {
        this.part(this.group, new THREE.CylinderGeometry(0.009, 0.009, z2 - z1, 16), material, x, y, (z1 + z2) / 2, true);
        for (const z of [z1 + 0.015, z2 - 0.015]) {
            this.part(this.group, new THREE.BoxGeometry(0.025, 0.012, 0.012), material, x - 0.0125, y, z);
        }
    }

    private part(into: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, upright = false): THREE.Mesh {
        if (upright) {
            // Three's cylinders stand along y; the stage's up is z.
            geometry.rotateX(Math.PI / 2);
        }
        this.disposables.push(geometry);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        into.add(mesh);
        return mesh;
    }
}

/** A small seeded generator, so a shelf's books are the same on every load. */
function mulberry(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
