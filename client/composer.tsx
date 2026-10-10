import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, useWindowDimensions, View, type LayoutChangeEvent, type NativeSyntheticEvent, type PressableStateCallbackType, type TextInputSelectionChangeEventData, type TextStyle } from "react-native";
import { MAX_UPLOAD_BYTES } from "../shared/attach.ts";
import {
  editQueuedComposerMessage,
  MIN_INPUT_HEIGHT,
  queueComposerMessage,
  resolveComposerKey,
  resolveMaxInputHeight,
  resolvePrimaryActionKind,
  sendQueuedComposerMessageNow,
  splitAttachmentsForSubmit,
  submitAgentInput,
  toggleForgeAttachment,
  type ComposerAttachment,
  type ComposerFocus,
  type ComposerKeyAction,
  type ImageMetadata,
  type QueuedComposerMessage,
} from "../shared/composer.ts";
import { MAX_IMAGES, upload, type AttachmentData, type ForgeItemData, type ImageData } from "../shared/rpc.ts";
import { withTranscript } from "../shared/speech.ts";
import { generateMessageId } from "../shared/stream.ts";
import { AttachmentTray, canAttach, chooseFiles, clipboardImageFiles, readBase64, readImageFiles, type PendingFile } from "./attachments.tsx";
import { useFileDrop } from "./attachments-drop.tsx";
import { ForgeGlyph, ForgePicker, useForgeAutoAttach } from "./attachments-forge.tsx";
import { AutocompletePopover, useAgentAutocomplete } from "./autocomplete.tsx";
import { clearDraft, readDraft, saveDraft } from "./drafts.ts";
import { AttachmentLightbox } from "./kit/lightbox.tsx";
import { AnchoredMenu, type MenuItem } from "./kit/menu.tsx";
import { CONTENT_FONT, hostColours, ICON_SIZE, MAX_CONTENT_WIDTH, SPACING, text } from "./kit/theme.ts";
import { queueWriter, useQueuedMessages } from "./queue.ts";
import { registerComposerRestore, restoreComposerTextIfEmpty } from "./rewind.tsx";
import type { AgentTimeline } from "./timeline.ts";
import { ComposerTracks } from "./tracks.tsx";
import { DictationButton, useDictation } from "./dictation.tsx";

export { canAttach };

export interface ComposerAgent {
  agentId: string;
  timeline: AgentTimeline;
  open?: (agentId: string) => void;
}

const BUTTON = 28;
const QUEUE_BUTTON = 32;
const BOX_RADIUS = 16;
const CANCEL_RED = "#dc2626";
const ERROR_RED = "#ef4444";
const COMPACT_FORM_FACTOR_WIDTH = 500;
const DESKTOP_BREAKPOINT = 720;
const GENERIC_FILE_MIME_TYPE = "application/octet-stream";
const NO_OUTLINE = { outlineStyle: "none", outlineWidth: 0, outlineColor: "transparent" } as unknown as TextStyle;
const MIRRORED_STYLES = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "lineHeight", "letterSpacing", "wordSpacing", "textTransform", "textIndent", "whiteSpace", "wordWrap", "overflowWrap", "wordBreak", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const;

const dom = globalThis as { document?: Document; window?: Window; navigator?: Navigator };
const isWeb = dom.document !== undefined;
const isMac = /Macintosh|Mac OS|iPhone|iPad|iPod/i.test(dom.navigator?.userAgent ?? "") || /Mac|iPhone|iPad|iPod/i.test(dom.navigator?.platform ?? "");
const FOCUS_HINT = isMac ? "⌘L to focus" : "Ctrl+L to focus";
const DESKTOP_PLACEHOLDER = "Message the agent, tag @files, or use /commands and /skills";
const MOBILE_PLACEHOLDER = "Message, @files, /commands";

type KeyPressEvent = NativeSyntheticEvent<{ key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; isComposing?: boolean; keyCode?: number }>;
type KeyChord = { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };

