# ModOS: Guide for Agents

This folder holds one research project, **ModOS: Exploring On-Demand Spatial Interfaces in Mixed Reality** (UIST '27). An AI agent's answer in mixed reality becomes a spatial interface. The interface is composed at runtime from **MODs**: reusable units of knowledge and representation that people add to their environment ahead of time. Read this file first, then the design doc.

```
modos/               one git repo (origin github.com/ziru-wei/intelligent-spatial-interface, branch modos)
  AGENTS.md          this guide
  README.md          the short version for people
  index.html         the project's main page: Demo (ModOS live), Gallery (the recordings), Vocabulary, About (Memory, Decisions, Walkthrough: to be written)
  system/            the prototype
    editor/          the web editor and ModOS pipeline (everything below is under here)
    visionos/        the Vision Pro app (not yet updated to the spatial UI library)
  context/           design doc, study plans, paper draft, recordings
    docs/modos-system-design.md   THE spec: architecture, decisions, library, MOD format, status (§10)
    docs/system-changes.md, fs1-plan.md, stimuli-dryrun.md
    write-up/draft.md              paper draft
    gallery/                       the Gallery's examples (examples.json, examples.js) and a still per example (scripts/gallery.py writes them)
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
  - layout boxes in `spaces/atlas/scan/semantic.json` (atlas has one scan: `atlas-reassembled`; the Music-Brain flyer `kitchen-upper-fridge_0` is a thin box on the board);
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
npm run gallery -- [examples or MODs]   # e.g. `npm run gallery -- weather wayfinding`: asks them again as a queue; each new answer replaces its example
```

- **The Gallery is live, not recorded.** An example is a conversation of a recording's session with a hidden `gallery_example` = {name, mod}; its example is the conversation's answered questions, usually one; several asked one after another make one example under the first one's MOD (`scripts/gallery.py`). `demos/gallery-examples.json` lists them (recording, `ask_at`, question; or `questions: [{ask_at, question}]`). In the editor, a timeline dot clicked shows × (delete) and ★ (add to the Gallery); shift-click picks a run of questions, and ★ adds them as one example (`POST /api/gallery/add`). `npm run gallery` asks them through the editor's own ask box (`demos/gallery.mjs`), the editor sends a still of the camera view when the answer settles, and the older conversations of that example are deleted. After a change that affects some examples, queue those, not all. A change in how answers are drawn (placement, cues, text) needs no new answers: the editor draws them anew whenever an example is opened; only the stills are images, taken again with `npm run gallery -- --stills` (replays only, no model). Ask again (`npm run gallery`) only when what the answers are changes (pipeline, MODs, data, prompts). Opened in the main page, an example is the editor's example view (`?example=&conversation=`): the camera, player, ask box (its scene's bridge starts by itself, `POST /api/agent/bridge`), Delete, and the pipeline. Asking there replaces the example too.
- `index.html` at the root is the main page. Demo frames the running editor (`http://127.0.0.1:8766`, atlas_rec_5; start it with `npm start` in `system/editor`); Gallery reads `context/gallery/examples.js`. Serve the root to view it (`python3 -m http.server` in `modos/`) or open the file.

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
- `src/placement.mjs`: answer text; Embedded vs Floating Text from the declaration (`surface.score`). `src/cluster-placement.mjs`: the view stack (UI on no real thing in view: Weather's controls, a device's controls when it was out of view).
- `src/vocabulary.mjs`: the main page's Vocabulary, live: each library part in an example room with example data; tiles drawn by one canvas, opened to use. `src/current-mods.mjs`: MOD declarations and settings read at draw time.
- `src/device-cues.mjs`: a device's Inputs and Outputs as cues, which can be pressed and dragged.
- `src/action-cues.mjs`: the Send MOD's message: a Choice of recipient, Text Input, AR Photo, Send, and the attached thing marked.
- `src/weather-preview.mjs`: Date Picker and Playback for Weather. `src/weather-scene.mjs` is Weather's ambient effect.
- `src/spatial-ui/cues.mjs`: the library (cues, message parts). `src/spatial-ui/kit.mjs`: labels and older panel components.
- `src/ui-settings.mjs`: what is adjusted outside MODs (UI library text and cue parameters, replay); `modSetting` reads a part's MOD settings. Side tabs: Space (recording on top, then the entity tree: geometry, semantics, knowledge), Agent, Input, MODs, UI library.
- `src/pipeline-view.mjs`: the pipeline visualization shown in recordings. `src/app.mjs` wires everything.

MODs live in `editor/modos/mods/*.json` (12 foundational: 7 built, 5 spec). They are validated by `scripts/modos_registry.py`, which also handles overrides, forks, variants and `extends`. Space-owner MODs live in `spaces/<space>/modos/mods/`.

## Decisions to keep (from the user)

