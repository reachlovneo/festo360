// The bot's small floating status/stop UI - kept separate from the session orchestration logic
// in index.js, the same way vr-sync-plugin keeps VRSync.js pure logic with no DOM concerns of
// its own. The DOM element itself is created lazily (only once a session actually starts, via
// ensurePanel()), not at construction time, so importing this module never touches the page.
export class StatusPanel {
  constructor({ onStop }) {
    this.onStop = onStop;
    this.element = null;
    this.indicator = null;
    this.statusText = null;
  }

  show() {
    this.ensurePanel();
    this.element.hidden = false;
  }

  hide() {
    if (this.element) this.element.hidden = true;
  }

  // A distinct little animation per state - not just color/text - so the status reads at a
  // glance without having to actually read the words: a calm breathing pulse while listening,
  // bouncing dots while thinking, a livelier waveform while speaking.
  setStatus(text, state) {
    this.ensurePanel();
    this.statusText.textContent = text;
    this.statusText.style.color = state === "error" ? "#fca5a5" : "#fff";
    this.indicator.className = "aibot-indicator aibot-state-" + (state || "connecting");
  }

  ensurePanel() {
    if (this.element) return;
    this.injectStyles();

    this.element = document.createElement("div");
    this.element.hidden = true;
    this.element.style.cssText = "align-items:center;background:rgba(15,23,32,.86);border-radius:999px;bottom:18px;color:#fff;display:flex;font:13px/1.4 system-ui;gap:10px;left:18px;padding:9px 10px 9px 16px;position:fixed;z-index:99999;";

    this.indicator = document.createElement("span");
    this.indicator.className = "aibot-indicator";
    for (let i = 0; i < 3; i++) this.indicator.appendChild(document.createElement("span")).className = "aibot-bar";
    this.element.appendChild(this.indicator);

    this.statusText = document.createElement("span");
    this.element.appendChild(this.statusText);
    const stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.textContent = "End";
    stopButton.style.cssText = "background:rgba(239,68,68,.9);border:0;border-radius:999px;color:#fff;cursor:pointer;font:inherit;font-weight:700;padding:5px 12px;";
    stopButton.addEventListener("click", () => this.onStop());
    this.element.appendChild(stopButton);
    // #xrOverlay is the WebXR domOverlay root the core player sets up for real immersive VR
    // sessions (see standaloneTourPlayer.ts) - everything that renders correctly while in VR
    // (header, map panel, the AI toggle itself) lives inside it. Appending here instead of
    // document.body was the actual cause of this panel not being visible/composited correctly
    // once a session was started from inside VR - falls back to document.body outside an export
    // (e.g. this file loaded standalone) where #xrOverlay doesn't exist.
    (document.querySelector("#xrOverlay") || document.body).appendChild(this.element);
  }

  injectStyles() {
    if (document.getElementById("aibot-styles")) return;
    const style = document.createElement("style");
    style.id = "aibot-styles";
    style.textContent = `
      .aibot-indicator { align-items: flex-end; display: flex; gap: 3px; height: 14px; }
      .aibot-bar { background: #94a3b8; border-radius: 2px; display: inline-block; width: 3px; }
      .aibot-state-listening .aibot-bar { animation: aibot-breathe 1.6s ease-in-out infinite; background: #5eead4; height: 11px; }
      .aibot-state-thinking .aibot-bar, .aibot-state-connecting .aibot-bar { animation: aibot-bounce 1s ease-in-out infinite; background: #fbbf24; border-radius: 50%; height: 6px; width: 6px; }
      .aibot-state-connecting .aibot-bar { background: #94a3b8; }
      .aibot-state-speaking .aibot-bar { animation: aibot-wave .5s ease-in-out infinite; background: #34d399; height: 12px; }
      .aibot-state-error .aibot-bar { animation: none; background: #f87171; border-radius: 50%; height: 6px; width: 6px; }
      .aibot-bar:nth-child(2) { animation-delay: .15s; }
      .aibot-bar:nth-child(3) { animation-delay: .3s; }
      @keyframes aibot-breathe { 0%, 100% { opacity: .4; transform: scaleY(.5); } 50% { opacity: 1; transform: scaleY(1); } }
      @keyframes aibot-bounce { 0%, 80%, 100% { opacity: .5; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-5px); } }
      @keyframes aibot-wave { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
    `;
    document.head.appendChild(style);
  }
}
