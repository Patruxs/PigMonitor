import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, Icon, Modal, useRevealedText } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { forgeOf } from "../shared/attach.ts";
import { splitMarkdownBlocks } from "../shared/markdown.ts";
import type { AttachmentData } from "../shared/rpc.ts";
import type { AssistantSpacing } from "../shared/stream-layout.ts";
import type { TurnTiming } from "../shared/turns.ts";
import type { TaskActivity, UserMessageImage } from "../shared/stream.ts";
import { buildToolCallPresentation, type PlanOutcome, type ToolCallDetail, type ToolCallIcon, type ToolCallDisplayStatus } from "../shared/tool-call.ts";
import type { TodoEntry } from "../shared/todos.ts";
import { AttachmentLightbox } from "./kit/lightbox.tsx";
import { Markdown, usePicture } from "./markdown.tsx";
import { AttachmentFrame, AttachmentLabel, AttachmentThumbnail } from "./attachment-pill.tsx";
import { useCompact } from "./kit/platform.ts";
import { CONTENT_FONT, CONTENT_LINE, hostColours, ICON_SIZE, MAX_CONTENT_WIDTH, RADIUS, SPACING, STREAM_METADATA_FONT } from "./kit/theme.ts";
import { ToolCallDetailsContent } from "./tool-details.tsx";
import { formatMessageTimestamp } from "../shared/view.ts";
import { messageTextProps } from "./find-anchors.ts";

const isWeb = Platform.OS === "web";
const SELECTABLE = (isWeb ? { userSelect: "text" } : {}) as ViewStyle;
const ANYWHERE = (isWeb ? { overflowWrap: "anywhere" } : {}) as TextStyle;
const TIMESTAMP_REVEAL_MS = 3000;
const COPIED_MS = 1500;