- **The MOD declares its UI.** Each slot lists `fixed` parts and `flexible` parts with a `when` rule over computed facts. No MOD has its own controls or text styles; everything comes from the shared library. MOD-specific parts are only ambient effects and assets. The decision model chooses MODs and fills slots; it does not choose UI.
- **Library = cues + controls + text forms.** Controls (a group of cues, beside Mark, Guidance, Visualization) are grouped by component: Slider, Choice, Icon Button, Text Button, Text Input, AR Photo, Date Picker, Playback. When a value is sent (on change, on Send, never) is how a MOD uses a control, not a kind of control.
  - Describe every part by when to use it and what for, not by what it is.
  - Similar parts must state how they differ:
    - Breathing Box draws attention to a thing.
    - Corner Brackets mark things whose content must stay visible.
    - Footprint Ring marks the thing being operated.
    - Gauge is read-only; Slider is for changing a value.
    - Progress Rail is a task moving through time; Gauge is a level.
    - Choice is one control for picking one of several options: a few short ones in a row of capsules, more or longer ones in a dropdown (a TV's input, Send's recipient). No Edge Tabs or Contact Chip.
    - A device's Slider or Choice sends its change once the user makes it (a slider when let go); a message's Choice and Text Input send on Send; Date Picker and Playback send nothing.
    - Choice is single or multi-select from the data it shows: a pick-many selection (Send's recipients, `pick-many` in the MOD) makes it multi-select ("Alice Chen +1 ▾"). Whether several can be chosen is the MOD's selector kind, not the control's.
    - Text never restates a value the user can still change in a control (it would go stale): a draft names, greets or addresses no recipient, in its title or body; the context for the draft leaves them out.
    - The AR Photo is drawn above everything around it, and it is the frame as drawn: the mark on the thing is in the photo.
    - Arrow Ahead names what it points at, at its tip, upright.
    - Picking rules before scores: a person the request names is a recipient; "this / that / it" while pointing is the thing pointed at.
    - No tether lines and no capture flash: the thing that goes with a message is marked with the library's Mark (Corner Brackets on content, else Breathing Box); the photo about to be sent is the AR Photo.
    - Status Pulse says the state from the data ("In use"), never the thing's name; with no state in the data it is the dot alone.
- **Directions.** Arrow Ahead when the target is in the same room but out of view. Floor Path when the target is in another room. Never both.
- **Two arrows, both library cues.** Arrow Ahead / Floor Path lead the user somewhere. Text Arrow links text to the thing it is about (bright cyan polyline, declared `textArrow when text.apart`). No hand-made arrows.
- **Communication.** Reply to the user in a Chinese-English mix: Chinese sentences with English technical terms.
- **Places.** A place is highlighted only by its floor (or its doorway), never a box.
- **View stack.** UI not attached to a real thing in front of the user (no physical thing, like Weather's controls; or a device out of view when asked) is fixed in the user's view, centred, above the text answer (above the question caption when the text is not Floating), never overlapping, following the camera; once there for an answer, it stays.
- **Text forms.**
  - Embedded Text when the surface score is ≥ 0.5, else Floating Text.
  - Floating Text is fixed to the camera: centred (its ink), the bottom of its letters just above the question caption's actual top (never covering it), lower once the caption is gone, leaning back a little toward the eye, in the widest line length that fits the view; placed again each frame, so it re-fits when the stream completes. A heading sits close to its text.
  - Object-centric Dialogue only when a thing is clearly pointed at and asked in the second person ("Can I eat you?"). The rule alone decides. It is a form of the text slot (`dialogue` in its `ui`): a speech bubble on the thing (`src/spatial-ui/dialogue.mjs`), no motion, no part of its own. The UI library's Anchor dialogue bubble switch keeps it above the thing, turned to the user; off, it moves to fit the view.
- **Look.**
  - Theme is bright cyan `#3ff0ff`. No yellow theme; amber and red are only state colors.
  - Highlights are translucent cyan and breathe.
  - Every clickable is a rounded capsule. Text on cyan has no shadow or outline. Text faces the user and is flat (Floating Text leans back a little).
- **Buttons.** Icon + word from presets (`modos/buttons.json`). A system-written text-only button is used only when no preset fits.
- **No boilerplate UI text.** Text must come from data or a decision ("waiting for you" and "Nothing is sent until…" were removed).
- **Pinned Tags.** Leaders share one anchor point on the thing's right side.
- **Retrieval.** Choose MODs first from the request's questions and what they are about, then fetch context info per MOD. No slow LLM step in retrieval. Call it "context info", not "memory".
- **Writing.**
  - The system is ModOS; the unit is a MOD. Users *tailor* MODs; they do not author them.
  - Docs: sections numbered x / x.x, English titles, no horizontal rules, no em dashes in prose.
  - The user writes in Chinese and English; replies to the user mix Chinese and English (Chinese sentences, English technical terms).
- **Generalize, never overfit.** No small feature made for one MOD or one scene (hand dismissal, per-MOD text switches, per-answer-type knobs). A feature that is not used is removed in the code, the data format and the tests, not only hidden in the UI.
- **Editor UI.** The agent log opens in Pipeline view. A handle between the recorded camera and the 3D scene sets their widths. The side panel is not a floating card: a thin line parts it from the views, and its tabs stick to its top with no frame. Explanations sit behind a hoverable "?" (`.help[data-tip]`), never as exposed paragraphs. Names say what a control does. Related views are seg controls (Space: Scene | Entities; an entity: Semantics | Knowledge).
- **Tailoring.** People tailor a MOD's description and examples (how it is chosen), representation and settings. Where it applies and what it knows are the author's, never tailored.
- **Editor follows the design.** MOD choices live only in MOD settings (MODs tab); the UI library tab adjusts only shared text and cue parameters; Input holds info selection and hands. No per-mod overrides, no pinned or fallback text.
- **Headings.** A yes/no question (opening with an auxiliary verb, no "or" choice) is answered under the heading Yes, No or Not sure, by rule (`isYesNo`, `modos/text.mjs`); other answers keep the model's short title.
- **Playback opens at the answer's moment** (its focus, chosen with the data in the fill: the rain when asked whether it rains), holds it 3 s, then plays on. Its button is the icon alone.
- **Device tasks report progress, not time.** A task is done of total (a print job's pages) and whose it is; no "x min left".
- **Clip questions sound like people:** situated, casual, sometimes broken ("wait, where did I put my headphones"). Never ask what can simply be seen (whether the printer is printing); ask what can't (how far along, whose job).
- **Object-centric Dialogue has no heading**: the bubble shows only what the thing says.
- **The main page** (`index.html`):
  - Four sections, **Demo** (ModOS itself: the editor filling the whole window, dark, not a framed embed), **Gallery** (the recordings), **Vocabulary** and **About** (Memory, Decisions, Walkthrough: tabs left empty until written; a new one is an entry of `SUBS.about`), switched by a fixed, nearly opaque floating capsule control at the bottom. Vocabulary and About have tabs at their top; the active tab is bold with a thin underline.
  - No page header or explanation. Helvetica light, bold only for what matters most (names, the answer time, the active switch). No horizontal lines. Light theme for Gallery, Vocabulary, About and the bottom switch; Demo is dark. Neutral greys only, except a muted deep cyan for the Gallery question under the pointer (bright cyan is the spatial UI's, seen in the recordings).
  - Gallery is a masonry (waterfall) of MOD blocks, with no built/spec split. A MOD block is a Lucide icon and its name, with a thin line down its left joining it to its clips. A clip is its question (light, in quotes) above the camera view only: the recording's left 3/4, never the pipeline beside it. No time.
  - Quiet until looked at: every MOD block is dim, the one under the pointer brighter, and the clip under the pointer fully opaque and playing (muted). Opened, a clip plays the whole recording, pipeline included (only the cards hide it).
  - A Vocabulary tile turns its view when dragged, in place; a press without moving opens it.
  - The Vocabulary is live, never pictures: each part is a 3D scene of the library's own part in an example room with example data (`system/editor/src/vocabulary.mjs`); clicked, it opens to walk around and use. Serve the root (`python3 -m http.server`) to see it.
  - The vocabulary has three categories as tabs at the top: **Cues**, **Text** (the text forms) and **Assets** (Ambient Asset, Scene Asset: a MOD's own, not shared). Under Cues, four groups with large headings: **Mark** (highlighting a physical entity), **Guidance** (leading to somewhere), **Visualization** (visualizing information) and **Controls** (its components in one row). Each group heading has its Lucide icon (Mark scan, Guidance navigation, Visualization gauge, Controls sliders-horizontal). Headings get smaller with each level so the levels never mix. Text and Assets show their parts larger.
- **Every mark is declared.** An info answer's thing gets only the Mark its MOD declares (WorldInfo: Corner Brackets on content, else Breathing Box), drawn by the library; no code marks things on its own.
- **Dates as people say them.** Day options given to the model carry the weekday and the distance from today; a model does not work out weekdays from dates.
- **Controls own their presses.** The click after a press a control took never reaches the editor (it would pick the thing behind and replay). Marks are never clickable. An open dropdown draws over everything below it.
- **Ask before** committing, pushing, or deleting anything the user made. Show results as screenshots or recordings, and ask the user to choose before large visual changes.

## What to do next

Immediate: the plan in `context/docs/modos-system-design.md` §11, after A2UI's architecture: keep **structure and data apart** (surface messages, a data model bound by path, cues that update in place) and **render progressively** (emit each piece as soon as the pipeline knows it). Read the A2UI spec and web core again before each step.

Then the prioritized list in §10.25:
1. The rest of the placement module (§4.5): site allocator, `beside` clusters with occlusion checks.
2. Wayfinding: nearest door by route length.
3. Spec MODs.
4. Vision Pro: every update since the web rebuild (later).
5. Real feeds and the tailoring test loop.
6. User actions back to the agent, after A2UI's `action` events (later).

After each change: run the tests, re-record the affected clips, and update §10 of the design doc.
