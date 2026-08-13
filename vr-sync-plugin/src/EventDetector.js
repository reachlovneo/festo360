// Hooks the host's actions by wrapping the tour's own global functions.
//
// index.html is one big classic (non-module) <script>, so its top-level
// `function openScene(...)` / `function showPanel(...)` declarations are
// real properties of `window` - reassigning them here patches every call
// site inside the tour too, since they all resolve the identifier through
// the shared global object.
//
// Popups have two independent renderers depending on mode: showPanel() for
// desktop (also the desktop hover-preview - it's called on pointerenter, not
// just on click) and showVrWorldPanel() for VR/desktop-VR mode, each with
// their own close path (a DOM close button vs hideVrWorldPanel()). Both get
// patched so popups sync in either mode, not just desktop.
//
// Only ever attached for the host. Viewers must not broadcast their own
// local navigation, so this module is never attached on a viewer.
export class EventDetector {
  constructor({
    onSceneChange,
    onPopupOpen,
    onPopupClose,
    onVideoPlay,
    onVideoPause,
    onVideoSeek,
    onMapToggle,
    onThemeChange,
    onAiMenuToggle,
    onAiSpeak,
    onAiStop,
  }) {
    this.onSceneChange = onSceneChange;
    this.onPopupOpen = onPopupOpen;
    this.onPopupClose = onPopupClose;
    this.onVideoPlay = onVideoPlay;
    this.onVideoPause = onVideoPause;
    this.onVideoSeek = onVideoSeek;
    this.onMapToggle = onMapToggle;
    this.onThemeChange = onThemeChange;
    this.onAiMenuToggle = onAiMenuToggle;
    this.onAiSpeak = onAiSpeak;
    this.onAiStop = onAiStop;
    this._originalOpenScene = null;
    this._originalShowPanel = null;
    this._originalShowVrWorldPanel = null;
    this._originalHideVrWorldPanel = null;
    this._originalSpeakHotspotFacts = null;
    this._originalStopAiSpeaking = null;
    this._popupOpen = false; // guards against broadcasting popup_close on every navigation
    this._closeListener = null;
    this._videoPlayListener = null;
    this._videoPauseListener = null;
    this._videoSeekListener = null;
    this._mapToggleListener = null;
    this._themeToggleListener = null;
    this._aiToggleListener = null;
  }

  _broadcastPopupOpen(hotspot) {
    if (!hotspot || !hotspot.id) return;
    let payloadHotspot;
    try {
      payloadHotspot = JSON.parse(JSON.stringify(hotspot));
    } catch (err) {
      console.warn("VRSync: hotspot is not serializable, skipping popup sync", err);
      return;
    }
    this._popupOpen = true;
    this.onPopupOpen(payloadHotspot);
  }