export function useIsCompact(): boolean {
  return useCompact();
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0s";
  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) return `${Math.floor(totalSeconds)}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = Math.floor(totalSeconds) % 60;
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}


function TurnCopyButton({ theme, getContent, label = "Copy turn", style }: { theme: PluginTheme; getContent: () => string; label?: string; style?: ViewStyle }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    const content = getContent();
    if (!content) return;
    await copyText(content).catch(() => undefined);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      timer.current = null;
    }, COPIED_MS);
  };
  return (
    <Pressable onPress={() => void copy()} accessibilityRole="button" accessibilityLabel={copied ? "Copied" : label} style={[{ padding: SPACING[1] }, style]}>
      {(state) => <Icon name={copied ? "Check" : "Copy"} size={ICON_SIZE.sm} color={(state as { hovered?: boolean }).hovered ? theme.colors.foreground : theme.colors.foregroundMuted} />}
    </Pressable>
  );
}

function LiveElapsed({ theme, startedAt, style }: { theme: PluginTheme; startedAt: Date; style?: TextStyle }) {
  const start = startedAt.getTime();
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - start));
  useEffect(() => {
    setElapsed(Math.max(0, Date.now() - start));
    const handle = setInterval(() => setElapsed(Math.max(0, Date.now() - start)), 1000);
    return () => clearInterval(handle);
  }, [start]);
  return <Text style={[{ color: theme.colors.foregroundMuted, fontSize: STREAM_METADATA_FONT, fontVariant: ["tabular-nums"] }, style]}>{formatDuration(elapsed)}</Text>;
}

function AssistantTurnFooter({ theme, getContent, timing }: { theme: PluginTheme; getContent: () => string; timing?: TurnTiming }) {
  const [hovered, setHovered] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const cost = timing?.costUsd !== undefined ? ` · $${timing.costUsd.toFixed(2)}` : "";
  const duration = timing && timing.durationMs !== null ? `Worked for ${formatDuration(timing.durationMs)}${cost}` : "";
  const stamp = timing ? formatMessageTimestamp(timing.completedAt) : "";
  const shown = duration || stamp;
  const canSwap = Boolean(duration && stamp);
  const showStamp = canSwap && (isWeb ? hovered : revealed);
  const press = () => {
    if (isWeb || !canSwap) return;
    if (timer.current) clearTimeout(timer.current);
    setRevealed(true);
    timer.current = setTimeout(() => {
      setRevealed(false);
      timer.current = null;
    }, TIMESTAMP_REVEAL_MS);
  };
  const label: TextStyle = { color: theme.colors.foregroundMuted, fontSize: STREAM_METADATA_FONT };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
      <TurnCopyButton theme={theme} getContent={getContent} style={{ alignSelf: "center", marginLeft: -SPACING[1] }} />
      {shown ? (
        <Pressable onPress={press} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} accessibilityRole={canSwap ? "button" : undefined} accessibilityLabel={canSwap ? `${duration}, ended ${stamp}` : shown}>
          <View style={{ position: "relative" }}>
            <Text style={[label, { opacity: 0 }]} aria-hidden>
              {shown.length >= stamp.length ? shown : stamp}
            </Text>
            <Text style={[label, { position: "absolute", top: 0, left: 0 }]}>{showStamp ? stamp : shown}</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

export const TURN_FOOTER_BOTTOM_SPACING = SPACING[8];

export function TurnFooterRow({ children }: { children: ReactNode }) {
  return <View style={{ width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", paddingHorizontal: SPACING[2], marginTop: SPACING[2] + 5 }}>{children}</View>;
}

export function RunningTurnFooter({ theme, startedAt }: { theme: PluginTheme; startedAt: Date | null }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", minHeight: 24, paddingBottom: TURN_FOOTER_BOTTOM_SPACING }}>
      <View style={{ height: 24, flexDirection: "row", alignItems: "center", gap: SPACING[3] }}>
        <View style={{ marginLeft: -2 }}>
          <ActivityIndicator size={14} color={theme.colors.foregroundMuted} />
        </View>
        {startedAt ? <LiveElapsed theme={theme} startedAt={startedAt} /> : null}
      </View>
    </View>
  );
}

export function CompletedTurnFooter({ theme, getContent, timing }: { theme: PluginTheme; getContent: () => string; timing?: TurnTiming }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", minHeight: 24, paddingBottom: TURN_FOOTER_BOTTOM_SPACING }}>
      <AssistantTurnFooter theme={theme} getContent={getContent} timing={timing} />
    </View>
  );
}

function imageUri(image: UserMessageImage, picture: string | undefined): string | null {
  return image.uri ?? picture ?? null;
}

function UserImage({ theme, image, onOpen }: { theme: PluginTheme; image: UserMessageImage; onOpen: (uri: string | null) => void }) {
  const { picture } = usePicture(image.uri ? undefined : image.path);
  const uri = imageUri(image, picture?.uri);
  return (
    <AttachmentFrame theme={theme} onPress={() => onOpen(uri)} accessibilityLabel="Open image">
      <AttachmentThumbnail theme={theme} uri={uri} />
    </AttachmentFrame>
  );
}

function attachmentContent(attachment: AttachmentData): { icon: string; title: string; subtitle: string } {
  if (attachment.type === "uploaded_file") {
    const extension = /\.([^./\\]+)$/.exec(attachment.fileName)?.[1];
    return { icon: "FileText", title: attachment.fileName, subtitle: extension ? extension.toUpperCase() : "File" };
  }
  if (attachment.type === "forge_change_request") {
    const forge = forgeOf(attachment.forge);
    return { icon: "GitPullRequest", title: attachment.title, subtitle: `${forge.changeRequestAbbrev} ${forge.changeRequestNumberPrefix}${attachment.number}` };
  }
  return { icon: "CircleDot", title: attachment.title, subtitle: `Issue #${attachment.number}` };
}

