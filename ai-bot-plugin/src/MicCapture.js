// Captures the microphone and delivers base64-encoded 16kHz mono 16-bit PCM chunks, the format
// the Gemini Live API's realtimeInput.audio expects. Uses ScriptProcessorNode rather than
// AudioWorkletNode - deprecated, but needs no separate worklet module file to vendor/load, and
// works uniformly across the older/embedded browsers a VR headset is likely to ship.
export class MicCapture {
  constructor({ onChunk }) {
    this.onChunk = onChunk;
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    // 4096 samples at the context's native rate (44.1/48kHz) is roughly a 90-100ms chunk -
    // small enough to feel responsive, large enough not to flood the socket with messages.
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processorNode.onaudioprocess = (event) => {
      const inputSamples = event.inputBuffer.getChannelData(0);
      const pcm16 = downsampleTo16kHzPcm16(inputSamples, this.audioContext.sampleRate);
      this.onChunk(pcm16ToBase64(pcm16));
    };
    this.sourceNode.connect(this.processorNode);
    // A ScriptProcessorNode only fires onaudioprocess while connected into the graph's output -
    // connecting to destination at zero gain would still route real audio to the speakers, so
    // route through a silent gain node instead, just to keep the processor alive.
    const silentSink = this.audioContext.createGain();
    silentSink.gain.value = 0;
    this.processorNode.connect(silentSink);
    silentSink.connect(this.audioContext.destination);
  }

  stop() {
    if (this.processorNode) this.processorNode.disconnect();
    if (this.sourceNode) this.sourceNode.disconnect();
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    if (this.audioContext) void this.audioContext.close();
    this.processorNode = null;
    this.sourceNode = null;
    this.stream = null;
    this.audioContext = null;
  }
}

function downsampleTo16kHzPcm16(float32Samples, sourceSampleRate) {
  const targetSampleRate = 16000;
  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.floor(float32Samples.length / ratio);
  const pcm16 = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    // Linear interpolation between the two nearest source samples - cheap and good enough for
    // speech; a proper anti-aliasing filter is unnecessary at this ratio for voice content.
    const sourceIndex = i * ratio;
    const lowIndex = Math.floor(sourceIndex);
    const highIndex = Math.min(lowIndex + 1, float32Samples.length - 1);
    const weight = sourceIndex - lowIndex;
    const sample = float32Samples[lowIndex] * (1 - weight) + float32Samples[highIndex] * weight;
    const clamped = Math.max(-1, Math.min(1, sample));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm16;
}

function pcm16ToBase64(pcm16) {
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
