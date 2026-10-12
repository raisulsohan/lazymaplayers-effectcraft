// LazyMapLayers for EffectCraft: replaces LazyMapLayers' src/panel/cep.ts in this version's build
// (tools/build.mjs). Same exports, so the rest of the panel is unchanged:
//
//   evalScript   runs ExtendScript in EffectCraft: the local server (app/server.mjs) sends the host
//                script and the call over EffectCraft's control channel.
//   nodeRequire  fs, path, os, crypto and https as the panel uses them: path and os here, the others
//                through the local server (fs synchronously, as the panel expects; https streamed).
//
// Every request to the server carries the token the server wrote into the page, so no other web page
// can use it.

import type { EcEnv } from "./prelude.ts";

export type NodeFs = typeof import("node:fs");
export type NodePath = typeof import("node:path");
export type NodeOs = typeof import("node:os");

const ENV: EcEnv = window.__LMLEC__;
const TOKEN = ENV.token;
const WIN = ENV.platform === "win32";

export function isInCep(): boolean {
  return true;
}

// ---- the local server ----------------------------------------------------------------------------

type NodeError = Error & { code?: string };

function failure(text: string, status: number): NodeError {
  let message = `local server answered ${status}`;
  let code: string | undefined;
  try {
    const parsed = JSON.parse(text) as { message?: string; code?: string };
    if (parsed.message) message = parsed.message;
    code = parsed.code;
  } catch {
    if (text) message = text;
  }
  const error: NodeError = new Error(message);
  if (code) error.code = code;
  return error;
}

/** A synchronous call to the local server (the panel's file access is synchronous, as in CEP). */
function syncCall(op: string, args: Record<string, unknown>, body?: Uint8Array | string | null, binary = false): { text: string; bytes?: Uint8Array } {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `/__node/${op}?a=${encodeURIComponent(JSON.stringify(args))}`, false);
  xhr.setRequestHeader("x-lmlec-token", TOKEN);
  if (binary) xhr.overrideMimeType("text/plain; charset=x-user-defined");
  xhr.send(body === undefined || body === null ? null : (body as XMLHttpRequestBodyInit));
  if (xhr.status !== 200) throw failure(binary ? "" : xhr.responseText, xhr.status);
  if (!binary) return { text: xhr.responseText };
  const raw = xhr.responseText;
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
  return { text: "", bytes };
}

function syncJson<T>(op: string, args: Record<string, unknown>, body?: Uint8Array | string | null): T {
  return JSON.parse(syncCall(op, args, body).text) as T;
}

function asBuffer(bytes: Uint8Array): Uint8Array {
  const B = (globalThis as unknown as { Buffer: { from: (b: ArrayBuffer, o: number, l: number) => Uint8Array } }).Buffer;
  return B.from(bytes.buffer, bytes.byteOffset, bytes.length);
}

function encodingOf(options: unknown): string | null {
  if (typeof options === "string") return options;
  if (options && typeof options === "object" && typeof (options as { encoding?: unknown }).encoding === "string") return (options as { encoding: string }).encoding;
  return null;
}

function bodyOf(data: unknown): Uint8Array | string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    // Copied: a view of a SharedArrayBuffer cannot be sent.
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
  }
  return String(data);
}

type StatInfo = { size: number; mtimeMs: number; isFile: boolean; isDirectory: boolean };

function stats(info: StatInfo) {
  return {
    size: info.size,
    mtimeMs: info.mtimeMs,
    mtime: new Date(info.mtimeMs),
    isFile: () => info.isFile,
    isDirectory: () => info.isDirectory,
    isSymbolicLink: () => false
  };
}

const fds = new Map<number, string>();
let nextFd = 1000;

