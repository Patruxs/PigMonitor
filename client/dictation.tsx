import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { dictationStatus, transcribe } from "../shared/rpc.ts";
import { stopwatch } from "../shared/format.ts";
import { DICTATION_FORMAT, MAX_DICTATION_CHUNKS, PcmChunker, resampleToPcm16, volumeOf, type DictationStatus } from "../shared/speech.ts";
import { ICON_SIZE, SPACING } from "./kit/theme.ts";

const BUTTON = 28;
const PROCESSOR_FRAMES = 4096;
const METER_BAR = { width: 6, gap: 6, min: 8, max: 18 } as const;
const METER_GAINS = [1.2, 1.05, 0.9] as const;

const isWeb = Platform.OS === "web";

type Readiness = { enabled: boolean; reason: string };

function errorMessageOf(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Microphone access was denied.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No microphone was found.";
  return error instanceof Error ? error.message : String(error);
}

class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silencer: GainNode | null = null;
  private chunker = new PcmChunker();

  async start(onVolume: (volume: number) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is not supported in this browser.");
    if (!window.isSecureContext) throw new Error(`Microphone access requires HTTPS or localhost. Current origin: ${window.location.origin}`);
    this.chunker = new PcmChunker();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true, autoGainControl: true } });
    try {
      const context = new AudioContext();
      this.context = context;
      this.source = context.createMediaStreamSource(this.stream);
      this.processor = context.createScriptProcessor(PROCESSOR_FRAMES, 1, 1);
      this.silencer = context.createGain();
      this.silencer.gain.value = 0;
      this.processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0);
        onVolume(volumeOf(samples));
        this.chunker.push(resampleToPcm16(samples, context.sampleRate));
      };
      this.source.connect(this.processor);
      this.processor.connect(this.silencer);
      this.silencer.connect(context.destination);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<string[]> {
    if (this.processor) this.processor.onaudioprocess = null;
    for (const node of [this.processor, this.source, this.silencer]) node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close().catch(() => undefined);
    this.stream = this.context = this.source = this.processor = this.silencer = null;
    return this.chunker.finish();
  }
}

