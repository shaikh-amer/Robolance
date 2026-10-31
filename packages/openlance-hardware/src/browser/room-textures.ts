// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Indoor surfaces for the 3D stage, drawn on canvases so nothing is
 * downloaded: wood planks and wood grain, ceramic tiles, carpet, concrete,
 * sofa fabric and painted walls. Each comes with a matching bump map, so
 * light rakes across grain, grout and weave as it does on the real thing.
 */

import * as THREE from 'three';
import { isSmallDevice } from './stage-base';
import { seededRandom } from './stage-textures';

export interface Surface {
    color: THREE.CanvasTexture;
    bump: THREE.CanvasTexture;
}

type Paint = (ctx: CanvasRenderingContext2D, bump: CanvasRenderingContext2D, size: number, rand: () => number) => void;

const cache = new Map<string, { canvas: HTMLCanvasElement; bump: HTMLCanvasElement }>();

/** A square surface `metres` on a side per repeat, tiled `repeatX` by `repeatY` times. */
function surface(key: string, paint: Paint, repeatX: number, repeatY: number, seed: number): Surface {
    let drawn = cache.get(key);
    if (!drawn) {
        const size = isSmallDevice() ? 512 : 1024;
        const canvas = document.createElement('canvas');
        const bumpCanvas = document.createElement('canvas');
        canvas.width = canvas.height = bumpCanvas.width = bumpCanvas.height = size;
        paint(canvas.getContext('2d')!, bumpCanvas.getContext('2d')!, size, seededRandom(seed));
        drawn = { canvas, bump: bumpCanvas };
        cache.set(key, drawn);
    }
    const color = new THREE.CanvasTexture(drawn.canvas);
    color.colorSpace = THREE.SRGBColorSpace;
    const bump = new THREE.CanvasTexture(drawn.bump);
    bump.colorSpace = THREE.NoColorSpace;
    for (const t of [color, bump]) {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeatX, repeatY);
        t.anisotropy = 8;
    }
    return { color, bump };
}

/** A colour a little lighter or darker: k in -1..1. */
export function shade(hex: string, k: number): string {
    const c = new THREE.Color(hex);
    const target = k >= 0 ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0);
    c.lerp(target, Math.abs(k));
    return `#${c.getHexString()}`;
}

/** Long, wavy grain lines along x, with a few knots. */
function grain(ctx: CanvasRenderingContext2D, bump: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, base: string, rand: () => number): void {
    ctx.fillStyle = base;
    ctx.fillRect(x0, y0, w, h);
    bump.fillStyle = '#808080';
    bump.fillRect(x0, y0, w, h);
    const lines = Math.max(6, Math.round(h / 3));
    for (let i = 0; i < lines; i++) {
        const y = y0 + rand() * h;
        const amp = 1 + rand() * 3;
        const freq = 0.004 + rand() * 0.01;
        const phase = rand() * 10;
        const dark = rand() < 0.5;
        ctx.strokeStyle = dark ? 'rgba(60,35,15,0.18)' : 'rgba(255,235,200,0.12)';
        bump.strokeStyle = dark ? 'rgba(90,90,90,0.5)' : 'rgba(150,150,150,0.4)';
        ctx.lineWidth = bump.lineWidth = 0.6 + rand() * 1.6;
        for (const c of [ctx, bump]) {
            c.beginPath();
            for (let x = x0; x <= x0 + w; x += 6) {
                const yy = y + Math.sin((x + phase * 100) * freq) * amp;
                if (x === x0) {
                    c.moveTo(x, yy);
                } else {
                    c.lineTo(x, yy);
                }
            }
            c.stroke();
        }
    }
    if (rand() < 0.35) {
        const kx = x0 + rand() * w;
        const ky = y0 + rand() * h;
        const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, 5 + rand() * 6);
        g.addColorStop(0, 'rgba(50,28,10,0.45)');
        g.addColorStop(1, 'rgba(50,28,10,0)');
        ctx.fillStyle = g;
        ctx.fillRect(kx - 14, ky - 14, 28, 28);
    }
}

/** Planks 15 cm wide, staggered, each its own shade, with dark seams. One repeat is 1.2 m. */
export function woodFloor(base = '#a8754a', width = 1, depth = 1): Surface {
    const paint: Paint = (ctx, bump, size, rand) => {
        const rows = 8;
        const rowH = size / rows;
        for (let r = 0; r < rows; r++) {
            let x = -rand() * size * 0.5;
            while (x < size) {
                const len = size * (0.35 + rand() * 0.4);
                grain(ctx, bump, x, r * rowH, len, rowH, shade(base, (rand() - 0.5) * 0.28), rand);
                ctx.fillStyle = 'rgba(30,18,8,0.55)';
                ctx.fillRect(x, r * rowH, 2, rowH);
                bump.fillStyle = '#303030';
                bump.fillRect(x, r * rowH, 2, rowH);
                x += len;
            }
            ctx.fillStyle = 'rgba(30,18,8,0.6)';
            ctx.fillRect(0, r * rowH, size, 2);
            bump.fillStyle = '#303030';
            bump.fillRect(0, r * rowH, size, 2);
        }
    };
    return surface(`wood-floor:${base}`, paint, width / 1.2, depth / 1.2, 3);
}

