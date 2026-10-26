// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * An Arduino Uno (ATmega328p at 16 MHz) running real firmware on avr8js,
 * with the pins exposed by their Arduino numbers (D0–D13, A0–A5). Time is
 * simulated: `step()` runs the CPU for a span of simulated microseconds, so
 * the same board runs headless in Node for the agent and in the browser for
 * the display, with identical results for identical inputs.
 */

import {
    AVRADC,
    AVRIOPort,
    AVRTimer,
    AVRUSART,
    CPU,
    PinState,
    adcConfig,
    avrInstruction,
    portBConfig,
    portCConfig,
    portDConfig,
    timer0Config,
    timer1Config,
    timer2Config,
    usart0Config,
} from 'avr8js';
import { loadHex } from './intelhex.js';

export const CLOCK_HZ = 16_000_000;
const FLASH_BYTES = 0x8000;

/** Arduino pin names: 0–13 for the digital header, 'A0'–'A5' for the analog header. */
export type PinName = number | `A${0 | 1 | 2 | 3 | 4 | 5}`;

interface PinRef {
    port: 'B' | 'C' | 'D';
    bit: number;
    adcChannel?: number;
}

/** A change of a pin's output level, in simulated microseconds. */
export interface PinEdge {
    pin: PinName;
    high: boolean;
    atUs: number;
}

export type PinEdgeListener = (edge: PinEdge) => void;

/** Resolves an Arduino pin name to its port and bit on the ATmega328p. */
export function resolvePin(pin: PinName): PinRef {
    if (typeof pin === 'string') {
        const channel = Number(pin.slice(1));
        if (!/^A[0-5]$/.test(pin)) {
            throw new Error(`no such pin ${pin}`);
        }
        return { port: 'C', bit: channel, adcChannel: channel };
    }
    if (pin >= 0 && pin <= 7) {
        return { port: 'D', bit: pin };
    }
    if (pin >= 8 && pin <= 13) {
        return { port: 'B', bit: pin - 8 };
    }
    throw new Error(`no such pin ${pin}`);
}

export class Board {
    readonly cpu: CPU;
    readonly timer0: AVRTimer;
    readonly timer1: AVRTimer;
    readonly timer2: AVRTimer;
    readonly portB: AVRIOPort;
    readonly portC: AVRIOPort;
    readonly portD: AVRIOPort;
    readonly usart: AVRUSART;
    readonly adc: AVRADC;

    /** Everything the firmware printed on Serial, as text. */
    serialOut = '';
    /** Serial output split into lines; the last entry may be a partial line. */
    readonly serialLines: string[] = [''];
    private readonly edgeListeners: PinEdgeListener[] = [];
    private readonly lastPortValue = { B: 0, C: 0, D: 0 };
    private readonly program = new Uint16Array(FLASH_BYTES / 2);

    constructor(hex: string) {
        const bytes = new Uint8Array(this.program.buffer);
        if (loadHex(hex, bytes) === 0) {
            throw new Error('the hex image is empty');
        }
        this.cpu = new CPU(this.program);
        this.timer0 = new AVRTimer(this.cpu, timer0Config);
        this.timer1 = new AVRTimer(this.cpu, timer1Config);
        this.timer2 = new AVRTimer(this.cpu, timer2Config);
        this.portB = new AVRIOPort(this.cpu, portBConfig);
        this.portC = new AVRIOPort(this.cpu, portCConfig);
        this.portD = new AVRIOPort(this.cpu, portDConfig);
        this.usart = new AVRUSART(this.cpu, usart0Config, CLOCK_HZ);
        this.adc = new AVRADC(this.cpu, adcConfig);

        this.usart.onByteTransmit = value => {
            const ch = String.fromCharCode(value);
            this.serialOut += ch;
            if (ch === '\n') {
                this.serialLines.push('');
            } else if (ch !== '\r') {
                this.serialLines[this.serialLines.length - 1] += ch;
            }
        };
        for (const [name, port] of [['B', this.portB], ['C', this.portC], ['D', this.portD]] as const) {
            port.addListener(() => this.onPortChange(name, port));
        }
    }

