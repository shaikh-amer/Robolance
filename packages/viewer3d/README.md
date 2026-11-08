# robolance-viewer3d

A 3D model viewer for the browser, used by OpenLance's 3D tab and by Robolance's Hardware tab.

- **Formats:** glTF/GLB, OBJ, STL and FBX.
- **Stage:** studio reflections, a key light with soft shadows on a ground disc.
- **Camera:**
  - drag to orbit; right-drag or two fingers to pan; wheel or pinch to zoom; double-click to reset;
  - frames any size, from a screw to a building.
- **Toolbar:** wireframe, reset view, animation playback.
- **Model stats:** triangles, vertices, draw calls, materials, textures and size.

```tsx
import { ModelViewer } from 'robolance-viewer3d';

<ModelViewer data={bytes} fileName="chair.glb" onStats={(s) => console.log(s.triangles)} />
```

Without React:
- `parseModel(bytes, 'glb')` gives an upright `THREE.Object3D`;
- `modelStats(root)` gives the stats;
- `new ModelStage(element)` is the stage.

## Up axis

The stage is **z-up**, like MuJoCo and the Hardware tab:
- glTF, FBX and OBJ (y-up) are turned upright when they load;
- STL is taken as z-up, as CAD tools write it.

## One copy of three.js

three's loaders are ES modules that import `three`; this package is CommonJS. A bundler that resolves `require('three')` to `three.cjs` and `import 'three'` to `three.module.js` ships two copies of three.js. It still renders, but it is twice the size and the console warns "Multiple instances of Three.js".

Resolve bare `three` to its ES module build so everything shares one copy. With esbuild:

```js
const threeModule = require.resolve('three').replace(/three\.cjs$/, 'three.module.js');
const oneThree = { name: 'one-three', setup(b) { b.onResolve({ filter: /^three$/ }, () => ({ path: threeModule })) } };
```

## Tests

`npm test`, run in Node:
- parses a GLB exported from Blender (3,948 triangles, upright);
- parses STL and OBJ;
- checks the stats line and the fitting maths from 5 mm to 250 m.
