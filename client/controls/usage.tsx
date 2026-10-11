import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState } from "react";
import { Image, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { clampPercent, percent } from "../../shared/format.ts";
import { usageReports } from "../../shared/rpc.ts";
import { formatResetLabel, formatUsageFreshness, replaceReport, reportContent, reportMessages, resolveAgentUsageView, resolveBalance, statusText, USAGE_COPY, usedPercent, windowTone, windowTrailing, type UsageBalanceData, type UsageReportEntryData, type UsageTone, type UsageWindowData } from "./usage-reports.ts";
import { Anchored, FONT_BASE, FONT_SM, hoveredOf } from "./controls-kit.tsx";
import { COMPACT_BELOW, hostColours, RADIUS, SPACING } from "../kit/theme.ts";
import { messageOf } from "../../shared/errors.ts";

const isNative = Platform.OS !== "web";
const RED_300 = "#fca5a5";
const SMALL_BUTTON = 20;
const COMPACT_SMALL_BUTTON = 32;
const REFRESH_TOOLTIP_DELAY_MS = 300;
const MINUTE_MS = 60_000;

let hostReportsUsage = true;

export function useHostReportsUsage(): boolean {
  return hostReportsUsage;
}

interface UsageState {
  canReport: boolean;
  data: UsageReportEntryData[] | undefined;
  error: string | null;
}

function useAgentUsage(agentId: string): UsageState & { refresh: (reportId: string) => Promise<boolean> } {
  const call = useRpc(usageReports);
  const [state, setState] = useState<UsageState>({ canReport: true, data: undefined, error: null });
  useEffect(() => {
    let live = true;
    setState((had) => ({ canReport: had.canReport, data: undefined, error: null }));
    void call({ agentId }).then(
      (r) => {
        if (!live) return;
        if (r.ok) setState({ canReport: true, data: r.reports, error: null });
        if (!r.ok && r.code === "older") hostReportsUsage = false;
        if (!r.ok) setState({ canReport: r.code !== "older", data: undefined, error: r.code === "older" ? null : r.error });
      },
      (error) => live && setState({ canReport: true, data: undefined, error: messageOf(error) }),
    );
    return () => {
      live = false;
    };
  }, [agentId, call]);
  const refresh = async (reportId: string): Promise<boolean> => {
    const r = await call({ agentId, forceRefresh: true });
    if (!r.ok) return false;
    const refreshed = r.reports.find((report) => report.id === reportId) ?? null;
    setState((had) => (had.data ? { ...had, data: replaceReport(had.data, reportId, refreshed) } : had));
    return true;
  };
  return { ...state, refresh };
}

function toneColour(theme: PluginTheme, tone: UsageTone): string {
  if (tone === "ok") return theme.colors.statusSuccess;
  if (tone === "warning") return theme.colors.statusWarning;
  if (tone === "danger") return theme.colors.statusDanger;
  return theme.colors.foregroundMuted;
}

function Meter({ theme, percent, tone }: { theme: PluginTheme; percent: number; tone: UsageTone }) {
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: hostColours(theme).surface3, overflow: "hidden" }}>
      <View style={{ height: "100%", width: `${clampPercent(percent)}%`, borderRadius: 9999, backgroundColor: toneColour(theme, tone) }} />
    </View>
  );
}

function WindowBar({ theme, window }: { theme: PluginTheme; window: UsageWindowData }) {
  const shown = usedPercent(window);
  const isAtRisk = window.runsOutAt != null && window.shortfallPct != null;
  const trailing = windowTrailing(window);
  return (
    <View style={{ gap: 3, marginHorizontal: -SPACING[2], paddingHorizontal: SPACING[2], paddingVertical: SPACING[1.5] }}>
      <View style={{ gap: 3 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: SPACING[2] }}>
          <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: FONT_SM }} numberOfLines={1}>
            {window.label}
          </Text>
          <Text style={{ color: theme.colors.foreground, fontSize: FONT_SM, fontWeight: "500" }}>
            {shown != null ? percent(shown) : "—"}
            {trailing ? <Text style={{ color: isAtRisk ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontWeight: "400" }}>{` · ${trailing}`}</Text> : null}
          </Text>
        </View>
        <Meter theme={theme} percent={shown ?? 0} tone={windowTone(window)} />
      </View>
    </View>
  );
}

function BalanceBar({ theme, balance }: { theme: PluginTheme; balance: UsageBalanceData }) {
  const locale = Intl.NumberFormat().resolvedOptions().locale;
  const { amountText, usedPct } = resolveBalance(balance, locale);
  const reset = formatResetLabel(balance.resetsAt);
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: SPACING[2] }}>
        <Text style={{ flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: FONT_SM }} numberOfLines={1}>
          {balance.label}
        </Text>
        <Text style={{ color: theme.colors.foreground, fontSize: FONT_SM, fontWeight: "500" }}>
          {amountText}
          {reset ? <Text style={{ color: theme.colors.foregroundMuted, fontWeight: "400" }}>{` · ${reset}`}</Text> : null}
        </Text>
      </View>
      {usedPct != null ? (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: hostColours(theme).surface3, overflow: "hidden" }}>
          <View style={{ height: 4, borderRadius: 2, width: `${clampPercent(usedPct)}%`, backgroundColor: toneColour(theme, balance.tone ?? "default") }} />
        </View>
      ) : null}
    </View>
  );
}

function SourceIcon({ theme, svg, size }: { theme: PluginTheme; svg: string | null; size: number }) {
  if (!svg || isNative) return <Icon name="Gauge" size={size} color={theme.colors.foregroundMuted} />;
  return <Image source={{ uri: `data:image/svg+xml;base64,${btoa(svg.replace(/currentColor/g, theme.colors.foregroundMuted))}` }} style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

function useFreshness(fetchedAt: string): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);
  return formatUsageFreshness(fetchedAt);
}

