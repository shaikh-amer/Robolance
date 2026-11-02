// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The player's robot colour: a few presets and a random one. The viewer
 * tints the robot's light shell parts (see RobotParts.paint); dark joints,
 * motors and trim keep their colour. A choice is the viewer's, not the
 * run's: it is remembered in this browser and never written to a run.
 */

export interface ColorPreset {
    id: 'original' | 'white' | 'black' | 'grey' | 'random';
    label: string;
    /** "#rrggbb", or undefined for the model's own colours. */
    hex?: string;
}

export const COLOR_PRESETS: readonly ColorPreset[] = [
    { id: 'original', label: 'Original colours' },
    { id: 'white', label: 'White', hex: '#f4f4f1' },
    { id: 'black', label: 'Black', hex: '#1e2024' },
    { id: 'grey', label: 'Grey', hex: '#8d9096' },
    { id: 'random', label: 'Random colour' },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A random, clearly coloured shell: any hue, saturated, mid-light. */
export function randomColor(rand: () => number = Math.random): string {
    const h = rand() * 360;
    const s = 0.65 + rand() * 0.25;
    const l = 0.45 + rand() * 0.15;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export const COLOR_STORAGE_KEY = 'robolance.robotColor';

/** The colour chosen last time in this browser, if any and still valid. */
export function loadColor(): string | undefined {
    try {
        const v = localStorage.getItem(COLOR_STORAGE_KEY);
        return v && HEX.test(v) ? v : undefined;
    } catch {
        return undefined;
    }
}

export function saveColor(hex: string | undefined): void {
    try {
        if (hex) {
            localStorage.setItem(COLOR_STORAGE_KEY, hex);
        } else {
            localStorage.removeItem(COLOR_STORAGE_KEY);
        }
    } catch {
        // Private windows and blocked storage: the choice just lasts the session.
    }
}
