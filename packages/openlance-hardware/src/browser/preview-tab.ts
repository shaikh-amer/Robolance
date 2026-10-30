// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The contract between OpenLance's preview panel and an extension that adds
 * a tab to it. OpenLance resolves every binding of `OpenLancePreviewTab`
 * (a shared symbol, so no package import is needed on either side) and
 * shows the tabs whose `applies` says yes for the open project.
 */

import type * as React from 'react';

export const OpenLancePreviewTab = Symbol.for('openlance.previewTab');

/** An image attached to a chat message: base64 data without the data: header. */
export interface PreviewImage {
    name: string;
    mimeType: string;
    data: string;
}

export interface AskAgentOptions {
    images?: PreviewImage[];
    displayText?: string;
}

export interface PreviewTabContext {
    /** Every project file by path (relative, no leading slash) and its text. */
    files: ReadonlyMap<string, string>;
    theme: 'light' | 'dark';
    /** Opens a project file in the editor. */
    openFile?: (path: string) => void;
    /**
     * Sends a message to the agent chat. Images ride along as attachments
     * (the wiring check sends a photo of the real board); `displayText` is
     * what the chat shows in place of the full prompt.
     */
    askAgent?: (prompt: string, options?: AskAgentOptions) => void;
    /** Writes a project file (the arena editor saves diagram.json). */
    writeFile?: (path: string, content: string) => Promise<void> | void;
    /**
     * Stores a run as a share link encodes it and returns its id, for a short
     * link (`<replay page>?s=<id>`). Without it, or when it fails, "Share this
     * run" copies the long link that carries the run itself.
     */
    storeShare?: StoreShare;
    /**
     * The screen size picked in the preview's Desktop / Tablet / Phone
     * switch. The player (the 3D or arena replay) takes that width; the
     * rest of the tab keeps the panel's.
     */
    viewport?: PreviewViewport;
}

export type PreviewViewport = 'desktop' | 'tablet' | 'mobile';

/** Stores an encoded run (`kind`: duck, arduino) and returns its id. */
export type StoreShare = (encoded: string, kind: string) => Promise<string>;

export interface PreviewTab {
    id: string;
    label: string;
    /** Whether the tab is offered for a project with these files. */
    applies(files: ReadonlyMap<string, string>): boolean;
    render(context: PreviewTabContext): React.ReactNode;
}
