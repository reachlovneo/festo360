// Stage 1 (test & tune): hand-edit this file after exporting, before uploading/serving the tour.
// Nothing else in this plugin needs to change to try a different key, prompt, model, or voice.
//
// apiKey        - your own Gemini API key (https://aistudio.google.com/apikey). Billed to your
//                 own account; this file ships in plain text inside the exported site, so treat
//                 it like any other secret checked into a public deploy - fine for this test/tune
//                 stage on a device you control, not yet meant for a public production rollout
//                 (that's stage 2: a proper in-browser setup flow instead of a baked-in file).
// systemPrompt  - the assistant's persona/instructions. Keep it short and explicitly ask for
//                 spoken, conversational answers - LLMs default to writing like a document
//                 (bullet points, long paragraphs), which sounds stilted read aloud.
// model         - Live API model id. This is a preview surface and the available model can
//                 change; if the assistant fails to connect, this is the first thing to check.
//                 Confirmed live against a real key on 2026-09-05 via GET
//                 generativelanguage.googleapis.com/v1beta/models (filter for
//                 supportedGenerationMethods including "bidiGenerateContent") - as of that check,
//                 the "native-audio" line is Google's branding for expressive/natural speech
//                 specifically (as opposed to more function/tool-call-oriented live models), so
//                 it's the better starting point for a voice-assistant persona:
//                   - models/gemini-2.5-flash-native-audio-preview-12-2025 (current default below)
//                   - models/gemini-2.5-flash-native-audio-latest (a rolling alias, if the dated
//                     preview above ever gets retired)
//                   - models/gemini-3.1-flash-live-preview (also available, not native-audio
//                     branded - worth trying if the native-audio line underperforms on tone)
//                 Re-run the same models-list check if this stops working; preview ids get
//                 replaced.
// voiceName     - one of the Live API's prebuilt voice names (e.g. "Puck", "Charon", "Kore",
//                 "Fenrir", "Aoede" as of this writing - check current docs for the full list).
export const AI_BOT_CONFIG = {
  apiKey: "AQ.Ab8RN6LolDFSD-TU8gaznSXMli_tUG_A_95g1aZnHfw2MGEx-w",
  systemPrompt: "You are a friendly, concise voice assistant for a virtual facility tour. Answer in short, natural spoken sentences, not lists or long paragraphs.",
  model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
  voiceName: "Puck",
};
