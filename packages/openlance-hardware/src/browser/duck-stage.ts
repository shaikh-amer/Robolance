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
    BALL_RADIUS, GOAL_HEIGHT, NET_DEPTH, POST_RADIUS, bodyPoses, decodeMesh, geomPose, partSurface,
    type BodyPose, type FieldSpec, type ViewerModel,
} from 'robolance-duck-sim/viewer';
import { creasedNormals } from './crease';
import { netCanvas, paintPatches, paintTurf, seededRandom, skyCanvas } from './stage-textures';
import { studioEnvironment } from './studio-environment';

interface Palette {
    /** Sky at the zenith and at the horizon (the fog fades into the horizon). */
    skyTop: string;
    horizon: string;
    grassA: string;
    grassB: string;
    /** Turf around the pitch. */
    rough: string;
    line: string;
    trail: number;
    exposure: number;
}

const PALETTES: Record<'light' | 'dark', Palette> = {
    light: {
        skyTop: '#8fb8dc', horizon: '#d9e2e4', grassA: '#3b6b30', grassB: '#35622b', rough: '#2f5726',
        line: 'rgba(250,250,245,0.92)', trail: 0xd97706, exposure: 1.0,
    },
    dark: {
        skyTop: '#0f141b', horizon: '#2a3138', grassA: '#386830', grassB: '#325e2b', rough: '#2a5024',
        line: 'rgba(245,245,240,0.88)', trail: 0xfbbf24, exposure: 0.95,
    },
};

/** Phones get smaller shadow maps and textures; the picture is the same. */
function isSmallDevice(): boolean {
    return typeof window !== 'undefined' && Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 1024) < 700;
}

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
    private readonly sun: THREE.DirectionalLight;
    private readonly hemi: THREE.HemisphereLight;
    private sky?: THREE.Texture;
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
        this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // Filmic response and studio reflections: what makes plastic read as plastic.
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.domElement.className = 'robolance-duck-canvas';
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
        this.scene.add(this.hemi, this.sun, this.sun.target, this.pitch, this.duck);

        const geometries = model.meshes.map(mesh => {
            const { positions, indices } = decodeMesh(mesh);
            // Hard edges where the CAD part has them, smooth shells elsewhere.
            const shaded = creasedNormals(positions, indices);
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(shaded.positions, 3));
            g.setAttribute('normal', new THREE.BufferAttribute(shaded.normals, 3));
            return g;
        });
        const materials = new Map<string, THREE.MeshPhysicalMaterial>();
        for (const geom of model.geoms) {
            const surface = partSurface(geom);
            const key = `${geom.rgba.join(',')}|${surface.roughness},${surface.metalness},${surface.clearcoat}`;
            let material = materials.get(key);
            if (!material) {
                material = new THREE.MeshPhysicalMaterial({
                    // MuJoCo colours are display colours; three.js wants them linear.
                    color: new THREE.Color().setRGB(geom.rgba[0], geom.rgba[1], geom.rgba[2], THREE.SRGBColorSpace),
                    roughness: surface.roughness,
                    metalness: surface.metalness,
                    clearcoat: surface.clearcoat,
                    clearcoatRoughness: 0.35,
                    transparent: geom.rgba[3] < 1,
                    opacity: geom.rgba[3],
                });
                materials.set(key, material);
            }
            const part = new THREE.Mesh(geometries[geom.mesh], material);
            part.castShadow = true;
            part.receiveShadow = true;
            this.parts.push(part);
            this.duck.add(part);
        }
        this.disposers.push(() => {
            geometries.forEach(g => g.dispose());
            materials.forEach(m => m.dispose());
            environment.dispose();
            this.sky?.dispose();
        });
        this.ballIndex = model.bodies.findIndex(b => b.name === 'football');

        const ballMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf07d1e, roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.3 });
        this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 48, 32), ballMaterial);
        this.ball.castShadow = true;
        this.ball.receiveShadow = true;
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
        this.sky?.dispose();
        this.sky = new THREE.CanvasTexture(skyCanvas(this.palette.skyTop, this.palette.horizon));
        this.sky.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = this.sky;
        // Distant turf fades into the horizon instead of ending at an edge.
        this.scene.fog = new THREE.Fog(new THREE.Color(this.palette.horizon), 4, 14);
        this.renderer.toneMappingExposure = this.palette.exposure;
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
        // A record without replay frames has nothing to pose: hide the duck and ball rather than pile them at the origin.
        const posable = Boolean(frame && frame.length >= this.model.nq);
        this.duck.visible = posable;
        this.ball.visible = posable;
        if (frame && posable) {
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
            material?.bumpMap?.dispose();
            material?.alphaMap?.dispose();
            material?.dispose();
        }
    }

    private buildPitch(f: FieldSpec): void {
        this.clearPitch();
        const width = f.bounds.xMax - f.bounds.xMin;
        const depth = f.bounds.yMax - f.bounds.yMin;
        const cx = (f.bounds.xMin + f.bounds.xMax) / 2;
        const cy = (f.bounds.yMin + f.bounds.yMax) / 2;
        // A margin of grass around the playing area.
        const margin = 0.25;
        const turf = pitchTextures(f, margin, this.palette);
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(width + 2 * margin, depth + 2 * margin),
            new THREE.MeshStandardMaterial({ map: turf.color, bumpMap: turf.bump, bumpScale: 0.6, roughness: 0.95 }),
        );
        ground.position.set(cx, cy, 0);
        ground.receiveShadow = true;
        this.pitch.add(ground);

        // Turf to the horizon around the pitch, a hair lower so the two never fight.
        const rough = roughTextures(this.palette);
        const surround = new THREE.Mesh(
            new THREE.CircleGeometry(16, 64),
            new THREE.MeshStandardMaterial({ map: rough.color, bumpMap: rough.bump, bumpScale: 0.6, roughness: 1 }),
        );
        surround.position.set(cx, cy, -0.0008);
        surround.receiveShadow = true;
        this.pitch.add(surround);

        // The sun's shadow covers the pitch and its margin, as sharp as the map allows.
        const reach = Math.max(width, depth) / 2 + margin + 0.2;
        const cam = this.sun.shadow.camera;
        cam.left = -reach;
        cam.right = reach;
        cam.top = reach;
        cam.bottom = -reach;
        cam.updateProjectionMatrix();
        this.sun.target.position.set(cx, cy, 0);
        this.sun.position.set(cx + 1.2, cy - 1.4, 2.6);

        const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.35, metalness: 0.15 });
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

        const netTexture = (across: number, up: number): THREE.CanvasTexture => {
            const t = new THREE.CanvasTexture(netCanvas());
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            // A 1.5 cm mesh, the duck-scale version of a real net.
            t.repeat.set(across / 0.015, up / 0.015);
            t.anisotropy = 4;
            return t;
        };
        // Blended, not cut out: at a few metres the 1.5 cm mesh should read as a fine haze of cord, as it does on camera.
        const netMaterial = (across: number, up: number) => new THREE.MeshStandardMaterial({
            color: 0xffffff, alphaMap: netTexture(across, up), transparent: true, opacity: 0.9,
            depthWrite: false, side: THREE.DoubleSide, roughness: 0.8,
        });
        const net = netMaterial(f.goal.width, GOAL_HEIGHT);
        const back = new THREE.Mesh(new THREE.PlaneGeometry(f.goal.width, GOAL_HEIGHT), net);
        back.rotation.set(Math.PI / 2, Math.PI / 2, 0);
        back.position.set(f.goal.x + NET_DEPTH, f.goal.y, GOAL_HEIGHT / 2);
        this.pitch.add(back);
        for (const y of [y1, y2]) {
            const side = new THREE.Mesh(new THREE.PlaneGeometry(NET_DEPTH, GOAL_HEIGHT), netMaterial(NET_DEPTH, GOAL_HEIGHT));
            side.rotation.x = Math.PI / 2;
            side.position.set(f.goal.x + NET_DEPTH / 2, y, GOAL_HEIGHT / 2);
            this.pitch.add(side);
        }
        const roof = new THREE.Mesh(new THREE.PlaneGeometry(NET_DEPTH, f.goal.width), netMaterial(NET_DEPTH, f.goal.width));
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

