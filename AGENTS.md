# ModOS: Guide for Agents

This folder holds one research project, **ModOS: Exploring On-Demand Spatial Interfaces in Mixed Reality** (UIST '27). An AI agent's answer in mixed reality becomes a spatial interface. The interface is composed at runtime from **MODs**: reusable units of knowledge and representation that people add to their environment ahead of time. Read this file first, then the design doc.

```
modos/               one git repo (origin github.com/ziru-wei/intelligent-spatial-interface, branch modos)
  AGENTS.md          this guide
  README.md          the short version for people
  index.html         the project's main page: Demo (ModOS live), Gallery (the recordings), Document (Spatial vocabulary; Memory, Walkthrough… to come)
  system/            the prototype
    editor/          the web editor and ModOS pipeline (everything below is under here)
    visionos/        the Vision Pro app (not yet updated to the spatial UI library)
  context/           design doc, study plans, paper draft, recordings
    docs/modos-system-design.md   THE spec: architecture, decisions, library, MOD format, status (§10)
    docs/system-changes.md, fs1-plan.md, stimuli-dryrun.md
    write-up/draft.md              paper draft
    recordings/                    headset-view videos per MOD, posters, cue images, manifest (videos are not in git)
```

This is the only copy: the old locations (`~/quest-spatial-studio`, `~/Documents/GitHub/isi-backend-context`) no longer exist. The two earlier repos were merged here with their history (the system's as the main line, `context/` imported by `git subtree`).

## Run

```sh
cd system/editor
npm ci && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once (see system/README.md for the mesh venv)
npm start                                  # editor + API on http://127.0.0.1:8766
```

- **Agent bridge.** One bridge per recording session. It runs the ModOS pipeline and calls the decision model (Jev) and Gemini.
  `node scripts/agent-bridge.mjs --url http://127.0.0.1:8766 --session ./spaces/atlas/scenarios/atlas_rec_5/session.json --config agent-config.local.json`
- **Credentials.** `agent-config.local.json` holds the keys and is git-ignored. Never print or commit it. Copy `agent-config.example.json` to start one.
- **Space data.** `editor/spaces/` (the atlas twin, recordings and mock context) is local, private and git-ignored. This session changed atlas mock data that exists only there:
  - devices in `spaces/atlas/modos/entities.json`;
  - items in `spaces/atlas/modos/items.json` (a symlink to the tracked `modos/examples/atlas/items.json`: edit that one);
  - layout boxes in `spaces/atlas/scan/semantic.json` (atlas has one scan: `atlas-reassembled`);
  - LabInfo in `spaces/atlas/modos/mods/labinfo.json` (a symlink to the tracked `modos/examples/atlas/mods/labinfo.json`: edit that one).

  Back these up before experimenting.
- **Restart the server after editing Python.** `scripts/server.py` keeps `modos_registry.py`, `agent_store.py` and the other modules loaded. A stale registry rejects new MOD declarations, so questions fail with messages like "unknown UI floatingText".

## Test

```sh
cd system/editor
node --test tests/modos-pipeline.test.mjs                                    # pipeline with mocked Jev/Gemini (17 tests)
python3 -m unittest tests.test_modos tests.test_modos_twin tests.test_agent_store
npm test                                                                     # everything (needs .venv)
```

To see a result, record it:

```sh
npm run record -- <clips or MODs>      # e.g. `npm run record -- weather wayfinding`: asks again, records into the reel, updates the manifest
npm run record:cues -- [cue names]     # cue gallery screenshots
```

- `demos/record.mjs` uses the clip list in `demos/modos-videos.json`. A name selects a clip, every clip of a MOD, or a name prefix. The clips run as one queue: a failed clip is reported at the end and the others are still recorded. Run it in the background. It needs the server, ffmpeg and Playwright's Chromium.
- `index.html` at the root is the main page. Demo frames the running editor (`http://127.0.0.1:8766`, atlas_rec_5; start it with `npm start` in `system/editor`); Gallery reads `context/recordings/manifest.js`. Serve the root to view it (`python3 -m http.server` in `modos/`) or open the file.

## How ModOS works (code map)

Stages (design doc §6.1), in `editor/modos/pipeline.mjs`:
0. Rules decide which MODs are eligible (`mod-selection.mjs`).
1. One Jev call grounds the referent and splits the request into questions, each with what it is `about` and a score per MOD (`request.mjs`).
2. MOD selection. A score ≥ .5 is chosen. Alternatives for the same need are deduplicated; two needs in one sentence keep both.
3. Context info. Each chosen MOD's `knowledge` refs are resolved along the twin (`context-request.mjs`, `scripts/modos_context.py`).
4. Fill. One Jev call per MOD fills its selectors (`fill.mjs`, `selectors.mjs`). The text slot is written by Gemini (`text.mjs`).
5. Represent. `compose.mjs` turns selections into parts. Each part carries the MOD's `ui` declaration and the facts known so far. The server resolves and stores the parts (`scripts/agent_store.py`, `scripts/modos_parts.py`).

The client draws what the MOD declared (§4.4, §4.5, §5.1):
- `modos/ui-rules.mjs`: the `fixed` / `flexible` + `when` rules. Shared by server and client.
- `src/cue-host.mjs`: marks and directions (FindMy, Wayfinding, ObjectStatus, a device). `src/floor-route.mjs`: Floor Path's route over rooms, walls and doors.
- `src/placement.mjs`: answer text; Embedded vs Floating Text from the declaration (`surface.score`). `src/cluster-placement.mjs`: generic UI clusters (`user-reach`: Weather's controls).
- `src/device-cues.mjs`: a device's Inputs and Outputs as cues, which can be pressed and dragged.
- `src/action-cues.mjs`: the message composition (Contact Chip, Text Input, Tether or Photo Capture, Send).
- `src/weather-preview.mjs`: Date Picker and Playback for Weather. `src/weather-scene.mjs` is Weather's ambient effect.
- `src/spatial-ui/cues.mjs`: the library (cues, message parts). `src/spatial-ui/kit.mjs`: labels and older panel components.
- `src/ui-settings.mjs`: what is adjusted outside MODs (UI library text and cue parameters, replay); `modSetting` reads a part's MOD settings. Side tabs: Space (recording on top, then the entity tree: geometry, semantics, knowledge), Agent, Input, MODs, UI library.
- `src/pipeline-view.mjs`: the pipeline visualization shown in recordings. `src/app.mjs` wires everything. `window.modosCues.show()` previews one cue.

MODs live in `editor/modos/mods/*.json` (12 foundational: 7 built, 5 spec). They are validated by `scripts/modos_registry.py`, which also handles overrides, forks, variants and `extends`. Space-owner MODs live in `spaces/<space>/modos/mods/`.

## Decisions to keep (from the user)

- **The MOD declares its UI.** Each slot lists `fixed` parts and `flexible` parts with a `when` rule over computed facts. No MOD has its own controls or text styles; everything comes from the shared library. MOD-specific parts are only ambient effects and assets. The decision model chooses MODs and fills slots; it does not choose UI.
- **Library = cues + controls + text forms.** Controls are Adjust, Explore and Interactive (Contact Chip, Text Input, Tether Send, Photo Capture: reaching a person; not called "message").
  - Describe every part by when to use it and what for, not by what it is.
  - Similar parts must state how they differ:
    - Breathing Box draws attention to a thing.
    - Corner Brackets mark things whose content must stay visible.
    - Footprint Ring marks the thing being operated.
    - Gauge is read-only; Slider is for changing a value.
    - Progress Rail is a task moving through time; Gauge is a level.
    - Adjust controls (Slider, Edge Tabs, buttons) change the thing; the change is sent once the user makes it (a slider when let go). Explore controls (Date Picker, Playback) move through information; nothing is sent.
    - Status Pulse says the state from the data ("In use"), never the thing's name; with no state in the data it is the dot alone.
- **Directions.** Arrow Ahead when the target is in the same room but out of view. Floor Path when the target is in another room. Never both.
- **Two arrows, both library cues.** Arrow Ahead / Floor Path lead the user somewhere. Text Arrow links text to the thing it is about (bright cyan polyline, declared `textArrow when text.apart`). No hand-made arrows.
- **Communication.** Reply to the user in a Chinese-English mix: Chinese sentences with English technical terms.
- **Places.** A place is highlighted only by its floor (or its doorway), never a box.
- **Text forms.**
  - Embedded Text when the surface score is ≥ 0.5, else Floating Text.
  - Object-centric Dialogue only when a thing is clearly pointed at and asked in the second person ("Can I eat you?"). The rule alone decides. It is a form of the text slot (`dialogue` in its `ui`): a speech bubble on the thing (`src/spatial-ui/dialogue.mjs`), no motion, no part of its own.
- **Look.**
  - Theme is bright cyan `#3ff0ff`. No yellow theme; amber and red are only state colors.
  - Highlights are translucent cyan and breathe.
  - Every clickable is a rounded capsule. Text on cyan has no shadow or outline. Text faces the user and is flat.
- **Buttons.** Icon + word from presets (`modos/buttons.json`). A system-written text-only button is used only when no preset fits.
- **No boilerplate UI text.** Text must come from data or a decision ("waiting for you" and "Nothing is sent until…" were removed).
- **Pinned Tags.** Leaders share one anchor point on the thing's right side.
- **Retrieval.** Choose MODs first from the request's questions and what they are about, then fetch context info per MOD. No slow LLM step in retrieval. Call it "context info", not "memory".
- **Writing.**
  - The system is ModOS; the unit is a MOD. Users *tailor* MODs; they do not author them.
  - Docs: sections numbered x / x.x, English titles, no horizontal rules, no em dashes in prose.
  - The user writes in Chinese and English; replies to the user mix Chinese and English (Chinese sentences, English technical terms).
- **Generalize, never overfit.** No small feature made for one MOD or one scene (hand dismissal, per-MOD text switches, per-answer-type knobs). A feature that is not used is removed in the code, the data format and the tests, not only hidden in the UI.
- **Editor UI.** Explanations sit behind a hoverable "?" (`.help[data-tip]`), never as exposed paragraphs. Names say what a control does. Related views are seg controls (Space: Scene | Entities; an entity: Semantics | Knowledge).
- **Editor follows the design.** MOD choices live only in MOD settings (MODs tab); the UI library tab adjusts only shared text and cue parameters; Input holds info selection and hands. No per-mod overrides, no pinned or fallback text.
- **Object-centric Dialogue has no heading**: the bubble shows only what the thing says.
- **The main page** (`index.html`):
  - Three sections, **Demo** (ModOS itself, the interactive system), **Gallery** (the recordings) and **Document** (Spatial vocabulary now; Memory, Walkthrough and others are added as entries of `DOCS`), switched by a fixed floating capsule control at the bottom; a Document with several parts gets a second capsule row for them.
  - No page header or explanation. Helvetica light, bold only for what matters most (names, the answer time, the active switch). No horizontal lines. Neutral greys only: no cyan in the page's own UI (cyan is the spatial UI's, seen in the recordings).
  - Gallery is grouped by MOD, with no built/spec split. A card shows only "Answered in <time>"; the opened player shows only the video.
  - The vocabulary has four categories as tabs at the top: **Cues** (Mark, Direction, Display), **Controls** (Adjust, Explore, Interactive), **Text** (the text forms) and **Assets** (Ambient Asset, Scene Asset: a MOD's own, not shared). Groups are laid out like a kanban board: one column per group (per MOD in Gallery), side by side, its cards stacked vertically.
- **Ask before** committing, pushing, or deleting anything the user made. Show results as screenshots or recordings, and ask the user to choose before large visual changes.

## What to do next

Follow the prioritized list in `context/docs/modos-system-design.md` §10.16. In short:
1. The rest of the placement module (§4.5): site allocator, `beside` clusters with occlusion checks.
2. Wayfinding: nearest door by route length.
3. Spec MODs.
4. Vision Pro port.
5. Real feeds and the tailoring test loop.

After each change: run the tests, re-record the affected clips, and update §10 of the design doc.
