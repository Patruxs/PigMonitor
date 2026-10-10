import { Image, Platform, View } from "react-native";
import { halfRingArc, ringSvg } from "../../shared/context-meter.ts";

interface ProgressRingProps {
  size: number;
  radius: number;
  strokeWidth: number;
  percentage: number | null;
  trackColour: string;
  progressColour: string;
}

function HalfArc({ size, side, rotation, strokeWidth, colour }: { size: number; side: "left" | "right"; rotation: number; strokeWidth: number; colour: string }) {
  const half = size / 2;
  return (
    <View style={{ position: "absolute", top: 0, left: side === "right" ? half : 0, width: half, height: size, overflow: "hidden" }}>
      <View style={{ position: "absolute", top: 0, left: side === "right" ? -half : 0, width: size, height: size, transform: [{ rotate: `${rotation}deg` }] }}>
        <View style={{ position: "absolute", top: 0, left: half, width: half, height: size, overflow: "hidden" }}>
          <View style={{ position: "absolute", top: 0, left: -half, width: size, height: size, borderRadius: half, borderWidth: strokeWidth, borderColor: colour }} />
        </View>
      </View>
    </View>
  );
}

function NativeRing({ size, strokeWidth, percentage, trackColour, progressColour }: ProgressRingProps) {
  const arc = percentage === null ? null : halfRingArc(percentage, size, strokeWidth);
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ position: "absolute", top: 0, left: 0, width: size, height: size, borderRadius: size / 2, borderWidth: strokeWidth, borderColor: trackColour }} />
      {arc ? (
        <>
          <HalfArc size={size} side="right" rotation={arc.rightRotation} strokeWidth={strokeWidth} colour={progressColour} />
          {arc.leftRotation === null ? null : <HalfArc size={size} side="left" rotation={arc.leftRotation} strokeWidth={strokeWidth} colour={progressColour} />}
          {arc.caps.map((cap, index) => <View key={index} style={{ position: "absolute", left: cap.left, top: cap.top, width: strokeWidth, height: strokeWidth, borderRadius: strokeWidth / 2, backgroundColor: progressColour }} />)}
        </>
      ) : null}
    </View>
  );
}

export function ProgressRing(props: ProgressRingProps) {
  if (Platform.OS !== "web") return <NativeRing {...props} />;
  const { size, radius, strokeWidth, percentage, trackColour, progressColour } = props;
  const svg = ringSvg({ size, radius, strokeWidth, percentage, trackColor: trackColour, progressColor: progressColour });
  return <Image source={{ uri: `data:image/svg+xml;base64,${btoa(svg)}` }} style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
