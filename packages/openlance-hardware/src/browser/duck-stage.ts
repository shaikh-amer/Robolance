// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The 3D pitch for Microduck replays: the duck's real meshes posed from a
 * replay frame, the ball, the goal and the path so far. Plain three.js
 * behind a small API (setField, show, setTheme, dispose) so the React side
 * only passes data. Renders on demand, not in a loop.
 */

import * as THREE from 'three';
import {
    BALL_RADIUS, GOAL_HEIGHT, NET_DEPTH, POST_RADIUS, bodyPoses, decodeMesh, geomPose,
    type BodyPose, type FieldSpec, type ViewerModel,
} from 'robolance-duck-sim/viewer';

interface Palette {
    background: number;
    grassA: string;
    grassB: string;
    line: string;
    trail: number;
}

const PALETTES: Record<'light' | 'dark', Palette> = {
    light: { background: 0xe9eef2, grassA: '#4f9a58', grassB: '#47904f', line: 'rgba(255,255,255,0.9)', trail: 0xd97706 },
    dark: { background: 0x1b1d21, grassA: '#3d7d46', grassB: '#367240', line: 'rgba(255,255,255,0.85)', trail: 0xfbbf24 },
};

export interface StageView {
    /** Degrees around the target, 0 = looking along +x. */
    azimuth: number;
    /** Degrees above the pitch. */
    elevation: number;
    distance: number;
}

/** A broadcast-style side view: the duck starts on the left, the goal is on the right. */
export const DEFAULT_VIEW: StageView = { azimuth: 72, elevation: 30, distance: 1.9 };

