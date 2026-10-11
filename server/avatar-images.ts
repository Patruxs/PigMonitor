import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { messageOf } from "../shared/errors.ts";
import { imageInUse, type AvatarSettings } from "../shared/piggery/avatar.ts";
import { pastedImageSaver, readImage, type ImageResult } from "./image.ts";

export const MAX_STORED_AVATAR_BYTES = 512 * 1024;

const AVATAR_ID = /^[0-9a-f]{24}$/;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const KINDS = [
  { mimeType: "image/webp", extension: "webp", matches: (bytes: Buffer) => bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP" },
  { mimeType: "image/png", extension: "png", matches: (bytes: Buffer) => bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) },
  { mimeType: "image/jpeg", extension: "jpg", matches: (bytes: Buffer) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
];

type Refusal = { ok: false; code: "missing" | "denied" | "failed"; error: string };

const NO_HOME: Refusal = { ok: false, code: "denied", error: "This observe-only Paseo daemon has no Paseo home of its own, so it keeps no avatar pictures." };

function badId(id: string): Refusal | null {
  return AVATAR_ID.test(id) ? null : { ok: false, code: "denied", error: `${JSON.stringify(id.slice(0, 40))} is not an avatar picture id.` };
}

export function avatarStore(dir: string | null, readSettings: () => Promise<AvatarSettings | null>) {
  const save = dir === null ? null : pastedImageSaver(dir);
  const filesOf = (id: string) => (dir === null ? [] : KINDS.map((kind) => path.join(dir, `${id}.${kind.extension}`)));

  return {
    upload(data: string, mimeType: string): { ok: true; id: string } | Refusal {
      if (save === null) return NO_HOME;
      const kind = KINDS.find((known) => known.mimeType === mimeType);
      if (!kind) return { ok: false, code: "denied", error: "An avatar picture must be a WebP, PNG or JPEG image." };
      const tooLarge: Refusal = { ok: false, code: "denied", error: `An avatar picture can be at most ${MAX_STORED_AVATAR_BYTES / 1024} KB.` };
      if (data.length > Math.ceil(MAX_STORED_AVATAR_BYTES / 3) * 4) return tooLarge;
      if (!BASE64.test(data)) return { ok: false, code: "denied", error: "The avatar picture is not base64 encoded." };
      const bytes = Buffer.from(data, "base64");
      if (bytes.length > MAX_STORED_AVATAR_BYTES) return tooLarge;
      if (!kind.matches(bytes)) return { ok: false, code: "denied", error: `The avatar picture is not really a ${kind.extension.toUpperCase()} image.` };
      const file = save(bytes.toString("base64"), kind.mimeType);
      if (!file) return { ok: false, code: "failed", error: `Could not save the avatar picture in ${dir}.` };
      return { ok: true, id: path.basename(file, path.extname(file)) };
    },

    async image(id: string): Promise<ImageResult | Refusal> {
      const refused = badId(id);
      if (refused) return refused;
      if (dir === null) return NO_HOME;
      const file = filesOf(id).find((candidate) => existsSync(candidate));
      if (!file) return { ok: false, code: "missing", error: `There is no avatar picture ${id}.` };
      return readImage(file, [dir], MAX_STORED_AVATAR_BYTES);
    },

    async delete(id: string): Promise<{ ok: true } | Refusal> {
      const refused = badId(id);
      if (refused) return refused;
      if (dir === null) return NO_HOME;
      const settings = await readSettings().catch(() => null);
      if (settings === null) return { ok: false, code: "failed", error: `Could not read the avatar settings, so avatar picture ${id} is kept in case a role still uses it.` };
      if (imageInUse(settings, id)) return { ok: false, code: "denied", error: `Avatar picture ${id} is still in a role's library, so it is kept.` };
      try {
        for (const file of filesOf(id)) rmSync(file, { force: true });
        return { ok: true };
      } catch (error) {
        return { ok: false, code: "failed", error: `Could not delete avatar picture ${id}: ${messageOf(error)}` };
      }
    },
  };
}
