// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

import * as React from 'react';
import { HardwarePanel, hardwareTabApplies } from './HardwarePanel';
import type { PreviewTab, PreviewTabContext } from './preview-tab';

export const hardwarePreviewTab: PreviewTab = {
    id: 'hardware',
    label: 'Hardware',
    applies: hardwareTabApplies,
    render: (context: PreviewTabContext) => <HardwarePanel {...context} />,
};
