# Spelling-lessons

Local-first spelling and TTS practice app for a kid-friendly chat-style workflow.

## Run it

```bash
node server.js
```

Then open `http://localhost:3000`.

## Current MVP

- Chat-style input area
- Local speech playback through the browser's built-in speech engine
- Browser-run grammar checking with `Xenova/grammar-synthesis-small` through Transformers.js
- Graceful fallback to the original rule-based checker if the model is unavailable
- Phrase scoring with three levels:
  - Green: strong spelling and sentence form
  - Yellow: understandable, but grammar or spelling needs cleanup
  - Red: incorrect or incomplete, but still spoken aloud
- Entry history with replay, copy-back-to-editor, and two-step delete
- Placeholder mode switch for future conversation mode
- Visible checker status in the UI so you can see whether the grammar model is loading, ready, or in fallback mode

## Local-first notes

- TTS is fully local and uses `speechSynthesis`.
- Grammar checking runs in the browser after the model is loaded.
- The first successful model load downloads the model assets and stores them in browser cache.
- After that, repeat use is local-first unless the cache is cleared.
- If the app starts without a cached model and the model cannot be fetched, it automatically falls back to the heuristic checker.

## Main files

- `/server.js`
- `/public/index.html`
- `/public/styles.css`
- `/public/app.js`
- `/PROJECT_NOTES.md`

## Best local TTS engines to consider next

### 1. Piper

Best choice if you want simple, fully local, lightweight TTS with fast startup.

- Runs well on Mac and Windows
- Small footprint and easy to package beside a local app
- Voice quality is decent, though usually more synthetic than premium neural voices
- Good fit if you want the "robotic but pleasant" style

### 2. Kokoro ONNX / Kokoro FastAPI wrappers

Best choice if you want noticeably better voice quality while staying local.

- Works well on CPU on a Mac and can take advantage of the RTX 3060 on Windows
- Higher quality than Piper in many setups
- Slightly more setup than Piper
- Good next backend if you want a stylized voice while keeping the app local

### 3. Coqui XTTS

Powerful, but heavier than you need for this project right now.

- More complex runtime
- Best when you need cloning or more expressive synthesis
- Probably unnecessary for an early spelling app

## Recommended direction

Use this MVP UI now, then swap the speech layer to:

- `Piper` if you want the fastest path to a stable offline app
- `Kokoro` if you want nicer voice quality and don’t mind a bit more setup

## Future work

- Add local LLM conversation mode through Ollama
- Let the LLM produce a child-safe response and speak it back
- Optionally self-host the grammar ONNX files in `public/models` for stricter offline-first packaging
- Add saved voice presets and a "robot level" slider
