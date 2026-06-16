"use client";

// Records the microphone to raw mono PCM alongside the WebRTC stream, so the
// speaker diarizer can re-analyse the whole conversation on demand. Capture is
// read-only on the shared MediaStream and never touches the translation path.
//
// Uses a ScriptProcessorNode: deprecated but universally supported and trivial
// for one mono 16-bit channel — no worklet module file / bundler config needed.
export class PcmRecorder {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private inRate = 48000;
  /** Wall-clock time (ms) capture started — the clock segments are mapped to. */
  startEpochMs = 0;

  async start(stream: MediaStream): Promise<void> {
    this.stop();
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) throw new Error("AudioContext unavailable");

    const ctx = new Ctor();
    this.ctx = ctx;
    this.inRate = ctx.sampleRate;
    this.source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    this.node = node;
    this.chunks = [];
    this.startEpochMs = Date.now();

    node.onaudioprocess = (e) => {
      // Copy — the underlying buffer is reused by the next callback.
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };

    // A muted sink keeps the ScriptProcessor pulling without audible output.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.sink = sink;
    this.source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);

    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // resume may reject if not gesture-driven; capture still proceeds.
      }
    }
  }

  get recording(): boolean {
    return !!this.node;
  }

  /** Total recorded samples at the original rate. */
  private get rawLength(): number {
    let n = 0;
    for (const c of this.chunks) n += c.length;
    return n;
  }

  /** Whole session as 16 kHz mono 16-bit PCM (what Falcon expects). */
  getPcm16k(): Int16Array {
    const total = this.rawLength;
    if (total === 0) return new Int16Array(0);
    const flat = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) {
      flat.set(c, o);
      o += c.length;
    }
    // Nearest-neighbour downsample. No anti-alias filter — fine for the coarse
    // voice features diarization relies on.
    const ratio = this.inRate / 16000;
    const outLen = Math.floor(flat.length / ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const s = flat[Math.floor(i * ratio)] ?? 0;
      out[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
    }
    return out;
  }

  /** Convert a wall-clock time to a sample index in the 16 kHz buffer. */
  msToSample16k(ms: number): number {
    if (!this.startEpochMs) return 0;
    return Math.max(0, Math.floor(((ms - this.startEpochMs) / 1000) * 16000));
  }

  stop(): void {
    try {
      this.node?.disconnect();
    } catch {}
    try {
      this.source?.disconnect();
    } catch {}
    try {
      this.sink?.disconnect();
    } catch {}
    if (this.node) this.node.onaudioprocess = null;
    try {
      void this.ctx?.close();
    } catch {}
    this.node = null;
    this.source = null;
    this.sink = null;
    this.ctx = null;
  }
}
