// LazyMapLayers for EffectCraft: the local companion that stands in for After Effects' CEP runtime.
//
//   node app/server.mjs [--port 5190] [--control 9877] [--no-launch] [--no-window]
//
// It serves the panel (dist/panel) on 127.0.0.1, answers the panel's file calls (fs, hashes), streams
// its downloads, and runs its host calls in EffectCraft over EffectCraft's control channel: each call
// is the host script (dist/host/lazymaplayers-effectcraft.jsx) followed by the call, because every
// script EffectCraft runs starts in a fresh engine.
//
// EffectCraft is started with --control when it is not already listening; the panel opens in an app
// window of Microsoft Edge or Google Chrome (else the default browser). Closing that window stops
// the server.
//
// Security: the server listens on 127.0.0.1 only, accepts only Host headers of 127.0.0.1/localhost
// on its own port, and every API request must carry the random token written into the page it served.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { Control } from "./control.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const PORT = Number(option("--port", process.env.LMLEC_PORT ?? 5190));
const CONTROL_PORT = Number(option("--control", process.env.EFFECTCRAFT_CONTROL_PORT ?? 9877));
const LAUNCH = !argv.includes("--no-launch");
const WINDOW = !argv.includes("--no-window");
const TOKEN = crypto.randomBytes(24).toString("hex");
const APP_DATA = process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
/** The After Effects version's data folder: its downloads are shared with this version. */
const AE_DATA = process.env.LMLEC_AE_DATA || path.join(APP_DATA, "LazyMapLayers");
/** This version's own data folder: its render queue, renders, drafts and settings. */
const USER_DATA = path.join(APP_DATA, "LazyMapLayers for EffectCraft");
/** Downloads both versions use: linked from this version's data folder to the After Effects version's. */
const SHARED_DOWNLOADS = ["offline", "regions", "terrain", "history", "imagery", "boundaries", "osm", "osm-cache", "osm-roads", "satellite", "districts"];
const LOG = path.join(os.tmpdir(), "LazyMapLayers", "effectcraft-companion.log");
/**
 * The panel's temp folder: its own, so its job files, panel log and in-app test requests
 * (LazyMapLayers/spikes) never meet the After Effects version's when both run at once.
 */
const PANEL_TMP = path.join(os.tmpdir(), "LazyMapLayers for EffectCraft");
fs.mkdirSync(PANEL_TMP, { recursive: true });

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, line + "\n");
  } catch {
    // Logging never stops the server.
  }
}

/**
 * The download folders are shared with the After Effects version: a path into one of them under this
 * version's data folder is served from the After Effects version's, so a region, terrain or offline
 * pack downloaded in either version is there in both. (A path mapping, not a link on disk: links
 * need permissions some systems do not give.)
 */
function onDisk(p) {
  if (typeof p !== "string" || !p) return p;
  const prefix = USER_DATA + path.sep;
  const same = process.platform === "win32" ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b;
  const normal = path.normalize(p);
  if (normal.length <= prefix.length || !same(normal.slice(0, prefix.length), prefix)) return p;
  const rest = normal.slice(prefix.length);
  const first = rest.split(path.sep)[0];
  return SHARED_DOWNLOADS.some((name) => same(name, first)) ? path.join(AE_DATA, rest) : p;
}

/** Paths in a call's arguments, mapped with onDisk. */
function mapArgs(args) {
  const out = { ...args };
  for (const key of ["p", "from", "to"]) if (typeof out[key] === "string") out[key] = onDisk(out[key]);
  return out;
}

function prepareUserData() {
  fs.mkdirSync(USER_DATA, { recursive: true });
}

// ---- EffectCraft ---------------------------------------------------------------------------------

