// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The duck on the pitch: MuJoCo physics stepping at 200 Hz, the trained
 * skills choosing servo targets at 50 Hz, and the record of what happened
 * (poses for the replay, kicks, a fall, a goal).
 */

import loadMujoco from '@mujoco/mujoco';
import type { MainModule, MjData, MjModel } from '@mujoco/mujoco';
import * as ort from 'onnxruntime-web';
import { CONTROL_DT, HOME, JOINTS, observation, targets } from './controller.js';
import { BALL_RADIUS, DEFAULT_FIELD, sceneXml, type FieldSpec } from './field.js';
import { extractViewerModel } from 'robolance-mujoco';
import type { MeshSimplifier, Quat, Vec3, ViewerModel } from 'robolance-mujoco/viewer';

const OBJ_BODY = 1;
const OBJ_JOINT = 3;
const GEOM_MESH = 7;
/** Geom group MuJoCo models use for visual-only meshes. */
const VISUAL_GROUP = 2;
const OBJ_ACTUATOR = 19;
/** How far the duck keeps going after it is told to stop. */
const COAST_M = 0.02;
/** turnTo: good enough, and how early to stop a full-rate turn. */
const TURN_TOLERANCE_DEG = 8;
const TURN_LEAD_DEG = 6;
/**
 * Standing time after walking before the trunk stops swaying; a kick needs
 * it, and every movement waits it out before it returns.
 */
const SETTLE_S = 0.9;

/** The skills the duck has: file names in assets/policies. */
export const SKILLS = {
    walk: 'alpha_walking',
    stand: 'alpha_stand',
    kickLeft: 'ball_kick_left',
    kickRight: 'ball_kick_right',
} as const;
export type SkillName = keyof typeof SKILLS;

/** A project skill's name: letters first, then letters, digits, - or _. */
const SKILL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

/** Most values a skill's command block holds: twist (3), head pose (4), body pose (6). */
export const COMMAND_SIZE = 13;

/**
 * Loads a trained policy and checks it is one of Microduck's: 61 values in,
 * 14 servo offsets out (the layout every policy of the family shares).
 */
export async function loadSkill(name: string, bytes: Uint8Array): Promise<ort.InferenceSession> {
    let session: ort.InferenceSession;
    try {
        session = await ort.InferenceSession.create(bytes);
    } catch (err) {
        throw new Error(`skill "${name}" is not an ONNX model ort can load: ${err instanceof Error ? err.message : err}`);
    }
    let out: ArrayLike<number>;
    try {
        const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', new Float32Array(61), [1, 61]) });
        out = result[session.outputNames[0]].data as Float32Array;
    } catch (err) {
        throw new Error(`skill "${name}" does not take Microduck's 61-value observation: ${err instanceof Error ? err.message : err}`);
    }
    if (out.length !== 14 || !Array.from(out).every(Number.isFinite)) {
        throw new Error(`skill "${name}" returns ${out.length} values; a Microduck policy returns 14 servo offsets`);
    }
    return session;
}

/** Model files and skills, by path; the caller reads them from disk or fetches them. */
export interface DuckAssets {
    /** Paths relative to the model directory (robot_groundcontact.xml, assets/*.stl) → bytes. */
    model: Map<string, Uint8Array>;
    /** Skill file name without extension → ONNX bytes. */
    policies: Map<string, Uint8Array>;
}

export interface DuckEvent {
    atS: number;
    kind: 'kick' | 'bump' | 'fell' | 'goal' | 'out';
    detail: string;
}

export interface KickRecord {
    atS: number;
    side: 'left' | 'right';
    /** Where the ball was relative to the duck when the kick began, metres. */
    ballForward: number;
    ballLeft: number;
    /**
     * How far the ball went. When kick() returns this covers the kick and
     * the half second after it; the run's record keeps following the ball
     * until it stops, the duck touches it or the next kick.
     */
    ballMoved: number;
    /** Direction the ball went, degrees on the field (0 = towards the goal line). */
    ballDirection: number | null;
    /** Direction from the ball to the middle of the goal when the kick began. */
    goalDirection: number;
}

