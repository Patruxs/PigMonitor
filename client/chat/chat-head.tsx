import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Conversation } from "../sessions/conversations.ts";
import { basenameOf } from "../../shared/events.ts";
import type { ChatRoute } from "../../shared/chat-route.ts";
import { AVATAR } from "../kit/avatar.tsx";
import { Pill } from "../kit/pill.tsx";
import { paint, usePalette } from "../palette.tsx";
import { RoleAvatar } from "../piggery/role.tsx";
import { STATUS_WORD, StatusDot, StatusPill, StatusWord } from "../piggery/status.tsx";
import { AnchoredMenu, type MenuItem } from "../kit/menu.tsx";
import { useCompact } from "../kit/platform.ts";
import { AVATAR_LG, ICON_SIZE, SPACING, text } from "../kit/theme.ts";
import { PaseoLink, type ChatRouting } from "./chat-route.tsx";

const HEAD_STACK_BELOW = 560;
const COMPACT_HEAD_HEIGHT = 44;
const COMPACT_STATUS_DOT = 10;

function SessionMenu({ theme, name, items }: { theme: PluginTheme; name: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <AnchoredMenu theme={theme} open={open} label={`${name} menu`} items={items} drop="down-left" onClose={() => setOpen(false)}>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Session menu" hitSlop={SPACING[2]} style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}>
        <Icon name="Ellipsis" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />
      </Pressable>
    </AnchoredMenu>
  );
}

function sessionItems(theme: PluginTheme, item: Conversation, route: ChatRoute, chat: ChatRouting, writable: boolean, onInfo: () => void, toast: ReturnType<typeof useToast>): MenuItem[] {
  const resume = async () => {
    const failed = await chat.resume(item.row.id);
    if (failed) toast.error(failed);
  };
  const muted = theme.colors.foregroundMuted;
  const items: MenuItem[] = [{ id: "details", label: "Session details", icon: <Icon name="Info" size={ICON_SIZE.md} color={muted} />, onSelect: onInfo }];
  if (route.kind === "open" && chat.canOpen) items.push({ id: "open", label: "Open in Paseo", icon: <Icon name="ExternalLink" size={ICON_SIZE.md} color={muted} />, onSelect: () => chat.open(route.agentId) });
  if (route.kind === "resume" && writable) items.push({ id: "resume", label: "Resume in Paseo", icon: <Icon name="Import" size={ICON_SIZE.md} color={muted} />, onSelect: () => void resume() });
  return items;
}

function CompactChatHead({ theme, item, route, chat, writable, steps, onBack, onInfo }: { theme: PluginTheme; item: Conversation; route: ChatRoute; chat: ChatRouting; writable: boolean; steps: MenuItem[]; onBack?: () => void; onInfo: () => void }) {
  const palette = usePalette(theme);
  const toast = useToast();
  const { row } = item;
  const place = item.teamName ?? basenameOf(item.dir.path);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: COMPACT_HEAD_HEIGHT, paddingLeft: onBack ? SPACING[1] : SPACING[3], paddingRight: SPACING[2], borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface0 }}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to sessions" hitSlop={SPACING[2]} style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}>
          <Icon name="ChevronLeft" size={ICON_SIZE.md} color={theme.colors.foreground} />
        </Pressable>
      ) : null}
      <View style={{ width: AVATAR, height: AVATAR }}>
        <RoleAvatar theme={theme} name={row.name} role={row.role} id={row.id} size={AVATAR} dim={row.dim} />
        <StatusDot theme={theme} status={row.status} dim={row.dim} size={COMPACT_STATUS_DOT} />
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACING[1.5], overflow: "hidden" }} accessibilityLabel={`${row.name}, ${STATUS_WORD[row.status]}, in ${place}`}>
        <Text style={[text(theme, "rowTitle"), { fontWeight: "600", flexShrink: 1 }]} numberOfLines={1}>
          {row.name}
        </Text>
        {row.role ? <Pill theme={theme} label={row.role} colour={paint(palette, row.role, row.id)} filled /> : null}
        <StatusWord theme={theme} status={row.status} dim={row.dim} />
        <Text style={[text(theme, "label"), { flexShrink: 2, minWidth: 0 }]} numberOfLines={1}>
          {place}
        </Text>
      </View>
      <SessionMenu theme={theme} name={row.name} items={[...sessionItems(theme, item, route, chat, writable, onInfo, toast), ...steps]} />
    </View>
  );
}

