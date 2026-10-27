// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The wiring check: a photo of the real breadboard goes to the agent with
 * the wiring diagram.json implies, and a vision model answers with what is
 * connected wrong. Pure functions here (the prompt and the image sizing);
 * the button lives in WiringCheck.tsx.
 */

import type { Diagram, PartSpec } from 'robolance-hardware-sim';
import type { PreviewImage } from './preview-tab';

/** What the chat shows for the message (the prompt itself is long). */
export const WIRING_CHECK_DISPLAY_TEXT = 'Check my wiring against this photo of the board.';

/** Longest edge a photo is scaled down to before it is sent. */
export const PHOTO_MAX_EDGE = 1600;

function pin(p: string | number): string {
    return typeof p === 'number' ? `D${p}` : p;
}

/** One line per part: how it should be wired on a real Uno and breadboard. */
export function expectedWiring(part: PartSpec): string {
    switch (part.type) {
        case 'led': {
            const colour = part.color ? `${part.color} ` : '';
            return part.activeLow
                ? `${colour}LED "${part.id}": cathode (short leg) to pin ${pin(part.pin)}, anode (long leg) through a 220 Ω resistor to 5V (it lights when the pin is LOW).`
                : `${colour}LED "${part.id}": anode (long leg) through a 220 Ω resistor to pin ${pin(part.pin)}, cathode (short leg) to GND.`;
        }
        case 'button':
            return part.activeHigh
                ? `Pushbutton "${part.id}": one side to pin ${pin(part.pin)} and to a 10 kΩ pull-down resistor to GND, the other side to 5V.`
                : `Pushbutton "${part.id}": one side to pin ${pin(part.pin)}, the other side to GND; no resistor (the sketch uses INPUT_PULLUP).`;
        case 'servo':
            return `Servo "${part.id}": signal wire (orange or yellow) to pin ${pin(part.pin)}, red to 5V, brown or black to GND.`;
        case 'ultrasonic':
            return `HC-SR04 ultrasonic "${part.id}": VCC to 5V, GND to GND, TRIG to pin ${pin(part.trig)}, ECHO to pin ${pin(part.echo)}.`;
        case 'potentiometer':
            return `Potentiometer "${part.id}": the two outer legs to 5V and GND, the middle leg (wiper) to ${part.pin}.`;
        case 'motor':
            return `Motor "${part.id}" on one H-bridge channel (L298N or L293D): IN1 to pin ${pin(part.in1)}, IN2 to pin ${pin(part.in2)}, EN to pin ${pin(part.en)} (PWM); the motor on that channel's outputs; driver GND joined to the Uno's GND; motor supply to the driver, not to the Uno's 5V.`;
        case 'linesensor':
            return `Line (reflectance) sensor "${part.id}": VCC to 5V, GND to GND, OUT to pin ${pin(part.pin)}; mounted under the robot${placement(part)}.`;
        default:
            return `${(part as { type: string }).type} "${(part as { id: string }).id}".`;
    }
}

function placement(part: Extract<PartSpec, { type: 'linesensor' }>): string {
    const forward = part.forwardCm ?? 0;
    const left = part.leftCm ?? 0;
    if (!forward && !left) {
        return '';
    }
    const side = left > 0 ? `${left} cm left of centre` : left < 0 ? `${-left} cm right of centre` : 'centred';
    return `, ${forward} cm forward and ${side}`;
}

/** The prompt that goes with the photo. */
export function wiringCheckPrompt(diagram: Diagram): string {
    const lines = diagram.parts.map(part => `- ${expectedWiring(part)}`);
    const robot = diagram.arena
        ? `\nThe board drives a two-wheel robot: motors "${diagram.arena.left}" (left) and "${diagram.arena.right}" (right)${diagram.arena.sensor ? `, distance sensor "${diagram.arena.sensor}" facing forward` : ''}.`
        : '';
    return [
        'Check my wiring against the attached photo of the real Arduino Uno and breadboard.',
        '',
        'Expected circuit (from diagram.json; pin labels are the Uno\'s, D2-D13 digital, A0-A5 analog):',
        ...lines,
        robot,
        'Look closely at every wire in the photo and compare it with the list. Answer with:',
        '1. One line first: "Wiring matches" or "N things to fix".',
        '2. One bullet per problem: the part, what the photo shows, what it should be, and the fix (which wire end to move to which pin or rail). Mention a missing resistor, a swapped LED polarity, a wrong pin and a missing GND or 5V connection as problems.',
        '3. Anything the photo does not show clearly enough to judge, so I can retake it.',
        'This is a visual check of the physical board: do not edit files, compile or run the simulator for it.',
    ].join('\n');
}

/** Scales (width, height) to fit maxEdge on the longer side; never scales up. */
export function fitWithin(width: number, height: number, maxEdge: number = PHOTO_MAX_EDGE): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (!(longest > maxEdge) || longest <= 0) {
        return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
    }
    const scale = maxEdge / longest;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Splits a data: URL into the attachment the chat takes. */
export function imageFromDataUrl(name: string, dataUrl: string, fallbackType: string = 'image/jpeg'): PreviewImage {
    const comma = dataUrl.indexOf(',');
    const header = comma >= 0 ? dataUrl.slice(0, comma) : '';
    const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const mime = /^data:([^;]+);base64$/i.exec(header)?.[1];
    return { name, mimeType: mime || fallbackType, data };
}

/**
 * Reads a photo from a file input, scaled down to PHOTO_MAX_EDGE as a JPEG
 * (phone photos are many megabytes; the model needs far less). Falls back
 * to the file as it is when the browser cannot decode or draw it.
 */
export async function readPhoto(file: Blob & { name?: string }, maxEdge: number = PHOTO_MAX_EDGE): Promise<PreviewImage> {
    const name = file.name || 'board.jpg';
    try {
        const bitmap = await createImageBitmap(file);
        const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('no 2d context');
        }
        ctx.drawImage(bitmap, 0, 0, size.width, size.height);
        bitmap.close?.();
        return imageFromDataUrl(name.replace(/\.[^.]+$/, '') + '.jpg', canvas.toDataURL('image/jpeg', 0.85));
    } catch {
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(reader.error ?? new Error('could not read the photo'));
            reader.readAsDataURL(file);
        });
        return imageFromDataUrl(name, dataUrl, file.type || 'image/jpeg');
    }
}
