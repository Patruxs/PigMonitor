import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import { PanResponder, View, type ViewStyle } from "react-native";
import { viewSettings } from "../shared/rpc.ts";

const HANDLE_WIDTH = 8;

export function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.min(Math.max(width, minWidth), Math.max(minWidth, maxWidth));
}

export function useSavedListWidth(initialWidth: number): [number, (width: number) => void, (width: number) => void] {
  const stored = useSettings(viewSettings);
  const latestStored = useRef(stored);
  latestStored.current = stored;
  const [draggedWidth, setDraggedWidth] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  const savedWidth = stored.status === "ready" ? stored.values.listWidth : undefined;
  const saveWidth = (finalWidth: number) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const current = latestStored.current;
      if (current.status !== "ready") return;
      if (!(await current.save({ ...current.values, listWidth: Math.round(finalWidth) }, current.revision))) await current.reload();
    }, 300);
  };
  return [draggedWidth ?? savedWidth ?? initialWidth, setDraggedWidth, saveWidth];
}

export function ResizeHandle({ theme, width, minWidth, maxWidth, onResize, onResizeEnd }: { theme: PluginTheme; width: number; minWidth: number; maxWidth: number; onResize: (width: number) => void; onResizeEnd: (width: number) => void }) {
  const latest = useRef({ width, minWidth, maxWidth, onResize, onResizeEnd });
  latest.current = { width, minWidth, maxWidth, onResize, onResizeEnd };
  const dragStartWidth = useRef(width);
  const draggedWidth = useRef(width);
  const [dragging, setDragging] = useState(false);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragStartWidth.current = latest.current.width;
        draggedWidth.current = latest.current.width;
        setDragging(true);
      },
      onPanResponderMove: (_event, gesture) => {
        const { minWidth: min, maxWidth: max, onResize: resize } = latest.current;
        draggedWidth.current = clampWidth(dragStartWidth.current + gesture.dx, min, max);
        resize(draggedWidth.current);
      },
      onPanResponderRelease: () => {
        setDragging(false);
        latest.current.onResizeEnd(draggedWidth.current);
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        latest.current.onResizeEnd(draggedWidth.current);
      },
    }),
  ).current;
  const webOnlyStyle = { cursor: "col-resize", userSelect: "none" } as unknown as ViewStyle;
  return (
    <View
      {...responder.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel="Resize the session list"
      style={[{ position: "absolute", top: 0, bottom: 0, right: -HANDLE_WIDTH / 2, width: HANDLE_WIDTH, zIndex: 1, alignItems: "center" }, webOnlyStyle]}
    >
      <View style={{ width: 2, height: "100%", backgroundColor: dragging ? theme.colors.foregroundMuted : "transparent" }} />
    </View>
  );
}