export function UserMessage({ theme, text, images = [], attachments = [], timestamp, note, isFirstInGroup = true, isLastInGroup = true, isPending = false, actions }: { theme: PluginTheme; text: string; images?: UserMessageImage[]; attachments?: AttachmentData[]; timestamp: Date; note?: string; isFirstInGroup?: boolean; isLastInGroup?: boolean; isPending?: boolean; actions?: ReactNode }) {
  const compact = useIsCompact();
  const [hovered, setHovered] = useState(false);
  const [lightbox, setLightbox] = useState<string | null | undefined>(undefined);
  const hasText = text.trim().length > 0;
  const showTrailing = !isPending && hasText && (compact || !isWeb || hovered);
  const spacing: ViewStyle = { ...(isFirstInGroup ? { marginTop: SPACING[4] } : {}), ...(isLastInGroup ? { marginBottom: SPACING[4] } : {}), ...(!isFirstInGroup || !isLastInGroup ? { marginBottom: isLastInGroup ? SPACING[4] : SPACING[1] } : {}) };
  const closeLightbox = useCallback(() => setLightbox(undefined), []);
  return (
    <View style={[{ flexDirection: "row", justifyContent: "flex-end" }, SELECTABLE, spacing]} aria-busy={isPending}>
      <View style={{ alignItems: "flex-end", maxWidth: "100%" }} {...({ onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) } as object)}>
        <View style={{ backgroundColor: hostColours(theme).surface3, borderRadius: 16, borderTopRightRadius: 2, paddingHorizontal: SPACING[4], paddingVertical: SPACING[4], minWidth: 0, flexShrink: 1 }}>
          {images.length > 0 ? (
            <View style={{ flexDirection: "row", gap: SPACING[2], flexWrap: "wrap", ...(hasText || attachments.length > 0 ? { marginBottom: SPACING[2] } : {}) }}>
              {images.map((image) => (
                <UserImage key={image.id} theme={theme} image={image} onOpen={setLightbox} />
              ))}
            </View>
          ) : null}
          {attachments.length > 0 ? (
            <View style={{ flexDirection: "row", gap: SPACING[2], flexWrap: "wrap", ...(hasText ? { marginBottom: SPACING[2] } : {}) }}>
              {attachments.map((attachment, index) => {
                const content = attachmentContent(attachment);
                return (
                  <AttachmentFrame key={`${attachment.type}:${"number" in attachment ? attachment.number : index}`} theme={theme}>
                    <AttachmentLabel theme={theme} icon={content.icon} title={content.title} subtitle={content.subtitle} />
                  </AttachmentFrame>
                );
              })}
            </View>
          ) : null}
          {hasText ? (
            <Text {...messageTextProps} selectable style={[{ color: theme.colors.foreground, fontSize: CONTENT_FONT }, isWeb ? { lineHeight: CONTENT_LINE } : null, ANYWHERE]}>
              {text}
            </Text>
          ) : null}
        </View>
        {hasText ? (
          <View style={{ alignSelf: "flex-end", flexDirection: "row", alignItems: "center", height: 24, gap: SPACING[2], marginTop: SPACING[2], opacity: showTrailing ? 1 : 0 }} pointerEvents={showTrailing ? "auto" : "none"}>
            {note ? <Text style={{ color: note === "Held" ? theme.colors.statusWarning : theme.colors.foregroundMuted, fontSize: STREAM_METADATA_FONT }}>{note}</Text> : null}
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: STREAM_METADATA_FONT }}>{formatMessageTimestamp(timestamp)}</Text>
            {actions}
            <TurnCopyButton theme={theme} getContent={() => text} label="Copy message" style={{ alignSelf: "center", marginRight: -SPACING[1] }} />
          </View>
        ) : null}
      </View>
      <AttachmentLightbox theme={theme} uri={lightbox} onClose={closeLightbox} />
    </View>
  );
}

const RENDER_CHARACTER_LIMIT = 32_000;
const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

