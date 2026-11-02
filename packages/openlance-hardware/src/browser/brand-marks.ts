// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The Meta and OpenLance marks drawn on canvases, for the room's posters,
 * a laptop's lid and screen and the robot's sticker. Nothing here loads an
 * image: the OpenLance mark is its SVG outline, the Meta mark a drawn loop
 * with the word under it, so the viewers work offline and in tests (where
 * there is no document, callers get plain materials).
 */

import * as THREE from 'three';

/** The OpenLance mark's outline (viewBox 380 500 1420 1040): the plate, then the two cut-outs. */
const OL_PLATE = 'M 806.357 533.414 C 816.529 532.001 849.134 532.798 860.767 532.85 L 975.765 533.747 L 1141.05 534.92 C 1171.64 535.032 1211.37 534.065 1241.25 535.904 C 1259.69 536.864 1277.99 539.732 1295.84 544.46 C 1334.79 555.055 1371.18 573.472 1402.78 598.589 C 1427.83 618.097 1459.46 652.823 1482.84 676.749 L 1609.71 806.813 L 1688.73 887.667 C 1707.72 906.972 1740.99 937.854 1753.52 959.76 C 1769.77 987.666 1774.17 1020.92 1765.73 1052.09 C 1753.88 1094.54 1724.64 1117.65 1695.04 1147.37 L 1542.48 1301.25 L 1468.1 1376.68 C 1447.45 1397.54 1424.93 1422.46 1401.51 1440.41 C 1381.78 1455.55 1360.43 1468.68 1337.84 1479.53 C 1300.29 1497.56 1259.26 1507.5 1217.65 1508.89 C 1191.92 1509.84 1161.3 1508.66 1135.35 1508.68 L 998.206 1508.47 L 866.004 1508.19 C 843.934 1508.12 821.871 1506.37 800.09 1502.87 C 714.2 1489.47 636.102 1446.36 579.569 1381.57 C 515.207 1308.01 482.236 1212.72 487.432 1115.29 C 492.729 1016.09 536.94 924.062 609.908 857.173 C 663.86 807.721 731.847 775.17 804.013 763.855 C 809.3 762.994 812.056 762.4 812.357 761.971 C 814.31 758.966 814.303 753.58 813.5 749.5 L 811.5 739.5 C 806.357 533.414 Z';
const OL_CUTS = [
    'M 846.027 709.439 C 988.778 702.187 1105.58 828.601 1108.28 967.177 C 1110.3 1071.21 1051.43 1167.33 958.571 1211.5 C 864.14 1256.41 752.07 1239.56 673.897 1169.24 C 598.206 1101.13 568.606 996.148 597.771 897.726 C 630.145 788.5 731.94 715.229 846.027 709.439 Z',
    'M 1082.02 704.358 C 1112.42 703.769 1142.98 704.521 1173.37 704.155 C 1204.52 703.776 1236.19 704.063 1267.31 705.224 C 1285.68 705.908 1305.66 709.747 1323.19 715.238 C 1344.66 721.966 1364.82 732.322 1382.83 745.849 C 1398.39 757.534 1413.34 772.86 1426.59 786.942 L 1544.62 912.339 L 1604.08 975.615 C 1611.17 983.161 1616.25 989.229 1616.37 999.867 C 1616.49 1010.77 1611.33 1017.07 1604.03 1024.46 L 1545.12 1084.05 L 1433.8 1196.57 C 1415.2 1215.37 1393.58 1235.3 1371.08 1249.7 C 1335.24 1272.63 1293.59 1284.99 1251.05 1285.24 C 1221.14 1285.42 1190.92 1284.27 1160.98 1284.5 C 1134.51 1284.7 1107.76 1284.76 1081.31 1284.52 C 1150.32 1247.78 1200.92 1181.6 1219.41 1104.17 C 1241.48 1011.77 1209.74 915.263 1137.5 854.5 C 1121.39 840.95 1103.19 828.896 1084.01 820.24 C 1148.38 793.83 1189.82 733.667 1187.75 663.25 C 1187.6 658.212 1187.07 653.189 1186.17 648.233 L 1082.02 704.358 Z',
];

export type BrandName = 'meta' | 'openlance';

