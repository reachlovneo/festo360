# AI Bot Plugin (Gemini Live API) — Stage 1

Adds a real, conversational voice assistant to an exported tour, using Google's Gemini Live API
for true speech-to-speech (not a text chat read aloud). It's the entire contents of the AI
assistant menu — there's no separate per-hotspot canned narration anymore; the assistant is
grounded purely by the system prompt configured in Settings.

**Stage 1 status:** this is the test-and-tune stage. The API key, system prompt, model, and voice
are all set in one file (`src/config.js`) that you edit by hand after exporting, before uploading.
The polished in-browser setup flow (an operator entering their own key once, without touching any
files) is stage 2, not built yet.

## Setup

0. `config.js` is gitignored (it holds a real API key) - if it doesn't exist yet in
   `apps/editor/ai-bot-plugin/src/` (e.g. on a fresh clone), copy `config.example.js` to
   `config.js` first. The example file is the one checked into git; never put a real key in it.
1. Export the project with **Settings → Include AI Voice Assistant (beta)** turned on.
2. Open `ai-bot-plugin/src/config.js` in the exported folder and fill in:
   - `apiKey` — your own key from [Google AI Studio](https://aistudio.google.com/apikey).
   - `systemPrompt` — the assistant's persona. Ask explicitly for short, spoken-style answers;
     LLMs default to writing like a document, which sounds stilted read aloud.
   - `model` / `voiceName` — see the comments in `config.js`. This is a preview API surface, so
     if the assistant fails to connect, check the current model id against
     [Google's Live API docs](https://ai.google.dev/gemini-api/docs/live-api) first.
3. Serve or upload the exported folder somewhere HTTPS (GitHub Pages works) — or `localhost` for
   local testing. The microphone (`getUserMedia`) will not work over a plain `file://` path or
   `http://`, for the same reason documented in `vr-sync-plugin/README.md`.
4. Open the tour, click the AI assistant button, choose "Talk to AI Assistant."

## How it fits together

- `config.js` — the one file meant to be hand-edited per deployment.
- `MicCapture.js` — captures the microphone, resamples to 16kHz mono PCM16 (what the Live API
  expects), and hands off base64 chunks.
- `GeminiLiveClient.js` — owns the WebSocket connection and protocol (setup handshake, sending
  mic audio, parsing returned audio).
- `AudioPlayback.js` — queues the returned 24kHz PCM16 audio chunks so playback doesn't stutter.
- `StatusPanel.js` — the small status/stop UI (bottom-left), kept separate from session
  orchestration - the same split `vr-sync-plugin` uses between its own logic and UI.
- `index.js` — wires the above together and exposes `window.AiBot` (`.start()` / `.stop()`).
  Injected here, not in the core exported script, so removing this folder removes the entire
  feature, UI included.

## Removing this feature entirely

Delete this folder and don't check "Include AI Voice Assistant" at export. The core exported
script only ever checks `window.AiBot` before adding one menu entry — with the plugin absent,
that check is simply false, and the rest of the tour (Tour Mode, Training Mode, canned narration,
VR Sync) is completely unaffected.

## Known limitations (stage 1)

- Key lives in plain text in the exported file — fine for a device you control while testing,
  not yet meant for a public production rollout.
- No visual "not configured" affordance yet — an unset key just shows an error in the status
  panel when someone taps "Talk to AI Assistant."
- Voice-activity interruption/barge-in relies entirely on the Live API's own server-side
  handling; nothing client-side detects when the visitor starts talking over the assistant.
