import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput as ModalTextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Text, type TextStyle } from "react-native";
import { forgeAttachmentKey, isAttachmentSelectedForForgeItem, toggleForgeAttachment, type ComposerAttachment } from "../shared/composer.ts";
import { extractForgeRefs, forgeRefKey, type ForgeRef } from "../shared/forge-refs.ts";
import { checkoutRemote, forgeSearch, type ForgeItemData } from "../shared/rpc.ts";
import { forgeNumberLabel } from "./attachments.tsx";
import { PressRow } from "./kit/press.tsx";
import { ICON_SIZE, RADIUS, ROW_MIN, SPACING, text } from "./kit/theme.ts";
import { boundedMap } from "../shared/bounded-map.ts";
import { messageOf } from "../shared/errors.ts";
import { NO_OUTLINE } from "./kit/platform.ts";

const FORGE_SEARCH_CACHE_LIMIT = 50;
const REMOTE_CACHE_LIMIT = 20;

const FORGE_SEARCH_STALE_MS = 30000;
const FORGE_SEARCH_DEBOUNCE_MS = 250;
const AUTO_ATTACH_DEBOUNCE_MS = 300;

const GITHUB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -0.5 25 25" fill="currentColor"><path d="m12.301 0h.093c2.242 0 4.34.613 6.137 1.68l-.055-.031c1.871 1.094 3.386 2.609 4.449 4.422l.031.058c1.04 1.769 1.654 3.896 1.654 6.166 0 5.406-3.483 10-8.327 11.658l-.087.026c-.063.02-.135.031-.209.031-.162 0-.312-.054-.433-.144l.002.001c-.128-.115-.208-.281-.208-.466 0-.005 0-.01 0-.014v.001q0-.048.008-1.226t.008-2.154c.007-.075.011-.161.011-.249 0-.792-.323-1.508-.844-2.025.618-.061 1.176-.163 1.718-.305l-.076.017c.573-.16 1.073-.373 1.537-.642l-.031.017c.508-.28.938-.636 1.292-1.058l.006-.007c.372-.476.663-1.036.84-1.645l.009-.035c.209-.683.329-1.468.329-2.281 0-.045 0-.091-.001-.136v.007c0-.022.001-.047.001-.072 0-1.248-.482-2.383-1.269-3.23l.003.003c.168-.44.265-.948.265-1.479 0-.649-.145-1.263-.404-1.814l.011.026c-.115-.022-.246-.035-.381-.035-.334 0-.649.078-.929.216l.012-.005c-.568.21-1.054.448-1.512.726l.038-.022-.609.384c-.922-.264-1.981-.416-3.075-.416s-2.153.152-3.157.436l.081-.02q-.256-.176-.681-.433c-.373-.214-.814-.421-1.272-.595l-.066-.022c-.293-.154-.64-.244-1.009-.244-.124 0-.246.01-.364.03l.013-.002c-.248.524-.393 1.139-.393 1.788 0 .531.097 1.04.275 1.509l-.01-.029c-.785.844-1.266 1.979-1.266 3.227 0 .025 0 .051.001.076v-.004c-.001.039-.001.084-.001.13 0 .809.12 1.591.344 2.327l-.015-.057c.189.643.476 1.202.85 1.693l-.009-.013c.354.435.782.793 1.267 1.062l.022.011c.432.252.933.465 1.46.614l.046.011c.466.125 1.024.227 1.595.284l.046.004c-.431.428-.718 1-.784 1.638l-.001.012c-.207.101-.448.183-.699.236l-.021.004c-.256.051-.549.08-.85.08-.022 0-.044 0-.066 0h.003c-.394-.008-.756-.136-1.055-.348l.006.004c-.371-.259-.671-.595-.881-.986l-.007-.015c-.198-.336-.459-.614-.768-.827l-.009-.006c-.225-.169-.49-.301-.776-.38l-.016-.004-.32-.048c-.023-.002-.05-.003-.077-.003-.14 0-.273.028-.394.077l.007-.003q-.128.072-.08.184c.039.086.087.16.145.225l-.001-.001c.061.072.13.135.205.19l.003.002.112.08c.283.148.516.354.693.603l.004.006c.191.237.359.505.494.792l.01.024.16.368c.135.402.38.738.7.981l.005.004c.3.234.662.402 1.057.478l.016.002c.33.064.714.104 1.106.112h.007c.045.002.097.002.15.002.261 0 .517-.021.767-.062l-.027.004.368-.064q0 .609.008 1.418t.008.873v.014c0 .185-.08.351-.208.466h-.001c-.119.089-.268.143-.431.143-.075 0-.147-.011-.214-.032l.005.001c-4.929-1.689-8.409-6.283-8.409-11.69 0-2.268.612-4.393 1.681-6.219l-.032.058c1.094-1.871 2.609-3.386 4.422-4.449l.058-.031c1.739-1.034 3.835-1.645 6.073-1.645h.098-.005zm-7.64 17.666q.048-.112-.112-.192-.16-.048-.208.032-.048.112.112.192.144.096.208-.032zm.497.545q.112-.08-.032-.256-.16-.144-.256-.048-.112.08.032.256.159.157.256.047zm.48.72q.144-.112 0-.304-.128-.208-.272-.096-.144.08 0 .288t.272.112zm.672.673q.128-.128-.064-.304-.192-.192-.32-.048-.144.128.064.304.192.192.32.044zm.913.4q.048-.176-.208-.256-.24-.064-.304.112t.208.24q.24.097.304-.096zm1.009.08q0-.208-.272-.176-.256 0-.256.176 0 .208.272.176.256.001.256-.175zm.929-.16q-.032-.176-.288-.144-.256.048-.224.24t.288.128.225-.224z"/></svg>`;

