// Prints what LazyMapLayers made in the project open in EffectCraft: every comp with its layers and
// their LML tags, effects and expression state. Needs EffectCraft started with --control.
//
//   node tools/inspect.mjs [--port 9877] [--frame comp time out.png]

import { Control } from "../app/control.mjs";

const argv = process.argv.slice(2);
const portAt = argv.indexOf("--port");
const control = new Control(portAt >= 0 ? Number(argv[portAt + 1]) : 9877);

const code = `(function () {
  var out = [];
  for (var i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof CompItem)) { out.push("item " + item.name + (item instanceof FootageItem ? " (footage)" : "")); continue; }
    out.push("comp " + item.name + "  " + item.width + "x" + item.height + "  " + item.duration + " s  " + item.numLayers + " layers  tag " + String(item.comment).slice(0, 50));
    for (var l = 1; l <= item.numLayers; l++) {
      var layer = item.layer(l);
      var fx = [];
      var effects = layer.property("ADBE Effect Parade");
      if (effects) for (var e = 1; e <= effects.numProperties; e++) fx.push(effects.property(e).name);
      var tag = String(layer.comment);
      out.push("  " + l + ". " + layer.name + "  [" + tag.slice(0, 60).replace(/\\n/g, " ") + "]" + (fx.length ? "  fx: " + fx.join(", ") : ""));
    }
  }
  return out.join("\\n");
})()`;

const reply = await control.runScript(code);
console.log(reply.ok ? reply.result : JSON.stringify(reply.error));
const frameAt = argv.indexOf("--frame");
if (frameAt >= 0) {
  const [comp, time, file] = argv.slice(frameAt + 1, frameAt + 4);
  console.log(JSON.stringify(await control.request("render.frame", { comp, time: Number(time), path: file })));
}
control.close();
