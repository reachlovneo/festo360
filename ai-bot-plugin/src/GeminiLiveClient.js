// Thin wrapper around the Gemini Live API's WebSocket protocol. Protocol reference verified
// against Google's current docs at build time (this is a preview API and can drift - if
// connections start failing, check https://ai.google.dev/gemini-api/docs/live-api first):
//   - connect:    wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=API_KEY
//   - first send: { setup: { model, responseModalities: ["AUDIO"], systemInstruction, speechConfig } }
//   - audio up:   { realtimeInput: { audio: { data: base64Pcm16kHz, mimeType: "audio/pcm;rate=16000" } } }
//   - audio down: serverContent.modelTurn.parts[].inlineData.data (base64 PCM, 24kHz)
export class GeminiLiveClient {
  constructor({ apiKey, model, systemPrompt, voiceName, onAudioChunk, onError, onOpen, onClose, onTurnStart }) {
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.voiceName = voiceName;
    this.onAudioChunk = onAudioChunk;
    this.onError = onError || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onClose = onClose || (() => {});
    // Fires on the first message of a new model turn, audio or not - a defensive extra signal
    // for the UI to show "Thinking..." the instant the server starts responding, in case a
    // future model/config still produces a text part before audio despite thinkingBudget: 0.
    this.onTurnStart = onTurnStart || (() => {});
    this.isTurnActive = false;
    this.socket = null;
    this.isSetupComplete = false;
    this.pendingAudioChunks = [];
  }

  connect() {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(this.apiKey)}`;
    this.socket = new WebSocket(url);

    this.socket.addEventListener("open", () => {
      this.socket.send(JSON.stringify({
        setup: {
          model: this.model,
          // responseModalities/speechConfig MUST be nested under generationConfig - confirmed
          // empirically against the live API on 2026-09-05: sending them as top-level setup
          // fields (as one of Google's own doc pages showed) gets rejected with "Invalid JSON
          // payload received. Unknown name 'responseModalities' at 'setup'." and the socket
          // closes immediately, which is why the assistant used to hang on "Connecting..."
          // forever with no visible error.
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } } },
            // Extended "thinking" is built for multi-step reasoning tasks, not quick spoken
            // facility Q&A - confirmed via a direct test that this model does an internal
            // reasoning pass by default (visible as a text part before any audio), which adds
            // real latency for no benefit here. thinkingBudget: 0 disables it. Also confirmed
            // this field name/nesting empirically (2026-09-05) the same way generationConfig
            // itself was - a top-level "thinkingConfig" under setup gets rejected the same way
            // top-level responseModalities did.
            thinkingConfig: { thinkingBudget: 0 },
          },
          systemInstruction: { parts: [{ text: this.systemPrompt }] },
        },
      }));
    });

    this.socket.addEventListener("message", async (event) => {
      const raw = event.data instanceof Blob ? await event.data.text() : event.data;
      let message;
      try { message = JSON.parse(raw); } catch (err) { this.onError(new Error("Could not parse server message")); return; }

      if (message.setupComplete) {
        this.isSetupComplete = true;
        this.onOpen();
        this.pendingAudioChunks.splice(0).forEach((chunk) => this.sendAudioChunk(chunk));
        return;
      }

      const parts = message.serverContent && message.serverContent.modelTurn && message.serverContent.modelTurn.parts;
      if (parts && parts.length > 0) {
        if (!this.isTurnActive) { this.isTurnActive = true; this.onTurnStart(); }
        parts.forEach((part) => {
          if (part.inlineData && part.inlineData.data) this.onAudioChunk(part.inlineData.data);
        });
      }
      if (message.serverContent && message.serverContent.turnComplete) {
        this.isTurnActive = false;
      }
    });

    this.socket.addEventListener("error", () => {
      this.onError(new Error("Gemini Live connection error - check the API key and model in ai-bot-plugin/src/config.js"));
    });

    this.socket.addEventListener("close", (event) => {
      const wasSetupComplete = this.isSetupComplete;
      this.isSetupComplete = false;
      // event.reason carries the server's own explanation for an abnormal close (e.g. a
      // malformed setup message) - surfacing it is what turns "stuck on Connecting forever"
      // into an actual diagnosable error instead of silence.
      this.onClose(!wasSetupComplete && event.reason ? event.reason : null);
    });
  }

  // Queued until the setup handshake completes - sending realtimeInput before setupComplete
  // is rejected by the API, and mic capture can start slightly before the socket is ready.
  sendAudioChunk(base64Pcm16kHz) {
    if (!this.isSetupComplete) { this.pendingAudioChunks.push(base64Pcm16kHz); return; }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      realtimeInput: { audio: { data: base64Pcm16kHz, mimeType: "audio/pcm;rate=16000" } },
    }));
  }

  close() {
    this.isSetupComplete = false;
    this.pendingAudioChunks = [];
    if (this.socket) this.socket.close();
    this.socket = null;
  }
}