function Freshness({ theme, fetchedAt, colour }: { theme: PluginTheme; fetchedAt: string; colour?: string }) {
  return (
    <Text style={{ flexShrink: 0, color: colour ?? theme.colors.foregroundMuted, fontSize: FONT_SM }} numberOfLines={1}>
      {useFreshness(fetchedAt)}
    </Text>
  );
}

function RefreshButton({ theme, sourceLabel, fetchedAt, pending, compact, onRefresh }: { theme: PluginTheme; sourceLabel: string; fetchedAt: string; pending: boolean; compact: boolean; onRefresh: () => void }) {
  const frame = compact ? COMPACT_SMALL_BUTTON : SMALL_BUTTON;
  const glyph = compact ? 18 : 14;
  const overhang = (frame - glyph) / 2;
  return (
    <Anchored theme={theme} open={false} onClose={() => undefined} tooltipDelay={REFRESH_TOOLTIP_DELAY_MS} tooltip={<Freshness theme={theme} fetchedAt={fetchedAt} colour={theme.colors.foreground} />} style={{ marginRight: -overhang, marginVertical: -overhang }}>
      <Pressable onPress={onRefresh} disabled={pending} accessibilityRole="button" accessibilityLabel={`${USAGE_COPY.refresh} ${sourceLabel}`} style={(state) => ({ width: frame, height: frame, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", flexShrink: 0, backgroundColor: hoveredOf(state) || state.pressed ? theme.colors.surface2 : "transparent", opacity: pending ? 0.5 : 1 })}>
        <Icon name={pending ? "Loader" : "RotateCw"} size={glyph} color={hostColours(theme).foregroundExtraMuted} />
      </Pressable>
    </Anchored>
  );
}

function UsageCard({ theme, entry, refreshable, onRefresh }: { theme: PluginTheme; entry: UsageReportEntryData; refreshable: boolean; onRefresh: () => Promise<boolean> }) {
  const { width } = useWindowDimensions();
  const isCompact = width < COMPACT_BELOW;
  const [refreshState, setRefreshState] = useState<"idle" | "pending" | "failed">("idle");
  const showsFreshnessInline = isNative || isCompact || !refreshable;
  const usage = entry.report;
  const status = statusText(usage);
  const footer = entry.account.label ?? null;
  const { windows, balances, details } = reportContent(usage);
  const messages = reportMessages(entry);
  const refresh = async () => {
    setRefreshState("pending");
    setRefreshState((await onRefresh()) ? "idle" : "failed");
  };
  const error = { color: RED_300, fontSize: FONT_SM, lineHeight: FONT_SM * 1.4 };
  return (
    <View style={{ gap: SPACING[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
        <SourceIcon theme={theme} svg={entry.icon ?? null} size={14} />
        <Text style={{ flexShrink: 1, color: theme.colors.foreground, fontSize: FONT_BASE }} numberOfLines={1}>
          {entry.sourceLabel}
        </Text>
        {usage.status === "available" && usage.planLabel ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 9999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: hostColours(theme).surface3, paddingHorizontal: SPACING[1.5], paddingVertical: 1 }}>
            <Text style={{ fontSize: FONT_SM, color: theme.colors.foregroundMuted }}>{usage.planLabel}</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        {status ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5] }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: usage.status === "error" ? theme.colors.statusDanger : theme.colors.foregroundMuted }} />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SM }}>{status}</Text>
          </View>
        ) : null}
        {refreshable ? <RefreshButton theme={theme} sourceLabel={entry.sourceLabel} fetchedAt={entry.fetchedAt} pending={refreshState === "pending"} compact={isCompact} onRefresh={() => void refresh()} /> : null}
      </View>
      {messages.length > 0 ? <Text style={error}>{messages.join("\n")}</Text> : null}
      {windows.length > 0 || balances.length > 0 ? (
        <View style={{ gap: SPACING[1] }}>
          {windows.map((window) => (
            <WindowBar key={window.id} theme={theme} window={window} />
          ))}
          {balances.map((balance) => (
            <BalanceBar key={balance.id} theme={theme} balance={balance} />
          ))}
        </View>
      ) : null}
      {details.length > 0 ? (
        <View style={{ gap: SPACING[1] }}>
          {details.map((detail) => (
            <View key={detail.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: SPACING[2] }}>
              <Text style={{ flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: FONT_SM }} numberOfLines={1}>
                {detail.label}
              </Text>
              <Text style={{ color: theme.colors.foreground, fontSize: FONT_SM }} numberOfLines={1}>
                {detail.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {footer || showsFreshnessInline ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
          <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: FONT_SM }} numberOfLines={1}>
            {footer}
          </Text>
          {showsFreshnessInline ? <Freshness theme={theme} fetchedAt={entry.fetchedAt} /> : null}
        </View>
      ) : null}
      {refreshState === "failed" ? <Text style={error}>{USAGE_COPY.refreshFailed}</Text> : null}
    </View>
  );
}

export function AgentUsage({ theme, agentId, refreshable }: { theme: PluginTheme; agentId: string; refreshable: boolean }) {
  const usage = useAgentUsage(agentId);
  const view = resolveAgentUsageView(usage);
  if (view.kind === "none") return null;
  return (
    <>
      <View style={{ height: 1, backgroundColor: hostColours(theme).borderAccent }} />
      {view.kind === "ready" ? (
        view.reports.map((entry) => <UsageCard key={entry.id} theme={theme} entry={entry} refreshable={refreshable} onRefresh={() => usage.refresh(entry.id)} />)
      ) : (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SM }}>{view.kind === "loading" ? USAGE_COPY.loading : view.message}</Text>
      )}
    </>
  );
}

