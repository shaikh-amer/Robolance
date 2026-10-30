# Submission kit: Meta Global AI Developer Hackathon

Deadline: November 4, 2026, 9:00 PM ET. Track: Startup. Judged on Impact (30), Meta tooling (25), Technical depth (20), Demo (25).

## One-liner

Tell what your robot should do in plain words; a Meta-powered agent codes it, runs it in a simulator, watches what happened and fixes it until it works.

## Two sentences

robolance gives a coding agent a real feedback loop for robots: it writes the program, runs it in a physics simulator (a walking Microduck on MuJoCo, or an Arduino robot on a simulated board), reads back exactly what happened and why, and fixes it until the behaviour matches. It runs inside OpenLance, an open-source web IDE, on Meta's Muse Spark and Muse Spark Open, with SAM 3.1 turning a photo of a room into obstacles and Muse Image generating scenes, so anyone can program a robot from a browser with no hardware on the desk.

## What is pre-existing and what is new (say this first in the video)

Pre-existing: OpenLance, the open-source web IDE and agent harness this plugs into. Open-source libraries and models: MuJoCo (physics), ONNX Runtime, Pollen Robotics' Microduck robot model and its trained skills (walk, stand, kicks), avr8js (ATmega328p emulation), Wokwi elements (part graphics), avr-gcc, ArduinoCore-avr and the MCP SDK.

New, built during the event, in https://github.com/shaikh-amer/robolance:
- the Microduck simulator and mission API: a football pitch, obstacles, the laptop mission, scoring, and notes that explain a miss;
- photo-to-obstacles from SAM 3.1;
- running policies a project trained;
- a generic MuJoCo runner for any robot;
- the 3D replay views;
- the circuit and robot-arena simulation;
- all the agent's tools over MCP (`duck_*`, `scene_*`, `hardware_*`);
- the Hardware tab extension;
- the wiring check from a photo;
- shareable run links and the replay page.

