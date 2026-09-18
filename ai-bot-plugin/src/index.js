// Entry point loaded by an exported tour as:
//   <script type="module">
//     import { AiBot } from "./ai-bot-plugin/src/index.js";
//     // AiBot is also on window.AiBot, which is what standaloneTourPlayer.ts's core script
//     // checks for before adding the "Talk to AI Assistant" menu entry - see the comment there.
//   </script>
// Pure session orchestration - the status/stop UI lives in StatusPanel.js, the same split
// vr-sync-plugin uses between VRSync.js (logic) and its own bootstrap-built badge (UI).
import { AI_BOT_CONFIG } from "./config.js";
import { MicCapture } from "./MicCapture.js";
import { AudioPlayback } from "./AudioPlayback.js";
import { GeminiLiveClient } from "./GeminiLiveClient.js";
import { StatusPanel } from "./StatusPanel.js";

class AiBotController {
  constructor() {
    this.client = null;
    this.mic = null;
    this.playback = null;
    this.panel = new StatusPanel({ onStop: () => this.stop() });
    this.isStopping = false;
    this.isBotSpeaking = false;
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
      this.panel.show();
      this.panel.setStatus("No API key set - edit ai-bot-plugin/src/config.js", "error");
      return;
    }

    this.panel.show();
    this.panel.setStatus("Connecting...", "connecting");
    this.isBotSpeaking = false;

    // Status flow: Listening (mic picking up speech) -> Thinking (client-side voice-activity
    // detection noticed you went quiet, response not back yet) -> Speaking (audio actually
    // playing) -> back to Listening. Playback state always wins over the mic's own guess, since
    // it's ground truth for whether the bot is actually making sound.
    this.playback = new AudioPlayback();
    this.playback.onSpeakingChange = (isSpeaking) => {
      this.isBotSpeaking = isSpeaking;
      if (isSpeaking) this.panel.setStatus("Speaking...", "speaking");
      else if (this.client) this.panel.setStatus("Listening...", "listening");
    };

    this.client = new GeminiLiveClient({
      apiKey: AI_BOT_CONFIG.apiKey,
      model: AI_BOT_CONFIG.model,
      systemPrompt: AI_BOT_CONFIG.systemPrompt,
      voiceName: AI_BOT_CONFIG.voiceName,
      onAudioChunk: (base64Pcm) => this.playback.enqueueBase64Pcm24kHz(base64Pcm),
      // Extra safety net for "Thinking..." in case a future model/config produces any non-audio
      // content before its first audio chunk despite thinkingBudget: 0 - onSpeakingChange above
      // will immediately supersede this the moment real audio actually starts.
      onTurnStart: () => { if (!this.isBotSpeaking) this.panel.setStatus("Thinking...", "thinking"); },
      onOpen: async () => {
        this.panel.setStatus("Listening...", "listening");
        try {
          this.mic = new MicCapture({
            onChunk: (base64Pcm) => this.client && this.client.sendAudioChunk(base64Pcm),
            onVoiceActivity: (isSpeakingNow) => {
              if (this.isBotSpeaking) return; // playback is ground truth while the bot is talking
              this.panel.setStatus(isSpeakingNow ? "Listening..." : "Thinking...", isSpeakingNow ? "listening" : "thinking");
            },
          });
          await this.mic.start();
        } catch (err) {
          this.panel.setStatus("Microphone access denied or unavailable", "error");
          this.teardown();
        }
      },
      onError: (err) => { this.panel.setStatus(err.message || "Connection error", "error"); },
      onClose: (reason) => {
        // A close the user didn't ask for (clicking "End" sets isStopping first) means
        // something went wrong server-side - show it instead of silently vanishing, which is
        // exactly what made an earlier setup-message bug look like an unexplained hang.
        if (!this.isStopping) this.panel.setStatus(reason || "Disconnected", "error");
        this.teardown();
      },
    });
    this.client.connect();
  }

  // User-initiated: full stop, panel hides immediately, no need to explain anything.
  stop() {
    this.isStopping = true;
    this.teardown();
    this.panel.hide();
    this.isStopping = false;
  }

  // Resource cleanup only - does not touch the panel or status text, so an unexpected close's
  // error message (set by the onClose handler above) stays visible until the visitor dismisses
  // it with the End button.
  teardown() {
    if (this.mic) { this.mic.stop(); this.mic = null; }
    if (this.playback) { this.playback.stop(); this.playback = null; }
    if (this.client) { this.client.close(); this.client = null; }
    this.isBotSpeaking = false;
  }
}

export const AiBot = new AiBotController();
window.AiBot = AiBot;