const fsShim = {
  existsSync(p: string): boolean {
    try {
      return syncJson<{ v: boolean }>("exists", { p: String(p) }).v;
    } catch {
      return false;
    }
  },
  readFileSync(p: string, options?: unknown): string | Uint8Array {
    const bytes = syncCall("read", { p: String(p) }, null, true).bytes!;
    const encoding = encodingOf(options);
    if (!encoding) return asBuffer(bytes);
    return (asBuffer(bytes) as unknown as { toString: (e: string) => string }).toString(encoding);
  },
  writeFileSync(p: string, data: unknown): void {
    syncCall("write", { p: String(p) }, bodyOf(data));
  },
  appendFileSync(p: string, data: unknown): void {
    syncCall("write", { p: String(p), append: true }, bodyOf(data));
  },
  mkdirSync(p: string, options?: { recursive?: boolean }): void {
    syncCall("mkdir", { p: String(p), recursive: !!options?.recursive });
  },
  rmSync(p: string, options?: { recursive?: boolean; force?: boolean }): void {
    syncCall("rm", { p: String(p), recursive: !!options?.recursive, force: !!options?.force });
  },
  unlinkSync(p: string): void {
    syncCall("unlink", { p: String(p) });
  },
  statSync(p: string) {
    return stats(syncJson<StatInfo>("stat", { p: String(p) }));
  },
  readdirSync(p: string, options?: { withFileTypes?: boolean }) {
    const entries = syncJson<{ name: string; isFile: boolean; isDirectory: boolean }[]>("readdir", { p: String(p) });
    if (!options?.withFileTypes) return entries.map((e) => e.name);
    return entries.map((e) => ({ name: e.name, isFile: () => e.isFile, isDirectory: () => e.isDirectory, isSymbolicLink: () => false }));
  },
  copyFileSync(from: string, to: string): void {
    syncCall("copy", { from: String(from), to: String(to) });
  },
  renameSync(from: string, to: string): void {
    syncCall("rename", { from: String(from), to: String(to) });
  },
  linkSync(from: string, to: string): void {
    syncCall("link", { from: String(from), to: String(to) });
  },
  /** Times as Node takes them: a Date, or seconds since 1970. */
  utimesSync(p: string, atime: Date | number, mtime: Date | number): void {
    const seconds = (t: Date | number) => (t instanceof Date ? t.getTime() / 1000 : Number(t));
    syncCall("utimes", { p: String(p), atime: seconds(atime), mtime: seconds(mtime) });
  },
  realpathSync(p: string): string {
    return syncJson<{ v: string }>("realpath", { p: String(p) }).v;
  },
  openSync(p: string, flags: string = "r"): number {
    if (flags !== "r") throw new Error(`openSync: only reading is supported here (flags ${flags})`);
    syncJson<StatInfo>("stat", { p: String(p) });
    const fd = nextFd++;
    fds.set(fd, String(p));
    return fd;
  },
  readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number {
    const p = fds.get(fd);
    if (p === undefined) throw new Error("readSync: bad file descriptor");
    const bytes = syncCall("range", { p, offset: position, length }, null, true).bytes!;
    buffer.set(bytes, offset);
    return bytes.length;
  },
  closeSync(fd: number): void {
    fds.delete(fd);
  }
};

// ---- path and os -------------------------------------------------------------------------------

