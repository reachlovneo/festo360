const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity

function generateSessionId() {
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return id;
}

export class SessionManager {
  constructor(firebaseSync) {
    this.sync = firebaseSync;
    this.sessionId = null;
    this.role = null; // "host" | "viewer"
  }

  async startHost() {
    await this.sync.connect();
    this.sessionId = generateSessionId();
    this.role = "host";
    await this.sync.createSession(this.sessionId, SESSION_TTL_MS);
    return this.sessionId;
  }

  async joinViewer(sessionId) {
    await this.sync.connect();
    this.sessionId = sessionId.toUpperCase();
    this.role = "viewer";
    await this.sync.joinSession(this.sessionId);
    return this.sessionId;
  }

  isHost() {
    return this.role === "host";
  }
}