  attach() {
    if (typeof window.openScene !== "function" || typeof window.showPanel !== "function") {
      throw new Error(
        "VRSync: window.openScene / window.showPanel not found - tour build may have changed its internal API."
      );
    }

    this._originalOpenScene = window.openScene;
    window.openScene = (sceneId, ...rest) => {
      const result = this._originalOpenScene.call(window, sceneId, ...rest);
      this.onSceneChange(sceneId);
      return result;
    };

    this._originalShowPanel = window.showPanel;
    window.showPanel = (hotspot, ...rest) => {
      const result = this._originalShowPanel.call(window, hotspot, ...rest);
      // Broadcasts the whole hotspot, not just its id + a "current scene" we'd
      // have to track ourselves - this plugin attaches as a deferred module
      // script, which always runs after the tour's own classic <script> has
      // already loaded its first scene, so there's no reliable way to have
      // observed that initial openScene() call to know the scene at attach
      // time. Sending the full object sidesteps needing that lookup at all.
      this._broadcastPopupOpen(hotspot);
      return result;
    };

    if (typeof window.showVrWorldPanel === "function") {
      this._originalShowVrWorldPanel = window.showVrWorldPanel;
      window.showVrWorldPanel = async (hotspot, ...rest) => {
        const result = await this._originalShowVrWorldPanel.call(window, hotspot, ...rest);
        this._broadcastPopupOpen(hotspot);
        return result;
      };
    }

    if (typeof window.hideVrWorldPanel === "function") {
      this._originalHideVrWorldPanel = window.hideVrWorldPanel;
      window.hideVrWorldPanel = (...args) => {
        const result = this._originalHideVrWorldPanel.call(window, ...args);
        // hideVrWorldPanel() is also called unconditionally on every VR-mode
        // navigation and on exiting VR mode, whether or not a panel was
        // actually open - only broadcast when one really was, so scene
        // changes don't also spam a redundant popup_close.
        if (this._popupOpen) {
          this._popupOpen = false;
          this.onPopupClose();
        }
        return result;
      };
    }

    this._closeListener = (event) => {
      if (event.target.closest(".message-close")) {
        this._popupOpen = false;
        this.onPopupClose();
      }
    };
    document.addEventListener("click", this._closeListener, true);

    // 'play'/'pause'/'seeked' don't bubble, but a capture-phase listener on
    // document still sees them on the way down to the target, so this works
    // without needing a reference to the <video> element itself (it's
    // recreated fresh by showPanel() every time a video hotspot opens).
    this._videoPlayListener = (event) => {
      if (event.target.matches && event.target.matches("#message video")) {
        this.onVideoPlay({ currentTime: event.target.currentTime });
      }
    };
    this._videoPauseListener = (event) => {
      if (event.target.matches && event.target.matches("#message video")) {
        this.onVideoPause({ currentTime: event.target.currentTime });
      }
    };
    this._videoSeekListener = (event) => {
      if (event.target.matches && event.target.matches("#message video")) {
        this.onVideoSeek({ currentTime: event.target.currentTime });
      }
    };
    document.addEventListener("play", this._videoPlayListener, true);
    document.addEventListener("pause", this._videoPauseListener, true);
    document.addEventListener("seeked", this._videoSeekListener, true);

    // #mapToggle/#themeToggle/#aiAssistantToggle's own click handlers all call
    // event.stopPropagation() - a bubble-phase listener on document would
    // never even see the event. Capture phase does (it runs on the way down,
    // before stopPropagation in the bubble phase can cancel anything), but
    // fires *before* the target's own handler has flipped mapPanel.hidden/
    // data-theme, so the read has to be deferred. queueMicrotask() is NOT
    // reliable for that deferral here - confirmed by instrumenting it, the
    // browser drains microtasks at a checkpoint between capture and bubble
    // phase, not only after the whole dispatch finishes, so it still read
    // the stale pre-toggle value. setTimeout(fn, 0) is a real macrotask, so
    // it's guaranteed to run only once the browser is fully done with this
    // event, phases and all.
    this._mapToggleListener = (event) => {
      if (event.target.closest && event.target.closest("#mapToggle")) {
        setTimeout(() => {
          const mapPanel = document.querySelector("#mapPanel");
          if (mapPanel) this.onMapToggle({ hidden: mapPanel.hidden });
        }, 0);
      }
    };
    this._themeToggleListener = (event) => {
      if (event.target.closest && event.target.closest("#themeToggle")) {
        setTimeout(() => {
          this.onThemeChange({ theme: document.documentElement.getAttribute("data-theme") });
        }, 0);
      }
    };
    document.addEventListener("click", this._mapToggleListener, true);
    document.addEventListener("click", this._themeToggleListener, true);

    if (typeof window.speakHotspotFacts === "function") {
      this._originalSpeakHotspotFacts = window.speakHotspotFacts;
      window.speakHotspotFacts = (hotspot, ...rest) => {
        const result = this._originalSpeakHotspotFacts.call(window, hotspot, ...rest);
        if (hotspot && hotspot.id) {
          try {
            this.onAiSpeak(JSON.parse(JSON.stringify(hotspot)));
          } catch (err) {
            console.warn("VRSync: hotspot is not serializable, skipping AI-speak sync", err);
          }
        }
        return result;
      };
    }

    if (typeof window.stopAiSpeaking === "function") {
      this._originalStopAiSpeaking = window.stopAiSpeaking;
      window.stopAiSpeaking = (...args) => {
        const result = this._originalStopAiSpeaking.call(window, ...args);
        this.onAiStop();
        return result;
      };
    }

    // Same capture-phase-plus-deferral trick as map/theme above -
    // #aiAssistantToggle's handler also calls stopPropagation().
    this._aiToggleListener = (event) => {
      if (event.target.closest && event.target.closest("#aiAssistantToggle")) {
        setTimeout(() => {
          const menu = document.querySelector("#aiAssistantMenu");
          if (menu) this.onAiMenuToggle({ hidden: menu.hidden });
        }, 0);
      }
    };
    document.addEventListener("click", this._aiToggleListener, true);
  }

  detach() {
    if (this._originalOpenScene) window.openScene = this._originalOpenScene;
    if (this._originalShowPanel) window.showPanel = this._originalShowPanel;
    if (this._originalShowVrWorldPanel) window.showVrWorldPanel = this._originalShowVrWorldPanel;
    if (this._originalHideVrWorldPanel) window.hideVrWorldPanel = this._originalHideVrWorldPanel;
    if (this._closeListener) document.removeEventListener("click", this._closeListener, true);
    if (this._videoPlayListener) document.removeEventListener("play", this._videoPlayListener, true);
    if (this._videoPauseListener) document.removeEventListener("pause", this._videoPauseListener, true);
    if (this._videoSeekListener) document.removeEventListener("seeked", this._videoSeekListener, true);
    if (this._mapToggleListener) document.removeEventListener("click", this._mapToggleListener, true);
    if (this._themeToggleListener) document.removeEventListener("click", this._themeToggleListener, true);
    if (this._originalSpeakHotspotFacts) window.speakHotspotFacts = this._originalSpeakHotspotFacts;
    if (this._originalStopAiSpeaking) window.stopAiSpeaking = this._originalStopAiSpeaking;
    if (this._aiToggleListener) document.removeEventListener("click", this._aiToggleListener, true);
  }
}
