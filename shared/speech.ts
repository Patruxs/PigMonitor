export const DICTATION_SAMPLE_RATE = 16000;
export const DICTATION_FORMAT = `audio/pcm;rate=${DICTATION_SAMPLE_RATE};bits=16`;
export const DICTATION_CHUNK_SAMPLES = DICTATION_SAMPLE_RATE;
export const MAX_DICTATION_CHUNKS = 600;

export type DictationStatus = "idle" | "recording" | "uploading" | "failed";

function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

export function resampleToPcm16(input: Float32Array, inputRate: number, outputRate: number = DICTATION_SAMPLE_RATE): Int16Array {
  if (input.length === 0) return new Int16Array(0);
  if (inputRate === outputRate) return Int16Array.from(input, floatToInt16);
  const ratio = inputRate / outputRate;
  const output = new Int16Array(Math.max(1, Math.round(input.length / ratio)));
  for (let i = 0; i < output.length; i++) {
    const position = i * ratio;
    const before = Math.min(input.length - 1, Math.floor(position));
    const after = Math.min(input.length - 1, before + 1);
    const fraction = position - before;
    output[i] = floatToInt16(input[before] * (1 - fraction) + input[after] * fraction);
  }
  return output;
}

export function volumeOf(input: Float32Array): number {
  let sumOfSquares = 0;
  for (const sample of input) sumOfSquares += sample * sample;
  return Math.min(1, Math.sqrt(sumOfSquares / Math.max(1, input.length)) * 2);
}

export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export class PcmChunker {
  private pending = new Int16Array(0);
  private readonly chunks: string[] = [];
  private readonly chunkSamples: number;

  constructor(chunkSamples: number = DICTATION_CHUNK_SAMPLES) {
    this.chunkSamples = chunkSamples;
  }

  push(pcm: Int16Array): void {
    const joined = new Int16Array(this.pending.length + pcm.length);
    joined.set(this.pending, 0);
    joined.set(pcm, this.pending.length);
    let offset = 0;
    while (joined.length - offset >= this.chunkSamples) {
      this.chunks.push(int16ToBase64(joined.subarray(offset, offset + this.chunkSamples)));
      offset += this.chunkSamples;
    }
    this.pending = joined.slice(offset);
  }

  finish(): string[] {
    if (this.pending.length > 0) this.chunks.push(int16ToBase64(this.pending));
    this.pending = new Int16Array(0);
    return this.chunks.splice(0);
  }
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function withTranscript(draft: string, transcript: string): string {
  if (!transcript) return draft;
  return draft.length > 0 && !/\s$/.test(draft) ? `${draft} ${transcript}` : `${draft}${transcript}`;
}
