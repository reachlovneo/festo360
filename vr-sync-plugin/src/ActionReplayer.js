// Applies actions received from the host by calling the tour's own global
// functions - see EventDetector.js for why these are reachable on window.
// Only ever used on viewers.
export class ActionReplayer {
  apply(action) {
    switch (action.type) {
      case "scene_change":
        window.openScene(action.payload.sceneId);
        break;

      case "popup_open":
        if (action.payload && action.payload.hotspot) this._openPopup(action.payload.hotspot);
        break;

      case "popup_close":
        this._closePopup();
        break;

      case "video_play": {
        const video = document.querySelector("#message video");
        if (video) {
          if (typeof action.payload.currentTime === "number") video.currentTime = action.payload.currentTime;
          video.play().catch(() => {}); // browsers reject play() without a user gesture; nothing to recover
        }
        break;
      }

      case "video_pause": {
        const video = document.querySelector("#message video");
        if (video) {
          if (typeof action.payload.currentTime === "number") video.currentTime = action.payload.currentTime;
          video.pause();
        }
        break;
      }

      case "video_seek": {
        const video = document.querySelector("#message video");
        if (video && action.payload && typeof action.payload.currentTime === "number") {
          video.currentTime = action.payload.currentTime;
        }
        break;
      }

      case "map_toggle": {
        const mapPanel = document.querySelector("#mapPanel");
        if (mapPanel && action.payload) mapPanel.hidden = action.payload.hidden;
        break;
      }

      case "theme_change":
        if (action.payload && action.payload.theme && window.applyTheme) window.applyTheme(action.payload.theme);
        break;

      case "ai_menu_toggle": {
        const menu = document.querySelector("#aiAssistantMenu");
        if (menu && action.payload) menu.hidden = action.payload.hidden;
        break;
      }

      case "ai_speak":
        if (action.payload && window.speakHotspotFacts) window.speakHotspotFacts(action.payload);
        break;

      case "ai_stop":
        if (window.stopAiSpeaking) window.stopAiSpeaking();
        break;

      default:
        console.warn("VRSync: unknown action type", action.type);
    }
  }

  // Renders using whichever mode the viewer itself is currently in, not
  // whichever mode the host was in - a desktop viewer should see the normal
  // popup even if the host opened it while in VR, and vice versa.
  _openPopup(hotspot) {
    if (window.isVrActive && window.isVrActive()) {
      window.showVrWorldPanel(hotspot);
    } else {
      window.showPanel(hotspot);
    }
  }

  _closePopup() {
    if (window.isVrActive && window.isVrActive()) {
      if (window.hideVrWorldPanel) window.hideVrWorldPanel();
      return;
    }
    const closeBtn = document.querySelector("#message .message-close");
    if (closeBtn) closeBtn.click();
  }

  applyState(state) {
    if (!state) return;
    if (state.sceneId) window.openScene(state.sceneId);
    if (state.popupHotspot) this._openPopup(state.popupHotspot);
    if (state.mapHidden !== undefined) {
      const mapPanel = document.querySelector("#mapPanel");
      if (mapPanel) mapPanel.hidden = state.mapHidden;
    }
    if (state.theme && window.applyTheme) window.applyTheme(state.theme);
  }
}
