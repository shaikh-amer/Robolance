# robolance-duck-sim

[Microduck](https://github.com/pollen-robotics/microduck), the 25 cm open-source duck robot from Pollen Robotics and Hugging Face, on a small football pitch in a physics simulator. It runs headless in Node.

- **Physics:** MuJoCo (WASM), stepping at 200 Hz.
- **Skills:** Pollen Robotics' own trained skills (walk, stand, left and right kick), run with ONNX Runtime at 50 Hz, the rate they were trained at.
- **Missions:** a mission is a short JavaScript program that drives the duck. A run returns:
  - what happened: kicks, a fall, a goal;
  - a score;
  - notes that say why a kick missed;
  - a replay of every pose.

```js
import { readFile } from 'node:fs/promises';
import { runMission, MISSION_API } from 'robolance-duck-sim';

const mission = await readFile(new URL(import.meta.resolve('robolance-duck-sim/examples/score-a-goal.js')), 'utf8');
const result = await runMission(mission);
console.log(result.outcome, result.score); // goal 94
console.log(result.notes);                 // what happened, and why a kick missed
```

`MISSION_API` is the reference the agent reads. `examples/score-a-goal.js` scores wherever the duck and ball start on the default pitch.

## The default pitch

| Element | Position |
| --- | --- |
| Duck | starts at the origin, facing +x |
| Ball | (0.5, 0.2) |
| Goal | 60 cm wide, line at x = 0.95, net behind |

A kick sends the ball 0.4–0.8 m.

Pass `field` to `runMission` for another layout; `validateField` lists the rules.

## What the simulation taught us about the duck

| Behaviour | Detail |
| --- | --- |
| Slow walking barely moves the duck | The walking skill ignores commands below about 0.3 m/s. |
| Walking direction | It does not step sideways or backwards. |
| Turning on the spot | Needs about 1.2 rad/s, and turns of under ~13° don't happen. |
| Kick right after walking | Doesn't connect; the duck has to stand still for ~0.9 s first. |
| Kick window | The ball must be 6–8 cm ahead and 1.5–8 cm to the kicking foot's side. |
| Walking up to the ball | A swinging foot nudges a ball that is more than ~2 cm off the centre line. |

`turnTo`, `walkTo`, `walkForward` and `kick` handle these.

## Running a mission

Missions run in a worker thread with only `duck`, `field` and `log` in scope. Each run has two limits:
- simulated time, 40 s by default;
- real time, 60 s by default.

A full run takes 2–4 s of real time.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the robot model, skills and libraries this builds on. The Microduck meshes may be non-commercial.
