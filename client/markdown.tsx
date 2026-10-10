import type { PluginTheme, RpcInput, RpcOutput } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, Linking, Pressable, Text, View, type TextStyle } from "react-native";
import { AttachmentLightbox } from "./kit/lightbox.tsx";
import { imagesIn, parseMarkdown, type Block, type Inline } from "../shared/markdown.ts";
import { imageFile } from "../shared/rpc.ts";
import { RADIUS, SPACING, text } from "./kit/theme.ts";
import { markdownTagProps } from "./find-anchors.ts";

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

export function usePicture(path: string | undefined): { picture: Picture | null; failure: string | null } {
  const call = useRpc(imageFile);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setPicture(null);
    setFailure(null);
    if (!path) return;
    loadPicture(path, call).then(
      (loaded) => live && setPicture(loaded),
      (error: unknown) => live && setFailure(String((error as Error).message ?? error)),
    );
    return () => {
      live = false;
    };
  }, [path]);
  return { picture, failure };
}

function PictureOf({ theme, path, alt, viewer }: { theme: PluginTheme; path: string; alt: string; viewer: boolean }) {
  const { picture, failure } = usePicture(path);
  const [open, setOpen] = useState(false);
  return (
    <View style={{ alignItems: "flex-start", gap: SPACING[1] }}>
      {viewer && picture ? <AttachmentLightbox theme={theme} uri={open ? picture.uri : undefined} onClose={() => setOpen(false)} /> : null}
      {picture && picture.width > 0 && picture.height > 0 && viewer ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Open image" onPress={() => setOpen(true)}>
          <Image source={{ uri: picture.uri }} accessibilityLabel={alt || path} resizeMode="contain" style={{ width: Math.min(picture.width, (IMAGE_MAX_HEIGHT * picture.width) / picture.height), maxWidth: "100%", aspectRatio: picture.width / picture.height, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.colors.border }} />
        </Pressable>
      ) : picture && picture.width > 0 && picture.height > 0 ? (
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

type Look = "plain" | "assistant";

function tag(name: string): object {
  return markdownTagProps(name);
}

interface Styles {
  look: Look;
  code: TextStyle;
  link: TextStyle;
  strong: TextStyle;
}

function stylesOf(theme: PluginTheme, look: Look): Styles {
  if (look === "plain") return { look, code: codeSpan(theme), link: { color: theme.colors.accent, textDecorationLine: "underline" }, strong: { fontWeight: "600" } };
  return {
    look,
    code: { backgroundColor: theme.colors.surface2, color: theme.colors.foreground, paddingHorizontal: SPACING[1], paddingVertical: 2, borderRadius: RADIUS.md, fontFamily: "monospace", fontSize: 12 },
    link: { color: theme.colors.accent, textDecorationLine: "none" },
    strong: { fontWeight: "500" },
  };
}

function InlineNodes({ theme, nodes, styles }: { theme: PluginTheme; nodes: Inline[]; styles: Styles }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "bold":
        return (
          <Text key={index} style={styles.strong}>
            <InlineNodes theme={theme} nodes={node.children} styles={styles} />
          </Text>
        );
      case "italic":
        return (
          <Text key={index} style={{ fontStyle: "italic" }}>
            <InlineNodes theme={theme} nodes={node.children} styles={styles} />
          </Text>
        );
      case "strike":
        return (
          <Text key={index} style={{ textDecorationLine: "line-through", color: theme.colors.foregroundMuted }}>
            <InlineNodes theme={theme} nodes={node.children} styles={styles} />
          </Text>
        );
      case "code":
        return (
          <Text key={index} style={styles.code}>
            {node.text}
          </Text>
        );
      case "image":
        return (
          <Text key={index} style={styles.code}>
            {node.path}
          </Text>
        );
      case "link":
        return (
          <Text key={index} style={styles.link} onPress={() => void Linking.openURL(node.href)}>
            <InlineNodes theme={theme} nodes={node.children} styles={styles} />
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

function Paragraph({ theme, inlines, style, styles }: { theme: PluginTheme; inlines: Inline[]; style: TextStyle; styles: Styles }) {
  const images = imagesIn(inlines);
  const shown = images.length === 0 ? inlines : proseOf(inlines);
  const prose =
    shown.length === 0 ? null : (
      <Text style={style} selectable {...tag("p")}>
        <InlineNodes theme={theme} nodes={shown} styles={styles} />
      </Text>
    );
  if (images.length === 0) return prose;
  const alts = new Map(inlines.flatMap((node) => (node.kind === "image" ? [[node.path, node.alt] as const] : [])));
  return (
    <View style={{ gap: SPACING[2] }}>
      {prose}
      {images.map((path, index) => (
        <PictureOf key={`${index}:${path}`} theme={theme} path={path} alt={alts.get(path) ?? ""} viewer={styles.look === "assistant"} />
      ))}
    </View>
  );
}

const HEADING_SIZES: Record<number, { fontSize: number; lineHeight: number }> = { 1: { fontSize: 18, lineHeight: 26 }, 2: { fontSize: 16, lineHeight: 24 } };

const ASSISTANT_HEADINGS: Record<number, TextStyle> = {
  1: { fontSize: 28, lineHeight: 36, fontWeight: "bold", marginTop: SPACING[6], marginBottom: SPACING[3], paddingBottom: SPACING[2], borderBottomWidth: 1 },
  2: { fontSize: 24, lineHeight: 31, fontWeight: "bold", marginTop: SPACING[6], marginBottom: SPACING[3], paddingBottom: SPACING[2], borderBottomWidth: 1 },
  3: { fontSize: 21, lineHeight: 27, fontWeight: "600", marginTop: SPACING[4], marginBottom: SPACING[2] },
  4: { fontSize: 19, lineHeight: 25, fontWeight: "600", marginTop: SPACING[4], marginBottom: SPACING[2] },
  5: { fontSize: 17, lineHeight: 22, fontWeight: "600", marginTop: SPACING[3], marginBottom: SPACING[1] },
  6: { fontSize: 17, lineHeight: 22, fontWeight: "600", marginTop: SPACING[3], marginBottom: SPACING[1], textTransform: "uppercase", letterSpacing: 0.5 },
};

function Heading({ theme, block, style, styles }: { theme: PluginTheme; block: Extract<Block, { kind: "heading" }>; style: TextStyle; styles: Styles }) {
  if (styles.look === "plain") {
    return (
      <Text style={[style, HEADING_SIZES[block.level], { fontWeight: "600", color: theme.colors.foreground, marginTop: SPACING[1] }]} selectable>
        <InlineNodes theme={theme} nodes={block.inlines} styles={styles} />
      </Text>
    );
  }
  return (
    <Text {...tag(`h${block.level}`)} style={[style, ASSISTANT_HEADINGS[block.level], { borderBottomColor: theme.colors.border, color: block.level === 6 ? theme.colors.foregroundMuted : theme.colors.foreground }]} selectable>
      <InlineNodes theme={theme} nodes={block.inlines} styles={styles} />
    </Text>
  );
}

function Table({ theme, block, style, styles }: { theme: PluginTheme; block: Extract<Block, { kind: "table" }>; style: TextStyle; styles: Styles }) {
  const cell = (inlines: Inline[], key: number, header: boolean, last: boolean) => (
    <View key={key} {...tag(header ? "th" : "td")} style={{ flex: 1, padding: SPACING[2], borderRightWidth: last ? 0 : 1, borderColor: theme.colors.border, backgroundColor: header ? theme.colors.surface2 : undefined }}>
      <Text style={[style, header ? { fontWeight: "600" } : null]} selectable>
        <InlineNodes theme={theme} nodes={inlines} styles={styles} />
      </Text>
    </View>
  );
  const columns = block.head.length;
  return (
    <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.md, marginVertical: styles.look === "assistant" ? SPACING[3] : 0, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: theme.colors.border }}>{block.head.map((inlines, index) => cell(inlines, index, true, index === columns - 1))}</View>
      {block.rows.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: "row", borderBottomWidth: rowIndex === block.rows.length - 1 ? 0 : 1, borderColor: theme.colors.border }}>
          {Array.from({ length: columns }, (_, index) => cell(row[index] ?? [], index, false, index === columns - 1))}
        </View>
      ))}
    </View>
  );
}