export interface Pose {
    x: number;
    y: number;
    /** Degrees, counter-clockwise from +x. */
    heading: number;
}

export class DuckFell extends Error {
    constructor(readonly atS: number) {
        super(`the duck fell at ${atS.toFixed(1)} s`);
    }
}

/** The run stops a second after a goal, or after the ball goes out. */
export class RunOver extends Error {
    constructor(readonly reason: 'goal' | 'out', readonly atS: number) {
        super(`${reason === 'goal' ? 'goal' : 'the ball went out'} at ${atS.toFixed(2)} s; the run is over`);
    }
}

/** How long the run goes on after a goal or an out (the ball settles). */
export const AFTER_BALL_DECIDED_S = 1;

export class TimeUp extends Error {
    constructor(readonly limitS: number) {
        super(`the run reached its ${limitS} s limit`);
    }
}

let mujoco: Promise<MainModule> | undefined;

/** Where a skill's session is kept: built-ins by their file, project skills by name. */
function skillKey(name: string): string {
    return Object.hasOwn(SKILLS, name) ? SKILLS[name as SkillName] : `project:${name}`;
}

export interface WorldOptions {
    field?: FieldSpec;
    /** Longest simulated time, seconds. */
    limitS?: number;
    /** Pose samples per second kept for the replay. */
    frameHz?: number;
    /**
     * The project's own trained policies (ONNX), by name. walk, stand,
     * kickLeft and kickRight replace the built-in skills; any other name is a
     * new skill a mission runs with duck.skill(name, seconds).
     */
    skills?: Record<string, Uint8Array>;
}

export class DuckWorld {
    readonly field: FieldSpec;
    readonly limitS: number;
    time = 0;
    fallen = false;
    fellAtS: number | null = null;
    scoredAtS: number | null = null;
    outAtS: number | null = null;
    readonly events: DuckEvent[] = [];
    readonly kicks: KickRecord[] = [];
    /** qpos samples (rounded) for the replay. */
    readonly frames: number[][] = [];
    /** Duck position twice a second. */
    readonly path: Array<[number, number]> = [];
    closestBallToGoal: number;

    private readonly act: number[] = [];
    private readonly pos: number[] = [];
    private readonly vel: number[] = [];
    private readonly gains: number[] = [];
    private readonly trunk: number;
    private readonly trunkDof: number;
    private readonly ballPos: number;
    private readonly ballDof: number;
    private lastAction = new Float32Array(14);
    private previous: Float64Array | null = null;
    private twist = [0, 0, 0];
    /** When the duck last came to a standstill (null while it walks). */
    private stillSince: number | null = 0;
    private uprightBad = 0;
    private steps = 0;
    private readonly frameEvery: number;
    /** Skills that came from the project: run as trained (scale 1, kp 200, no smoothing). */
    private readonly projectSkills = new Set<string>();
    /** While a project skill runs, tipping over is part of the move, not a fall. */
    private tippingAllowed = false;
    private ballPrevX: number;
    /** Where the ball was when the walking duck started pushing it. */
    private bumpFrom: { x: number; y: number; atS: number } | null = null;
    /** The last kick, followed while its ball rolls. */
    private rolling: { record: KickRecord; event: DuckEvent; from: { x: number; y: number }; slowS: number } | null = null;

