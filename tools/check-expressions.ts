// Every kind of expression LazyMapLayers generates, run in EffectCraft on real layers and compared
// with the result After Effects' maths gives (LazyMapLayers' tools/expression-env.js, run in Node).
//
//   node tools/check-expressions.ts [--per-kind N] [--only TEXT] [--raw]
//
// --raw runs the expressions as LazyMapLayers writes them, without this version's rewrite, to show
// which ones EffectCraft cannot run on its own.
//
// Each case gets its own scene comp of the case's size with a map precomp layer whose scale and
// position give a known toComp, the map's controls as sliders, and a layer carrying the expression on
// an effect control of the right kind (slider, 2D or 3D point), a shape path or a source text. That
// layer sits at [7, -3] with its anchor at [0, 0], so its fromComp is the fake's [x - 7, y + 3].

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hostSource, LML_ROOT, runScript } from "./ec.ts";

const core = (p: string) => import(pathToFileURL(path.join(LML_ROOT, "src", "core", p)).href);
const { cameraRigExpressions, groundFrameFor, pin3dPositionExpression } = await core("ae/cameraRig.ts");
const { followExpressions } = await core("ae/followExpressions.ts");
const { anchoredPositionExpression, curvedLabelPathExpression, leaderPathExpression, routePathExpression, streetLabelExpressions, travellerExpressions } = await core("ae/labelExpressions.ts");
const { float32, pinExpressions } = await core("ae/pinExpressions.ts");
const { lodPathExpression, shapePathExpressions, shapeRings } = await core("ae/shapeExpressions.ts");
const { minimapBoxExpression, northRotationExpression, scaleBarPathExpression, scaleBarTextExpression } = await core("ae/mapFurniture.ts");
const { arrowRigExpressions } = await core("ae/arrowRig.ts");
const { greatCircle } = await core("geo/greatCircle.ts");
const { chartTimeRemapExpression, growingLineExpression, lineHeadExpression, lineLabelExpression, lineValueExpression } = await core("ae/chartExpressions.ts");

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PER_KIND = Number(opt("--per-kind") ?? 6);
const ONLY = opt("--only");
const RAW = argv.includes("--raw");

type View = { center: { lat: number; lng: number }; zoom: number; bearing: number; pitch: number };
type MapEnv = { width: number; height: number; scale: number; position: [number, number]; controls: Record<string, number>; toComp: number[] };
type Env = { own: Record<string, number | "MAP">; parentOwn?: Record<string, number | "MAP">; map: MapEnv; comp: { width: number; height: number }; value: unknown; time?: number };
type Case = { name: string; code: string; env: Env; expected: (number | string)[]; tolerance: number };

const envSource = fs.readFileSync(path.join(LML_ROOT, "tools", "expression-env.js"), "utf8");
const fake = new Function(`${envSource}\nreturn { run: lmlRunExpression, flatten: lmlFlatten };`)() as {
  run: (code: string, env: Env) => unknown;
  flatten: (result: unknown) => (number | string)[];
};

let seed = 20261011;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const cases: Case[] = [];
function add(name: string, code: string, env: Env, tolerance = 1e-6) {
  if (ONLY && !name.includes(ONLY)) return;
  const expected = fake.flatten(fake.run(code, env));
  if (expected.some((v) => typeof v === "number" && !Number.isFinite(v))) return;
  cases.push({ name, code, env, expected, tolerance });
}

function randomView(globe: boolean): View {
  return {
    center: { lat: float32(random() * 150 - 75), lng: float32(random() * 360 - 180) },
    zoom: float32(globe ? random() * 9 : random() * 17),
    bearing: float32(random() * 360 - 180),
    pitch: float32(random() * 70)
  };
}