export class DuckStage {
    readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 60);
    private readonly duck = new THREE.Group();
    private readonly parts: THREE.Mesh[] = [];
    private readonly ball: THREE.Mesh;
    private readonly pitch = new THREE.Group();
    private trail?: THREE.Line;
    private ballIndex = -1;
    private field?: FieldSpec;
    private palette: Palette = PALETTES.dark;
    private view: StageView = { ...DEFAULT_VIEW };
    private target = new THREE.Vector3();
    private follow = false;
    private duckAt = new THREE.Vector3();
    private frameRequested = 0;
    private readonly resize: ResizeObserver;
    private readonly disposers: Array<() => void> = [];

    constructor(private readonly host: HTMLElement, private readonly model: ViewerModel) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.domElement.className = 'robolance-duck-canvas';
        host.appendChild(this.renderer.domElement);

        this.camera.up.set(0, 0, 1);
        const hemi = new THREE.HemisphereLight(0xffffff, 0x4a6b4f, 1.1);
        hemi.position.set(0, 0, 1);
        const sun = new THREE.DirectionalLight(0xffffff, 1.8);
        sun.position.set(1.2, -1.4, 2.6);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -1.6;
        sun.shadow.camera.right = 1.6;
        sun.shadow.camera.top = 1.6;
        sun.shadow.camera.bottom = -1.6;
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 6;
        sun.shadow.bias = -0.0005;
        this.scene.add(hemi, sun, sun.target, this.pitch, this.duck);

        const geometries = model.meshes.map(mesh => {
            const { positions, indices } = decodeMesh(mesh);
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            g.setIndex(new THREE.BufferAttribute(indices, 1));
            g.computeVertexNormals();
            return g;
        });
        const materials = new Map<string, THREE.MeshStandardMaterial>();
        for (const geom of model.geoms) {
            const key = geom.rgba.join(',');
            let material = materials.get(key);
            if (!material) {
                material = new THREE.MeshStandardMaterial({
                    color: new THREE.Color(geom.rgba[0], geom.rgba[1], geom.rgba[2]),
                    roughness: 0.55,
                    metalness: 0.05,
                    transparent: geom.rgba[3] < 1,
                    opacity: geom.rgba[3],
                });
                materials.set(key, material);
            }
            const part = new THREE.Mesh(geometries[geom.mesh], material);
            part.castShadow = true;
            this.parts.push(part);
            this.duck.add(part);
        }
        this.disposers.push(() => {
            geometries.forEach(g => g.dispose());
            materials.forEach(m => m.dispose());
        });
        this.ballIndex = model.bodies.findIndex(b => b.name === 'football');

        const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xf28c28, roughness: 0.45 });
        this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 20), ballMaterial);
        this.ball.castShadow = true;
        this.scene.add(this.ball);
        this.disposers.push(() => {
            this.ball.geometry.dispose();
            ballMaterial.dispose();
        });

        this.bindControls();
        this.resize = new ResizeObserver(() => this.fit());
        this.resize.observe(host);
        this.fit();
    }

    setTheme(theme: 'light' | 'dark'): void {
        this.palette = PALETTES[theme];
        this.scene.background = new THREE.Color(this.palette.background);
        if (this.field) {
            this.buildPitch(this.field);
        }
        this.invalidate();
    }

    setField(field: FieldSpec): void {
        const same = this.field && JSON.stringify(this.field) === JSON.stringify(field);
        this.field = field;
        if (!same) {
            this.buildPitch(field);
            this.target.set((field.duck.x + field.goal.x) / 2, (field.duck.y + field.goal.y) / 2, 0.05);
        }
        this.invalidate();
    }

    setFollow(follow: boolean): void {
        this.follow = follow;
        this.invalidate();
    }

    resetView(): void {
        this.view = { ...DEFAULT_VIEW };
        if (this.field) {
            this.target.set((this.field.duck.x + this.field.goal.x) / 2, (this.field.duck.y + this.field.goal.y) / 2, 0.05);
        }
        this.invalidate();
    }

    /** Poses the duck and the ball from a replay frame and draws the path walked so far. */
    show(frame: ArrayLike<number> | undefined, path: Array<[number, number]>): void {
        if (frame && frame.length >= this.model.nq) {
            const poses = bodyPoses(this.model, frame);
            this.model.geoms.forEach((geom, i) => place(this.parts[i], geomPose(poses[geom.body], geom)));
            if (this.ballIndex >= 0) {
                place(this.ball, poses[this.ballIndex]);
            }
            const trunk = poses[1];
            this.duckAt.set(trunk.pos[0], trunk.pos[1], 0.08);
        }
        this.setTrail(path);
        this.invalidate();
    }

    dispose(): void {
        cancelAnimationFrame(this.frameRequested);
        this.resize.disconnect();
        this.disposers.forEach(d => d());
        this.clearPitch();
        this.trail?.geometry.dispose();
        (this.trail?.material as THREE.Material | undefined)?.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    private invalidate(): void {
        if (this.frameRequested) {
            return;
        }
        this.frameRequested = requestAnimationFrame(() => {
            this.frameRequested = 0;
            this.render();
        });
    }

    private render(): void {
        const target = this.follow ? this.duckAt : this.target;
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
        this.view.distance = clamp(this.view.distance * factor, 0.25, 6);
        this.invalidate();
    }

    private clearPitch(): void {
        for (const child of [...this.pitch.children]) {
            this.pitch.remove(child);
            const mesh = child as THREE.Mesh;
            mesh.geometry?.dispose();
            const material = mesh.material as THREE.MeshStandardMaterial | undefined;
            material?.map?.dispose();
            material?.dispose();
        }
    }

    private buildPitch(f: FieldSpec): void {
        this.clearPitch();
        const width = f.bounds.xMax - f.bounds.xMin;
        const depth = f.bounds.yMax - f.bounds.yMin;
        // A margin of grass around the playing area.
        const margin = 0.25;
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(width + 2 * margin, depth + 2 * margin),
            new THREE.MeshStandardMaterial({ map: pitchTexture(f, margin, this.palette), roughness: 1 }),
        );
        ground.position.set((f.bounds.xMin + f.bounds.xMax) / 2, (f.bounds.yMin + f.bounds.yMax) / 2, 0);
        ground.receiveShadow = true;
        this.pitch.add(ground);

        const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 });
        const y1 = f.goal.y - f.goal.width / 2;
        const y2 = f.goal.y + f.goal.width / 2;
        for (const y of [y1, y2]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, GOAL_HEIGHT, 16), white);
            post.rotation.x = Math.PI / 2;
            post.position.set(f.goal.x, y, GOAL_HEIGHT / 2);
            post.castShadow = true;
            this.pitch.add(post);
        }
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, f.goal.width, 16), white.clone());
        bar.position.set(f.goal.x, f.goal.y, GOAL_HEIGHT);
        bar.castShadow = true;
        this.pitch.add(bar);

        const net = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
        const back = new THREE.Mesh(new THREE.PlaneGeometry(f.goal.width, GOAL_HEIGHT), net);
        back.rotation.set(Math.PI / 2, Math.PI / 2, 0);
        back.position.set(f.goal.x + NET_DEPTH, f.goal.y, GOAL_HEIGHT / 2);
        this.pitch.add(back);
        for (const y of [y1, y2]) {
            const side = new THREE.Mesh(new THREE.PlaneGeometry(NET_DEPTH, GOAL_HEIGHT), net.clone());
            side.rotation.x = Math.PI / 2;
            side.position.set(f.goal.x + NET_DEPTH / 2, y, GOAL_HEIGHT / 2);
            this.pitch.add(side);
        }
        const roof = new THREE.Mesh(new THREE.PlaneGeometry(NET_DEPTH, f.goal.width), net.clone());
        roof.position.set(f.goal.x + NET_DEPTH / 2, f.goal.y, GOAL_HEIGHT);
        this.pitch.add(roof);
    }

    private setTrail(path: Array<[number, number]>): void {
        if (this.trail) {
            this.scene.remove(this.trail);
            this.trail.geometry.dispose();
            (this.trail.material as THREE.Material).dispose();
            this.trail = undefined;
        }
        if (path.length < 2) {
            return;
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(path.map(([x, y]) => new THREE.Vector3(x, y, 0.002)));
        this.trail = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: this.palette.trail, transparent: true, opacity: 0.85 }));
        this.scene.add(this.trail);
    }
}

