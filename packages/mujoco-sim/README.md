# robolance-mujoco

Any robot, from its MuJoCo MJCF: check it, run it under a controller script, record the run, and build the model a browser needs to replay it in 3D. Nothing here knows what the robot is; the MJCF and the controller say everything. The Microduck (`robolance-duck-sim`) is one robot built on it; the agent's `scene_check` and `scene_run` tools (`robolance-hardware-tools`) use it for robots the agent writes itself.

```js
import { Scene } from 'robolance-mujoco';
import { readSceneDir } from 'robolance-mujoco/node-files';

const scene = await Scene.load(await readSceneDir('robot'), 'scene.xml');
console.log(scene.check());          // actuators, sensors, mass, parts inside each other, stability
const run = await scene.run({
  seconds: 5,
  controller: `function control(sim) {
    sim.ctrl('shoulder_motor', Math.sin(sim.t));
    sim.metric('tip_z', sim.site('tip')[2]);
  }`,
});
const model = scene.viewerModel();   // bodies, joints, primitives and simplified meshes, part surfaces
scene.dispose();
```

- **Check:** MuJoCo's own error when a model does not load; parts that start more than 1 mm inside each other; a scene that blows up when left alone for a second (non-finite state, absurd speeds, or MuJoCo's bad-state warnings, after which it silently resets).
- **Controller:** JavaScript defining `control(sim)` (and optionally `init(sim)`), in its own V8 context with 250 ms per call. `sim` reads joints, bodies, sites, sensors and contacts; sets actuators by name (clamped to their range); records metrics and log lines; stops the run.
- **Run record:** qpos frames (25 a second by default), metrics, logs, the checks, and how it ended: `done`, `stopped`, `unstable`, `error` or `timeout`.
- **Viewer model** (`robolance-mujoco/viewer`, browser-safe): every geom MuJoCo's viewer shows by default (groups 0–2), primitives by shape and size, meshes simplified with meshoptimizer; forward kinematics for free, ball, slide and hinge joints, checked against MuJoCo.