/** A map layer with a known scale and position: toComp(p) = position + scale * (p - centre). */
function mapFor(view: View, globe: boolean, extra: Record<string, number> = {}, size?: { width: number; height: number }): MapEnv {
  const hd = random() < 0.5;
  const width = size?.width ?? (hd ? 1920 : 3840);
  const height = size?.height ?? (hd ? 1080 : 2160);
  const controls: Record<string, number> = { Latitude: view.center.lat, Longitude: view.center.lng, Zoom: view.zoom, Bearing: view.bearing, Pitch: view.pitch, ...extra };
  if (globe) controls.Globe = 1;
  const scale = random() < 0.5 ? 1 : Math.round((0.5 + random()) * 1000) / 1000;
  const position: [number, number] = random() < 0.5 ? [width / 2, height / 2] : [Math.round(width * (0.3 + 0.4 * random())), Math.round(height * (0.3 + 0.4 * random()))];
  return { width, height, scale, position, controls, toComp: [scale, 0, position[0] - (scale * width) / 2, 0, scale, position[1] - (scale * height) / 2] };
}

const near = (view: View, spread: number) => ({
  lat: Math.max(-80, Math.min(80, view.center.lat + (random() - 0.5) * spread)),
  lng: view.center.lng + (random() - 0.5) * spread
});

