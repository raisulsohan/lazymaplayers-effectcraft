// A client of EffectCraft's control channel (docs/control-protocol.md in EffectCraft): TCP on
// 127.0.0.1, one JSON object per line each way, replies in order on a connection.

import net from "node:net";

export class Control {
  constructor(port = 9877, host = "127.0.0.1") {
    this.port = port;
    this.host = host;
    this.socket = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
  }

  connect(timeout = 3000) {
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ port: this.port, host: this.host });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`EffectCraft is not listening on port ${this.port}`));
      }, timeout);
      socket.setEncoding("utf8");
      socket.on("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.on("data", (chunk) => this.received(chunk));
      socket.on("error", (error) => {
        clearTimeout(timer);
        this.fail(error);
        reject(error);
      });
      socket.on("close", () => this.fail(new Error("EffectCraft closed the control connection")));
    });
  }

  received(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let reply;
      try {
        reply = JSON.parse(line);
      } catch {
        continue;
      }
      const p = this.pending.get(reply.id);
      if (!p) continue;
      this.pending.delete(reply.id);
      if (reply.ok) p.resolve(reply.result);
      else p.reject(new Error(typeof reply.error === "string" ? reply.error : JSON.stringify(reply.error)));
    }
  }

  fail(error) {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    this.socket = null;
  }

  async request(method, params = {}) {
    await this.connect();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  execute(command, params = {}) {
    return this.request("engine.execute", { command, params });
  }

  /** Runs JavaScript in EffectCraft's script engine: {ok, result, output, error}. */
  runScript(code, name = "LazyMapLayers") {
    return this.execute("script.run", { code, name });
  }

  close() {
    if (this.socket) this.socket.end();
    this.socket = null;
  }
}
