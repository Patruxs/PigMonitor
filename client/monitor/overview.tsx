import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useRef, useState } from "react";
import { Animated, ScrollView as NativeScrollView, Text, View } from "react-native";
import { sentenceOf } from "../piggery/events.ts";
import { setTeam, teamOpen, type Folds } from "../../shared/folds.ts";
import type { Dir, EventRow, Row, View as PigView } from "../../shared/view.ts";
import type { Index } from "./dialog.tsx";
import type { Segment } from "../../shared/segments.ts";
import { Pill } from "../kit/pill.tsx";
import { RoleAvatar } from "../piggery/role.tsx";
import { Chip } from "../kit/badge.tsx";
import { paint, teamColour, usePalette } from "../piggery/palette.tsx";
import { PressRow } from "../kit/press.tsx";
import type { Columns } from "../piggery/row-layout.ts";
import { Rows } from "../kit/rows.tsx";
import { CARD_RADIUS, ICON_SIZE, ROW_ONE, SPACING, text, tint } from "../kit/theme.ts";
import { Axis, ChartLegend, currentWordFits, Grid, type Group, groupsOfView, LABEL_W, LABEL_W_NARROW, LaneHead, lastSibling, MIN_TICK_PX, NOW_PAD, parseClock, type Scale, TimeSlider, Track, TrackLabel, WINDOWS } from "./overview-chart.tsx";

export interface Handlers {
  folds: Folds;
  change: (next: Folds) => void;
  open: (id: string) => void;
  columns: Columns;
}

