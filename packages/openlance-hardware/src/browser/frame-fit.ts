// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * How far back an orbit camera stands so a set of points fits the frame:
 * the same view angles on a tall phone panel and a wide desktop one show
 * the same things, the phone from further away.
 */

import * as THREE from 'three';

/** How far towards the canvas edge (in clip space, 1 = the edge) framed points may sit. */
export const FRAME_MARGIN = 0.86;

export interface OrbitAngles {
    /** Degrees around the target, 0 = looking along +x. */
    azimuth: number;
    /** Degrees above the ground. */
    elevation: number;
}

/** Camera position for an orbit around `target` (z up) at `distance`. */
export function orbitPosition(target: THREE.Vector3, angles: OrbitAngles, distance: number, out = new THREE.Vector3()): THREE.Vector3 {
    const az = (angles.azimuth * Math.PI) / 180;
    const el = (angles.elevation * Math.PI) / 180;
    return out.set(
        target.x - distance * Math.cos(el) * Math.cos(az),
        target.y - distance * Math.cos(el) * Math.sin(az),
        target.z + distance * Math.sin(el),
    );
}

/**
 * The smallest distance (0.2-30 m) at which a camera with this vertical
 * field of view and aspect, orbiting `target` at these angles, keeps every
 * point inside `margin` of the frame.
 */
export function distanceToFit(
    points: THREE.Vector3[], target: THREE.Vector3, angles: OrbitAngles, fovDeg: number, aspect: number, margin = FRAME_MARGIN,
): number {
    const cam = new THREE.PerspectiveCamera(fovDeg, aspect, 0.01, 100);
    cam.up.set(0, 0, 1);
    const p = new THREE.Vector3();
    const fits = (d: number): boolean => {
        orbitPosition(target, angles, d, cam.position);
        cam.lookAt(target);
        cam.updateMatrixWorld();
        return points.every(q => {
            p.copy(q).project(cam);
            return p.z < 1 && Math.abs(p.x) <= margin && Math.abs(p.y) <= margin;
        });
    };
    let lo = 0.2;
    let hi = 30;
    if (!fits(hi)) {
        return hi;
    }
    for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    return hi;
}

/**
 * Where the fog starts and ends for a camera `distance` from what it looks
 * at. The fog is tuned for the home view; zooming out pushes it back by the
 * same amount, so the stage looks as clear from afar as from home and only
 * the ground beyond it fades. Zooming in leaves it where it is.
 */
export function fogRange(distance: number, home: number, near: number, far: number): { near: number; far: number } {
    const back = Number.isFinite(distance) && Number.isFinite(home) ? Math.max(0, distance - home) : 0;
    return { near: near + back, far: far + back };
}