function utf8Length(message: string): number {
  let bytes = 0;
  for (let index = 0; index < message.length; index += 1) {
    const code = message.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < message.length && message.charCodeAt(index + 1) >= 0xdc00 && message.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function capForRender(message: string): { text: string; capped: boolean } {
  if (message.length <= RENDER_CHARACTER_LIMIT) return { text: message, capped: false };
  let end = RENDER_CHARACTER_LIMIT;
  if (graphemes) end = graphemes.segment(message).containing(end)?.index ?? end;
  else if (message.charCodeAt(end - 1) >= 0xd800 && message.charCodeAt(end - 1) <= 0xdbff) end -= 1;
  return { text: message.slice(0, end), capped: true };
}


export function AssistantMessage({ theme, text, phase, spacing = "default", renderFullContent = false }: { theme: PluginTheme; text: string; phase: "streaming" | "complete"; spacing?: AssistantSpacing; renderFullContent?: boolean }) {
  const rendered = useMemo(() => (renderFullContent ? { text, capped: false } : capForRender(text)), [text, renderFullContent]);
  const revealedText = useRevealedText(rendered.text, phase);
  const revealed = renderFullContent ? rendered.text : revealedText;
  const cappedBytes = useMemo(() => (rendered.capped && phase === "complete" ? utf8Length(text) : null), [text, phase, rendered.capped]);
  const blocks = useMemo(() => splitMarkdownBlocks(revealed), [revealed]);
  const style: TextStyle = { color: theme.colors.foreground, fontSize: CONTENT_FONT, lineHeight: CONTENT_LINE, flexShrink: 1, minWidth: 0, ...ANYWHERE };
  return (
    <View {...messageTextProps} style={[{ paddingVertical: SPACING[3] }, SELECTABLE, spacing === "compactTop" || spacing === "compactBoth" ? { paddingTop: 0 } : null, spacing === "compactBottom" || spacing === "compactBoth" ? { paddingBottom: 0 } : null]}>
      {blocks.map((block, index) => (
        <View key={`block:${index}`} style={index < blocks.length - 1 ? { marginBottom: 12 } : undefined}>
          <Markdown theme={theme} source={block} style={style} look="assistant" streaming={phase === "streaming" && index === blocks.length - 1} />
        </View>
      ))}
      {cappedBytes !== null ? <Text style={{ marginTop: SPACING[3], fontSize: 14, fontStyle: "italic", color: theme.colors.foregroundMuted }}>{`This message was capped (${cappedBytes} bytes).`}</Text> : null}
    </View>
  );
}

const TOOL_ICONS: Record<ToolCallIcon, string> = {
  wrench: "Wrench",
  square_terminal: "SquareTerminal",
  eye: "Eye",
  pencil: "Pencil",
  search: "Search",
  bot: "Bot",
  sparkles: "Sparkles",
  brain: "Brain",
  mic_vocal: "MicVocal",
  paseo: "Wrench",
};

const SHIMMER_KEYFRAMES_ID = "pigmonitor-toolcall-shimmer-keyframes";
const SHIMMER_NAME = "pigmonitor-toolcall-shimmer";

function ensureShimmerKeyframes() {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc || doc.getElementById(SHIMMER_KEYFRAMES_ID)) return;
  const element = doc.createElement("style");
  element.id = SHIMMER_KEYFRAMES_ID;
  element.textContent = `@keyframes ${SHIMMER_NAME} { 0% { background-position: var(--pig-shimmer-start, -200px) 0; } 100% { background-position: var(--pig-shimmer-end, 200px) 0; } }`;
  doc.head.appendChild(element);
}

function shimmerStyle(label: string, secondary: string | undefined, foreground: string): TextStyle {
  const chars = label.trim().length + (secondary?.trim().length ?? 0);
  const duration = Math.max(1, Math.min(2.3, 1.25 + chars * 0.008 - (chars <= 12 ? 0.25 : 0)));
  return {
    color: "transparent",
    backgroundImage: `linear-gradient(90deg, ${foreground} 0%, ${foreground} 40%, rgba(255,255,255,0.95) 50%, ${foreground} 60%, ${foreground} 100%)`,
    backgroundSize: "200% 100%",
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    animation: `${SHIMMER_NAME} ${duration}s linear infinite`,
    "--pig-shimmer-start": "100%",
    "--pig-shimmer-end": "-100%",
  } as unknown as TextStyle;
}

function ExpandableBadge({ theme, label, secondaryLabel, icon, isExpanded, onToggle, renderDetails, isLoading = false, isError = false, isLastInSequence = false }: { theme: PluginTheme; label: string; secondaryLabel?: string; icon?: string; isExpanded: boolean; onToggle?: () => void; renderDetails?: () => ReactNode; isLoading?: boolean; isError?: boolean; isLastInSequence?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const interactive = Boolean(onToggle);
  const active = hovered || isExpanded;
  const details = renderDetails && isExpanded ? renderDetails() : null;
  const webShimmer = isLoading && isWeb;
  useEffect(() => {
    if (webShimmer) ensureShimmerKeyframes();
  }, [webShimmer]);
  const showChevron = interactive && (hovered || isExpanded);
  const labelStyle: TextStyle = { color: active || isLoading ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 14, flexShrink: 0, ...(isLoading ? { opacity: 0.72 } : {}) };
  const secondaryStyle: TextStyle = { flexShrink: 1, minWidth: 0, color: active ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 14, marginLeft: SPACING[2] };
  const shimmer = webShimmer ? shimmerStyle(label, secondaryLabel, active || isLoading ? theme.colors.foreground : theme.colors.foregroundMuted) : null;
  return (
    <View style={{ marginHorizontal: -13, marginBottom: isLastInSequence ? SPACING[4] : SPACING[1] }} {...(isWeb ? { onPointerEnter: () => setHovered(true), onPointerLeave: () => { setHovered(false); setPressed(false); } } : {})}>
      <Pressable
        onPress={onToggle}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        disabled={!interactive}
        accessibilityRole={interactive ? "button" : undefined}
        accessibilityState={interactive ? { expanded: isExpanded } : undefined}
        style={{ borderRadius: RADIUS.lg, borderWidth: 1, borderColor: isExpanded ? theme.colors.border : "transparent", paddingHorizontal: SPACING[2], paddingVertical: SPACING[1], overflow: "hidden", ...(pressed && interactive ? { opacity: 0.9 } : {}), ...(isExpanded ? { backgroundColor: theme.colors.surface1, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : {}) }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginRight: SPACING[1] }}>
            {showChevron ? (
              <View style={{ marginLeft: -4, transform: isExpanded ? [{ scale: 1.3 }, { rotate: "90deg" }] : [{ scale: 1.3 }] }}>
                <Icon name="ChevronRight" size={12} color={theme.colors.foreground} />
              </View>
            ) : isError ? (
              <View style={{ marginLeft: -1, opacity: 0.8 }}>
                <Icon name="TriangleAlert" size={12} color={theme.colors.statusDanger} />
              </View>
            ) : icon ? (
              <View style={{ marginLeft: -1 }}>
                <Icon name={icon} size={12} color={active ? theme.colors.foreground : theme.colors.foregroundMuted} />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", overflow: "hidden" }}>
            <Text style={[labelStyle, shimmer]} numberOfLines={1}>
              {label}
            </Text>
            {secondaryLabel ? (
              <Text style={[secondaryStyle, shimmer]} numberOfLines={1}>
                {secondaryLabel}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
      {details ? <View style={[{ borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg, borderWidth: 1, borderTopWidth: 0, borderColor: theme.colors.border, flexShrink: 1, minWidth: 0, overflow: "hidden" }, isWeb ? ({ cursor: "auto", userSelect: "text" } as unknown as ViewStyle) : null]}>{details}</View> : null}
    </View>
  );
}

function ToolCallSheet({ theme, open, title, summary, icon, onClose, children }: { theme: PluginTheme; open: boolean; title: string; summary?: string; icon: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal title={summary ? `${title} ${summary}` : title} icon={<Icon name={icon} size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />} open={open} onOpenChange={(next) => !next && onClose()}>
      <Modal.Content contentContainerStyle={{ padding: 0, gap: 0 }}>{children}</Modal.Content>
    </Modal>
  );
}

export function ToolCall({ theme, toolName, args, status, error, detail, cwd, metadata, isLastInSequence = false, defaultExpanded = false, forceInline = false, maxDetailHeight = 400 }: { theme: PluginTheme; toolName: string; args?: unknown; status: ToolCallDisplayStatus; error?: unknown; detail?: ToolCallDetail; cwd?: string; metadata?: Record<string, unknown>; isLastInSequence?: boolean; defaultExpanded?: boolean; forceInline?: boolean; maxDetailHeight?: number }) {
  const compact = useIsCompact();
  const inline = !compact || forceInline;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [sheet, setSheet] = useState(false);
  const effectiveDetail = useMemo<ToolCallDetail | undefined>(() => detail ?? (args !== undefined ? { type: "unknown", input: args ?? null, output: null } : undefined), [detail, args]);
  const presentation = useMemo(() => buildToolCallPresentation({ toolName, status, error: error ?? null, detail: effectiveDetail, metadata, cwd }), [toolName, status, error, effectiveDetail, metadata, cwd]);
  const icon = TOOL_ICONS[presentation.icon];
  const details = () => <ToolCallDetailsContent theme={theme} toolName={toolName} detail={effectiveDetail} errorText={presentation.errorText} maxHeight={maxDetailHeight} showLoadingSkeleton={presentation.isLoadingDetails} />;
  if (presentation.isPlan && effectiveDetail?.type === "plan") return <PlanCard theme={theme} text={effectiveDetail.text} outcome={presentation.planOutcome} />;
  return (
    <>
      <ExpandableBadge
        theme={theme}
        label={presentation.displayName}
        secondaryLabel={presentation.summary}
        icon={icon}
        isExpanded={inline && expanded}
        onToggle={presentation.canOpenDetails ? () => (inline ? setExpanded((was) => !was) : setSheet(true)) : undefined}
        renderDetails={presentation.canOpenDetails && inline ? details : undefined}
        isLoading={status === "running" || status === "executing"}
        isError={status === "failed"}
        isLastInSequence={isLastInSequence}
      />
      {!inline ? (
        <ToolCallSheet theme={theme} open={sheet} title={presentation.displayName} summary={presentation.summary} icon={icon} onClose={() => setSheet(false)}>
          <ToolCallDetailsContent theme={theme} toolName={toolName} detail={effectiveDetail} errorText={presentation.errorText} fillAvailableHeight showLoadingSkeleton={presentation.isLoadingDetails} />
        </ToolCallSheet>
      ) : null}
    </>
  );
}

export function ThoughtBadge({ theme, text, status, isLastInSequence }: { theme: PluginTheme; text: string; status: "loading" | "ready"; isLastInSequence: boolean }) {
  const revealed = useRevealedText(text, status === "ready" ? "complete" : "streaming");
  return <ToolCall theme={theme} toolName="thinking" args={revealed} status={status === "ready" ? "completed" : "executing"} isLastInSequence={isLastInSequence} />;
}

const PLAN_TITLES: Record<Exclude<PlanOutcome, "pending">, string> = { rejected: "Rejected plan", approved: "Approved plan", canceled: "Canceled plan" };

export function PlanCard(props: { theme: PluginTheme; title?: string; description?: string; text: string; outcome?: PlanOutcome; footer?: ReactNode; compact?: boolean }) {
  return <PlanCardContent key={props.outcome ?? "proposed"} {...props} />;
}

function PlanCardContent({ theme, title, description, text, outcome, footer, compact = false }: { theme: PluginTheme; title?: string; description?: string; text: string; outcome?: PlanOutcome; footer?: ReactNode; compact?: boolean }) {
  const [expanded, setExpanded] = useState(outcome !== "rejected" && outcome !== "canceled");
  const resolvedTitle = !outcome || outcome === "pending" ? (title ?? "Plan") : PLAN_TITLES[outcome];
  return (
    <View style={{ marginVertical: compact ? 0 : SPACING[3], padding: SPACING[3], borderRadius: SPACING[2], borderWidth: 1, gap: SPACING[2], backgroundColor: theme.colors.surface1, borderColor: theme.colors.border }}>
      <Pressable {...(isWeb ? { "aria-expanded": expanded } : {})} accessibilityRole="button" accessibilityLabel={resolvedTitle} accessibilityState={{ expanded }} onPress={() => setExpanded((was) => !was)} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: 24 }}>
        <View style={expanded ? { transform: [{ rotate: "90deg" }] } : undefined}>
          <Icon name="ChevronRight" size={16} color={theme.colors.foregroundMuted} />
        </View>
        <Text style={{ color: theme.colors.foreground, flexShrink: 1, fontSize: 14, lineHeight: 22 }}>{resolvedTitle}</Text>
      </Pressable>
      {expanded ? (
        <View style={{ gap: SPACING[2] }}>
          {description ? <Text style={{ fontSize: 14, lineHeight: 20, color: theme.colors.foregroundMuted }}>{description}</Text> : null}
          <Markdown theme={theme} source={text} style={{ color: theme.colors.foreground, fontSize: CONTENT_FONT, lineHeight: CONTENT_LINE }} look="assistant" linkify={false} />
        </View>
      ) : null}
      {footer ? <View style={{ gap: SPACING[2] }}>{footer}</View> : null}
    </View>
  );
}

const NOTIFICATION: Record<"info" | "warning" | "error", { bg: string; icon: string }> = {
  info: { bg: "rgba(147, 197, 253, 0.1)", icon: "Info" },
  warning: { bg: "rgba(245, 158, 11, 0.1)", icon: "TriangleAlert" },
  error: { bg: "rgba(239, 68, 68, 0.1)", icon: "CircleX" },
};

export function Notification({ theme, level, message }: { theme: PluginTheme; level: "info" | "warning" | "error"; message: string }) {
  const config = NOTIFICATION[level];
  const colour = level === "info" ? "#93c5fd" : level === "warning" ? "#f59e0b" : theme.colors.statusDanger;
  return (
    <View style={{ borderRadius: RADIUS.md, overflow: "hidden", marginBottom: SPACING[1], backgroundColor: config.bg }}>
      <View style={{ paddingHorizontal: SPACING[3], paddingVertical: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACING[2] }}>
          <View style={{ flexShrink: 0, height: 20, justifyContent: "center" }}>
            <Icon name={config.icon} size={16} color={colour} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 14, lineHeight: 20 }} selectable>
              {message}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function compactionLabel(status: "loading" | "completed", trigger?: "auto" | "manual", preTokens?: number): string {
  if (status === "loading") return "Compacting...";
  if (trigger === "auto") return "Context automatically compacted";
  if (trigger === "manual") return "Context manually compacted";
  if (preTokens) return `Context compacted (${Math.round(preTokens / 1000)}K tokens)`;
  return "Context compacted";
}

export function CompactionMarker({ theme, status, trigger, preTokens }: { theme: PluginTheme; status: "loading" | "completed"; trigger?: "auto" | "manual"; preTokens?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: SPACING[3], paddingHorizontal: SPACING[4], gap: SPACING[2] }}>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
        {status === "loading" ? <ActivityIndicator size="small" color="#a1a1aa" /> : <Icon name="Scissors" size={12} color="#a1a1aa" />}
        <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted }}>{compactionLabel(status, trigger, preTokens)}</Text>
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
    </View>
  );
}

