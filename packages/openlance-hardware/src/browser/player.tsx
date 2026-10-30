// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * What every replay player shares: the play / scrub / time row, a
 * fullscreen mode whose controls fade out while the run plays and come back
 * on a move or a tap, and keyboard shortcuts that work with or without the
 * controls showing (Space or K play/pause, ← → seek, Home restart, C camera,
 * F fullscreen).
 */

import * as React from 'react';

/** How far ← and → move the replay. */
export const SEEK_STEP_MS = 2000;
/** How long fullscreen controls stay after the last move or tap. */
export const CONTROLS_HIDE_MS = 2500;

export interface TransportProps {
    playing: boolean;
    timeMs: number;
    durationMs: number;
    onToggle(): void;
    onSeek(ms: number): void;
    /** e.g. "run #3", at the end of the row. */
    label?: string;
}

/** Play/pause, the scrubber and the time. */
export function Transport({ playing, timeMs, durationMs, onToggle, onSeek, label }: TransportProps): React.ReactElement {
    const t = Math.min(timeMs, durationMs);
    return (
        <>
            <button type="button" className="robolance-play-btn" onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
                {playing ? '❚❚' : '▶'}
            </button>
            <input
                className="robolance-scrubber"
                type="range"
                min={0}
                max={durationMs}
                step={20}
                value={t}
                onChange={e => onSeek(Number(e.target.value))}
                aria-label="Time in the recorded run"
            />
            <span className="robolance-time">{(t / 1000).toFixed(2)} / {(durationMs / 1000).toFixed(1)} s</span>
            {label && <span className="robolance-run-name">{label}</span>}
        </>
    );
}

export type PlayerAction =
    | { kind: 'toggle' }
    | { kind: 'seek'; deltaMs: number }
    | { kind: 'restart' }
    | { kind: 'camera' }
    | { kind: 'fullscreen' }
    | { kind: 'exit' };

/**
 * The player action a key press means, or undefined to let the page have it.
 * Keys typed into a field are never taken, and a focused button keeps its
 * own Space and Enter (so a press is never doubled).
 */
export function playerKey(key: string, target: { tagName?: string; type?: string; isContentEditable?: boolean } | null, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}): PlayerAction | undefined {
    if (mods.ctrl || mods.meta || mods.alt) {
        return undefined;
    }
    const tag = target?.tagName?.toUpperCase();
    if (target?.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && target?.type !== 'range')) {
        return undefined;
    }
    const onButton = tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A';
    const onRange = tag === 'INPUT';
    switch (key) {
        case ' ':
        case 'Spacebar':
            return onButton ? undefined : { kind: 'toggle' };
        case 'k':
        case 'K':
            return { kind: 'toggle' };
        case 'ArrowLeft':
            return onRange ? undefined : { kind: 'seek', deltaMs: -SEEK_STEP_MS };
        case 'ArrowRight':
            return onRange ? undefined : { kind: 'seek', deltaMs: SEEK_STEP_MS };
        case 'Home':
        case '0':
            return { kind: 'restart' };
        case 'c':
        case 'C':
            return { kind: 'camera' };
        case 'f':
        case 'F':
            return { kind: 'fullscreen' };
        case 'Escape':
            return { kind: 'exit' };
        default:
            return undefined;
    }
}

interface FullscreenDoc {
    fullscreenElement?: Element | null;
    webkitFullscreenElement?: Element | null;
    exitFullscreen?: () => Promise<void>;
    webkitExitFullscreen?: () => void;
}
interface FullscreenEl {
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => void;
}

/**
 * Fullscreen for one element. Uses the browser's fullscreen where it has one
 * for elements; elsewhere (an iPhone) the player covers the window instead.
 */
export function useFullscreen(ref: React.RefObject<HTMLElement>): { full: boolean; toggle(): void; exit(): void } {
    const [native, setNative] = React.useState(false);
    const [covering, setCovering] = React.useState(false);

    React.useEffect(() => {
        const doc = document as Document & FullscreenDoc;
        const sync = () => setNative(Boolean(ref.current) && (doc.fullscreenElement ?? doc.webkitFullscreenElement) === ref.current);
        document.addEventListener('fullscreenchange', sync);
        document.addEventListener('webkitfullscreenchange', sync);
        return () => {
            document.removeEventListener('fullscreenchange', sync);
            document.removeEventListener('webkitfullscreenchange', sync);
        };
    }, [ref]);

    const exit = React.useCallback(() => {
        const doc = document as Document & FullscreenDoc;
        if ((doc.fullscreenElement ?? doc.webkitFullscreenElement) === ref.current) {
            if (doc.exitFullscreen) {
                void doc.exitFullscreen().catch(() => undefined);
            } else {
                doc.webkitExitFullscreen?.();
            }
        }
        setCovering(false);
    }, [ref]);

    const toggle = React.useCallback(() => {
        const el = ref.current as (HTMLElement & FullscreenEl) | null;
        if (!el) {
            return;
        }
        if (native || covering) {
            exit();
            return;
        }
        if (el.requestFullscreen) {
            el.requestFullscreen().catch(() => setCovering(true));
        } else if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
        } else {
            setCovering(true);
        }
    }, [ref, native, covering, exit]);

    return { full: native || covering, toggle, exit };
}

