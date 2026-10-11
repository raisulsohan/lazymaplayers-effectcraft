// Runs scripts in EffectCraft through its command-line tool, with a time limit.
//
// The CLI is found from EFFECTCRAFT_CLI, then the usual install folders. Each run is its own
// process: a script that hangs is stopped after `timeout` milliseconds instead of blocking the caller.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The After Effects version of LazyMapLayers, whose built host script this version runs. */
export const LML_ROOT = path.resolve(ROOT, "..", "LazyMapLayers");

export function findCli(): string {
  const candidates = [
    process.env.EFFECTCRAFT_CLI,
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "EffectCraft", "effectcraft-cli.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "EffectCraft", "effectcraft-cli.exe"),
    path.join(ROOT, ".cache", "effectcraft", "effectcraft-cli.exe"),
    "/Applications/EffectCraft.app/Contents/MacOS/effectcraft-cli",
    "/usr/bin/effectcraft-cli"
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  throw new Error("effectcraft-cli not found: set EFFECTCRAFT_CLI to its full path");
}

export type RunResult = { ok: boolean; out: string; err: string; timedOut: boolean; status: number | null };

/** Runs JavaScript (the After Effects-style object model) in a fresh EffectCraft engine. */
export function runScript(code: string, options: { project?: string; saveAs?: string; timeout?: number; empty?: boolean } = {}): RunResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lml-ec-"));
  const file = path.join(dir, "run.jsx");
  fs.writeFileSync(file, code, "utf8");
  const args = ["script", file];
  if (options.project) args.push("--project", options.project);
  else if (options.empty !== false) args.push("--empty");
  if (options.saveAs) args.push("--save-as", options.saveAs);
  const r = spawnSync(findCli(), args, { encoding: "utf8", timeout: options.timeout ?? 60000, maxBuffer: 256 * 1024 * 1024 });
  fs.rmSync(dir, { recursive: true, force: true });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  return { ok: r.status === 0 && !timedOut, out: r.stdout ?? "", err: r.stderr ?? "", timedOut, status: r.status };
}

/** The host script as this version runs it: the compatibility layer around LazyMapLayers' host. */
export function hostSource(): string {
  return [path.join(ROOT, "host", "compat.jsx"), path.join(LML_ROOT, "dist", "host", "lazymaplayers.jsx"), path.join(ROOT, "host", "compat-post.jsx")]
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
}