    private constructor(
        private readonly mj: MainModule,
        private readonly model: MjModel,
        private readonly data: MjData,
        private readonly skills: Map<string, ort.InferenceSession>,
        options: WorldOptions,
    ) {
        this.field = options.field ?? DEFAULT_FIELD;
        this.limitS = options.limitS ?? 40;
        this.frameEvery = Math.max(1, Math.round(1 / CONTROL_DT / (options.frameHz ?? 25)));
        const m = model;
        for (const name of JOINTS) {
            const a = mj.mj_name2id(m, OBJ_ACTUATOR, name);
            const j = mj.mj_name2id(m, OBJ_JOINT, name);
            if (name !== 'mouth' && (a < 0 || j < 0)) {
                throw new Error(`robot model is missing joint ${name}`);
            }
            this.act.push(a);
            this.pos.push(j < 0 ? -1 : m.jnt_qposadr[j]);
            this.vel.push(j < 0 ? -1 : m.jnt_dofadr[j]);
            this.gains.push(a < 0 ? 0 : m.actuator_gainprm[a * 10]);
        }
        const free = (name: string) => {
            const j = mj.mj_name2id(m, OBJ_JOINT, name);
            if (j < 0) {
                throw new Error(`scene is missing ${name}`);
            }
            return j;
        };
        let j = free('trunk_base_freejoint');
        this.trunk = m.jnt_qposadr[j];
        this.trunkDof = m.jnt_dofadr[j];
        j = free('football_free');
        this.ballPos = m.jnt_qposadr[j];
        this.ballDof = m.jnt_dofadr[j];
        this.reset();
        this.ballPrevX = this.field.ball.x;
        this.closestBallToGoal = this.ballToGoal();
    }

    static async create(assets: DuckAssets, options: WorldOptions = {}): Promise<DuckWorld> {
        mujoco ??= loadMujoco();
        const mj = await mujoco;
        const root = `/duck-${Math.random().toString(36).slice(2)}`;
        mkdirs(mj, root);
        for (const [path, bytes] of assets.model) {
            const dir = path.includes('/') ? `${root}/${path.slice(0, path.lastIndexOf('/'))}` : root;
            mkdirs(mj, dir);
            mj.FS.writeFile(`${root}/${path}`, bytes);
        }
        mj.FS.writeFile(`${root}/scene.xml`, sceneXml(options.field ?? DEFAULT_FIELD));
        const model = mj.MjModel.mj_loadXML(`${root}/scene.xml`);
        model.opt.timestep = 0.005;
        const data = new mj.MjData(model);
        const skills = new Map<string, ort.InferenceSession>();
        const fromProject: string[] = [];
        for (const [name, bytes] of Object.entries(options.skills ?? {})) {
            if (!SKILL_NAME.test(name)) {
                throw new Error(`skill name "${name}": use letters, digits, - or _ (up to 32, starting with a letter)`);
            }
            const key = skillKey(name);
            skills.set(key, await loadSkill(name, bytes));
            fromProject.push(key);
        }
        for (const file of Object.values(SKILLS)) {
            if (skills.has(file)) {
                continue;
            }
            const bytes = assets.policies.get(file);
            if (!bytes) {
                throw new Error(`missing skill ${file}.onnx`);
            }
            skills.set(file, await ort.InferenceSession.create(bytes));
        }
        const world = new DuckWorld(mj, model, data, skills, options);
        for (const key of fromProject) {
            world.projectSkills.add(key);
        }
        return world;
    }

    /** Frees the native model; the world is unusable afterwards. */
    dispose(): void {
        this.data.delete();
        this.model.delete();
    }

    /** True once nothing more can happen: a fall, the time limit, or a second after a goal or an out. */
    get over(): boolean {
        const decided = this.scoredAtS ?? this.outAtS;
        return this.fallen || this.time >= this.limitS || (decided !== null && this.time >= decided + AFTER_BALL_DECIDED_S);
    }

    /**
     * The model a viewer needs to draw replay frames: bodies and joints,
     * the robot's visual meshes reduced by `simplify` (vertex clustering on
     * a 3 mm grid unless given), and each part's surface. The pitch, ball
     * and goal are drawn by the viewer itself, so only the robot's visual
     * meshes are included.
     */
    viewerModel(simplify?: MeshSimplifier): ViewerModel {
        return extractViewerModel(this.mj, this.model, {
            simplify,
            include: (g, m) => m.geom_type[g] === GEOM_MESH && m.geom_group[g] === VISUAL_GROUP,
        });
    }

