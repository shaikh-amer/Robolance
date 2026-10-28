// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Procedural textures for the 3D stage, drawn on canvases so nothing is
 * downloaded: grass with blade-scale noise (colour plus a matching bump
 * map), a sky that fades into the horizon, and goal netting.
 */

/** A small deterministic generator, so a pitch looks the same on every load. */
export function seededRandom(seed: number): () => number {
    let s = seed >>> 0 || 1;
    return () => {
        // xorshift32
        s ^= s << 13;
        s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5;
        s >>>= 0;
        return s / 0x100000000;
    };
}

/**
 * Blade-scale grass noise, -1 to 1 per pixel: white noise smeared along
 * short vertical runs (blades) with a little of the neighbour columns
 * mixed in. Pixel arithmetic, not strokes, so a 2048 px pitch takes
 * milliseconds.
 */
export function turfNoise(width: number, height: number, rand: () => number): Float32Array {
    const raw = new Float32Array(width * height);
    for (let i = 0; i < raw.length; i++) {
        raw[i] = rand() * 2 - 1;
    }
    const out = new Float32Array(width * height);
    const run = 4;
    for (let x = 0; x < width; x++) {
        let sum = 0;
        // A running vertical average: each pixel is the mean of the `run` above it.
        for (let y = 0; y < height; y++) {
            sum += raw[y * width + x];
            if (y >= run) {
                sum -= raw[(y - run) * width + x];
            }
            out[y * width + x] = sum / Math.min(y + 1, run);
        }
    }
    for (let i = 0; i < out.length; i++) {
        // Keep some per-pixel grain on top of the blades.
        out[i] = Math.max(-1, Math.min(1, out[i] * 1.4 + raw[i] * 0.25));
    }
    return out;
}

/**
 * Lays turf noise over what is already painted (stripes, lines): each
 * pixel a little lighter or darker by `strength`. `bump`, when given, gets
 * the same noise as grey heights for the bump map.
 */
export function paintTurf(
    ctx: CanvasRenderingContext2D,
    bump: CanvasRenderingContext2D | undefined,
    width: number,
    height: number,
    strength: number,
    rand: () => number,
): void {
    const noise = turfNoise(width, height, rand);
    const image = ctx.getImageData(0, 0, width, height);
    const px = image.data;
    for (let i = 0; i < noise.length; i++) {
        const k = 1 + noise[i] * strength;
        px[4 * i] = Math.min(255, px[4 * i] * k);
        px[4 * i + 1] = Math.min(255, px[4 * i + 1] * k);
        px[4 * i + 2] = Math.min(255, px[4 * i + 2] * k);
    }
    ctx.putImageData(image, 0, 0);
    if (bump) {
        const heights = bump.createImageData(width, height);
        const h = heights.data;
        for (let i = 0; i < noise.length; i++) {
            const g = Math.round(128 + noise[i] * 110);
            h[4 * i] = h[4 * i + 1] = h[4 * i + 2] = g;
            h[4 * i + 3] = 255;
        }
        bump.putImageData(heights, 0, 0);
    }
}

/** Large soft patches of lighter and darker turf, as on a real pitch. */
export function paintPatches(ctx: CanvasRenderingContext2D, width: number, height: number, rand: () => number): void {
    const patches = Math.round((width * height) / 9000);
    for (let i = 0; i < patches; i++) {
        const x = rand() * width;
        const y = rand() * height;
        const r = 20 + rand() * 70;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const dark = rand() > 0.5;
        g.addColorStop(0, dark ? 'rgba(0,20,0,0.07)' : 'rgba(200,230,150,0.06)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
}

/** A vertical sky gradient for the scene background: `top` at the zenith, `horizon` at the bottom. */
export function skyCanvas(top: string, horizon: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, top);
    g.addColorStop(0.75, horizon);
    g.addColorStop(1, horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
}

/** Square netting on a transparent background; repeat it across the net's planes. */
export function netCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, 64, 64);
    return canvas;
}