function findEffectCraft() {
  const exe = process.platform === "win32" ? "effectcraft.exe" : "effectcraft";
  const candidates = [
    process.env.EFFECTCRAFT_APP,
    process.platform === "win32" && path.join(process.env.ProgramFiles ?? "C:\\Program Files", "EffectCraft", exe),
    process.platform === "win32" && path.join(process.env.LOCALAPPDATA ?? "", "Programs", "EffectCraft", exe),
    process.platform === "darwin" && "/Applications/EffectCraft.app/Contents/MacOS/effectcraft",
    process.platform === "linux" && "/usr/bin/effectcraft",
    path.join(ROOT, ".cache", "effectcraft", exe)
  ];
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

let effectcraftVersion = "";
const control = new Control(CONTROL_PORT);

async function connectEffectCraft() {
  try {
    await control.connect(1500);
    return true;
  } catch {
    return false;
  }
}

async function ensureEffectCraft() {
  if (await connectEffectCraft()) return true;
  if (!LAUNCH) return false;
  const app = findEffectCraft();
  if (!app) {
    log("EffectCraft not found: install it, or set EFFECTCRAFT_APP to effectcraft.exe");
    return false;
  }
  log(`starting ${app} --control ${CONTROL_PORT}`);
  const child = spawn(app, ["--control", String(CONTROL_PORT)], { detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await connectEffectCraft()) return true;
  }
  return false;
}

async function readVersion() {
  try {
    const caps = await control.execute("app.capabilities");
    effectcraftVersion = String(caps?.version ?? "");
  } catch {
    effectcraftVersion = "";
  }
}

let hostCache = { mtime: 0, text: "" };
function hostScript() {
  const file = path.join(DIST, "host", "lazymaplayers-effectcraft.jsx");
  const mtime = fs.statSync(file).mtimeMs;
  if (mtime !== hostCache.mtime) hostCache = { mtime, text: fs.readFileSync(file, "utf8") };
  return hostCache.text;
}

/** One ExtendScript call: the host script, then the panel's script; its last value is the result. */
async function evalInEffectCraft(script) {
  if (!(await connectEffectCraft())) {
    return { ok: false, error: `EffectCraft is not reachable on port ${CONTROL_PORT}. Start it from "Start LazyMapLayers", or start it with --control ${CONTROL_PORT}.` };
  }
  const code = `${hostScript()}\n;\n${script}`;
  let reply;
  if (code.length > 3.5 * 1024 * 1024) {
    // The control channel takes lines up to 4 MiB: a larger call goes through a script file.
    const file = path.join(os.tmpdir(), "LazyMapLayers", "jobs", `call-${Date.now()}-${process.pid}.jsx`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, code, "utf8");
    try {
      reply = await control.execute("file.runScript", { path: file });
    } finally {
      fs.rmSync(file, { force: true });
    }
  } else {
    reply = await control.runScript(code, "LazyMapLayers");
  }
  if (!reply || reply.ok === false) {
    const e = reply?.error;
    const message = e ? `${e.message ?? e}${e.line ? ` (line ${e.line})` : ""}` : "no answer";
    return { ok: false, error: message };
  }
  const value = reply.result;
  const result = value === undefined || value === null ? "" : typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (result.startsWith('{"ok":false')) log(`host: ${(/LML\.call\("([^"]+)"/.exec(script) ?? [])[1] ?? script.slice(0, 80)} -> ${result.slice(0, 300)}`);
  return { ok: true, result: explainFileAccess(result) };
}

export const FILE_ACCESS_HELP =
  "EffectCraft does not let scripts read this file yet. In EffectCraft, open Preferences ▸ Scripting & Expressions and turn on Allow Scripts to Write Files and Access Network, then try again.";

/**
 * EffectCraft's scripts read only files in the project's folder unless a preference allows more; a
 * file outside it looks missing. When the host reports a missing file that is there, say why.
 */
function explainFileAccess(result) {
  if (result.indexOf("FILE_NOT_FOUND") < 0) return result;
  try {
    const parsed = JSON.parse(result);
    const message = parsed?.error?.message ?? "";
    const file = /not found: (.+)$/.exec(message)?.[1];
    if (parsed.ok === false && file && fs.existsSync(file)) {
      parsed.error = { code: "EFFECTCRAFT_FILE_ACCESS", message: FILE_ACCESS_HELP };
      return JSON.stringify(parsed);
    }
  } catch {
    // Not a host reply: leave it as it is.
  }
  return result;
}

/** Whether EffectCraft lets scripts read files outside the project's folder (null when unknown). */
async function checkFileAccess() {
  try {
    const probe = path.join(os.tmpdir(), "LazyMapLayers", "effectcraft-access.txt");
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, "ok", "utf8");
    const reply = await control.runScript(`new File(${JSON.stringify(probe)}).exists`);
    return reply?.ok ? reply.result === true || reply.result === "true" : null;
  } catch {
    return null;
  }
}

