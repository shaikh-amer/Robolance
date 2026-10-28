// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance
//
// Ported from TonyRuan/microduck-web src/simulation/controller.ts
// (Apache-2.0), itself a port of pollen-robotics/microduck's control loop.

/**
 * How a trained Microduck skill is driven: the 61-value observation it was
 * trained on, and how its 14 outputs become servo targets. Every skill runs
 * at 50 Hz on the same layout, so one controller serves them all.
 */

/** Servo order in the robot model; index 9 (the beak) has no skill output. */
export const JOINTS = [
    'left_hip_yaw', 'left_hip_roll', 'left_hip_pitch', 'left_knee', 'left_ankle',
    'neck_pitch', 'head_pitch', 'head_yaw', 'head_roll', 'mouth',
    'right_hip_yaw', 'right_hip_roll', 'right_hip_pitch', 'right_knee', 'right_ankle',
] as const;

/** Standing pose the skills' outputs are offsets from, radians. */
export const HOME = [
    0, -0.0873, -0.4579, -0.0049, 0.453, 0.3491, 0.3491, 0, 0, 0,
    0, 0.0873, 0.4579, 0.0049, -0.453,
];

/** Control period: every skill was trained at 50 Hz. */
export const CONTROL_DT = 0.02;

export interface Sensors {
    /** Joint positions in JOINTS order. */
    positions: ArrayLike<number>;
    velocities: ArrayLike<number>;
    /** Trunk angular velocity, body frame. */
    gyro: ArrayLike<number>;
    /** Gravity direction in the trunk frame. */
    gravity: ArrayLike<number>;
}

export function observation(s: Sensors, lastAction: ArrayLike<number>, command: ArrayLike<number>): Float32Array {
    const obs = new Float32Array(61);
    obs.set(Array.from(s.gyro), 0);
    obs.set(Array.from(s.gravity), 3);
    for (let i = 0; i < 14; i++) {
        const j = i < 9 ? i : i + 1;
        obs[6 + i] = s.positions[j] - HOME[j];
        obs[20 + i] = s.velocities[j];
    }
    obs.set(Array.from(lastAction), 34);
    obs.set(Array.from(command), 48);
    return obs;
}

/**
 * Turns a skill's output into servo targets, smoothed against the previous
 * targets the way the robot does (the head more than the legs).
 */
export function targets(action: ArrayLike<number>, scale: number, previous: Float64Array | null): Float64Array {
    const out = Float64Array.from(HOME);
    for (let i = 0; i < 14; i++) {
        const j = i < 9 ? i : i + 1;
        out[j] += scale * action[i];
    }
    if (previous) {
        for (let j = 0; j < 15; j++) {
            if (j === 9) {
                continue;
            }
            const a = j >= 5 && j < 9 ? 0.5 : 0.7;
            out[j] = a * out[j] + (1 - a) * previous[j];
        }
    }
    return out;
}