function makePath(win: boolean) {
  const sep = win ? "\\" : "/";
  const isSep = (c: string | undefined) => c === "/" || (win && c === "\\");
  const splitRoot = (p: string): [string, string] => {
    if (win) {
      let m = /^[a-zA-Z]:([\\/])?/.exec(p);
      if (m) return [p.slice(0, 2) + (m[1] ? "\\" : ""), p.slice(m[0].length)];
      m = /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+[\\/]?/.exec(p);
      if (m) return ["\\\\" + m[0].slice(2).replace(/[\\/]+/g, "\\").replace(/\\?$/, "\\"), p.slice(m[0].length)];
      if (isSep(p[0])) return ["\\", p.slice(1)];
      return ["", p];
    }
    return p.startsWith("/") ? ["/", p.slice(1)] : ["", p];
  };
  const normalize = (p: string): string => {
    if (!p) return ".";
    const [root, rest] = splitRoot(p);
    const parts: string[] = [];
    for (const s of rest.split(win ? /[\\/]+/ : /\/+/)) {
      if (!s || s === ".") continue;
      if (s === "..") {
        if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
        else if (!root) parts.push("..");
        continue;
      }
      parts.push(s);
    }
    const trailing = rest.length > 0 && isSep(rest[rest.length - 1]);
    let out = root + parts.join(sep);
    if (trailing && parts.length) out += sep;
    return out || root || ".";
  };
  const isAbsolute = (p: string) => {
    const [root] = splitRoot(p);
    return win ? root.endsWith("\\") : root === "/";
  };
  const stripTrailing = (p: string) => {
    const [root] = splitRoot(p);
    let out = p;
    while (out.length > root.length && isSep(out[out.length - 1])) out = out.slice(0, -1);
    return out;
  };
  const lastSep = (p: string) => Math.max(p.lastIndexOf("/"), win ? p.lastIndexOf("\\") : -1);
  const api = {
    sep,
    delimiter: win ? ";" : ":",
    normalize,
    isAbsolute,
    join: (...parts: string[]) => {
      const joined = parts.filter((x) => x !== "").join(sep);
      return joined ? normalize(joined) : ".";
    },
    resolve: (...parts: string[]) => {
      let resolved = "";
      for (let i = parts.length - 1; i >= 0 && !isAbsolute(resolved); i--) if (parts[i]) resolved = parts[i] + (resolved ? sep + resolved : "");
      if (!isAbsolute(resolved)) resolved = ENV.cwd + sep + resolved;
      return stripTrailing(normalize(resolved));
    },
    dirname: (p: string) => {
      const [root, rest] = splitRoot(p);
      const body = stripTrailing(rest || "");
      const at = lastSep(body);
      if (at < 0) return root ? stripTrailing(root) || root : ".";
      return root + body.slice(0, at).replace(win ? /[\\/]+$/ : /\/+$/, "") || root || ".";
    },
    basename: (p: string, ext?: string) => {
      const body = stripTrailing(p);
      let base = body.slice(lastSep(body) + 1);
      if (win && /^[a-zA-Z]:$/.test(base)) base = "";
      if (ext && base.endsWith(ext) && base !== ext) base = base.slice(0, -ext.length);
      return base;
    },
    extname: (p: string) => {
      const base = api.basename(p);
      const dot = base.lastIndexOf(".");
      return dot <= 0 ? "" : base.slice(dot);
    },
    relative: (from: string, to: string) => {
      const a = api.resolve(from).split(sep).filter(Boolean);
      const b = api.resolve(to).split(sep).filter(Boolean);
      const same = (x: string, y: string) => (win ? x.toLowerCase() === y.toLowerCase() : x === y);
      let i = 0;
      while (i < a.length && i < b.length && same(a[i], b[i])) i++;
      return [...a.slice(i).map(() => ".."), ...b.slice(i)].join(sep);
    }
  };
  return api;
}

const pathShim = makePath(WIN);

const osShim = {
  homedir: () => ENV.home,
  tmpdir: () => ENV.tmp,
  platform: () => ENV.platform,
  release: () => ENV.release,
  arch: () => ENV.arch,
  EOL: WIN ? "\r\n" : "\n",
  cpus: () => Array.from({ length: navigator.hardwareConcurrency || 4 }, () => ({ model: "", speed: 0 }))
};

// ---- crypto (hashes of downloads) ---------------------------------------------------------------