for (const globe of [false, true]) {
  const kind = globe ? "globe" : "mercator";
  for (let i = 0; i < PER_KIND; i++) {
    const view = randomView(globe);
    const map = mapFor(view, globe);
    const comp = { width: map.width, height: map.height };
    const spread = 40 / 2 ** Math.max(0, view.zoom - 1);
    const pin = near(view, spread);
    const own = { Map: "MAP" as const, Latitude: float32(i % 6 === 5 ? pin.lat + 0.5 : pin.lat), Longitude: float32(pin.lng), "Scale with Map": i % 2, "Rotate with Map": (i >> 1) % 2, "Reference Zoom": Math.floor(random() * 12) };
    const e = pinExpressions(pin.lat, pin.lng);
    add(`pin position ${kind} ${i}`, e.position, { own, map, comp, value: i % 3 === 0 ? [0, 0, -40] : [0, 0] });
    add(`pin scale ${kind} ${i}`, e.scale, { own, map, comp, value: i % 3 === 0 ? [100, 100, 100] : [100, 100] });
    add(`pin rotation ${kind} ${i}`, e.rotation, { own, map, comp, value: 5 });
    add(`pin opacity ${kind} ${i}`, e.opacity, { own, map, comp, value: 80 });
    const offset = Math.round((random() - 0.5) * 8 * 2) / 2;
    const follow = followExpressions({ zoomOffset: offset, bearing: true, pitch: true });
    for (const [control, code] of Object.entries(follow)) add(`follow ${control} ${kind} ${i}`, code as string, { own: { Follows: "MAP", "Follow Zoom Offset": offset }, map, comp, value: 0 });
    const units = i % 2 ? "imperial" : "metric";
    const barLength = 120 + i * 9;
    add(`scale bar path ${kind} ${i}`, scaleBarPathExpression(barLength, units, 8), { own: { Map: "MAP" }, map, comp, value: null });
    add(`scale bar text ${kind} ${i}`, scaleBarTextExpression(barLength, units), { own: { Map: "MAP" }, map, comp, value: "" }, 0);
    add(`north arrow ${kind} ${i}`, northRotationExpression(), { own: { Map: "MAP" }, map, comp, value: 0 }, 1e-5);
    add(`minimap box ${kind} ${i}`, minimapBoxExpression(), { own: { Map: "MAP", "Main map": "MAP" }, map, comp, value: null });
    const label = near(view, spread);
    add(`label ${kind} ${i}`, anchoredPositionExpression(label.lat, label.lng, (random() - 0.5) * 80, -30 * random()), { own: { Map: "MAP" }, map, comp, value: [0, 0] });
    add(`leader ${kind} ${i}`, leaderPathExpression(label.lat, label.lng, 40, -60, i % 2 ? 120 : -120), { own: { Map: "MAP" }, map, comp, value: null });
    const street = streetLabelExpressions(label.lat, label.lng, { lat: label.lat - spread * 0.01 * (random() - 0.5), lng: label.lng - spread * 0.01 }, { lat: label.lat + spread * 0.01 * (random() - 0.5), lng: label.lng + spread * 0.01 * (i % 2 ? 1 : -1) }, 6 + random() * 4);
    add(`street position ${kind} ${i}`, street.position, { own: { Map: "MAP" }, map, comp, value: [0, 0] });
    add(`street rotation ${kind} ${i}`, street.rotation, { own: { Map: "MAP" }, map, comp, value: 0 }, 1e-5);
    const bowPoints: number[][] = [];
    const bend = (random() - 0.5) * 0.6;
    const way = i % 2 ? 1 : -1;
    for (let k = -8; k <= 8; k++) bowPoints.push([label.lat + spread * 0.004 * (bend * (1 - (k * k) / 64) + (random() - 0.5) * 0.05), label.lng + way * spread * 0.001 * k]);
    add(`curved name ${kind} ${i}`, curvedLabelPathExpression({ points: bowPoints, mid: 8 }, { lat: bowPoints[6][0], lng: bowPoints[6][1] }, { lat: bowPoints[10][0], lng: bowPoints[10][1] }, 4 + random() * 6, 0, 20 + random() * 200), { own: { Map: "MAP" }, map, comp, value: null }, 1e-4);
    const a = near(view, spread * 4);
    const b = near(view, spread * 4);
    const route = greatCircle({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }, 24, globe ? 400000 : 0).map((p: { lat: number; lng: number; altitude: number }) => [p.lat, p.lng, p.altitude]);
    add(`route ${kind} ${i}`, routePathExpression(route), { own: { Map: "MAP" }, map, comp, value: null });
    const traveller = travellerExpressions(route);
    const travellerOwn = { Map: "MAP" as const, Progress: float32(random() * 100), "Rotate along Route": i % 2 };
    add(`traveller position ${kind} ${i}`, traveller.position, { own: travellerOwn, map, comp, value: [0, 0] });
    add(`traveller rotation ${kind} ${i}`, traveller.rotation, { own: travellerOwn, map, comp, value: 10 }, 1e-5);
    add(`traveller opacity ${kind} ${i}`, traveller.opacity, { own: travellerOwn, map, comp, value: 90 });
    const arrow = arrowRigExpressions(route, map.height / 1080);
    const arrowProgress = float32(random() * 100);
    const arrowOwn = {
      Map: "MAP" as const,
      Progress: arrowProgress,
      Tail: float32(random() * arrowProgress),
      Width: float32(2 + random() * 20),
      "Tail Width": 35,
      "Taper Length": 100,
      "Head Size": float32(50 + random() * 100),
      "Head Style": 1 + (i % 3),
      "Both Ends": (i >> 1) % 2,
      Dash: i % 2 ? 12 : 0,
      Gap: 8,
      "Dash Speed": 30,
      "Outline Width": i % 2 ? 3 : 0
    };
    const arrowScalars: (keyof typeof arrow)[] = ["trimStart", "trimEnd", "headRotation", "tailRotation", "fillOpacity", "chevronOpacity", "lineWidth", "outlineWidth", "headOutlineWidth", "outlineOpacity", "taperStartWidth", "taperStartLength", "dash", "gap", "dashOffset"];
    add(`arrow path ${kind} ${i}`, arrow.path, { own: arrowOwn, map, comp, value: null });
    add(`arrow head shape ${kind} ${i}`, arrow.headPath, { own: arrowOwn, map, comp, value: null });
    add(`arrow head position ${kind} ${i}`, arrow.headPosition, { own: arrowOwn, map, comp, value: [0, 0] });
    add(`arrow tail position ${kind} ${i}`, arrow.tailPosition, { own: arrowOwn, map, comp, value: [0, 0] });
    add(`arrow head opacity ${kind} ${i}`, arrow.headOpacity, { own: arrowOwn, map, comp, value: 100 });
    add(`arrow tail opacity ${kind} ${i}`, arrow.tailOpacity, { own: arrowOwn, map, comp, value: 100 });
    for (const which of arrowScalars) add(`arrow ${which} ${kind} ${i}`, arrow[which], { own: arrowOwn, map, comp, value: 0, time: 1.5 }, 1e-5);
    const centre = near(view, spread);
    const radius = spread / 4;
    const circle = (r: number) => Array.from({ length: 24 }, (_, k) => [centre.lng + r * Math.cos((k / 24) * 2 * Math.PI), centre.lat + r * Math.sin((k / 24) * 2 * Math.PI)]);
    const lifted = i % 3 === 0;
    const shapeMap = mapFor(view, globe, { "Terrain Height": lifted ? 1.4 : 0, "Ground Level": 500 });
    const outline: string[] = shapePathExpressions(shapeRings([[[...circle(radius), [centre.lng + radius, centre.lat]], circle(radius / 3)]], () => (lifted ? 1500 : 0)));
    outline.forEach((code, part) => add(`shape ring ${part} ${kind} ${i}`, code, { own: { Map: "MAP" }, map: shapeMap, comp: { width: shapeMap.width, height: shapeMap.height }, value: null }));
    const coarse = shapeRings([[[...circle(radius), [centre.lng + radius, centre.lat]]]], () => 0)[0];
    const fine = shapeRings([[[...circle(radius * 0.99), [centre.lng + radius * 0.99, centre.lat]]]], () => 0)[0];
    add(`shape levels ${kind} ${i}`, lodPathExpression(coarse, fine, view.zoom + (i % 2 ? 0.5 : -0.5)), { own: { Map: "MAP" }, map: shapeMap, comp: { width: shapeMap.width, height: shapeMap.height }, value: null });
  }
}