// ---- the panel's Node calls ----------------------------------------------------------------------

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (c) => chunks.push(c));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

const fsOps = {
  exists: ({ p }) => ({ v: fs.existsSync(p) }),
  write: ({ p, append }, body) => {
    if (append) fs.appendFileSync(p, body);
    else fs.writeFileSync(p, body);
    return {};
  },
  mkdir: ({ p, recursive }) => {
    fs.mkdirSync(p, { recursive: !!recursive });
    return {};
  },
  rm: ({ p, recursive, force }) => {
    fs.rmSync(p, { recursive: !!recursive, force: !!force });
    return {};
  },
  unlink: ({ p }) => {
    fs.unlinkSync(p);
    return {};
  },
  stat: ({ p }) => {
    const s = fs.statSync(p);
    return { size: s.size, mtimeMs: s.mtimeMs, isFile: s.isFile(), isDirectory: s.isDirectory() };
  },
  readdir: ({ p }) => {
    const entries = fs.readdirSync(p, { withFileTypes: true }).map((e) => {
      if (!e.isSymbolicLink()) return { name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() };
      const s = fs.statSync(path.join(p, e.name), { throwIfNoEntry: false });
      return { name: e.name, isFile: !!s?.isFile(), isDirectory: !!s?.isDirectory() };
    });
    // This version's data folder also holds the shared download folders (see onDisk).
    if (path.normalize(p).toLowerCase() === USER_DATA.toLowerCase()) {
      for (const name of SHARED_DOWNLOADS) {
        if (!entries.some((e) => e.name === name) && fs.existsSync(path.join(AE_DATA, name))) entries.push({ name, isFile: false, isDirectory: true });
      }
    }
    return entries;
  },
  copy: ({ from, to }) => {
    fs.copyFileSync(from, to);
    return {};
  },
  rename: ({ from, to }) => {
    fs.renameSync(from, to);
    return {};
  },
  link: ({ from, to }) => {
    fs.linkSync(from, to);
    return {};
  },
  utimes: ({ p, atime, mtime }) => {
    fs.utimesSync(p, atime, mtime);
    return {};
  },
  realpath: ({ p }) => ({ v: fs.realpathSync(p) }),
  hash: ({ algorithm }, body) => ({ v: crypto.createHash(algorithm).update(body).digest("hex") })
};

function readRange(p, offset, length) {
  const fd = fs.openSync(p, "r");
  try {
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = fs.readSync(fd, buffer, read, length - read, offset + read);
      if (n === 0) break;
      read += n;
    }
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function sendError(response, status, error) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ message: error?.message ?? String(error), code: error?.code }));
}

// ---- downloads -----------------------------------------------------------------------------------

