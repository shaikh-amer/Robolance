// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The maths behind ZoomPane: a view is a scale and the translation of the
 * content's origin within the pane, in pane pixels. Everything here is pure
 * so it can be tested without a DOM.
 */

export interface ZoomView {
    scale: number;
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface Point {
    x: number;
    y: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 8;

export interface ScaleLimits {
    min?: number;
    max?: number;
}

export function clampScale(scale: number, limits: ScaleLimits = {}): number {
    const min = limits.min ?? MIN_SCALE;
    const max = limits.max ?? MAX_SCALE;
    if (!Number.isFinite(scale)) {
        return min;
    }
    return Math.min(max, Math.max(min, scale));
}

/** Scales by `factor` around the pane point (cx, cy): what was under it stays under it. */
export function zoomAt(view: ZoomView, factor: number, cx: number, cy: number, limits?: ScaleLimits): ZoomView {
    const scale = clampScale(view.scale * factor, limits);
    const ratio = scale / view.scale;
    return {
        scale,
        x: cx - (cx - view.x) * ratio,
        y: cy - (cy - view.y) * ratio,
    };
}

export function pan(view: ZoomView, dx: number, dy: number): ZoomView {
    return { scale: view.scale, x: view.x + dx, y: view.y + dy };
}

export interface FitOptions {
    /** `width` fills the pane's width and starts at the top; `contain` shows all of the content, centred. */
    mode?: 'width' | 'contain';
    /** The fit never enlarges beyond this (1 keeps graphics at their natural size). */
    maxScale?: number;
    padding?: number;
}

/** The view that shows the content in a pane of the given size. */
export function fitView(content: Size, pane: Size, options: FitOptions = {}): ZoomView {
    const mode = options.mode ?? 'contain';
    const padding = options.padding ?? 0;
    const maxScale = options.maxScale ?? MAX_SCALE;
    const availW = Math.max(1, pane.width - 2 * padding);
    const availH = Math.max(1, pane.height - 2 * padding);
    const byWidth = availW / Math.max(1, content.width);
    const byHeight = availH / Math.max(1, content.height);
    const raw = mode === 'width' ? byWidth : Math.min(byWidth, byHeight);
    const scale = clampScale(Math.min(maxScale, raw), { min: MIN_SCALE, max: maxScale });
    const shownW = content.width * scale;
    const shownH = content.height * scale;
    const x = shownW < availW ? padding + (availW - shownW) / 2 : padding;
    const y = mode === 'width' ? padding : (shownH < availH ? padding + (availH - shownH) / 2 : padding);
    return { scale, x, y };
}

function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Two fingers moved from `before` to `after`: zoom by their spread and follow their midpoint. */
export function pinch(view: ZoomView, before: [Point, Point], after: [Point, Point], limits?: ScaleLimits): ZoomView {
    const d0 = distance(before[0], before[1]);
    const d1 = distance(after[0], after[1]);
    const factor = d0 > 0 ? d1 / d0 : 1;
    const m0 = midpoint(before[0], before[1]);
    const m1 = midpoint(after[0], after[1]);
    const zoomed = zoomAt(view, factor, m0.x, m0.y, limits);
    return pan(zoomed, m1.x - m0.x, m1.y - m0.y);
}

/** A wheel notch becomes a zoom factor: fine steps for pixel deltas, coarser for line deltas. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
    const perUnit = deltaMode === 0 ? 0.0025 : deltaMode === 1 ? 0.08 : 0.4;
    const factor = Math.exp(-deltaY * perUnit);
    return Math.min(2, Math.max(0.5, factor));
}
