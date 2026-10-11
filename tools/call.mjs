// Calls one LazyMapLayers host function in the running EffectCraft, the way the panel does, and
// prints the reply (for diagnosing). Needs EffectCraft started with --control.
//
//   node tools/call.mjs <name> '<json args>' [--port 9877]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Control } from "../app/control.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [name, json = "{}"] = process.argv.slice(2);
const portAt = process.argv.indexOf("--port");
const control = new Control(portAt >= 0 ? Number(process.argv[portAt + 1]) : 9877);
const host = fs.readFileSync(path.join(root, "dist", "host", "lazymaplayers-effectcraft.jsx"), "utf8");
const reply = await control.runScript(`${host}\n;\nLML.call(${JSON.stringify(name)}, ${JSON.stringify(json)})`);
if (!reply.ok) console.log("script error:", JSON.stringify(reply.error));
else {
  const result = JSON.parse(reply.result);
  console.log(JSON.stringify(result, null, 1).slice(0, 4000));
}
control.close();