for (let i = 0; i < Math.max(2, PER_KIND / 2); i++) {
  const view = randomView(false);
  const terrain = { "Terrain Height": [0, 1, 1.5, 2.5][i % 4], "Ground Level": [0, 1200, 4300, -20][(i >> 2) % 4] };
  const map = mapFor(view, false, terrain);
  const comp = { width: map.width, height: map.height };
  const spread = 40 / 2 ** Math.max(0, view.zoom - 1);
  const pin = near(view, spread);
  const own = { Map: "MAP" as const, Latitude: float32(pin.lat), Longitude: float32(pin.lng), "Scale with Map": 1, "Rotate with Map": i % 2, "Reference Zoom": 8, "Elevation (m)": Math.round(random() * 8000) };
  const e = pinExpressions(pin.lat, pin.lng);
  add(`pin position on terrain ${i}`, e.position, { own, map, comp, value: [0, 0] });
  const label = near(view, spread);
  add(`label on terrain ${i}`, anchoredPositionExpression(label.lat, label.lng, 12, -30, undefined, random() * 5000), { own: { Map: "MAP" }, map, comp, value: [0, 0] });
  add(`leader on terrain ${i}`, leaderPathExpression(label.lat, label.lng, 40, -60, 120, random() * 5000), { own: { Map: "MAP" }, map, comp, value: null });
}

for (let i = 0; i < PER_KIND; i++) {
  const view = randomView(false);
  const scene = random() < 0.5 ? { width: 1920, height: 1080 } : { width: 3840, height: 2160 };
  const frame = groundFrameFor({ ...view, zoom: view.zoom + (random() - 0.5) * 4 }, scene);
  const map = mapFor(view, false, { "3D Origin Latitude": frame.origin.lat, "3D Origin Longitude": frame.origin.lng, "3D Reference Zoom": frame.referenceZoom }, scene);
  const rig = cameraRigExpressions();
  add(`rig target position ${i}`, rig.targetPosition, { own: { Map: "MAP" }, map, comp: scene, value: [0, 0, 0] });
  add(`rig target rotation ${i}`, rig.targetRotationZ, { own: { Map: "MAP" }, map, comp: scene, value: 0 });
  add(`rig camera position ${i}`, rig.cameraPosition, { own: {}, parentOwn: { Map: "MAP" }, map, comp: scene, value: [0, 0, 0] });
  add(`rig camera tilt ${i}`, rig.cameraRotationX, { own: {}, parentOwn: { Map: "MAP" }, map, comp: scene, value: 0 });
  add(`rig camera zoom ${i}`, rig.cameraZoom, { own: {}, parentOwn: { Map: "MAP" }, map, comp: scene, value: 0 });
  const pin = near(view, 20 / 2 ** Math.max(0, view.zoom - 1));
  add(`3D pin ${i}`, pin3dPositionExpression(pin.lat, pin.lng), { own: { Map: "MAP", Latitude: float32(pin.lat), Longitude: float32(pin.lng), "Altitude (m)": Math.round(random() * 500) }, map, comp: scene, value: [0, 0, 0] });
}

