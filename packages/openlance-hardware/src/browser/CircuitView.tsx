// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * The circuit as a breadboard-free 2D view: the Uno on the left, the parts
 * in a column on the right, wires drawn between the pins the diagram names.
 * Part graphics are Wokwi's web components (registered by the frontend
 * module); motors are drawn here because Wokwi has no DC motor element.
 */

import * as React from 'react';
import type { Diagram, PartSpec } from 'robolance-hardware-sim';

export type PartStates = Record<string, Record<string, unknown>>;

export interface CircuitInputs {
    press(id: string): void;
    release(id: string): void;
    set(id: string, value: number): void;
}

export interface CircuitViewProps {
    diagram: Diagram;
    states: PartStates;
    /** When given, buttons, knobs and sensors can be operated by hand. */
    inputs?: CircuitInputs;
}

interface ElementPin {
    name: string;
    x: number;
    y: number;
}

interface Wire {
    from: { x: number; y: number };
    to: { x: number; y: number };
    color: string;
}

const BOARD_LEFT = 16;
const BOARD_TOP = 24;
const BOARD_WIDTH = 274;
const BOARD_HEIGHT = 202;
const PARTS_LEFT = BOARD_LEFT + BOARD_WIDTH + 90;
const PART_GAP = 18;

const WIRE_COLORS: Record<string, string> = {
    GND: '#222',
    VCC: '#d33',
};
const SIGNAL_COLORS = ['#2a9d8f', '#e9c46a', '#8e5fd8', '#f4a261', '#3a86ff', '#ff6b6b'];

/** Which part pin connects to which board pin, per part type. */
function connections(part: PartSpec): { pin: string; board: string; role: 'GND' | 'VCC' | 'signal' }[] {
    switch (part.type) {
        case 'led':
            return [{ pin: 'A', board: String(part.pin), role: 'signal' }, { pin: 'C', board: 'GND.1', role: 'GND' }];
        case 'button':
            return [{ pin: '1.l', board: String(part.pin), role: 'signal' }, { pin: '2.l', board: part.activeHigh ? '5V' : 'GND.2', role: part.activeHigh ? 'VCC' : 'GND' }];
        case 'servo':
            return [{ pin: 'PWM', board: String(part.pin), role: 'signal' }, { pin: 'V+', board: '5V', role: 'VCC' }, { pin: 'GND', board: 'GND.2', role: 'GND' }];
        case 'ultrasonic':
            return [{ pin: 'TRIG', board: String(part.trig), role: 'signal' }, { pin: 'ECHO', board: String(part.echo), role: 'signal' }, { pin: 'VCC', board: '5V', role: 'VCC' }, { pin: 'GND', board: 'GND.2', role: 'GND' }];
        case 'potentiometer':
            return [{ pin: 'SIG', board: part.pin, role: 'signal' }, { pin: 'VCC', board: '5V', role: 'VCC' }, { pin: 'GND', board: 'GND.3', role: 'GND' }];
        case 'motor':
            return [{ pin: 'IN1', board: String(part.in1), role: 'signal' }, { pin: 'IN2', board: String(part.in2), role: 'signal' }, { pin: 'EN', board: String(part.en), role: 'signal' }];
    }
}

/** Pin anchors of the motor drawing (local px). */
const MOTOR_PINS: ElementPin[] = [
    { name: 'IN1', x: 8, y: 52 },
    { name: 'IN2', x: 20, y: 52 },
    { name: 'EN', x: 32, y: 52 },
];

