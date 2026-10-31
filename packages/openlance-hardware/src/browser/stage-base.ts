// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * What every 3D stage shares: a renderer with filmic tone mapping and a
 * studio environment map, a warm key light with soft shadows, a sky that
 * fades into the horizon, an orbit camera (drag, wheel or pinch,
 * double-click to reset) that can follow a point, and rendering on demand.
 * The duck's pitch and any MJCF scene build on it.
 */

import * as THREE from 'three';
import { distanceToFit, fogRange, orbitPosition } from './frame-fit';
import { skyCanvas } from './stage-textures';
import { studioEnvironment } from './studio-environment';

export interface StageView {
    /** Degrees around the target, 0 = looking along +x. */
    azimuth: number;
    /** Degrees above the ground. */
    elevation: number;
    distance: number;
}

/**
 * How the camera films the robot, like a game's camera button:
 * - orbit: the broadcast view, dragged and zoomed by hand;
 * - chase: third person, behind the robot and turning with it;
 * - eyes: first person, from the robot's head, looking where it walks;
 * - wide: high above, the whole field in frame.
 */
export type CameraMode = 'orbit' | 'chase' | 'eyes' | 'wide';

export const CAMERA_MODES: readonly CameraMode[] = ['orbit', 'chase', 'eyes', 'wide'];

export const CAMERA_LABELS: Record<CameraMode, string> = {
    orbit: 'Broadcast',
    chase: 'Third person',
    eyes: 'First person',
    wide: 'Wide angle',
};

/** The mode after `mode` on the camera button (wraps around). */
export function nextCameraMode(mode: CameraMode): CameraMode {
    return CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length];
}

/** Where the camera sits and looks for a robot at (x, y) facing `heading` (radians). */
export interface RobotShot {
    position: [number, number, number];
    lookAt: [number, number, number];
}

/** Behind and above the robot, looking a little ahead of it. */
export function chaseShot(x: number, y: number, heading: number, back = 0.7, height = 0.36): RobotShot {
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    return { position: [x - fx * back, y - fy * back, height], lookAt: [x + fx * 0.35, y + fy * 0.35, 0.06] };
}

/** Just in front of the robot's face, looking down the way it walks. */
export function eyesShot(x: number, y: number, heading: number, eye = 0.09, height = 0.2): RobotShot {
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    // Tilted down a little, so the ball at the robot's feet is in view.
    return { position: [x + fx * eye, y + fy * eye, height], lookAt: [x + fx * 0.9, y + fy * 0.9, 0] };
}

/**
 * A close-up from in front of the robot and to its left, a little above,
 * looking at it and a third of the way toward what it is going for (`aim`):
 * the shot a gallery thumbnail uses.
 */
export function portraitShot(x: number, y: number, heading: number, aim?: [number, number], distance = 0.56, height = 0.21): RobotShot {
    const side = heading + 0.8;
    const lookX = aim ? x + (aim[0] - x) * 0.33 : x;
    const lookY = aim ? y + (aim[1] - y) * 0.33 : y;
    return { position: [x + Math.cos(side) * distance, y + Math.sin(side) * distance, height], lookAt: [lookX, lookY, 0.12] };
}

/** Lens per camera mode (degrees, vertical): wider up close, like a game's. */
export const CAMERA_FOV: Record<CameraMode, number> = { orbit: 38, chase: 55, eyes: 72, wide: 38 };

/** Eases `from` toward `to` by `t`, the short way round the circle (radians). */
export function easeAngle(from: number, to: number, t: number): number {
    const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + d * t;
}

export interface SkyPalette {
    /** Sky at the zenith and at the horizon (the fog fades into the horizon). */
    skyTop: string;
    horizon: string;
    exposure: number;
}

/** Phones get smaller shadow maps and textures; the picture is the same. */
export function isSmallDevice(): boolean {
    return typeof window !== 'undefined' && Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 1024) < 700;
}

