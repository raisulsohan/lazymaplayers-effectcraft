// Tries single expression features in EffectCraft, each in its own process, and prints what it gives.
//
//   node tools/probe-expressions.ts

import { runScript } from "./ec.ts";

const SETUP = `
var scene = app.project.items.addComp("Scene", 1920, 1080, 1, 5, 25);
var mapComp = app.project.items.addComp("Map", 1600, 900, 1, 5, 25);
var map = scene.layers.add(mapComp);
var z = map.property("ADBE Effect Parade").addProperty("ADBE Slider Control"); z.name = "Zoom"; z.property(1).setValue(6);
map.property("ADBE Transform Group").property("ADBE Scale").setValue([50, 50]);
var probe = scene.layers.addNull();
var lc = probe.property("ADBE Effect Parade").addProperty("ADBE Layer Control"); lc.name = "Map"; lc.property(1).setValue(map.index);
var pos = probe.property("ADBE Transform Group").property("ADBE Position");
`;

const positionTests = [
  'var m = effect("Map")(1); [m.index, 0]',
  'var m = effect("Map")(1); [m.width, m.height]',
  'var m = effect("Map")(1); [typeof m.source == "object" ? 1 : 0, 0]',
  'var m = effect("Map")(1); [m.source.width, m.source.height]',
  'var m = effect("Map")(1); [m.source.duration, 0]',
  'var m = effect("Map")(1); [m.transform.scale[0], m.transform.scale[1]]',
  'var m = effect("Map")(1); [m.scale[0], 0]',
  'var m = effect("Map")(1); m.toComp([0, 0])',
  'var m = effect("Map")(1); m.toComp([1600, 900])',
  'var m = effect("Map")(1); [m.effect("Zoom")(1).value, 0]',
  'var m = effect("Map")(1); [m.effect("Zoom")(1), 0]',
  "fromComp([10, 20])",
  "[thisComp.width, thisComp.height]",
  "[time, 0]",
  'var e; try { throw new Error("x"); } catch (err) { e = 5; } [e, 1]',
  'var e = 1; try { e = effect("Nope")(1).value; } catch (err) { e = 7; } [e, 1]',
  "var o = (function () { return { a: 3 }; })(); [o.a, 7]",
  "[value[0], value.length]",
  "[Math.round(2.5), Math.atan2(1, 1)]",
  "[[1, 2, 3].length, 0]",
  'var x = 0; if (true) x = 4; else x = 2; [x, 0]',
  "var a = 1, b = 2; a > b ? [a, a] : [b, b]",
  "function f(n) { return n * 2; } [f(4), 0]",
  "[parent ? 1 : 0, 0]",
  "[hasParent ? 1 : 0, 0]",
  "var p = 0; for (var i = 0; i < 5; i++) p += i; [p, 0]"
];

function probe(expr: string) {
  const code = `${SETUP}
pos.expression = ${JSON.stringify(expr)};
writeLn("=> " + pos.valueAtTime(1, false) + "  err[" + pos.expressionError + "]");`;
  const r = runScript(code, { timeout: 20000 });
  const line = r.timedOut ? "TIMED OUT" : (r.out.match(/=> .*/)?.[0] ?? `failed: ${(r.err || r.out).trim().slice(0, 200)}`);
  console.log(`${expr}\n    ${line}`);
}

for (const t of positionTests) probe(t);

// Paths and text.
const extra: [string, string][] = [
  [
    "createPath",
    `var shape = scene.layers.addShape(); var g = shape.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group"); var path = g.property("ADBE Vector Shape");
path.expression = 'createPath([[0,0],[100,0],[100,50]], [], [], true)';
var v = path.valueAtTime(0, false); writeLn("=> " + (v && v.vertices ? v.vertices.toString() + " closed " + v.closed : String(v)) + " err[" + path.expressionError + "]");`
  ],
  [
    "source text",
    `var txt = scene.layers.addText("x"); var st = txt.property("ADBE Text Properties").property("ADBE Text Document");
st.expression = '"Hello " + Math.round(3.6) + " km"'; var tv = st.valueAtTime(0, false); writeLn("=> " + (tv && tv.text !== undefined ? tv.text : String(tv)) + " err[" + st.expressionError + "]");`
  ],
  [
    "parent.effect",
    `var child = scene.layers.addNull(); child.parent = probe; var cp = child.property("ADBE Transform Group").property("ADBE Position");
cp.expression = 'var m = parent.effect("Map")(1); [m.index, 1]'; writeLn("=> " + cp.valueAtTime(0, false) + " err[" + cp.expressionError + "]");`
  ]
];
for (const [name, body] of extra) {
  const r = runScript(SETUP + body, { timeout: 20000 });
  console.log(`${name}\n    ${r.timedOut ? "TIMED OUT" : (r.out.match(/=> .*/)?.[0] ?? `failed: ${(r.err || r.out).trim().slice(0, 300)}`)}`);
}
