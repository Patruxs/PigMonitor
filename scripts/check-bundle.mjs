import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const CLIENT_SDK = ["@getpaseo/plugin/client", "@getpaseo/plugin/client/ui", "@getpaseo/plugin/client/react-native"];
const SERVER_SDK = ["@getpaseo/plugin/server", "@getpaseo/plugin/server/provider", "@getpaseo/plugin/server/usage", "@getpaseo/plugin/server/acp"];
const SDK = ["@getpaseo/plugin", ...SERVER_SDK, ...CLIENT_SDK];
const CLIENT_ONLY = /^((?:@types\/)?react(?:-dom|-native)?|use-sync-external-store|@tanstack\/react-query)(\/|$)/;
const IMPORTS = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const HOST = /^(zod|react|react-native|@tanstack\/react-query)(\/|$)/;

function trackedCopy(source) {
  const copy = realpathSync.native(mkdtempSync(path.join(tmpdir(), "pigmonitor-bundle-")));
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: source }).toString("utf8").split("\0").filter(Boolean);
  for (const file of files) {
    if (!existsSync(path.join(source, file))) continue;
    mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
    copyFileSync(path.join(source, file), path.join(copy, file));
  }
  return copy;
}

const root = trackedCopy(realpathSync.native(process.cwd()));

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

function installError(specifier, importer, typeOnly) {
  if (specifier.startsWith(".") || path.isAbsolute(specifier) || SDK.includes(specifier) || HOST.test(specifier) || isBuiltin(specifier) || specifier === "@types/node") return null;
  try {
    createRequire(importer).resolve(specifier);
    return null;
  } catch {
    return typeOnly ? `Could not resolve type dependency "${specifier}" imported by ${importer}` : `Could not resolve "${specifier}" imported by ${importer}`;
  }
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
          const specifier = match[2] ?? match[3];
          const error = check(specifier, args.path) ?? installError(specifier, args.path, Boolean(match[1]));
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

function classSyntaxErrors(code) {
  const parsed = ts.createSourceFile("client.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const modules = [...code.matchAll(/^\/\/ (.+)$/gm)].map((match) => ({ at: match.index, file: path.relative(root, path.resolve(match[1])) }));
  const errors = [];
  const visit = (node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const start = node.getStart(parsed);
      const file = modules.findLast((module) => module.at < start)?.file ?? "client bundle";
      const name = node.name?.text ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(parsed) : "(anonymous)");
      errors.push(`${file}: class ${name} reaches the client bundle, where Paseo's native app (Hermes) evaluates class syntax to undefined; use a function or factory instead`);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return errors;
}

const results = await Promise.allSettled([bundle("index.client.tsx", "client"), bundle("index.server.ts", "server")]);
rmSync(root, { recursive: true, force: true });
const failures = results.flatMap((result) => (result.status === "rejected" ? (result.reason.errors?.map((error) => `${error.location ? `${error.location.file}:${error.location.line}: ` : ""}${error.text}`) ?? [String(result.reason)]) : []));
if (results[0].status === "fulfilled") failures.push(...classSyntaxErrors(results[0].value.outputFiles[0].text));
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("client and server bundles build from the tracked files alone, as Paseo's plugin loader builds them");
