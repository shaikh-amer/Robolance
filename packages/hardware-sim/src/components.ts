// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Functional models of the parts a sketch talks to. Each one is wired to
 * board pins and keeps the state the display shows and the agent inspects.
 * They are deliberately simple: what the firmware can observe is exact,
 * what it cannot (an LED's brightness curve) is not modelled.
 */

import type { Board, PinName } from './board.js';

export interface Component {
    readonly id: string;
    readonly kind: string;
    /** Attaches to the board: subscribes to pin edges, schedules sensor behaviour. */
    attach(board: Board): void;
    /** What the display and the agent see. */
    state(): Record<string, unknown>;
}

/** An LED on a digital pin: on when the pin is high (or low, for `activeLow`). */
export class Led implements Component {
    readonly kind = 'led';
    on = false;
    /** Fraction of the last `pwmWindowUs` the LED was on: brightness under analogWrite. */
    duty = 0;
    private board?: Board;
    private highSinceUs?: number;
    private windowStartUs = 0;
    private onUsInWindow = 0;
    private readonly pwmWindowUs = 20_000;

    constructor(readonly id: string, readonly pin: PinName, readonly color = 'red', readonly activeLow = false) {}

    attach(board: Board): void {
        this.board = board;
        board.onPinEdge(edge => {
            if (edge.pin !== this.pin) {
                return;
            }
            const lit = edge.high !== this.activeLow;
            this.account(edge.atUs);
            this.on = lit;
            this.highSinceUs = lit ? edge.atUs : undefined;
        });
    }

    /** Brings the duty estimate up to the current time. */
    private account(nowUs: number): void {
        if (this.highSinceUs !== undefined) {
            this.onUsInWindow += nowUs - this.highSinceUs;
            this.highSinceUs = nowUs;
        }
        const elapsed = nowUs - this.windowStartUs;
        if (elapsed >= this.pwmWindowUs) {
            this.duty = Math.min(1, this.onUsInWindow / elapsed);
            this.windowStartUs = nowUs;
            this.onUsInWindow = 0;
        }
    }

    state(): Record<string, unknown> {
        if (this.board) {
            this.account(this.board.nowUs);
        }
        return { pin: this.pin, color: this.color, on: this.on, brightness: this.on ? Math.max(this.duty, this.duty === 0 ? 1 : this.duty) : this.duty };
    }
}

/** A push button to ground on an INPUT_PULLUP pin (pressed reads LOW), or to 5 V (`activeHigh`). */
export class Button implements Component {
    readonly kind = 'button';
    pressed = false;
    private board?: Board;

    constructor(readonly id: string, readonly pin: PinName, readonly activeHigh = false) {}

    attach(board: Board): void {
        this.board = board;
        this.apply();
    }

    press(): void {
        this.pressed = true;
        this.apply();
    }

    release(): void {
        this.pressed = false;
        this.apply();
    }

    private apply(): void {
        this.board?.setInput(this.pin, this.activeHigh ? this.pressed : !this.pressed);
    }

    state(): Record<string, unknown> {
        return { pin: this.pin, pressed: this.pressed };
    }
}

/** A hobby servo: reads the pulse width on its signal pin (Arduino's default 544–2400 µs → 0–180°). */
export class Servo implements Component {
    readonly kind = 'servo';
    /** Last commanded angle in degrees, or undefined before the first pulse. */
    angle?: number;
    pulseUs?: number;
    private riseUs?: number;

    constructor(readonly id: string, readonly pin: PinName) {}

    attach(board: Board): void {
        board.onPinEdge(edge => {
            if (edge.pin !== this.pin) {
                return;
            }
            if (edge.high) {
                this.riseUs = edge.atUs;
            } else if (this.riseUs !== undefined) {
                const width = edge.atUs - this.riseUs;
                this.riseUs = undefined;
                if (width >= 400 && width <= 2800) {
                    this.pulseUs = width;
                    this.angle = Math.max(0, Math.min(180, ((width - 544) / (2400 - 544)) * 180));
                }
            }
        });
    }

    state(): Record<string, unknown> {
        return { pin: this.pin, angle: this.angle === undefined ? null : Math.round(this.angle), pulseUs: this.pulseUs ?? null };
    }
}

/**
 * An HC-SR04 distance sensor: a ≥10 µs pulse on `trig` makes `echo` go high
 * after a short delay for 58 µs per centimetre of `distanceCm`. The world
 * (the arena, or a slider in the circuit view) sets the distance.
 */
export class Ultrasonic implements Component {
    readonly kind = 'ultrasonic';
    distanceCm = 100;
    /** How many measurements the firmware triggered. */
    pings = 0;
    private board?: Board;
    private trigRiseUs?: number;

    constructor(readonly id: string, readonly trig: PinName, readonly echo: PinName, readonly maxCm = 400) {}

    attach(board: Board): void {
        this.board = board;
        board.setInput(this.echo, false);
        board.onPinEdge(edge => {
            if (edge.pin !== this.trig) {
                return;
            }
            if (edge.high) {
                this.trigRiseUs = edge.atUs;
                return;
            }
            if (this.trigRiseUs === undefined || edge.atUs - this.trigRiseUs < 10) {
                this.trigRiseUs = undefined;
                return;
            }
            this.trigRiseUs = undefined;
            this.pings += 1;
            const cm = Math.min(this.maxCm, Math.max(2, this.distanceCm));
            const echoUs = Math.round(cm * 58);
            board.after(450, () => {
                board.setInput(this.echo, true);
                board.after(echoUs, () => board.setInput(this.echo, false));
            });
        });
    }

    state(): Record<string, unknown> {
        return { trig: this.trig, echo: this.echo, distanceCm: Math.round(this.distanceCm * 10) / 10, pings: this.pings };
    }
}

/**
 * A reflectance (IR line) sensor looking at the floor under the robot. Over
 * a dark line a digital module's output reads HIGH (LOW on the floor;
 * `activeHigh: false` for the opposite kind), and an analog pin reads low
 * (about 0.6 V on the line, 4.4 V on the floor). The arena sets `onLine`
 * from where the sensor is mounted on the robot.
 */
export class LineSensor implements Component {
    readonly kind = 'linesensor';
    onLine = false;
    private board?: Board;

    constructor(readonly id: string, readonly pin: PinName, readonly activeHigh = true) {}

    attach(board: Board): void {
        this.board = board;
        this.apply();
    }

    set(onLine: boolean): void {
        this.onLine = onLine;
        this.apply();
    }

    private apply(): void {
        if (!this.board) {
            return;
        }
        if (typeof this.pin === 'string') {
            this.board.setAnalog(this.pin, this.onLine ? 0.6 : 4.4);
        } else {
            this.board.setInput(this.pin, this.onLine === this.activeHigh);
        }
    }

    state(): Record<string, unknown> {
        const out: Record<string, unknown> = { pin: this.pin, onLine: this.onLine };
        if (typeof this.pin === 'string') {
            out.volts = this.onLine ? 0.6 : 4.4;
        }
        return out;
    }
}

/** A potentiometer on an analog pin: `position` 0–1 maps to 0–5 V. */
export class Potentiometer implements Component {
    readonly kind = 'potentiometer';
    position = 0.5;
    private board?: Board;

    constructor(readonly id: string, readonly pin: `A${0 | 1 | 2 | 3 | 4 | 5}`) {}

    attach(board: Board): void {
        this.board = board;
        this.set(this.position);
    }

    set(position: number): void {
        this.position = Math.max(0, Math.min(1, position));
        this.board?.setAnalog(this.pin, this.position * 5);
    }

    state(): Record<string, unknown> {
        return { pin: this.pin, position: this.position, volts: Math.round(this.position * 500) / 100 };
    }
}

/**
 * A DC motor behind an H-bridge channel (L298N-style): two direction pins
 * and one PWM enable pin. `speed` is -1…1 from the enable duty and direction.
 */
export class Motor implements Component {
    readonly kind = 'motor';
    speed = 0;
    private board?: Board;
    private enHighSinceUs?: number;
    private windowStartUs = 0;
    private onUsInWindow = 0;
    private duty = 0;
    private readonly windowUs = 10_000;

    constructor(readonly id: string, readonly in1: PinName, readonly in2: PinName, readonly en: PinName) {}

    attach(board: Board): void {
        this.board = board;
        board.onPinEdge(edge => {
            if (edge.pin === this.en) {
                this.account(edge.atUs);
                this.enHighSinceUs = edge.high ? edge.atUs : undefined;
            }
        });
    }

    private account(nowUs: number): void {
        if (this.enHighSinceUs !== undefined) {
            this.onUsInWindow += nowUs - this.enHighSinceUs;
            this.enHighSinceUs = nowUs;
        }
        const elapsed = nowUs - this.windowStartUs;
        if (elapsed >= this.windowUs) {
            this.duty = Math.min(1, this.onUsInWindow / elapsed);
            this.windowStartUs = nowUs;
            this.onUsInWindow = 0;
        }
    }

    /** Current signed speed from the pins; call once per physics tick. */
    sample(): number {
        const board = this.board;
        if (!board) {
            return 0;
        }
        this.account(board.nowUs);
        const forward = board.pinHigh(this.in1) && !board.pinHigh(this.in2);
        const backward = board.pinHigh(this.in2) && !board.pinHigh(this.in1);
        const magnitude = this.enHighSinceUs !== undefined && this.duty === 0 ? 1 : this.duty;
        this.speed = forward ? magnitude : backward ? -magnitude : 0;
        return this.speed;
    }

    state(): Record<string, unknown> {
        return { in1: this.in1, in2: this.in2, en: this.en, speed: Math.round(this.speed * 100) / 100 };
    }
}
