// Runs LazyMapLayers' own in-app test suites against EffectCraft, in the panel window of a test build
// (node tools/build.mjs --test, started with LMLEC_DEBUG_PORT set so the window answers DevTools).
//
//   node tools/run-suites.mjs <devtools port> [--fresh] <suite id> [<suite id> …]      e.g. 9333 --fresh H1 P1 SH1
//
// --fresh starts a new, empty EffectCraft project first (the open one is closed without saving), as
// LazyMapLayers' own runner does with a throwaway project.
//
// The request and the results go through the panel's own file calls, so they land where the panel
// and EffectCraft look. Results: %TEMP%\LazyMapLayers\spikes\results.json, summarised here.

import { Control } from "../app/control.mjs";
import { panelPage } from "./cdp.mjs";

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const [port, ...suites] = args.filter((a) => a !== "--fresh");
if (fresh) {
  const control = new Control(Number(process.env.EFFECTCRAFT_CONTROL_PORT ?? 9877));
  await control.execute("file.newProject");
  control.close();
}
if (!port || !suites.length) {
  console.log("usage: node tools/run-suites.mjs <devtools port> <suite id> [...]");
  process.exit(2);
}
const page = await panelPage(Number(port));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A file call through the panel's server: op, args, optional body; returns the response text. */
const call = (op, args, body) =>
  page.evaluate(`(() => {
    const x = new XMLHttpRequest();
    x.open("POST", "/__node/${op}?a=" + encodeURIComponent(JSON.stringify(${JSON.stringify(args)})), false);
    x.setRequestHeader("x-lmlec-token", window.__LMLEC__.token);
    x.send(${body === undefined ? "null" : JSON.stringify(body)});
    return x.status + " " + x.responseText;
  })()`);

const tmp = await page.evaluate("window.__LMLEC__.tmp");
const sep = tmp.includes("\\") ? "\\" : "/";
const dir = [tmp, "LazyMapLayers", "spikes"].join(sep);
const results = dir + sep + "results.json";
await call("mkdir", { p: dir, recursive: true });
await call("rm", { p: results, force: true });
const started = Date.now();
await call("write", { p: dir + sep + "run-request.json" }, JSON.stringify({ only: suites, quit: false }));
console.log(`asked for ${suites.join(", ")}; waiting for ${results}`);

let text = null;
for (let i = 0; i < 2400; i++) {
  await sleep(3000);
  const answer = await call("read", { p: results });
  if (answer.startsWith("200 ")) {
    text = answer.slice(4);
    break;
  }
  if (i % 20 === 19) console.log(`  ${Math.round((Date.now() - started) / 1000)} s: ${await page.evaluate("document.body.innerText.split('\\n').slice(-1)[0]")}`);
}
page.close();
if (!text) {
  console.log("no results (timed out)");
  process.exit(1);
}

const data = JSON.parse(text);
let failedTotal = 0;
const lines = [];
for (const [key, value] of Object.entries(data)) {
  if (["startedAt", "finishedAt", "host", "userAgent", "webgl2", "maxTextureSize", "maxRenderbufferSize", "gpu"].includes(key)) continue;
  if (/_error$/.test(key)) {
    failedTotal++;
    lines.push(`ERROR ${key}: ${String(value).split("\n").slice(0, 3).join(" | ")}`);
    continue;
  }
  if (value && typeof value === "object" && typeof value.passed === "number") {
    const v = value;
    failedTotal += v.failed ?? 0;
    lines.push(`${v.failed ? "FAIL" : "ok  "} ${key}: ${v.passed} passed, ${v.failed} failed`);
    for (const d of v.details ?? []) if (/^FAIL/.test(d)) lines.push(`       ${d.slice(0, 300)}`);
    continue;
  }
  if (value && typeof value === "object" && typeof value.passed === "boolean") {
    if (!value.passed) failedTotal++;
    lines.push(`${value.passed ? "ok  " : "FAIL"} ${key}`);
    if (!value.passed) {
      for (const p of value.problems ?? value.failures ?? []) lines.push(`       ${String(typeof p === "string" ? p : JSON.stringify(p)).slice(0, 300)}`);
      for (const d of value.details ?? []) if (/FAIL/.test(String(d))) lines.push(`       ${String(d).slice(0, 300)}`);
      if (!value.problems && !value.failures && !value.details) lines.push(`       ${JSON.stringify(value).slice(0, 600)}`);
    }
    continue;
  }
  lines.push(`     ${key}: ${JSON.stringify(value).slice(0, 200)}`);
}
console.log(lines.join("\n"));
console.log(`\n${failedTotal ? `${failedTotal} failures` : "all passed"} in ${Math.round((Date.now() - started) / 1000)} s`);
process.exitCode = failedTotal ? 1 : 0;
