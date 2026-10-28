// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/** Reads a scene's folder from disk (Node): the MJCF files and the meshes and textures they name. */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { SceneFiles } from './scene.js';

const SCENE_FILE = /\.(xml|urdf|stl|obj|msh|png|skn|txt)$/i;
const MAX_BYTES = 200 * 1024 * 1024;

/** Every scene-relevant file under `dir` (skipping node_modules and dot folders), keyed by its path relative to `dir`. */
export async function readSceneDir(dir: string): Promise<SceneFiles> {
    const files: SceneFiles = new Map();
    let total = 0;
    const walk = async (at: string): Promise<void> => {
        for (const entry of await readdir(at, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                continue;
            }
            const path = join(at, entry.name);
            if (entry.isDirectory()) {
                await walk(path);
            } else if (entry.isFile() && SCENE_FILE.test(entry.name)) {
                total += (await stat(path)).size;
                if (total > MAX_BYTES) {
                    throw new Error(`the scene's files pass ${MAX_BYTES / 1024 / 1024} MB`);
                }
                files.set(relative(dir, path).split(sep).join('/'), await readFile(path));
            }
        }
    };
    await walk(dir);
    return files;
}