export abstract class StageBase {
    readonly renderer: THREE.WebGLRenderer;
    protected readonly scene = new THREE.Scene();
    protected readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 60);
    protected readonly sun: THREE.DirectionalLight;
    protected readonly hemi: THREE.HemisphereLight;
    protected view: StageView;
    /** Where the camera looks when not following. */
    protected readonly target = new THREE.Vector3();
    /** Where the camera looks when following. */
    protected readonly followAt = new THREE.Vector3();
    protected follow = false;
    /** The robot's heading (radians), eased so a walking gait does not shake the chase and eye cameras. */
    protected followHeading = 0;
    protected cameraMode: CameraMode = 'orbit';
    protected readonly disposers: Array<() => void> = [];
    /** The default view's distance after fitting `framePoints()` to the canvas (0 until fitted). */
    private fittedDistance = 0;
    /** Set once the user zooms: from then on a resize leaves the distance alone. */
    private userZoomed = false;
    private sky?: THREE.Texture;
    /** The fog's start and end at the home view (pushed back as the camera backs off). */
    private fogBase = { near: 4, far: 14 };
    private frameRequested = 0;
    private readonly resize: ResizeObserver;

    constructor(protected readonly host: HTMLElement, protected readonly defaultView: StageView, canvasClass: string) {
        this.view = { ...defaultView };
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // Filmic response and studio reflections: what makes plastic read as plastic.
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.domElement.className = canvasClass;
        host.appendChild(this.renderer.domElement);

        const environment = studioEnvironment(this.renderer);
        this.scene.environment = environment;
        this.scene.environmentIntensity = 0.35;

        this.camera.up.set(0, 0, 1);
        this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x2f4a2a, 0.3);
        this.hemi.position.set(0, 0, 1);
        this.sun = new THREE.DirectionalLight(0xfff2e0, 2.8);
        this.sun.position.set(1.2, -1.4, 2.6);
        this.sun.castShadow = true;
        const shadowMap = isSmallDevice() ? 2048 : 4096;
        this.sun.shadow.mapSize.set(shadowMap, shadowMap);
        this.sun.shadow.camera.near = 0.5;
        this.sun.shadow.camera.far = 8;
        this.sun.shadow.bias = -0.0002;
        this.sun.shadow.normalBias = 0.0004;
        this.scene.add(this.hemi, this.sun, this.sun.target);
        this.disposers.push(() => {
            environment.dispose();
            this.sky?.dispose();
        });

        this.bindControls();
        this.resize = new ResizeObserver(() => this.fit());
        this.resize.observe(host);
        this.fit();
    }

    setFollow(follow: boolean): void {
        this.follow = follow;
        this.invalidate();
    }

    setCameraMode(mode: CameraMode): void {
        this.cameraMode = mode;
        this.invalidate();
    }

    /**
     * The robot's heading from the replay: a big jump (a seek, a new run)
     * snaps, a walking wobble is eased.
     */
    protected setFollowHeading(heading: number): void {
        const jump = Math.abs(Math.atan2(Math.sin(heading - this.followHeading), Math.cos(heading - this.followHeading)));
        this.followHeading = jump > Math.PI / 3 ? heading : easeAngle(this.followHeading, heading, 0.35);
    }

    resetView(): void {
        this.view = { ...this.defaultView };
        this.userZoomed = false;
        this.home();
        this.frameView();
        this.invalidate();
    }

    dispose(): void {
        cancelAnimationFrame(this.frameRequested);
        this.resize.disconnect();
        this.disposers.forEach(d => d());
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    /** Puts `target` back where the stage starts looking. */
    protected abstract home(): void;

    /**
     * What the default view must keep in frame (the robot's start, the ball,
     * the goal...). The camera distance is fitted to these for the canvas's
     * shape, so a tall phone panel shows the same things as a wide one.
     */
    protected framePoints(): THREE.Vector3[] {
        return [];
    }

    /**
     * Fits the default distance to `framePoints()` for the current canvas,
     * unless the user has zoomed. Stages call it after `home()`.
     */
    protected frameView(): void {
        const points = this.framePoints();
        this.fittedDistance = points.length > 0 ? distanceToFit(points, this.target, this.view, CAMERA_FOV.orbit, this.camera.aspect) : 0;
        if (!this.userZoomed && this.fittedDistance > 0) {
            this.view.distance = this.fittedDistance;
        }
    }

    protected setSky(palette: SkyPalette, fogNear = 4, fogFar = 14): void {
        this.sky?.dispose();
        this.sky = new THREE.CanvasTexture(skyCanvas(palette.skyTop, palette.horizon));
        this.sky.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = this.sky;
        // Distant ground fades into the horizon instead of ending at an edge.
        this.scene.fog = new THREE.Fog(new THREE.Color(palette.horizon), fogNear, fogFar);
        this.fogBase = { near: fogNear, far: fogFar };
        this.renderer.toneMappingExposure = palette.exposure;
    }

    /** Points the sun's shadow at a square of half-size `reach` around (cx, cy), as sharp as the map allows. */
    protected fitShadow(cx: number, cy: number, reach: number, height = 2.6): void {
        const cam = this.sun.shadow.camera;
        cam.left = -reach;
        cam.right = reach;
        cam.top = reach;
        cam.bottom = -reach;
        cam.far = Math.max(8, height * 3);
        cam.updateProjectionMatrix();
        this.sun.target.position.set(cx, cy, 0);
        this.sun.position.set(cx + height * 0.46, cy - height * 0.54, height);
    }

    protected invalidate(): void {
        if (this.frameRequested) {
            return;
        }
        this.frameRequested = requestAnimationFrame(() => {
            this.frameRequested = 0;
            this.render();
        });
    }

    private render(): void {
        const mode = this.cameraMode;
        if (this.camera.fov !== CAMERA_FOV[mode]) {
            this.camera.fov = CAMERA_FOV[mode];
            this.camera.updateProjectionMatrix();
        }
        if (mode === 'chase' || mode === 'eyes') {
            const shot = (mode === 'chase' ? chaseShot : eyesShot)(this.followAt.x, this.followAt.y, this.followHeading);
            this.camera.position.set(...shot.position);
            this.camera.lookAt(...shot.lookAt);
        } else if (mode === 'wide') {
            const wide: StageView = { azimuth: this.defaultView.azimuth, elevation: 62, distance: this.view.distance };
            const points = this.framePoints();
            const fitted = points.length > 0 ? distanceToFit(points, this.target, wide, CAMERA_FOV.wide, this.camera.aspect) : this.defaultView.distance;
            // Some room around the field, so the whole pitch reads as a place.
            orbitPosition(this.target, wide, fitted * 1.3, this.camera.position);
            this.camera.lookAt(this.target);
        } else {
            const target = this.follow ? this.followAt : this.target;
            orbitPosition(target, this.view, this.view.distance, this.camera.position);
            this.camera.lookAt(target);
        }
        this.followFog(mode === 'chase' || mode === 'eyes' ? 0 : this.camera.position.distanceTo(this.follow && mode === 'orbit' ? this.followAt : this.target));
        this.renderer.render(this.scene, this.camera);
    }

    /** Keeps the fog behind the stage however far the camera has backed off. */
    private followFog(distance: number): void {
        const fog = this.scene.fog;
        if (!(fog instanceof THREE.Fog)) {
            return;
        }
        const range = fogRange(distance, this.fittedDistance || this.defaultView.distance, this.fogBase.near, this.fogBase.far);
        fog.near = range.near;
        fog.far = range.far;
        // Past the fog's end everything is horizon-coloured; the far plane
        // must not cut the ground off before it gets there.
        const far = Math.max(60, range.far * 1.5);
        if (this.camera.far !== far) {
            this.camera.far = far;
            this.camera.updateProjectionMatrix();
        }
    }

    /**
     * One picture of the stage from `shot`, `width` x `height` pixels, as a
     * JPEG data URL. The canvas goes back to its own size afterwards.
     */
    protected snapshot(shot: RobotShot, width: number, height: number, fov = 42, quality = 0.84): string {
        const size = this.renderer.getSize(new THREE.Vector2());
        const ratio = this.renderer.getPixelRatio();
        const cam = new THREE.PerspectiveCamera(fov, width / height, 0.01, 60);
        cam.up.copy(this.camera.up);
        cam.position.set(...shot.position);
        cam.lookAt(...shot.lookAt);
        try {
            this.renderer.setPixelRatio(1);
            this.renderer.setSize(width, height, false);
            this.renderer.render(this.scene, cam);
            // Read in the same task as the render, before the buffer is cleared.
            return this.renderer.domElement.toDataURL('image/jpeg', quality);
        } finally {
            this.renderer.setPixelRatio(ratio);
            this.renderer.setSize(size.x, size.y, false);
            this.invalidate();
        }
    }

    private fit(): void {
        const w = Math.max(1, this.host.clientWidth);
        const h = Math.max(1, this.host.clientHeight);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.frameView();
        this.invalidate();
    }

    /** Drag to orbit, wheel or pinch to zoom, double-click to reset. */
    private bindControls(): void {
        const el = this.renderer.domElement;
        const pointers = new Map<number, { x: number; y: number }>();
        let pinch = 0;
        const down = (e: PointerEvent) => {
            el.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            pinch = pinchDistance(pointers);
        };
        const move = (e: PointerEvent) => {
            const last = pointers.get(e.pointerId);
            if (!last) {
                return;
            }
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size >= 2) {
                const now = pinchDistance(pointers);
                if (pinch > 0 && now > 0) {
                    this.zoom(pinch / now);
                }
                pinch = now;
                return;
            }
            this.view.azimuth -= (e.clientX - last.x) * 0.4;
            this.view.elevation = clamp(this.view.elevation + (e.clientY - last.y) * 0.3, 5, 85);
            this.invalidate();
        };
        const up = (e: PointerEvent) => {
            pointers.delete(e.pointerId);
            pinch = pinchDistance(pointers);
        };
        const wheel = (e: WheelEvent) => {
            e.preventDefault();
            this.zoom(Math.exp(e.deltaY * 0.001));
        };
        const reset = () => this.resetView();
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('wheel', wheel, { passive: false });
        el.addEventListener('dblclick', reset);
        el.style.touchAction = 'none';
        this.disposers.push(() => {
            el.removeEventListener('pointerdown', down);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', up);
            el.removeEventListener('wheel', wheel);
            el.removeEventListener('dblclick', reset);
        });
    }

    private zoom(factor: number): void {
        const base = this.fittedDistance || this.defaultView.distance;
        this.userZoomed = true;
        this.view.distance = clamp(this.view.distance * factor, base / 8, base * 3);
        this.invalidate();
    }
}

function pinchDistance(pointers: Map<number, { x: number; y: number }>): number {
    if (pointers.size < 2) {
        return 0;
    }
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}
