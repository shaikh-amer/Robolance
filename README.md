# robolance

**Tell your robot what to do in plain words; a Meta-powered agent codes, flashes, watches and fixes it until it works.**

robolance is an [OpenLance](https://openlance.ai) feature built in the open for the Meta Global AI Developer Hackathon (October 26 – November 4, 2026). It gives a coding agent a real feedback loop for embedded code: compile an Arduino sketch, run it on a simulated board wired to real parts (LEDs, buttons, servos, motors, an ultrasonic sensor), drive a two-wheel robot through an arena, and read back exactly what the firmware did. The agent iterates on that trace the way it iterates on a failing test, and the user watches the circuit, the robot and the run history in the browser. No hardware is needed; when a board is plugged in, the same sketch flashes to it.

## What is pre-existing and what is new

- **Pre-existing**: OpenLance, the web IDE and agent harness this plugs into (separate repository, not part of the hackathon submission). Open-source libraries: [avr8js](https://github.com/wokwi/avr8js) (ATmega328p emulation, MIT), [@wokwi/elements](https://github.com/wokwi/wokwi-elements) (part graphics, MIT), avr-gcc and [ArduinoCore-avr](https://github.com/arduino/ArduinoCore-avr), the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk).
- **New, written during the event, all in this repository**: everything under `packages/` and `demo/`: the circuit and robot-arena simulation, the compile and run tools served over MCP, the agent prompting around them, the IDE extension that shows the circuit, arena and runs, and the demo.

## Packages

| Package | What it is |
|---|---|
| `packages/hardware-sim` | `robolance-hardware-sim`: an Arduino Uno (avr8js) with functional part models, a `diagram.json` circuit format, a deterministic robot arena, and `runScenario()` which runs firmware with scripted inputs and returns a trace. Runs in Node and the browser. |
| `packages/hardware-tools` | `robolance-hardware-tools`: the agent's tools. `buildSketch()` compiles a sketch with arduino-cli or plain avr-gcc + ArduinoCore-avr. `createHardwareServer()` serves `hardware_parts`, `hardware_compile`, `hardware_run` and `hardware_arena` over MCP; `robolance-tools` is the stdio entry point. |
| `packages/openlance-hardware` | `robolance-openlance-hardware`: the OpenLance (Theia) extension. It adds a Hardware tab to the preview with a Circuit view (Wokwi part graphics wired to the Uno), an Arena view (walls, path, robot, sensor ray) and a Runs view (score curve across runs, serial output, notes). A scrubber replays the agent's last recorded run; "Go live" runs the built firmware in the browser so you can press the buttons and turn the knobs yourself. |
| `demo/` | The replay page. "Share this run" in the Runs view makes a link that carries the run (deflated into the fragment, nothing uploaded); the page replays it with the same views, for anyone, without an account. Published to GitHub Pages from `main`. |

## The loop

1. The user says what the robot should do.
2. The agent writes `sketch.ino` and `diagram.json` (parts and pins; optionally an arena binding).
3. `hardware_compile` returns the compiler's errors or the flash size.
4. `hardware_run` runs the sketch for a few simulated seconds with scripted button presses, sensor values or serial input, and returns serial output, part states over time, the robot's path, collisions and a score 0–100, plus notes such as "led1 never turned on" or "the robot never moved: check the motor pins".
5. The agent reads the trace, fixes the sketch, and runs again until the behaviour matches.

A 20 s arena run takes about 6 s of wall-clock time; a 3 s bench run about 1.4 s.

## Run it

```sh
npm install
npm run build
npm test
```

The MCP tests use a prebuilt fixture and need no compiler. To compile sketches you need either `arduino-cli` on the PATH (with `arduino:avr` installed) or the Debian packages `gcc-avr binutils-avr avr-libc` plus a checkout of ArduinoCore-avr:

```sh
git clone --depth 1 https://github.com/arduino/ArduinoCore-avr /opt/arduino/core
git clone --depth 1 https://github.com/arduino-libraries/Servo /opt/arduino/libs/Servo
export ROBOLANCE_ARDUINO_CORE=/opt/arduino/core
export ROBOLANCE_ARDUINO_LIBS=/opt/arduino/libs
npm test                      # now also runs the compiler tests
node scripts/bench-smoke.mjs  # compile + run the bench circuit
node scripts/arena-smoke.mjs  # compile + drive the robot
```

Every successful compile writes `.robolance/firmware.hex` and `.robolance/build.json` into the working directory, and every run writes `.robolance/runs/<timestamp>.json` (the last 30 are kept). The IDE's Hardware tab reads those files. Set `ROBOLANCE_RECORD_DIR` to write elsewhere, or to an empty string to record nothing.

To use the tools from any MCP client, point it at:

```json
{ "command": "node", "args": ["packages/hardware-tools/lib/cli.js"] }
```

## How the IDE tab plugs in

The extension binds `Symbol.for('openlance.previewTab')` in its inversify module with an object `{ id, label, applies(files), render(context) }`; OpenLance's preview panel resolves every such binding and shows the tabs that apply to the open project. `context.files` is the project's files by path, so the tab needs nothing but the files the tools write.

## Diagram format

```json
{
  "board": "uno",
  "parts": [
    { "type": "led", "id": "led1", "pin": 13, "color": "green" },
    { "type": "button", "id": "btn", "pin": 2 },
    { "type": "servo", "id": "arm", "pin": 9 },
    { "type": "potentiometer", "id": "pot", "pin": "A0" },
    { "type": "ultrasonic", "id": "eyes", "trig": 12, "echo": 11 },
    { "type": "motor", "id": "left", "in1": 4, "in2": 5, "en": 6 },
    { "type": "motor", "id": "right", "in1": 7, "in2": 8, "en": 10 }
  ],
  "arena": { "preset": "corner", "left": "left", "right": "right", "sensor": "eyes" }
}
```

Buttons are wired to ground (use `INPUT_PULLUP`, pressed reads LOW). Servos take the Arduino `Servo` library's pulses. The HC-SR04 answers a 10 µs trigger pulse with an echo of 58 µs per centimetre. Motors are one H-bridge channel each: two direction pins and a PWM enable. The corner arena is a 200 × 120 cm room with two inner walls; the robot starts bottom-left facing east and the goal is top-right.

## License

Apache-2.0. See `LICENSE`.
