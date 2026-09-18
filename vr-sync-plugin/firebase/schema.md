# Realtime Database Schema

Project: `festo360-vr-sync` · Instance: `festo360-vr-sync-default-rtdb`

```
sessions/
  {sessionId}/                    6-char code, e.g. "ABC123"
    hostId: string                 anonymous auth uid of host
    createdAt: number              server timestamp (ms)
    expiresAt: number              createdAt + 12h, enforced by rules
    viewers/
      {viewerUid}: true
    actions/
      {actionId}/                  push id, auto-ordered by time
        type: string                "scene_change" | "popup_open" | "popup_close" |
                                      "video_play" | "video_pause" | "video_seek"
        payload: object              type-specific data, omitted entirely when empty
                                      (Firebase drops empty/null values on write - the
                                      rules only require type+ts, never payload)
        ts: number                   client timestamp (ms)
    state/                         latest full snapshot, for viewers joining mid-session
      sceneId: string | null
      popupHotspot: object | null    full hotspot object, see below
    live/                          continuous state, overwritten not appended - see below
      camera: { yaw, pitch, fov } | null
      model: { rotationX, rotationY, zoom, exploded, fullscreen } | null
```

## Action payloads

- `scene_change` → `{ sceneId }`
- `popup_open` → `{ hotspot }` - the **entire** hotspot object (id, type, title,
  description, position, assetId/objectAssetId, aiFacts, etc.), not just its id.
  Deliberate: the plugin attaches as a deferred `type="module"` script, which always
  runs after the tour's own classic `<script>` has already loaded its first scene -
  so there's no reliable way to know "the current scene" to look the hotspot back up
  by id on the viewer. Hotspots are plain JSON data (confirmed against the tour's own
  export format), so broadcasting the whole object and calling `showPanel(hotspot)`
  directly on the viewer sidesteps that lookup entirely.
- `popup_close` → no payload
- `video_play` / `video_pause` / `video_seek` → `{ currentTime }`

## Live state (camera + model)

Unlike actions, `live/camera` and `live/model` are **overwritten in place** and viewers
subscribe with an **ongoing listener**, not a one-time read - the opposite tradeoffs
from `state`/`actions`, because there's no sensible way to "replay" a stream of camera
angles as discrete events. Host polls every 150ms and only writes on change; viewer eases
toward the latest value every animation frame (25%-per-frame lerp) rather than snapping,
so it reads as a smooth pan/rotate instead of a jump-cut.

Both depend on hooks added directly to `index.html` (`window.__vrSyncViewHooks` and
`stageElement.vrSyncHooks`) - `yaw`/`pitch`/`fov` and the model's Three.js rotation/camera
are function-local `let`/closure state with no exported getter/setter, unlike
`openScene`/`showPanel`, which happened to already be reachable globals. This is the one
place this plugin isn't a pure drop-in: mirroring continuous view state needs ~30 lines
placed in the exported tour's own script. Scene/popup/video sync do not need this.

- `live/camera` is written whenever a host session is active (there's always a current view).
- `live/model` is written only while a model-having popup is open on the host; `null`
  otherwise, which viewers ignore since `document.querySelector('#message .model-stage')`
  won't exist on their end either once their own popup_close has been applied.

## Notes

- `actions` is append-only and time-ordered via Firebase push keys; clients trim/ignore actions older than their last-applied timestamp.
- `state` is overwritten (not appended) so a viewer joining late can sync to current state in one read instead of replaying the full action log.
- `expiresAt` is enforced in `database.rules.json` — writes to `actions`/`state`/`live` are rejected once a session passes its 12h TTL. Actual node deletion still needs a scheduled cleanup (Cloud Function or manual), rules only stop new writes.
