import assert from "node:assert/strict";
import test from "node:test";
import { PcmChunker, resampleToPcm16 } from "./speech.ts";

function samplesOf(base64: string): Int16Array {
  const bytes = Buffer.from(base64, "base64");
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

test("resampling 48 kHz to 16 kHz keeps one sample in three and maps full scale to int16 limits", () => {
  const input = Float32Array.from({ length: 4800 }, (_, i) => (i % 3 === 0 ? (i % 6 === 0 ? 1 : -1) : 0));
  const output = resampleToPcm16(input, 48000, 16000);
  assert.equal(output.length, 1600);
  assert.equal(output[0], 32767);
  assert.equal(output[1], -32768);
  assert.equal(output[2], 32767);
});

test("resampling clamps samples outside [-1, 1] and passes equal rates through", () => {
  assert.deepEqual(Array.from(resampleToPcm16(Float32Array.from([2, -2, 0.5]), 16000, 16000)), [32767, -32768, 16384]);
});

test("the chunker cuts whole chunks as audio arrives and flushes the remainder on finish, as little-endian PCM16", () => {
  const chunker = new PcmChunker(4);
  chunker.push(Int16Array.from([1, 2, 3]));
  chunker.push(Int16Array.from([4, 5, 6, 7, 8, 9, 10]));
  const chunks = chunker.finish();
  assert.deepEqual(chunks.map((chunk) => Array.from(samplesOf(chunk))), [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]);
  assert.deepEqual(Array.from(Buffer.from(chunks[0], "base64").subarray(0, 2)), [1, 0]);
  assert.deepEqual(chunker.finish(), []);
});