/**
 * Mown stripes, the boundary, the goal line and the spot, under a layer of
 * grass blades, plus a matching bump map. Drawn once per pitch.
 */
function pitchTextures(f: FieldSpec, margin: number, palette: Palette): { color: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
    const width = f.bounds.xMax - f.bounds.xMin + 2 * margin;
    const depth = f.bounds.yMax - f.bounds.yMin + 2 * margin;
    const px = (isSmallDevice() ? 1024 : 2048) / Math.max(width, depth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * px);
    canvas.height = Math.round(depth * px);
    const ctx = canvas.getContext('2d')!;
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = canvas.width;
    bumpCanvas.height = canvas.height;
    const bump = bumpCanvas.getContext('2d')!;
    // Canvas x runs with field x; canvas y runs against field y.
    const cx = (x: number) => (x - f.bounds.xMin + margin) * px;
    const cy = (y: number) => (f.bounds.yMax + margin - y) * px;
    const stripe = 0.2;
    for (let i = 0; i * stripe < width; i++) {
        ctx.fillStyle = i % 2 === 0 ? palette.grassA : palette.grassB;
        ctx.fillRect(i * stripe * px, 0, stripe * px + 1, canvas.height);
    }
    const rand = seededRandom(7);
    paintPatches(ctx, canvas.width, canvas.height, rand);
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
    // Blades over everything, lines included: painted lines on real grass are not flat either.
    paintTurf(ctx, bump, canvas.width, canvas.height, 0.22, rand);
    return { color: canvasTexture(canvas, true), bump: canvasTexture(bumpCanvas, false) };
}

/** Repeating turf for the ground around the pitch. */
function roughTextures(palette: Palette): { color: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
    const size = isSmallDevice() ? 256 : 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = palette.rough;
    ctx.fillRect(0, 0, size, size);
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = bumpCanvas.height = size;
    const bump = bumpCanvas.getContext('2d')!;
    const rand = seededRandom(11);
    paintPatches(ctx, size, size, rand);
    paintTurf(ctx, bump, size, size, 0.28, rand);
    const color = canvasTexture(canvas, true);
    const bumpTexture = canvasTexture(bumpCanvas, false);
    for (const t of [color, bumpTexture]) {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        // One tile per 80 cm of ground.
        t.repeat.set(32 / 0.8, 32 / 0.8);
    }
    return { color, bump: bumpTexture };
}

function canvasTexture(canvas: HTMLCanvasElement, color: boolean): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 8;
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
