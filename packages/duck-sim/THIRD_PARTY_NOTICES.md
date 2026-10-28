# Third-party material

| Component | Source | License | Use |
| --- | --- | --- | --- |
| Microduck robot model (MJCF, STL meshes) | [pollen-robotics/microduck_rl](https://github.com/pollen-robotics/microduck_rl), as packaged by [TonyRuan/microduck-web](https://github.com/TonyRuan/microduck-web) | Apache-2.0 (`assets/model/LICENSE.txt`) | `assets/model/`, unchanged |
| Trained skills (ONNX): `alpha_walking`, `alpha_stand`, `ball_kick_left`, `ball_kick_right` | [pollen-robotics/microduck-policies](https://huggingface.co/pollen-robotics/microduck-policies) v5 | Apache-2.0 (model card) | `assets/policies/`, unchanged |
| Controller conventions (observation layout, home pose, action filter, gains) | [pollen-robotics/microduck](https://github.com/pollen-robotics/microduck) via [TonyRuan/microduck-web](https://github.com/TonyRuan/microduck-web) `src/simulation/controller.ts` | Apache-2.0 | Ported in `src/controller.ts` |
| MuJoCo | [google-deepmind/mujoco](https://github.com/google-deepmind/mujoco) (`@mujoco/mujoco`) | Apache-2.0 | Physics |
| ONNX Runtime | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) (`onnxruntime-web`) | MIT | Skill inference |

Pollen Robotics' training repository marks its STL meshes CC BY-NC-SA 4.0 (`LICENSE-MODELS.md` there), while the packaged copy used here carries Apache-2.0. Treat the meshes as non-commercial until Pollen Robotics confirms otherwise.

Microduck is a Pollen Robotics / Hugging Face robot. This package is an independent project and is not affiliated with or endorsed by them.
