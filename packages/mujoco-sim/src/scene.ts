// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Any MuJoCo scene, loaded from its files: check it (does it load, does
 * anything start inside something else, does it stay stable when left
 * alone), run it under a controller script, and record the run so a
 * browser can replay it. Nothing here knows what the robot is; the
 * controller and the MJCF say everything.
 */

import loadMujoco from '@mujoco/mujoco';
import type { MainModule, MjData, MjModel } from '@mujoco/mujoco';
import { createController, type Controller, type ControllerApi } from './controller.js';
import { OBJ_ACTUATOR, OBJ_BODY, OBJ_GEOM, OBJ_JOINT, OBJ_SENSOR, OBJ_SITE, extractViewerModel, round, type ExtractOptions } from './extract.js';
import type { ViewerModel } from './viewer.js';

let mujoco: Promise<MainModule> | undefined;

/** Files of a scene: paths relative to the scene's folder → contents. */
export type SceneFiles = Map<string, Uint8Array | string>;

export interface SceneIssue {
    kind: 'penetration' | 'unstable' | 'no-actuators' | 'warning';
    message: string;
}

export interface SceneCheck {
    ok: boolean;
    bodies: number;
    joints: number;
    actuators: string[];
    sensors: string[];
    dof: number;
    /** Total mass, kg. */
    mass: number;
    timestep: number;
    issues: SceneIssue[];
}

export interface RunOptions {
    /** Controller source: defines `control(sim)` and optionally `init(sim)`. Without one the scene runs passively. */
    controller?: string;
    /** Simulated seconds (default 10, at most 120). */
    seconds?: number;
    /** Controller calls per simulated second (default 50). */
    controlHz?: number;
    /** Replay frames per second (default 25). */
    frameHz?: number;
    /** Real-time limit, ms (default 60 000). */
    wallMs?: number;
    /** Keyframe to start from (by index), else the model's default pose. */
    keyframe?: number;
}

export interface SceneRun {
    version: 1;
    kind: 'scene';
    outcome: 'done' | 'stopped' | 'unstable' | 'error' | 'timeout';
    /** Why the run ended early, in words, when it did. */
    message?: string;
    simS: number;
    frameHz: number;
    nq: number;
    /** qpos at each replay frame. */
    frames: number[][];
    /** Named time series the controller recorded with sim.metric(). */
    metrics: Record<string, Array<[number, number]>>;
    logs: string[];
    check: SceneCheck;
}

const MAX_SECONDS = 120;
const MAX_FRAMES = 3000;
const MAX_LOGS = 200;
const WARNING_NAMES = ['inertia', 'contactfull', 'constraintfull', 'vgeomfull', 'badqpos', 'badqvel', 'badqacc', 'badctrl'];
/** mjWARN_BADQPOS, BADQVEL, BADQACC. */
const BAD_STATE_WARNINGS = [4, 5, 6];

export class Scene {
    private constructor(
        readonly mj: MainModule,
        readonly model: MjModel,
        readonly data: MjData,
        readonly main: string,
    ) {}

    /**
     * Loads a scene: every file goes into MuJoCo's virtual file system,
     * then `main` (the top MJCF) is compiled. A model MuJoCo rejects
     * throws with MuJoCo's own message.
     */
    static async load(files: SceneFiles, main: string): Promise<Scene> {
        mujoco ??= loadMujoco();
        const mj = await mujoco;
        const root = `/scene-${Math.random().toString(36).slice(2)}`;
        mkdirs(mj, root);
        for (const [path, contents] of files) {
            const clean = path.replace(/^\.?\/+/, '');
            if (clean.split('/').includes('..')) {
                throw new Error(`file path leaves the scene folder: ${path}`);
            }
            if (clean.includes('/')) {
                mkdirs(mj, `${root}/${clean.slice(0, clean.lastIndexOf('/'))}`);
            }
            mj.FS.writeFile(`${root}/${clean}`, contents);
        }
        const mainPath = `${root}/${main.replace(/^\.?\/+/, '')}`;
        let model: MjModel;
        try {
            model = mj.MjModel.mj_loadXML(mainPath);
        } catch (err) {
            throw new Error(`MuJoCo could not load ${main}: ${errorText(mj, err)}`);
        }
        if (!model) {
            throw new Error(`MuJoCo could not load ${main}`);
        }
        return new Scene(mj, model, new mj.MjData(model), main);
    }

