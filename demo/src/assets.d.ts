// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/** SVG files are bundled as their markup (esbuild's text loader). */
declare module '*.svg' {
    const markup: string;
    export default markup;
}
