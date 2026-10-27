# Submission kit: Meta Global AI Developer Hackathon

Deadline: November 4, 2026, 9:00 PM ET. Track: Startup. Judged on Impact (30), Meta tooling (25), Technical depth (20), Demo (25).

## One-liner

Tell your robot what to do in plain words; a Meta-powered agent codes, flashes, watches and fixes it until it works.

## Two sentences

robolance gives a coding agent a real feedback loop for embedded code: it compiles an Arduino sketch, runs it on a simulated board wired to real parts and a robot arena, reads back exactly what the firmware did, and fixes it until the behaviour matches. It runs inside OpenLance, an open-source web IDE, on Meta's Muse Spark and Muse Spark Open, so anyone can program a robot from a browser with no hardware on the desk.

## What is pre-existing and what is new (say this first in the video)

Pre-existing: OpenLance, the open-source web IDE and agent harness this plugs into, and the open-source libraries avr8js (ATmega328p emulation), Wokwi elements (part graphics), avr-gcc, ArduinoCore-avr and the MCP SDK.

New, built during the event, in https://github.com/shaikh-amer/robolance: the circuit and robot-arena simulation (wall avoidance and line following), the compile and run tools served over MCP, the Hardware tab extension (circuit, arena with a drawable editor, runs, live mode), the wiring check from a photo of the real board, shareable run links and the replay page.

