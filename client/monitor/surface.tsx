import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { foldsOf, isHidden, NO_FOLDS, prune, setHidden, setTab, showAll, type Folds } from "../../shared/folds.ts";
import { snapshot, viewSettings } from "../../shared/rpc.ts";
import { readView, related, type Dir, type Row, type View as PigView } from "../../shared/view.ts";
import { DetailDialog, type Index } from "../dialog.tsx";
import { Header } from "../header.tsx";
import { conversationsOf, HiddenProjects, SessionsPane } from "../sessions/sessions.tsx";
import type { Navigation } from "../chat/chat-route.tsx";
import { StoredPalette } from "../piggery/palette.tsx";
import { Notice } from "../piggery/notice.tsx";
import { columnsFor } from "../piggery/row-layout.ts";
import { TabBar } from "../kit/tab-bar.tsx";
import { CHAT_SPLIT_MIN, SPACING, text } from "../kit/theme.ts";
import { pollEvery, useNow, usePoll } from "../kit/poll.ts";
import { type Handlers, Overview } from "./overview.tsx";
import { itemsIn } from "./graph-layout.ts";
import { Graph } from "./graph.tsx";

function useView(dir: string | undefined) {
  const call = useRpc(snapshot);
  return usePoll(
    async () => {
      const r = await call({ dir });
      if (!r.ok) return r;
      const v = readView(r.view);
      return v.ok ? { ok: true as const, value: { view: v.view, dir: r.dir ?? dir, segments: r.segments ?? {} } } : v;
    },
    `view:${dir ?? ""}`,
    (v) => pollEvery((v?.view.summary.working ?? 0) + (v?.view.summary.waiting ?? 0) > 0),
  );
}

function indexOf(view: PigView): Index {
  const out: Index = new Map();
  for (const list of [view.all, view.closed]) for (const d of list.dirs) for (const b of d.blocks) for (const r of b.rows) out.set(r.id, r);
  return out;
}

function dirsOf(view: PigView, dir: string | undefined): Dir[] {
  if (dir === undefined) return view.all.dirs;
  const mine = view.all.dirs.filter((d) => related(d.path, dir));
  const own = (d: Dir) => d.path.replace(/\/+$/, "") === dir.replace(/\/+$/, "");
  return [...mine.filter(own), ...mine.filter((d) => !own(d))];
}

function useFolds(set: (f: Folds) => void, view: PigView | null) {
  const stored = useSettings(viewSettings);
  const latest = useRef({ stored, view });
  latest.current = { stored, view };
  const restored = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (stored.status === "ready" && !restored.current) {
      restored.current = true;
      set(foldsOf(stored.values));
    }
  }, [stored.status]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (next: Folds) => {
    set(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { stored: s, view: v } = latest.current;
      if (s.status !== "ready") return;
      if (!(await s.save({ ...s.values, ...prune(next, (v?.tabs ?? []).map((t) => t.key)) }, s.revision))) await s.reload();
    }, 300);
  };
  return { change };
}

export function Shell({ theme, compact, dir, empty, navigation, serverId }: { theme: PluginTheme; compact: boolean; dir?: string; empty: string; navigation?: Navigation; serverId?: string }) {
  const { value: snap, error, at } = useView(dir);
  const view = snap?.view ?? null;
  const now = useNow(1000);
  const [width, setWidth] = useState(0);
  const [folds, setFolds] = useState<Folds>(NO_FOLDS);
  const { change } = useFolds(setFolds, view);
  const [opened, setOpened] = useState<string | null>(null);
  const index = view ? indexOf(view) : new Map<string, Row>();
  const allDirs = view ? dirsOf(view, dir === undefined ? undefined : snap?.dir) : [];
  const dirs = allDirs.filter((d) => !isHidden(folds, d.path));
  const hidden = allDirs.length - dirs.length;
  const hide = (path: string) => change(setHidden(folds, path, true));
  const unhide = () => change(showAll(folds));
  const h: Handlers = { folds, change, open: setOpened, columns: columnsFor(width) };
  const whole = dir === undefined;
  const graph = folds.tab === "graph";
  const sessionsTab = folds.tab === "sessions";
  const [session, setSession] = useState("");
  const sessions = view ? conversationsOf(view, dirs) : [];
  const sessionId = sessions.some((c) => c.row.id === session) ? session : "";
  const [chatOpened, setChatOpened] = useState(false);
  const chatFillsPane = sessionsTab && chatOpened && sessionId !== "" && width < CHAT_SPLIT_MIN;
  const graphCount = whole ? view?.tabs.find((t) => t.key === "")?.count : view ? itemsIn(view, dirs).length : undefined;
  const tabs = [{ id: "overview" as const, label: "Overview" }, { id: "graph" as const, label: "Graph", count: graphCount }, { id: "sessions" as const, label: "Sessions", count: sessions.length }];
  const tabBar = view ? <TabBar theme={theme} tabs={tabs} active={sessionsTab ? "sessions" : graph ? "graph" : "overview"} onPick={(t) => change(setTab(folds, t))} /> : null;
  const topBar = view && !(chatFillsPane && !error) ? (
    <View style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <View style={{ gap: SPACING[2], paddingHorizontal: SPACING[4], paddingTop: SPACING[4], paddingBottom: SPACING[2] }}>
        {error ? <Text style={text(theme, "label", "statusWarning")}>{`Showing the last read: ${error.message}`}</Text> : null}
        {chatFillsPane ? null : tabBar}
      </View>
    </View>
  ) : null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {topBar}
      {view && sessionsTab ? (
        <SessionsPane theme={theme} view={view} dirs={dirs} width={width} selected={sessionId} opened={chatOpened} now={now} navigation={navigation} serverId={serverId} hidden={hidden} onSelect={setSession} onOpened={setChatOpened} onInfo={setOpened} onHide={hide} onShowHidden={unhide} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SPACING[6] }}>
          <View>
            {view ? (
              <View style={{ paddingHorizontal: SPACING[4], paddingTop: SPACING[4] }}>
                <Header theme={theme} summary={view.summary} daemon={view.daemon} at={at} now={now} />
              </View>
            ) : null}
            {error && !view ? <Notice theme={theme} kind={error.code} detail={error.message} /> : null}
            {!view && !error ? <Notice theme={theme} kind="loading" /> : null}
            {view && dirs.length === 0 ? <Notice theme={theme} kind="empty" detail={empty} /> : null}
            {view && !graph ? (
              <View style={{ paddingHorizontal: SPACING[4], paddingTop: SPACING[4] }}>
                <Overview theme={theme} view={view} segments={snap?.segments ?? {}} dirs={dirs} h={h} index={index} whole={whole} width={width} now={now} empty={empty} />
              </View>
            ) : null}
            {view && hidden > 0 ? (
              <View style={{ paddingHorizontal: SPACING[4] }}>
                <HiddenProjects theme={theme} count={hidden} onShow={unhide} />
              </View>
            ) : null}
            {view && graph ? <Graph theme={theme} view={view} dirs={whole ? undefined : dirs} open={setOpened} /> : null}
          </View>
        </ScrollView>
      )}
      {view ? <DetailDialog theme={theme} view={view} index={index} root={opened} onClose={() => setOpened(null)} /> : null}
    </View>
  );
}

export function PigMonitorSurface({ theme, layout, navigation, host }: PluginSurfaceProps) {
  return <StoredPalette><Shell theme={theme} compact={layout.compact} navigation={navigation} serverId={host.id} empty="Open an agent session, or ask one to make a team." /></StoredPalette>;
}
