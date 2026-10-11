import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useState } from "react";
import { avatarDelete, avatarImage, avatarUpload } from "../../shared/rpc.ts";
import { boundedMap } from "./bounded-map.ts";

const AVATAR_PICTURE_CACHE_LIMIT = 64;

type CachedPicture = { loading: Promise<string | null>; settled?: string | null };

const pictures = boundedMap<string, CachedPicture>(AVATAR_PICTURE_CACHE_LIMIT);

function remember(id: string, uri: string | null): void {
  pictures.set(id, { loading: Promise.resolve(uri), settled: uri });
}

function loadAvatarPicture(id: string, call: (input: RpcInput<typeof avatarImage>) => Promise<RpcOutput<typeof avatarImage>>): CachedPicture {
  const known = pictures.get(id);
  if (known) return known;
  const entry: CachedPicture = {
    loading: call({ id }).then((result) => {
      if (result.ok) return `data:${result.mimeType};base64,${result.data}`;
      if (result.code === "missing" || result.code === "denied") return null;
      throw new Error(result.error);
    }),
  };
  entry.loading.then(
    (uri) => (entry.settled = uri),
    () => pictures.get(id) === entry && pictures.delete(id),
  );
  pictures.set(id, entry);
  return entry;
}

export function useAvatarPicture(id: string | undefined): string | null {
  const call = useRpc(avatarImage);
  const [uri, setUri] = useState<string | null>(() => (id ? (pictures.get(id)?.settled ?? null) : null));
  useEffect(() => {
    let live = true;
    if (!id) {
      setUri(null);
      return;
    }
    const entry = loadAvatarPicture(id, call);
    setUri(entry.settled ?? null);
    if (entry.settled === undefined)
      entry.loading.then(
        (loaded) => live && setUri(loaded),
        () => live && setUri(null),
      );
    return () => {
      live = false;
    };
  }, [id]);
  return uri;
}

export function useAvatarUpload(): (data: string, mimeType: string) => Promise<RpcOutput<typeof avatarUpload>> {
  const call = useRpc(avatarUpload);
  return useCallback(
    async (data, mimeType) => {
      const result = await call({ data, mimeType });
      if (result.ok) remember(result.id, `data:${mimeType};base64,${data}`);
      return result;
    },
    [call],
  );
}

export function useAvatarDelete(): (id: string) => Promise<RpcOutput<typeof avatarDelete>> {
  const call = useRpc(avatarDelete);
  return useCallback(
    async (id) => {
      const result = await call({ id });
      if (result.ok) remember(id, null);
      return result;
    },
    [call],
  );
}
