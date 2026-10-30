// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The 3D pitch for Microduck replays: the duck's real meshes posed from a
 * replay frame, the ball, the goal and the path so far. Plain three.js
 * behind a small API (setField, show, setTheme, dispose) so the React side
 * only passes data. Renders on demand, not in a loop.
 */

import * as THREE from 'three';
import { BALL_RADIUS, GOAL_HEIGHT, LAPTOP, NET_DEPTH, POST_RADIUS, type FieldSpec, type Obstacle, type ViewerModel } from 'robolance-duck-sim/viewer';
import { LaptopModel } from './laptop-model';
import { RobotParts, place } from './robot-parts';
import { StageBase, isSmallDevice, portraitShot, type SkyPalette, type StageView } from './stage-base';
import { netCanvas, paintPatches, paintTurf, seededRandom } from './stage-textures';

export type { StageView } from './stage-base';

interface Palette extends SkyPalette {
    grassA: string;
    grassB: string;
    /** Turf around the pitch. */
    rough: string;
    line: string;
    trail: number;
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

/** The standing duck's head height, metres: the top of what the camera must keep in view at the start. */
const DUCK_HEIGHT = 0.26;

/** A broadcast-style side view: the duck starts on the left, the goal is on the right. */
export const DEFAULT_VIEW: StageView = { azimuth: 72, elevation: 30, distance: 1.9 };

export class DuckStage extends StageBase {
    private readonly robot: RobotParts;
    private readonly ball: THREE.Mesh;
    private readonly pitch = new THREE.Group();
    private trail?: THREE.Line;
    private ballIndex = -1;
    private laptop?: LaptopModel;
    /** The lid's place in a replay frame: right after the robot and the ball. */
    private readonly lidIndex: number;
    private field?: FieldSpec;
    private palette: Palette = PALETTES.dark;
    /** The duck's heading in the frame shown last, not eased. */
    private heading = 0;

