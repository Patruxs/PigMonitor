import { z } from "zod";
import { clampPercent, levelOf, type Level } from "./format.ts";

export const Usage = z.object({ totalCostUsd: z.number().optional(), contextWindowMaxTokens: z.number().optional(), contextWindowUsedTokens: z.number().optional() });

export type Usage = z.infer<typeof Usage>;

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return Math.round(value).toString();
}

export function usagePercentage(maxTokens: number | null, usedTokens: number | null): number | null {
  if (maxTokens === null || usedTokens === null) return null;
  if (!Number.isFinite(maxTokens) || maxTokens <= 0 || !Number.isFinite(usedTokens) || usedTokens < 0) return null;
  return (usedTokens / maxTokens) * 100;
}

export type ProgressTone = "destructive" | "warning" | "muted";

const PROGRESS_TONES: Record<Level, ProgressTone> = { normal: "muted", warning: "warning", danger: "destructive" };

export function progressTone(percentage: number): ProgressTone {
  return PROGRESS_TONES[levelOf(percentage)];
}

const SVG_SIZE = 14;
const COMPACT_SVG_SIZE = 12;
const COMPACT_RADIUS = 5;
const STROKE_WIDTH = 2;
const COMPACT_STROKE_WIDTH = 1.75;

export function meterGeometry(showPercentage: boolean, glyphSize?: number): { size: number; radius: number; strokeWidth: number } {
  if (showPercentage) return { size: COMPACT_SVG_SIZE, radius: COMPACT_RADIUS, strokeWidth: COMPACT_STROKE_WIDTH };
  const size = glyphSize ?? SVG_SIZE;
  const strokeWidth = glyphSize ? 2 : STROKE_WIDTH;
  return { size, radius: (size - strokeWidth) / 2, strokeWidth };
}

export function ringSvg({ size, radius, strokeWidth, percentage, trackColor, progressColor }: { size: number; radius: number; strokeWidth: number; percentage: number | null; trackColor: string; progressColor: string }): string {
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const track = `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${trackColor}" stroke-width="${strokeWidth}"/>`;
  const progress =
    percentage === null
      ? ""
      : `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${progressColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference - (clampPercent(percentage) / 100) * circumference}" transform="rotate(-90 ${center} ${center})"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${track}${progress}</svg>`;
}

export type MeterState = { kind: "hidden" } | { kind: "pending" } | { kind: "used"; usedTokens: number } | { kind: "ready"; percentage: number; usedTokens: number; maxTokens: number };

export function meterState(usage: Usage | null, status: string | null): MeterState {
  const maxTokens = usage?.contextWindowMaxTokens ?? null;
  const usedTokens = usage?.contextWindowUsedTokens ?? null;
  const percentage = usagePercentage(maxTokens, usedTokens);
  if (percentage !== null && maxTokens !== null && usedTokens !== null) return { kind: "ready", percentage, usedTokens, maxTokens };
  if (maxTokens === null && usedTokens !== null && Number.isFinite(usedTokens) && usedTokens > 0) return { kind: "used", usedTokens };
  return status === "initializing" || status === "running" ? { kind: "pending" } : { kind: "hidden" };
}

export interface ArcCap {
  left: number;
  top: number;
}

export interface HalfRingArc {
  rightRotation: number;
  leftRotation: number | null;
  caps: [ArcCap, ArcCap];
}

function capAt(degrees: number, size: number, strokeWidth: number): ArcCap {
  const radians = (degrees * Math.PI) / 180;
  const radius = (size - strokeWidth) / 2;
  return { left: size / 2 + radius * Math.sin(radians) - strokeWidth / 2, top: size / 2 - radius * Math.cos(radians) - strokeWidth / 2 };
}

export function halfRingArc(percentage: number, size: number, strokeWidth: number): HalfRingArc | null {
  const sweep = (clampPercent(percentage) / 100) * 360;
  if (sweep === 0) return null;
  return {
    rightRotation: Math.min(sweep, 180) - 180,
    leftRotation: sweep > 180 ? sweep - 180 : null,
    caps: [capAt(0, size, strokeWidth), capAt(sweep, size, strokeWidth)],
  };
}
