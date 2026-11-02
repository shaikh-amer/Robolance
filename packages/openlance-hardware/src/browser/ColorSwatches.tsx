// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import * as React from 'react';
import { COLOR_PRESETS, randomColor } from './robot-color';

export interface ColorSwatchesProps {
    /** The current shell colour, or undefined for the model's own colours. */
    value?: string;
    onChange: (hex: string | undefined) => void;
}

/** A row of small round swatches: the model's colours, white, black, grey, and a random colour on each click. */
export function ColorSwatches({ value, onChange }: ColorSwatchesProps): React.ReactElement {
    const presetHexes = COLOR_PRESETS.map(p => p.hex).filter((h): h is string => Boolean(h));
    const randomActive = value !== undefined && !presetHexes.includes(value);
    return (
        <div className="robolance-swatches" role="group" aria-label="Robot colour">
            {COLOR_PRESETS.map(p => {
                const active = p.id === 'random' ? randomActive : p.hex === value;
                return (
                    <button
                        key={p.id}
                        type="button"
                        className={`robolance-swatch robolance-swatch-${p.id}${active ? ' active' : ''}`}
                        style={p.hex ? { background: p.hex } : p.id === 'random' && randomActive ? { background: value } : undefined}
                        title={p.id === 'random' ? 'A random colour (click again for another)' : p.label}
                        aria-label={p.label}
                        aria-pressed={active}
                        onClick={() => onChange(p.id === 'random' ? randomColor() : p.hex)}
                    />
                );
            })}
        </div>
    );
}
