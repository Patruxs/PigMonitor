import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, Text, TextInput, View, type NativeSyntheticEvent, type PressableStateCallbackType, type TextStyle } from "react-native";
import { MAX_IMAGES, type ImageData } from "../shared/rpc.ts";
import { ICON_SIZE, RADIUS, SPACING, text } from "./kit/theme.ts";

export type Picked = ImageData & { key: string; uri: string };

const BOX_RADIUS = 16;
const THUMB = 56;
const ROUND = 32;
const STOP_GLYPH = 10;
const NO_OUTLINE = { outlineStyle: "none", outlineWidth: 0 } as unknown as TextStyle;

const dom = globalThis as { document?: Document; FileReader?: typeof FileReader };
export const canAttach = dom.document !== undefined && dom.FileReader !== undefined;

function readImage(file: Blob): Promise<Picked | null> {
  return new Promise((resolve) => {
    if (!dom.FileReader || !file.type.startsWith("image/")) return resolve(null);
    const reader = new dom.FileReader();
    reader.onload = () => {
      const uri = String(reader.result ?? "");
      const comma = uri.indexOf(",");
      if (comma < 0) return resolve(null);
      resolve({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, uri, data: uri.slice(comma + 1), mimeType: file.type });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function readImages(files: Blob[]): Promise<Picked[]> {
  const read = await Promise.all(files.map(readImage));
  return read.filter((p): p is Picked => p !== null);
}

function chooseImages(): Promise<Picked[]> {
  return new Promise((resolve) => {
    const doc = dom.document;
    if (!doc) return resolve([]);
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => void readImages(Array.from(input.files ?? [])).then(resolve);
    input.click();
  });
}

type Draft = { text: string; images: Picked[] };
const drafts = new Map<string, Draft>();

function hoveredOf(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

function Thumb({ theme, image, onRemove }: { theme: PluginTheme; image: Picked; onRemove: () => void }) {
  return (
    <View style={{ width: THUMB, height: THUMB }}>
      <Image source={{ uri: image.uri }} style={{ width: THUMB, height: THUMB, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.colors.border }} resizeMode="cover" accessibilityLabel="Attached image" />
      <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel="Remove image" hitSlop={SPACING[1]} style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}>
        <Icon name="X" size={11} color={theme.colors.foreground} />
      </Pressable>
    </View>
  );
}

export function Composer({ theme, placeholder, disabled, hint, controls, draftKey, stop, onSend }: { theme: PluginTheme; placeholder: string; disabled?: boolean; hint?: string; controls?: ReactNode; draftKey?: string; stop?: { running: boolean; onStop: () => Promise<string | null> }; onSend: (body: string, images: ImageData[]) => Promise<string | null> }) {
  const [draft, setDraft] = useState(() => (draftKey === undefined ? "" : drafts.get(draftKey)?.text ?? ""));
  const [images, setImages] = useState<Picked[]>(() => (draftKey === undefined ? [] : drafts.get(draftKey)?.images ?? []));
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  const add = (more: Picked[]) => setImages((had) => [...had, ...more].slice(0, MAX_IMAGES));
  useEffect(() => {
    const node = input.current as unknown as HTMLElement | null;
    if (!canAttach || !node?.addEventListener) return;
    const onPaste = (e: Event) => {
      const items = Array.from((e as ClipboardEvent).clipboardData?.items ?? []);
      const files = items.filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => f !== null);
      if (files.length === 0) return;
      e.preventDefault();
      void readImages(files).then(add);
    };
    node.addEventListener("paste", onPaste);
    return () => node.removeEventListener("paste", onPaste);
  }, []);
  useEffect(() => {
    if (draftKey === undefined) return;
    if (draft.length === 0 && images.length === 0) drafts.delete(draftKey);
    else drafts.set(draftKey, { text: draft, images });
  }, [draftKey, draft, images]);
  const body = draft.trim();
  const hasContent = body.length > 0 || images.length > 0;
  const canSend = hasContent && !busy && !disabled;
  const running = stop?.running === true;
  const halt = async () => {
    if (!stop || stopping) return;
    setStopping(true);
    setError(null);
    const failed = await stop.onStop();
    setStopping(false);
    if (failed) setError(failed);
  };
  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    const failed = await onSend(body, images.map(({ data, mimeType }) => ({ data, mimeType })));
    setBusy(false);
    if (failed) return setError(failed);
    if (draftKey !== undefined && drafts.get(draftKey)?.text === draft && drafts.get(draftKey)?.images === images) drafts.delete(draftKey);
    setDraft("");
    setImages([]);
  };
  const onKey = (e: NativeSyntheticEvent<{ key: string; shiftKey?: boolean }>) => {
    if (e.nativeEvent.key === "Enter" && !e.nativeEvent.shiftKey) {
      (e as unknown as { preventDefault?: () => void }).preventDefault?.();
      void submit();
    }
  };
  const round = (on: boolean) => (state: PressableStateCallbackType) => ({ width: ROUND, height: ROUND, borderRadius: ROUND / 2, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: on ? theme.colors.accent : state.pressed ? theme.colors.surface2 : hoveredOf(state) ? theme.colors.surface2 : "transparent" });
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface0, paddingHorizontal: SPACING[4], paddingTop: SPACING[3], paddingBottom: SPACING[3], gap: SPACING[1.5] }}>
      {error ? <Text style={text(theme, "label", "statusDanger")}>{error}</Text> : null}
      <View style={{ borderRadius: BOX_RADIUS, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1, paddingHorizontal: SPACING[2], paddingTop: SPACING[2], paddingBottom: SPACING[1.5], gap: SPACING[1.5], opacity: disabled ? 0.6 : 1 }}>
        {images.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING[2], paddingHorizontal: SPACING[1], paddingTop: SPACING[1] }}>
            {images.map((image) => (
              <Thumb key={image.key} theme={theme} image={image} onRemove={() => setImages((had) => had.filter((h) => h.key !== image.key))} />
            ))}
          </View>
        ) : null}
        <TextInput
          ref={input}
          value={draft}
          onChangeText={setDraft}
          onKeyPress={onKey}
          editable={!disabled && !busy}
          multiline
          blurOnSubmit={false}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.foregroundMuted}
          accessibilityLabel={placeholder}
          style={[text(theme, "rowTitle"), { minHeight: 24, maxHeight: 200, paddingHorizontal: SPACING[1], paddingVertical: SPACING[1], lineHeight: 22, borderWidth: 0 }, NO_OUTLINE]}
        />
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {canAttach ? (
            <Pressable onPress={() => void chooseImages().then(add)} disabled={disabled || busy || images.length >= MAX_IMAGES} accessibilityRole="button" accessibilityLabel="Attach images" style={round(false)}>
              <Icon name="Plus" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}>{controls}</View>
          {running ? (
            <Pressable onPress={() => void halt()} disabled={stopping} accessibilityRole="button" accessibilityLabel="Stop" style={(state) => ({ width: ROUND, height: ROUND, borderRadius: ROUND / 2, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.statusDanger, opacity: state.pressed || hoveredOf(state) ? 0.85 : 1 })}>
              {stopping ? <Icon name="Loader" size={ICON_SIZE.md} color={theme.colors.surface0} /> : <View style={{ width: STOP_GLYPH, height: STOP_GLYPH, borderRadius: 2, backgroundColor: theme.colors.surface0 }} />}
            </Pressable>
          ) : null}
          {!running || hasContent ? (
            <Pressable onPress={() => void submit()} disabled={!canSend} accessibilityRole="button" accessibilityLabel="Send" style={(state) => ({ ...round(canSend)(state), marginLeft: running ? SPACING[1] : 0 })}>
              <Icon name={busy ? "Loader" : "ArrowUp"} size={ICON_SIZE.md} color={canSend ? theme.colors.surface0 : theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {hint ? (
        <Text style={[text(theme, "label"), { paddingHorizontal: SPACING[3] }]} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
