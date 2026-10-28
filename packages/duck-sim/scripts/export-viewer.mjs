// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance
//
// Writes viewer/duck.json: the bodies, joints and decimated visual meshes a
// browser needs to draw replay frames. Run after `npm run build` whenever
// the robot model changes; a test checks the file is current.

import { writeFile } from 'node:fs/promises';
import { DuckWorld } from '../lib/index.js';
import { loadAssets } from '../lib/node-assets.js';

const VIEWER_CELL_M = 0.003; // the test that checks this file uses the same cell

const world = await DuckWorld.create(await loadAssets());
const model = world.viewerModel(VIEWER_CELL_M);
world.dispose();
const out = new URL('../viewer/duck.json', import.meta.url);
await writeFile(out, JSON.stringify(model));
console.log(`viewer/duck.json: ${model.bodies.length} bodies, ${model.geoms.length} geoms, ${model.meshes.length} meshes`);
