import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { rasterImageMimeType, type ImageMetadata } from "./composer-logic.ts";
import { readImageFile } from "./attachments.tsx";
import { SPACING } from "../kit/theme.ts";

interface FileDropSink {
  onFiles: (images: ImageMetadata[]) => void;
  onGenericFiles: (files: File[]) => void;
}

interface FileDropContextValue {
  registerSink: (getSink: () => FileDropSink | null) => () => void;
  setSuppressed: (suppressed: boolean) => void;
}

const FileDropContext = createContext<FileDropContextValue | null>(null);

const dom = globalThis as { document?: Document };

export function FileDropZone({ theme, style, children }: { theme: PluginTheme; style?: ViewStyle; children: ReactNode }) {
  const container = useRef<View>(null);
  const activeGetSink = useRef<(() => FileDropSink | null) | null>(null);
  const suppressed = useRef(false);
  const dragCounter = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const registerSink = useCallback((getSink: () => FileDropSink | null) => {
    activeGetSink.current = getSink;
    return () => {
      if (activeGetSink.current === getSink) activeGetSink.current = null;
    };
  }, []);
  const setSuppressed = useCallback((next: boolean) => {
    suppressed.current = next;
    if (next) {
      setIsDragging(false);
      dragCounter.current = 0;
    }
  }, []);
  const ctx = useMemo(() => ({ registerSink, setSuppressed }), [registerSink, setSuppressed]);
  useEffect(() => {
    const element = container.current as unknown as HTMLElement | null;
    if (!dom.document || !element?.addEventListener) return;
    const accepts = (e: DragEvent) => new Set(e.dataTransfer?.types ?? []).has("Files");
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current++;
      if (suppressed.current || !activeGetSink.current) return;
      if (accepts(e)) setIsDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.dataTransfer) return;
      e.dataTransfer.dropEffect = accepts(e) && !suppressed.current && activeGetSink.current ? "copy" : "none";
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsDragging(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;
      const sink = activeGetSink.current?.();
      if (suppressed.current || !sink) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      const generic = files.filter((file) => !rasterImageMimeType({ mimeType: file.type, fileName: file.name }));
      if (generic.length > 0) sink.onGenericFiles(generic);
      const images = files.filter((file) => rasterImageMimeType({ mimeType: file.type, fileName: file.name }));
      if (images.length === 0) return;
      void Promise.all(images.map(readImageFile)).then(
        (read) => sink.onFiles(read.filter((image): image is ImageMetadata => image !== null)),
        (error) => console.error("[PigMonitor] Failed to process dropped files:", error),
      );
    };
    element.addEventListener("dragenter", onDragEnter);
    element.addEventListener("dragover", onDragOver);
    element.addEventListener("dragleave", onDragLeave);
    element.addEventListener("drop", onDrop);
    return () => {
      element.removeEventListener("dragenter", onDragEnter);
      element.removeEventListener("dragover", onDragOver);
      element.removeEventListener("dragleave", onDragLeave);
      element.removeEventListener("drop", onDrop);
    };
  }, []);
  return (
    <FileDropContext.Provider value={ctx}>
      <View ref={container} style={[{ position: "relative" }, style]}>
        {children}
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", zIndex: 1000, opacity: isDragging ? 1 : 0, pointerEvents: "none", transitionProperty: "opacity", transitionDuration: "150ms" } as ViewStyle}>
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.surface0, opacity: 0.7 }} />
          <View style={{ alignItems: "center", gap: SPACING[2] }}>
            <Icon name="Upload" size={32} color={theme.colors.foreground} />
            <Text style={{ fontSize: 14, fontWeight: "500", color: theme.colors.foreground }}>Drop files here</Text>
          </View>
        </View>
      </View>
    </FileDropContext.Provider>
  );
}

export function useFileDrop(sink: FileDropSink, options: { disabled: boolean }): void {
  const ctx = useContext(FileDropContext);
  const sinkRef = useRef(sink);
  sinkRef.current = sink;
  const registerSink = ctx?.registerSink;
  useEffect(() => {
    if (!registerSink) return;
    return registerSink(() => sinkRef.current);
  }, [registerSink]);
  const setSuppressed = ctx?.setSuppressed;
  useEffect(() => {
    if (!setSuppressed) return;
    setSuppressed(options.disabled);
    return () => setSuppressed(false);
  }, [setSuppressed, options.disabled]);
}
