import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export function notifyHooksSet(piggeryHome: string): boolean {
  const dir = path.join(piggeryHome, "hooks", "notify.d");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  return names.some((name) => {
    try {
      const info = statSync(path.join(dir, name));
      return info.isFile() && (info.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  });
}
