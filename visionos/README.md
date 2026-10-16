# Spatial Take · Apple Vision Pro

The web editor's agent, live on Apple Vision Pro: ask about the room you are in, and the answer is placed on a real surface, the way
the editor places it over a recording. This app is separate from the web editor; it does not need to be kept in step with it.

Done: **align, ask, answer on a surface**; **weather mod** (first version). Space: **atlas** only, its scan "reassembled 2F".

## How it works

| Web editor (recording) | Vision Pro (live) |
| --- | --- |
| recorded camera pose | the headset's pose (ARKit world tracking) |
| layout `scan/semantic.json` registered to the recording | the same layout, aligned to the room: auto, then fine-tuned by hand, saved as a world anchor |
| text surfaces (`src/layout-surfaces.mjs`) | the same surfaces, exported by the editor's own code (`tools/export-space.mjs`) |
| text colour and clutter from the video frame | from the scan's colours baked onto each surface (`tools/bake_surface_colors.py`): the headset gives apps no camera image |
| LiDAR depth for "is the text hidden?" | the headset's room mesh (scene reconstruction), ray cast |
| agent: `scripts/server.py` + bridge (Jev, Gemini) | unchanged, on the Mac; the app asks over the local network with the head pose (connection set up on the Mac, bundled with the app) |
| weather: target (`selectWeatherTarget`), storybook effects (GLSL shaders) | same target rules (`Weather/WeatherTarget.swift`). The shaders are ported to Metal compute kernels (`Weather/Weather.metalsrc`, compiled at run time) drawn each frame into textures: the ground's gradient and glow, rain ripples, the moonlit pool, dappled sunlight, settling snow, ray-marched clouds and fog, the sun and moon. Rain, snow and stars are particles. |
| editor edits (layout, settings) | followed live (`scripts/vision.py`, `Agent/LiveSync.swift`); settings page `editor/vision.html` |

Swift code (`SpatialTakeVision/`):

- `Space/`: the exported space (`SpaceData`), and the baked colours (`ColorGrid`).
- `Alignment/AutoAligner.swift`: the floor seen gives the height. The walls seen vote for the yaw. Pairs of walls fix the position. Every hypothesis is scored by all the walls, table tops (rulers: known heights and footprints) and doors seen, then refined by least squares. The zone you are in (picked in the window) limits the walls tried. On synthetic atlas data it recovers the transform to within 3 cm.
- `Placement/SpatialRelations.swift`: how you stand to the room, ported from `src/spatial-relations.mjs` with its hysteresis: A the desk under your gaze, B the wall you face, D what your gaze is on (floor, window, door, object). Answers go on that surface when there is one, else the best in the room; info answers favour it.
- `Alignment/ICPRefiner.swift`: fine alignment. Only the room's shell is used on both sides when there is enough of it: the headset mesh faces ARKit classifies as wall, floor, door or window, and the scan's points on the layout's walls and floors. Clutter is left out. The room's mesh as the headset reconstructs it (one point per 5 cm) is fitted to the scan itself (`SpaceData/<space>/scan-points.bin`, 400k points with normals, written by `mac.sh prepare`), point to plane: yaw and translation, floors and walls weighed equally, outliers down-weighted. Auto-align tries its best few candidates and keeps the one most of the mesh lands on. The scan's scale is measured but not applied. On synthetic atlas data it recovers a start off by 20° and 85 cm to within 0.1 cm.
- `Alignment/AlignmentStore.swift`: the saved alignment. It is a world anchor at the space's origin, which visionOS restores in the same room.
- `Placement/TextPlacement.swift`, `Legibility.swift`: ported from `src/text-surfaces.mjs`, `src/placement.mjs` and `src/legibility.mjs`. Text size is an angle: x-height 0.45°, never under 0.3°.
  - The web judges a spot from the camera frame and the recorded depth. The headset has no camera image, so it uses the scan's baked colours instead. Where the scan saw nothing, the spot counts as moderately busy.
  - Depth comes from the room's live mesh, as on the web: `surfaceQuality`'s roughness and occupied terms, cost 4 clutter + 2 roughness + 4 occupied.
  - First, each surface is calibrated against the mesh: its median offset over a grid on it is subtracted, as the web's `calibrateSurfaces` does. Without this, a few centimetres of alignment error made a whole table read as occupied, and the candy's answer never settled on it.
  - A backing, when the colours leave no room for contrast, wraps the text with a margin.