function place(object: THREE.Object3D, pose: BodyPose): void {
    object.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    // MuJoCo stores w first; three.js takes x, y, z, w.
    object.quaternion.set(pose.quat[1], pose.quat[2], pose.quat[3], pose.quat[0]);
}

/** Mown stripes, the boundary and the goal line, drawn once per pitch. */
function pitchTexture(f: FieldSpec, margin: number, palette: Palette): THREE.CanvasTexture {
    const width = f.bounds.xMax - f.bounds.xMin + 2 * margin;
    const depth = f.bounds.yMax - f.bounds.yMin + 2 * margin;
    const px = 512 / Math.max(width, depth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * px);
    canvas.height = Math.round(depth * px);
    const ctx = canvas.getContext('2d')!;
    // Canvas x runs with field x; canvas y runs against field y.
    const cx = (x: number) => (x - f.bounds.xMin + margin) * px;
    const cy = (y: number) => (f.bounds.yMax + margin - y) * px;
    const stripe = 0.2;
    for (let i = 0; i * stripe < width; i++) {
        ctx.fillStyle = i % 2 === 0 ? palette.grassA : palette.grassB;
        ctx.fillRect(i * stripe * px, 0, stripe * px + 1, canvas.height);
    }
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = Math.max(2, 0.012 * px);
    ctx.strokeRect(cx(f.bounds.xMin), cy(f.bounds.yMax), (f.bounds.xMax - f.bounds.xMin) * px, (f.bounds.yMax - f.bounds.yMin) * px);
    ctx.beginPath();
    ctx.moveTo(cx(f.goal.x), cy(f.bounds.yMax));
    ctx.lineTo(cx(f.goal.x), cy(f.bounds.yMin));
    ctx.stroke();
    // The penalty spot where the ball starts.
    ctx.fillStyle = palette.line;
    ctx.beginPath();
    ctx.arc(cx(f.ball.x), cy(f.ball.y), Math.max(2, 0.01 * px), 0, Math.PI * 2);
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

function pinchDistance(pointers: Map<number, { x: number; y: number }>): number {
    if (pointers.size < 2) {
        return 0;
    }
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}
