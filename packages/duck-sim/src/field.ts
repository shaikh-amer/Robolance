// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The pitch: where the duck starts, where the ball is, where the goal is.
 * Metres, x towards the goal, y to the duck's left at the start, heading
 * in degrees counter-clockwise from +x.
 */

export interface FieldSpec {
    duck: { x: number; y: number; heading: number };
    ball: { x: number; y: number };
    /** The goal line is at x; the mouth spans y ± width/2. */
    goal: { x: number; y: number; width: number };
    /** Playing area; a ball that leaves it is out. */
    bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
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
    return undefined;
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
    <body name="football" pos="${n(f.ball.x)} ${n(f.ball.y)} ${BALL_RADIUS}">
      <freejoint name="football_free"/>
      <geom name="football_geom" type="sphere" size="${BALL_RADIUS}" mass="0.035" rgba="0.95 0.55 0.18 1" friction="0.5 0.005 0.001" condim="3"/>
    </body>
  </worldbody>
</mujoco>`;
}
