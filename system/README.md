# ModOS system

The prototype of ModOS: an AI agent's answer in mixed reality becomes a spatial interface, composed at runtime from **MODs**, units of
knowledge and representation that people add to their environment ahead of time. Here it runs on recorded rooms in the browser (the web
editor) and on Apple Vision Pro (`visionos/`). The project's guide is `../AGENTS.md`; the spec is `../context/docs/modos-system-design.md`.

## Run

```sh
cd editor
npm ci
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
npm start                          # http://127.0.0.1:8766: opens the main page; its Demo is the editor
```

`npm start` serves the project's site from the repository: the main page (`/`: Demo, Gallery, Vocabulary, About), the editor
(`/system/editor/`, framed by the main page), the pipeline page (`/system/editor/pipeline.html`) and the Gallery's media
(`/media/gallery/`). Keys for the decision model, Gemini and speech to text go in `editor/agent-config.local.json` (copy
`agent-config.example.json`; never committed). The agent bridge (`editor/scripts/agent-bridge.mjs`) runs the ModOS pipeline for one
recording; the editor starts it when needed.

## Layout

```
editor/
  index.html, src/          the editor: the recorded camera (the user's view), the digital twin, the agent's answers drawn as spatial UI
  pipeline.html             every decision of a question, as a flow
  modos/                    the pipeline (pipeline.mjs), the foundational MODs (mods/*.json), prompts
  scripts/                  the server (server.py), the conversation store, the twin, the Gallery, scene setup
  spaces/<scene>/           a scene: its scan and layout (scan/semantic.json), its MODs and mock data (modos/), its recordings
                            (scenarios/<take>/: frames, depth, poses, conversations in agent/)
  demos/                    tools around the editor: npm run gallery (asks the Gallery's examples again), live-replay.mjs
  tests/
visionos/                   the Vision Pro app (see its README)
```

A **scene** is one place; its **scan** captures the room, its **layout** is labelled boxes, rooms, walls and openings over the scan, and
its **recordings** are Record3D takes of moments there, aligned to the scan. Scenes are built from raw exports (kept out of git, in
`editor/private/`) by commands: `scripts/spaces.py` (create, add-scan, add-recording, align), `scripts/zones.py`, `scripts/structure.py`
(in `.venv-mesh`, `requirements-mesh.txt`).

## Test

```sh
cd editor
npm test
```