    /** Simulated time since reset, in microseconds. */
    get nowUs(): number {
        return (this.cpu.cycles / CLOCK_HZ) * 1e6;
    }

    /** Runs the firmware for `us` simulated microseconds. */
    step(us: number): void {
        const target = this.cpu.cycles + Math.round((us * CLOCK_HZ) / 1e6);
        while (this.cpu.cycles < target) {
            avrInstruction(this.cpu);
            this.cpu.tick();
        }
    }

    /** The level the firmware drives on an output pin (PWM and timer outputs included). */
    pinHigh(pin: PinName): boolean {
        const ref = resolvePin(pin);
        return this.port(ref.port).pinState(ref.bit) === PinState.High;
    }

    /** Whether the firmware configured the pin as an output. */
    pinIsOutput(pin: PinName): boolean {
        const ref = resolvePin(pin);
        const state = this.port(ref.port).pinState(ref.bit);
        return state === PinState.High || state === PinState.Low;
    }

    /** Drives an input pin from the outside world (a button, a sensor's echo). */
    setInput(pin: PinName, high: boolean): void {
        const ref = resolvePin(pin);
        this.port(ref.port).setPin(ref.bit, high);
    }

    /** Sets the voltage an analog pin reads, 0–5 V. */
    setAnalog(pin: `A${0 | 1 | 2 | 3 | 4 | 5}`, volts: number): void {
        const ref = resolvePin(pin);
        this.adc.channelValues[ref.adcChannel!] = Math.max(0, Math.min(5, volts));
    }

    /** Feeds bytes to the firmware's Serial input. */
    serialIn(text: string): void {
        for (const ch of text) {
            this.usart.writeByte(ch.charCodeAt(0));
        }
    }

    /** Calls `fn` at `atUs` simulated microseconds from now. */
    after(atUs: number, fn: () => void): void {
        this.cpu.addClockEvent(fn, Math.max(1, Math.round((atUs * CLOCK_HZ) / 1e6)));
    }

    /** Hears every change of an output pin's level, with its time. */
    onPinEdge(listener: PinEdgeListener): () => void {
        this.edgeListeners.push(listener);
        return () => {
            const i = this.edgeListeners.indexOf(listener);
            if (i >= 0) {
                this.edgeListeners.splice(i, 1);
            }
        };
    }

    private port(name: 'B' | 'C' | 'D'): AVRIOPort {
        return name === 'B' ? this.portB : name === 'C' ? this.portC : this.portD;
    }

    private onPortChange(name: 'B' | 'C' | 'D', port: AVRIOPort): void {
        let value = 0;
        for (let bit = 0; bit < 8; bit++) {
            if (port.pinState(bit) === PinState.High) {
                value |= 1 << bit;
            }
        }
        const before = this.lastPortValue[name];
        if (value === before) {
            return;
        }
        this.lastPortValue[name] = value;
        if (this.edgeListeners.length === 0) {
            return;
        }
        const atUs = this.nowUs;
        for (let bit = 0; bit < 8; bit++) {
            const mask = 1 << bit;
            if ((value & mask) !== (before & mask)) {
                const pin = pinNameOf(name, bit);
                if (pin === undefined) {
                    continue;
                }
                for (const listener of this.edgeListeners) {
                    listener({ pin, high: (value & mask) !== 0, atUs });
                }
            }
        }
    }
}

function pinNameOf(port: 'B' | 'C' | 'D', bit: number): PinName | undefined {
    if (port === 'D') {
        return bit;
    }
    if (port === 'B') {
        return bit <= 5 ? bit + 8 : undefined;
    }
    return bit <= 5 ? (`A${bit}` as PinName) : undefined;
}
