# Agents

This folder is the prototype of the ModOS project (one repo: the project root is `..`). Read `../AGENTS.md` first: how to run, the code map, the user's design decisions and the next steps. The spec is `../context/docs/modos-system-design.md`.

Quick facts:
- The code is in `editor/` (`modos/`, `scripts/`, `src/`).
- Run with `cd editor && npm start`: it opens the main page (`../index.html`), whose Demo is the editor (`/system/editor/`). Restart the server after editing Python.
- Test with `node --test tests/modos-pipeline.test.mjs` and `python3 -m unittest tests.test_modos tests.test_modos_twin tests.test_agent_store`.
- `editor/spaces/` (the twin and recordings) and `editor/agent-config.local.json` (keys) are local and git-ignored. Never commit them.