    dispose(): void {
        this.data.delete();
        this.model.delete();
    }

    viewerModel(options?: ExtractOptions): ViewerModel {
        return extractViewerModel(this.mj, this.model, options);
    }

    /**
     * What an agent should know before running: sizes, actuators and
     * sensors by name, and problems: parts that start inside each other,
     * and a scene that blows up when left alone for a second.
     */
    check(): SceneCheck {
        const { mj, model: m } = this;
        const d = new mj.MjData(m);
        const issues: SceneIssue[] = [];
        try {
            mj.mj_resetData(m, d);
            mj.mj_forward(m, d);
            const seen = new Set<string>();
            for (let i = 0; i < d.ncon; i++) {
                const c = d.contact.get(i);
                if (!c) {
                    continue;
                }
                const { dist, geom1, geom2 } = c;
                c.delete();
                if (dist > -0.001) {
                    continue;
                }
                const a = this.geomLabel(geom1);
                const b = this.geomLabel(geom2);
                const key = [a, b].sort().join('|');
                if (!seen.has(key) && seen.size < 8) {
                    seen.add(key);
                    issues.push({ kind: 'penetration', message: `${a} starts ${round(-dist * 1000, 1)} mm inside ${b}` });
                }
            }
            const steps = Math.ceil(1 / m.opt.timestep);
            for (let s = 0; s < steps; s++) {
                mj.mj_step(m, d);
                if (blownUp(d)) {
                    issues.push({ kind: 'unstable', message: `left alone, the simulation blows up after ${round(d.time, 3)} s (check masses, joint limits, timestep)` });
                    break;
                }
            }
            for (const w of warnings(d)) {
                issues.push({ kind: 'warning', message: w });
            }
        } finally {
            d.delete();
        }
        const actuators = names(mj, m, OBJ_ACTUATOR, m.nu);
        if (actuators.length === 0) {
            issues.push({ kind: 'no-actuators', message: 'the model has no actuators, so a controller cannot move it' });
        }
        let mass = 0;
        for (let b = 0; b < m.nbody; b++) {
            mass += m.body_mass[b];
        }
        return {
            ok: !issues.some(i => i.kind === 'penetration' || i.kind === 'unstable'),
            bodies: m.nbody - 1,
            joints: m.njnt,
            actuators,
            sensors: names(mj, m, OBJ_SENSOR, m.nsensor),
            dof: m.nv,
            mass: round(mass, 4),
            timestep: m.opt.timestep,
            issues,
        };
    }

