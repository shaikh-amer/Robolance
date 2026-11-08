// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * A studio for one model: soft studio reflections, a key light with a soft
 * shadow on a ground disc, an orbit camera (drag to orbit, right-drag or
 * two fingers to pan, wheel or pinch to zoom, double-click to reset) and
 * rendering on demand. +z is up (models come upright from parseModel).
 */

import * as THREE from 'three';
import { orbitPosition, panDelta, type OrbitAngles } from './frame-fit';
import { clipPlanes, fitDistance } from './model-fit';
import { studioEnvironment } from './studio-environment';

const FOV = 35;
// From the front-left: glTF models face +z, which is -y on this z-up stage.
const HOME: OrbitAngles = { azimuth: 60, elevation: 22 };

export interface StageColors {
    background: string;
    ground: string;
}

export class ModelStage {
    readonly renderer: THREE.WebGLRenderer;
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000);
    private readonly ground: THREE.Mesh;
    private readonly key: THREE.DirectionalLight;
    private model: THREE.Object3D | undefined;
    private mixer: THREE.AnimationMixer | undefined;
    private clips: THREE.AnimationClip[] = [];
    private readonly clock = new THREE.Clock();
    private angles: OrbitAngles = { ...HOME };
    private target = new THREE.Vector3();
    private distance = 5;
    private home = { target: new THREE.Vector3(), distance: 5 };
    private radius = 1;
    private frame = 0;
    private playing = false;
    private wireframe = false;
    private readonly cleanup: Array<() => void> = [];
    private resizeObserver: ResizeObserver | undefined;

    constructor(private readonly host: HTMLElement, colors: StageColors = { background: '#1e1e1e', ground: '#2a2a2a' }) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.domElement.style.display = 'block';
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.renderer.domElement.style.touchAction = 'none';
        host.appendChild(this.renderer.domElement);

        this.camera.up.set(0, 0, 1);
        this.scene.background = new THREE.Color(colors.background);
        this.scene.environment = studioEnvironment(this.renderer);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.4));
        this.key = new THREE.DirectionalLight(0xffffff, 1.6);
        this.key.castShadow = true;
        this.key.shadow.mapSize.set(2048, 2048);
        this.key.shadow.bias = -0.0005;
        this.scene.add(this.key, this.key.target);
        this.ground = new THREE.Mesh(
            new THREE.CircleGeometry(1, 64),
            new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.28 }),
        );
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: colors.ground, roughness: 1 }));
        disc.name = 'floor';
        disc.position.z = -0.0001;
        this.ground.add(disc);

        this.bindPointer();
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(host);
        this.resize();
    }

    /** Shows `root` (from parseModel) and frames it. */
    setModel(root: THREE.Object3D, animations: THREE.AnimationClip[] = []): void {
        if (this.model) {
            this.scene.remove(this.model);
        }
        this.mixer?.stopAllAction();
        this.model = root;
        this.clips = animations;
        this.mixer = animations.length > 0 ? new THREE.AnimationMixer(root) : undefined;
        root.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) {
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            }
        });
        this.scene.add(root);
        this.setWireframe(this.wireframe);
        this.frameModel();
    }

    /** Frames the model again and resets the view angles. */
    frameModel(): void {
        if (!this.model) {
            return;
        }
        const box = new THREE.Box3().setFromObject(this.model);
        if (box.isEmpty()) {
            return;
        }
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        this.radius = Math.max(sphere.radius, 1e-4);
        // Stand the model on the ground at z=0.
        const lift = -box.min.z;
        this.model.position.z += lift;
        sphere.center.z += lift;
        this.ground.position.set(sphere.center.x, sphere.center.y, 0);
        this.ground.scale.setScalar(this.radius * 3);
        this.key.position.set(sphere.center.x - this.radius * 2, sphere.center.y - this.radius * 3, this.radius * 5);
        this.key.target.position.copy(sphere.center);
        const cam = this.key.shadow.camera as THREE.OrthographicCamera;
        cam.left = cam.bottom = -this.radius * 2;
        cam.right = cam.top = this.radius * 2;
        cam.near = 0.01 * this.radius;
        cam.far = this.radius * 12;
        cam.updateProjectionMatrix();
        this.target.copy(sphere.center);
        this.distance = fitDistance(this.radius, FOV, this.aspect());
        this.home = { target: this.target.clone(), distance: this.distance };
        this.angles = { ...HOME };
        this.requestRender();
    }

    setWireframe(on: boolean): void {
        this.wireframe = on;
        this.model?.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) {
                return;
            }
            for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                if (m && 'wireframe' in m) {
                    (m as THREE.MeshStandardMaterial).wireframe = on;
                }
            }
        });
        this.requestRender();
    }

    get animationNames(): string[] {
        return this.clips.map((c, i) => c.name || `Animation ${i + 1}`);
    }

    /** Plays clip `index` on a loop; undefined stops. */
    playAnimation(index: number | undefined): void {
        if (!this.mixer) {
            return;
        }
        this.mixer.stopAllAction();
        this.playing = index !== undefined && index >= 0 && index < this.clips.length;
        if (this.playing) {
            this.mixer.clipAction(this.clips[index!]).reset().play();
            this.clock.start();
        }
        this.requestRender();
    }

    resetView(): void {
        this.target.copy(this.home.target);
        this.distance = this.home.distance;
        this.angles = { ...HOME };
        this.requestRender();
    }

    /** The current frame as a PNG data URL. */
    snapshot(): string {
        this.render();
        return this.renderer.domElement.toDataURL('image/png');
    }

    dispose(): void {
        cancelAnimationFrame(this.frame);
        this.resizeObserver?.disconnect();
        this.cleanup.forEach((f) => f());
        this.mixer?.stopAllAction();
        this.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) {
                mesh.geometry?.dispose();
                for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                    m?.dispose();
                }
            }
        });
        this.scene.environment?.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    private aspect(): number {
        const w = this.host.clientWidth || 1;
        const h = this.host.clientHeight || 1;
        return w / h;
    }

    private resize(): void {
        const w = Math.max(1, this.host.clientWidth);
        const h = Math.max(1, this.host.clientHeight);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.requestRender();
    }

    requestRender(): void {
        if (this.frame) {
            return;
        }
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.render();
            if (this.playing) {
                this.requestRender();
            }
        });
    }

    private render(): void {
        if (this.mixer && this.playing) {
            this.mixer.update(this.clock.getDelta());
        }
        orbitPosition(this.target, this.angles, this.distance, this.camera.position);
        const clip = clipPlanes(this.distance, this.radius);
        this.camera.near = clip.near;
        this.camera.far = clip.far;
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(this.target);
        this.renderer.render(this.scene, this.camera);
    }

    private bindPointer(): void {
        const el = this.renderer.domElement;
        const pointers = new Map<number, { x: number; y: number; button: number }>();
        let pinchStart = 0;
        const onDown = (e: PointerEvent) => {
            el.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
            }
        };
        const onMove = (e: PointerEvent) => {
            const prev = pointers.get(e.pointerId);
            if (!prev) {
                return;
            }
            const dx = e.clientX - prev.x;
            const dy = e.clientY - prev.y;
            pointers.set(e.pointerId, { ...prev, x: e.clientX, y: e.clientY });
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (pinchStart > 0 && d > 0) {
                    this.zoom(pinchStart / d);
                }
                pinchStart = d;
                this.pan(dx / 2, dy / 2);
                return;
            }
            if (prev.button === 2 || e.shiftKey) {
                this.pan(dx, dy);
            } else {
                this.angles.azimuth -= dx * 0.4;
                this.angles.elevation = Math.max(-85, Math.min(85, this.angles.elevation + dy * 0.3));
                this.requestRender();
            }
        };
        const onUp = (e: PointerEvent) => {
            pointers.delete(e.pointerId);
            pinchStart = 0;
        };
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            this.zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
        };
        const onDouble = () => this.resetView();
        const onMenu = (e: Event) => e.preventDefault();
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onUp);
        el.addEventListener('wheel', onWheel, { passive: false });
        el.addEventListener('dblclick', onDouble);
        el.addEventListener('contextmenu', onMenu);
        this.cleanup.push(() => {
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            el.removeEventListener('pointercancel', onUp);
            el.removeEventListener('wheel', onWheel);
            el.removeEventListener('dblclick', onDouble);
            el.removeEventListener('contextmenu', onMenu);
        });
    }

    private zoom(factor: number): void {
        this.distance = Math.max(this.radius * 0.05, Math.min(this.radius * 200, this.distance * factor));
        this.requestRender();
    }

    private pan(dx: number, dy: number): void {
        const d = panDelta(this.angles, this.distance, dx, dy, this.host.clientHeight || 1, FOV);
        this.target.add(d);
        this.requestRender();
    }
}