function hoveredOf(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

function nodeOf(ref: { current: unknown }): HTMLElement | null {
  const node = ref.current as HTMLElement | null;
  return node && typeof node.addEventListener === "function" ? node : null;
}

function focusWithRetries(focus: () => void, isFocused: () => boolean, deferInitialAttempt: boolean): () => void {
  let cancelled = false;
  const deadline = Date.now() + 1500;
  const tick = () => {
    if (cancelled) return;
    focus();
    if (isFocused() || Date.now() >= deadline) return;
    requestAnimationFrame(() => requestAnimationFrame(tick));
  };
  if (deferInitialAttempt) requestAnimationFrame(tick);
  else tick();
  return () => {
    cancelled = true;
  };
}

function useComposerHeight(textareaRef: { current: unknown }, value: string, maxHeight: number): { height: number; scrollEnabled: boolean; reset: () => void } {
  const [height, setHeight] = useState(MIN_INPUT_HEIGHT);
  const mirrorRef = useRef<HTMLTextAreaElement | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const measure = useCallback(
    (next: string) => {
      const mirror = mirrorRef.current;
      const source = nodeOf(textareaRef);
      const win = dom.window;
      if (!mirror || !source || !win || source.clientWidth <= 0) return;
      const computed = win.getComputedStyle(source);
      for (const property of MIRRORED_STYLES) mirror.style[property] = computed[property];
      mirror.style.width = `${source.clientWidth}px`;
      mirror.value = next.endsWith("\n") ? `${next} ` : next;
      const bounded = Math.max(MIN_INPUT_HEIGHT, Math.min(maxHeight, mirror.scrollHeight));
      setHeight((had) => (Math.abs(had - bounded) < 1 ? had : bounded));
    },
    [maxHeight, textareaRef],
  );
  useEffect(() => {
    const doc = dom.document;
    if (!doc) return;
    const mirror = doc.createElement("textarea");
    mirror.setAttribute("aria-hidden", "true");
    mirror.setAttribute("tabindex", "-1");
    mirror.readOnly = true;
    mirror.rows = 1;
    Object.assign(mirror.style, { position: "absolute", top: "0", left: "0", visibility: "hidden", pointerEvents: "none", overflow: "hidden", border: "0", margin: "0", resize: "none", zIndex: "-1", boxSizing: "border-box" });
    doc.body.appendChild(mirror);
    mirrorRef.current = mirror;
    measure(valueRef.current);
    return () => {
      mirror.remove();
      mirrorRef.current = null;
    };
  }, [measure]);
  useLayoutEffect(() => measure(value), [value, measure]);
  useEffect(() => {
    const source = nodeOf(textareaRef);
    if (!source || typeof ResizeObserver === "undefined") return;
    let previousWidth = source.clientWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(source.clientWidth - previousWidth) < 1) return;
      previousWidth = source.clientWidth;
      measure(valueRef.current);
    });
    observer.observe(source);
    return () => observer.disconnect();
  }, [measure, textareaRef]);
  return { height: isWeb ? height : MIN_INPUT_HEIGHT, scrollEnabled: height >= maxHeight, reset: () => setHeight(MIN_INPUT_HEIGHT) };
}

function QueuedMessageRow({ theme, item, onEdit, onSendNow }: { theme: PluginTheme; item: QueuedComposerMessage; onEdit: () => void; onSendNow: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], backgroundColor: theme.colors.surface1, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, gap: SPACING[2] }}>
      <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 14 }} numberOfLines={2} ellipsizeMode="tail">
        {item.text}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel="Edit queued message" style={{ width: QUEUE_BUTTON, height: QUEUE_BUTTON, borderRadius: QUEUE_BUTTON / 2, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface2 }}>
          <Icon name="Pencil" size={ICON_SIZE.sm} color={theme.colors.foreground} />
        </Pressable>
        <Pressable onPress={onSendNow} accessibilityRole="button" accessibilityLabel="Send queued message now" style={{ width: QUEUE_BUTTON, height: QUEUE_BUTTON, borderRadius: QUEUE_BUTTON / 2, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.accent }}>
          <Icon name="ArrowUp" size={ICON_SIZE.sm} color={theme.colors.accentForeground} />
        </Pressable>
      </View>
    </View>
  );
}

type ToolbarSlot = ReactNode | ((layout: { isCompactLayout: boolean }) => ReactNode);