- `Agent/AgentClient.swift`: questions with the head pose, and answers as they stream.
- `Render/`: the answer's text texture and plane, and the layout overlay used for aligning.

## Setup

### On the Mac

1. **Prepare** (once, and again after editing atlas's layout in the editor).
   - Exports the space and bakes the scan's colours.
   - Writes the app's connection (`SpaceData/atlas/agent.json`): this Mac as `<name>.local`, plus a token from `agent-config.local.json`.
   - Nothing gets typed on the headset. `SpaceData/` is git-ignored.

   ```bash
   visionos/tools/mac.sh prepare
   ```

2. **Run the agent.** Stop the editor's own server on 8766 first; this one serves the editor too, at http://127.0.0.1:8766.
   - It starts the server, listening on the local network (agent API only, with the token), and the bridge for the live session.
   - Keep it open. The first time, allow Python's incoming connections when macOS asks.

   ```bash
   visionos/tools/mac.sh run
   ```

3. **Build to the headset**: open the project, pick the Vision Pro as the run destination, then press ⌘R.

   ```bash
   open visionos/SpatialTakeVision.xcodeproj
   ```

### On the Vision Pro, the first time

1. Join the same Wi-Fi as the Mac.
2. Pair with Xcode: Settings → General → Remote Devices (on the Mac: Xcode → Window → Devices and Simulators).
3. Turn on Settings → Privacy & Security → Developer Mode, then restart.
4. When the app first opens, allow **local network** and **world sensing**.

## Use

The room opens with the app. Answers and weather live there; Room view is only the debug overlay. A strip on top of the window
shows whether the room's mesh is scanned (wait for **Room mesh ready**), the walls, floors and tables found, and the alignment.

The window has four pages (a segmented control on top, as in the web editor's side panel):

- **Scene**:
  - **Room view** (debug; its button is on the ask bar) draws the layout's walls, furniture and openings over the room. Round ones (the kitchen's round table) are drawn as cylinders.
  - Align:
    - Pick the zone you are in.
    - Look around at the walls, the floor and a table for about 5 s, then press **Auto-align**. It refines against the scan by itself; the status shows the RMS, how much of the mesh matched, and the scan's scale if it is off by more than 1%.
    - Nudge with the arrows (turn left, ←, forward, back, →, turn right, up, down; 1 cm and 0.5° when fine).
    - After nudging, press **Refine** to fit to the scan again from there.
    - Press **Save alignment**.
- **Agent**: it connects by itself when the room opens. The mods' settings are under one segmented control (Info · FindMy · Weather). Defaults: zone lab, info selection by score only, placement stability 80%.
  - With **Weather mod** on, the weather plays, in this order:
    - on a window in view. It stays there while any of the window is still in view, so looking up a little does not move it to the ceiling;
    - on the desk you look down at (A), the desk your gaze lands on within 2 m, or the desk or table in front of you (within 1.5 m);
    - on the wall you face (B), as a patch that is small near and large far (about 30° across);
    - else on the ceiling. Never on the floor.
  - Its text is hand-lettered and written in glyph by glyph like an info answer. It has no backing, and only your hands cover it.
    - It goes under the window; on the desk beside the patch; beside the patch on the wall (the info answer's placement); or, for the ceiling, on the wall you face squarely, just below the ceiling.
    - It always faces you (within 50°), never on a side wall.
  - The ask bar has a clear button that removes every answer in the room, with its weather and FindMy.
  - The ask bar has a past-questions button next to the ready-made ones. It replays a stored answer and asks the agent nothing.
  - The gear on the bar opens the settings as a panel over the bar, following with it.
  - A FindMy answer's text hangs under the ask bar, hand-lettered with no backing, and follows with it.
  - Gestures. Hold a hand out, palm down, every finger open. A glowing ball appears under the palm. Then close all the fingers into a fist; the ball draws in and turns the hand's colour as you close, then bursts. A tone plays.
    - Right hand: hold the fist while you speak, then let go. That is one voice episode. What you say floats over the back of your hand word by word while you speak, and it is asked when the hand opens.
    - Left hand: the bars and buttons (ask bar, weather controls, settings) hide or show. Answers stay.
    - It must start from an open hand and end with every finger curled. A pinch, scrolling a list or grabbing a panel never triggers it.
  - The settings panel has a grip on its top edge: drag it by hand. It keeps that place relative to the bar and still follows.
  - The panels move up and nearer when something real (a desk, a shelf) would hide any corner of them, and come back when clear.
  - Its controls appear within reach: a little below your eyes, tilted up toward you. They hold the day buttons, play/pause, the time slider, and the time, sky and temperature.
  - **Lock location** keeps the weather where it first showed.
- **Behavior**: the answer's body size.
- **Questions**: the questions asked on the headset. Tap one to replay its stored answer as it came, placed where you look now.

- Answers written stroke by stroke have a 3D pen whose tip follows the trace.
- Every answer is hand-lettered.
- An ordinary answer (not info, weather or FindMy). When one is placed again (no longer readable, or an animation came), the same rules apply:
  - goes on the desk or table in front of you (A, or a top within 1.2 m across ±25° of where you face), lying and turning smoothly to read toward you;
  - else on the wall you face (B), near eye level;
  - else over the ask bar, hand-lettered, following with it.
- Info answers stay where they are put. A floating one checks every 2 s for a spot to settle on, and moves there and locks once one turns up.
- A backing appears only on a busy background with no room for contrast. A clean background, an unknown one and floating text never get one.
- Answer text, its backing and the pen are drawn over everything real. Only your hands cover them; the room never hides them.
- Relation A (and the weather's desk check) uses headset eye height: the desk top up to 1.2 m below the eye, the gaze meeting it within 1.5 m. The web's 0.9 m and 1 m were set for a phone held at chest height, and with a standing headset user they fail at a desk.
- The Xcode console logs each answer's placement (relation, surface, info score) and each weather target, for checking why something went where it did.
- Info objects: the live session's scene objects carrying info (the candy) are info targets too, as `comp:<id>` from `scenarios/vision-live/composition.json`. `export-space.mjs` makes that file once from the library objects with info; edit it in the editor afterwards.

- **Where you are** (`Space/Location.swift` → `editor/scripts/location.py`): each question carries the zone you stand in, and a zone you face without being in it. The latter is found when your gaze, or a pointing finger, meets one of its doors, windows or openings, e.g. from the corridor; or when you stand within 1.2 m of its door, whichever way you look (about to go in). The agent gets both zones' names and info, and resolves "here", "this place", "this lab" and "where am I" to them. A pronoun the conversation resolves ("where is it?" after asking about a book) means that thing, not the zone you stand in. Zones may carry info; the lab's is "Programmable Reality Lab" (full name; short name PRL).
- The ask bar shows, in small text under it, the zone you are in and the one you face.
- **The lab's animations** (`Animations/ZoneAnimation.swift`; `LabDiorama.usdz` and `RealityDiorama.usdz` from `vision-animation-3d`):
  - They apply when you are in the lab, face it, or have its vision on the wall selected.
  - One Jev call (`jev_call_zone_animation`; response part `animation`) chooses what the question calls for:
    - LabDiorama: lab life, requirements, how the lab conducts research.
    - RealityDiorama: the lab's research content and vision.
    - None: plain facts, such as who leads the lab or who its students are, are answered in text alone.
  - The two animations are named labResearchLife (the former LabDiorama) and labResearchWork (the former RealityDiorama).
  - The lab's info is in three parts (info keys): `Programmable Reality Lab` (names, institute, director, students), `PRL research theme` and `PRL philosophy`. For a question about the lab, the same Jev call that chooses the animation also chooses the parts the answer needs, and the answer reads only those. This holds whether the question goes through the lab's info (asked in it, or with its vision on the wall selected) or not.
  - The lab's info (zone and lab philosophy) is now text: the ATLAS Institute, led by Prof. Ryo Suzuki; students Hye-Young Jo, Keiichi Ihara, Ada Yi Zhao, Sean Xiaoan Liu and Ziru Wei.
  - Where it goes: on the lab's central square table (desk 5) when that is in view; else on the desk or table you are at; else floating within reach, in front of the ask bar and clear of it.
  - Nothing real hides it: the room's occlusion is off while it plays.
  - Answer text never hides it. This covers text over or under the ask bar, info answers (settled or not) and the weather's text. Any text that would cover it from where you are is placed again by its own rules, clear of it, else floats aside. This is checked when text appears, when the animation comes, and twice a second as you move.
  - It loops. Touch one of the turntable's four sub-discs and that chapter plays, then the loop goes on.

### Editing on the Mac

Open http://127.0.0.1:8766/vision.html while `mac.sh run` is running. It is the web editor in Vision Pro mode:
- the scan and all of atlas's boxes in the 3D view (orbit), without the recorded camera
- **Scene** tab: the Layout and Scene objects sections, to adjust the boxes. Saves reach the headset within a few seconds.
- **Vision Pro** tab:
  - **Tune**: the headset sends its room's mesh (points) and alignment every 10 s. Tune shows that room on the scan with the move and turn gizmo, as when tuning a recording (Undo, Redo, Reset, Save, Cancel). Save sends the alignment; the headset takes it within seconds and saves it as its world anchor.
  - The questions asked on the headset, each deletable, or all at once.
  - The headset's settings (Room view, zone, weather mod, lock, body size). Changes reach it within 2 s.

## Done since the first milestone

- **Info mod** (`Info/`):
  - Selection: the fovea (head), pointing (ARKit's 3D index finger) and touch, or the zone you stand in. It is sent with the question; Jev judgement or score only.
  - The answer settles on a good surface by its box or floats beside it (`InfoPlacement`, the web's infoPlacement and score).
  - Marks: corners on the box's face, an arrow to it, and a lock once settled; Mansalva lettering.
  - Exactly one thing is meant, or nothing: each box's share is the chance that it alone is meant, and the shares and "nothing" add up to 100%. The most likely of them is the selection. Gaze and pointing lean slightly toward the box nearer the line's centre, so neighbours do not tie.
  - Only boxes within 2 m (to their surface) count, seen no more than 60° off square left or right, or above or below.
  - The selected box breathes with a subtle light blue glow, no edges (always shown). Only your hands cover it. Room view shows each box's share and nothing's.
  - Info keys are edited in the editor's Layout section and follow live.
- **Answers:**
  - They stay put while readable and are placed again (easing) after a grace period when not (Placement stability). Settled info answers never move.
  - The room's mesh hides what is behind real things (Real things hide answers).
  - Answers are written glyph by glyph, with pen strokes (CoreText outlines), at a set speed.
  - Heading size and show heading.
- **FindMy mod** (`FindMy/`): the container highlighted in fluorescent green. A nested container (a shelf of a bookcase, e.g. `shelf 3/bottom shelf`) is highlighted with its parent faintly around it, in the editor too. Seen through walls, with an arrow at the edge of the view while it is out of view; optionally removed when a hand comes near. atlas has one item: headphones on lab shelf 1.

## Not yet

- the object mod (needs the scene objects' models on the headset: glb → usdz)
- weather: the volumetric light beams
- the question's caption and the agent's thinking, in the room
- anything that needs the camera image (blurring the real background behind text or weather): visionOS gives apps no camera image
