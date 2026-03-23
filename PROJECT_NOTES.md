# Project Notes

## Current architecture

- `server.js` is a tiny static file server. No database, no backend model calls.
- `public/app.js` owns UI state, local history, browser speech synthesis, and phrase scoring.
- History is stored in `localStorage`, so the app stays local-first and simple to move between Mac and Windows.

## Grammar checking approach

- Primary checker: `Xenova/grammar-synthesis-small` through Transformers.js in the browser.
- Fallback checker: the original heuristic scorer remains in the app and is used if the grammar model cannot load or cannot generate output.
- The UI exposes checker status so the user can see whether the model is loading, ready, or in fallback mode.

## Local-first behavior

- Speech stays fully local through `speechSynthesis`.
- Grammar checking runs in the browser once the model is available.
- On first use, Transformers.js will fetch the model assets and store them in the browser cache.
- After the model is cached, repeat visits can keep working locally unless the browser cache is cleared.
- If the machine is offline before the model has ever been cached, the app falls back to the heuristic scorer instead of failing.

## Practical next step if stricter offline support is needed

- Vendor the ONNX model files under a local path such as `public/models/grammar-synthesis-small/`.
- Point Transformers.js at those local files so first-run setup does not depend on Hugging Face availability.
- That would make the repo and app bundle much larger, so it is better as an explicit packaging step rather than a default repo change.