    /** World pose of every body as MuJoCo computed it for the current state (for checking a viewer). */
    bodyWorldPoses(): Array<{ pos: Vec3; quat: Quat }> {
        const d = this.data;
        // mj_step leaves xpos from the start of the step; recompute for the current qpos.
        this.mj.mj_kinematics(this.model, d);
        return Array.from({ length: this.model.nbody }, (_, b) => ({
            pos: [d.xpos[3 * b], d.xpos[3 * b + 1], d.xpos[3 * b + 2]] as Vec3,
            quat: [d.xquat[4 * b], d.xquat[4 * b + 1], d.xquat[4 * b + 2], d.xquat[4 * b + 3]] as Quat,
        }));
    }

    /** The current state as a replay frame (unrounded). */
    qpos(): number[] {
        return Array.from(this.data.qpos as ArrayLike<number>);
    }

    get qposSize(): number {
        return this.model.nq;
    }

    private reset(): void {
        const { mj, model, data } = this;
        mj.mj_resetData(model, data);
        const f = this.field;
        const half = (f.duck.heading * Math.PI) / 360;
        data.qpos[this.trunk] = f.duck.x;
        data.qpos[this.trunk + 1] = f.duck.y;
        data.qpos[this.trunk + 2] = 0.125;
        data.qpos[this.trunk + 3] = Math.cos(half);
        data.qpos[this.trunk + 6] = Math.sin(half);
        for (let i = 0; i < 15; i++) {
            if (this.act[i] >= 0) {
                data.qpos[this.pos[i]] = HOME[i];
                data.ctrl[this.act[i]] = HOME[i];
            }
        }
        data.qpos[this.ballPos] = f.ball.x;
        data.qpos[this.ballPos + 1] = f.ball.y;
        data.qpos[this.ballPos + 2] = BALL_RADIUS;
        data.qpos[this.ballPos + 3] = 1;
        mj.mj_forward(model, data);
        this.record(true);
    }

    pose(): Pose {
        const q = this.data.qpos;
        const r = this.rotation();
        return {
            x: q[this.trunk],
            y: q[this.trunk + 1],
            heading: (Math.atan2(r[3], r[0]) * 180) / Math.PI,
        };
    }

    ball(): { x: number; y: number; z: number } {
        const q = this.data.qpos;
        return { x: q[this.ballPos], y: q[this.ballPos + 1], z: q[this.ballPos + 2] };
    }

    /** The ball in the duck's frame: metres ahead, metres to its left. */
    ballRelative(): { forward: number; left: number; distance: number; bearing: number } {
        const p = this.pose();
        const b = this.ball();
        const h = (p.heading * Math.PI) / 180;
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const forward = Math.cos(h) * dx + Math.sin(h) * dy;
        const left = -Math.sin(h) * dx + Math.cos(h) * dy;
        return { forward, left, distance: Math.hypot(dx, dy), bearing: (Math.atan2(left, forward) * 180) / Math.PI };
    }

    private ballToGoal(): number {
        const b = this.ball();
        const g = this.field.goal;
        const half = g.width / 2;
        const dy = Math.max(0, Math.abs(b.y - g.y) - half);
        return Math.hypot(Math.max(0, g.x - b.x), dy);
    }

    private rotation(): number[] {
        const q = this.data.qpos;
        const w = q[this.trunk + 3];
        const x = q[this.trunk + 4];
        const y = q[this.trunk + 5];
        const z = q[this.trunk + 6];
        return [
            1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
            2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
            2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
        ];
    }

    private sensors() {
        const q = this.data.qpos;
        const v = this.data.qvel;
        const r = this.rotation();
        return {
            positions: this.pos.map(p => (p < 0 ? 0 : q[p])),
            velocities: this.vel.map(p => (p < 0 ? 0 : v[p])),
            gyro: [v[this.trunkDof + 3], v[this.trunkDof + 4], v[this.trunkDof + 5]],
            gravity: [-r[6], -r[7], -r[8]],
        };
    }

