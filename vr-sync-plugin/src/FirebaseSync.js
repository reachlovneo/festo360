import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  push,
  set,
  update,
  get,
  onChildAdded,
  onValue,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// A handful of retries with backoff covers the transient case (a network
// blip, a momentary offline blip while a device's wifi hands off) without
// hiding a real, persistent failure (bad config, rules rejecting the write)
// past 3 attempts - those should still surface quickly, not retry forever.
async function withRetry(fn, { retries = 3, delayMs = 400 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

export class FirebaseSync {
  constructor(firebaseConfig) {
    this.app = initializeApp(firebaseConfig);
    this.auth = getAuth(this.app);
    this.db = getDatabase(this.app);
    this.uid = null;
  }

  async connect() {
    try {
      const { user } = await withRetry(() => signInAnonymously(this.auth));
      this.uid = user.uid;
      return this.uid;
    } catch (err) {
      throw new Error(
        `VRSync: could not sign in anonymously (${err.message}). Check that Anonymous Auth is enabled for this Firebase project.`
      );
    }
  }

  sessionRef(sessionId, ...path) {
    return ref(this.db, ["sessions", sessionId, ...path].join("/"));
  }

  async createSession(sessionId, ttlMs) {
    const now = Date.now();
    await withRetry(() =>
      set(this.sessionRef(sessionId), {
        hostId: this.uid,
        createdAt: serverTimestamp(),
        expiresAt: now + ttlMs,
      })
    );
  }

  async joinSession(sessionId) {
    await withRetry(() => update(this.sessionRef(sessionId, "viewers"), { [this.uid]: true }));
  }

  // Best-effort broadcasts, called fire-and-forget from event handlers -
  // retry transient failures, but never throw into an unhandled rejection
  // over a single dropped write. Losing one popup_open isn't fatal (the
  // viewer just doesn't see that one popup); throwing out of a DOM event
  // handler would be worse, it could break the host's own local UI.
  async sendAction(sessionId, type, payload) {
    try {
      const actionsRef = this.sessionRef(sessionId, "actions");
      const newActionRef = push(actionsRef);
      await withRetry(() => set(newActionRef, { type, payload, ts: Date.now() }));
      return newActionRef.key;
    } catch (err) {
      console.warn(`VRSync: failed to broadcast "${type}" after retries`, err);
      return null;
    }
  }

  async setState(sessionId, state) {
    try {
      await withRetry(() => set(this.sessionRef(sessionId, "state"), state));
    } catch (err) {
      console.warn("VRSync: failed to update session state after retries", err);
    }
  }

  onAction(sessionId, callback) {
    const actionsRef = this.sessionRef(sessionId, "actions");
    const attachedAt = Date.now();
    return onChildAdded(actionsRef, (snap) => {
      const action = snap.val();
      if (action.ts < attachedAt) return; // ignore history predating listener attach
      callback(action, snap.key);
    });
  }

  // One-time read, used only for a viewer's initial catch-up on join.
  // Live updates after that come from onAction, not this - state has no
  // ongoing listener, so a late popup_open doesn't get applied twice.
  async getStateOnce(sessionId) {
    const snap = await get(this.sessionRef(sessionId, "state"));
    return snap.exists() ? snap.val() : null;
  }

  // "live" is a different shape of sync than "actions": continuous, high-
  // frequency, latest-value-wins state (camera view, model rotation/zoom).
  // Overwritten in place rather than appended, and viewers subscribe with an
  // ongoing listener rather than a one-time read - the opposite tradeoffs
  // from state/actions above, deliberately, because there's no sensible way
  // to "replay" a stream of camera angles as discrete events. No retry here -
  // it's polled every 150ms, so a dropped write is superseded by the next
  // tick anyway; retrying a stale camera angle would just add lag.
  async setLive(sessionId, key, value) {
    try {
      await set(this.sessionRef(sessionId, "live", key), value);
    } catch (err) {
      console.warn(`VRSync: failed to update live "${key}"`, err);
    }
  }

  onLive(sessionId, key, callback) {
    return onValue(this.sessionRef(sessionId, "live", key), (snap) => {
      if (snap.exists()) callback(snap.val());
    });
  }
}
