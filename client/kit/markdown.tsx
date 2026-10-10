import type { PluginTheme, RpcInput, RpcOutput } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, Linking, Text, View, type TextStyle } from "react-native";
import { imagesIn, parseMarkdown, type Block, type Inline } from "../../shared/markdown.ts";
import { imageFile } from "../../shared/rpc.ts";
import { RADIUS, SPACING, text } from "./theme.ts";

const IMAGE_MAX_HEIGHT = 400;
const MARKER_WIDTH = 20;

type Picture = { uri: string; width: number; height: number };

const pictures = new Map<string, Promise<Picture>>();

function sizeOf(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
}

function loadPicture(path: string, call: (input: RpcInput<typeof imageFile>) => Promise<RpcOutput<typeof imageFile>>): Promise<Picture> {
  const known = pictures.get(path);
  if (known) return known;
  const loading = call({ path }).then(async (result) => {
    if (!result.ok) throw new Error(result.error);
    const uri = `data:${result.mimeType};base64,${result.data}`;
    return { uri, ...(await sizeOf(uri)) };
  });
  pictures.set(path, loading);
  loading.catch(() => pictures.delete(path));
  return loading;
}

function codeSpan(theme: PluginTheme): TextStyle {
  return { fontFamily: "monospace", fontSize: 12.5, color: theme.colors.foreground, backgroundColor: theme.colors.surface2, borderRadius: 4, paddingHorizontal: 3 };
}

function PictureOf({ theme, path, alt }: { theme: PluginTheme; path: string; alt: string }) {
  const call = useRpc(imageFile);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setPicture(null);
    setFailure(null);
    loadPicture(path, call).then(
      (loaded) => live && setPicture(loaded),
      (error: unknown) => live && setFailure(String((error as Error).message ?? error)),
    );
    return () => {
      live = false;
    };
  }, [path]);
  return (
    <View style={{ alignItems: "flex-start", gap: SPACING[1] }}>
      {picture && picture.width > 0 && picture.height > 0 ? (
        <Image
          source={{ uri: picture.uri }}
          accessibilityLabel={alt || path}
          resizeMode="contain"
          style={{ width: Math.min(picture.width, (IMAGE_MAX_HEIGHT * picture.width) / picture.height), maxWidth: "100%", aspectRatio: picture.width / picture.height, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.colors.border }}
        />
      ) : (
        <Text style={[text(theme, "code"), codeSpan(theme)]} selectable>
          {path}
        </Text>
      )}
      {picture ? (
        <Text style={text(theme, "label")} selectable>
          {alt ? `${alt} · ${path}` : path}
        </Text>
      ) : failure ? (
        <Text style={text(theme, "label", "statusWarning")} numberOfLines={2}>
          {failure}
        </Text>
      ) : null}
    </View>
  );
}

function InlineNodes({ theme, nodes }: { theme: PluginTheme; nodes: Inline[] }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "bold":
        return (
          <Text key={index} style={{ fontWeight: "600" }}>
            <InlineNodes theme={theme} nodes={node.children} />
          </Text>
        );
      case "italic":
        return (
          <Text key={index} style={{ fontStyle: "italic" }}>
            <InlineNodes theme={theme} nodes={node.children} />
          </Text>
        );
      case "code":
        return (
          <Text key={index} style={codeSpan(theme)}>
            {node.text}
          </Text>
        );
      case "image":
        return (
          <Text key={index} style={codeSpan(theme)}>
            {node.path}
          </Text>
        );
      case "link":
        return (
          <Text key={index} style={{ color: theme.colors.accent, textDecorationLine: "underline" }} onPress={() => void Linking.openURL(node.href)}>
            <InlineNodes theme={theme} nodes={node.children} />
          </Text>
        );
    }
  });
}

function standsAlone(inlines: Inline[], index: number): boolean {
  const before = inlines[index - 1];
  const after = inlines[index + 1];
  const startsLine = !before || (before.kind === "text" && /\n[ \t]*$/.test(before.text));
  const endsLine = !after || (after.kind === "text" && /^[ \t]*(\n|$)/.test(after.text));
  return inlines[index].kind === "image" && startsLine && endsLine;
}