for (let i = 0; i < PER_KIND; i++) {
  const times = i % 3 === 0 ? [2000, 2010, 2020] : [1990, 1995, 2003, 2011, 2019, 2024];
  const points = times.map((_, k) => [40 + k * 60 + random() * 10, 300 - random() * 250] as [number, number]);
  const values = times.map(() => (i % 4 === 0 ? random() * 5 : random() * 2e6));
  const duration = 4 + (i % 5);
  const time = Math.round(random() * duration * 25) / 25;
  const chartMap: MapEnv = { width: 1920, height: 1080, scale: 1, position: [960, 540], controls: { "Data Time": times[0] - 3 + random() * (times[times.length - 1] - times[0] + 6) }, toComp: [1, 0, 0, 0, 1, 0] };
  const comp = { width: 800, height: 400 };
  const own = { Map: "MAP" as const };
  add(`chart line ${i}`, growingLineExpression(points, times, duration, i % 2 ? { baseline: 320 } : null), { own, map: chartMap, comp, value: null, time });
  add(`chart head ${i}`, lineHeadExpression(points, times, duration), { own, map: chartMap, comp, value: [0, 0], time });
  add(`chart value ${i}`, lineValueExpression(values, times, duration), { own, map: chartMap, comp, value: "", time }, 0);
  add(`chart time ${i}`, chartTimeRemapExpression(times, duration - 0.04), { own, map: chartMap, comp, value: 0, time });
}

// In EffectCraft: one scene per case, the expression applied the way the host applies it.
const RUNNER = `
function lmlBuildCase(c, raw) {
  var env = c.env;
  var scene = app.project.items.addComp("Case", env.comp.width, env.comp.height, 1, 20, 25);
  var mapComp = app.project.items.addComp("Case map", env.map.width, env.map.height, 1, 20, 25);
  var map = scene.layers.add(mapComp);
  var mt = map.property("ADBE Transform Group");
  mt.property("ADBE Scale").setValue([env.map.scale * 100, env.map.scale * 100]);
  mt.property("ADBE Position").setValue(env.map.position);
  for (var k in env.map.controls) {
    var fx = map.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
    fx.name = k; fx.property(1).setValue(env.map.controls[k]);
  }
  function effects(layer, own) {
    for (var name in own) {
      var e;
      if (own[name] === "MAP") { e = layer.property("ADBE Effect Parade").addProperty("ADBE Layer Control"); e.name = name; e.property(1).setValue(map.index); }
      else { e = layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control"); e.name = name; e.property(1).setValue(own[name]); }
    }
  }
  var v = env.value, layer, prop;
  if (typeof v === "string") {
    layer = scene.layers.addText("x");
    prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
  } else if (v === null) {
    layer = scene.layers.addShape();
    var g = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
    prop = g.property("ADBE Vector Shape");
  } else {
    layer = scene.layers.addShape();
  }
  var t = layer.property("ADBE Transform Group");
  t.property("ADBE Anchor Point").setValue([0, 0]);
  t.property("ADBE Position").setValue([7, -3]);
  effects(layer, env.own);
  if (env.parentOwn) {
    var par = scene.layers.addNull();
    effects(par, env.parentOwn);
    layer.parent = par;
  }
  if (!prop) {
    var kind = typeof v === "number" ? "ADBE Slider Control" : (v.length > 2 ? "ADBE Point3D Control" : "ADBE Point Control");
    var holder = layer.property("ADBE Effect Parade").addProperty(kind);
    prop = holder.property(1);
    prop.setValue(v);
  }
  var errors = [];
  var code = raw ? c.code : LMLEC.rewriteExpression(c.code);
  prop.expression = code;
  return prop;
}
function lmlFlat(r, out) {
  if (r === null || r === undefined) out.push("null");
  else if (typeof r === "number") out.push(r);
  else if (typeof r === "string") out.push("text:" + r);
  else if (typeof r === "boolean") out.push(r ? 1 : 0);
  else if (r instanceof Array || (typeof r === "object" && typeof r.length === "number" && r.vertices === undefined)) { out.push("["); for (var i = 0; i < r.length; i++) lmlFlat(r[i], out); out.push("]"); }
  else if (r.vertices !== undefined) { out.push("path"); lmlFlat(r.vertices, out); out.push(r.closed ? 1 : 0); }
  else if (r.text !== undefined) out.push("text:" + r.text);
  else out.push("?" + String(r));
  return out;
}
`;

