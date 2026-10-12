// Runs before panel.js: the two globals Node gives a CEP panel that a browser does not, `process`
// and `Buffer`, as far as LazyMapLayers' panel uses them. The local server (app/server.mjs) writes
// the facts about this computer into the page as window.__LMLEC__.

export type EcEnv = {
  token: string;
  platform: string;
  release: string;
  arch: string;
  pid: number;
  root: string;
  home: string;
  tmp: string;
  cwd: string;
  env: Record<string, string>;
  effectcraft: string;
  controlPort: number;
  userData: string;
};

declare global {
  interface Window {
    __LMLEC__: EcEnv;
  }
}

const env = window.__LMLEC__;

(globalThis as unknown as { process: unknown }).process = {
  platform: env.platform,
  arch: env.arch,
  env: env.env,
  pid: env.pid,
  versions: {},
  cwd: () => env.cwd
};

type Encoding = "utf8" | "utf-8" | "base64" | "hex" | "latin1" | "binary" | "ascii";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/** A Uint8Array with the parts of Node's Buffer the panel uses. */
class LmlBuffer extends Uint8Array {
  static alloc(size: number): LmlBuffer {
    return new LmlBuffer(size);
  }

  static isBuffer(value: unknown): boolean {
    return value instanceof LmlBuffer;
  }

  static compare(a: Uint8Array, b: Uint8Array): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
  }

  static byteLength(text: string): number {
    return encoder.encode(text).length;
  }

  static concat(list: Uint8Array[], total?: number): LmlBuffer {
    const size = total ?? list.reduce((n, b) => n + b.length, 0);
    const out = new LmlBuffer(size);
    let at = 0;
    for (const b of list) {
      out.set(b.subarray(0, Math.min(b.length, size - at)), at);
      at += b.length;
      if (at >= size) break;
    }
    return out;
  }

  static from(value: unknown, encodingOrOffset?: Encoding | number, length?: number): LmlBuffer {
    if (typeof value === "string") {
      const encoding = (encodingOrOffset as Encoding | undefined) ?? "utf8";
      if (encoding === "base64") {
        const binary = atob(value.replace(/[^A-Za-z0-9+/=]/g, ""));
        const out = new LmlBuffer(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
        return out;
      }
      if (encoding === "hex") {
        const out = new LmlBuffer(value.length >> 1);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(value.substr(i * 2, 2), 16);
        return out;
      }
      if (encoding === "latin1" || encoding === "binary" || encoding === "ascii") {
        const out = new LmlBuffer(value.length);
        for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
        return out;
      }
      const bytes = encoder.encode(value);
      return new LmlBuffer(bytes.buffer, bytes.byteOffset, bytes.length);
    }
    if (value instanceof ArrayBuffer) {
      // Shares the memory, like Node's Buffer.from(arrayBuffer, offset, length).
      const offset = typeof encodingOrOffset === "number" ? encodingOrOffset : 0;
      return new LmlBuffer(value, offset, length ?? value.byteLength - offset);
    }
    if (ArrayBuffer.isView(value)) {
      const view = value as Uint8Array;
      const out = new LmlBuffer(view.byteLength);
      out.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      return out;
    }
    if (Array.isArray(value)) {
      const out = new LmlBuffer(value.length);
      for (let i = 0; i < value.length; i++) out[i] = Number(value[i]) & 0xff;
      return out;
    }
    throw new TypeError("Buffer.from: unsupported value");
  }

  toString(encoding: Encoding = "utf8", start = 0, end = this.length): string {
    const part = this.subarray(start, end);
    if (encoding === "base64") {
      let binary = "";
      for (let i = 0; i < part.length; i += 0x8000) binary += String.fromCharCode(...part.subarray(i, i + 0x8000));
      return btoa(binary);
    }
    if (encoding === "hex") {
      let out = "";
      for (const b of part) out += b.toString(16).padStart(2, "0");
      return out;
    }
    if (encoding === "latin1" || encoding === "binary" || encoding === "ascii") {
      let out = "";
      for (let i = 0; i < part.length; i += 0x8000) out += String.fromCharCode(...part.subarray(i, i + 0x8000));
      return out;
    }
    return decoder.decode(part);
  }

  equals(other: Uint8Array): boolean {
    if (other.length !== this.length) return false;
    for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
    return true;
  }

  readUInt8(at: number): number {
    return this[at];
  }

  readUInt16LE(at: number): number {
    return this[at] | (this[at + 1] << 8);
  }

  readUInt32LE(at: number): number {
    return (this[at] | (this[at + 1] << 8) | (this[at + 2] << 16)) + this[at + 3] * 0x1000000;
  }

  readUInt16BE(at: number): number {
    return (this[at] << 8) | this[at + 1];
  }

  readUInt32BE(at: number): number {
    return this[at] * 0x1000000 + ((this[at + 1] << 16) | (this[at + 2] << 8) | this[at + 3]);
  }
}

(globalThis as unknown as { Buffer: unknown }).Buffer = LmlBuffer;
