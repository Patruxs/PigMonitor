import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type NativeSyntheticEvent, type PressableStateCallbackType, type TextStyle } from "react-native";
import { MIN_INPUT_HEIGHT } from "./input-height.ts";
import { resolvePrimaryActionKind } from "./submit.ts";
import { type AttachmentData, type ImageData } from "../../shared/rpc.ts";
import { AttachmentTray } from "./attachments.tsx";
import { ForgePicker } from "./attachments-forge.tsx";
import { AutocompletePopover, useAgentAutocomplete } from "./autocomplete.tsx";
import { AttachmentLightbox } from "../kit/lightbox.tsx";
import { AnchoredMenu } from "../kit/menu.tsx";
import { CONTENT_FONT, hostColours, ICON_SIZE, MAX_CONTENT_WIDTH, SPACING, text } from "../kit/theme.ts";
import { useQueueActions, useQueuedMessages } from "./queue.tsx";
import type { AgentTimeline } from "../stream/timeline.ts";
import { ComposerTracks } from "./tracks.tsx";
import { DictationButton, useComposerDictation } from "./dictation.tsx";
import { FOCUS_HINT, ModeCycleScope, useComposerKeys } from "./composer-keys.tsx";
import { useComposerHeight } from "./composer-height.ts";
import { QueuedMessageRow } from "./queue.tsx";
import { useComposerAttachments } from "./composer-attachments.ts";
import { useComposerText } from "./composer-text.ts";
import { useComposerLayout } from "./composer-layout.ts";
import { useComposerFocus, useInitialFocus } from "./composer-focus.ts";
import { useComposerSend } from "./composer-send.ts";
import { useComposerDraft } from "./composer-draft.ts";
import { useAgentCancel } from "./agent-cancel.ts";
import { useAttachmentOverlays } from "./attachment-overlays.tsx";
import { NO_OUTLINE, isWeb } from "../kit/platform.ts";


interface ComposerAgent {
  agentId: string;
  participantId: string;
  timeline: AgentTimeline;
  open?: (agentId: string) => void;
}

const BUTTON = 28;
const BOX_RADIUS = 16;
const CANCEL_RED = "#dc2626";
const ERROR_RED = "#ef4444";

const DESKTOP_PLACEHOLDER = "Message the agent, tag @files, or use /commands and /skills";
const MOBILE_PLACEHOLDER = "Message, @files, /commands";

type KeyPressEvent = NativeSyntheticEvent<{ key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; isComposing?: boolean; keyCode?: number }>;

function hoveredOf(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}


type ToolbarSlot = ReactNode | ((layout: { isCompactLayout: boolean }) => ReactNode);


