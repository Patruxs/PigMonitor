import type { PluginClientContext } from "@getpaseo/plugin/client";
import { FarmPanel } from "./client/monitor/farm-panel.tsx";
import { PigMonitorSurface } from "./client/monitor/surface.tsx";
import { PigMonitorSettings } from "./client/settings/settings.tsx";
import { PigMonitorSidebarItem, SCREEN_ID } from "./client/monitor/sidebar-item.tsx";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({ id: SCREEN_ID, title: "PigMonitor", Component: PigMonitorSurface }),
    client.addSidebarHeaderItem({ id: "pigmonitor", title: "PigMonitor", Component: PigMonitorSidebarItem }),
    client.addWorkspacePanel({ id: "farm", title: "PigMonitor", icon: "Activity", context: "workspace", locations: ["explorer", "workspace"], Component: FarmPanel }),
    client.addSettingsScreen({ id: "pigmonitor", title: "Settings", icon: "Settings2", Component: PigMonitorSettings }),
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
}