function proseOf(inlines: Inline[]): Inline[] {
  const prose: Inline[] = [];
  inlines.forEach((node, index) => {
    if (standsAlone(inlines, index)) return;
    const last = prose[prose.length - 1];
    if (node.kind === "text" && last?.kind === "text") prose[prose.length - 1] = { kind: "text", text: last.text + node.text };
    else prose.push(node);
  });
  const tidied = prose.map((node): Inline => (node.kind === "text" ? { kind: "text", text: node.text.replace(/\n[ \t]*\n/g, "\n") } : node));
  const first = tidied[0];
  if (first?.kind === "text") tidied[0] = { kind: "text", text: first.text.trimStart() };
  const last = tidied[tidied.length - 1];
  if (last?.kind === "text") tidied[tidied.length - 1] = { kind: "text", text: last.text.trimEnd() };
  return tidied.filter((node) => node.kind !== "text" || node.text !== "");
}

function Paragraph({ theme, inlines, style }: { theme: PluginTheme; inlines: Inline[]; style: TextStyle }) {
  const images = imagesIn(inlines);
  const shown = images.length === 0 ? inlines : proseOf(inlines);
  const prose =
    shown.length === 0 ? null : (
      <Text style={style} selectable>
        <InlineNodes theme={theme} nodes={shown} />
      </Text>
    );
  if (images.length === 0) return prose;
  const alts = new Map(inlines.flatMap((node) => (node.kind === "image" ? [[node.path, node.alt] as const] : [])));
  return (
    <View style={{ gap: SPACING[2] }}>
      {prose}
      {images.map((path, index) => (
        <PictureOf key={`${index}:${path}`} theme={theme} path={path} alt={alts.get(path) ?? ""} />
      ))}
    </View>
  );
}

const HEADING_SIZES: Record<number, { fontSize: number; lineHeight: number }> = { 1: { fontSize: 18, lineHeight: 26 }, 2: { fontSize: 16, lineHeight: 24 } };

function BlockView({ theme, block, style }: { theme: PluginTheme; block: Block; style: TextStyle }): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return <Paragraph theme={theme} inlines={block.inlines} style={style} />;
    case "heading":
      return (
        <Text style={[style, HEADING_SIZES[block.level], { fontWeight: "600", color: theme.colors.foreground, marginTop: SPACING[1] }]} selectable>
          <InlineNodes theme={theme} nodes={block.inlines} />
        </Text>
      );
    case "list":
      return (
        <View style={{ gap: SPACING[1] }}>
          {block.items.map((item, index) => (
            <View key={index} style={{ flexDirection: "row", gap: SPACING[1] }}>
              <Text style={[style, { minWidth: MARKER_WIDTH, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }]}>{block.ordered ? `${block.start + index}.` : "•"}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Blocks theme={theme} blocks={item} style={style} gap={SPACING[1]} />
              </View>
            </View>
          ))}
        </View>
      );
    case "code":
      return (
        <View style={{ backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING[3], paddingVertical: SPACING[2] }}>
          <Text style={text(theme, "code")} selectable>
            {block.text}
          </Text>
        </View>
      );
    case "quote":
      return (
        <View style={{ borderLeftWidth: 3, borderLeftColor: theme.colors.border, paddingLeft: SPACING[3] }}>
          <Blocks theme={theme} blocks={block.blocks} style={{ ...style, color: theme.colors.foregroundMuted }} gap={SPACING[2]} />
        </View>
      );
    case "rule":
      return <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: SPACING[1] }} />;
  }
}

function Blocks({ theme, blocks, style, gap }: { theme: PluginTheme; blocks: Block[]; style: TextStyle; gap: number }) {
  return (
    <View style={{ gap }}>
      {blocks.map((block, index) => (
        <BlockView key={index} theme={theme} block={block} style={style} />
      ))}
    </View>
  );
}

export function Markdown({ theme, source, style }: { theme: PluginTheme; source: string; style: TextStyle }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <Blocks theme={theme} blocks={blocks} style={style} gap={SPACING[3]} />;
}