export function Composer({ theme, placeholder, disabled = false, hint, controls, trailing, draftKey, cwd, stop, agent, onSend }: { theme: PluginTheme; placeholder: string; disabled?: boolean; hint?: string; controls?: ToolbarSlot; trailing?: ToolbarSlot; draftKey?: string; cwd?: string; stop?: { running: boolean; onStop: () => Promise<string | null> }; agent?: ComposerAgent; onSend: (body: string, images: ImageData[], attachments: AttachmentData[]) => Promise<string | null> }) {
  const { initial, value, setValue, cursor, setCursor, replaceText, onSelectionChange } = useComposerText(draftKey);
  const [isProcessing, setIsProcessing] = useState(false);
  const { isCompactFormFactor, isCompactLayout, maxInputHeight, onInputAreaLayout } = useComposerLayout();
  const input = useRef<TextInput>(null);
  const root = useRef<View>(null);
  const toast = useToast();
  const paseo = usePaseo();
  const composerHeight = useComposerHeight(input, value, maxInputHeight);
  const agentId = agent?.agentId;
  const timeline = agent?.timeline;
  const queueKey = agent?.participantId;
  const queuedMessages = useQueuedMessages(queueKey);
  const isAgentRunning = timeline ? timeline.turn.isActive : stop?.running === true;
  const intake = useComposerAttachments({ initial: initial.attachments, text: value, cwd, field: input, disabled, isProcessing });
  const { attachments, setAttachments, pendingFiles } = intake;
  const isSubmitLoading = isProcessing || pendingFiles.length > 0;
  const hasSendableContent = value.trim().length > 0 || attachments.length > 0;
  const onQueue = agentId !== undefined;
  const { isInputFocused, setIsInputFocused, focusInput } = useComposerFocus(input);
  const { sendError, setSendError, submitMessage, sendMessageWithContent, handleSendMessage } = useComposerSend({ onSend, draftKey, value, attachments, setAttachments, replaceText, setIsProcessing, isAgentRunning, agentId, queueKey, paseo, composerHeight });
  const { handleQueueMessage, handleEditQueuedMessage, handleSendQueuedNow } = useQueueActions({ paseo, queueKey, agentId, value, attachments, setAttachments, replaceText, composerHeight, submitMessage, setSendError });
  useComposerDraft({ draftKey, value, attachments, setValue, setCursor, setAttachments, focusInput });
  useInitialFocus(input, isCompactFormFactor);

  const autocomplete = useAgentAutocomplete({ text: value, cursor, agentId, cwd, setText: replaceText, onApplied: focusInput });
  const { dictation, isDictating } = useComposerDictation({ value, attachments, isAgentRunning, replaceText, focusInput, sendMessageWithContent, composerHeight });
  const { isCancellingAgent, handleCancelAgent } = useAgentCancel({ stop, timeline, isAgentRunning, toast, input });

  const keys = useComposerKeys({
    field: input,
    state: { dictation: dictation.status, isAgentRunning, isCancelling: isCancellingAgent },
    run: (action) => {
      if (action === "focus-input") return focusInput();
      if (action === "interrupt") return handleCancelAgent();
      if (action === "dictation-cancel") return void dictation.cancel();
      if (action === "dictation-send") return void dictation.confirm(true);
      if (action === "dictation-toggle" && !disabled) return void dictation.toggle();
      if (action === "mode-cycle") return keys.modeCycle.current?.();
    },
  });

  const { menuOpen, setMenuOpen, pickerOpen, setPickerOpen, lightboxUri, openAttachment, closeMenu, closeLightbox, menuItems, menuNote } = useAttachmentOverlays({ theme, intake });

  const onKeyPress = (event: KeyPressEvent) => {
    if (!isWeb) return;
    const native = event.nativeEvent;
    if (native.isComposing || native.keyCode === 229) return;
    if (autocomplete.onKeyPress({ key: native.key, preventDefault: () => event.preventDefault() })) return;
    const action = keys.inputKey(native);
    if (action) {
      if (action !== "interrupt") event.preventDefault();
      return;
    }
    if (native.key !== "Enter" || isCompactFormFactor || native.shiftKey) return;
    if (disabled || isSubmitLoading) return;
    event.preventDefault();
    if (isDictating) return;
    if ((native.metaKey || native.ctrlKey) && isAgentRunning && onQueue) return handleQueueMessage();
    handleSendMessage();
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
    <ModeCycleScope slot={keys.modeCycle}>
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
            <AttachmentTray theme={theme} attachments={attachments} pendingFiles={pendingFiles} disabled={false} onOpen={openAttachment} onRemove={intake.removeAttachment} />
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
                style={[{ flexShrink: 1, width: "100%", color: theme.colors.foreground, fontSize: CONTENT_FONT, fontWeight: "400", ...(isWeb ? { lineHeight: CONTENT_FONT * 1.4 } : {}), ...(composerHeight.height !== undefined ? { height: composerHeight.height } : {}), minHeight: MIN_INPUT_HEIGHT, maxHeight: maxInputHeight, padding: 0, borderWidth: 0 }, NO_OUTLINE]}
              />
              {showFocusHint ? (
                <Text style={{ position: "absolute", top: 0, right: 0, fontSize: 12, color: theme.colors.foregroundMuted, opacity: 0.5, pointerEvents: "none" }}>{FOCUS_HINT}</Text>
              ) : null}
            </View>
            <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginHorizontal: -6 }}>
              <View style={{ minWidth: 0, flexShrink: 1, flexGrow: 1, flexDirection: "row", alignItems: "flex-end" }}>
                <AnchoredMenu theme={theme} open={menuOpen} label="Add attachment" items={menuItems} note={menuNote} onClose={closeMenu}>
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
          <ForgePicker theme={theme} open={pickerOpen} cwd={cwd} attachments={attachments} onToggle={intake.toggleForgeItem} onOpenChange={setPickerOpen} />
        </View>
        {footerHint ? (
          <Text style={[text(theme, "label"), { paddingHorizontal: SPACING[3] }]} numberOfLines={2}>
            {footerHint}
          </Text>
        ) : null}
      </View>
    </View>
    </ModeCycleScope>
  );
}