    constructor(host: HTMLElement, model: ViewerModel) {
        super(host, DEFAULT_VIEW, 'robolance-duck-canvas');
        this.robot = new RobotParts(model);
        this.scene.add(this.pitch, this.robot.group);
        this.ballIndex = model.bodies.findIndex(b => b.name === 'football');
        this.lidIndex = model.nq;

        const ballMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf07d1e, roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.3 });
        this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 48, 32), ballMaterial);
        this.ball.castShadow = true;
        this.ball.receiveShadow = true;
        this.scene.add(this.ball);
        this.disposers.push(() => {
            this.robot.dispose();
            this.ball.geometry.dispose();
            ballMaterial.dispose();
            this.clearPitch();
            this.clearLaptop();
            this.trail?.geometry.dispose();
            (this.trail?.material as THREE.Material | undefined)?.dispose();
        });
    }

    setTheme(theme: 'light' | 'dark'): void {
        this.palette = PALETTES[theme];
        this.setSky(this.palette);
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
            this.clearLaptop();
            if (field.laptop) {
                this.laptop = new LaptopModel(field.laptop);
                this.scene.add(this.laptop.group);
            }
            this.home();
            this.frameView();
        }
        this.invalidate();
    }

    /** Poses the duck and the ball from a replay frame and draws the path walked so far. */
    show(frame: ArrayLike<number> | undefined, path: Array<[number, number]>): void {
        // A record without replay frames has nothing to pose: hide the duck and ball rather than pile them at the origin.
        const poses = this.robot.pose(frame);
        this.ball.visible = Boolean(poses);
        if (poses) {
            if (this.ballIndex >= 0) {
                place(this.ball, poses[this.ballIndex]);
            }
            if (this.laptop && frame && frame.length > this.lidIndex) {
                this.laptop.setLid(frame[this.lidIndex]);
            }
            const trunk = poses[1];
            this.followAt.set(trunk.pos[0], trunk.pos[1], 0.08);
            this.heading = trunkHeading(trunk.quat);
            this.setFollowHeading(this.heading);
        }
        this.setTrail(path);
        this.invalidate();
    }

    /** A close-up of the duck as shown now, facing the ball (or the laptop), as a JPEG data URL. */
    portrait(width: number, height: number): string {
        const laptop = this.field?.laptop;
        const aim: [number, number] | undefined = laptop
            ? [laptop.x, laptop.y]
            : this.ball.visible ? [this.ball.position.x, this.ball.position.y] : undefined;
        return this.snapshot(portraitShot(this.followAt.x, this.followAt.y, this.heading, aim), width, height);
    }

    protected home(): void {
        const points = this.framePoints();
        if (points.length > 0) {
            const box = new THREE.Box3().setFromPoints(points);
            this.target.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, 0.05);
        }
    }

    /** The duck where it starts (standing height), the ball and the whole goal with its net. */
    protected framePoints(): THREE.Vector3[] {
        const f = this.field;
        if (!f) {
            return [];
        }
        const y1 = f.goal.y - f.goal.width / 2;
        const y2 = f.goal.y + f.goal.width / 2;
        const back = f.goal.x + NET_DEPTH;
        return [
            new THREE.Vector3(f.duck.x, f.duck.y, 0),
            new THREE.Vector3(f.duck.x, f.duck.y, DUCK_HEIGHT),
            new THREE.Vector3(f.ball.x, f.ball.y, 0),
            ...[f.goal.x, back].flatMap(x => [y1, y2].flatMap(y => [new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, GOAL_HEIGHT)])),
            ...(f.obstacles ?? []).flatMap(obstacleCorners),
            ...(f.laptop ? obstacleCorners({ x: f.laptop.x, y: f.laptop.y, width: LAPTOP.depth + 0.08, depth: LAPTOP.width, height: LAPTOP.lidLength, heading: f.laptop.heading }) : []),
        ];
    }

    private clearLaptop(): void {
        if (this.laptop) {
            this.scene.remove(this.laptop.group);
            this.laptop.dispose();
            this.laptop = undefined;
        }
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

        for (const o of f.obstacles ?? []) {
            this.pitch.add(obstacleMesh(o));
        }

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
        this.fitShadow(cx, cy, Math.max(width, depth) / 2 + margin + 0.2);

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

/** A cardboard box standing on the pitch, turned by its heading. */
function obstacleMesh(o: Obstacle): THREE.Mesh {
    const box = new THREE.Mesh(
        new THREE.BoxGeometry(o.width, o.depth, o.height),
        new THREE.MeshStandardMaterial({ color: 0xb98a58, roughness: 0.85, metalness: 0 }),
    );
    box.position.set(o.x, o.y, o.height / 2);
    box.rotation.z = ((o.heading ?? 0) * Math.PI) / 180;
    box.castShadow = true;
    box.receiveShadow = true;
    return box;
}

/** An obstacle's eight corners, for framing the view. */
function obstacleCorners(o: Obstacle): THREE.Vector3[] {
    const h = ((o.heading ?? 0) * Math.PI) / 180;
    const c = Math.cos(h);
    const s = Math.sin(h);
    const out: THREE.Vector3[] = [];
    for (const a of [-o.width / 2, o.width / 2]) {
        for (const b of [-o.depth / 2, o.depth / 2]) {
            for (const z of [0, o.height]) {
                out.push(new THREE.Vector3(o.x + a * c - b * s, o.y + a * s + b * c, z));
            }
        }
    }
    return out;
}

/**
 * The way the trunk faces on the ground (radians): its body x axis, as
 * duck-sim's own heading reads it. `quat` is MuJoCo's w, x, y, z.
 */
export function trunkHeading(quat: ArrayLike<number>): number {
    const [w, x, y, z] = [quat[0], quat[1], quat[2], quat[3]];
    return Math.atan2(2 * (x * y + w * z), 1 - 2 * (y * y + z * z));
}