    private setGain(i: number, ratio: number): void {
        const a = this.act[i];
        this.model.actuator_gainprm[a * 10] = this.gains[i] * ratio;
        this.model.actuator_biasprm[a * 10 + 1] = -this.gains[i] * ratio;
    }

    /** One 20 ms control step with the given skill and its command. */
    private async step(skill: string, command: number[], scale: number, gain: number): Promise<void> {
        if (this.time >= this.limitS) {
            throw new TimeUp(this.limitS);
        }
        const decided = this.scoredAtS ?? this.outAtS;
        if (decided !== null && this.time >= decided + AFTER_BALL_DECIDED_S) {
            throw new RunOver(this.scoredAtS !== null ? 'goal' : 'out', decided);
        }
        const s = this.sensors();
        if (s.gravity[2] > -0.35) {
            this.uprightBad += CONTROL_DT;
        } else {
            this.uprightBad = 0;
        }
        if (this.uprightBad > 0.6 && !this.fallen && !this.tippingAllowed) {
            this.fallen = true;
            this.fellAtS = round(this.time, 2);
            this.events.push({ atS: this.fellAtS, kind: 'fell', detail: 'the duck tipped over' });
        }
        if (!this.fallen) {
            const session = this.skills.get(skill)!;
            const obs = observation(s, this.lastAction, command);
            const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', obs, [1, 61]) });
            const action = out[session.outputNames[0]].data as Float32Array;
            this.lastAction = Float32Array.from(action);
            const asTrained = this.projectSkills.has(skill);
            if (asTrained) {
                scale = 1;
                gain = 200;
            }
            const t = targets(action, scale, asTrained ? null : this.previous);
            this.previous = t;
            for (let i = 0; i < 15; i++) {
                if (this.act[i] >= 0) {
                    this.data.ctrl[this.act[i]] = t[i];
                    this.setGain(i, gain / 200);
                }
            }
        } else {
            for (let i = 0; i < 15; i++) {
                if (this.act[i] >= 0) {
                    this.setGain(i, 0.1);
                }
            }
        }
        for (let k = 0; k < 4; k++) {
            this.mj.mj_step(this.model, this.data);
        }
        this.time = round(this.time + CONTROL_DT, 4);
        this.steps++;
        this.watchBall();
        this.watchBump(skill);
        this.followKick();
        this.record(false);
        if (this.fallen) {
            throw new DuckFell(this.fellAtS ?? this.time);
        }
    }

    private watchBall(): void {
        const b = this.ball();
        const g = this.field.goal;
        const f = this.field.bounds;
        if (this.scoredAtS === null && this.outAtS === null) {
            if (this.ballPrevX < g.x && b.x >= g.x) {
                if (Math.abs(b.y - g.y) < g.width / 2 - BALL_RADIUS * 0.5) {
                    this.scoredAtS = round(this.time, 2);
                    this.events.push({ atS: this.scoredAtS, kind: 'goal', detail: `the ball crossed the goal line ${cm(b.y - g.y)} cm from the centre` });
                } else {
                    this.outAtS = round(this.time, 2);
                    this.events.push({ atS: this.outAtS, kind: 'out', detail: `the ball crossed the goal line ${cm(Math.abs(b.y - g.y) - g.width / 2)} cm wide of the ${b.y > g.y ? 'left' : 'right'} post` });
                }
            } else if (b.x < f.xMin || b.x > f.xMax || b.y < f.yMin || b.y > f.yMax) {
                this.outAtS = round(this.time, 2);
                this.events.push({ atS: this.outAtS, kind: 'out', detail: 'the ball left the field' });
            }
        }
        this.ballPrevX = b.x;
        this.closestBallToGoal = Math.min(this.closestBallToGoal, this.ballToGoal());
    }