/** Draws one mark inside the box (x, y, w, h), centred, in `color`. */
export function drawBrandMark(ctx: CanvasRenderingContext2D, brand: BrandName, x: number, y: number, w: number, h: number, color: string): void {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (brand === 'openlance') {
        // The mark is 1420 x 1040 in its own units: fit it, keep its shape.
        const k = Math.min(w / 1420, h / 1040);
        ctx.translate(x + (w - 1420 * k) / 2, y + (h - 1040 * k) / 2);
        ctx.scale(k, k);
        ctx.translate(-380, -500);
        const outline = new Path2D(OL_PLATE);
        for (const cut of OL_CUTS) {
            outline.addPath(new Path2D(cut));
        }
        ctx.fill(outline, 'evenodd');
    } else {
        // A loop: two round lobes joined in the middle, drawn as one thick stroke.
        const r = Math.min(w / 4.4, h / 2.2);
        const cx = x + w / 2;
        const cy = y + h / 2;
        ctx.lineWidth = r * 0.46;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.ellipse(cx - r * 1.05, cy, r, r * 0.78, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + r * 1.05, cy, r, r * 0.78, 0, Math.PI, Math.PI * 3);
        ctx.stroke();
    }
    ctx.restore();
}

/** The word under a mark, in a plain bold face. */
export function drawBrandWord(ctx: CanvasRenderingContext2D, brand: BrandName, x: number, y: number, size: number, color: string): void {
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `bold ${size}px "Inter", "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(brand === 'meta' ? 'Meta' : 'OpenLance', x, y);
    ctx.restore();
}

/** A canvas, or undefined where there is no document (tests, workers). */
function canvasOf(width: number, height: number): HTMLCanvasElement | undefined {
    if (typeof document === 'undefined') {
        return undefined;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function textureOf(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
}

/**
 * A framed poster: a white mat with the mark and the word, in the brand's
 * colour. Portrait, 3:4.
 */
export function posterMaterial(brand: BrandName): THREE.Material {
    const canvas = canvasOf(600, 800);
    if (!canvas) {
        return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    }
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0, 0, 600, 800);
    const color = brand === 'meta' ? '#0866ff' : '#0a0a0a';
    drawBrandMark(ctx, brand, 100, 160, 400, 320, color);
    drawBrandWord(ctx, brand, 300, 620, 84, color);
    return new THREE.MeshStandardMaterial({ map: textureOf(canvas), roughness: 0.55 });
}

/**
 * Both marks side by side on a dark ground, for a laptop lid: the laptop's
 * back when it is open on a desk, and its top when the duck has shut it.
 */
export function lidMaterial(): THREE.Material {
    const canvas = canvasOf(640, 420);
    if (!canvas) {
        return new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.5, roughness: 0.4 });
    }
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#23262b';
    ctx.fillRect(0, 0, 640, 420);
    drawBrandMark(ctx, 'openlance', 70, 110, 200, 150, '#f5f5f4');
    drawBrandWord(ctx, 'openlance', 170, 320, 40, '#f5f5f4');
    drawBrandMark(ctx, 'meta', 370, 110, 200, 150, '#0866ff');
    drawBrandWord(ctx, 'meta', 470, 320, 40, '#f5f5f4');
    return new THREE.MeshStandardMaterial({ map: textureOf(canvas), metalness: 0.35, roughness: 0.45 });
}

/** Adds both marks to a drawn screen, as a chat header badge and a footer line. */
export function drawScreenBrands(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    drawBrandMark(ctx, 'openlance', width - 160, 4, 24, 18, '#e6edf3');
    drawBrandMark(ctx, 'meta', width - 60, 3, 30, 20, '#0866ff');
    ctx.fillStyle = '#8b949e';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Muse Spark · OpenLance', 136, height - 10);
}

/**
 * A round sticker: a white disc with the OpenLance mark above the Meta loop,
 * for the robot's side.
 */
export function stickerMaterial(): THREE.Material {
    const canvas = canvasOf(256, 256);
    if (!canvas) {
        return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, transparent: true });
    }
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = '#fbfbf9';
    ctx.beginPath();
    ctx.arc(128, 128, 122, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d9d9d4';
    ctx.lineWidth = 4;
    ctx.stroke();
    drawBrandMark(ctx, 'openlance', 58, 36, 140, 92, '#0a0a0a');
    drawBrandMark(ctx, 'meta', 58, 136, 140, 80, '#0866ff');
    const texture = textureOf(canvas);
    return new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
}