/** One board of wood grain for furniture, `metres` per repeat. */
export function woodGrain(base: string, along = 1, across = 1): Surface {
    const paint: Paint = (ctx, bump, size, rand) => grain(ctx, bump, 0, 0, size, size, base, rand);
    return surface(`wood:${base}`, paint, along, across, 5);
}

/** 30 cm ceramic tiles with grout and a soft glaze variation. One repeat is 1.2 m (4 x 4 tiles). */
export function tileFloor(base = '#d8d3ca', width = 1, depth = 1): Surface {
    const paint: Paint = (ctx, bump, size, rand) => {
        const n = 4;
        const t = size / n;
        ctx.fillStyle = '#9b958c';
        ctx.fillRect(0, 0, size, size);
        bump.fillStyle = '#404040';
        bump.fillRect(0, 0, size, size);
        const grout = Math.max(2, size / 220);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const x = i * t + grout / 2;
                const y = j * t + grout / 2;
                const g = ctx.createLinearGradient(x, y, x + t, y + t);
                g.addColorStop(0, shade(base, (rand() - 0.5) * 0.08));
                g.addColorStop(1, shade(base, (rand() - 0.5) * 0.1));
                ctx.fillStyle = g;
                ctx.fillRect(x, y, t - grout, t - grout);
                bump.fillStyle = '#a0a0a0';
                bump.fillRect(x, y, t - grout, t - grout);
                for (let k = 0; k < 40; k++) {
                    ctx.fillStyle = `rgba(0,0,0,${rand() * 0.04})`;
                    ctx.fillRect(x + rand() * t, y + rand() * t, 2 + rand() * 8, 1 + rand() * 3);
                }
            }
        }
    };
    return surface(`tile:${base}`, paint, width / 1.2, depth / 1.2, 9);
}

/** Speckled fibre noise, for carpet, concrete and fabric. */
function fibres(base: string, strength: number, dot: number): Paint {
    return (ctx, bump, size, rand) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, size, size);
        bump.fillStyle = '#808080';
        bump.fillRect(0, 0, size, size);
        const img = ctx.getImageData(0, 0, size, size);
        const b = bump.getImageData(0, 0, size, size);
        for (let i = 0; i < size * size; i++) {
            const n = (rand() * 2 - 1) * strength;
            img.data[i * 4] = Math.max(0, Math.min(255, img.data[i * 4] * (1 + n)));
            img.data[i * 4 + 1] = Math.max(0, Math.min(255, img.data[i * 4 + 1] * (1 + n)));
            img.data[i * 4 + 2] = Math.max(0, Math.min(255, img.data[i * 4 + 2] * (1 + n)));
            const v = 128 + n * 400;
            b.data[i * 4] = b.data[i * 4 + 1] = b.data[i * 4 + 2] = Math.max(0, Math.min(255, v));
        }
        ctx.putImageData(img, 0, 0);
        bump.putImageData(b, 0, 0);
        // Blotches a few centimetres across, as a real floor has.
        for (let k = 0; k < 60; k++) {
            const x = rand() * size;
            const y = rand() * size;
            const r = dot * (2 + rand() * 6);
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            const tone = rand() < 0.5 ? '0,0,0' : '255,255,255';
            g.addColorStop(0, `rgba(${tone},${0.03 + rand() * 0.04})`);
            g.addColorStop(1, `rgba(${tone},0)`);
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        }
    };
}

export function carpetFloor(base = '#6f6a66', width = 1, depth = 1): Surface {
    return surface(`carpet:${base}`, fibres(base, 0.22, 12), width / 0.6, depth / 0.6, 13);
}

export function concreteFloor(base = '#9a9a96', width = 1, depth = 1): Surface {
    return surface(`concrete:${base}`, fibres(base, 0.08, 30), width / 2, depth / 2, 17);
}

/** Woven fabric for a sofa or a chair's cushion: a fine cross weave. 10 cm per repeat. */
export function fabric(base: string, along = 1, across = 1): Surface {
    const paint: Paint = (ctx, bump, size, rand) => {
        fibres(base, 0.1, 6)(ctx, bump, size, rand);
        const step = size / 48;
        ctx.globalAlpha = 0.08;
        bump.globalAlpha = 0.35;
        for (let i = 0; i < 48; i++) {
            ctx.fillStyle = bump.fillStyle = i % 2 ? '#000000' : '#ffffff';
            ctx.fillRect(i * step, 0, step / 2, size);
            bump.fillRect(i * step, 0, step / 2, size);
            ctx.fillRect(0, i * step, size, step / 2);
            bump.fillRect(0, i * step, size, step / 2);
        }
        ctx.globalAlpha = bump.globalAlpha = 1;
    };
    return surface(`fabric:${base}`, paint, along / 0.1, across / 0.1, 19);
}

/** Matt wall paint: almost flat, with a faint roller texture. */
export function wallPaint(base: string, width = 1, height = 1): Surface {
    return surface(`wall:${base}`, fibres(base, 0.025, 40), width / 1.5, height / 1.5, 23);
}

/** Corrugated cardboard: brown with a faint flute pattern. */
export function cardboard(along = 1, across = 1): Surface {
    const paint: Paint = (ctx, bump, size, rand) => {
        fibres('#b98a58', 0.06, 10)(ctx, bump, size, rand);
        ctx.globalAlpha = 0.06;
        for (let y = 0; y < size; y += size / 64) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, y, size, size / 128);
        }
        ctx.globalAlpha = 1;
    };
    return surface('cardboard', paint, along / 0.4, across / 0.4, 29);
}
