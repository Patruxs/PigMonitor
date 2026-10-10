import { build } from "esbuild";
import { readFileSync, realpathSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";

const CLIENT_SDK = ["@getpaseo/plugin/client", "@getpaseo/plugin/client/ui", "@getpaseo/plugin/client/react-native"];
const SERVER_SDK = ["@getpaseo/plugin/server", "@getpaseo/plugin/server/provider", "@getpaseo/plugin/server/usage", "@getpaseo/plugin/server/acp"];
const SDK = ["@getpaseo/plugin", ...SERVER_SDK, ...CLIENT_SDK];
const CLIENT_ONLY = /^((?:@types\/)?react(?:-dom|-native)?|use-sync-external-store|@tanstack\/react-query)(\/|$)/;
const IMPORTS = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const root = realpathSync.native(process.cwd());

function placeOf(file) {
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "outside";
  const [first] = relative.split(path.sep);
  if (first === "node_modules") return null;
  if (first === "client" || first === "server" || first === "shared") return first;
  if (/^index\.client\.tsx?$/.test(relative)) return "client";
  if (/^index\.server\.tsx?$/.test(relative)) return "server";
  return "invalid";
}

function specifierError(specifier, owner) {
  if (specifier === "@getpaseo/plugin/client/host") return "host-private";
  if ((specifier === "@getpaseo/plugin" || specifier.startsWith("@getpaseo/plugin/")) && !SDK.includes(specifier)) return "Unknown SDK";
  if (owner !== "server" && (isBuiltin(specifier) || specifier === "@types/node")) return "Node";
  if (owner !== "server" && SERVER_SDK.includes(specifier)) return "server-only";
  if (owner !== "client" && (CLIENT_SDK.includes(specifier) || CLIENT_ONLY.test(specifier))) return "client-only";
  return null;
}

function placementError(specifier, importer, owner) {
  if (!specifier.startsWith(".")) return null;
  const place = placeOf(path.resolve(path.dirname(importer), specifier));
  if (place === "invalid") return `Plugin modules belong in client/, server/, or shared/: ${specifier} imported by ${importer}`;
  if (place === null || place === "outside" || place === "shared" || place === owner) return null;
  return `${place}-only module cannot be imported into the plugin ${owner} bundle: ${specifier} imported by ${importer}`;
}

function boundary(target) {
  const ownerOf = (file) => (placeOf(file) === "shared" ? "shared" : target);
  const check = (specifier, importer) => {
    const owner = ownerOf(importer);
    const kind = specifierError(specifier, owner);
    if (kind) return `${kind} module cannot be imported into the plugin ${owner} bundle: ${specifier} imported by ${importer}`;
    return placementError(specifier, importer, owner);
  };
  return {
    name: `pigmonitor-${target}-boundary`,
    setup(context) {
      context.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, (args) => {
        if (placeOf(args.path) === null) return null;
        for (const match of readFileSync(args.path, "utf8").matchAll(IMPORTS)) {
          const error = check(match[1] ?? match[2], args.path);
          if (error) return { errors: [{ text: error }] };
        }
        return null;
      });
      context.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return null;
        const error = check(args.path, args.importer);
        return error ? { errors: [{ text: error }] } : null;
      });
    },
  };
}

function bundle(entry, target) {
  return build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "cjs",
    jsx: "automatic",
    platform: target === "server" ? "node" : "neutral",
    target: target === "server" ? "node20" : "es2020",
    mainFields: target === "client" ? ["module", "main"] : undefined,
    supported: target === "client" ? { "async-await": false } : undefined,
    external: target === "client" ? [...SDK, "@tanstack/react-query", "react", "react/jsx-runtime", "react-native", "zod"] : [...SDK, "zod"],
    plugins: [boundary(target)],
    logLevel: "silent",
    treeShaking: true,
    write: false,
  });
}

const results = await Promise.allSettled([bundle("index.client.tsx", "client"), bundle("index.server.ts", "server")]);
const failures = results.flatMap((result) => (result.status === "rejected" ? (result.reason.errors?.map((error) => `${error.location ? `${error.location.file}:${error.location.line}: ` : ""}${error.text}`) ?? [String(result.reason)]) : []));
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("client and server bundles build as Paseo's plugin loader builds them");
