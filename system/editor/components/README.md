# Component library

Each folder is one reusable 3D component. `component.json`:

```json
{"name": "Calibration cube", "kind": "three", "entry": "index.mjs", "params": {"color": {"type": "color", "default": "#d99c56"}}}
```

- `kind: "three"`: `entry` is an ES module exporting `create(ctx)`; ctx = `{THREE, params, load(url) → glTF, invalidate()}`.
  It returns `{object, update?(state), onPointer?(event), setParams?(params), dispose?()}`:
  - `object`: a THREE.Object3D, placed by the instance's transform (position, yaw, scale), standing on its own origin (y = 0 is the base);
  - `update({t, dt, local, frame})`: called whenever the video frame changes; `t` is the scenario time in seconds, `local` the time since
    the instance appears (its `start`). Animate from these values (not from wall-clock time), so scrubbing and exporting are deterministic;
  - `onPointer({type: 'click', point, object})`: the instance was clicked in the video or 3D view;
  - `setParams(params)`: a parameter changed in the panel (else the component is rebuilt).
- `kind: "gltf"`: `entry` is a .glb (e.g. exported from Blender, units in metres, y up). Its animations play on the scenario clock
  (looped), so they stay in sync with the video.

`params` (optional) describes editable parameters: `{name: {type: "number"|"color"|"boolean"|"text", default, min?, max?, step?}}`.
A .glb imported from disk in the editor becomes an instance embedding the file (kind gltf, no library folder needed).

## Object categories

- `category: "persistent"`: stationary scene objects shared by all recordings; saved in the scene composition with `scope: "scene"`. Legacy `"digital twin"` manifests remain supported.
- `category: "opportunistic"`: objects specific to a recording (for example offline SAM 3D outputs); saved in that scenario’s composition and `assets/`, with `scope: "recording"`.
- `category: "widget"`: procedural components such as the calibration cube.

Components → **+ Opportunistic object** imports a `.glb` into the current recording. Use the combined 3D handles to place it, then **Save object defaults** to establish the Reset baseline. Import currently uses an approximate initial position near the camera’s view; it does not recover SAM 3D camera alignment from a bare GLB. Persistent and opportunistic refer to cross-recording lifetime; neither category locks manual editing or automatically tracks motion within a recording.
