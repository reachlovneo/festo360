import { FirebaseSync } from "./FirebaseSync.js";
import { SessionManager } from "./SessionManager.js";
import { EventDetector } from "./EventDetector.js";
import { ActionReplayer } from "./ActionReplayer.js";
import { CameraSync } from "./CameraSync.js";
import { ModelSync } from "./ModelSync.js";

export class VRSync {
  constructor() {
    this.sync = null;
    this.session = null;
    this.detector = null;
    this.replayer = new ActionReplayer();
    this._state = { sceneId: null, popupHotspot: null, mapHidden: null, theme: null };
    this._camera = null;
    this._model = null;
  }

  init({ firebaseConfig }) {
    this.sync = new FirebaseSync(firebaseConfig);
    this.session = new SessionManager(this.sync);
    this._camera = new CameraSync(this.sync);
    this._model = new ModelSync(this.sync);
  }

  async startHost() {
    const sessionId = await this.session.startHost();

    this.detector = new EventDetector({
      onSceneChange: (sceneId) => {
        this._state = { ...this._state, sceneId, popupHotspot: null };
        this.sync.sendAction(sessionId, "scene_change", { sceneId });
        this.sync.setState(sessionId, this._state);
      },
      onPopupOpen: (hotspot) => {
        this._state = { ...this._state, popupHotspot: hotspot };
        this.sync.sendAction(sessionId, "popup_open", { hotspot });
        this.sync.setState(sessionId, this._state);
      },
      onPopupClose: () => {
        this._state = { ...this._state, popupHotspot: null };
        this.sync.sendAction(sessionId, "popup_close", {});
        this.sync.setState(sessionId, this._state);
      },
      onVideoPlay: (payload) => this.sync.sendAction(sessionId, "video_play", payload),
      onVideoPause: (payload) => this.sync.sendAction(sessionId, "video_pause", payload),
      onVideoSeek: (payload) => this.sync.sendAction(sessionId, "video_seek", payload),
      onMapToggle: (payload) => {
        this._state = { ...this._state, mapHidden: payload.hidden };
        this.sync.sendAction(sessionId, "map_toggle", payload);
        this.sync.setState(sessionId, this._state);
      },
      onThemeChange: (payload) => {
        this._state = { ...this._state, theme: payload.theme };
        this.sync.sendAction(sessionId, "theme_change", payload);
        this.sync.setState(sessionId, this._state);
      },
      // AI-assistant menu/speak are not persisted to state - unlike scene or
      // popup, there's no sensible "catch a late joiner up to mid-speech".
      onAiMenuToggle: (payload) => this.sync.sendAction(sessionId, "ai_menu_toggle", payload),
      onAiSpeak: (hotspot) => this.sync.sendAction(sessionId, "ai_speak", hotspot),
      onAiStop: () => this.sync.sendAction(sessionId, "ai_stop", {}),
    });
    this.detector.attach();

    this._camera.startHost(sessionId);
    this._model.startHost(sessionId);

    return sessionId;
  }

  async joinViewer(sessionId) {
    const joinedId = await this.session.joinViewer(sessionId);

    const initialState = await this.sync.getStateOnce(joinedId);
    this.replayer.applyState(initialState);

    this.sync.onAction(joinedId, (action) => this.replayer.apply(action));

    this._camera.startViewer(joinedId);
    this._model.startViewer(joinedId);

    return joinedId;
  }

  stop() {
    if (this.detector) this.detector.detach();
    this._camera.stopHost();
    this._camera.stopViewer();
    this._model.stopHost();
    this._model.stopViewer();
  }
}
