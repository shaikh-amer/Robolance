// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/** Loads an Intel HEX image (what avr-objcopy / arduino-cli emit) into flash. */
export function loadHex(source: string, target: Uint8Array): number {
    let loaded = 0;
    let upper = 0;
    for (const raw of source.split(/\r?\n/)) {
        const line = raw.trim();
        if (line[0] !== ':') {
            continue;
        }
        const bytes = parseInt(line.slice(1, 3), 16);
        const addr = parseInt(line.slice(3, 7), 16);
        const type = line.slice(7, 9);
        if (type === '04') {
            upper = parseInt(line.slice(9, 13), 16) << 16;
            continue;
        }
        if (type !== '00') {
            continue;
        }
        for (let i = 0; i < bytes; i++) {
            const at = upper + addr + i;
            if (at < target.length) {
                target[at] = parseInt(line.slice(9 + i * 2, 11 + i * 2), 16);
                loaded += 1;
            }
        }
    }
    return loaded;
}