export function Overview({ theme, view, segments, dirs, h, index, whole, width, now, empty }: { theme: PluginTheme; view: PigView; segments: Record<string, Segment[]>; dirs: Dir[]; h: Handlers; index: Index; whole: boolean; width: number; now: number; empty: string }) {
  const palette = usePalette(theme);
  const [pick, setPick] = useState(1);
  const win = WINDOWS[pick];
  const narrow = width < 640;
  const labelW = narrow ? LABEL_W_NARROW : LABEL_W;
  const [cardW, setCardW] = useState(0);
  const trackFit = Math.max(0, cardW - labelW);
  const trackW = Math.max(trackFit, (win.ms / win.tick) * MIN_TICK_PX + NOW_PAD);
  const scrollable = trackW > trackFit;
  const scale: Scale = { start: now - win.ms, now, width: Math.max(0, trackW - NOW_PAD) };
  const contentW = labelW + trackW;
  const scrollX = useRef(new Animated.Value(0)).current;
  const sticky = { transform: [{ translateX: scrollX }], zIndex: 2, backgroundColor: theme.colors.surface0 };
  const scroller = useRef<NativeScrollView>(null);
  const { groups, sleepers } = groupsOfView(view, dirs, scale.start);
  const stamped = view.events.map((e) => ({ ...e, t: parseClock(e.time, now) })).filter((e): e is EventRow & { t: number } => e.t !== undefined && e.t >= scale.start);
  const eventsOf = (name: string) => stamped.filter((e) => e.who === name || e.target === name).map((e) => ({ t: e.t, tone: e.tone, type: e.type }));
  const sleeping = sleepers.reduce((n, s) => n + s.agents, 0);
  const laneOpen = (g: Group) => teamOpen(h.folds, g.key, true);
  const openCount = groups.filter(laneOpen).length;
  const setAll = (open: boolean) => h.change(groups.reduce((f, g) => setTeam(f, g.key, open, true), h.folds));
  const total = groups.reduce((n, g) => n + g.members.length, 0);
  const divider = tint(theme.colors.border, "99");
  return (
    <View style={{ gap: SPACING[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACING[2], rowGap: SPACING[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
          <Text style={[text(theme, "label"), { marginRight: SPACING[1] }]}>Last</Text>
          {WINDOWS.map((w, i) => (
            <Chip key={w.label} theme={theme} label={w.label} on={i === pick} onPress={() => setPick(i)} />
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
          <Chip theme={theme} label="Expand all" on={false} onPress={() => setAll(true)} />
          <Chip theme={theme} label="Collapse all" on={false} onPress={() => setAll(false)} />
        </View>
      </View>
      {groups.length === 0 ? (
        <View style={{ alignItems: "center", gap: SPACING[2], paddingVertical: SPACING[8] }}>
          <Icon name="Moon" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />
          <Text style={text(theme, "section")}>No one is awake</Text>
          <Text style={[text(theme, "meta"), { textAlign: "center", maxWidth: 360 }]}>{empty}</Text>
        </View>
      ) : (
        <View style={{ borderRadius: CARD_RADIUS, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden", backgroundColor: theme.colors.surface0 }} onLayout={(e) => setCardW(Math.max(0, e.nativeEvent.layout.width - 2))}>
          <NativeScrollView
            ref={scroller}
            horizontal
            scrollEnabled={scrollable}
            bounces={false}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })}
            onContentSizeChange={() => scrollable && scroller.current?.scrollToEnd({ animated: false })}
          >
          <View style={{ width: cardW > 0 ? contentW : undefined, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: tint(theme.colors.accent, "55"), backgroundColor: tint(theme.colors.accent, "0d") }}>
            <Animated.View style={[{ width: labelW, justifyContent: "flex-end", paddingLeft: SPACING[3], paddingBottom: SPACING[2], borderRightWidth: 1, borderRightColor: divider }, sticky, { backgroundColor: theme.colors.surface0 }]}>
              <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: tint(theme.colors.accent, "0d") }} />
              <Text style={text(theme, "label")}>
                <Text style={{ color: theme.colors.accent, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{total}</Text>
                {` ${total === 1 ? "agent" : "agents"} · ${openCount}/${groups.length} lanes open`}
              </Text>
            </Animated.View>
            <View style={{ width: trackW, paddingRight: NOW_PAD }}>
              {scale.width > 0 ? <Axis theme={theme} scale={scale} tick={win.tick} /> : null}
            </View>
          </View>
          {groups.map((g) => {
            const lane = g.solo ? theme.colors.foregroundMuted : teamColour(palette, g.key);
            return (
            <View key={g.key} style={{ borderTopWidth: 1, borderTopColor: theme.colors.border }}>
              <Animated.View style={[{ width: cardW }, sticky]}>
                <LaneHead theme={theme} group={g} open={laneOpen(g)} onToggle={() => h.change(setTeam(h.folds, g.key, !laneOpen(g), true))} onInfo={h.open} />
              </Animated.View>
              {laneOpen(g)
                ? g.members.map((m, i) => (
                    <View key={m.row.id} style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: divider, borderLeftWidth: 3, borderLeftColor: tint(lane, "77"), backgroundColor: tint(lane, i % 2 === 1 ? "0e" : "06") }}>
                      <Animated.View style={[{ width: labelW, marginLeft: -3, paddingLeft: 3, borderRightWidth: 1, borderRightColor: divider }, sticky]}>
                        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: tint(lane, i % 2 === 1 ? "0e" : "06") }} />
                        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: tint(lane, "77") }} />
                        <TrackLabel theme={theme} member={m} narrow={narrow} last={lastSibling(g.members, i)} stateHere={m.row.status !== "gone" && scale.width > 0 && !currentWordFits(m.row, scale)} onPress={() => h.open(m.row.id)} />
                      </Animated.View>
                      <View style={{ width: trackW, paddingRight: NOW_PAD, position: "relative" }}>
                        {scale.width > 0 ? (
                          <>
                            <Grid theme={theme} scale={scale} tick={win.tick} />
                            <Track theme={theme} member={m} segments={segments[m.row.id] ?? []} scale={scale} events={eventsOf(m.row.name)} onPress={() => h.open(m.row.id)} />
                          </>
                        ) : null}
                      </View>
                    </View>
                  ))
                : null}
            </View>
            );
          })}
          </View>
          </NativeScrollView>
          {scrollable ? <TimeSlider theme={theme} viewportW={cardW} contentW={contentW} scrollX={scrollX} onScrollTo={(x) => scroller.current?.scrollTo({ x, animated: false })} /> : null}
          {sleepers.length > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: 36, paddingHorizontal: SPACING[3], borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
              <Icon name="Archive" size={12} color={theme.colors.foregroundMuted} />
              <Text style={[text(theme, "label"), { flexShrink: 1 }]} numberOfLines={1}>{`${sleepers.length} finished ${sleepers.length === 1 ? "team" : "teams"} · ${sleeping} agents, off the chart`}</Text>
              <View style={{ flex: 1 }} />
              <View style={{ flexDirection: "row", gap: SPACING[1] }}>
                {sleepers.slice(0, 4).map((s) => (
                  <Pill key={s.key} theme={theme} label={s.name} colour={teamColour(palette, s.key)} filled onPress={() => h.open(s.info)} />
                ))}
                {sleepers.length > 4 ? <Text style={text(theme, "label")}>{`+${sleepers.length - 4}`}</Text> : null}
              </View>
            </View>
          ) : null}
          <View style={{ paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], borderTopWidth: 1, borderTopColor: theme.colors.border }}>
            <ChartLegend theme={theme} />
          </View>
        </View>
      )}
      {whole ? <Activity theme={theme} events={view.events} index={index} /> : null}
    </View>
  );
}

