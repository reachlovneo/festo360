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

// A plain requestAnimationFrame loop is commonly throttled or stalled by the browser once a real
// immersive-VR session takes over frame pacing (confirmed as why continuous sync stopped reaching
// a real headset viewer, while working fine in desktop-VR, which never opens a real XR session).
// window.__vrSyncFrameCallbacks (exported tours built with this fix) ties the tick to the app's
// own render loop instead, which is correctly paced in every mode. Falls back to a plain rAF loop
// for older exports that don't expose it yet.
function registerFrameTick(callback) {
  if (window.__vrSyncFrameCallbacks) {
    window.__vrSyncFrameCallbacks.push(callback);
    return function() {
      const index = window.__vrSyncFrameCallbacks.indexOf(callback);
      if (index !== -1) window.__vrSyncFrameCallbacks.splice(index, 1);
    };
  }
  let raf = requestAnimationFrame(function loop() { callback(); raf = requestAnimationFrame(loop); });
  return function() { cancelAnimationFrame(raf); };
}

export class CameraSync {
  constructor(firebaseSync) {
    this.sync = firebaseSync;
    this._hostTimer = null;
    this._unregisterTick = null;
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
    this._unregisterTick = registerFrameTick(() => {
      const hooks = window.__vrSyncViewHooks;
      if (hooks && this._target) {
        const current = hooks.getView();
        hooks.setView({
          yaw: current.yaw + (this._target.yaw - current.yaw) * LERP_FACTOR,
          pitch: current.pitch + (this._target.pitch - current.pitch) * LERP_FACTOR,
          fov: current.fov + (this._target.fov - current.fov) * LERP_FACTOR,
        });
      }
    });
  }

  stopViewer() {
    if (this._unregisterTick) this._unregisterTick();
    this._unregisterTick = null;
    if (this._viewerUnsubscribe) this._viewerUnsubscribe();
  }
}