New, built during the event, in OpenLance (https://github.com/shaikh-amer/openlance, a separate repository): the agent prompting and the closed compile-run-fix loop around the tools, the Meta model provider, and the glue that hosts the extension (preview tabs, photo attachments from a tab, robot template, built-in hardware tools, sandbox toolchain).

## Demo video script (3 minutes)

0:00 Title card. Say the pre-existing vs new line above, verbatim.

0:15 The problem. "Programming a robot means write, flash, watch, guess, repeat. Beginners stop at the first error, and an AI assistant cannot see the robot. We gave the agent eyes and hands in a simulator."

0:35 OpenLance Home. Click "New robot project". Show the three files: sketch.ino, diagram.json, README. Show the Hardware tab opening with the Uno, the LED and the button wired.

0:55 First ask, typed in chat: "Add a servo on pin 9 that sweeps 0 to 180 while the button is held, and print the angle." Show the agent calling hardware_parts, editing the files, hardware_compile, hardware_run, and the harness nudging it to run again after an edit. Point at the trace: serial output, part states, the notes line.

1:20 Hardware tab: scrub the recorded run; press "Go live", hold the button yourself, watch the servo move and the serial lines. "Everything you see is the real firmware, running in your browser."

1:35 The robot. Ask: "Build a wall-avoiding robot for the corner arena. Keep running and fixing until it reaches the goal with zero collisions." Show the first run: path, collision marks, score. Show it reading the notes ("got within 60 cm, 2 collisions"), changing the turn logic, running again without being asked. Runs view: the score curve going up over three or four runs, then "goal reached". Five seconds on "Edit arena": drag a wall, "Save and ask the agent to run it".

2:10 The real board (Meta tooling). Hold a phone over the breadboard. Hardware tab, Circuit, "Check wiring from a photo", take the photo. The chat shows the photo and Muse Spark's answer: "2 things to fix: ECHO is on D10, move it to D11; the LED has no resistor." "Muse Spark checks the wiring you did with your hands against the circuit the agent designed."

2:30 Share. Runs view, "Share this run", paste the link in a message, open it on the phone: the arena replays on a page with no account. "The link carries the run; nothing is uploaded."

2:40 Meta. Open the model picker: Muse Spark 1.3 on the Meta Model API, Muse Spark Open on Baseten and Fireworks. "The agent you just watched ran on Muse Spark Open; the photo went to Muse Spark." One sentence on why open weights matter for a classroom or a factory that cannot send code out.

2:50 Close. "Same sketch, same diagram, flashes to a real Uno when you have one. robolance is open source, built on OpenLance. Link in the description."

Recording notes: 1080p, browser at 125 percent zoom, dark theme, chat on the left and the Hardware tab on the right. Pre-run every prompt once before recording so the toolchain is warm; keep the agent's model on Muse Spark Open for the agent turns and Muse Spark for the photo turn. Wire the breadboard with one deliberate mistake (ECHO on the wrong pin) before the take so the wiring check has something to find. Have the replay link ready on the phone in case the clipboard step stumbles.

## X post (Most Viral prize, by November 8)

Draft 1:
> I told an AI "make the robot reach the goal without touching the walls" and watched it code, run, crash, read the crash, fix it, and get there in 4 tries. No robot on my desk. The whole loop runs in the browser on Meta's Muse Spark Open. [video] Built on OpenLance for the Meta hackathon: github.com/shaikh-amer/robolance

Draft 2 (shorter):
> Robots you program by talking. The agent compiles, runs the firmware on a simulated Arduino, watches the robot drive, and fixes its own code until it works. Open source, runs on Muse Spark and Muse Spark Open. [video] github.com/shaikh-amer/robolance

Attach the 30-second cut of the arena sequence (first run colliding, last run reaching the goal) rather than the full video.

## Form answers

Project name: robolance

Category / track: Startup

Meta products used: Meta Model API (Muse Spark 1.3 as the coding agent's model, and its vision for the wiring check: a photo of the real breadboard compared with the circuit the agent designed), Muse Spark Open via Baseten and Fireworks AI (open-weight option for the same agent). Planned: a Muse Glimmer 30B fine-tune on the agent's run logs (the compile-run-fix traces are a natural supervised dataset).

How it works: the agent gets four MCP tools (hardware_parts, hardware_compile, hardware_run, hardware_arena). hardware_run executes the sketch on an avr8js Uno wired to the parts in diagram.json, with scripted inputs, and returns serial output, part states over time, the robot's path, collisions and a 0-100 score, plus notes that say what went wrong. The agent iterates on that the way it iterates on a failing test, and the harness keeps it in the loop: an edit after a run means run again, a failed run comes back with its error, a run short of the goal comes back with the numbers. Each run is recorded into the project; the IDE's Hardware tab replays it or runs the firmware live, lets the user draw the arena, checks a photo of the real wiring against the circuit, and shares any run as a link that replays on a public page.

Why it matters: embedded and robotics are where "vibe coding" stops today because the model cannot see the result. A deterministic simulator in the loop makes the agent's iteration visible, checkable and cheap, and takes the hardware off the desk for learners and teams.

What is next: more boards (ESP32, RP2040), more parts, real-board flashing from the browser over WebSerial, arenas as shareable challenges with a leaderboard of shared runs, and the fine-tuned Glimmer model trained on the run traces.

Repository: https://github.com/shaikh-amer/robolance (hackathon work only). OpenLance: https://github.com/shaikh-amer/openlance.

## Checklist before submitting

- [ ] Packages published to npm: robolance-hardware-sim 0.2.1, robolance-hardware-tools 0.2.2, robolance-openlance-hardware 0.5.0
- [ ] OpenLance go-backend and frontend deployed from main; sandbox template rebuilt from robolance main (`scripts/build-e2b-template.sh`)
- [ ] GitHub Pages enabled for the repository (Settings → Pages → Source: GitHub Actions); https://shaikh-amer.github.io/Robolance/replay/ opens a shared link
- [ ] A Meta Model API key and a Baseten or Fireworks key saved in OpenLance Settings
- [ ] Both demo prompts (wall avoider, line follower) run end to end on the deployed IDE; a wiring-check photo gets a verdict; a share link opens on a phone
- [ ] Video recorded, under 3 minutes, opens with the pre-existing vs new line
- [ ] README on main matches what the video shows
- [ ] Submission form filled on cerebralvalley.ai; X post scheduled