export function ForgeGlyph({ size, color }: { size: number; color: string }) {
  if (Platform.OS !== "web" || typeof btoa !== "function") return <Icon name="GitPullRequest" size={size} color={color} />;
  return <Image source={{ uri: `data:image/svg+xml;base64,${btoa(GITHUB_SVG.replace(/currentColor/g, color))}` }} style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

type ForgeSearchState = { loading: boolean; items: ForgeItemData[]; error: string | null };
type ForgeSearchCall = (input: { cwd: string; query: string }) => Promise<{ ok: true; items: ForgeItemData[] } | { ok: false; error: string }>;

const forgeSearchCache = boundedMap<string, { at: number; items: ForgeItemData[] }>(FORGE_SEARCH_CACHE_LIMIT);
const remoteCache = boundedMap<string, Promise<string | null>>(REMOTE_CACHE_LIMIT);

function cacheKeyOf(cwd: string, query: string): string {
  return `${cwd}\u0000${query}`;
}

async function searchCached(call: ForgeSearchCall, cwd: string, query: string): Promise<ForgeItemData[]> {
  const cacheKey = cacheKeyOf(cwd, query);
  const cached = forgeSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FORGE_SEARCH_STALE_MS) return cached.items;
  const r = await call({ cwd, query });
  if (!r.ok) throw new Error(r.error);
  forgeSearchCache.set(cacheKey, { at: Date.now(), items: r.items });
  return r.items;
}

function useForgeSearch(cwd: string | undefined, query: string, enabled: boolean): ForgeSearchState {
  const call = useRpc(forgeSearch);
  const trimmed = query.trim();
  const cached = cwd ? forgeSearchCache.get(cacheKeyOf(cwd, trimmed)) : undefined;
  const fresh = cached !== undefined && Date.now() - cached.at < FORGE_SEARCH_STALE_MS;
  const [state, setState] = useState<ForgeSearchState>({ loading: false, items: [], error: null });
  useEffect(() => {
    if (!enabled || !cwd || fresh) return;
    let current = true;
    setState((had) => ({ ...had, loading: true, error: null }));
    const timer = setTimeout(() => {
      void searchCached(call, cwd, trimmed).then(
        (items) => current && setState({ loading: false, items, error: null }),
        (error: unknown) => current && setState({ loading: false, items: [], error: messageOf(error) }),
      );
    }, FORGE_SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [enabled, cwd, trimmed, fresh]);
  if (fresh) return { loading: false, items: cached.items, error: null };
  return state;
}

export function ForgePicker({ theme, open, cwd, attachments, onToggle, onOpenChange }: { theme: PluginTheme; open: boolean; cwd: string | undefined; attachments: ComposerAttachment[]; onToggle: (item: ForgeItemData) => void; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const search = useForgeSearch(cwd, query, open);
  const close = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };
  const emptyText = search.loading ? "Searching..." : (search.error ?? "No results found.");
  return (
    <Modal title="Attach issue or PR" icon={<ForgeGlyph size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />} open={open} onOpenChange={close}>
      <Modal.Content contentContainerStyle={{ padding: SPACING[2], gap: SPACING[1] }}>
        <ModalTextInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          placeholder="Search issues and PRs..."
          placeholderTextColor={theme.colors.foregroundMuted}
          accessibilityLabel="Search issues and PRs"
          style={[text(theme, "rowTitle"), { minHeight: 32, paddingHorizontal: SPACING[2], borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2 }, NO_OUTLINE]}
        />
        {search.items.length === 0 ? (
          <Text style={[text(theme, search.error ? "label" : "meta", search.error ? "statusDanger" : undefined), { paddingHorizontal: SPACING[2], paddingVertical: SPACING[2] }]}>{emptyText}</Text>
        ) : (
          search.items.map((item) => {
            const label = `${forgeNumberLabel(item)} ${item.title}`;
            return (
              <PressRow
                key={`${item.kind}:${item.number}`}
                theme={theme}
                onPress={() => {
                  onToggle(item);
                  close(false);
                }}
                label={label}
                style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: ROW_MIN, paddingHorizontal: SPACING[2], borderRadius: RADIUS.md }}
              >
                <Icon name={item.kind === "change_request" ? "GitPullRequest" : "CircleDot"} size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
                <Text style={[text(theme, "rowTitle"), { flex: 1, minWidth: 0 }]} numberOfLines={1}>
                  {label}
                </Text>
                {isAttachmentSelectedForForgeItem(attachments, item) ? <Icon name="Check" size={ICON_SIZE.sm} color={theme.colors.foreground} /> : null}
              </PressRow>
            );
          })
        )}
      </Modal.Content>
    </Modal>
  );
}

