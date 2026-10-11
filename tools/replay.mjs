// Replays a host call the panel made (saved from the page, "LML.call(name, argsJson)") in the running
// EffectCraft and prints the full error stack when it fails. For diagnosing.
//
//   node tools/replay.mjs <saved call file> [--port 9877]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Control } from "../app/control.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [file] = process.argv.slice(2);
const portAt = process.argv.indexOf("--port");
const call = fs.readFileSync(file, "utf8");
const match = /LML\.call\("([^"]+)", ("(?:[^"\\]|\\.)*")\)\s*$/s.exec(call);
if (!match) throw new Error("not a saved LML.call");
const [, name, argsLiteral] = match;
const host = fs.readFileSync(path.join(root, "dist", "host", "lazymaplayers-effectcraft.jsx"), "utf8");
const code = [
  host,
  ";",
  "(function () {",
  "  try {",
  `    var value = LML.api[${JSON.stringify(name)}](LML.json.parse(${argsLiteral}));`,
  '    return "ok: " + LML.json.stringify(value).slice(0, 2000);',
  "  } catch (e) {",
  '    return "error: " + (e && e.message) + "\\n" + (e && e.stack);',
  "  }",
  "})()"
].join("\n");
const control = new Control(portAt >= 0 ? Number(process.argv[portAt + 1]) : 9877);
const reply = await control.runScript(code);
console.log(reply.ok ? reply.result : JSON.stringify(reply.error));
control.close();
