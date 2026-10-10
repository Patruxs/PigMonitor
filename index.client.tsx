import type { PluginClientContext } from "@getpaseo/plugin/client";
import { FarmPanel, PigMonitorSurface } from "./client/surface.tsx";
import { PigMonitorSettings } from "./client/settings.tsx";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addSurface("pigmonitor", PigMonitorSurface),
    client.addSidebarItem({ id: "pigmonitor", title: "PigMonitor", icon: "Activity", surface: "pigmonitor" }),
    client.addWorkspacePanel({ id: "farm", title: "PigMonitor", icon: "Activity", context: "workspace", locations: ["explorer", "workspace"], Component: FarmPanel }),
    client.addSettingsScreen({ id: "pigmonitor", title: "PigMonitor settings", icon: "Settings2", Component: PigMonitorSettings }),
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
}