const cryptoShim = {
  createHash(algorithm: string) {
    const parts: Uint8Array[] = [];
    const hash = {
      update(data: unknown) {
        const body = bodyOf(data);
        parts.push(typeof body === "string" ? new TextEncoder().encode(body) : body);
        return hash;
      },
      digest(encoding = "hex") {
        const size = parts.reduce((n, p) => n + p.length, 0);
        const all = new Uint8Array(size);
        let at = 0;
        for (const p of parts) {
          all.set(p, at);
          at += p.length;
        }
        const hex = syncJson<{ v: string }>("hash", { algorithm }, all).v;
        if (encoding === "hex") return hex;
        const B = (globalThis as unknown as { Buffer: { from: (s: string, e: string) => { toString: (e: string) => string } } }).Buffer;
        return B.from(hex, "hex").toString(encoding);
      }
    };
    return hash;
  }
};

// ---- https (downloads; streamed through the local server, so CORS does not apply) ----------------

type Listener = (...args: unknown[]) => void;

class Emitter {
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  once(event: string, listener: Listener): this {
    const wrapped: Listener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, listener: Listener): this {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== listener));
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const l of [...(this.listeners.get(event) ?? [])]) l(...args);
  }
}

function httpsRequest(url: string, options: { method?: string; headers?: Record<string, string> } = {}, callback?: (response: unknown) => void) {
  const request = new Emitter() as Emitter & {
    setTimeout: (ms: number, onTimeout: () => void) => unknown;
    destroy: (error?: Error) => void;
    end: (body?: unknown) => void;
    write: (body: unknown) => void;
  };
  const abort = new AbortController();
  let finished = false;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let idleMs = 0;
  let onIdle: (() => void) | null = null;
  const pending: Uint8Array[] = [];
  const touch = () => {
    if (idle) clearTimeout(idle);
    if (idleMs && onIdle) idle = setTimeout(onIdle, idleMs);
  };
  const finish = (error?: Error) => {
    if (finished) return;
    finished = true;
    if (idle) clearTimeout(idle);
    if (error) request.emit("error", error);
    request.emit("close");
  };
  request.setTimeout = (ms, onTimeout) => {
    idleMs = ms;
    onIdle = onTimeout;
    touch();
    return request;
  };
  request.destroy = (error) => {
    abort.abort();
    finish(error);
  };
  request.write = (body) => {
    const b = bodyOf(body);
    pending.push(typeof b === "string" ? new TextEncoder().encode(b) : b);
  };
  request.end = (body) => {
    if (body !== undefined && body !== null) request.write(body);
    const size = pending.reduce((n, p) => n + p.length, 0);
    const all = new Uint8Array(size);
    let at = 0;
    for (const p of pending) {
      all.set(p, at);
      at += p.length;
    }
    fetch("/__proxy", {
      method: "POST",
      headers: {
        "x-lmlec-token": TOKEN,
        "x-url": encodeURIComponent(url),
        "x-method": options.method ?? "GET",
        "x-headers": encodeURIComponent(JSON.stringify(options.headers ?? {}))
      },
      body: size ? all : undefined,
      signal: abort.signal
    })
      .then(async (answer) => {
        if (answer.status !== 200) throw failure(await answer.text(), answer.status);
        touch();
        const response = new Emitter() as Emitter & { statusCode: number; headers: Record<string, string | string[]>; resume: () => void };
        response.statusCode = Number(answer.headers.get("x-upstream-status") ?? 0);
        response.headers = JSON.parse(decodeURIComponent(answer.headers.get("x-upstream-headers") ?? "%7B%7D"));
        let skipped = false;
        response.resume = () => {
          skipped = true;
        };
        callback?.(response);
        const reader = answer.body!.getReader();
        if (skipped) {
          await reader.cancel();
          finish();
          return;
        }
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          touch();
          response.emit("data", asBuffer(value));
        }
        response.emit("end");
        finish();
      })
      .catch((error: Error) => finish(finished ? undefined : error));
  };
  return request;
}

