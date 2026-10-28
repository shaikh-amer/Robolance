// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/** Reads the packaged model and skills from disk (Node). */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { DuckAssets } from './world.js';

/** The package's assets: next to lib/ when installed, two levels up in the test build. */
export const ASSETS_DIR = ['../assets/', '../../assets/']
    .map(rel => fileURLToPath(new URL(rel, import.meta.url)))
    .find(dir => existsSync(join(dir, 'model'))) ?? fileURLToPath(new URL('../assets/', import.meta.url));

let cached: Promise<DuckAssets> | undefined;

export function loadAssets(dir = ASSETS_DIR): Promise<DuckAssets> {
    if (dir === ASSETS_DIR && cached) {
        return cached;
    }
    const load = (async () => {
        const model = new Map<string, Uint8Array>();
        const modelDir = join(dir, 'model');
        model.set('robot_groundcontact.xml', await readFile(join(modelDir, 'robot_groundcontact.xml')));
        for (const f of await readdir(join(modelDir, 'assets'))) {
            model.set(`assets/${f}`, await readFile(join(modelDir, 'assets', f)));
        }
        const policies = new Map<string, Uint8Array>();
        for (const f of await readdir(join(dir, 'policies'))) {
            if (f.endsWith('.onnx')) {
                policies.set(f.slice(0, -5), await readFile(join(dir, 'policies', f)));
            }
        }
        return { model, policies };
    })();
    if (dir === ASSETS_DIR) {
        cached = load;
    }
    return load;
}
