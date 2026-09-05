// Thin wrapper around the Gemini Live API's WebSocket protocol. Protocol reference verified
// against Google's current docs at build time (this is a preview API and can drift - if
// connections start failing, check https://ai.google.dev/gemini-api/docs/live-api first):
//   - connect:    wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=API_KEY
//   - first send: { setup: { model, responseModalities: ["AUDIO"], systemInstruction, speechConfig } }
//   - audio up:   { realtimeInput: { audio: { data: base64Pcm16kHz, mimeType: "audio/pcm;rate=16000" } } }
//   - audio down: serverContent.modelTurn.parts[].inlineData.data (base64 PCM, 24kHz)
export class GeminiLiveClient {
  constructor({ apiKey, model, systemPrompt, voiceName, onAudioChunk, onError, onOpen, onClose }) {
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.voiceName = voiceName;
    this.onAudioChunk = onAudioChunk;
    this.onError = onError || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onClose = onClose || (() => {});
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
          responseModalities: ["AUDIO"],
          systemInstruction: { parts: [{ text: this.systemPrompt }] },
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } } },
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
      if (parts) {
        parts.forEach((part) => {
          if (part.inlineData && part.inlineData.data) this.onAudioChunk(part.inlineData.data);
        });
      }
    });

    this.socket.addEventListener("error", () => {
      this.onError(new Error("Gemini Live connection error - check the API key and model in ai-bot-plugin/src/config.js"));
    });

    this.socket.addEventListener("close", () => {
      this.isSetupComplete = false;
      this.onClose();
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