export function CircuitView({ diagram, states, inputs }: CircuitViewProps): React.ReactElement {
    const stageRef = React.useRef<HTMLDivElement>(null);
    const boardRef = React.useRef<HTMLElement | null>(null);
    const partRefs = React.useRef(new Map<string, HTMLElement>());
    const [wires, setWires] = React.useState<Wire[]>([]);
    const [scale, setScale] = React.useState(1);
    const [stageHeight, setStageHeight] = React.useState(BOARD_TOP + BOARD_HEIGHT + 24);

    // Wire endpoints come from the elements' own pin tables once they are laid out.
    React.useLayoutEffect(() => {
        const board = boardRef.current;
        const stage = stageRef.current;
        if (!board || !stage) {
            return;
        }
        const compute = (): void => {
            const boardPins = pinTable(board);
            const next: Wire[] = [];
            let bottom = BOARD_TOP + BOARD_HEIGHT;
            diagram.parts.forEach((part, index) => {
                const wrapper = partRefs.current.get(part.id);
                if (!wrapper) {
                    return;
                }
                // The graphic sits inside the positioned wrapper, so its own
                // offsets are relative to the wrapper, not the stage.
                const graphic = (wrapper.querySelector('.robolance-graphic') as HTMLElement | null) ?? wrapper;
                const pins = part.type === 'motor' ? MOTOR_PINS : pinTable(graphic);
                const origin = stageOrigin(wrapper, graphic);
                bottom = Math.max(bottom, wrapper.offsetTop + wrapper.offsetHeight);
                for (const c of connections(part)) {
                    const from = pins.find(p => p.name === c.pin);
                    const to = boardPins.find(p => p.name === c.board);
                    if (!from || !to) {
                        continue;
                    }
                    next.push({
                        from: { x: origin.x + from.x, y: origin.y + from.y },
                        to: { x: BOARD_LEFT + to.x, y: BOARD_TOP + to.y },
                        color: c.role === 'signal' ? SIGNAL_COLORS[index % SIGNAL_COLORS.length] : WIRE_COLORS[c.role],
                    });
                }
            });
            setWires(next);
            setStageHeight(bottom + 24);
        };
        compute();
        // Custom elements upgrade asynchronously on first paint; look again.
        const timer = window.setTimeout(compute, 50);
        return () => window.clearTimeout(timer);
    }, [diagram]);

    // Fit the stage to the panel width.
    React.useLayoutEffect(() => {
        const stage = stageRef.current?.parentElement;
        if (!stage || typeof ResizeObserver === 'undefined') {
            return;
        }
        const fit = (): void => {
            const width = PARTS_LEFT + 220;
            setScale(Math.min(1, Math.max(0.4, (stage.clientWidth - 8) / width)));
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(stage);
        return () => observer.disconnect();
    }, []);

    const registerPart = React.useCallback((id: string, el: HTMLElement | null) => {
        if (el) {
            partRefs.current.set(id, el);
        } else {
            partRefs.current.delete(id);
        }
    }, []);

    let top = BOARD_TOP;
    const placed = diagram.parts.map(part => {
        const height = partHeight(part);
        const node = { part, top };
        top += height + PART_GAP;
        return node;
    });

    return (
        <div className="robolance-circuit">
            <div
                ref={stageRef}
                className="robolance-circuit-stage"
                style={{ transform: `scale(${scale})`, height: stageHeight, width: PARTS_LEFT + 220 }}
            >
                <svg className="robolance-circuit-wires" width={PARTS_LEFT + 220} height={stageHeight} aria-hidden="true">
                    {wires.map((w, i) => {
                        const dx = Math.abs(w.to.x - w.from.x) / 2;
                        return (
                            <path
                                key={i}
                                d={`M ${w.from.x} ${w.from.y} C ${w.from.x - dx} ${w.from.y}, ${w.to.x + dx} ${w.to.y}, ${w.to.x} ${w.to.y}`}
                                stroke={w.color}
                                strokeWidth={2.2}
                                fill="none"
                                strokeLinecap="round"
                            />
                        );
                    })}
                </svg>
                {React.createElement('wokwi-arduino-uno', {
                    ref: (el: HTMLElement | null) => { boardRef.current = el; },
                    className: 'robolance-circuit-board',
                    style: { left: BOARD_LEFT, top: BOARD_TOP },
                })}
                {placed.map(({ part, top: partTop }) => (
                    <PartNode
                        key={part.id}
                        part={part}
                        state={states[part.id] ?? {}}
                        inputs={inputs}
                        style={{ left: PARTS_LEFT, top: partTop }}
                        register={registerPart}
                    />
                ))}
            </div>
        </div>
    );
}

/** Where a part's graphic sits in stage coordinates: the wrapper's place plus the graphic's place within it. */
export function stageOrigin(wrapper: { offsetLeft: number; offsetTop: number }, graphic: { offsetLeft: number; offsetTop: number }): { x: number; y: number } {
    if (wrapper === graphic) {
        return { x: wrapper.offsetLeft, y: wrapper.offsetTop };
    }
    return { x: wrapper.offsetLeft + graphic.offsetLeft, y: wrapper.offsetTop + graphic.offsetTop };
}

function pinTable(el: HTMLElement): ElementPin[] {
    const info = (el as HTMLElement & { pinInfo?: ElementPin[] }).pinInfo;
    return Array.isArray(info) ? info : [];
}

function partHeight(part: PartSpec): number {
    switch (part.type) {
        case 'led': return 50;
        case 'button': return 46;
        case 'servo': return 120;
        case 'ultrasonic': return 95;
        case 'potentiometer': return 76;
        case 'motor': return 56;
    }
}

interface PartNodeProps {
    part: PartSpec;
    state: Record<string, unknown>;
    inputs?: CircuitInputs;
    style: React.CSSProperties;
    register: (id: string, el: HTMLElement | null) => void;
}

function PartNode({ part, state, inputs, style, register }: PartNodeProps): React.ReactElement {
    const ref = React.useRef<HTMLElement | null>(null);
    const setRef = React.useCallback((el: HTMLElement | null) => {
        ref.current = el;
    }, []);
    const setWrapper = React.useCallback((el: HTMLDivElement | null) => {
        register(part.id, el);
    }, [register, part.id]);

    // Wokwi elements take their state as properties, not attributes.
    React.useLayoutEffect(() => {
        const el = ref.current as (HTMLElement & Record<string, unknown>) | null;
        if (!el) {
            return;
        }
        switch (part.type) {
            case 'led': {
                const on = state.on === true;
                const brightness = typeof state.brightness === 'number' ? state.brightness : 1;
                el.value = on;
                el.brightness = on ? Math.max(0.15, brightness) : 0;
                el.color = part.color ?? 'red';
                el.label = part.id;
                break;
            }
            case 'button':
                el.pressed = state.pressed === true;
                el.color = 'green';
                el.label = part.id;
                break;
            case 'servo':
                el.angle = typeof state.angle === 'number' ? state.angle : 90;
                break;
            case 'potentiometer':
                el.min = 0;
                el.max = 100;
                el.value = typeof state.position === 'number' ? state.position * 100 : 50;
                break;
            default:
                break;
        }
    }, [part, state]);

    React.useEffect(() => {
        const el = ref.current;
        if (!el || !inputs) {
            return;
        }
        if (part.type === 'button') {
            const press = (): void => inputs.press(part.id);
            const release = (): void => inputs.release(part.id);
            el.addEventListener('button-press', press);
            el.addEventListener('button-release', release);
            return () => {
                el.removeEventListener('button-press', press);
                el.removeEventListener('button-release', release);
            };
        }
        if (part.type === 'potentiometer') {
            const input = (event: Event): void => {
                const value = Number((event as CustomEvent<number>).detail ?? (el as HTMLElement & { value?: number }).value ?? 0);
                inputs.set(part.id, Math.max(0, Math.min(1, value / 100)));
            };
            el.addEventListener('input', input);
            return () => el.removeEventListener('input', input);
        }
        return undefined;
    }, [part, inputs]);

    const tag = part.type === 'led' ? 'wokwi-led'
        : part.type === 'button' ? 'wokwi-pushbutton'
        : part.type === 'servo' ? 'wokwi-servo'
        : part.type === 'ultrasonic' ? 'wokwi-hc-sr04'
        : part.type === 'potentiometer' ? 'wokwi-potentiometer'
        : undefined;

    const label = describeState(part, state);

    if (!tag) {
        return (
            <div ref={setWrapper} className="robolance-part robolance-motor" style={style} title={part.id}>
                <MotorGraphic speed={typeof state.speed === 'number' ? state.speed : 0} />
                <span className="robolance-part-label">{part.id} · {label}</span>
            </div>
        );
    }
    return (
        <div ref={setWrapper} className="robolance-part" style={style}>
            {React.createElement(tag, { ref: setRef, className: 'robolance-wokwi robolance-graphic', title: part.id })}
            <span className="robolance-part-label">{part.id} · {label}</span>
            {part.type === 'ultrasonic' && inputs && (
                <input
                    className="robolance-part-slider"
                    type="range"
                    min={2}
                    max={400}
                    value={typeof state.distanceCm === 'number' ? state.distanceCm : 100}
                    onChange={e => inputs.set(part.id, Number(e.target.value))}
                    aria-label={`${part.id} distance (cm)`}
                />
            )}
        </div>
    );
}

export function describeState(part: PartSpec, state: Record<string, unknown>): string {
    switch (part.type) {
        case 'led':
            return state.on ? (typeof state.brightness === 'number' && state.brightness < 0.98 ? `on ${Math.round(state.brightness * 100)}%` : 'on') : 'off';
        case 'button':
            return state.pressed ? 'pressed' : 'released';
        case 'servo':
            return typeof state.angle === 'number' ? `${Math.round(state.angle)}°` : 'no pulse';
        case 'ultrasonic':
            return typeof state.distanceCm === 'number' ? `${state.distanceCm} cm` : '';
        case 'potentiometer':
            return typeof state.position === 'number' ? `${Math.round(state.position * 100)}%` : '';
        case 'motor': {
            const speed = typeof state.speed === 'number' ? state.speed : 0;
            return speed === 0 ? 'stopped' : `${speed > 0 ? 'forward' : 'backward'} ${Math.round(Math.abs(speed) * 100)}%`;
        }
    }
}

function MotorGraphic({ speed }: { speed: number }): React.ReactElement {
    const spinning = Math.abs(speed) > 0.02;
    const duration = spinning ? `${(1.2 / Math.abs(speed)).toFixed(2)}s` : undefined;
    return (
        <svg width={40} height={56} viewBox="0 0 40 56" aria-hidden="true">
            <rect x={4} y={8} width={32} height={30} rx={4} fill="#5a5a5a" stroke="#333" />
            <g style={{ transformOrigin: '20px 23px', animation: spinning ? `robolance-spin ${duration} linear infinite ${speed < 0 ? 'reverse' : ''}` : undefined }}>
                <circle cx={20} cy={23} r={11} fill="#222" stroke="#111" />
                <path d="M20 13 L20 33 M10 23 L30 23" stroke="#888" strokeWidth={2} />
            </g>
            {MOTOR_PINS.map(p => (
                <g key={p.name}>
                    <rect x={p.x - 2} y={40} width={4} height={12} fill="#c6c6c6" />
                </g>
            ))}
        </svg>
    );
}
