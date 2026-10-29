// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * What a viewer needs to draw a recorded Microduck run without MuJoCo.
 * The model types and kinematics are robolance-mujoco's, shared by every
 * robot; this adds the duck's run record and pitch. Browser-safe: no Node
 * or MuJoCo imports.
 */

export * from 'robolance-mujoco/viewer';
// What a recorded run holds, for viewers (type-only, so nothing Node-side is loaded).
export type { MissionOutcome, MissionReplay, MissionResult } from './mission.js';
export type { DuckEvent, KickRecord, Pose } from './world.js';
export { BALL_RADIUS, GOAL_HEIGHT, LAPTOP, NET_DEPTH, POST_RADIUS, type FieldSpec, type LaptopSpec, type Obstacle } from './field.js';
