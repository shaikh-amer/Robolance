// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/** Registers the Hardware preview tab with OpenLance. */

import '../../src/browser/style/hardware.css';
import { ContainerModule } from 'inversify';
import { hardwarePreviewTab } from './hardware-preview-tab';
import { OpenLancePreviewTab } from './preview-tab';

export default new ContainerModule(bind => {
    bind(OpenLancePreviewTab).toConstantValue(hardwarePreviewTab);
});
