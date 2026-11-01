// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Publishing robot runs (any MuJoCo robot) to the public runs gallery, the
 * same way Microduck runs are published: store the share, publish it with a
 * card summary and a thumbnail, and record it in the project.
 */

import type { ViewerModel } from 'robolance-duck-sim/viewer';
import type { GalleryActionsFor } from './DuckPanel';
import { PUBLISHED_FILE, readPublished, writePublished } from './gallery';
import type { GalleryVisibility, PreviewTabContext } from './preview-tab';
import type { SceneRunEntry } from './scene-project';
import { encodeSceneShare, sceneGallerySummary } from './scene-share';
import { meshoptShrinker } from './scene-shrink';
import { sceneThumbnail } from './scene-thumbnail';

export function sceneGalleryActions(context: PreviewTabContext, modelOf: (run: SceneRunEntry) => ViewerModel | undefined): GalleryActionsFor<SceneRunEntry> | undefined {
    const { storeShare, publishShare, unpublishShare, publishThumbnail, writeFile, files } = context;
    if (!storeShare || !publishShare || !unpublishShare || !writeFile) {
        return undefined;
    }
    return {
        published: readPublished(files),
        async publish(run, { title, show, includeCode }) {
            const model = modelOf(run);
            if (!model) {
                throw new Error('This run\'s 3D model is missing; run the scene again, then publish.');
            }
            const encoded = await encodeSceneShare(includeCode ? run : { ...run, controller: '' }, model, meshoptShrinker);
            const id = await storeShare(encoded, 'scene');
            if (!/^[0-9A-Za-z]{6,32}$/.test(id ?? '')) {
                throw new Error('The run could not be stored.');
            }
            const visibility: GalleryVisibility = show === 'private' ? 'private' : 'public';
            const done = await publishShare(id, {
                title,
                show: show === 'private' ? 'anonymous' : show,
                visibility,
                summary: { ...sceneGallerySummary(run) },
            });
            if (publishThumbnail && visibility === 'public') {
                try {
                    await publishThumbnail(id, await sceneThumbnail(model, run.run));
                } catch {
                    // No WebGL here, or the host could not store it: the card shows the robot's name instead.
                }
            }
            await writeFile(PUBLISHED_FILE, writePublished(files, run.path, { id, title: done.title, at: new Date().toISOString(), visibility }));
        },
        async unpublish(run) {
            const entry = readPublished(files)[run.path];
            if (entry) {
                try {
                    await unpublishShare(entry.id);
                } catch (err) {
                    if (!/no shared run/i.test(err instanceof Error ? err.message : String(err))) {
                        throw err;
                    }
                }
            }
            await writeFile(PUBLISHED_FILE, writePublished(files, run.path, undefined));
        },
    };
}