    /** Runs the scene under a controller and records it. Never throws for a controller's mistakes: they end the run. */
    async run(options: RunOptions = {}): Promise<SceneRun> {
        const { mj, model: m, data: d } = this;
        const seconds = Math.min(MAX_SECONDS, Math.max(0, options.seconds ?? 10));
        const controlDt = 1 / Math.max(1, options.controlHz ?? 50);
        const frameHz = Math.min(60, Math.max(1, options.frameHz ?? 25));
        const wallMs = options.wallMs ?? 60_000;
        const check = this.check();
        const run: SceneRun = { version: 1, kind: 'scene', outcome: 'done', simS: 0, frameHz, nq: m.nq, frames: [], metrics: {}, logs: [], check };
        if (options.keyframe !== undefined && (options.keyframe < 0 || options.keyframe >= m.nkey)) {
            return { ...run, outcome: 'error', message: `no keyframe ${options.keyframe} (the model has ${m.nkey})` };
        }
        if (options.keyframe !== undefined) {
            mj.mj_resetDataKeyframe(m, d, options.keyframe);
        } else {
            mj.mj_resetData(m, d);
        }
        mj.mj_forward(m, d);

        let stopped: string | null = null;
        const api = this.api(run, reason => {
            stopped = reason ?? 'the controller stopped the run';
        });
        let controller: Controller | null = null;
        if (options.controller) {
            try {
                controller = createController(options.controller);
            } catch (err) {
                return { ...run, outcome: 'error', message: `controller: ${err instanceof Error ? err.message : String(err)}` };
            }
        }
        const started = Date.now();
        const frameDt = 1 / frameHz;
        let nextFrame = 0;
        let nextControl = 0;
        const record = () => {
            if (run.frames.length < MAX_FRAMES) {
                run.frames.push(Array.from(d.qpos as ArrayLike<number>, v => round(v, 5)));
            }
        };
        try {
            controller?.init?.(api);
            while (d.time < seconds - 1e-9 && stopped === null) {
                if (d.time >= nextFrame - 1e-9) {
                    record();
                    nextFrame += frameDt;
                }
                if (controller && d.time >= nextControl - 1e-9) {
                    controller.control(api);
                    nextControl += controlDt;
                }
                mj.mj_step(m, d);
                if (blownUp(d)) {
                    run.outcome = 'unstable';
                    run.message = `the simulation blew up at ${round(d.time, 3)} s: forces too large for the timestep, or bad masses/limits`;
                    break;
                }
                if (Date.now() - started > wallMs) {
                    run.outcome = 'timeout';
                    run.message = `stopped after ${wallMs / 1000} s of real time`;
                    break;
                }
            }
        } catch (err) {
            run.outcome = 'error';
            run.message = `controller at ${round(d.time, 3)} s: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (stopped !== null && run.outcome === 'done') {
            run.outcome = 'stopped';
            run.message = stopped;
        }
        if (run.outcome !== 'unstable') {
            record();
        }
        run.simS = round(d.time, 4);
        return run;
    }

    /** The `sim` object a controller sees. */
    private api(run: SceneRun, stop: (reason?: string) => void): ControllerApi {
        const { mj, model: m, data: d } = this;
        const id = (kind: number, name: string, what: string) => {
            const i = mj.mj_name2id(m, kind, name);
            if (i < 0) {
                throw new Error(`no ${what} named "${name}"`);
            }
            return i;
        };
        const actuator = (which: string | number) => {
            const i = typeof which === 'number' ? which : id(OBJ_ACTUATOR, which, 'actuator');
            if (!Number.isInteger(i) || i < 0 || i >= m.nu) {
                throw new Error(`no actuator ${which}`);
            }
            return i;
        };
        // MuJoCo compiles ctrllimited="auto" to limited exactly when the range is non-empty.
        const ctrlRange = (a: number): [number, number] | null => {
            const lo = m.actuator_ctrlrange[2 * a];
            const hi = m.actuator_ctrlrange[2 * a + 1];
            return lo < hi ? [lo, hi] : null;
        };
        return {
            get t() {
                return d.time;
            },
            joint: (name: string) => {
                const j = id(OBJ_JOINT, name, 'joint');
                const q = m.jnt_qposadr[j];
                const v = m.jnt_dofadr[j];
                const type = m.jnt_type[j];
                const nq = type === 0 ? 7 : type === 1 ? 4 : 1;
                const nv = type === 0 ? 6 : type === 1 ? 3 : 1;
                const pos = Array.from((d.qpos as Float64Array).subarray(q, q + nq));
                const vel = Array.from((d.qvel as Float64Array).subarray(v, v + nv));
                return nq === 1 ? { q: pos[0], v: vel[0] } : { q: pos, v: vel };
            },
            body: (name: string) => {
                const b = id(OBJ_BODY, name, 'body');
                return {
                    pos: [d.xpos[3 * b], d.xpos[3 * b + 1], d.xpos[3 * b + 2]],
                    quat: [d.xquat[4 * b], d.xquat[4 * b + 1], d.xquat[4 * b + 2], d.xquat[4 * b + 3]],
                };
            },
            site: (name: string) => {
                const s = id(OBJ_SITE, name, 'site');
                return [d.site_xpos[3 * s], d.site_xpos[3 * s + 1], d.site_xpos[3 * s + 2]];
            },
            sensor: (name: string) => {
                const s = id(OBJ_SENSOR, name, 'sensor');
                const a = m.sensor_adr[s];
                return Array.from((d.sensordata as Float64Array).subarray(a, a + m.sensor_dim[s]));
            },
            actuators: () => names(mj, m, OBJ_ACTUATOR, m.nu),
            ctrl: (which: string | number, value: number) => {
                const a = actuator(which);
                if (!Number.isFinite(value)) {
                    throw new Error(`ctrl for ${which} is not a number: ${value}`);
                }
                const range = ctrlRange(a);
                d.ctrl[a] = range ? Math.min(range[1], Math.max(range[0], value)) : value;
            },
            ctrlRange: (which: string | number) => ctrlRange(actuator(which)),
            contacts: () => {
                const out: Array<{ a: string; b: string; depth: number }> = [];
                for (let i = 0; i < d.ncon && out.length < 64; i++) {
                    const c = d.contact.get(i);
                    if (c) {
                        out.push({ a: this.geomLabel(c.geom1), b: this.geomLabel(c.geom2), depth: round(-c.dist, 6) });
                        c.delete();
                    }
                }
                return out;
            },
            metric: (name: string, value: number) => {
                if (!Number.isFinite(value)) {
                    return;
                }
                const series = (run.metrics[name] ??= []);
                if (series.length < 2000) {
                    series.push([round(d.time, 4), round(value, 6)]);
                }
            },
            log: (...values: unknown[]) => {
                if (run.logs.length < MAX_LOGS) {
                    run.logs.push(`[${d.time.toFixed(2)}s] ${values.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ')}`);
                }
            },
            stop,
        };
    }

    /** "geom name (body name)", or the body alone for unnamed geoms. */
    private geomLabel(g: number): string {
        const geom = this.mj.mj_id2name(this.model, OBJ_GEOM, g);
        const body = this.mj.mj_id2name(this.model, OBJ_BODY, this.model.geom_bodyid[g]) || 'world';
        return geom ? `${geom} (${body})` : body;
    }
}

