import { usePaseo } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import type { Navigation } from "./native.tsx";

const browser = globalThis as { window?: Window; btoa?: (data: string) => string };

const URL_SAFE_ID = /^[A-Za-z0-9._~-]+$/;

export type ProjectAction = "agent" | "terminal" | "open" | "remove";

export interface ProjectActions {
  canOpen: boolean;
  busy: ProjectAction | null;
  newAgent: (path: string) => Promise<void>;
  newTerminal: (path: string) => Promise<void>;
  openInPaseo: (path: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error);
}

function base64UrlOf(text: string, encode: (data: string) => string): string {
  const binary = Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join("");
  return encode(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function workspaceRouteOf(serverId: string, workspaceId: string, tab: string | undefined, encode: (data: string) => string): string {
  const routeWorkspaceId = URL_SAFE_ID.test(workspaceId) ? workspaceId : `b64_${base64UrlOf(workspaceId, encode)}`;
  const route = `/h/${encodeURIComponent(serverId)}/workspace/${routeWorkspaceId}`;
  return tab ? `${route}?open=${encodeURIComponent(tab)}` : route;
}

function openInPage(serverId: string | undefined, workspaceId: string, tab?: string): boolean {
  const { window: page, btoa: encode } = browser;
  if (!serverId || !page?.history || typeof PopStateEvent === "undefined" || !encode) return false;
  page.history.pushState(null, "", workspaceRouteOf(serverId, workspaceId, tab, encode));
  page.dispatchEvent(new PopStateEvent("popstate"));
  return true;
}

function shownInPage(serverId: string | undefined, workspaceId: string): boolean {
  const { window: page, btoa: encode } = browser;
  return !!serverId && !!encode && page?.location?.pathname === workspaceRouteOf(serverId, workspaceId, undefined, encode);
}

const samePath = (a: string | undefined, b: string) => a !== undefined && a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

export function useProjectActions(navigation: Navigation | undefined, serverId: string | undefined, onRemoved: (path: string) => void): ProjectActions {
  const paseo = usePaseo();
  const toast = useToast();
  const [busy, setBusy] = useState<ProjectAction | null>(null);
  const target = serverId ? { serverId } : {};
  const workspaceOf = (path: string) => paseo.workspaces.open({ cwd: path });
  const showWorkspace = (workspaceId: string) => navigation?.openWorkspace({ workspaceId, ...target });
  const run = async (action: ProjectAction, work: () => Promise<void>, failed: string) => {
    if (busy) return;
    setBusy(action);
    try {
      await work();
    } catch (error) {
      toast.error(`${failed}: ${messageOf(error)}`);
    } finally {
      setBusy(null);
    }
  };
  return {
    canOpen: navigation !== undefined,
    busy,
    newAgent: (path) =>
      run(
        "agent",
        async () => {
          const workspace = await workspaceOf(path);
          if (openInPage(serverId, workspace.id, `draft:pigmonitor-${Date.now()}`)) return;
          showWorkspace(workspace.id);
          toast.show("Could not open a new agent draft on this client. Use Paseo's New agent button in the workspace");
        },
        "Could not start an agent",
      ),
    newTerminal: (path) =>
      run(
        "terminal",
        async () => {
          const workspace = await workspaceOf(path);
          if (!shownInPage(serverId, workspace.id)) showWorkspace(workspace.id);
          const terminal = await workspace.terminals.create();
          if (openInPage(serverId, workspace.id, `terminal:${terminal.id}`)) toast.show("Terminal opened in Paseo");
          else toast.show(`${terminal.current()?.name ?? "Terminal"} opened in Paseo, pick it from the workspace tabs`);
        },
        "Could not open a terminal",
      ),
    openInPaseo: (path) =>
      run(
        "open",
        async () => {
          const workspace = await workspaceOf(path);
          showWorkspace(workspace.id);
        },
        "Could not open the workspace",
      ),
    remove: (path) =>
      run(
        "remove",
        async () => {
          const { entries } = await paseo.workspaces.list();
          const mine = entries.filter((w) => samePath(w.workspaceDirectory ?? w.projectRootPath, path));
          for (const w of mine) {
            const r = await paseo.workspaces.archive(w.id);
            if (r.error) throw new Error(r.error);
          }
          onRemoved(path);
          toast.show(mine.length > 0 ? "Project removed and its Paseo workspace archived" : "Project removed from PigMonitor");
        },
        "Could not remove the project",
      ),
  };
}
