// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Framing a model of any size, from a 1 cm screw to a 200 m building: the
 * camera distance that fits its bounding sphere in the narrower field of
 * view, and near/far planes scaled to it.
 */

export interface Sphere {
    center: [number, number, number];
    radius: number;
}

/** Vertical field of view (degrees) and width/height -> the narrower half-angle in radians. */
export function narrowHalfAngle(fovDeg: number, aspect: number): number {
    const halfV = (fovDeg * Math.PI) / 360;
    if (aspect >= 1) {
        return halfV;
    }
    return Math.atan(Math.tan(halfV) * aspect);
}

/** Distance from the sphere's centre at which the whole sphere is in frame with `margin` (<1 leaves room). */
export function fitDistance(radius: number, fovDeg: number, aspect: number, margin = 0.86): number {
    const r = Math.max(radius, 1e-6);
    return r / Math.sin(narrowHalfAngle(fovDeg, aspect) * margin);
}

/** Near and far planes for a camera `distance` from a model of `radius`. */
export function clipPlanes(distance: number, radius: number): { near: number; far: number } {
    const r = Math.max(radius, 1e-6);
    return { near: Math.max(r * 0.001, (distance - r) * 0.05), far: distance + r * 20 };
}
