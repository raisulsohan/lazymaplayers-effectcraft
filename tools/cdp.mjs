// Evaluates JavaScript in the panel window over the Chrome DevTools Protocol (for tests: the window
// must have been started with --remote-debugging-port).
//
//   node tools/cdp.mjs <port> "<expression>"          prints the result as JSON
//   node tools/cdp.mjs <port> --screenshot out.png     saves a picture of the panel

import fs from "node:fs";
import { pathToFileURL } from "node:url";

export async function panelPage(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === "page" && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(t.url));
  if (!page) throw new Error("no LazyMapLayers panel page on that port");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return {
    async evaluate(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
      return r.result?.result?.value;
    },
    /** A real mouse click at page coordinates; modifiers: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift. */
    async click(x, y, modifiers = 0) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x, y, modifiers, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
      }
    },
    async key(key, text) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, text, code: key === "Enter" ? "Enter" : undefined, windowsVirtualKeyCode: key === "Enter" ? 13 : undefined });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key === "Enter" ? "Enter" : undefined, windowsVirtualKeyCode: key === "Enter" ? 13 : undefined });
    },
    async screenshot(file) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(r.result.data, "base64"));
    },
    close: () => ws.close()
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [port, a, b] = process.argv.slice(2);
  const page = await panelPage(Number(port));
  if (a === "--screenshot") {
    await page.screenshot(b);
    console.log(`saved ${b}`);
  } else {
    console.log(JSON.stringify(await page.evaluate(a), null, 2));
  }
  page.close();
}
