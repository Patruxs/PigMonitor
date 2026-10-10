import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { conversationsOf, mostPressing } from "../shared/conversations.ts";
import { withPaseoBusy } from "../shared/chat-route.ts";
import { person } from "../shared/rpc.ts";
import type { Me } from "../shared/mail.ts";
import type { Dir, View as PigView } from "../shared/view.ts";
import { Chat } from "./chat-pane.tsx";
import { Notice } from "./piggery/notice.tsx";
import { CHAT_SPLIT_MIN, LIST_MIN_WIDTH, LIST_WIDTH, SPACING, text } from "./kit/theme.ts";
import { useChatRouting, type Navigation } from "./chat-route.tsx";
import { QUIET_MS, usePoll } from "./poll.ts";
import { useProjectActions } from "./project.tsx";
import { ResizeHandle, clampWidth, useSavedListWidth } from "./resize.tsx";
import { ConversationList, HiddenProjects } from "./session-list.tsx";

function usePerson(bump: number): Me | null {
  const call = useRpc(person);
  const { value } = usePoll(
    async () => {
      const r = await call({});
      return r.ok ? { ok: true as const, value: r.person } : r;
    },
    `person:${bump}`,
    () => QUIET_MS,
  );
  return value ?? null;
}

function Empty({ theme }: { theme: PluginTheme }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: SPACING[2], padding: SPACING[6] }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.surface1, alignItems: "center", justifyContent: "center" }}>
        <Icon name="MessagesSquare" size={24} color={theme.colors.foregroundMuted} />
      </View>
      <Text style={text(theme, "rowTitle")}>Pick a session</Text>
      <Text style={[text(theme, "meta"), { textAlign: "center", maxWidth: 320 }]}>Choose one on the left to read what the agent did, turn by turn.</Text>
    </View>
  );
}

export function SessionsPane({ theme, view, dirs, width, selected, opened, now, navigation, serverId, hidden, onSelect, onOpened, onInfo, onHide, onShowHidden }: { theme: PluginTheme; view: PigView; dirs: Dir[]; width: number; selected: string; opened: boolean; now: number; navigation?: Navigation; serverId?: string; hidden: number; onSelect: (id: string) => void; onOpened: (opened: boolean) => void; onInfo: (id: string) => void; onHide: (path: string) => void; onShowHidden: () => void }) {
  const actions = useProjectActions(navigation, serverId, onHide);
  const [sent, setSent] = useState(0);
  const me = usePerson(sent);
  const listed = conversationsOf(view, dirs).filter((c) => c.row.id !== me?.id);
  const wide = width >= CHAT_SPLIT_MIN;
  const chat = useChatRouting(listed.map((c) => c.row.id), (listed.find((c) => c.row.id === selected) ?? (wide ? mostPressing(listed) : undefined))?.row.id ?? "", navigation, serverId);
  const items = listed.map((c) => ({ ...c, row: withPaseoBusy(c.row, chat.paseoBusy(c.row.id)) }));
  const current = items.find((c) => c.row.id === selected) ?? (wide ? mostPressing(items) : undefined);
  const [listWidth, setListWidth, saveListWidth] = useSavedListWidth(LIST_WIDTH);
  if (width === 0) return <View style={{ flex: 1 }} />;
  if (items.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <Notice theme={theme} kind="empty" detail="Open an agent session, or ask one to make a team." />
        {hidden > 0 ? <View style={{ paddingHorizontal: SPACING[3] }}><HiddenProjects theme={theme} count={hidden} onShow={onShowHidden} /></View> : null}
      </View>
    );
  }
  const pick = (id: string) => {
    onSelect(id);
    onOpened(true);
  };
  if (!wide) {
    if (opened && current) return <Chat key={current.row.id} theme={theme} item={current} all={items} me={me} chat={chat} onSent={() => setSent((n) => n + 1)} onPick={pick} onBack={() => onOpened(false)} onInfo={() => onInfo(current.row.id)} />;
    return <ConversationList theme={theme} items={items} selected={selected} now={now} actions={actions} hidden={hidden} onPick={pick} onShowHidden={onShowHidden} />;
  }
  const listMaxWidth = width / 2;
  const shownListWidth = clampWidth(listWidth, LIST_MIN_WIDTH, listMaxWidth);
  return (
    <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
      <View style={{ width: shownListWidth, borderRightWidth: 1, borderRightColor: theme.colors.border, zIndex: 1 }}>
        <ConversationList theme={theme} items={items} selected={current?.row.id ?? ""} now={now} actions={actions} hidden={hidden} onPick={pick} onShowHidden={onShowHidden} />
        <ResizeHandle theme={theme} width={shownListWidth} minWidth={LIST_MIN_WIDTH} maxWidth={listMaxWidth} onResize={setListWidth} onResizeEnd={saveListWidth} />
      </View>
      {current ? <Chat key={current.row.id} theme={theme} item={current} all={items} me={me} chat={chat} onSent={() => setSent((n) => n + 1)} onPick={pick} onInfo={() => onInfo(current.row.id)} /> : <Empty theme={theme} />}
    </View>
  );
}

export { conversationsOf, HiddenProjects };
