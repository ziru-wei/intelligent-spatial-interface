# Agents

This folder is the prototype of the ModOS project (one repo: the project root is `..`). Read `../AGENTS.md` first: how to run, the code map, the user's design decisions and the next steps. The spec is `../context/docs/modos-system-design.md`.

Quick facts:
- The code is in `editor/` (`modos/`, `scripts/`, `src/`).
- Run with `cd editor && npm start`: it opens the main page (`../index.html`), whose Demo is the editor (`/system/editor/`). Restart the server after editing Python.
- Test with `node --test tests/modos-pipeline.test.mjs` and `python3 -m unittest tests.test_modos tests.test_modos_twin tests.test_agent_store`.
- `editor/spaces/` (the twin, recordings and their conversations) is in git, except the home scene, the 3D models and most camera frames (`.gitignore`). `editor/agent-config.local.json` (keys) is git-ignored: never commit it.
- `npm test` runs every test.
