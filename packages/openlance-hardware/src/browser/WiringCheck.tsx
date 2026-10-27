// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * "Check wiring from a photo": the user photographs the real board (a phone
 * offers its camera or library, a desktop a file) and the agent compares it
 * with the circuit in diagram.json. The answer arrives in the chat.
 */

import * as React from 'react';
import type { Diagram } from 'robolance-hardware-sim';
import type { AskAgentOptions } from './preview-tab';
import { readPhoto, WIRING_CHECK_DISPLAY_TEXT, wiringCheckPrompt } from './wiring-check';

export interface WiringCheckProps {
    diagram: Diagram;
    askAgent: (prompt: string, options?: AskAgentOptions) => void;
}

export function WiringCheck({ diagram, askAgent }: WiringCheckProps): React.ReactElement {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [status, setStatus] = React.useState<'idle' | 'reading' | 'sent' | 'failed'>('idle');
    const timer = React.useRef<ReturnType<typeof setTimeout>>();
    const mounted = React.useRef(true);
    React.useEffect(() => () => {
        mounted.current = false;
        if (timer.current) {
            clearTimeout(timer.current);
        }
    }, []);

    const onFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        setStatus('reading');
        let outcome: 'sent' | 'failed';
        try {
            const image = await readPhoto(file);
            askAgent(wiringCheckPrompt(diagram), { images: [image], displayText: WIRING_CHECK_DISPLAY_TEXT });
            outcome = 'sent';
        } catch {
            outcome = 'failed';
        }
        if (!mounted.current) {
            return;
        }
        setStatus(outcome);
        if (timer.current) {
            clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => setStatus('idle'), 4000);
    };

    return (
        <span className="robolance-wiring-check">
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                hidden
                aria-hidden="true"
                tabIndex={-1}
                onChange={e => { void onFile(e); }}
            />
            <button
                type="button"
                className="robolance-wiring-btn"
                disabled={status === 'reading'}
                title="Photograph the real board; the agent compares it with the circuit and lists what is wired wrong"
                onClick={() => inputRef.current?.click()}
            >
                {status === 'reading' ? 'Reading photo…' : 'Check wiring from a photo'}
            </button>
            {status === 'sent' && <span className="robolance-wiring-status" role="status">Sent, the answer appears in the chat.</span>}
            {status === 'failed' && <span className="robolance-wiring-status robolance-error" role="status">Could not read that photo.</span>}
        </span>
    );
}
