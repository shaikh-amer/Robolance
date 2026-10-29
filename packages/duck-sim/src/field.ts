// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The pitch: where the duck starts, where the ball is, where the goal is.
 * Metres, x towards the goal, y to the duck's left at the start, heading
 * in degrees counter-clockwise from +x.
 */

/**
 * A box standing on the pitch: a cardboard box, a chair leg, a fridge. x, y
 * is its centre, width runs along its heading (degrees, default 0 = along
 * +x), depth across it.
 */
export interface Obstacle {
    name?: string;
    x: number;
    y: number;
    width: number;
    depth: number;
    height: number;
    heading?: number;
}

export interface FieldSpec {
    duck: { x: number; y: number; heading: number };
    ball: { x: number; y: number };
    /** The goal line is at x; the mouth spans y ± width/2. */
    goal: { x: number; y: number; width: number };
    /** Playing area; a ball that leaves it is out. */
    bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
    /** Boxes on the pitch the duck has to go around. */
    obstacles?: Obstacle[];
    /**
     * A laptop open on the pitch. With a laptop the mission's job is to close
     * it (push the lid past upright, then it falls shut); the ball and goal are just there.
     */
    laptop?: LaptopSpec;
}

/**
 * x, y is the middle of the laptop's base; heading (degrees) is the way the
 * screen faces, from the hinge towards the front edge. openDeg is how far the
 * lid is open (0 closed, default 100: just past upright, as a laptop sits on a desk).
 */
export interface LaptopSpec {
    x: number;
    y: number;
    heading: number;
    openDeg?: number;
}

/** A 14-inch laptop, metres. */
export const LAPTOP = {
    /** Along the hinge. */
    width: 0.32,
    /** Front to back. */
    depth: 0.22,
    baseHeight: 0.018,
    lidLength: 0.21,
    lidThickness: 0.006,
    lidMass: 0.3,
    defaultOpenDeg: 100,
};
/** The lid counts as closed below this angle, degrees. */
export const LAPTOP_CLOSED_DEG = 10;

/** The laptop's footprint, with the open lid leaning out behind the hinge. */
function laptopFootprint(l: LaptopSpec): Obstacle {
    const open = ((l.openDeg ?? LAPTOP.defaultOpenDeg) * Math.PI) / 180;
    const behind = Math.max(0, -Math.cos(open) * LAPTOP.lidLength);
    const h = (l.heading * Math.PI) / 180;
    const shift = -behind / 2;
    return {
        x: l.x + shift * Math.cos(h), y: l.y + shift * Math.sin(h),
        width: LAPTOP.depth + behind, depth: LAPTOP.width, height: LAPTOP.lidLength, heading: l.heading,
    };
}

/** Distance from a point to the laptop (its base and the lid leaning back), 0 inside. */
export function distanceToLaptop(l: LaptopSpec, x: number, y: number): number {
    return distanceToObstacle(laptopFootprint(l), x, y);
}

function validateLaptop(f: FieldSpec): string | undefined {
    const l = f.laptop;
    if (!l) {
        return undefined;
    }
    if (![l.x, l.y, l.heading, l.openDeg ?? LAPTOP.defaultOpenDeg].every(v => typeof v === 'number' && Number.isFinite(v))) {
        return 'laptop: every value must be a finite number';
    }
    const open = l.openDeg ?? LAPTOP.defaultOpenDeg;
    if (open < 60 || open > 125) {
        return 'laptop: openDeg is 60-125';
    }
    const reach = Math.hypot(LAPTOP.width, LAPTOP.depth) / 2 + 0.1;
    if (l.x - reach < f.bounds.xMin || l.x + reach > f.bounds.xMax || l.y - reach < f.bounds.yMin || l.y + reach > f.bounds.yMax) {
        return 'laptop: keep it at least 10 cm inside the bounds';
    }
    if (distanceToLaptop(l, f.duck.x, f.duck.y) < DUCK_RADIUS + 0.08) {
        return "laptop: keep it 15 cm clear of the duck's start";
    }
    if (distanceToLaptop(l, f.ball.x, f.ball.y) < BALL_RADIUS + 0.02) {
        return 'laptop: it covers the ball';
    }
    for (const [i, o] of (f.obstacles ?? []).entries()) {
        const fp = laptopFootprint(l);
        if (distanceToObstacle(o, fp.x, fp.y) < 0.01) {
            return `laptop: it sits on ${obstacleName(o, i)}`;
        }
    }
    return undefined;
}

export const MAX_OBSTACLES = 24;
/** How close the duck's centre gets to something before its body touches it, metres. */
export const DUCK_RADIUS = 0.07;

/** Distance from a point to a box's footprint (0 inside it). */
export function distanceToObstacle(o: Obstacle, x: number, y: number): number {
    const h = ((o.heading ?? 0) * Math.PI) / 180;
    const dx = x - o.x;
    const dy = y - o.y;
    const along = dx * Math.cos(h) + dy * Math.sin(h);
    const across = -dx * Math.sin(h) + dy * Math.cos(h);
    return Math.hypot(Math.max(0, Math.abs(along) - o.width / 2), Math.max(0, Math.abs(across) - o.depth / 2));
}