const httpsShim = { request: httpsRequest, get: (url: string, options: Record<string, unknown>, callback: (r: unknown) => void) => {
  const r = httpsRequest(url, options as { headers?: Record<string, string> }, callback);
  r.end();
  return r;
} };

// ---- the CEP surface -----------------------------------------------------------------------------

export function nodeRequire<T>(id: string): T {
  const name = id.replace(/^node:/, "");
  if (name === "fs") return fsShim as unknown as T;
  if (name === "path") return pathShim as unknown as T;
  if (name === "os") return osShim as unknown as T;
  if (name === "crypto") return cryptoShim as unknown as T;
  if (name === "https" || name === "http") return httpsShim as unknown as T;
  throw new Error(`Node module ${id} is not available in LazyMapLayers for EffectCraft`);
}

export const fs = () => nodeRequire<NodeFs>("fs");
export const path = () => nodeRequire<NodePath>("path");
export const os = () => nodeRequire<NodeOs>("os");

/**
 * This version's data folder (render cache, render queue, drafts): "LazyMapLayers for EffectCraft"
 * beside the After Effects version's, whose download folders it links to (app/server.mjs), so
 * downloads are shared and render queues are not.
 */
export function userDataDir(): string {
  return ENV.userData;
}

/** Folder that contains panel/, host/ and data/. */
export function extensionRoot(): string {
  return ENV.root;
}

/** Opens a web page in the user's own browser. */
export function openUrl(url: string): void {
  void fetch("/__open", { method: "POST", headers: { "x-lmlec-token": TOKEN }, body: url }).catch(() => window.open(url, "_blank"));
}

export function hostEnvironment(): { appName: string; appVersion: string; appLocale: string } {
  return { appName: "EffectCraft", appVersion: ENV.effectcraft || "0", appLocale: "en_US" };
}

/** Runs ExtendScript in EffectCraft and resolves with its string result. */
export async function evalScript(script: string): Promise<string> {
  const answer = await fetch("/__ec/eval", { method: "POST", headers: { "x-lmlec-token": TOKEN, "content-type": "text/plain; charset=utf-8" }, body: script });
  const text = await answer.text();
  if (answer.status !== 200) throw failure(text, answer.status);
  const reply = JSON.parse(text) as { ok: boolean; result?: string; error?: string };
  if (!reply.ok) throw new Error(`ExtendScript failed: ${reply.error ?? script.slice(0, 120)}`);
  return reply.result ?? "";
}

export type HostResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

/**
 * Calls a host API function `LML.api.<name>` with JSON arguments. Arguments travel as a JSON
 * string literal, so anything JSON can hold (including Unicode text) arrives intact.
 * Large payloads should go through a job file instead (see `callHostWithJobFile`).
 */
export async function callHost<T>(name: string, args: unknown = {}): Promise<T> {
  // Non-ASCII characters become \uXXXX escapes so the script text itself stays pure ASCII.
  const json = asciiOnly(JSON.stringify(JSON.stringify(args)));
  const raw = await evalScript(`LML.call(${JSON.stringify(name)}, ${json})`);
  let parsed: HostResult<T>;
  try {
    parsed = JSON.parse(raw) as HostResult<T>;
  } catch {
    throw new Error(`host returned non-JSON for ${name}: ${raw.slice(0, 200)}`);
  }
  if (!parsed.ok) throw new Error(`${parsed.error.code}: ${parsed.error.message}`);
  return parsed.value;
}

export function asciiOnly(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += code > 126 ? String.fromCharCode(92) + "u" + code.toString(16).padStart(4, "0") : text[i];
  }
  return out;
}

/**
 * In After Effects this writes the arguments to a job file the host reads. EffectCraft's scripts may
 * only read files in the project's folder (unless a preference allows more), so here the arguments
 * travel inside the call; the local server moves a very large call into a script file itself.
 */
export async function callHostWithJobFile<T>(name: string, args: unknown): Promise<T> {
  return callHost<T>(name, args);
}