function BlockView({ theme, block, style, styles }: { theme: PluginTheme; block: Block; style: TextStyle; styles: Styles }): ReactNode {
  const assistant = styles.look === "assistant";
  switch (block.kind) {
    case "paragraph":
      return <Paragraph theme={theme} inlines={block.inlines} style={style} styles={styles} />;
    case "heading":
      return <Heading theme={theme} block={block} style={style} styles={styles} />;
    case "list":
      return (
        <View style={{ gap: SPACING[1], ...(assistant ? { marginTop: SPACING[1] } : {}) }}>
          {block.items.map((item, index) => (
            <View key={index} {...tag("li")} style={{ flexDirection: "row", gap: assistant ? 4 : SPACING[1] }}>
              <Text style={[style, assistant ? { minWidth: block.ordered ? 12 : undefined, color: theme.colors.foregroundMuted } : { minWidth: MARKER_WIDTH, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }]}>{block.ordered ? `${block.start + index}.` : "•"}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Blocks theme={theme} blocks={item} style={style} gap={SPACING[1]} styles={styles} />
              </View>
            </View>
          ))}
        </View>
      );
    case "code":
      if (assistant) {
        return (
          <View {...tag("pre")} style={{ backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.md, padding: SPACING[3] }}>
            <Text style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 18, color: theme.colors.foreground }} selectable>
              {block.text}
            </Text>
          </View>
        );
      }
      return (
        <View style={{ backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING[3], paddingVertical: SPACING[2] }}>
          <Text style={text(theme, "code")} selectable>
            {block.text}
          </Text>
        </View>
      );
    case "quote":
      if (assistant) {
        return (
          <View style={{ backgroundColor: theme.colors.surface1, borderLeftWidth: 4, borderLeftColor: theme.colors.surface2, paddingHorizontal: SPACING[4], paddingVertical: SPACING[3], borderTopRightRadius: RADIUS.md, borderBottomRightRadius: RADIUS.md }}>
            <Blocks theme={theme} blocks={block.blocks} style={{ ...style, color: `${theme.colors.foreground}cc` }} gap={SPACING[3]} styles={styles} />
          </View>
        );
      }
      return (
        <View style={{ borderLeftWidth: 3, borderLeftColor: theme.colors.border, paddingLeft: SPACING[3] }}>
          <Blocks theme={theme} blocks={block.blocks} style={{ ...style, color: theme.colors.foregroundMuted }} gap={SPACING[2]} styles={styles} />
        </View>
      );
    case "rule":
      return <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: assistant ? 10 : SPACING[1] }} />;
    case "table":
      return <Table theme={theme} block={block} style={style} styles={styles} />;
  }
}

function Blocks({ theme, blocks, style, gap, styles }: { theme: PluginTheme; blocks: Block[]; style: TextStyle; gap: number; styles: Styles }) {
  return (
    <View style={{ gap }}>
      {blocks.map((block, index) => {
        const next = blocks[index + 1];
        const extra = styles.look === "assistant" && block.kind === "list" && next ? (next.kind === "list" ? SPACING[2] : SPACING[4]) - gap : 0;
        return (
          <View key={index} style={extra > 0 ? { marginBottom: extra } : undefined}>
            <BlockView theme={theme} block={block} style={style} styles={styles} />
          </View>
        );
      })}
    </View>
  );
}

export function Markdown({ theme, source, style, look = "plain", streaming = false, linkify = look === "assistant" }: { theme: PluginTheme; source: string; style: TextStyle; look?: Look; streaming?: boolean; linkify?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(source, { linkify, streaming }), [source, linkify, streaming]);
  const styles = useMemo(() => stylesOf(theme, look), [theme, look]);
  return <Blocks theme={theme} blocks={blocks} style={style} gap={SPACING[3]} styles={styles} />;
}