function same(a: number | string, b: number | string, tolerance: number): boolean {
  if (typeof a !== typeof b) return false;
  if (typeof a !== "number" || typeof b !== "number") return a === b;
  if (tolerance === 0) return a === b || Math.abs(a - b) < 1e-9;
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));
}

const BATCH = 40;
const host = hostSource();
let passed = 0;
const failures: string[] = [];
const byKind = new Map<string, { pass: number; fail: number }>();
const kindOf = (name: string) => name.replace(/ \d+$/, "").replace(/ (mercator|globe)$/, "");

for (let start = 0; start < cases.length; start += BATCH) {
  const batch = cases.slice(start, start + BATCH);
  const code = `${host}
${RUNNER}
var LML_CASES = ${JSON.stringify(batch.map((c) => ({ code: c.code, env: c.env })))};
for (var ci = 0; ci < LML_CASES.length; ci++) {
  var line;
  try {
    var prop = lmlBuildCase(LML_CASES[ci], ${RAW});
    var c = LML_CASES[ci];
    var r = prop.valueAtTime(c.env.time || 0, false);
    line = { ok: true, result: lmlFlat(r, []), error: String(prop.expressionError || "") };
  } catch (e) {
    line = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  writeLn("CASE " + ci + " " + JSON.stringify(line));
}`;
  const r = runScript(code, { timeout: 300000 });
  const lines = new Map<number, { ok: boolean; result?: (number | string)[]; error: string }>();
  for (const m of r.out.matchAll(/^CASE (\d+) (.*)$/gm)) lines.set(Number(m[1]), JSON.parse(m[2]));
  batch.forEach((c, i) => {
    const got = lines.get(i);
    let problem = "";
    if (!got) problem = r.timedOut ? "batch timed out" : `no result (${(r.err || "").trim().slice(0, 200)})`;
    else if (!got.ok) problem = `script error: ${got.error}`;
    else if (got.error) problem = `expression error: ${got.error}`;
    else if (got.result!.length !== c.expected.length || got.result!.some((v, k) => !same(v, c.expected[k], c.tolerance))) {
      const k = got.result!.findIndex((v, k2) => !same(v, c.expected[k2], c.tolerance));
      problem = `differs at ${k}: got ${JSON.stringify(got.result!.slice(Math.max(0, k - 2), k + 4))} expected ${JSON.stringify(c.expected.slice(Math.max(0, k - 2), k + 4))} (lengths ${got.result!.length}/${c.expected.length})`;
    }
    const tally = byKind.get(kindOf(c.name)) ?? { pass: 0, fail: 0 };
    if (problem) {
      tally.fail++;
      failures.push(`FAIL ${c.name}: ${problem}`);
    } else {
      tally.pass++;
      passed++;
    }
    byKind.set(kindOf(c.name), tally);
  });
  process.stdout.write(`\r${Math.min(start + BATCH, cases.length)}/${cases.length} cases run`);
}
console.log("\n");
for (const [kind, t] of [...byKind].sort()) console.log(`${t.fail ? "FAIL" : "ok  "} ${kind.padEnd(28)} ${t.pass}/${t.pass + t.fail}`);
console.log(`\n${passed}/${cases.length} expressions give After Effects' result in EffectCraft${RAW ? " (raw, no rewrite)" : ""}`);
if (failures.length) {
  console.log("");
  for (const f of failures.slice(0, 40)) console.log(f);
  if (failures.length > 40) console.log(`… and ${failures.length - 40} more`);
}
process.exitCode = failures.length ? 1 : 0;
