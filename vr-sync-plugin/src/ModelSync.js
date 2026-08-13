// Mirrors the 3D model popup's rotation/zoom/explode/fullscreen from host to
// viewer, via the same "live" channel pattern as CameraSync.js (see there for
// why continuous state uses latest-value overwrite instead of the action log,
// and why the viewer eases toward targets instead of snapping).
//
// Only meaningful while a model-having popup is actually open, on both ends -
// stageElement.vrSyncHooks (see index.html) only exists between showPanel()
// loading a model and the panel closing, so both host polling and viewer
// applying are no-ops outside that window, not errors.
//
// There are two independent model viewers to cover: the desktop one
// (stageElement.vrSyncHooks, a fresh hook object per popup open) and the
// VR-mode one (window.__vrSyncVrPanelHooks, a single hook attached once,
// whose getState() returns null whenever no VR panel is open). The two are
// mutually exclusive - a session is in one mode or the other - so picking
// whichever is currently active is unambiguous.
const POLL_MS = 150;
const LERP_FACTOR = 0.25;

function currentStageHooks() {
  const desktopHooks = document.querySelector("#message .model-stage")?.vrSyncHooks;
  if (desktopHooks) return desktopHooks;
  const vrHooks = window.__vrSyncVrPanelHooks;
  if (vrHooks && vrHooks.getState()) return vrHooks;
  return null;
}

function stateEqual(a, b) {
  return (
    a.rotationX === b.rotationX &&
    a.rotationY === b.rotationY &&
    a.zoom === b.zoom &&
    a.exploded === b.exploded &&
    a.fullscreen === b.fullscreen
  );
}

export class ModelSync {
  constructor(firebaseSync) {
    this.sync = firebaseSync;
    this._hostTimer = null;
    this._viewerRaf = null;
    this._viewerUnsubscribe = null;
    this._target = null;
  }

  startHost(sessionId) {
    let last = null;
    this._hostTimer = setInterval(() => {
      const hooks = currentStageHooks();
      const state = hooks ? hooks.getState() : null;
      if (state === null && last === null) return;
      if (state && last && stateEqual(state, last)) return;
      last = state;
      this.sync.setLive(sessionId, "model", state);
    }, POLL_MS);
  }

  stopHost() {
    if (this._hostTimer) clearInterval(this._hostTimer);
    this._hostTimer = null;
  }

  startViewer(sessionId) {
    this._viewerUnsubscribe = this.sync.onLive(sessionId, "model", (state) => {
      this._target = state;
    });
    const tick = () => {
      const hooks = currentStageHooks();
      if (hooks && this._target) {
        const current = hooks.getState();
        hooks.setRotation(
          current.rotationX + (this._target.rotationX - current.rotationX) * LERP_FACTOR,
          current.rotationY + (this._target.rotationY - current.rotationY) * LERP_FACTOR
        );
        hooks.setZoom(current.zoom + (this._target.zoom - current.zoom) * LERP_FACTOR);
        hooks.setExploded(this._target.exploded);
        hooks.setFullscreen(this._target.fullscreen);
      }
      this._viewerRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  stopViewer() {
    if (this._viewerRaf) cancelAnimationFrame(this._viewerRaf);
    this._viewerRaf = null;
    if (this._viewerUnsubscribe) this._viewerUnsubscribe();
  }
}