export function Composer({ theme, placeholder, disabled = false, hint, controls, trailing, draftKey, cwd, stop, agent, onSend }: { theme: PluginTheme; placeholder: string; disabled?: boolean; hint?: string; controls?: ToolbarSlot; trailing?: ToolbarSlot; draftKey?: string; cwd?: string; stop?: { running: boolean; onStop: () => Promise<string | null> }; agent?: ComposerAgent; onSend: (body: string, images: ImageData[], attachments: AttachmentData[]) => Promise<string | null> }) {
  const initial = useMemo(() => (draftKey === undefined ? { text: "", attachments: [] } : readDraft(draftKey)), []);
  const [value, setValue] = useState(initial.text);
  const [cursor, setCursor] = useState(initial.text.length);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(initial.attachments);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [localCancelling, setLocalCancelling] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lightboxUri, setLightboxUri] = useState<string | undefined>(undefined);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isCompactFormFactor = windowWidth < DESKTOP_BREAKPOINT;
  const [isCompactLayout, setIsCompactLayout] = useState(isCompactFormFactor);
  const input = useRef<TextInput>(null);
  const root = useRef<View>(null);
  const nextPendingFileId = useRef(0);
  const drainInFlight = useRef(false);
  const toast = useToast();
  const callUpload = useRpc(upload);
  const maxInputHeight = resolveMaxInputHeight(windowHeight);
  const composerHeight = useComposerHeight(input, value, maxInputHeight);
  const agentId = agent?.agentId;
  const timeline = agent?.timeline;
  const queuedMessages = useQueuedMessages(agentId);
  const isAgentRunning = timeline ? timeline.turn.isActive : stop?.running === true;
  const isCancellingAgent = timeline ? timeline.turn.isCancelling || localCancelling : localCancelling;
  const isUploadingFile = pendingFiles.length > 0;
  const isSubmitLoading = isProcessing || isUploadingFile;
  const hasSendableContent = value.trim().length > 0 || attachments.length > 0;
  const onQueue = agentId !== undefined;

  useEffect(() => {
    if (draftKey !== undefined) saveDraft(draftKey, { text: value, attachments });
  }, [draftKey, value, attachments]);

  const focusInput = useCallback(() => {
    if (!isWeb) return;
    focusWithRetries(
      () => input.current?.focus(),
      () => nodeOf(input) !== null && dom.document?.activeElement === nodeOf(input),
      false,
    );
  }, []);

  useEffect(() => {
    if (draftKey === undefined) return;
    return registerComposerRestore(draftKey, (restored) => {
      setValue((current) => {
        const next = restoreComposerTextIfEmpty(current, restored);
        setCursor(next.length);
        return next;
      });
      focusInput();
    });
  }, [draftKey, focusInput]);

  useEffect(() => {
    const hasFinePointer = dom.window?.matchMedia?.("(pointer: fine)").matches ?? false;
    if (!isWeb || isCompactFormFactor || !hasFinePointer) return;
    return focusWithRetries(
      () => input.current?.focus(),
      () => nodeOf(input) !== null && dom.document?.activeElement === nodeOf(input),
      true,
    );
  }, []);

  const replaceText = useCallback((next: string) => {
    setValue(next);
    setCursor(next.length);
  }, []);

  const forgeAutoAttach = useForgeAutoAttach({ text: value, cwd, attachments, setAttachments });

  const autocomplete = useAgentAutocomplete({ text: value, cursor, agentId, cwd, setText: replaceText, onApplied: focusInput });

  const addImages = useCallback((images: ImageMetadata[]) => {
    if (images.length === 0) return;
    setAttachments((prev) => {
      const room = MAX_IMAGES - prev.filter((a) => a.kind === "image").length;
      return [...prev, ...images.slice(0, Math.max(0, room)).map((metadata) => ({ kind: "image" as const, metadata }))];
    });
  }, []);

  const uploadSelectedFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const placeholders = files.map((file) => ({ id: nextPendingFileId.current++, fileName: file.name }));
      setPendingFiles((pending) => [...pending, ...placeholders]);
      try {
        const prepared: { fileName: string; mimeType: string; data: string }[] = [];
        for (const file of files) {
          if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`);
          prepared.push({ fileName: file.name, mimeType: file.type || GENERIC_FILE_MIME_TYPE, data: await readBase64(file) });
        }
        const uploaded: ComposerAttachment[] = [];
        for (const file of prepared) {
          const r = await callUpload(file);
          if (!r.ok) throw new Error(r.error || "Upload failed.");
          uploaded.push({ kind: "file", attachment: r.file });
        }
        setAttachments((prev) => [...prev, ...uploaded]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to upload file");
      } finally {
        setPendingFiles((pending) => pending.filter((entry) => !placeholders.includes(entry)));
      }
    },
    [callUpload, toast],
  );

  useFileDrop({ onFiles: addImages, onGenericFiles: (files) => void uploadSelectedFiles(files) }, { disabled: isSubmitLoading });

  useEffect(() => {
    const node = nodeOf(input);
    if (!canAttach || !node) return;
    let disposed = false;
    const onPaste = (event: Event) => {
      if (disabled) return;
      const files = clipboardImageFiles((event as ClipboardEvent).clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void readImageFiles(files).then((images) => !disposed && addImages(images));
    };
    node.addEventListener("paste", onPaste);
    return () => {
      disposed = true;
      node.removeEventListener("paste", onPaste);
    };
  }, [disabled, addImages]);

  const submitMessage = useCallback(
    async (message: string, outgoing: ComposerAttachment[]) => {
      const wire = splitAttachmentsForSubmit(outgoing);
      const failed = await onSend(message, wire.images, wire.attachments);
      if (failed) throw new Error(failed);
    },
    [onSend],
  );

  const sendMessageWithContent = useCallback(
    async (message: string, outgoing: ComposerAttachment[], forceSend?: boolean) => {
      await submitAgentInput({
        message,
        attachments: outgoing,
        forceSend,
        isAgentRunning,
        canSubmit: true,
        queueMessage: ({ message: queuedText, attachments: queuedAttachments }) => agentId && queueComposerMessage({ agentId, id: generateMessageId(), text: queuedText, attachments: queuedAttachments, queue: queueWriter }),
        submitMessage: ({ message: submitText, attachments: submitAttachments }) => submitMessage(submitText, submitAttachments),
        clearDraft: (lifecycle) => draftKey !== undefined && clearDraft(draftKey, lifecycle),
        setUserInput: replaceText,
        setAttachments,
        setSendError,
        setIsProcessing,
      });
    },
    [isAgentRunning, agentId, submitMessage, draftKey, replaceText],
  );

  const handleSendMessage = () => {
    const trimmed = value.trim();
    if (!trimmed && attachments.length === 0) return;
    void sendMessageWithContent(trimmed, attachments, isAgentRunning || undefined);
    composerHeight.reset();
  };

  const insertTranscript = (transcript: string) => {
    replaceText(withTranscript(value, transcript));
    focusInput();
  };

  const sendTranscript = (transcript: string) => {
    const message = withTranscript(value, transcript).trim();
    replaceText(message);
    void sendMessageWithContent(message, attachments, isAgentRunning || undefined);
    composerHeight.reset();
  };

  const dictation = useDictation({ onInsert: insertTranscript, onInsertAndSend: sendTranscript });
  const isDictating = dictation.status !== "idle";

  const handleQueueMessage = () => {
    if (!agentId) return;
    const trimmed = value.trim();
    if (!trimmed && attachments.length === 0) return;
    const queued = queueComposerMessage({ agentId, id: generateMessageId(), text: trimmed, attachments, queue: queueWriter });
    if (!queued) return;
    replaceText("");
    setAttachments([]);
    composerHeight.reset();
  };

  const handleEditQueuedMessage = (id: string) => {
    if (!agentId) return;
    const result = editQueuedComposerMessage({ agentId, messageId: id, queue: queueWriter });
    if (!result) return;
    replaceText(result.text);
    setAttachments(result.attachments);
  };

  const handleSendQueuedNow = async (id: string) => {
    if (!agentId) return;
    const result = await sendQueuedComposerMessageNow({ agentId, messageId: id, queue: queueWriter, submitMessage: ({ text: queuedText, attachments: queuedAttachments }) => submitMessage(queuedText, queuedAttachments) });
    if (result.status === "failed") setSendError(result.errorMessage);
  };

  const drainable = timeline ? timeline.agent !== null && timeline.agent.status !== "running" && !timeline.turn.isActive : false;
  useEffect(() => {
    if (!agentId || !drainable || drainInFlight.current) return;
    const next = queueWriter.read(agentId)[0];
    if (!next) return;
    drainInFlight.current = true;
    void sendQueuedComposerMessageNow({ agentId, messageId: next.id, queue: queueWriter, submitMessage: ({ text: queuedText, attachments: queuedAttachments }) => submitMessage(queuedText, queuedAttachments) })
      .then((result) => {
        if (result.status === "failed") console.error("[PigMonitor] failed to drain queued agent message", { agentId, error: result.errorMessage });
      })
      .finally(() => {
        drainInFlight.current = false;
      });
  }, [agentId, drainable, queuedMessages, submitMessage]);

  const handleCancelAgent = useCallback(() => {
    if (!stop || !isAgentRunning || isCancellingAgent) return;
    const requestId = Date.now();
    timeline?.cancelling(requestId);
    setLocalCancelling(true);
    void stop
      .onStop()
      .then((failed) => {
        if (failed && failed.trim().length > 0) toast.error(failed);
      })
      .finally(() => {
        timeline?.cancelling(null);
        setLocalCancelling(false);
      });
    input.current?.focus();
  }, [stop, isAgentRunning, isCancellingAgent, timeline, toast]);

  const keys = useRef({ resolve: (_chord: KeyChord, _focus: ComposerFocus): ComposerKeyAction | null => null, run: (_action: ComposerKeyAction) => {} });
  keys.current = {
    resolve: (chord, focus) => resolveComposerKey({ key: chord.key, primary: isMac ? chord.metaKey === true && chord.ctrlKey !== true : chord.ctrlKey === true && chord.metaKey !== true, shift: chord.shiftKey === true, alt: chord.altKey === true, focus, dictation: dictation.status, isAgentRunning, isCancelling: isCancellingAgent }),
    run: (action) => {
      if (action === "focus-input") return focusInput();
      if (action === "interrupt") return handleCancelAgent();
      if (action === "dictation-cancel") return void dictation.cancel();
    },
  };

  useEffect(() => {
    const doc = dom.document;
    if (!doc) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const field = nodeOf(input);
      if (field !== null && event.target === field) return;
      const pane = nodeOf(root)?.parentElement;
      const focus: ComposerFocus = event.target === doc.body || (pane && event.target instanceof Node && pane.contains(event.target)) ? "pane" : "outside";
      const action = keys.current.resolve(event, focus);
      if (!action) return;
      if (action !== "interrupt") event.preventDefault();
      keys.current.run(action);
    };
    doc.addEventListener("keydown", onKeyDown);
    return () => doc.removeEventListener("keydown", onKeyDown);
  }, []);

  const pickImage = async () => addImages(await readImageFiles(await chooseFiles("image/*")));
  const pickFile = async () => uploadSelectedFiles(await chooseFiles(null));
  const toggleForgeItem = (item: ForgeItemData) =>
    setAttachments((prev) => {
      const existing = prev.find((a) => (a.kind === "forge_issue" || a.kind === "forge_change_request") && a.item.kind === item.kind && a.item.number === item.number);
      if (existing) forgeAutoAttach.markForgeAttachmentRemoved(existing);
      return toggleForgeAttachment(prev, item);
    });
  const removeAttachment = (index: number) => {
    forgeAutoAttach.markForgeAttachmentRemoved(attachments[index]);
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };
  const openAttachment = (attachment: ComposerAttachment) => {
    if (attachment.kind === "image") return setLightboxUri(attachment.metadata.dataUrl);
    if (attachment.kind === "file") return;
    void openExternalUrl(attachment.item.url);
  };
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeLightbox = useCallback(() => setLightboxUri(undefined), []);
  const imageMenuItem: MenuItem = { id: "image", label: "Add image", icon: <Icon name="Image" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />, onSelect: () => void pickImage() };
  const forgeMenuItem: MenuItem = { id: "github", label: "Add issue or PR", icon: <ForgeGlyph size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />, onSelect: () => setPickerOpen(true) };
  const fileMenuItem: MenuItem = { id: "file", label: "Upload file", icon: <Icon name="Paperclip" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />, onSelect: () => void pickFile() };
  const menuItems: MenuItem[] = canAttach ? [imageMenuItem, forgeMenuItem, fileMenuItem] : [forgeMenuItem];

  const onKeyPress = (event: KeyPressEvent) => {
    if (!isWeb) return;
    const native = event.nativeEvent;
    if (native.isComposing || native.keyCode === 229) return;
    if (autocomplete.onKeyPress({ key: native.key, preventDefault: () => event.preventDefault() })) return;
    const action = keys.current.resolve(native, "input");
    if (action) {
      if (action !== "interrupt") event.preventDefault();
      keys.current.run(action);
      return;
    }
    if (native.key !== "Enter" || isCompactFormFactor || native.shiftKey) return;
    if (disabled || isSubmitLoading) return;
    event.preventDefault();
    if (isDictating) return;
    if ((native.metaKey || native.ctrlKey) && isAgentRunning && onQueue) return handleQueueMessage();
    handleSendMessage();
  };

  const onSelectionChange = (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => setCursor(event.nativeEvent.selection?.start ?? 0);

  const onInputAreaLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (!Number.isFinite(width) || width <= 0) return;
    const below = width < COMPACT_FORM_FACTOR_WIDTH;
    setIsCompactLayout((was) => (was === below ? was : below));
  };

  const primaryAction = resolvePrimaryActionKind({ hasSendableContent, isAgentRunning, isSubmitLoading, keepSendVisible: !isWeb || isCompactFormFactor });
  const canPressLoadingButton = isSubmitLoading && isAgentRunning;
  const isSendButtonDisabled = disabled || (!canPressLoadingButton && isSubmitLoading) || (!hasSendableContent && !isSubmitLoading);
  const sendLabel = canPressLoadingButton ? "Interrupt agent" : isAgentRunning ? "Send and steer" : "Send message";
  const wide = !isCompactFormFactor;
  const controlsContent = typeof controls === "function" ? controls({ isCompactLayout }) : controls;
  const trailingContent = typeof trailing === "function" ? trailing({ isCompactLayout }) : trailing;
  const showFocusHint = isWeb && !isInputFocused && !value;
  const messagePlaceholder = agent ? (isWeb && !isCompactLayout ? DESKTOP_PLACEHOLDER : MOBILE_PLACEHOLDER) : placeholder;
  const footerHint = agent ? undefined : hint;

  return (
    <View ref={root} style={{ position: "relative", flexShrink: 1, alignItems: "center", width: "100%", paddingHorizontal: SPACING[4], paddingBottom: SPACING[4] }} onLayout={onInputAreaLayout}>
      {agentId && timeline ? <ComposerTracks theme={theme} agentId={agentId} items={timeline.tail.concat(timeline.head)} onOpenAgent={agent?.open} /> : null}
      <AttachmentLightbox theme={theme} uri={lightboxUri} onClose={closeLightbox} />
      <View style={{ flexShrink: 1, width: "100%", maxWidth: MAX_CONTENT_WIDTH, gap: SPACING[3], opacity: disabled ? 0.6 : 1 }}>
        {queuedMessages.length > 0 ? (
          <View style={{ gap: SPACING[2] }}>
            {queuedMessages.map((item) => (
              <QueuedMessageRow key={item.id} theme={theme} item={item} onEdit={() => handleEditQueuedMessage(item.id)} onSendNow={() => void handleSendQueuedNow(item.id)} />
            ))}
          </View>
        ) : null}
        {sendError ? (
          <Text accessibilityRole="alert" style={{ color: ERROR_RED, fontSize: 14 }}>
            {sendError}
          </Text>
        ) : null}
        <View style={{ position: "relative", flexShrink: 1, width: "100%", gap: SPACING[3] }}>
          <AutocompletePopover theme={theme} autocomplete={autocomplete} />
          <View style={{ flexShrink: 1, gap: SPACING[3], backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: hostColours(theme).borderAccent, borderRadius: BOX_RADIUS, paddingTop: wide ? SPACING[4] : SPACING[2], paddingBottom: wide ? SPACING[3] : SPACING[2], paddingHorizontal: wide ? SPACING[4] : SPACING[3] }}>
            <AttachmentTray theme={theme} attachments={attachments} pendingFiles={pendingFiles} disabled={false} onOpen={openAttachment} onRemove={removeAttachment} />
            <View style={{ flexShrink: 1, position: "relative" }}>
              <TextInput
                ref={input}
                value={value}
                onChangeText={setValue}
                onKeyPress={onKeyPress}
                onSelectionChange={onSelectionChange}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                editable={!disabled}
                multiline
                scrollEnabled={composerHeight.scrollEnabled}
                blurOnSubmit={false}
                placeholder={messagePlaceholder}
                placeholderTextColor={theme.colors.foregroundMuted}
                accessibilityLabel="Message agent..."
                style={[{ flexShrink: 1, width: "100%", color: theme.colors.foreground, fontSize: CONTENT_FONT, fontWeight: "400", lineHeight: CONTENT_FONT * 1.4, height: composerHeight.height, minHeight: MIN_INPUT_HEIGHT, maxHeight: maxInputHeight, padding: 0, borderWidth: 0 }, NO_OUTLINE]}
              />
              {showFocusHint ? (
                <Text style={{ position: "absolute", top: 0, right: 0, fontSize: 12, color: theme.colors.foregroundMuted, opacity: 0.5, pointerEvents: "none" }}>{FOCUS_HINT}</Text>
              ) : null}
            </View>
            <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginHorizontal: -6 }}>
              <View style={{ minWidth: 0, flexShrink: 1, flexGrow: 1, flexDirection: "row", alignItems: "flex-end" }}>
                <AnchoredMenu theme={theme} open={menuOpen} label="Add attachment" items={menuItems} onClose={closeMenu}>
                  <Pressable onPress={() => setMenuOpen((was) => !was)} disabled={disabled} accessibilityRole="button" accessibilityLabel="Add attachment" style={(state) => ({ width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: "center", justifyContent: "center", backgroundColor: hoveredOf(state) ? theme.colors.surface2 : "transparent", opacity: disabled ? 0.5 : 1 })}>
                    {(state) => <Icon name="Plus" size={ICON_SIZE.md} color={hoveredOf(state) ? theme.colors.foreground : theme.colors.foregroundMuted} />}
                  </Pressable>
                </AnchoredMenu>
                {isDictating ? null : controlsContent}
              </View>
              <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
                {trailingContent}
                <DictationButton theme={theme} disabled={disabled} dictation={dictation} />
                {primaryAction === "active" && !isDictating ? (
                  <Pressable onPress={handleCancelAgent} disabled={isCancellingAgent} accessibilityRole="button" accessibilityLabel={isCancellingAgent ? "Canceling agent" : "Stop agent"} style={{ width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, backgroundColor: CANCEL_RED, alignItems: "center", justifyContent: "center", marginLeft: SPACING[1], opacity: isCancellingAgent ? 0.5 : 1 }}>
                    {isCancellingAgent ? <ActivityIndicator size="small" color="white" /> : <View style={{ width: 11, height: 11, borderRadius: 2, backgroundColor: "white" }} />}
                  </Pressable>
                ) : null}
                {primaryAction === "send" && !isDictating ? (
                  <Pressable onPress={canPressLoadingButton ? handleCancelAgent : handleSendMessage} disabled={isSendButtonDisabled} accessibilityRole="button" accessibilityLabel={sendLabel} style={{ width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center", marginLeft: SPACING[1], opacity: isSendButtonDisabled ? 0.5 : 1 }}>
                    {isSubmitLoading ? <ActivityIndicator size="small" color={theme.colors.accentForeground} /> : <Icon name="ArrowUp" size={ICON_SIZE.md} color={theme.colors.accentForeground} />}
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
          <ForgePicker theme={theme} open={pickerOpen} cwd={cwd} attachments={attachments} onToggle={toggleForgeItem} onOpenChange={setPickerOpen} />
        </View>
        {footerHint ? (
          <Text style={[text(theme, "label"), { paddingHorizontal: SPACING[3] }]} numberOfLines={2}>
            {footerHint}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
