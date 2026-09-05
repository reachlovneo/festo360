// Decodes base64 16-bit PCM audio chunks from the Gemini Live API (24kHz mono) and schedules
// them back-to-back on a single AudioContext so playback doesn't gap or overlap between chunks
// arriving at different times over the socket.
export class AudioPlayback {
  constructor() {
    this.audioContext = null;
    this.nextStartTime = 0;
    this.onSpeakingChange = null;
    this.scheduledSourceCount = 0;
  }

  ensureContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.nextStartTime = this.audioContext.currentTime;
    }
    return this.audioContext;
  }

  enqueueBase64Pcm24kHz(base64Data) {
    const context = this.ensureContext();
    const pcm16 = base64ToPcm16(base64Data);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);

    const buffer = context.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startTime = Math.max(this.nextStartTime, context.currentTime);
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;

    this.scheduledSourceCount++;
    if (this.onSpeakingChange) this.onSpeakingChange(true);
    source.onended = () => {
      this.scheduledSourceCount--;
      if (this.scheduledSourceCount <= 0 && this.onSpeakingChange) this.onSpeakingChange(false);
    };
  }

  stop() {
    if (this.audioContext) void this.audioContext.close();
    this.audioContext = null;
    this.nextStartTime = 0;
    this.scheduledSourceCount = 0;
  }
}

function base64ToPcm16(base64Data) {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