    /** Notices the walking duck shoving the ball along with its feet or body. */
    private watchBump(skill: string): void {
        const b = this.ball();
        const v = this.data.qvel;
        const pushing = skill !== SKILLS.kickLeft && skill !== SKILLS.kickRight
            && Math.hypot(v[this.ballDof], v[this.ballDof + 1]) > 0.1
            && this.ballRelative().distance < 0.14;
        if (pushing && !this.bumpFrom) {
            this.bumpFrom = { x: b.x, y: b.y, atS: round(this.time, 2) };
        } else if (!pushing && this.bumpFrom) {
            const moved = Math.hypot(b.x - this.bumpFrom.x, b.y - this.bumpFrom.y);
            if (moved > 0.02) {
                this.events.push({ atS: this.bumpFrom.atS, kind: 'bump', detail: `the walking duck ran into the ball and pushed it ${cm(moved)} cm` });
            }
            this.bumpFrom = null;
        }
    }

    private record(force: boolean): void {
        if (force || this.steps % this.frameEvery === 0) {
            this.frames.push(Array.from(this.data.qpos as ArrayLike<number>, v => round(v, 4)));
        }
        if (force || this.steps % 25 === 0) {
            const p = this.pose();
            this.path.push([round(p.x, 3), round(p.y, 3)]);
        }
    }

    /**
     * Walks with a velocity command for `seconds`: forward in m/s (0-0.6),
     * turn in rad/s (±1.5, positive turns left). The walking skill does not
     * step sideways or backwards, and it barely moves below 0.3 m/s or for
     * under a second: the command ramps up. A zero command stands.
     */
    async walk(forward: number, turn: number, seconds: number): Promise<void> {
        const cmd = [clamp(forward, 0, 0.6), 0, clamp(turn, -1.5, 1.5)];
        const steps = Math.max(1, Math.round(seconds / CONTROL_DT));
        for (let s = 0; s < steps; s++) {
            for (let i = 0; i < 3; i++) {
                this.twist[i] += 0.2 * (cmd[i] - this.twist[i]);
            }
            const still = Math.hypot(...this.twist) <= 0.05;
            if (!still) {
                this.stillSince = null;
            } else if (this.stillSince === null) {
                this.stillSince = this.time;
            }
            if (still) {
                await this.step(SKILLS.stand, this.twist.slice(), 1, 160);
            } else {
                await this.step(SKILLS.walk, this.twist.slice(), 0.9, 200);
            }
        }
    }

    /**
     * Steers with a command recomputed every control step until `done` says
     * so or `maxS` passes, then stands still for `settleS` so the trunk
     * stops swaying before anyone reads the pose. Returns whether `done`
     * was reached.
     */
    private async drive(command: () => number[], done: () => boolean, maxS: number, settleS = SETTLE_S): Promise<boolean> {
        const steps = Math.max(1, Math.round(maxS / CONTROL_DT));
        let reached = false;
        for (let s = 0; s < steps; s++) {
            if (done()) {
                reached = true;
                break;
            }
            const [forward, turn] = command();
            await this.walk(forward, turn, CONTROL_DT);
        }
        await this.walk(0, 0, settleS);
        return reached;
    }

    /**
     * Turns on the spot to a field heading (degrees). The walking skill only
     * turns its feet at full rate, so this turns at 1.3 rad/s and stops
     * early; it gets within about 8 degrees. Returns the error left.
     */
    async turnTo(heading: number, maxS = 8): Promise<number> {
        const error = () => wrapDeg(heading - this.pose().heading);
        const until = this.time + maxS;
        for (let attempt = 0; attempt < 3 && this.time < until; attempt++) {
            const e = error();
            if (Math.abs(e) <= TURN_TOLERANCE_DEG) {
                break;
            }
            const sign = Math.sign(e);
            if (Math.abs(e) < 16) {
                // The shortest turn that moves the feet is about 13 degrees.
                await this.walk(0, sign * 1.3, 0.6);
                await this.walk(0, 0, 0.6);
                continue;
            }
            await this.drive(() => [0, sign * 1.3], () => sign * error() < TURN_LEAD_DEG, until - this.time, 0.6);
        }
        await this.settle();
        return round(error(), 1);
    }

    /** Stands until the duck has been still for SETTLE_S. */
    private async settle(): Promise<void> {
        const still = this.stillSince === null ? 0 : this.time - this.stillSince;
        if (still < SETTLE_S - 1e-9) {
            await this.walk(0, 0, SETTLE_S - still);
        }
    }

