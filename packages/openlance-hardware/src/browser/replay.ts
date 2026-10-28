// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/** The replay position after `elapsedMs` more wall-clock time, clamped to the run. */
export function advanceReplay(currentMs: number, elapsedMs: number, durationMs: number): number {
    return Math.min(durationMs, Math.max(0, currentMs + Math.max(0, elapsedMs)));
}
