import assert from "node:assert/strict";
import test from "node:test";
import type { PaseoAgent } from "../chat/agent-live.ts";
import { pendingPermissions, permissionRequested, permissionResolved, type PermissionEvents, type PermissionRequest } from "./pending-permissions.ts";

const NONE: PermissionEvents = { added: [], resolved: new Set() };

function request(id: string, title = id): PermissionRequest {
  return { id, provider: "claude", name: "Bash", kind: "tool", title };
}

function agentListing(permissions: unknown[]): PaseoAgent {
  return { pendingPermissions: permissions } as unknown as PaseoAgent;
}

test("a permission resolved here stays hidden while the agent still lists it, and one requested here shows before the agent lists it", () => {
  const events = [request("new"), request("answered")].reduce(permissionRequested, NONE);
  const settled = ["answered", "stale"].reduce(permissionResolved, events);
  const agent = agentListing([request("stale"), request("open"), { title: "no id" }]);
  assert.deepEqual(pendingPermissions(agent, settled).map((p) => p.id), ["open", "new"]);
});

test("a permission requested again replaces the earlier request and the agent's copy, and is listed once", () => {
  const events = [request("p", "first"), request("p", "second")].reduce(permissionRequested, NONE);
  assert.deepEqual(pendingPermissions(agentListing([request("p", "agent's")]), events), [request("p", "second")]);
});