    /**
     * Walks to a field point, steering as it goes, and stops within
     * `tolerance` metres. The duck cannot walk sideways or backwards: it
     * turns to face the point first when it is more than 30 degrees off.
     */
    async walkTo(x: number, y: number, tolerance = 0.04, maxS = 15): Promise<boolean> {
        const bearing = () => {
            const p = this.pose();
            return wrapDeg((Math.atan2(y - p.y, x - p.x) * 180) / Math.PI - p.heading);
        };
        const distance = () => {
            const p = this.pose();
            return Math.hypot(x - p.x, y - p.y);
        };
        if (distance() <= tolerance) {
            return true;
        }
        if (Math.abs(bearing()) > 30) {
            await this.turnTo(wrapDeg(this.pose().heading + bearing()), maxS / 2);
        }
        const reached = await this.drive(
            () => {
                const d = distance();
                const b = bearing();
                const ahead = Math.cos((b * Math.PI) / 180);
                return [ahead > 0 ? clamp(0.25 + d, 0.3, 0.5) * ahead : 0, clamp(b / 30, -1, 1)];
            },
            () => distance() <= tolerance || (distance() < 0.12 && Math.abs(bearing()) > 70),
            maxS,
        );
        return reached && distance() <= tolerance * 2;
    }

    /**
     * Walks straight ahead `metres` (at most 1.5) on the line it is facing,
     * or on a parallel line `shiftLeft` metres to the left (±0.1; negative
     * shifts right), which it steers onto as it goes. Steps of 5 cm work.
     * Returns how far it went along the line.
     */
    async walkForward(metres: number, shiftLeft = 0, maxS = 10): Promise<number> {
        const start = this.pose();
        const h = (start.heading * Math.PI) / 180;
        const goal = clamp(metres, 0, 1.5);
        const shift = clamp(shiftLeft, -0.1, 0.1);
        const along = () => {
            const p = this.pose();
            return Math.cos(h) * (p.x - start.x) + Math.sin(h) * (p.y - start.y);
        };
        const across = () => {
            const p = this.pose();
            return -Math.sin(h) * (p.x - start.x) + Math.cos(h) * (p.y - start.y);
        };
        await this.drive(
            () => {
                // Steer onto the (shifted) line, not just back to the heading.
                const want = start.heading - (Math.atan2(across() - shift, 0.1) * 180) / Math.PI;
                return [clamp(0.3 + (goal - along()), 0.3, 0.5), clamp(wrapDeg(want - this.pose().heading) / 20, -0.8, 0.8)];
            },
            () => along() >= goal - COAST_M,
            maxS,
        );
        return along();
    }

    /** The project skills a mission can run with runSkill (not the replaced built-ins). */
    get extraSkills(): string[] {
        return [...this.projectSkills].filter(k => k.startsWith('project:')).map(k => k.slice('project:'.length)).sort();
    }

