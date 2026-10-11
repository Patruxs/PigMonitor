import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { buildLineDiff, parseUnifiedDiff, type DiffLine } from "./diff.ts";
import { buildPaseoToolDetailSections, hasMeaningfulToolCallDetail, type PaseoToolDetailSection, type ToolCallDetail } from "../../shared/tool-call.ts";
import { hostColours, RADIUS, SPACING } from "../kit/theme.ts";
import { isWeb } from "../kit/platform.ts";

const CODE_PAD = SPACING[3];
const EXTRA_RIGHT = SPACING[4];
const EXTRA_BOTTOM = SPACING[3];
const PRE = (isWeb ? { whiteSpace: "pre", overflowWrap: "normal" } : {}) as TextStyle;
const ANYWHERE = (isWeb ? { overflowWrap: "anywhere" } : {}) as TextStyle;

function codeText(theme: PluginTheme): TextStyle {
  return { fontFamily: "monospace", fontSize: 12, color: theme.colors.foreground, lineHeight: 18, ...PRE };
}

interface DetailStyles {
  maxHeight: number | undefined;
  fill: boolean;
  fullBleed: boolean;
}

function frameOf(theme: PluginTheme, ds: DetailStyles, fullBleedBlock: boolean): ViewStyle {
  const block: ViewStyle = fullBleedBlock ? { borderWidth: 0, borderRadius: 0, overflow: "hidden", backgroundColor: theme.colors.surface1 } : { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 4, overflow: "hidden", backgroundColor: theme.colors.surface2 };
  return { ...block, ...(ds.fill ? { flex: 1, minHeight: 0 } : {}) };
}

function scrollArea(theme: PluginTheme, ds: DetailStyles, fill: boolean): ViewStyle {
  return { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 4, backgroundColor: theme.colors.surface2, ...(ds.maxHeight !== undefined ? { maxHeight: ds.maxHeight } : {}), ...(fill && ds.fill ? { flex: 1, minHeight: 0 } : {}) };
}

function CodeBlock({ theme, ds, children }: { theme: PluginTheme; ds: DetailStyles; children: ReactNode }) {
  return (
    <View style={{ gap: SPACING[2], ...(ds.fill ? { flex: 1, minHeight: 0 } : {}) }}>
      <View style={frameOf(theme, ds, ds.fullBleed)}>
        <ScrollView style={{ ...(ds.maxHeight !== undefined ? { maxHeight: ds.maxHeight } : {}), ...(ds.fill ? { flex: 1, minHeight: 0 } : {}) }} contentContainerStyle={{ flexGrow: 1, paddingBottom: EXTRA_BOTTOM }} nestedScrollEnabled showsVerticalScrollIndicator>
          <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator contentContainerStyle={{ paddingRight: EXTRA_RIGHT }}>
            <View style={{ minWidth: "100%", padding: CODE_PAD }}>{children}</View>
          </ScrollView>
        </ScrollView>
      </View>
    </View>
  );
}

