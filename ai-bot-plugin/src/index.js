// Entry point loaded by an exported tour as:
//   <script type="module">
//     import { AiBot } from "./ai-bot-plugin/src/index.js";
//     // AiBot is also on window.AiBot, which is what standaloneTourPlayer.ts's core script
//     // checks for before adding the "Talk to AI Assistant" menu entry - see the comment there.
//   </script>
// Owns its own small status/stop UI, injected into the page here rather than in the core
// exported script, so the entire feature - including its on-screen presence - disappears
// cleanly if this folder is removed from an export.
import { AI_BOT_CONFIG } from "./config.js";
import { MicCapture } from "./MicCapture.js";
import { AudioPlayback } from "./AudioPlayback.js";
import { GeminiLiveClient } from "./GeminiLiveClient.js";

class AiBotController {
  constructor() {
    this.client = null;
    this.mic = null;
    this.playback = null;
    this.panel = null;
    this.statusText = null;
    this.observeVrExit();
  }

  // This plugin's status panel is flat 2D DOM, same as the rest of the exported tour's
  // interactive overlays - it can't render correctly in real VR/stereo mode (see the equivalent
  // note on Training Mode's UI). Rather than adding a second touchpoint to the core exported
  // script (which would break the "just delete this folder" removal guarantee), this observes
  // the #tour element's own "vr-active" class - already toggled by the core script's
  // updateVrUi() on every VR enter/exit - and stops the session itself when VR starts.
  observeVrExit() {
    const tourElement = document.querySelector("#tour");
    if (!tourElement || !window.MutationObserver) return;
    const observer = new MutationObserver(() => {
      if (tourElement.classList.contains("vr-active") && this.client) this.stop();
    });
    observer.observe(tourElement, { attributes: true, attributeFilter: ["class"] });
  }

  async start() {
    if (this.client) return; // already running

    if (!AI_BOT_CONFIG.apiKey) {
      this.ensurePanel();
      this.setStatus("No API key set - edit ai-bot-plugin/src/config.js", true);
      return;
    }

    this.ensurePanel();
    this.panel.hidden = false;
    this.setStatus("Connecting...");

    this.playback = new AudioPlayback();
    this.playback.onSpeakingChange = (isSpeaking) => {
      if (isSpeaking) this.setStatus("Speaking...");
      else if (this.client) this.setStatus("Listening...");
    };

    this.client = new GeminiLiveClient({
      apiKey: AI_BOT_CONFIG.apiKey,
      model: AI_BOT_CONFIG.model,
      systemPrompt: AI_BOT_CONFIG.systemPrompt,
      voiceName: AI_BOT_CONFIG.voiceName,
      onAudioChunk: (base64Pcm) => this.playback.enqueueBase64Pcm24kHz(base64Pcm),
      onOpen: async () => {
        this.setStatus("Listening...");
        try {
          this.mic = new MicCapture({ onChunk: (base64Pcm) => this.client && this.client.sendAudioChunk(base64Pcm) });
          await this.mic.start();
        } catch (err) {
          this.setStatus("Microphone access denied or unavailable", true);
          this.stop();
        }
      },
      onError: (err) => { this.setStatus(err.message || "Connection error", true); },
      onClose: () => { this.stop(); },
    });
    this.client.connect();
  }

  stop() {
    if (this.mic) { this.mic.stop(); this.mic = null; }
    if (this.playback) { this.playback.stop(); this.playback = null; }
    if (this.client) { this.client.close(); this.client = null; }
    if (this.panel) this.panel.hidden = true;
  }

  ensurePanel() {
    if (this.panel) return;
    this.panel = document.createElement("div");
    this.panel.hidden = true;
    this.panel.style.cssText = "align-items:center;background:rgba(15,23,32,.86);border-radius:999px;bottom:18px;color:#fff;display:flex;font:13px/1.4 system-ui;gap:10px;left:18px;padding:9px 10px 9px 16px;position:fixed;z-index:99999;";
    this.statusText = document.createElement("span");
    this.panel.appendChild(this.statusText);
    const stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.textContent = "End";
    stopButton.style.cssText = "background:rgba(239,68,68,.9);border:0;border-radius:999px;color:#fff;cursor:pointer;font:inherit;font-weight:700;padding:5px 12px;";
    stopButton.addEventListener("click", () => this.stop());
    this.panel.appendChild(stopButton);
    document.body.appendChild(this.panel);
  }

  setStatus(text, isError) {
    if (!this.statusText) return;
    this.statusText.textContent = text;
    this.statusText.style.color = isError ? "#fca5a5" : "#fff";
  }
}

export const AiBot = new AiBotController();
window.AiBot = AiBot;