    /**
     * Runs a skill for `seconds` with a command block (twist, head pose,
     * body pose: up to 13 values, zero-padded), as it was trained: no
     * smoothing, and tipping over during it is part of the move (the run
     * ends only if the duck is still down once standing resumes). Built-in
     * skills run by their names: walk, stand, kickLeft, kickRight.
     */
    async runSkill(name: string, seconds: number, command: ArrayLike<number> = []): Promise<void> {
        const key = skillKey(name);
        if (!this.skills.has(key)) {
            const extra = this.extraSkills;
            throw new Error(`no skill "${name}"; ${extra.length ? `the project's skills are ${extra.join(', ')}` : 'the project has no skills of its own'} (and walk, stand, kickLeft, kickRight)`);
        }
        const cmd = new Array<number>(COMMAND_SIZE).fill(0);
        for (let i = 0; i < Math.min(COMMAND_SIZE, command.length); i++) {
            const v = Number(command[i]);
            cmd[i] = Number.isFinite(v) ? v : 0;
        }
        this.twist = [0, 0, 0];
        this.stillSince = null;
        const steps = Math.max(1, Math.round(seconds / CONTROL_DT));
        this.tippingAllowed = this.projectSkills.has(key);
        try {
            // Built-ins keep the scale and stiffness walk(), stand() and kick() use; project skills run as trained.
            const [scale, gain] = key === SKILLS.walk ? [0.9, 200] : [1, 160];
            for (let s = 0; s < steps; s++) {
                await this.step(key, cmd, scale, gain);
            }
        } finally {
            this.tippingAllowed = false;
            this.uprightBad = 0;
        }
    }

    /**
     * Runs a kick skill (0.5 s), then stands for half a second. A kick only
     * connects from a settled stance, so it first stands until the duck
     * has been still for SETTLE_S.
     */
    async kick(side: 'left' | 'right'): Promise<KickRecord> {
        await this.settle();
        const rel = this.ballRelative();
        const before = this.ball();
        const atS = round(this.time, 2);
        const g = this.field.goal;
        this.twist = [0, 0, 0];
        const skill = side === 'left' ? SKILLS.kickLeft : SKILLS.kickRight;
        for (let s = 0; s < 25; s++) {
            await this.step(skill, [0, 0, 0], 1, 160);
        }
        await this.walk(0, 0, 0.5);
        const after = this.ball();
        const moved = Math.hypot(after.x - before.x, after.y - before.y);
        this.rolling = null;
        const record: KickRecord = {
            atS,
            side,
            ballForward: round(rel.forward, 3),
            ballLeft: round(rel.left, 3),
            ballMoved: round(moved, 3),
            ballDirection: moved > 0.02 ? round((Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI, 1) : null,
            goalDirection: round((Math.atan2(g.y - before.y, g.x - before.x) * 180) / Math.PI, 1),
        };

        this.kicks.push(record);
        this.stillSince = this.time;
        const event: DuckEvent = { atS, kind: 'kick', detail: '' };
        this.events.push(event);
        this.rolling = { record, event, from: before, slowS: 0 };
        this.describeKick();
        return record;
    }

    private describeKick(): void {
        if (!this.rolling) {
            return;
        }
        const { record: k, event } = this.rolling;
        event.detail = `${k.side} kick with the ball ${cm(k.ballForward)} cm ahead and ${cm(Math.abs(k.ballLeft))} cm ${k.ballLeft >= 0 ? 'left' : 'right'}: ball moved ${cm(k.ballMoved)} cm`;
    }

    /** Keeps the last kick's record up to date while its ball rolls on. */
    private followKick(): void {
        const r = this.rolling;
        if (!r) {
            return;
        }
        if (this.bumpFrom) {
            this.rolling = null;
            return;
        }
        const b = this.ball();
        const v = this.data.qvel;
        const moved = Math.hypot(b.x - r.from.x, b.y - r.from.y);
        r.record.ballMoved = round(moved, 3);
        r.record.ballDirection = moved > 0.02 ? round((Math.atan2(b.y - r.from.y, b.x - r.from.x) * 180) / Math.PI, 1) : null;
        this.describeKick();
        r.slowS = Math.hypot(v[this.ballDof], v[this.ballDof + 1]) < 0.01 ? r.slowS + CONTROL_DT : 0;
        if (r.slowS > 0.2 || this.scoredAtS !== null || this.outAtS !== null) {
            this.rolling = null;
        }
    }
}

function mkdirs(mj: MainModule, path: string): void {
    let at = '';
    for (const part of path.split('/').filter(Boolean)) {
        at += `/${part}`;
        try {
            mj.FS.mkdir(at);
        } catch {
            // exists
        }
    }
}

function wrapDeg(d: number): number {
    return ((((d + 180) % 360) + 360) % 360) - 180;
}

function clamp(v: number, lo: number, hi: number): number {
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;
}

export function round(v: number, digits: number): number {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
}

function cm(m: number): number {
    return Math.round(m * 100);
}
