// Mirrors the panorama look-around view (yaw/pitch/fov) from host to viewer.
// Continuous state, not a discrete event, so it goes through FirebaseSync's
// "live" channel (latest-value overwrite + ongoing subscription) instead of
// the action log - see FirebaseSync.js for why those are different shapes.
//
// Host polls window.__vrSyncViewHooks (see index.html) on an interval and
// only writes when the value actually changed, since Firebase writes cost
// bandwidth. Viewer eases toward the last received value every frame rather
// than snapping to it, so a burst of updates over a slightly laggy
// connection reads as a smooth pan instead of a jump-cut.
const POLL_MS = 150;
const LERP_FACTOR = 0.25;

function viewsEqual(a, b) {
  return a.yaw === b.yaw && a.pitch === b.pitch && a.fov === b.fov;
}

export class CameraSync {
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
      const hooks = window.__vrSyncViewHooks;
      if (!hooks) return;
      const view = hooks.getView();
      if (last && viewsEqual(last, view)) return;
      last = view;
      this.sync.setLive(sessionId, "camera", view);
    }, POLL_MS);
  }

  stopHost() {
    if (this._hostTimer) clearInterval(this._hostTimer);
    this._hostTimer = null;
  }

  startViewer(sessionId) {
    this._viewerUnsubscribe = this.sync.onLive(sessionId, "camera", (view) => {
      this._target = view;
    });
    const tick = () => {
      const hooks = window.__vrSyncViewHooks;
      if (hooks && this._target) {
        const current = hooks.getView();
        hooks.setView({
          yaw: current.yaw + (this._target.yaw - current.yaw) * LERP_FACTOR,
          pitch: current.pitch + (this._target.pitch - current.pitch) * LERP_FACTOR,
          fov: current.fov + (this._target.fov - current.fov) * LERP_FACTOR,
        });
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