function TaskListRow({ theme, task }: { theme: PluginTheme; task: TodoEntry }) {
  const completed = task.completed || task.status === "completed";
  const running = !completed && task.status === "in_progress";
  const label = running && task.activeForm ? task.activeForm : task.text;
  const extraMuted = hostColours(theme).foregroundExtraMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }} accessibilityLabel={label}>
      <Icon name={completed ? "CircleCheck" : running ? "CircleDot" : "Circle"} size={16} color={running ? theme.colors.accent : extraMuted} />
      <Text numberOfLines={1} style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, color: running ? theme.colors.foreground : completed ? extraMuted : theme.colors.foregroundMuted, fontSize: 14, ...(completed ? { textDecorationLine: "line-through" } : {}) }}>
        {label}
      </Text>
    </View>
  );
}

const TASK_ICONS: Record<TaskActivity["type"], string> = { created: "SquareCheck", added: "Plus", started: "CircleDot", completed: "Check" };
const TASK_LABELS: Record<Exclude<TaskActivity["type"], "created">, string> = { added: "Added", started: "Started", completed: "Completed" };

export function TodoListCard({ theme, items, activity, isLastInSequence }: { theme: PluginTheme; items: TodoEntry[]; activity: TaskActivity; isLastInSequence: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const label = activity.type === "created" ? `Created ${activity.count} tasks` : TASK_LABELS[activity.type];
  const secondary = activity.type === "created" ? undefined : activity.task;
  return (
    <ExpandableBadge
      theme={theme}
      label={label}
      secondaryLabel={secondary}
      icon={TASK_ICONS[activity.type]}
      isExpanded={expanded}
      onToggle={() => setExpanded((was) => !was)}
      isLastInSequence={isLastInSequence}
      renderDetails={() => (
        <View style={{ padding: SPACING[2] }}>
          <View style={{ gap: SPACING[1] }}>{items.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>No tasks yet.</Text> : items.map((item) => <TaskListRow key={item.id ?? item.text} theme={theme} task={item} />)}</View>
        </View>
      )}
    />
  );
}

export function SpeakMessage({ theme, message }: { theme: PluginTheme; message: string }) {
  return (
    <View style={{ paddingVertical: SPACING[3], marginBottom: SPACING[4] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], marginBottom: SPACING[2] }}>
        <Icon name="MicVocal" size={14} color={theme.colors.foregroundMuted} />
        <Text style={{ fontSize: 14, color: theme.colors.foregroundMuted }}>Spoke</Text>
      </View>
      <Text style={{ fontSize: CONTENT_FONT, lineHeight: CONTENT_LINE, color: theme.colors.foreground }}>{message}</Text>
    </View>
  );
}