const ACTIVITY_SHOWN = 5;

function ActivityLine({ theme, event, index }: { theme: PluginTheme; event: EventRow; index: Index }) {
  const palette = usePalette(theme);
  const s = sentenceOf(event);
  const rows = [...index.values()];
  const byName = (name: string | undefined) => (name ? rows.find((r) => r.name === name && r.kind !== "team" && r.kind !== "gone") : undefined);
  const actorRow = byName(s.actor);
  const objectRow = byName(s.object);
  const tone = event.tone === "danger" ? theme.colors.statusDanger : event.tone === "warning" ? theme.colors.statusWarning : undefined;
  const ink = (r: Row | undefined) => ({ color: tone ?? (r ? paint(palette, r.role, r.id) : theme.colors.foreground), fontWeight: "600" as const });
  const strong = ink(actorRow);
  const strongObject = ink(objectRow);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: ROW_ONE, paddingHorizontal: SPACING[3], paddingVertical: SPACING[1] }}>
      {actorRow && !tone ? (
        <RoleAvatar theme={theme} name={actorRow.name} role={actorRow.role} id={actorRow.id} size={24} dim={actorRow.dim} />
      ) : (
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: tint(tone ?? theme.colors.accent, "1f"), alignItems: "center", justifyContent: "center" }}>
          <Icon name={s.icon} size={12} color={tone ?? theme.colors.accent} />
        </View>
      )}
      <Text style={[text(theme, "meta"), { flex: 1, minWidth: 0 }]} numberOfLines={1}>
        {s.actor ? <Text style={strong}>{s.actor}</Text> : null}
        {s.actor ? " " : ""}
        <Text style={tone ? { color: tone } : undefined}>{s.verb}</Text>
        {s.object ? " " : ""}
        {s.object ? <Text style={strongObject}>{s.object}</Text> : null}
      </Text>
      <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"], flexShrink: 0 }]}>{event.time}</Text>
    </View>
  );
}

function Activity({ theme, events, index }: { theme: PluginTheme; events: EventRow[]; index: Index }) {
  const [all, setAll] = useState(false);
  if (events.length === 0) return null;
  const shown = all ? events : events.slice(0, ACTIVITY_SHOWN);
  const hidden = events.length - shown.length;
  return (
    <View style={{ gap: SPACING[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[1] }}>
        <Icon name="History" size={ICON_SIZE.sm} color={theme.colors.accent} />
        <Text accessibilityRole="header" style={text(theme, "section")}>
          Recent activity
        </Text>
        <View style={{ paddingHorizontal: SPACING[1.5], height: 18, borderRadius: 9, backgroundColor: tint(theme.colors.accent, "22"), justifyContent: "center" }}>
          <Text style={[text(theme, "label"), { color: theme.colors.accent, fontWeight: "600", fontVariant: ["tabular-nums"], lineHeight: 14 }]}>{events.length}</Text>
        </View>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
      </View>
      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1, overflow: "hidden" }}>
      <View>
        <Rows theme={theme} bare>
          {shown.map((e, i) => (
            <ActivityLine key={`${e.time}:${i}`} theme={theme} event={e} index={index} />
          ))}
        </Rows>
      </View>
      {events.length > ACTIVITY_SHOWN ? (
        <PressRow theme={theme} onPress={() => setAll(!all)} expanded={all} label={all ? "Show fewer events" : `Show ${hidden} more events`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING[1.5], minHeight: ROW_ONE, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <Icon name={all ? "ChevronUp" : "ChevronDown"} size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
          <Text style={text(theme, "label")}>{all ? "Show fewer" : `Show ${hidden} more`}</Text>
        </PressRow>
      ) : null}
      </View>
    </View>
  );
}
