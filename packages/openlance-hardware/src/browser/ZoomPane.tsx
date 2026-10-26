// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * A pane whose content zooms and pans inside it, never the page: pinch and
 * drag on touch, Ctrl/⌘ + wheel to zoom and plain wheel to pan with a mouse,
 * plus + / − / fit buttons. The pane owns its touches (touch-action: none),
 * so a pinch over the circuit does not zoom the browser.
 */

import * as React from 'react';
import { fitView, pan, pinch, wheelFactor, zoomAt, type FitOptions, type Point, type ZoomView } from './zoom-pane';

export interface ZoomPaneProps extends FitOptions {
    contentWidth: number;
    contentHeight: number;
    className?: string;
    /** Accessible name of the pane. */
    label?: string;
    children: React.ReactNode;
}

const DRAG_THRESHOLD = 4;
const IGNORE = 'input, button, select, textarea, a, [data-zoom-ignore]';

function ignores(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(IGNORE);
}

export function ZoomPane({ contentWidth, contentHeight, className, label, children, mode = 'contain', maxScale, padding = 8 }: ZoomPaneProps): React.ReactElement {
    const paneRef = React.useRef<HTMLDivElement>(null);
    const [view, setView] = React.useState<ZoomView>({ scale: 1, x: padding, y: padding });
    /** Set once the user moved or zoomed; a resize then keeps their view instead of refitting. */
    const touched = React.useRef(false);
    const pointers = React.useRef(new Map<number, Point>());
    const drag = React.useRef<{ id: number; moved: boolean } | undefined>(undefined);

    const limits = React.useMemo(() => ({ max: Math.max(maxScale ?? 0, 4) }), [maxScale]);

    const refit = React.useCallback(() => {
        const pane = paneRef.current;
        if (!pane) {
            return;
        }
        touched.current = false;
        setView(fitView(
            { width: contentWidth, height: contentHeight },
            { width: pane.clientWidth, height: pane.clientHeight },
            { mode, maxScale, padding },
        ));
    }, [contentWidth, contentHeight, mode, maxScale, padding]);

    // Fit on mount and whenever the content changes size, unless the user has taken over.
    React.useLayoutEffect(() => {
        if (!touched.current) {
            refit();
        }
    }, [refit]);

    React.useEffect(() => {
        const pane = paneRef.current;
        if (!pane || typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(() => {
            if (!touched.current) {
                refit();
            }
        });
        observer.observe(pane);
        return () => observer.disconnect();
    }, [refit]);

    // React's onWheel is passive; the page must not scroll or zoom under the pane.
    React.useEffect(() => {
        const pane = paneRef.current;
        if (!pane) {
            return;
        }
        const onWheel = (event: WheelEvent): void => {
            event.preventDefault();
            touched.current = true;
            const rect = pane.getBoundingClientRect();
            if (event.ctrlKey || event.metaKey) {
                const factor = wheelFactor(event.deltaY, event.deltaMode);
                setView(v => zoomAt(v, factor, event.clientX - rect.left, event.clientY - rect.top, limits));
            } else {
                const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 160 : 1;
                setView(v => pan(v, -event.deltaX * unit, -event.deltaY * unit));
            }
        };
        pane.addEventListener('wheel', onWheel, { passive: false });
        return () => pane.removeEventListener('wheel', onWheel);
    }, [limits]);

    const local = (event: React.PointerEvent): Point => {
        const rect = paneRef.current?.getBoundingClientRect();
        return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    };

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
        if (ignores(event.target) || (event.pointerType === 'mouse' && event.button !== 0)) {
            return;
        }
        pointers.current.set(event.pointerId, local(event));
        if (pointers.current.size === 1) {
            drag.current = { id: event.pointerId, moved: false };
        } else {
            drag.current = undefined;
        }
    };

    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
        const previous = pointers.current.get(event.pointerId);
        if (!previous) {
            return;
        }
        const current = local(event);
        if (pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.entries()].slice(0, 2);
            const before: [Point, Point] = [a[1], b[1]];
            pointers.current.set(event.pointerId, current);
            const after: [Point, Point] = [
                a[0] === event.pointerId ? current : a[1],
                b[0] === event.pointerId ? current : b[1],
            ];
            touched.current = true;
            setView(v => pinch(v, before, after, limits));
            return;
        }
        pointers.current.set(event.pointerId, current);
        const dx = current.x - previous.x;
        const dy = current.y - previous.y;
        const d = drag.current;
        if (!d || d.id !== event.pointerId) {
            return;
        }
        if (!d.moved) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) {
                return;
            }
            d.moved = true;
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
                // Capture is a nicety: dragging still works while the pointer stays over the pane.
            }
        }
        touched.current = true;
        setView(v => pan(v, dx, dy));
    };

    const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
        pointers.current.delete(event.pointerId);
        if (drag.current?.id === event.pointerId) {
            drag.current = undefined;
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        }
        if (pointers.current.size === 1) {
            // One finger left of a pinch: it continues as a drag.
            const [id] = pointers.current.keys();
            drag.current = { id, moved: true };
        }
    };

    const zoomCentre = (factor: number): void => {
        const pane = paneRef.current;
        if (!pane) {
            return;
        }
        touched.current = true;
        setView(v => zoomAt(v, factor, pane.clientWidth / 2, pane.clientHeight / 2, limits));
    };

    return (
        <div
            ref={paneRef}
            className={`robolance-zoom-pane${className ? ` ${className}` : ''}`}
            role="group"
            aria-label={label}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onDoubleClick={event => { if (!ignores(event.target)) { refit(); } }}
        >
            <div
                className="robolance-zoom-content"
                style={{ width: contentWidth, height: contentHeight, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            >
                {children}
            </div>
            <div className="robolance-zoom-controls" data-zoom-ignore>
                <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomCentre(1 / 1.25)}>−</button>
                <button type="button" className="robolance-zoom-level" aria-label="Fit to the panel" title="Fit to the panel" onClick={refit}>
                    {Math.round(view.scale * 100)}%
                </button>
                <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomCentre(1.25)}>+</button>
            </div>
        </div>
    );
}
