# Test guide: Meta models and partners in robolance

A click-through to check every Meta feature and partner integration on the
deployed IDE (https://ide.openlance.ai) before recording the demo. Each test
says what to type, what you should see, and what to do when it fails. Tick the
boxes as you go. About 45 minutes for everything, 15 for the starred ★ core.

## 0. Before you start (once)

- [ ] **Deploys are current.** In Dokploy, the IDE and Go backend show builds
      from today. The sandbox template is rebuilt from robolance `main`:
      ```
      export E2B_API_KEY="$(cat ~/.e2b/api_key)"
      bash scripts/build-e2b-template.sh openlance-ide   # log ends with: duck-sim ok
      ```
- [ ] **Keys saved** in Settings → **Model keys** (keys never go into the
      sandbox, the chat or logs):
  - **Meta (Meta Model API)**: Muse Spark, Muse Wonder, SAM 3.1, Muse Image,
    Muse Voice Transcribe, Muse Code.
  - **Baseten (Meta hackathon)**: Muse Spark Open (hackathon id).
  - **Fireworks AI**: Muse Spark Open.
- [ ] **Modal** connected in Settings → **Compute** → Compute providers (only
      for test 9).
- [ ] Phone ready, for the voice and share-link tests.

If a test fails, screenshot the chat (tool rows expanded), note the time and
the project name, and send them over. Remove emails or tokens from the
screenshot first.

---

## 1. Muse Spark 1.3 (Meta Model API) ★

The coding agent's main model.

1. From Home, type: **"Make the duck score a goal."**
2. Before sending, set the model chip under the chat box to **Muse Spark 1.3
   (your Meta key)**.

Expect:
- [ ] A Microduck project is created and named from the chat.
- [ ] Tool rows like "Ran the Microduck mission: no goal · score 30 · 1 kick",
      then an edit to `mission.js`, then another run.
- [ ] It ends with a goal and a score (90+). The Hardware tab replays the duck
      walking up and kicking.

Fails with "no Meta key" → the key is not saved, or it was saved for another
account. Re-save it under Model keys.

## 2. Muse Spark Open on Baseten and Fireworks ★

The same agent on Meta's open-weight model, served by two partners.

1. In the same project, switch the model chip to **Muse Spark Open, hackathon
   (your Baseten key)**.
2. Type: **"Make the duck score faster, under 9 seconds."**
3. Repeat with **Muse Spark Open (your Fireworks key)**.

Expect, for each:
- [ ] Baseten: the agent answers, runs the mission and reports a time.
- [ ] Fireworks: the same.

A 401/403 means a wrong key or model id. The hackathon Baseten key works only
with the dated id (`muse-spark-open-1026`), which is the "hackathon" entry.

## 3. Muse Code by Meta (chat agent) ★

Meta's own coding agent, running inside the project's sandbox.

1. In the chat header, tap the **∞** tab (Muse Code).
2. The empty chat shows Meta's logo and "Muse Code by Meta".
3. Type: **"What does mission.js do? Answer in two lines."**

Expect:
- [ ] A short answer about the mission file.
- [ ] No "process … not found" error. Since OpenLance #464, Python projects
      also get a sandbox with Node.

If it says "Muse Code stopped right after starting in the sandbox (…)", send
the text in brackets. A project created before #464 may need a fresh sandbox.

## 4. Muse Voice Transcribe (dictation) ★

1. On the phone, open any chat. The 🎤 button sits beside Send (it only
   shows when a Meta key is saved).
2. Tap 🎤 → **Allow** the microphone → say "make the duck kick with the left
   foot" → tap 🎤 again.

Expect:
- [ ] The words appear in the chat box (not sent yet); you can edit them and
      tap Send.
- [ ] Silence gives "Muse Voice Transcribe heard no words." and no garbage
      text.

Mic blocked → in the browser's site settings, allow the microphone for
ide.openlance.ai, then reload.

## 5. Muse Image (image generation) ★

1. In a duck project, type: **"Make a picture of cardboard boxes on a wooden
   floor, seen from above."**

Expect:
- [ ] One chat card in the picture's shape that glows while it is made, then
      the picture fades in with the prompt as caption.
- [ ] The file is saved under `images/` in the project; a tap opens it full
      size.

## 6. SAM 3.1: photo to obstacles ★

1. Use the picture from test 5, or attach a real top-down photo of a floor
   with a few boxes (chat **+** → Photos or Camera).
2. Type: **"Here's my floor. Walk to the ball without hitting anything."**

Expect:
- [ ] A row like "Found 'cardboard box' in floor.jpg: 3 found" (SAM 3.1).
- [ ] The boxes appear on the pitch as obstacles, and the replay shows the
      duck walking around them.
- [ ] With a room photo instead ("walk around the chair"), it finds the chair
      without being told tool names.

## 7. The laptop mission (Muse Spark + simulator) ★

1. Type: **"I've been coding all day. Close my laptop so I come and play."**

Expect:
- [ ] An open laptop on the pitch; the duck walks behind it and headbutts
      the lid shut.
- [ ] "LAPTOP CLOSED!" and a score around 95 in the replay.

## 8. Muse Spark vision: wiring check from a photo

1. From Home, type: **"Build a robot that avoids walls with an ultrasonic
   sensor."** (an Arduino robot project).
2. Hardware tab → Circuit → **Check wiring from a photo** → pick a photo of a
   breadboard.

Expect:
- [ ] "Reading photo…", then a verdict naming pins, e.g. "ECHO is on D10,
      move it to D11", or "matches the circuit".
- [ ] The wall avoider reaches the goal in the Arena within a few runs.

## 9. Modal: GPU training (optional for the video)

1. In a duck project, type: **"Train a better walk and test it."**

Expect:
- [ ] A GPU job card that runs on your own Modal account (visible in the Modal
      dashboard).
- [ ] When it finishes, the agent is woken by itself. It gets the ONNX policy,
      replays it in the simulator and reports the result.

Only show this in the video if a real run finished.

## 10. Muse Wonder 1.0 (quick check)

1. Switch the model chip to **Muse Wonder 1.0 (your Meta key)** and ask:
   **"Explain in one paragraph how the duck decides when to kick."**

Expect:
- [ ] A normal answer. No tools are needed.

## 11. Share a run (no account needed) ★

1. Hardware tab → **Runs** → pick the laptop run → **Share this run**.
2. Open the link on the phone, in a private window.

Expect:
- [ ] https://robolance.openlance.ai/replay/… replays the run without a
      sign-in.

## 12. Connectors (bonus, not Meta)

1. Chat **+** → **Connectors** → **Linear** → Connect → sign in.
2. Type: **"Create a Linear issue: duck misses kicks from the left."**

Expect:
- [ ] The issue appears in Linear.

---

## Results

| # | Feature | Partner | Pass | Notes |
|---|---------|---------|------|-------|
| 1 | Muse Spark 1.3 agent | Meta | | |
| 2a | Muse Spark Open | Baseten | | |
| 2b | Muse Spark Open | Fireworks AI | | |
| 3 | Muse Code by Meta | Meta | | |
| 4 | Muse Voice Transcribe | Meta | | |
| 5 | Muse Image | Meta | | |
| 6 | SAM 3.1 photo → obstacles | Meta | | |
| 7 | Laptop mission | Meta | | |
| 8 | Wiring check (vision) | Meta | | |
| 9 | GPU training | Modal | | |
| 10 | Muse Wonder 1.0 | Meta | | |
| 11 | Share link | — | | |
| 12 | Linear connector | — | | |

When the starred tests pass, tick the matching boxes in
[submission.md](submission.md) → "Checklist before submitting".
