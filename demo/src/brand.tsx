// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The site header every page shares: the OpenLance mark, ROBOLANCE, and
 * where it comes from. index.html carries the same markup (build.mjs puts
 * the mark in).
 */

import * as React from 'react';
import mark from './openlance-mark.svg';

export const OPENLANCE_URL = 'https://openlance.ai';
export const REPO_URL = 'https://github.com/shaikh-amer/robolance';

export interface SiteHeaderProps {
    /** The site's home page, relative to this page. */
    home: string;
    current?: 'runs' | 'replay';
}

export function SiteHeader({ home, current }: SiteHeaderProps): React.ReactElement {
    return (
        <header className="ol-site-header">
            <div className="ol-brand">
                <a className="ol-brand-home" href={home} aria-label="robolance home">
                    {/* The mark is a file in this repo, not user content. */}
                    <span dangerouslySetInnerHTML={{ __html: mark }} style={{ display: 'contents' }} />
                    ROBOLANCE
                </a>
                <span className="ol-brand-from">a new feature in <a href={OPENLANCE_URL}>OpenLance.ai</a></span>
            </div>
            <nav className="ol-site-nav" aria-label="Site">
                <a href={`${home}runs/`} aria-current={current === 'runs' ? 'page' : undefined}>Runs</a>
                <a href={`${home}replay/`} aria-current={current === 'replay' ? 'page' : undefined}>Replay</a>
                <a href={REPO_URL}>GitHub</a>
            </nav>
        </header>
    );
}
