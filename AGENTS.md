# ModOS: Guide for Agents

This folder holds one research project, **ModOS: Exploring On-Demand Spatial Interfaces in Mixed Reality** (UIST '27). An AI agent's answer in mixed reality becomes a spatial interface. The interface is composed at runtime from **MODs**: reusable units of knowledge and representation that people add to their environment ahead of time. Read this file first, then the design doc.

```
modos/               one git repo (origin github.com/ziru-wei/intelligent-spatial-interface, public; branch modos-live-input, see Git)
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
npm start                                  # the system on http://127.0.0.1:8766: opens the main page (--no-open: not)
```

- **Pages.** The server serves the repository as the site, nothing else of it (`served` in `scripts/server.py`): `/` the main page (`index.html`), `/system/editor/` the editor (only inside the main page: the Demo and a Gallery example frame it; opened on its own, it goes to the main page with its query, except the example view's tool modes `ask=1` and `still=1`, used by `demos/gallery.mjs`), `/system/editor/pipeline.html` the pipeline page, `/context/gallery/` the Gallery's examples. A session is a path relative to the editor (`?session=./spaces/…`, the bridge's `--session`) or a URL's pathname (`/system/editor/spaces/…`).
- **Names.** `npm start` runs **modos-system** (the main page, the editor and their API, 8766), which starts **modos-speech** (the speech relay, 8767); the agent bridge is **modos-agent** (no port).
- **Agent bridge.** One bridge per recording session. Between questions it renews itself when its code (`scripts/`, `modos/`) changed. It runs the ModOS pipeline and calls the decision model (Jev) and Gemini.
  `node scripts/agent-bridge.mjs --url http://127.0.0.1:8766 --session ./spaces/atlas/scenarios/atlas_rec_5/session.json --config agent-config.local.json`
- **Credentials.** `agent-config.local.json` holds the keys and is git-ignored. Never print or commit it. Copy `agent-config.example.json` to start one. Speech to text reads `doubaoAsr` there: `apiKey` (Volcano Engine's new console) or `appKey` and `accessKey` (old console), and `resourceId` (default `volc.bigasr.sauc.duration`); optional `url`, `endWindowMs` (default 1200). The keys stay in the relay (`scripts/asr-relay.mjs`), never in the browser.
- **Space data.** `editor/spaces/` (the atlas twin, recordings and mock context) is in git, except its 3D models (`*.glb`: the scans, rooms and components) and the camera frames of recordings the Gallery does not use (only atlas_rec_1 to atlas_rec_5 keep theirs); depth maps, conversations and voice recordings are in it (`system/.gitignore`). The raw exports in `editor/private/` and `.hand-cache/` stay out. A clone needs the `.glb` files copied in to show the twin. Atlas mock data:
  - devices in `spaces/atlas/modos/entities.json`;
  - items in `spaces/atlas/modos/items.json` (a symlink to the tracked `modos/examples/atlas/items.json`: edit that one);
  - layout boxes in `spaces/atlas/scan/semantic.json` (atlas has one scan: `atlas-reassembled`; the Music-Brain flyer `kitchen-upper-fridge_0` is a thin box on the board);
  - LabInfo in `spaces/atlas/modos/mods/labinfo.json` (a symlink to the tracked `modos/examples/atlas/mods/labinfo.json`: edit that one).

  Back these up before experimenting.
- **Restart the server after editing Python.** `scripts/server.py` keeps `modos_registry.py`, `agent_store.py` and the other modules loaded. A stale registry rejects new MOD declarations, so questions fail with messages like "unknown UI floatingText".

## Git

- **Branch.** `modos-live-input` (Answer while typing and everything since), on origin under the same name; `modos` is the line before it.
- **Ask before** committing or pushing. Commits are split by who made the change:
  1. the code and docs;
  2. the Gallery's outputs (`context/gallery/`: stills, `examples.js`, `examples.json`; `system/editor/demos/gallery-examples.json`);
  3. the scene data (`system/editor/spaces/`).
- **Scene data in git** (`system/.gitignore`). In: everything in `spaces/`, including depth maps, conversations, decision records, voice recordings and placement logs. Out:
  - the 3D models (`*.glb`);
  - the camera frames of recordings the Gallery does not use (only atlas_rec_1 to atlas_rec_5 keep `frames/`; a recording newly used by the Gallery gets its own `!…/frames/` line);
  - `.hand-cache/`, logs, and `editor/private/`.
- **What adds scene data.** Opening the editor or asking questions writes to the space (conversations, `agent/placement-log/`): commit it with the scene data, not with code.
- **The repo is public.** Whatever is pushed, scene data included, is public. `agent-config.local.json` is never committed.
- **Push.** Code and Gallery commits go over HTTPS. A large commit (scene data, hundreds of MB) times out over HTTPS (HTTP 408), so push it over SSH:
  `git push git@github.com:ziru-wei/intelligent-spatial-interface.git modos-live-input`

## Test

```sh
cd system/editor
node --test tests/modos-pipeline.test.mjs                                    # pipeline with mocked Jev/Gemini (17 tests)
python3 -m unittest tests.test_modos tests.test_modos_twin tests.test_agent_store
npm test                                                                     # everything (needs .venv)
```

Answer while typing, measured: `node demos/live-replay.mjs <recording> --text "…"` (a new conversation, deleted unless `--keep`) or `--from <conversation>:<question>` (typed again in that conversation: with `--enter`, once answered it takes the old question's place; otherwise dropped; `--source <recording>` when that conversation is in another recording: then a new conversation) logs each revision's MOD scores and parts.

To see a result, record it:

```sh
npm run gallery -- [examples or MODs]   # e.g. `npm run gallery -- weather wayfinding`: asks them again as a queue; each new answer replaces its example
```

- **The Gallery is live, not recorded.** An example is answered questions of a conversation, tagged where they are (`gallery` = {name, mod} on each question; no copy is made), usually one; several asked one after another make one example under the first one's MOD (`scripts/gallery.py`). A conversation holding one shows ★ at the end of its name. `demos/gallery-examples.json` lists them (recording, `ask_at`, question; or `questions: [{ask_at, question}]`). In the editor, a timeline dot clicked shows × (delete) and ★ (add to the Gallery); shift-click picks a run of questions, and ★ adds them as one example (`POST /api/gallery/add`). `npm run gallery` asks them through the editor's own ask box (`demos/gallery.mjs`), each in a conversation of its own (tagged `gallery_example`) until answered; the editor sends a still of the camera view when the answer settles, and the new questions then take the example's place in its conversation (`gallery.replace`, as a Rerun takes its question's: `POST /api/agent/questions/replace`, which also sets the conversation's time to now; a failed example leaves the old one). After a change that affects some examples, queue those, not all. A change in how answers are drawn (placement, cues, text) needs no new answers: the editor draws them anew whenever an example is opened; only the stills are images, taken again with `npm run gallery -- --stills` (replays only, no model). Ask again (`npm run gallery`) only when what the answers are changes (pipeline, MODs, data, prompts). Opened in the main page, an example is the editor's example view (`?example=&conversation=`): the camera, the player and the pipeline, for playing only (its dots replay; no asking, deleting or adding). `npm run gallery` opens it with `ask=1` to ask through its ask box. Try the Demo (beside Close) opens the Demo on the example's recording at its moment (`?t=`). A question typed in Answer while typing goes, with ★, to the Gallery's category **Answer while typing**, with its revisions (`typed`), and `npm run gallery` types it again.
- `index.html` at the root is the main page, the page the system opens (`npm start` in `system/editor`, `http://127.0.0.1:8766/`). Demo frames the editor (`system/editor/`, atlas_rec_5; the page's own query, such as `?session=…&t=…`, is the Demo's); Gallery reads `context/gallery/examples.js`. Served statically (`python3 -m http.server` in `modos/`), Gallery and Vocabulary work, the Demo and the examples need the system.

## How ModOS works (code map)

Stages (design doc §6.1), in `editor/modos/pipeline.mjs`:
0. Rules decide which MODs are eligible (`mod-selection.mjs`).
1. Three Jev calls in order, each given what the one before decided (`themes.mjs`, `request.mjs`; design doc §12.32), for each new or changed sentence: call 1, its request type (information, action, stop_prev, none; none changes nothing); call 2, grounding, in one call or two by a switch (`GROUNDING.calls`, the tradeoff in `themes.mjs`; design doc §12.33): an earlier theme, a sentence just said, or new; how it goes on (asks more, adds a detail, corrects one); what in the world it refers to (its context anchor: what a new theme is about, and it moves an earlier theme to another thing looked at or place); which other earlier themes it uses; for information, yes/no; rules place it in its theme (ThemeRouter, `themes.mjs`; a theme is a need the user speaks of, kept by the conversation, cooled after 3 questions or 2 minutes; it keeps what it is about, the thing looked at and the items found for it, `grounding.mjs`) and set the focus; call 3, the MODs each theme whose words changed needs, judged once on all its words. The themes of the question are its questions from there on; the focus (what is being said now) is a fact on every part. Each decision's code id is its name, as on the pipeline page: `request_type`, `earlier_or_new`, `continuation`, `context_anchor`, `also_uses`, `answer_form`, `mod_need` (Jev question ids `<name>_s<i>`, `mod_need_<mod>__t<id>`; stages `modos_request_type`, `modos_grounding`, `modos_mod_need`; the decision record uses the same names). Their words are in `modos/prompts.json` (filled in by `modos/prompts.mjs`), edited on the pipeline page: double-click a decision for its peek; an edit keeps each placeholder (`scripts/modos_prompts.py`).
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
- `src/spatial-ui/cues.mjs`: the library (cues, message parts). `src/spatial-ui/kit.mjs`: labels and older panel components. `src/spatial-ui/cue-set.mjs`: every renderer's cues kept by key and updated in place (`set`) or made again alone.
- `src/ui-settings.mjs`: what is adjusted outside MODs (UI library text and cue parameters, replay); `modSetting` reads a part's MOD settings. Side tabs: Space (recording on top, then the entity tree: geometry, semantics, knowledge), Agent, Input, MODs, Response.
- `src/attention.mjs`: how parts look by the user's focus (background: fainter, greyer), applied to any renderer's objects.
- `src/pipeline-view.mjs`: the editor's pipeline, the results of a question's run (Request type, Theme grounding, MODs shown, Text response, Fill · write, Shown), with a button to `pipeline.html`: every decision of a question as a flow, a question chooser, live (design doc §12.34). Questions are named q-MMDD-N (`agent_store.py` `_label`). `src/app.mjs` wires everything.

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
    - A recipient not found among the contacts (a name misheard) still shows the message, with nobody chosen: the user picks, and Send waits.
    - Picking rules before scores: a person the request names is a recipient; "this / that / it" while pointing is the thing pointed at.
    - No tether lines and no capture flash: the thing that goes with a message is marked with the library's Mark (Corner Brackets on content, else Breathing Box); the photo about to be sent is the AR Photo.
    - Status Pulse says the state from the data ("In use"), never the thing's name; with no state in the data it is the dot alone.
- **Directions.** Arrow Ahead when the target is in the same room but out of view. Floor Path when the target is in another room. Never both.
- **Guidance must be seen.** When the target is in another room and none of its Floor Path is in view (`path.in_view`), Arrow Ahead points along the way, named for the target; it goes once the path is in view.
- **Two arrows, both library cues.** Arrow Ahead / Floor Path lead the user somewhere. Text Arrow links text to the thing it is about (bright cyan polyline, declared `textArrow when text.apart`). No hand-made arrows.
- **Communication.** Reply to the user in a Chinese-English mix: Chinese sentences with English technical terms.
- **Places.** A place is highlighted only by its floor (or its doorway), never a box.
- **View stack.** What came later stands lower (nearest the text), what came earlier above it. Its base is steady while an answer stands: it only rises (the text grew past it), never falls back. Its parts have one fixed size (`STACK.scale`); past the view's top, the stack is lowered until it fits (`keepInView`), never shrunk or cut off. A message's Text Input has a fixed height (six lines): its text changing moves nothing else. UI not attached to a real thing in front of the user (no physical thing, like Weather's controls or a message with nothing attached; or a device or attached thing out of view when asked) is fixed in the user's view, centred, above the text answer (above the question caption when the text is not Floating), never overlapping, following the camera; once there for an answer, it stays.
- **Text forms.**
  - Floating Text by default. Embedded Text only when the Response tab's Write on surfaces is on (off by default) and the surface score is ≥ 0.5.
  - Floating Text is fixed to the camera: centred (its ink), the bottom of its letters just above the caption's band (room for two caption lines, kept whether or not a caption shows, so nothing above moves as a question's words come or go), leaning back a little toward the eye, in the widest line length that fits the view; placed again each frame, so it re-fits when the stream completes. A heading sits close to its text.
  - Object-centric Dialogue only when a thing is clearly pointed at and asked in the second person ("Can I eat you?"). The rule alone decides. It is a form of the text slot (`dialogue` in its `ui`): a speech bubble on the thing (`src/spatial-ui/dialogue.mjs`), no motion, no part of its own. The Response tab's Anchor dialogue bubble switch keeps it above the thing, turned to the user; off, it moves to fit the view.
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
- **One data path for updates.** A part is one per kind and MOD per question (`part_key`); posted again it keeps its id with new data (`updated_at`; earlier versions kept for replays). Every renderer reconciles its cues by key through the cue set; no renderer rebuilds its whole scene. The pipeline recomputes a piece only when what it reads changed (a MOD's own questions; a selector's evidence).
- **Generalize, never overfit.** No small feature made for one MOD or one scene (hand dismissal, per-MOD text switches, per-answer-type knobs). A feature that is not used is removed in the code, the data format and the tests, not only hidden in the UI.
- **Editor UI.** The recorded camera's column is the **User's view**, with no title: the view at its top, a grip under the view's middle (a short round-ended line, shown on hover; dragged, it scales the view down, centred; double-click resets; in the full window too), the words said or typed (ask box, or the words row: Helvetica 17 px, no frame or background) right under it, and the player along the column's bottom (a keyboard button that opens the typing row, closed by default: the ask box and Answer while typing; the words said show either way; then play and speed, borderless, timeline, time, speed, then the view's Full window and menu buttons; the menu opens upward). Where the user is and looks is a small tag over the Digital Twin's top-right corner, shown as its display options say (Recording › Where the user is, on by default). Input › Caption shows or hides the user's question as a caption in the view (off: no band kept for it). The 3D view is the **Digital Twin**, narrower than the recorded camera by default. The agent log (Log | Pipeline) opens in Pipeline view, parted from what is above by a thin line, under the Digital Twin by default; its grip drags it under the recorded camera or back (remembered); the line above it is dragged up or down to size what is above it in that column (the Digital Twin's height, or the camera's size at its aspect; double-click resets). A handle between the recorded camera and the Digital Twin sets their widths; the line between the Digital Twin and the side panel is a handle too (side panel at least 260 px). The editor fills the window with no page scroll: vertical lines run its whole height, horizontal lines reach the vertical lines on both sides, the agent log scrolls inside its column. The side panel is not a floating card: a thin line parts it from the views, and its tabs stick to its top with no frame. Buttons are of two kinds: in the side panel, no border, 4 px corners, a quiet fill (icon rows and buttons with words alike); at a view's head, icon-only circles with no fill and a faint border. Toggles are dim when off and pale green when on; sliders are a thin neutral track with a small handle; a timeline line (typed or spoken question) shows no tooltip. Every horizontal line in the side panel (its tabs, its sections) reaches the vertical line on its left and the window's right edge. Explanations sit behind a hoverable "?" (`.help[data-tip]`), never as exposed paragraphs. Names say what a control does. Related views are seg controls (Space: Scene | Entities; an entity: Semantics | Knowledge).
- **The ask box** is the one modern, minimal place in the editor: a capsule with the field and the microphone inside, and Answer while typing beside it on its right, of one quiet weight; no Ask button (Enter asks a typed question, held Space a spoken one); on, the mode button is a soft translucent cyan, and a pale, whitish halo breathes in from the edge of the whole left column (the User's view: camera, timeline, ask box), glowing inward (also while a typed or spoken question replays), flowing unevenly (three layers of shadows drifting at uneven times), the flow more visible than the breathing, light and low in saturation. The recorded camera has no dark border.
- **Full window, not full screen.** The recorded camera's full button fills the browser window: only the camera, its timeline and the ask box; no title, no log, no Digital Twin or side panel, and the main page's bottom switch steps aside (a message to the page). The one button left, to leave it, sits alone in the top right corner, over the window; Esc leaves too. A thin translucent pale cyan rounded frame runs round the whole window meanwhile; the where tag stays small, left of that button.
- **Tailoring.** People tailor a MOD's description and examples (how it is chosen), representation and settings. Where it applies and what it knows are the author's, never tailored.
- **Editor follows the design.** MOD choices live only in MOD settings (MODs tab); the Response tab (was UI library) adjusts only how answer text is sized, written and placed; Input holds info selection and hands. No per-mod overrides, no pinned or fallback text.
- **Headings.** Whether an answer is under Yes, No or Not sure is the decision model's, from the meaning (`yesno` per sentence in the request call, `modos/request.mjs`): the sentence the text answers is a yes/no question. No rule on wording or punctuation (speech to text drops and misplaces question marks). Other answers keep the model's short title. Yes has a green check, No a red cross, Not sure nothing (by rule from the heading; drawn on its own layer so the text's tint does not change the colour).
- **The text is a slot.** It answers only the newest sentence that wants to be told something, briefly (a short heading and one sentence); a request only to do something gets none. A revision that changes what it answers but writes nothing new leaves it dimmed (never blinks out); a new text crossfades in place (0.3 s); at the question's end a text with nothing left to answer is withdrawn (design doc §12.20). While the language model writes it (begun anew, or streaming), a white ball breathes at its left (`writing` {from, to} on the text part; §12.30).
- **Themes.** A theme is a need or topic (the identity; its MOD may change: that is a replace), kept across the conversation's questions; it ends when the user says so or by cooling. Attention is at theme level (focus or background, a fact on parts). Background parts, and the text when its theme is background, are drawn fainter, greyer and (on the view stack) smaller, eased; a theme that has just come takes the focus at once (`src/attention.mjs`: effects as a table, applied around each draw without the renderers knowing; new representations are new effects there). No cap on sentences; only new or changed sentences are routed (design doc §12.21).
- **A MOD answers its theme being spoken of.** Its selectors read its theme in focus (else the one said last), its other themes as context (`said_before`), never the whole utterance; with one part per MOD, it shows the theme the user is on ("next week", then "my umbrella today": today). A theme the user stopped leaves the question (design doc §12.29).
- **Playback runs at 0.5× by default.**
- **Playback opens at the answer's moment** (its focus, a moment chosen with the data in the fill, not a period: the first rain from now on when asked whether to bring an umbrella), holds it 3 s, then plays on. Its button is the icon alone.
- **Bringing it vs. finding it.** "Should I / am I supposed to bring it?" is Weather's (advice); FindMy only when the user asks where it is or says they will bring it. Decided by the MODs' descriptions and examples, not by a rule.
- **Device tasks report progress, not time.** A task is done of total (a print job's pages) and whose it is; no "x min left".
- **Clip questions sound like people:** situated, casual, sometimes broken ("wait, where did I put my headphones"). Never ask what can simply be seen (whether the printer is printing); ask what can't (how far along, whose job).
- **Object-centric Dialogue has no heading**: the bubble shows only what the thing says.
- **The main page** (`index.html`):
  - Four sections, **Demo** (ModOS itself: the editor filling the whole window, dark, not a framed embed), **Gallery** (the recordings), **Vocabulary** and **About** (Memory, Decisions, Walkthrough: tabs left empty until written; a new one is an entry of `SUBS.about`), switched by a fixed, translucent (blurred) floating capsule control at the bottom; on the Demo it is a small ball in the bottom-right corner that opens leftward under the pointer (smooth moves), so it covers nothing of ModOS. Vocabulary and About have tabs at their top; the active tab is bold with a thin underline.
  - No page header or explanation. Helvetica light, bold only for what matters most (names, the answer time, the active switch). No horizontal lines. Light theme for Gallery, Vocabulary, About and the bottom switch; Demo is dark. Neutral greys only, except a muted deep cyan for the Gallery question under the pointer (bright cyan is the spatial UI's, seen in the recordings).
  - Gallery is a masonry (waterfall) of MOD blocks, with no built/spec split. A MOD block is a Lucide icon and its name, with a thin line down its left joining it to its clips. A clip is its question (light, in quotes) above the camera view only: the recording's left 3/4, never the pipeline beside it. No time.
  - Quiet until looked at: every MOD block is dim, the one under the pointer brighter, and the clip under the pointer fully opaque and playing (muted). Opened, a clip plays the whole recording, pipeline included (only the cards hide it).
  - A Vocabulary tile turns its view when dragged, in place; a press without moving opens it.
  - The Vocabulary is live, never pictures: each part is a 3D scene of the library's own part in an example room with example data (`system/editor/src/vocabulary.mjs`); clicked, it opens to walk around and use. Served with the page (the system, or `python3 -m http.server`).
  - The vocabulary has three categories as tabs at the top: **Cues**, **Text** (the text forms) and **Assets** (Ambient Asset, Scene Asset: a MOD's own, not shared). Under Cues, four groups with large headings: **Mark** (highlighting a physical entity), **Guidance** (leading to somewhere), **Visualization** (visualizing information) and **Controls** (its components in one row). Each group heading has its Lucide icon (Mark scan, Guidance navigation, Visualization gauge, Controls sliders-horizontal). Headings get smaller with each level so the levels never mix. Text and Assets show their parts larger.
- **Every mark is declared.** An info answer's thing gets only the Mark its MOD declares (WorldInfo: Corner Brackets on content, else Breathing Box), drawn by the library; no code marks things on its own.
- **Dates as people say them.** Day options given to the model carry the weekday and the distance from today; a model does not work out weekdays from dates.
- **Controls own their presses.** The click after a press a control took never reaches the editor (it would pick the thing behind and replay). Marks are never clickable. An open dropdown draws over everything below it.
- **Sessions (conversations) are named** for their first question's first words and their time ("What's the weather… · 11-24 17:12"), kept up to date by the store (`auto_name` in `scripts/agent_store.py`), until the user renames one (`named`: never overwritten). No copies: a Gallery example is tagged in place; a question asked again (Rerun, `npm run gallery`, `live-replay --from`) replaces its question in place once answered and sets the conversation's time to now.
- **Ask before** committing, pushing, or deleting anything the user made. Show results as screenshots or recordings, and ask the user to choose before large visual changes.

- **The pipeline's raw data is its decision record.** Each run logs one (`modos/decisions.mjs`, trace step `decisions`): sentences → themes → MODs → fills → parts and text, each with what triggered it. Views (the pipeline view, the words row) are shells that read only it; a new view never changes what is recorded. The full view of it is the pipeline page (`system/editor/pipeline.html`).

## Answer while typing (branch `modos-live-input`)

The button beside the ask box: the space answers while the question is typed (design doc §12). `src/live-input.mjs` sends a revision at each finished word and on a pause in the user's own rhythm (no model, no punctuation); the store keeps a `drafting` question with its `revisions`; the bridge answers the latest revision and drops stale work (409); `runModos({live})` reconciles (a draft is answered again at most every 1.6 s, `RECOMPUTE_S`): a MOD shows once clear (.5 twice or .85 once) and stays above .35, parts are replaced by key (kind and MOD) or withdrawn, text is written on a pause and on Enter, and a device change is only previewed until Enter.
- No text while what it answers is unclear or a fact is missing (a part that found nothing); it is written the first time at once, then on a pause and at the end; meanwhile a text that no longer answers is dimmed, not withdrawn.
- The heading answers the newest sentence that wants to be told something: "…weekend? should I bring my umbrella?" gets Yes, No or Not sure.
- **Speech to text.** Two passes (`bigmodel_async`, `enable_nonstream`): words stream as said, and each sentence is recognized again once said, then final. A sentence ends after 1.2 s of silence, so a hesitation does not cut it. No hotwords; `language` is not set (it did not keep the text English). The microphone in the ask box streams to Doubao's recognition through `scripts/asr-relay.mjs` (Node, 127.0.0.1:8767, started by the server, `POST /api/asr/relay`; protocol in `scripts/doubao-asr.mjs`; browser side `src/speech-input.mjs`: 16 kHz PCM in 200 ms packets, text back as server-sent events). The text fills the box as it grows. The two buttons combine: the microphone alone only writes into the box (nothing is sent until the user asks); ⚡ alone answers while typing; both answer while speaking (a revision whenever the text grows, at most every 300 ms, a pause when a sentence becomes final), and pressing the microphone again asks it.
- **A typed question replays as it happened**, not held: its line plays from its head on its revisions' clock (video moving as it moved, caption as said by then, parts from when they were made until they left the surface, kept as `withdrawn`), on past the video's end until its last part and reading time (`src/typed-replay.mjs`). Scrubbed or paused inside the line shows that moment.
- **Hold Space to speak.** A tap plays or pauses; held, Space speaks a question with Answer while typing on. The microphone stays open while the editor is in view with a 0.6 s pre-roll, and hears on 0.5 s after Space is let go, so nothing is cut (a tap is dropped). Held 250 ms, the ask row becomes the words as said, marked where ModOS computed again (`src/recompute-marks.mjs`, from the decision record, by what is seen: a MOD's part shown first, then a new line; a part taken away; a part of a MOD that stays got new data; the text or a draft written again), its words shaded by theme (colour only), a new line where the theme changes. Let go, the question is finished there with its recording: no send step, the video goes on; the row is the empty ask box again. In a text field Space types.
- **A spoken question keeps its voice**: its recording (`agent/audio/<id>.wav`, in the space's data) and when it began against the question (`q.audio.at`). Its replay runs over the whole recording (from its first sound, before the first revision, to its last) on one clock, real time: the video where it was (from Space down through the revisions to Space up, then on at its speed then: `q.audio.video` {t, at, t_end, at_end, rate}), the voice in step (fetched whole and played from memory: the server answers no byte ranges, so a URL cannot be seeked), the ask row showing the words as they were; no reading pause after it. Its line on the timeline runs from Space down to Space up. Picked on the timeline, a typed or spoken question's line offers Replay (as it happened) and, for a spoken one, Rerun: its recording through speech recognition and the pipeline as they are now, the new question in its place (the old one deleted once the new one is answered; it stays if nothing is recognized).
- Leaving the mode (its icon) with a question typed asks it. A question typed while the video played is a line on the timeline (from where typing began to where it was asked), picked like a dot: × deletes it, ★ adds it to the Gallery's Answer while typing.

## What to do next

Immediate: the pipeline view, drawn only from the decision record, as the pipeline page (`system/editor/pipeline.html`): each decision with all its options and their likelihood, the one taken lit; calls and rules in order; what each MOD fills in framed; everything shown on the last level. Stage 1 was rebuilt for it (done 2026-11-24, design doc §12.32). Then the speech to text punctuation (design doc §12.7).

Also immediate: the plan in `context/docs/modos-system-design.md` §11, after A2UI's architecture: keep **structure and data apart** (surface messages, a data model bound by path, cues that update in place) and **render progressively** (emit each piece as soon as the pipeline knows it). Read the A2UI spec and web core again before each step.

Then the prioritized list in §10.31:
1. The rest of the placement module (§4.5): site allocator, `beside` clusters with occlusion checks.
2. Wayfinding: nearest door by route length.
3. Spec MODs.
4. Vision Pro: every update since the web rebuild (later).
5. Real feeds and the tailoring test loop.
6. User actions back to the agent, after A2UI's `action` events (later).

After each change: run the tests, re-record the affected clips, and update §10 of the design doc.
