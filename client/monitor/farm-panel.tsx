import { useWorkspace, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { View } from "react-native";
import { StoredPalette } from "../palette.tsx";
import { Shell } from "./surface.tsx";

export function FarmPanel({ theme, layout, workspaceId, navigation, host }: PluginWorkspacePanelProps) {
  const dir = useWorkspace(workspaceId, (w) => w.directory);
  if (!dir) return <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }} />;
  return <StoredPalette><Shell theme={theme} compact={layout.compact} dir={dir} navigation={navigation} serverId={host.id} empty="No team works here yet. Ask your agent: “make a supervisor-executor team for …”" /></StoredPalette>;
}