/**
 * Whether fullscreen controls show: always outside fullscreen and while
 * paused; while playing, for a moment after each poke (a move, a tap, a key).
 */
export function useAutoHide(full: boolean, playing: boolean, delayMs = CONTROLS_HIDE_MS): { shown: boolean; poke(): void; hide(): void } {
    const [awake, setAwake] = React.useState(true);
    const timer = React.useRef<ReturnType<typeof setTimeout>>();
    const poke = React.useCallback(() => {
        setAwake(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setAwake(false), delayMs);
    }, [delayMs]);
    const hide = React.useCallback(() => {
        clearTimeout(timer.current);
        setAwake(false);
    }, []);
    React.useEffect(() => {
        if (full) {
            poke();
        }
        return () => clearTimeout(timer.current);
    }, [full, poke]);
    return { shown: !full || !playing || awake, poke, hide };
}

export interface PlayerShellProps {
    playing: boolean;
    timeMs: number;
    durationMs: number;
    onToggle(): void;
    onSeek(ms: number): void;
    onCamera?(): void;
    /** The camera button and the like, shown over the picture in fullscreen. */
    fullscreenTools?: React.ReactNode;
    label?: string;
    viewport?: string;
    className?: string;
    children: React.ReactNode;
}

/**
 * The player: the picture with a fullscreen button on it. In fullscreen the
 * whole screen is the picture, with the tools on top and the transport at
 * the bottom, both fading away while the run plays.
 */
export function PlayerShell({ playing, timeMs, durationMs, onToggle, onSeek, onCamera, fullscreenTools, label, viewport, className = '', children }: PlayerShellProps): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    const { full, toggle: toggleFull, exit } = useFullscreen(ref);
    const { shown, poke, hide } = useAutoHide(full, playing);

    const act = React.useCallback((action: PlayerAction) => {
        switch (action.kind) {
            case 'toggle': onToggle(); break;
            case 'seek': onSeek(Math.max(0, Math.min(durationMs, timeMs + action.deltaMs))); break;
            case 'restart': onSeek(0); break;
            case 'camera': onCamera?.(); break;
            case 'fullscreen': toggleFull(); break;
            case 'exit': exit(); break;
        }
    }, [onToggle, onSeek, onCamera, toggleFull, exit, durationMs, timeMs]);

    const onKey = React.useCallback((e: KeyboardEvent | React.KeyboardEvent) => {
        const action = playerKey(e.key, e.target as HTMLElement | null, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
        if (!action || (action.kind === 'exit' && !full) || (action.kind === 'camera' && !onCamera)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        poke();
        act(action);
    }, [act, full, onCamera, poke]);

    // In fullscreen the keys work wherever focus is, controls shown or not.
    React.useEffect(() => {
        if (!full) {
            return;
        }
        const listener = (e: KeyboardEvent) => onKey(e);
        document.addEventListener('keydown', listener, true);
        return () => document.removeEventListener('keydown', listener, true);
    }, [full, onKey]);

    // A tap on the picture shows the controls, or hides them while playing.
    const down = React.useRef<{ x: number; y: number }>();
    const onPointerDown = (e: React.PointerEvent) => { down.current = { x: e.clientX, y: e.clientY }; };
    const onPointerUp = (e: React.PointerEvent) => {
        const d = down.current;
        down.current = undefined;
        if (!full || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || (e.target as HTMLElement).closest('.robolance-fs-bar')) {
            return;
        }
        if (e.pointerType !== 'mouse' && shown && playing) {
            hide();
        } else {
            poke();
        }
    };

    return (
        <div
            ref={ref}
            className={`${className} robolance-player${full ? ' is-fullscreen' : ''}${shown ? '' : ' controls-hidden'}`}
            data-viewport={full ? undefined : viewport ?? 'desktop'}
            tabIndex={0}
            onKeyDown={full ? undefined : onKey}
            onPointerMove={full ? e => { if (e.pointerType === 'mouse') { poke(); } } : undefined}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
        >
            {children}
            {!full && (
                <button type="button" className="robolance-fs-btn" onClick={toggleFull} aria-label="Fullscreen" title="Fullscreen (F)">
                    <FullscreenIcon />
                </button>
            )}
            {full && (
                <>
                    <div className="robolance-fs-bar robolance-fs-top">
                        {fullscreenTools}
                        <button type="button" className="robolance-fs-btn robolance-fs-close" onClick={exit} aria-label="Exit fullscreen" title="Exit fullscreen (Esc)">
                            <CloseIcon />
                        </button>
                    </div>
                    <div className="robolance-fs-bar robolance-fs-bottom">
                        <Transport playing={playing} timeMs={timeMs} durationMs={durationMs} onToggle={onToggle} onSeek={onSeek} label={label} />
                    </div>
                </>
            )}
        </div>
    );
}

function FullscreenIcon(): React.ReactElement {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
    );
}

function CloseIcon(): React.ReactElement {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
        </svg>
    );
}
