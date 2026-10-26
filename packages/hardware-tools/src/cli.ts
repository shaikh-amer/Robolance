#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * `robolance-tools` starts the hardware MCP server on stdio.
 *
 * Environment: ROBOLANCE_ARDUINO_CORE (an ArduinoCore-avr checkout, for the
 * avr-gcc backend) and ROBOLANCE_ARDUINO_LIBS (colon-separated library
 * folders), or an installed arduino-cli.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHardwareServer } from './mcp.js';

const server = createHardwareServer();
const transport = new StdioServerTransport();
await server.connect(transport);