function proxy(request, response, body) {
  const url = decodeURIComponent(String(request.headers["x-url"] ?? ""));
  if (!/^https?:\/\//i.test(url)) return sendError(response, 400, new Error("only http and https addresses can be fetched"));
  const headers = JSON.parse(decodeURIComponent(String(request.headers["x-headers"] ?? "%7B%7D")));
  const method = String(request.headers["x-method"] ?? "GET");
  const client = url.startsWith("https:") ? https : http;
  const upstream = client.request(url, { method, headers }, (answer) => {
    // A packed answer (the panel asks Overpass for gzip) is unpacked here: the page has no
    // synchronous zlib, and the panel takes an answer without content-encoding as it is.
    const encoding = String(answer.headers["content-encoding"] ?? "").toLowerCase();
    const unpack = encoding === "gzip" ? zlib.createGunzip() : encoding === "deflate" ? zlib.createInflate() : encoding === "br" ? zlib.createBrotliDecompress() : null;
    const upstreamHeaders = { ...answer.headers };
    if (unpack) {
      delete upstreamHeaders["content-encoding"];
      delete upstreamHeaders["content-length"];
    }
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "x-upstream-status": String(answer.statusCode ?? 0),
      "x-upstream-headers": encodeURIComponent(JSON.stringify(upstreamHeaders))
    });
    const stream = unpack ? answer.pipe(unpack) : answer;
    stream.pipe(response);
    answer.on("error", () => response.destroy());
    if (unpack) unpack.on("error", () => response.destroy());
  });
  upstream.on("error", (error) => {
    if (!response.headersSent) sendError(response, 502, error);
    else response.destroy();
  });
  response.on("close", () => upstream.destroy());
  upstream.end(body.length ? body : undefined);
}

// ---- static files and the page -------------------------------------------------------------------

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

function pageEnv() {
  const env = {};
  for (const key of ["APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOME", "TEMP", "TMP"]) if (process.env[key]) env[key] = process.env[key];
  return {
    token: TOKEN,
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    pid: process.pid,
    root: DIST,
    home: os.homedir(),
    tmp: PANEL_TMP,
    cwd: DIST,
    env,
    effectcraft: effectcraftVersion,
    controlPort: CONTROL_PORT,
    userData: USER_DATA
  };
}

function servePage(response) {
  const html = fs.readFileSync(path.join(DIST, "panel", "index.html"), "utf8");
  const inject = `<script>window.__LMLEC__ = ${JSON.stringify(pageEnv()).replace(/</g, "\\u003c")};</script>\n<script src="prelude.js"></script>\n`;
  const page = html.includes("<!--LMLEC-->") ? html.replace("<!--LMLEC-->", inject) : html.replace(/<script/i, inject + "<script");
  response.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
  response.end(page);
}

function serveStatic(name, response) {
  const base = path.join(DIST, "panel");
  const file = path.normalize(path.join(base, name));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(response);
}

/** A local file with HTTP range support (PMTiles archives). */
function serveFile(request, response, p) {
  let size;
  try {
    size = fs.statSync(p).size;
  } catch (error) {
    return sendError(response, 404, error);
  }
  const range = /bytes=(\d+)-(\d*)/.exec(String(request.headers.range ?? ""));
  if (!range) {
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": size });
    fs.createReadStream(p).pipe(response);
    return;
  }
  const start = Number(range[1]);
  const end = Math.min(size - 1, range[2] ? Number(range[2]) : size - 1);
  if (start >= size) {
    response.writeHead(206, { "content-range": `bytes */${size}`, "content-length": 0 });
    response.end();
    return;
  }
  const data = readRange(p, start, end - start + 1);
  response.writeHead(206, { "content-type": "application/octet-stream", "content-range": `bytes ${start}-${end}/${size}`, "content-length": data.length });
  response.end(data);
}

