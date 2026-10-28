// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The 3D view for any MJCF scene: the robot's parts posed from a replay
 * frame on a studio floor with a 10 cm grid (so sizes read at a glance),
 * framed to the robot's size. Ground planes in the model become that
 * floor, tinted with their colour.
 */

import * as THREE from 'three';
import type { ViewerModel } from 'robolance-duck-sim/viewer';
import { RobotParts } from './robot-parts';
import { StageBase, isSmallDevice, type SkyPalette, type StageView } from './stage-base';
import { paintTurf, seededRandom } from './stage-textures';

interface FloorPalette extends SkyPalette {
    /** Floor colour, 0-1 sRGB. */
    floor: [number, number, number];
}

const PALETTES: Record<'light' | 'dark', FloorPalette> = {
    light: { skyTop: '#c9d3dc', horizon: '#e4e7ea', exposure: 1.0, floor: [0.73, 0.74, 0.75] },
    dark: { skyTop: '#11151b', horizon: '#2b3036', exposure: 0.95, floor: [0.36, 0.37, 0.39] },
};

/** The floor's colour: the theme's, half way towards the model's own ground colour when it has one. */
export function floorColor(theme: [number, number, number], tint?: [number, number, number]): [number, number, number] {
    return tint ? [0, 1, 2].map(k => (theme[k] + tint[k]) / 2) as [number, number, number] : theme;
}

/** Grid lines that read on the floor: dark on a light floor, light on a dark one. */
export function gridColors(floor: [number, number, number]): { minor: string; major: string } {
    const luminance = 0.2126 * floor[0] + 0.7152 * floor[1] + 0.0722 * floor[2];
    return luminance > 0.45
        ? { minor: 'rgba(20,24,28,0.22)', major: 'rgba(20,24,28,0.5)' }
        : { minor: 'rgba(255,255,255,0.12)', major: 'rgba(255,255,255,0.32)' };
}

export const SCENE_VIEW: StageView = { azimuth: 55, elevation: 25, distance: 1.5 };

export class SceneStage extends StageBase {
    private readonly robot: RobotParts;
    private readonly floor = new THREE.Group();
    private palette: FloorPalette = PALETTES.dark;
    private framed = false;
    /** The body the camera follows: the first free-moving one, else the first. */
    private readonly focus: number;
    private readonly tint?: [number, number, number];

    constructor(host: HTMLElement, readonly model: ViewerModel) {
        super(host, { ...SCENE_VIEW }, 'robolance-duck-canvas');
        this.robot = new RobotParts(model, { include: g => g.shape?.type !== 'plane' });
        const plane = model.geoms.find(g => g.shape?.type === 'plane');
        this.tint = plane ? [plane.rgba[0], plane.rgba[1], plane.rgba[2]] : undefined;
        const free = model.bodies.findIndex(b => b.joint?.type === 'free');
        this.focus = free > 0 ? free : Math.min(1, model.bodies.length - 1);
        this.scene.add(this.floor, this.robot.group);
        this.disposers.push(() => {
            this.robot.dispose();
            this.clearFloor();
        });
    }

    setTheme(theme: 'light' | 'dark'): void {
        this.palette = PALETTES[theme];
        this.setSky(this.palette, 6, 22);
        this.buildFloor();
        this.invalidate();
    }

    /** Poses the robot from a replay frame; the first frame also frames the camera to the robot's size. */
    show(frame: ArrayLike<number> | undefined): void {
        const poses = this.robot.pose(frame);
        if (poses) {
            const p = poses[this.focus].pos;
            this.followAt.set(p[0], p[1], Math.max(0.05, p[2]));
            if (!this.framed) {
                this.framed = true;
                this.frameRobot();
            }
        }
        this.invalidate();
    }

    protected home(): void {
        this.frameRobot();
    }

    /** Looks at the robot's middle from far enough to see all of it. */
    private frameRobot(): void {
        this.robot.group.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(this.robot.group);
        if (box.isEmpty()) {
            return;
        }
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const extent = Math.max(0.1, size.x, size.y, size.z);
        this.target.copy(center);
        this.defaultView.distance = Math.min(30, extent * 2.4);
        this.view.distance = this.defaultView.distance;
        this.fitShadow(center.x, center.y, extent * 1.5 + 0.3, Math.max(2.6, extent * 3));
    }

    private clearFloor(): void {
        for (const child of [...this.floor.children]) {
            this.floor.remove(child);
            const mesh = child as THREE.Mesh;
            mesh.geometry?.dispose();
            const material = mesh.material as THREE.MeshStandardMaterial | undefined;
            material?.map?.dispose();
            material?.bumpMap?.dispose();
            material?.dispose();
        }
    }

    private buildFloor(): void {
        this.clearFloor();
        const texture = floorTexture(this.palette, this.tint);
        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(30, 96),
            new THREE.MeshStandardMaterial({ map: texture.color, bumpMap: texture.bump, bumpScale: 0.3, roughness: 0.85 }),
        );
        floor.receiveShadow = true;
        this.floor.add(floor);
    }
}

/**
 * A studio floor: a light concrete grain with a 10 cm grid and a heavier
 * line every metre, one tile per metre. Tinted towards the model's own
 * ground colour when it has one.
 */
function floorTexture(palette: FloorPalette, tint?: [number, number, number]): { color: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
    const size = isSmallDevice() ? 512 : 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    // Half way towards the model's ground colour, so a red floor in the MJCF reads red and the grid still shows.
    const floor = floorColor(palette.floor, tint);
    const grid = gridColors(floor);
    ctx.fillStyle = `rgb(${floor.map(v => Math.round(v * 255)).join(',')})`;
    ctx.fillRect(0, 0, size, size);
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = bumpCanvas.height = size;
    const bump = bumpCanvas.getContext('2d')!;
    paintTurf(ctx, bump, size, size, 0.05, seededRandom(5), 1);
    const step = size / 10;
    for (let i = 0; i <= 10; i++) {
        const major = i === 0 || i === 10;
        ctx.strokeStyle = major ? grid.major : grid.minor;
        ctx.lineWidth = major ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step, size);
        ctx.moveTo(0, i * step);
        ctx.lineTo(size, i * step);
        ctx.stroke();
    }
    const make = (c: HTMLCanvasElement, color: boolean) => {
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        // One tile per metre over the 60 m disc.
        t.repeat.set(60, 60);
        t.anisotropy = 8;
        return t;
    };
    return { color: make(canvas, true), bump: make(bumpCanvas, false) };
}