/** The obstacle's name for notes: its own, or "obstacle N". */
export function obstacleName(o: Obstacle, i: number): string {
    return o.name?.trim() || `obstacle ${i + 1}`;
}

function validateObstacles(f: FieldSpec): string | undefined {
    const list = f.obstacles ?? [];
    if (!Array.isArray(list)) {
        return 'obstacles is a list';
    }
    if (list.length > MAX_OBSTACLES) {
        return `at most ${MAX_OBSTACLES} obstacles`;
    }
    for (const [i, o] of list.entries()) {
        const label = obstacleName(o, i);
        const values = [o.x, o.y, o.width, o.depth, o.height, o.heading ?? 0];
        if (!values.every(v => typeof v === 'number' && Number.isFinite(v))) {
            return `${label}: every value must be a finite number`;
        }
        if (o.name !== undefined && (typeof o.name !== 'string' || o.name.length > 40)) {
            return `${label}: the name is up to 40 characters`;
        }
        if (o.width < 0.02 || o.width > 3 || o.depth < 0.02 || o.depth > 3) {
            return `${label}: width and depth are 0.02-3 m`;
        }
        if (o.height < 0.02 || o.height > 2) {
            return `${label}: height is 0.02-2 m`;
        }
        if (o.x <= f.bounds.xMin || o.x >= f.bounds.xMax || o.y <= f.bounds.yMin || o.y >= f.bounds.yMax) {
            return `${label}: its centre must be inside the bounds`;
        }
        if (distanceToObstacle(o, f.duck.x, f.duck.y) < DUCK_RADIUS + 0.03) {
            return `${label}: it covers the duck's start; keep 10 cm clear around the duck`;
        }
        if (distanceToObstacle(o, f.ball.x, f.ball.y) < BALL_RADIUS + 0.01) {
            return `${label}: it covers the ball`;
        }
    }
    return undefined;
}

export const BALL_RADIUS = 0.025;
export const POST_RADIUS = 0.008;
export const GOAL_HEIGHT = 0.12;
/** How far the net reaches behind the goal line. */
export const NET_DEPTH = 0.12;

/**
 * The default task, sized to the duck: a kick sends the ball 0.4-0.8 m, so
 * the goal is 45 cm beyond the ball, which sits off to one side.
 */
export const DEFAULT_FIELD: FieldSpec = {
    duck: { x: 0, y: 0, heading: 0 },
    ball: { x: 0.5, y: 0.2 },
    goal: { x: 0.95, y: 0, width: 0.6 },
    bounds: { xMin: -0.4, xMax: 1.3, yMin: -0.7, yMax: 0.7 },
};

export function validateField(f: FieldSpec): string | undefined {
    const finite = (...v: number[]) => v.every(Number.isFinite);
    if (!finite(f.duck.x, f.duck.y, f.duck.heading, f.ball.x, f.ball.y, f.goal.x, f.goal.y, f.goal.width,
        f.bounds.xMin, f.bounds.xMax, f.bounds.yMin, f.bounds.yMax)) {
        return 'every field value must be a finite number';
    }
    if (f.bounds.xMax - f.bounds.xMin > 10 || f.bounds.yMax - f.bounds.yMin > 10) {
        return 'the field is at most 10 m on a side';
    }
    if (f.goal.width < 0.1 || f.goal.width > 2) {
        return 'the goal is 0.1-2 m wide';
    }
    const inside = (x: number, y: number) => x > f.bounds.xMin && x < f.bounds.xMax && y > f.bounds.yMin && y < f.bounds.yMax;
    if (!inside(f.duck.x, f.duck.y) || !inside(f.ball.x, f.ball.y)) {
        return 'the duck and the ball start inside the bounds';
    }
    if (f.goal.x + NET_DEPTH >= f.bounds.xMax || f.goal.y - f.goal.width / 2 <= f.bounds.yMin || f.goal.y + f.goal.width / 2 >= f.bounds.yMax) {
        return 'the goal and its net sit inside the bounds';
    }
    if (f.ball.x >= f.goal.x || f.duck.x >= f.goal.x) {
        return 'the duck and the ball start in front of the goal line';
    }
    if (Math.hypot(f.ball.x - f.duck.x, f.ball.y - f.duck.y) < 0.15) {
        return 'the ball starts at least 15 cm from the duck';
    }
    return validateObstacles(f) ?? validateLaptop(f);
}