function ScrollableText({ theme, ds, content, fill = true }: { theme: PluginTheme; ds: DetailStyles; content: string; fill?: boolean }) {
  return (
    <View style={{ gap: SPACING[2], ...(fill && ds.fill ? { flex: 1, minHeight: 0 } : {}) }}>
      <ScrollView style={scrollArea(theme, ds, fill)} contentContainerStyle={{ padding: CODE_PAD }} nestedScrollEnabled showsVerticalScrollIndicator>
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
          <Text selectable style={codeText(theme)}>
            {content}
          </Text>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

function PlainText({ theme, ds, value }: { theme: PluginTheme; ds: DetailStyles; value: string }) {
  return (
    <View style={{ gap: SPACING[2] }}>
      <ScrollView style={scrollArea(theme, ds, false)} contentContainerStyle={{ padding: CODE_PAD }} nestedScrollEnabled showsVerticalScrollIndicator>
        <Text selectable style={{ fontSize: 14, color: theme.colors.foreground, lineHeight: 22, ...ANYWHERE }}>
          {value}
        </Text>
      </ScrollView>
    </View>
  );
}

function parseSubAgentLog(log: string): { actions: { index: number; toolName: string; summary?: string }[]; remainingLog: string } {
  const actions: { index: number; toolName: string; summary?: string }[] = [];
  const remaining: string[] = [];
  for (const line of log.replace(/^\n+/, "").split("\n")) {
    const normalized = line.trim();
    if (!normalized) continue;
    const match = /^\[([^\]]+)\](?:\s+(.*))?$/.exec(normalized);
    const toolName = match?.[1]?.trim();
    if (match && toolName) {
      const summary = match[2]?.trim();
      actions.push({ index: actions.length + 1, toolName, ...(summary ? { summary } : {}) });
    } else remaining.push(line);
  }
  return { actions, remainingLog: remaining.join("\n").replace(/^\n+/, "") };
}

function humanize(toolName: string): string {
  const trimmed = toolName.trim();
  if (!trimmed) return toolName;
  return trimmed
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

function SubAgent({ theme, ds, detail }: { theme: PluginTheme; ds: DetailStyles; detail: Extract<ToolCallDetail, { type: "sub_agent" }> }) {
  const { actions, remainingLog } = useMemo(() => parseSubAgentLog(detail.log), [detail.log]);
  const fallback = detail.subAgentType && detail.description ? `${detail.subAgentType}: ${detail.description}` : (detail.subAgentType ?? detail.description ?? "Sub-agent activity");
  const code = codeText(theme);
  return (
    <CodeBlock theme={theme} ds={ds}>
      {detail.childSessionId ? <Text selectable style={[code, { color: theme.colors.foregroundMuted, marginBottom: SPACING[2] }]}>{`session ${detail.childSessionId}`}</Text> : null}
      {actions.length > 0 ? (
        <View style={{ gap: SPACING[1], marginBottom: SPACING[2] }}>
          {actions.map((action) => (
            <View key={action.index} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
              <Text selectable style={[code, { color: theme.colors.foregroundMuted }]}>
                {humanize(action.toolName)}
              </Text>
              {action.summary ? (
                <Text selectable style={code}>
                  {action.summary}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {remainingLog.length > 0 ? (
        <Text selectable style={code}>
          {remainingLog}
        </Text>
      ) : actions.length === 0 ? (
        <Text selectable style={code}>
          {fallback}
        </Text>
      ) : null}
    </CodeBlock>
  );
}

const ADD_LINE = "rgba(46, 160, 67, 0.15)";
const REMOVE_LINE = "rgba(248, 81, 73, 0.1)";
const ADD_HIGHLIGHT = "rgba(46, 160, 67, 0.4)";
const REMOVE_HIGHLIGHT = "rgba(248, 81, 73, 0.35)";

function DiffRow({ theme, line }: { theme: PluginTheme; line: DiffLine }) {
  const background = line.type === "add" ? ADD_LINE : line.type === "remove" ? REMOVE_LINE : theme.colors.surface1;
  const base: TextStyle = { fontFamily: "monospace", fontSize: 12, color: theme.colors.foreground, ...PRE };
  const colour = line.type === "header" || line.type === "context" ? theme.colors.foregroundMuted : theme.colors.foreground;
  return (
    <View style={{ minWidth: "100%", paddingVertical: SPACING[1], backgroundColor: background }}>
      {line.segments ? (
        <Text style={base}>
          <Text>{line.content[0]}</Text>
          {line.segments.map((segment, index) => (
            <Text key={index} style={segment.changed ? { backgroundColor: line.type === "add" ? ADD_HIGHLIGHT : REMOVE_HIGHLIGHT } : undefined}>
              {segment.text}
            </Text>
          ))}
        </Text>
      ) : (
        <Text style={[base, { color: colour }]}>{line.content}</Text>
      )}
    </View>
  );
}

function DiffViewer({ theme, ds, lines }: { theme: PluginTheme; ds: DetailStyles; lines: DiffLine[] }) {
  const [width, setWidth] = useState(0);
  if (lines.length === 0) {
    return (
      <View style={{ padding: SPACING[4], alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 14, color: theme.colors.foregroundMuted }}>No changes to display</Text>
      </View>
    );
  }
  return (
    <ScrollView style={{ ...(ds.maxHeight !== undefined ? { maxHeight: ds.maxHeight } : {}), ...(ds.fill ? { flex: 1, minHeight: 0 } : {}) }} contentContainerStyle={{ flexGrow: 1, paddingBottom: EXTRA_BOTTOM }} nestedScrollEnabled showsVerticalScrollIndicator>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator contentContainerStyle={{ flexDirection: "column", paddingRight: EXTRA_RIGHT }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={{ alignSelf: "flex-start", padding: CODE_PAD, ...(width > 0 ? { minWidth: width } : {}) }}>
          {lines.map((line, index) => (
            <DiffRow key={`${index}-${line.type}`} theme={theme} line={line} />
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

function serialize(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function UnknownSections({ theme, ds, detail }: { theme: PluginTheme; ds: DetailStyles; detail: Extract<ToolCallDetail, { type: "unknown" }> }): ReactNode {
  if (typeof detail.input === "string" && detail.output === null) return <PlainText theme={theme} ds={ds} value={detail.input} />;
  const sections = [
    { title: "Input", value: detail.input },
    { title: "Output", value: detail.output },
  ].filter((entry) => hasMeaningfulToolCallDetail({ type: "unknown", input: entry.value ?? null, output: null }));
  return sections.map((section) => {
    const value = serialize(section.value);
    if (!value.length) return null;
    return (
      <View key={section.title} style={{ gap: SPACING[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>{section.title}</Text>
        </View>
        <ScrollView horizontal nestedScrollEnabled style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 4, backgroundColor: theme.colors.surface2 }} contentContainerStyle={{ padding: CODE_PAD }} showsHorizontalScrollIndicator>
          <Text selectable style={codeText(theme)}>
            {value}
          </Text>
        </ScrollView>
      </View>
    );
  });
}

function PaseoSection({ theme, section }: { theme: PluginTheme; section: PaseoToolDetailSection }) {
  return (
    <View style={{ gap: SPACING[3], paddingHorizontal: SPACING[4], paddingVertical: SPACING[4], borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "500" }}>{section.title}</Text>
      {section.kind === "prose" ? (
        <Text selectable style={{ color: theme.colors.foreground, fontSize: 15, lineHeight: Math.round(15 * 1.5), ...ANYWHERE }}>
          {section.text}
        </Text>
      ) : (
        <View style={{ gap: SPACING[3] }}>
          {section.fields.map((field) => (
            <View key={field.label} style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACING[4] }}>
              <Text style={{ width: 120, color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 21 }}>{field.label}</Text>
              <Text selectable style={{ flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: 14, lineHeight: 21, ...ANYWHERE }}>
                {field.value}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function DetailSections({ theme, ds, detail, toolName }: { theme: PluginTheme; ds: DetailStyles; detail: ToolCallDetail | undefined; toolName?: string }): ReactNode {
  if (!detail) return null;
  const code = codeText(theme);
  switch (detail.type) {
    case "shell": {
      const output = (detail.output ?? "").replace(/^\n+/, "");
      return (
        <CodeBlock theme={theme} ds={ds}>
          <Text selectable style={code}>
            <Text style={{ color: theme.colors.foregroundMuted }}>$ </Text>
            {detail.command.replace(/\n+$/, "")}
            {output.length > 0 ? `\n\n${output}` : ""}
          </Text>
        </CodeBlock>
      );
    }
    case "worktree_setup": {
      const log = detail.log.replace(/^\n+/, "");
      return (
        <CodeBlock theme={theme} ds={ds}>
          <Text selectable style={code}>
            {log.length > 0 ? log : `Preparing worktree ${detail.branchName} at ${detail.worktreePath}`}
          </Text>
        </CodeBlock>
      );
    }
    case "sub_agent":
      return <SubAgent theme={theme} ds={ds} detail={detail} />;
    case "edit":
      return (
        <View style={{ gap: SPACING[2], ...(ds.fill ? { flex: 1, minHeight: 0 } : {}) }}>
          <View style={frameOf(theme, ds, true)}>
            <DiffViewer theme={theme} ds={ds} lines={detail.unifiedDiff ? parseUnifiedDiff(detail.unifiedDiff) : buildLineDiff(detail.oldString ?? "", detail.newString ?? "")} />
          </View>
        </View>
      );
    case "write":
      return <View style={{ gap: SPACING[2] }}>{detail.content ? <ScrollableText theme={theme} ds={ds} content={detail.content} fill={false} /> : null}</View>;
    case "read":
      return detail.content ? <ScrollableText theme={theme} ds={ds} content={detail.content} /> : null;
    case "search": {
      const parts: string[][] = [];
      if (detail.filePaths && detail.filePaths.length > 0) parts.push(["files", detail.filePaths.join("\n")]);
      if (detail.webResults && detail.webResults.length > 0) parts.push(["web", detail.webResults.map((entry) => `${entry.title}\n${entry.url}`).join("\n\n")]);
      if (detail.annotations && detail.annotations.length > 0) parts.push(["annotations", detail.annotations.join("\n\n")]);
      return (
        <>
          {detail.content ? <ScrollableText theme={theme} ds={{ ...ds, fill: false }} content={detail.content} /> : null}
          {parts.map(([key, value]) => (
            <View key={key} style={{ gap: SPACING[2] }}>
              <Text selectable style={code}>
                {value}
              </Text>
            </View>
          ))}
        </>
      );
    }
    case "fetch":
      return <ScrollableText theme={theme} ds={ds} content={detail.result ? `${detail.url}\n\n${detail.result}` : detail.url} />;
    case "plain_text":
      return detail.text ? <PlainText theme={theme} ds={ds} value={detail.text} /> : null;
    case "unknown": {
      const paseo = toolName ? buildPaseoToolDetailSections(toolName, detail.input, detail.output) : null;
      if (paseo) return paseo.map((section) => <PaseoSection key={section.title} theme={theme} section={section} />);
      return <UnknownSections theme={theme} ds={ds} detail={detail} />;
    }
    case "plan":
      return null;
  }
}

function hasSections(detail: ToolCallDetail | undefined, toolName: string | undefined): boolean {
  if (!detail) return false;
  if (detail.type === "unknown" && toolName && (buildPaseoToolDetailSections(toolName, detail.input, detail.output)?.length ?? 0) > 0) return true;
  switch (detail.type) {
    case "read":
      return Boolean(detail.content);
    case "plain_text":
      return Boolean(detail.text);
    case "search":
      return Boolean(detail.content) || (detail.filePaths?.length ?? 0) > 0 || (detail.webResults?.length ?? 0) > 0 || (detail.annotations?.length ?? 0) > 0;
    case "unknown":
      return (typeof detail.input === "string" && detail.output === null) || [detail.input, detail.output].some((value) => hasMeaningfulToolCallDetail({ type: "unknown", input: value ?? null, output: null }) && serialize(value).length > 0);
    case "plan":
      return false;
    default:
      return true;
  }
}

export function ToolCallDetailsContent({ theme, toolName, detail, errorText, maxHeight, fillAvailableHeight = false, showLoadingSkeleton = false }: { theme: PluginTheme; toolName?: string; detail?: ToolCallDetail; errorText?: string; maxHeight?: number; fillAvailableHeight?: boolean; showLoadingSkeleton?: boolean }) {
  const fullBleed = detail?.type === "edit" || detail?.type === "shell" || detail?.type === "write";
  const fillTypes = detail?.type === "shell" || detail?.type === "edit" || detail?.type === "write" || detail?.type === "read" || detail?.type === "sub_agent";
  const ds: DetailStyles = { maxHeight: fillAvailableHeight ? undefined : (maxHeight ?? 300), fill: fillAvailableHeight && fillTypes, fullBleed };
  const sections = hasSections(detail, toolName);
  if (!sections && !errorText) {
    if (showLoadingSkeleton) {
      const bar = (width: `${number}%`) => <View style={{ height: 12, width, borderRadius: 9999, backgroundColor: hostColours(theme).surface3 }} />;
      return (
        <View style={{ gap: SPACING[2], padding: SPACING[3], ...(fillAvailableHeight ? { flex: 1, minHeight: 0 } : {}) }}>
          {bar("100%")}
          {bar("72%")}
          {bar("48%")}
        </View>
      );
    }
    return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14, fontStyle: "italic" }}>No additional details available</Text>;
  }
  return (
    <View style={{ gap: fullBleed ? SPACING[2] : SPACING[4], padding: 0, ...(ds.fill ? { flex: 1, minHeight: 0 } : {}) }}>
      <DetailSections theme={theme} ds={ds} detail={detail} toolName={toolName} />
      {errorText ? (
        <View style={{ gap: SPACING[2] }}>
          <Text style={{ color: theme.colors.statusDanger, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 }}>Error</Text>
          <ScrollView horizontal nestedScrollEnabled style={{ borderWidth: 1, borderColor: theme.colors.statusDanger, borderRadius: RADIUS.md - 2, backgroundColor: theme.colors.surface2 }} contentContainerStyle={{ padding: CODE_PAD }} showsHorizontalScrollIndicator>
            <Text selectable style={[codeText(theme), { color: theme.colors.statusDanger }]}>
              {errorText}
            </Text>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