export function useDictation({ onInsert, onInsertAndSend }: { onInsert: (text: string) => void; onInsertAndSend: (text: string) => void }) {
  const toast = useToast();
  const callStatus = useRpc(dictationStatus);
  const callTranscribe = useRpc(transcribe);
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [volume, setVolume] = useState(0);
  const [duration, setDuration] = useState(0);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const capture = useRef<MicrophoneCapture | null>(null);
  const failedChunks = useRef<string[]>([]);
  const sendAfterTranscript = useRef(false);
  const busy = useRef(false);
  const callbacks = useRef({ onInsert, onInsertAndSend });
  callbacks.current = { onInsert, onInsertAndSend };

  const checkReadiness = useCallback(async (): Promise<Readiness> => {
    try {
      const r = await callStatus({});
      const next = r.ok ? { enabled: r.enabled, reason: r.reason } : { enabled: false, reason: r.error };
      setReadiness(next);
      return next;
    } catch (error) {
      const next = { enabled: false, reason: errorMessageOf(error) };
      setReadiness(next);
      return next;
    }
  }, [callStatus]);

  useEffect(() => {
    if (isWeb) void checkReadiness();
  }, [checkReadiness]);

  useEffect(() => {
    if (status !== "recording") return;
    const timer = setInterval(() => setDuration((seconds) => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => () => void capture.current?.stop(), []);

  const deliver = useCallback(
    async (chunks: string[]) => {
      setStatus("uploading");
      try {
        const r = await callTranscribe({ format: DICTATION_FORMAT, chunks });
        if (!r.ok) throw new Error(r.error);
        failedChunks.current = [];
        setStatus("idle");
        setDuration(0);
        if (!r.text) return;
        if (sendAfterTranscript.current) callbacks.current.onInsertAndSend(r.text);
        else callbacks.current.onInsert(r.text);
      } catch (error) {
        failedChunks.current = chunks;
        setStatus("failed");
        toast.error(errorMessageOf(error));
      }
    },
    [callTranscribe, toast],
  );

  const start = useCallback(async () => {
    if (busy.current || status !== "idle") return;
    busy.current = true;
    try {
      const ready = await checkReadiness();
      if (!ready.enabled) {
        toast.error(ready.reason || "Dictation is not available.");
        return;
      }
      const microphone = new MicrophoneCapture();
      await microphone.start(setVolume);
      capture.current = microphone;
      setDuration(0);
      setStatus("recording");
    } catch (error) {
      toast.error(errorMessageOf(error));
    } finally {
      busy.current = false;
    }
  }, [checkReadiness, status, toast]);

  const confirm = useCallback(
    async (send: boolean) => {
      const microphone = capture.current;
      if (busy.current || status !== "recording" || !microphone) return;
      busy.current = true;
      capture.current = null;
      sendAfterTranscript.current = send;
      setVolume(0);
      try {
        await deliver(await microphone.stop());
      } finally {
        busy.current = false;
      }
    },
    [deliver, status],
  );

  const cancel = useCallback(async () => {
    if (status === "failed") {
      failedChunks.current = [];
      setStatus("idle");
      setDuration(0);
      return;
    }
    const microphone = capture.current;
    if (status !== "recording" || !microphone) return;
    capture.current = null;
    setVolume(0);
    setDuration(0);
    setStatus("idle");
    await microphone.stop();
  }, [status]);

  const retry = useCallback(async () => {
    if (busy.current || status !== "failed") return;
    busy.current = true;
    try {
      await deliver(failedChunks.current);
    } finally {
      busy.current = false;
    }
  }, [deliver, status]);

  const toggle = useCallback(() => (status === "recording" ? confirm(true) : start()), [confirm, start, status]);

  useEffect(() => {
    if (status === "recording" && duration >= MAX_DICTATION_CHUNKS) void confirm(false);
  }, [confirm, duration, status]);

  return { supported: isWeb, status, volume, duration, readiness, start, confirm, cancel, retry, toggle };
}

function hoveredOf(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

function VolumeMeter({ volume, colour }: { volume: number; colour: string }) {
  return (
    <View style={{ height: BUTTON, flexDirection: "row", alignItems: "center", gap: METER_BAR.gap }}>
      {METER_GAINS.map((gain, index) => (
        <View key={index} style={{ width: METER_BAR.width, height: Math.min(BUTTON, METER_BAR.min + METER_BAR.max * volume * gain), borderRadius: METER_BAR.width / 2, backgroundColor: colour, opacity: 0.5 + volume * 0.5 }} />
      ))}
    </View>
  );
}

function RoundButton({ theme, label, onPress, disabled, filled, children }: { theme: PluginTheme; label: string; onPress: () => void; disabled?: boolean; filled?: boolean; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(state) => ({ width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: "center", justifyContent: "center", backgroundColor: filled ? theme.colors.foreground : hoveredOf(state) ? theme.colors.surface2 : "transparent", opacity: disabled ? 0.5 : 1 })}
    >
      {children}
    </Pressable>
  );
}

type Dictation = ReturnType<typeof useDictation>;

export function DictationButton({ theme, disabled = false, dictation }: { theme: PluginTheme; disabled?: boolean; dictation: Dictation }) {
  const { status } = dictation;
  if (!dictation.supported) return null;

  if (status === "idle") {
    const unavailable = dictation.readiness !== null && !dictation.readiness.enabled;
    return (
      <Pressable
        onPress={() => void dictation.start()}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={unavailable ? `Dictation unavailable: ${dictation.readiness?.reason}` : "Start dictation"}
        style={(state) => ({ width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: "center", justifyContent: "center", backgroundColor: hoveredOf(state) && !unavailable ? theme.colors.surface2 : "transparent", opacity: disabled || unavailable ? 0.5 : 1 })}
      >
        {(state) => <Icon name="Mic" size={ICON_SIZE.md} color={hoveredOf(state) && !unavailable ? theme.colors.foreground : theme.colors.foregroundMuted} />}
      </Pressable>
    );
  }

  const uploading = status === "uploading";
  const failed = status === "failed";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
      {failed ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>Dictation failed</Text> : <VolumeMeter volume={dictation.volume} colour={theme.colors.foreground} />}
      <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{stopwatch(dictation.duration)}</Text>
      <RoundButton theme={theme} label={failed ? "Discard dictation" : "Cancel dictation"} onPress={() => void dictation.cancel()} disabled={uploading}>
        <Icon name="X" size={ICON_SIZE.sm} color={theme.colors.foreground} />
      </RoundButton>
      {uploading ? (
        <View style={{ width: BUTTON, height: BUTTON, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="small" color={theme.colors.foreground} />
        </View>
      ) : failed ? (
        <RoundButton theme={theme} label="Retry dictation" onPress={() => void dictation.retry()} filled>
          <Icon name="RefreshCcw" size={ICON_SIZE.sm} color={theme.colors.surface0} />
        </RoundButton>
      ) : (
        <>
          <RoundButton theme={theme} label="Insert transcript" onPress={() => void dictation.confirm(false)}>
            <Icon name="Check" size={ICON_SIZE.sm} color={theme.colors.foreground} />
          </RoundButton>
          <RoundButton theme={theme} label="Insert transcript and send" onPress={() => void dictation.confirm(true)} filled>
            <Icon name="ArrowUp" size={ICON_SIZE.sm} color={theme.colors.surface0} />
          </RoundButton>
        </>
      )}
    </View>
  );
}
