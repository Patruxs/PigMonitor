import type { ToolCallDetail } from "../../shared/stream/tool-call.ts";
import type { PaseoAgent } from "../chat/agent-live.ts";

export interface PermissionAction {
  id: string;
  label: string;
  behavior: "allow" | "deny";
  variant?: "primary" | "secondary" | "danger";
  intent?: "implement" | "implement_resume" | "dismiss";
}

export interface PermissionRequest {
  id: string;
  provider: string;
  name: string;
  kind: "tool" | "plan" | "question" | "mode" | "other";
  title?: string;
  description?: string;
  input?: Record<string, unknown>;
  detail?: ToolCallDetail;
  actions?: PermissionAction[];
  metadata?: Record<string, unknown>;
}

export type PermissionResponse =
  | { behavior: "allow"; selectedActionId?: string; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; selectedActionId?: string; message?: string; interrupt?: boolean };

export interface PermissionEvents {
  added: PermissionRequest[];
  resolved: Set<string>;
}

function permissionsOf(agent: PaseoAgent | null): PermissionRequest[] {
  return ((agent?.pendingPermissions ?? []) as unknown as PermissionRequest[]).filter((permission) => typeof permission?.id === "string");
}

export function permissionRequested(had: PermissionEvents, request: PermissionRequest): PermissionEvents {
  return { added: [...had.added.filter((p) => p.id !== request.id), request], resolved: had.resolved };
}

export function permissionResolved(had: PermissionEvents, requestId: string): PermissionEvents {
  return { added: had.added.filter((p) => p.id !== requestId), resolved: new Set([...had.resolved, requestId]) };
}

export function pendingPermissions(agent: PaseoAgent | null, permissionEvents: PermissionEvents): PermissionRequest[] {
  const byId = new Map<string, PermissionRequest>();
  for (const permission of permissionsOf(agent)) if (!permissionEvents.resolved.has(permission.id)) byId.set(permission.id, permission);
  for (const permission of permissionEvents.added) byId.set(permission.id, permission);
  return [...byId.values()];
}