/** The MuJoCo scene: the robot, the floor, the ball and the goal posts. */
export function sceneXml(f: FieldSpec, robotFile = 'robot_groundcontact.xml'): string {
    const n = (v: number) => Number(v.toFixed(4));
    const y1 = f.goal.y - f.goal.width / 2;
    const y2 = f.goal.y + f.goal.width / 2;
    const post = (name: string, y: number) =>
        `<geom name="${name}" type="cylinder" size="${POST_RADIUS} ${GOAL_HEIGHT / 2}" pos="${n(f.goal.x)} ${n(y)} ${GOAL_HEIGHT / 2}" rgba="0.95 0.95 0.95 1"/>`;
    const back = n(f.goal.x + NET_DEPTH);
    const net = 'rgba="1 1 1 0.35" friction="1 0.005 0.001"';
    const side = (name: string, y: number) =>
        `<geom name="${name}" type="box" size="${n(NET_DEPTH / 2)} 0.003 ${GOAL_HEIGHT / 2}" pos="${n(f.goal.x + NET_DEPTH / 2)} ${n(y)} ${GOAL_HEIGHT / 2}" ${net}/>`;
    return `<?xml version="1.0"?>
<mujoco model="duck-field">
  <include file="${robotFile}"/>
  <worldbody>
    <light pos="0 0 3.5" dir="0 0 -1" directional="true"/>
    <geom name="floor" size="0 0 0.05" type="plane" rgba="0.2 0.45 0.25 1"/>
    ${post('post_right', y1)}
    ${post('post_left', y2)}
    <geom name="net_back" type="box" size="0.003 ${n(f.goal.width / 2)} ${GOAL_HEIGHT / 2}" pos="${back} ${n(f.goal.y)} ${GOAL_HEIGHT / 2}" ${net}/>
    ${side('net_right', y1)}
    ${side('net_left', y2)}
    <geom name="crossbar" type="capsule" fromto="${n(f.goal.x)} ${n(y1)} ${GOAL_HEIGHT} ${n(f.goal.x)} ${n(y2)} ${GOAL_HEIGHT}" size="${POST_RADIUS}" rgba="0.95 0.95 0.95 1" contype="0" conaffinity="0"/>
    ${(f.obstacles ?? []).map((o, i) => obstacleGeom(o, i, n)).join('\n    ')}
    <body name="football" pos="${n(f.ball.x)} ${n(f.ball.y)} ${BALL_RADIUS}">
      <freejoint name="football_free"/>
      <geom name="football_geom" type="sphere" size="${BALL_RADIUS}" mass="0.035" rgba="0.95 0.55 0.18 1" friction="0.5 0.005 0.001" condim="3"/>
    </body>${f.laptop ? '\n    ' + laptopXml(f.laptop, n) : ''}
  </worldbody>
</mujoco>`;
}

/** A static box geom for an obstacle (cardboard brown), turned by its heading. */
function obstacleGeom(o: Obstacle, i: number, n: (v: number) => number): string {
    const half = ((o.heading ?? 0) * Math.PI) / 360;
    return `<geom name="obstacle_${i}" type="box" size="${n(o.width / 2)} ${n(o.depth / 2)} ${n(o.height / 2)}" `
        + `pos="${n(o.x)} ${n(o.y)} ${n(o.height / 2)}" quat="${n(Math.cos(half))} 0 0 ${n(Math.sin(half))}" rgba="0.72 0.55 0.36 1" friction="0.8 0.005 0.001"/>`;
}

/**
 * The laptop: a fixed base and a lid on a hinge along the base's back edge.
 * The lid's joint, laptop_lid, is its opening angle in radians (0 closed);
 * it rests against its upper limit, open, until something pushes it past
 * upright and gravity closes it. It comes after the ball, so the ball keeps
 * its place in qpos and the lid angle is the last value.
 */
function laptopXml(l: LaptopSpec, n: (v: number) => number): string {
    const half = (l.heading * Math.PI) / 360;
    const open = ((l.openDeg ?? LAPTOP.defaultOpenDeg) * Math.PI) / 180;
    const L = LAPTOP;
    return `<body name="laptop" pos="${n(l.x)} ${n(l.y)} 0" quat="${n(Math.cos(half))} 0 0 ${n(Math.sin(half))}">
      <geom name="laptop_base" type="box" size="${n(L.depth / 2)} ${n(L.width / 2)} ${n(L.baseHeight / 2)}" pos="0 0 ${n(L.baseHeight / 2)}" rgba="0.55 0.57 0.6 1" friction="0.8 0.005 0.001"/>
      <body name="laptop_lid" pos="${n(-L.depth / 2)} 0 ${n(L.baseHeight)}">
        <joint name="laptop_lid" type="hinge" axis="0 -1 0" range="0 ${n(open)}" damping="0.004" frictionloss="0.0005"/>
        <geom name="laptop_lid_geom" type="box" size="${n(L.lidLength / 2)} ${n(L.width / 2)} ${n(L.lidThickness / 2)}" pos="${n(L.lidLength / 2)} 0 ${n(L.lidThickness / 2)}" mass="${L.lidMass}" rgba="0.5 0.52 0.55 1" friction="0.8 0.005 0.001"/>
      </body>
    </body>`;
}
