# VR Sync Plugin

Multi-device sync for the festo360 tour: one **host** navigates, any number of **viewers**
mirror them in real time — scene, popups, 3D model rotate/zoom/explode/fullscreen, camera
look-around, and video playback. Built on Firebase Realtime Database + Anonymous Auth.

## Install

```html
<script type="module">
  import { VRSync } from "./vr-sync-plugin/src/index.js";

  VRSync.init({
    firebaseConfig: {
      projectId: "festo360-vr-sync",
      appId: "1:397595537354:web:828de91cf6c78cd741e933",
      storageBucket: "festo360-vr-sync.firebasestorage.app",
      apiKey: "AIzaSyAnxWkRHyspEZr-s_z_VlQLoV14-V5j6Tw",
      authDomain: "festo360-vr-sync.firebaseapp.com",
      messagingSenderId: "397595537354",
      databaseURL: "https://festo360-vr-sync-default-rtdb.firebaseio.com",
    },
  });

  // Host device:
  const sessionId = await VRSync.startHost();
  console.log("Share this code with viewers:", sessionId);

  // Viewer device:
  await VRSync.joinViewer("ABC123");
</script>
```

Must be `type="module"` — `FirebaseSync.js` imports the Firebase SDK as ES modules from
`gstatic.com`. Must be served over `http(s)`, not opened as a `file://` path (ES module
imports and Firebase auth both require it) — see [Local testing](#local-testing) below.

## API

- `VRSync.init({ firebaseConfig })` — call once, before `startHost`/`joinViewer`.
- `VRSync.startHost()` → `Promise<sessionId: string>` — becomes the host, creates a new
  6-character session code, starts broadcasting all local navigation.
- `VRSync.joinViewer(sessionId)` → `Promise<sessionId: string>` — joins an existing
  session as a viewer, catches up to whatever the host is currently showing, then mirrors
  everything the host does from that point on.
- `VRSync.stop()` — detaches all patched functions/listeners and stops the sync loops.

Viewers never broadcast their own local interaction — the model is strictly
host-leads/viewers-follow, not peer-to-peer.

## What syncs, and how

| What | Mechanism | File |
|---|---|---|
| Scene navigation | Wraps `window.openScene` | `EventDetector.js` / `ActionReplayer.js` |
| Popup open/close | Wraps `window.showPanel`, delegated click on `.message-close` | same |
| Camera look-around (yaw/pitch/fov) | Polls a hook added to `index.html`, lerped on viewer | `CameraSync.js` |
| Model rotate/zoom/explode/fullscreen | Polls a hook added to `index.html`, lerped on viewer | `ModelSync.js` |
| Video play/pause/seek | Capture-phase listeners on the real `<video>` element | `EventDetector.js` / `ActionReplayer.js` |

**Scene/popup/video sync are a true drop-in** — nothing in `index.html` needed to change,
because `openScene`/`showPanel` happen to be reachable as `window` properties (the tour's
whole app is one classic, non-module `<script>`, so its top-level `function` declarations
are real globals — confirmed by reading the actual export, not assumed), and `<video>` is
a standard DOM element with public play/pause/seek events.

**Camera and model sync are not** a pure drop-in. `yaw`/`pitch`/`fov` and the model
viewer's Three.js rotation/camera are function-local `let`/closure state with no exposed
getter or setter — there is no way to read or drive them from an external script. Two
small hook blocks (~30 lines total) were added directly into `index.html`, right next to
those variables so they can close over them: `window.__vrSyncViewHooks` (get/set the
panorama view) and `stageElement.vrSyncHooks` (get state / set rotation / set zoom / set
exploded / set fullscreen, attached fresh each time a model popup opens). If this plugin
is ever applied to a *different* tour export, those two blocks need to be re-added by
hand at the same two spots (search for `__vrSyncViewHooks` and `vrSyncHooks` in this
`index.html` to see exactly what was added and where).

Camera and model state also use a different sync shape than scene/popup: instead of
discrete events in `actions/`, they're continuous values in `live/`, polled every 150ms
and only written on change, with the viewer easing 25%-per-frame toward the latest value
(`requestAnimationFrame` loop) rather than snapping — see `firebase/schema.md` for the
full data shape and rationale.

## Local testing

ES modules need `http(s)`, not `file://`:

```
python -m http.server 8080
```

Then, with a `?vrsync=` query param (only active with that param — the tour behaves
normally without it):

- Host: `http://localhost:8080/index.html?vrsync=host`
- Viewer: `http://localhost:8080/index.html?vrsync=viewer&session=CODE` (code shown in
  the badge on the host page)

## Firebase project

Project `festo360-vr-sync`, Realtime Database instance
`festo360-vr-sync-default-rtdb` (us-central1). Created via `firebase-tools` CLI. Two
one-time setup steps had to be done by hand in the console, not the CLI — both were
genuine CLI limitations, not skipped steps:

- **Realtime Database location** — `firebase init database`'s location picker is an
  interactive list-select prompt that doesn't work over piped/non-TTY stdin.
- **Anonymous Auth provider** — enabling a sign-in provider isn't exposed by
  `firebase-tools` at all; it's console-only (Authentication → Sign-in method → Anonymous).

Security rules live in `firebase/database.rules.json`; deploy with:

```
firebase deploy --only database --project festo360-vr-sync
```

## Known limitations

- Video play/pause/seek sync is implemented but **untested against real data** — this
  demo project's `industrial-facility-demo.json` has no `video`-type hotspot to test
  against. The code path mirrors the popup-close pattern (capture-phase DOM listeners),
  which is well-exercised elsewhere, but hasn't been run end-to-end.
- No reconnect/retry logic yet if a viewer's connection drops mid-session (Phase 8).
- `expiresAt` (12h TTL) is enforced by the security rules (writes get rejected after),
  but nothing actually deletes expired session data — that needs a scheduled Cloud
  Function or manual cleanup, neither of which exist yet.
