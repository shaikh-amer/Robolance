// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The duck's beak in the replay. The Microduck has no jaw joint (the body
 * called jaw_soft is the whole head front on the head-roll hinge), so the
 * viewer swings the orange jaw and its soft pad on a hinge of its own: a
 * short chirp at every kick, and three quacks when the duck scores or
 * shuts the laptop. Pure drawing; the recorded physics are untouched.
 */

import type { MissionResult } from 'robolance-duck-sim/viewer';
import type { PartHinge } from './robot-parts';

/** The lower beak: the orange jaw and the soft lower pad, swinging about a lateral axis at the back of the jaw (head frame). */
export const BEAK_HINGE: PartHinge = { body: 10, meshes: ['jaw', 'jaw_soft'], pivot: [0.0, 0, -0.012], axis: [0, 1, 0] };

/** How far the beak opens, radians, at opening 1. */
export const BEAK_OPEN_RAD = 0.32;

const CHIRP_S = 0.3;
const CELEBRATE_DELAY_S = 0.15;
const QUACK_S = 0.5;
const QUACKS = 3;

/** One open-and-close over `length` seconds, 0 outside it. */
function pulse(u: number, length: number): number {
    return u >= 0 && u < length ? Math.sin((Math.PI * u) / length) : 0;
}

/**
 * How open the beak is (0 shut, 1 wide) at `atS` seconds into the run:
 * a chirp as the duck kicks, three quacks after a goal or a shut laptop.
 */
export function beakOpening(result: Pick<MissionResult, 'kicks' | 'scoredAtS' | 'closedAtS'>, atS: number): number {
    let open = 0;
    for (const kick of result.kicks ?? []) {
        open = Math.max(open, 0.6 * pulse(atS - kick.atS, CHIRP_S));
    }
    const moment = typeof result.scoredAtS === 'number' ? result.scoredAtS : typeof result.closedAtS === 'number' ? result.closedAtS : undefined;
    if (moment !== undefined) {
        const u = atS - moment - CELEBRATE_DELAY_S;
        if (u >= 0 && u < QUACKS * QUACK_S) {
            open = Math.max(open, pulse(u % QUACK_S, QUACK_S));
        }
    }
    return open;
}