function useCheckoutRemote(cwd: string | undefined): string | null {
  const call = useRpc(checkoutRemote);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!cwd) return;
    let current = true;
    let lookup = remoteCache.get(cwd);
    if (!lookup) {
      lookup = call({ cwd }).then(
        (r) => (r.ok ? r.remoteUrl : null),
        () => null,
      );
      remoteCache.set(cwd, lookup);
    }
    void lookup.then((url) => current && setRemoteUrl(url));
    return () => {
      current = false;
    };
  }, [cwd]);
  return remoteUrl;
}

function matchesRef(item: ForgeItemData, ref: ForgeRef): boolean {
  return item.kind === ref.kind && item.number === ref.number;
}

export function useForgeAutoAttach({ text: value, cwd, attachments, setAttachments }: { text: string; cwd: string | undefined; attachments: ComposerAttachment[]; setAttachments: (updater: (prev: ComposerAttachment[]) => ComposerAttachment[]) => void }): { isResolving: boolean; markForgeAttachmentRemoved: (attachment: ComposerAttachment | undefined) => void } {
  const call = useRpc(forgeSearch);
  const remoteUrl = useCheckoutRemote(cwd);
  const removedRefKeys = useRef(new Set<string>());
  const pendingKeys = useRef(new Set<string>());
  const latest = useRef({ text: value, attachments });
  latest.current = { text: value, attachments };
  const [resolving, setResolving] = useState(0);
  const candidates = extractForgeRefs(value, remoteUrl).filter((ref) => !removedRefKeys.current.has(forgeRefKey(ref)) && !attachments.some((a) => forgeAttachmentKey(a) === forgeRefKey(ref)));
  const candidateKey = candidates.map(forgeRefKey).join("|");
  useEffect(() => {
    if (!cwd || !remoteUrl) return;
    const refs = extractForgeRefs(latest.current.text, remoteUrl).filter((ref) => {
      const key = forgeRefKey(ref);
      return !removedRefKeys.current.has(key) && !pendingKeys.current.has(key) && !latest.current.attachments.some((a) => forgeAttachmentKey(a) === key);
    });
    if (refs.length === 0) return;
    let started = false;
    setResolving((n) => n + refs.length);
    const timer = setTimeout(() => {
      started = true;
      for (const ref of refs) pendingKeys.current.add(forgeRefKey(ref));
      const stillWanted = (ref: ForgeRef) => !removedRefKeys.current.has(forgeRefKey(ref)) && extractForgeRefs(latest.current.text, remoteUrl).some((candidate) => forgeRefKey(candidate) === forgeRefKey(ref));
      void Promise.all(
        refs.map((ref) =>
          searchCached(call, cwd, String(ref.number)).then(
            (items) => items.find((item) => matchesRef(item, ref)) ?? null,
            () => null,
          ),
        ),
      ).then((found) => {
        found.forEach((item, index) => {
          const ref = refs[index];
          pendingKeys.current.delete(forgeRefKey(ref));
          if (!item || !stillWanted(ref)) return;
          setAttachments((prev) => (removedRefKeys.current.has(forgeRefKey(ref)) || isAttachmentSelectedForForgeItem(prev, item) ? prev : toggleForgeAttachment(prev, item)));
        });
        setResolving((n) => Math.max(0, n - refs.length));
      });
    }, AUTO_ATTACH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      if (!started) setResolving((n) => Math.max(0, n - refs.length));
    };
  }, [candidateKey, remoteUrl, cwd]);
  return useMemo(
    () => ({
      isResolving: resolving > 0,
      markForgeAttachmentRemoved: (attachment: ComposerAttachment | undefined) => {
        const key = forgeAttachmentKey(attachment);
        if (key) removedRefKeys.current.add(key);
      },
    }),
    [resolving > 0],
  );
}
