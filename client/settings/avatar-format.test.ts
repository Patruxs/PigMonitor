import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackFormat, hasTransparency } from "./avatar-format.ts";

test("without WebP a picture with any see-through pixel is stored losslessly and an opaque one as JPEG", () => {
  const opaque = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
  const oneClearPixel = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 254]);
  assert.equal(fallbackFormat(hasTransparency(opaque)).type, "image/jpeg");
  assert.equal(fallbackFormat(hasTransparency(oneClearPixel)).type, "image/png");
});