New, built during the event, in OpenLance (https://github.com/shaikh-amer/openlance, a separate repository):
- the agent prompting and the closed run-and-fix loop around the tools;
- the Meta model provider (Muse Spark, Muse Spark Open);
- image generation with Muse Image: ask for a picture in plain words and it appears in the chat in a card that animates while it is made, saved in the project;
- SAM 3.1 segmentation, and photo-to-obstacles from plain words ("here's my room, walk around the chair") with no tool names;
- GPU training jobs on the user's own compute provider (Modal);
- the glue that hosts the extension: preview tabs, photo attachments, robot and Microduck templates, built-in tools, the sandbox toolchain.

## Demo video script (3 minutes)

0:00 Title card. Say the pre-existing vs new line above, verbatim.

0:12 The problem. "Programming a robot means write, flash, watch, guess, repeat. An AI assistant can write the code, but it cannot see the robot. We gave the agent eyes in a simulator."

0:25 OpenLance Home → "New Microduck project". Type: "Make the duck score a goal."
- Show the chat rows: "Ran the Microduck mission: no goal · score 30 · 1 kick".
- Show the note it reads: "right kick missed - the ball was 10 cm ahead…".
- Show it editing `mission.js` and running again: "goal in 10.9 s · score 94".
- Hardware tab: the 3D replay of the duck walking up and kicking. Then Runs: the score going up across runs.

1:00 Photo to obstacles (SAM 3.1).
- Type: "Here's my floor, walk to the ball without hitting anything." Attach a top-down photo of a few cardboard boxes.
- With no photo to hand: "Make a picture of cardboard boxes on a wooden floor, seen from above" first. The picture appears in the chat card while Muse Image makes it.
- Chat rows: "Found 'cardboard box' in floor.jpg: 3 found" (SAM 3.1), then the obstacles on the pitch.
- The replay shows the duck walking around the boxes. "Meta's SAM 3.1 turned a photo into the robot's world."

1:30 The laptop (the funny one). Type: "I've been coding all day. Close my laptop so I come and play."
- The pitch now has an open laptop with an editor on screen.
- The duck walks round behind it, lines up and headbutts the lid shut.
- The readout flashes "LAPTOP CLOSED!", score 95.
- "The duck telling the developer to stop and play."

1:55 Training (Modal). Show Settings → Compute providers with Modal connected, one time.
- Ask: "Train a better walk and test it."
- Show the GPU job card running on the user's own Modal account.
- The trained policy comes back as an ONNX file and replays in the same simulator.
- "Same loop: train, test in sim, read the result."
- Only show this if a real run is recorded; otherwise cut it and give the time to the laptop.

2:15 The Arduino side, 15 seconds.
- A wall-avoiding robot reaching the goal on its fourth run.
- A phone photo of a real breadboard, with Muse Spark's verdict: "ECHO is on D10, move it to D11".

2:30 Share. Runs → "Share this run". Open the link on a phone: the duck closing the laptop replays on a public page, with no account. "The link carries the run; nothing is uploaded."

2:40 Meta stack, one shot of the model picker and the tool rows.
- The agent runs on Muse Spark Open (open weights, on Baseten or Fireworks), or Muse Spark on the Meta Model API.
- SAM 3.1 finds objects. Muse Image makes scenes.
- Each user's own Meta key is saved once in Settings.

2:52 Close. "Any robot, any compute provider, from a browser. robolance is open source, built on OpenLance. Link in the description."

Recording notes:
- 1080p, browser at 125 percent zoom, dark theme, chat on the left and the Hardware tab on the right.
- Pre-run every prompt once so the sandbox is warm and the template is current. Rebuild the E2B template from robolance `main` first.
- Agent turns run on Muse Spark Open; the photo and SAM turns use the Meta key.
- Have the laptop replay link ready on the phone in case the clipboard step stumbles.
- A local preview of the laptop run, desktop and phone, was recorded on October 29.

## X post (Most Viral prize, by November 8)

Draft 1 (the laptop clip):
> My robot duck got tired of me coding all day, so it walked over and closed my laptop. 🦆💻 I just told the AI "close my laptop so I come and play"; it wrote the duck's program, ran it in a physics sim, and fixed it until the lid shut. Built on Meta's Muse Spark + SAM 3.1 for the Meta hackathon: github.com/shaikh-amer/robolance

Draft 2 (shorter):
> Robots you program by talking. The agent writes the code, runs it in a physics simulator, watches what happened, and fixes it until it works. A duck scoring goals, dodging boxes it found in a photo (SAM 3.1), and closing my laptop. Open source on Muse Spark. [video] github.com/shaikh-amer/robolance

Attach the 15-second laptop clip, not the full video. Use the moment the lid drops as the thumbnail.

## Form answers

Project name: robolance

Category / track: Startup

Meta products used:
- **Muse Spark 1.3** (Meta Model API): the coding agent's model, and its vision checks a photo of a real breadboard against the circuit the agent designed.
- **Muse Spark Open** via Baseten and Fireworks AI: the open-weight option for the same agent.
- **SAM 3.1** (Meta Model API): finds objects in a photo ("cardboard box") so a room becomes obstacles for the simulated robot.
- **Muse Image**: image generation in the chat. Ask for a picture in plain words; it appears in an animated card as it is made and is saved in the project. Also makes test photos for SAM.

All of them run on each user's own Meta key, saved once in Settings and never sent to the sandbox. Planned: a Muse Glimmer fine-tune on the agent's run logs.

How it works:
- **Tools:** the agent gets MCP tools for each kind of robot:
  - `duck_api`, `duck_run` and `duck_obstacles_from_photo` for the Microduck;
  - `scene_check` and `scene_run` for any MuJoCo robot;
  - `hardware_parts`, `hardware_compile`, `hardware_run` and `hardware_arena` for Arduino robots.
- **Microduck runs:** `duck_run` runs a mission on Pollen Robotics' Microduck in MuJoCo with its trained skills. It returns the outcome, a 0–100 score, every kick, the path, and notes that say what went wrong.
- **The loop:** the agent iterates on that the way it iterates on a failing test, and the harness keeps it in the loop.
- **Training:** new skills train on the user's own GPU provider (Modal) as a background job, and the trained policy is tested in the same simulator.
- **Replay and sharing:** each run is recorded into the project. The IDE's Hardware tab replays it in 3D and shares any run as a link that replays on a public page.

Why it matters: robotics is where "vibe coding" stops today, because the model cannot see the result. A deterministic simulator in the loop makes the agent's work visible, checkable and cheap, and takes the hardware off the desk for learners and teams. Meta's models give it eyes on the real world: photos of rooms and boards.

What is next:
- more robots from their MJCF models;
- sim-to-real on a physical Microduck;
- real-board flashing from the browser over WebSerial;
- shareable challenges with a leaderboard of shared runs;
- the fine-tuned Glimmer model trained on the run traces.

Run replay (public, no account): https://robolance.openlance.ai/replay/

Repository: https://github.com/shaikh-amer/robolance (hackathon work only). OpenLance: https://github.com/shaikh-amer/openlance.

## Checklist before submitting

- [x] Packages on npm:
  - robolance-mujoco 0.1.0
  - robolance-hardware-sim 0.2.1
  - robolance-duck-sim 0.5.0
  - robolance-hardware-tools 0.5.0
  - robolance-openlance-hardware 0.9.0
- [x] OpenLance IDE pinned to robolance-openlance-hardware 0.9.0 (openlance #406).
- [ ] Sandbox template rebuilt from robolance main:
  - run `export E2B_API_KEY="$(cat ~/.e2b/api_key)"`, then `bash scripts/build-e2b-template.sh openlance-ide`;
  - the log shows `duck-sim ok`.
- [x] GitHub Pages enabled for the repository (Source: GitHub Actions) on the custom domain https://robolance.openlance.ai
- [ ] A link from "Share this run" opens on https://robolance.openlance.ai/replay/ on a phone (duck run and laptop run)
- [ ] Keys saved in OpenLance Settings:
  - a Meta Model API key (Muse Spark, SAM 3.1, Muse Image);
  - a Baseten or Fireworks key (Muse Spark Open);
  - Modal under Compute providers.
- [ ] End to end on the deployed IDE:
  - [ ] score a goal;
  - [x] image generation (the picture appears in the chat card);
  - [ ] photo to obstacles (a SAM 3.1 call returns boxes);
  - [ ] close the laptop;
  - [ ] wall avoider;
  - [ ] a wiring-check photo gets a verdict;
  - [ ] a share link opens on a phone.
- [ ] Optional: a recorded Modal training run whose policy replays in the simulator.
- [ ] Video recorded, under 3 minutes, opens with the pre-existing vs new line.
- [ ] README on main matches what the video shows.
- [ ] Submission form filled on cerebralvalley.ai; X post scheduled with the laptop clip.
