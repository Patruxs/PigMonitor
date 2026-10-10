import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { COMPACT_BREAKPOINT } from "../shared/controls.ts";
import { clampPercentage, formatSessionCost, formatTokenCount, meterGeometry, meterState, progressTone, type Usage } from "../shared/context-meter.ts";
import { Anchored, FONT_BASE, FONT_SM, PALETTE } from "./controls-kit.tsx";
import { ProgressRing } from "./kit/progress-ring.tsx";
import { hostColours, SPACING } from "./kit/theme.ts";
import { AgentUsage, useHostReportsUsage } from "./usage.tsx";

const SHOW_PERCENTAGE = false;
const USAGE_POPOVER_WIDTH = 300;

function progressColour(theme: PluginTheme, percentage: number): string {
  const tone = progressTone(percentage);
  if (tone === "destructive") return theme.colors.statusDanger;
  if (tone === "warning") return PALETTE.amber500;
  return theme.colors.foregroundMuted;
}

function Details({ theme, agentId, context, sessionCost, showTitle, refreshable }: { theme: PluginTheme; agentId: string; context: { percentage: number; usedTokens: number; maxTokens: number }; sessionCost: string | null; showTitle: boolean; refreshable: boolean }) {
  const detail = { color: theme.colors.foregroundMuted, fontSize: FONT_SM, lineHeight: FONT_SM * 1.4 };
  return (
    <>
      <View style={{ gap: SPACING[1.5], minWidth: 200 }}>
        {showTitle ? <Text style={{ color: theme.colors.foreground, fontSize: FONT_BASE }}>Context window</Text> : null}
        <Text style={{ color: theme.colors.foreground, fontSize: FONT_BASE, lineHeight: FONT_BASE * 1.4 }}>{`${context.percentage}% used`}</Text>
        <Text style={detail}>{`${formatTokenCount(context.usedTokens)} / ${formatTokenCount(context.maxTokens)} tokens`}</Text>
        {sessionCost ? <Text style={detail}>{`Session cost ${sessionCost}`}</Text> : null}
      </View>
      <AgentUsage theme={theme} agentId={agentId} refreshable={refreshable} />
    </>
  );
}

export function ContextWindowMeter({ theme, agentId, usage, status, glyphSize }: { theme: PluginTheme; agentId: string; usage: Usage | null; status: string | null; glyphSize?: number }) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const { width } = useWindowDimensions();
  const isCompact = width < COMPACT_BREAKPOINT;
  const showsUsage = useHostReportsUsage();
  const state = meterState(usage, status);
  const geometry = meterGeometry(SHOW_PERCENTAGE, glyphSize);
  const containerStyle = SHOW_PERCENTAGE ? { height: 28, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: SPACING[1], borderRadius: 9999 } : { width: 28, height: 28, borderRadius: 9999, alignItems: "center" as const, justifyContent: "center" as const };
  const trackColour = hostColours(theme).surface3;
  if (state.kind === "hidden") return null;
  if (state.kind === "pending") {
    return (
      <View style={containerStyle}>
        <ProgressRing size={geometry.size} radius={geometry.radius} strokeWidth={geometry.strokeWidth} percentage={null} trackColour={trackColour} progressColour={trackColour} />
        {SHOW_PERCENTAGE ? <View style={{ width: 22, height: FONT_BASE, borderRadius: 9999, backgroundColor: trackColour }} /> : null}
      </View>
    );
  }
  const popoverStyle = showsUsage ? { padding: SPACING[3], gap: SPACING[3], width: Math.min(USAGE_POPOVER_WIDTH, width - 24) } : { paddingVertical: SPACING[1], paddingHorizontal: SPACING[2] };
  const context = { percentage: Math.round(state.percentage), maxTokens: state.maxTokens, usedTokens: state.usedTokens };
  const sessionCost = formatSessionCost(usage?.totalCostUsd);
  const accessibilityLabel = `Context window ${context.percentage}% used`;
  const ring = <ProgressRing size={geometry.size} radius={geometry.radius} strokeWidth={geometry.strokeWidth} percentage={state.percentage} trackColour={trackColour} progressColour={progressColour(theme, clampPercentage(state.percentage))} />;
  const percentageLabel = SHOW_PERCENTAGE ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_BASE }}>{`${context.percentage}%`}</Text> : null;
  if (isCompact) {
    return (
      <>
        <Pressable style={containerStyle} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={() => setIsSheetOpen(true)}>
          {ring}
          {percentageLabel}
        </Pressable>
        <Modal title="Context window" open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <Modal.Content>
            <Details theme={theme} agentId={agentId} context={context} sessionCost={sessionCost} showTitle={false} refreshable />
          </Modal.Content>
        </Modal>
      </>
    );
  }
  return (
    <Anchored theme={theme} open={false} onClose={() => undefined} interactive tooltipStyle={popoverStyle} tooltip={<Details theme={theme} agentId={agentId} context={context} sessionCost={sessionCost} showTitle refreshable />}>
      <View style={containerStyle} accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
        {ring}
        {percentageLabel}
      </View>
    </Anchored>
  );
}
