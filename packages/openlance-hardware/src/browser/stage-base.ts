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
import { skyCanvas } from './stage-textures';
import { studioEnvironment } from './studio-environment';

export interface StageView {
    /** Degrees around the target, 0 = looking along +x. */
    azimuth: number;
    /** Degrees above the ground. */
    elevation: number;
    distance: number;
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
    protected readonly disposers: Array<() => void> = [];
    private sky?: THREE.Texture;
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

    resetView(): void {
        this.view = { ...this.defaultView };
        this.home();
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

    protected setSky(palette: SkyPalette, fogNear = 4, fogFar = 14): void {
        this.sky?.dispose();
        this.sky = new THREE.CanvasTexture(skyCanvas(palette.skyTop, palette.horizon));
        this.sky.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = this.sky;
        // Distant ground fades into the horizon instead of ending at an edge.
        this.scene.fog = new THREE.Fog(new THREE.Color(palette.horizon), fogNear, fogFar);
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
        const target = this.follow ? this.followAt : this.target;
        const az = (this.view.azimuth * Math.PI) / 180;
        const el = (this.view.elevation * Math.PI) / 180;
        const d = this.view.distance;
        this.camera.position.set(
            target.x - d * Math.cos(el) * Math.cos(az),
            target.y - d * Math.cos(el) * Math.sin(az),
            target.z + d * Math.sin(el),
        );
        this.camera.lookAt(target);
        this.renderer.render(this.scene, this.camera);
    }

    private fit(): void {
        const w = Math.max(1, this.host.clientWidth);
        const h = Math.max(1, this.host.clientHeight);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
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
        this.view.distance = clamp(this.view.distance * factor, this.defaultView.distance / 8, this.defaultView.distance * 3);
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