function openInBrowser(url) {
  if (!/^https?:\/\//i.test(url)) return;
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

// ---- the server ----------------------------------------------------------------------------------

const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const server = http.createServer(async (request, response) => {
  try {
    if (!allowedHosts.has(String(request.headers.host ?? ""))) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
    const name = decodeURIComponent(url.pathname);
    if (name === "/" || name === "/index.html") return servePage(response);
    if (!name.startsWith("/__")) return serveStatic(name.slice(1), response);

    if (request.headers["x-lmlec-token"] !== TOKEN) {
      response.writeHead(403).end("forbidden");
      return;
    }
    if (name === "/__file") return serveFile(request, response, onDisk(url.searchParams.get("p") ?? ""));
    const body = await readBody(request);
    if (name === "/__ec/eval") {
      const reply = await evalInEffectCraft(body.toString("utf8"));
      if (!reply.ok) log(`host call failed: ${reply.error}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(reply));
      return;
    }
    if (name === "/__proxy") return proxy(request, response, body);
    if (name === "/__open") {
      openInBrowser(body.toString("utf8"));
      response.writeHead(200).end("{}");
      return;
    }
    if (name.startsWith("/__node/")) {
      const op = name.slice("/__node/".length);
      const args = mapArgs(JSON.parse(url.searchParams.get("a") ?? "{}"));
      if (op === "read") {
        let data;
        try {
          data = fs.readFileSync(args.p);
        } catch (error) {
          return sendError(response, 500, error);
        }
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(data);
        return;
      }
      if (op === "range") {
        let data;
        try {
          data = readRange(args.p, args.offset, args.length);
        } catch (error) {
          return sendError(response, 500, error);
        }
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(data);
        return;
      }
      const fn = fsOps[op];
      if (!fn) return sendError(response, 404, new Error(`unknown call ${op}`));
      let result;
      try {
        result = fn(args, body);
      } catch (error) {
        return sendError(response, 500, error);
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
      return;
    }
    response.writeHead(404).end("not found");
  } catch (error) {
    log(`request failed: ${error?.stack ?? error}`);
    if (!response.headersSent) sendError(response, 500, error);
    else response.destroy();
  }
});

// ---- the panel window ----------------------------------------------------------------------------

function findBrowser() {
  if (process.platform === "win32") {
    const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const pf = process.env.ProgramFiles ?? "C:\\Program Files";
    const local = process.env.LOCALAPPDATA ?? "";
    return [
      path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(local, "Google", "Chrome", "Application", "chrome.exe")
    ].find((c) => fs.existsSync(c));
  }
  if (process.platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"].find((c) => fs.existsSync(c));
  }
  return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"].find((c) => fs.existsSync(c));
}

function openPanelWindow(url) {
  const browser = findBrowser();
  if (!browser) {
    log(`no Edge or Chrome found: open ${url} in a Chromium browser`);
    openInBrowser(url);
    return;
  }
  const profile = path.join(USER_DATA, "effectcraft-window");
  fs.mkdirSync(profile, { recursive: true });
  const args = [
    `--app=${url}`,
    `--user-data-dir=${profile}`,
    "--window-size=460,900",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--ignore-gpu-blocklist",
    // A covered or minimised window keeps drawing: renders run while EffectCraft is in front, as
    // they do in a panel docked inside After Effects.
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling"
  ];
  // A new Edge profile signs in with the Windows account and starts syncing; InPrivate never does.
  if (/msedge/i.test(browser)) args.unshift("--inprivate");
  // For automated tests only: the window answers the DevTools protocol on this port.
  if (process.env.LMLEC_DEBUG_PORT) args.push(`--remote-debugging-port=${Number(process.env.LMLEC_DEBUG_PORT)}`);
  const child = spawn(browser, args, { stdio: "ignore" });
  child.on("exit", () => {
    log("panel window closed");
    control.close();
    process.exit(0);
  });
}

prepareUserData();

server.listen(PORT, "127.0.0.1", async () => {
  const url = `http://127.0.0.1:${PORT}/`;
  log(`LazyMapLayers for EffectCraft on ${url}`);
  if (!fs.existsSync(path.join(DIST, "host", "lazymaplayers-effectcraft.jsx"))) log("dist/ is missing: run node tools/build.mjs first");
  const ready = await ensureEffectCraft();
  if (ready) await readVersion();
  log(ready ? `EffectCraft ${effectcraftVersion} is connected on port ${CONTROL_PORT}` : "EffectCraft is not connected yet; the panel connects when it is");
  if (ready && (await checkFileAccess()) === false) log(`note: ${FILE_ACCESS_HELP} (needed to import rendered maps)`);
  if (WINDOW) openPanelWindow(url);
});