export function ChatHead({ theme, item, route, chat, writable, steps, onBack, onInfo }: { theme: PluginTheme; item: Conversation; route: ChatRoute; chat: ChatRouting; writable: boolean; steps: MenuItem[]; onBack?: () => void; onInfo: () => void }) {
  const palette = usePalette(theme);
  const compactFormFactor = useCompact();
  const [width, setWidth] = useState(0);
  if (compactFormFactor) return <CompactChatHead theme={theme} item={item} route={route} chat={chat} writable={writable} steps={steps} onBack={onBack} onInfo={onInfo} />;
  const stacked = width > 0 && width < HEAD_STACK_BELOW;
  const link = <PaseoLink theme={theme} id={item.row.id} route={route} chat={chat} writable={writable} />;
  const { row } = item;
  const colour = paint(palette, row.role, row.id);
  const sub = [row.harness, row.model && row.model !== "-" ? row.model : undefined, row.ctx ? `${row.ctx} ctx` : undefined, row.turns ? `${row.turns} turns` : undefined].filter(Boolean).join(" · ");
  const project = basenameOf(item.dir.path);
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ zIndex: 1, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingHorizontal: SPACING[3], paddingTop: SPACING[2], overflow: "hidden" }} accessibilityLabel={`In project ${project}${item.teamName ? `, team ${item.teamName}` : ""}`}>
      <Icon name="Folder" size={12} color={theme.colors.accent} />
      <Text style={[text(theme, "label"), { color: theme.colors.foreground, fontWeight: "600", flexShrink: 0 }]} numberOfLines={1}>
        {project}
      </Text>
      <Text style={[text(theme, "label"), { flexShrink: 1, minWidth: 0 }]} numberOfLines={1} ellipsizeMode="head">
        {item.dir.label}
      </Text>
      {item.teamName ? (
        <>
          <Icon name="ChevronRight" size={11} color={theme.colors.foregroundMuted} />
          <Icon name="Users" size={12} color={theme.colors.foregroundMuted} />
          <Text style={[text(theme, "label"), { color: theme.colors.foreground, fontWeight: "600", flexShrink: 0 }]} numberOfLines={1}>
            {item.teamName}
          </Text>
          {item.template ? <Text style={[text(theme, "label"), { flexShrink: 0 }]} numberOfLines={1}>{item.template}</Text> : null}
        </>
      ) : (
        <>
          <Icon name="ChevronRight" size={11} color={theme.colors.foregroundMuted} />
          <Text style={text(theme, "label")}>solo session</Text>
        </>
      )}
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[3], paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], minHeight: 56 }}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to sessions" hitSlop={SPACING[2]} style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}>
          <Icon name="ChevronLeft" size={ICON_SIZE.md} color={theme.colors.foreground} />
        </Pressable>
      ) : null}
      <View style={{ width: AVATAR_LG, height: AVATAR_LG }}>
        <RoleAvatar theme={theme} name={row.name} role={row.role} id={row.id} size={AVATAR_LG} dim={row.dim} />
        <StatusDot theme={theme} status={row.status} dim={row.dim} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: SPACING[0.5] }}>
        <View style={{ flexDirection: "row", flexWrap: stacked ? "wrap" : "nowrap", alignItems: "center", columnGap: SPACING[2], rowGap: SPACING[0.5] }}>
          <Text style={[text(theme, "rowTitle"), { fontWeight: "600", flexShrink: 1 }]} numberOfLines={1}>
            {row.name}
          </Text>
          {row.role ? <Pill theme={theme} label={row.role} colour={colour} filled /> : null}
          {row.gate ? <Pill theme={theme} label="gate" icon="DoorOpen" /> : null}
          <StatusPill theme={theme} status={row.status} word={row.state_text} dim={row.dim} />
        </View>
        <Text style={text(theme, "label")} numberOfLines={1}>
          {sub || item.preview}
        </Text>
        {stacked ? <View style={{ flexDirection: "row", marginTop: SPACING[0.5] }}>{link}</View> : null}
      </View>
      {stacked ? null : link}
      {steps.length > 0 ? <SessionMenu theme={theme} name={row.name} items={steps} /> : null}
      <Pressable onPress={onInfo} accessibilityRole="button" accessibilityLabel="About this session" hitSlop={SPACING[2]} style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}>
        <Icon name="Info" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
    </View>
  );
}