function names(mj: MainModule, m: MjModel, kind: number, n: number): string[] {
    return Array.from({ length: n }, (_, i) => mj.mj_id2name(m, kind, i) || `#${i}`);
}

/** Absurd speed, not a number, or MuJoCo's own bad-state warnings (it resets the state when it gives them). */
function blownUp(d: MjData): boolean {
    const v = d.qvel as ArrayLike<number>;
    for (let i = 0; i < v.length; i++) {
        if (!(Math.abs(v[i]) < 1e5)) {
            return true;
        }
    }
    if (!finite(d.qpos)) {
        return true;
    }
    for (const w of BAD_STATE_WARNINGS) {
        const stat = d.warning.get(w);
        const hit = Boolean(stat && stat.number > 0);
        stat?.delete();
        if (hit) {
            return true;
        }
    }
    return false;
}

function finite(a: ArrayLike<number>): boolean {
    for (let i = 0; i < a.length; i++) {
        if (!Number.isFinite(a[i])) {
            return false;
        }
    }
    return true;
}

function warnings(d: MjData): string[] {
    const out: string[] = [];
    for (let i = 0; i < WARNING_NAMES.length; i++) {
        const w = d.warning.get(i);
        if (w) {
            if (w.number > 0) {
                out.push(`MuJoCo warning "${WARNING_NAMES[i]}" ${w.number} time(s)`);
            }
            w.delete();
        }
    }
    return out;
}

function errorText(mj: MainModule, err: unknown): string {
    if (typeof err === 'number') {
        // Emscripten throws a pointer for C++ exceptions; ask for its message when the build allows it.
        const get = (mj as unknown as { getExceptionMessage?: (p: number) => [string, string] }).getExceptionMessage;
        if (get) {
            try {
                return get(err).join(': ');
            } catch {
                // fall through
            }
        }
        return 'the model has an error (MuJoCo gave no message)';
    }
    return err instanceof Error ? err.message : String(err);
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
