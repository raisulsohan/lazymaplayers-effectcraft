# Issues reported to EffectCraft[#808](https://github.com/storytold/effectcraft/issues/808) |[#809](https://github.com/storytold/effectcraft/issues/809) |[#810](https://github.com/storytold/effectcraft/issues/810) |[#811](https://github.com/storytold/effectcraft/issues/811) |[#812](https://github.com/storytold/effectcraft/issues/812) |[#813](https://github.com/storytold/effectcraft/issues/813) |[#814](https://github.com/storytold/effectcraft/issues/814) |[#815](https://github.com/storytold/effectcraft/issues/815) |[#816](https://github.com/storytold/effectcraft/issues/816) |[#817](https://github.com/storytold/effectcraft/issues/817) |

Issues for [storytold/effectcraft](https://github.com/storytold/effectcraft), found
while porting LazyMapLayers (a map design and map animation panel for After Effects) to EffectCraft.
All ten were posted on 2026-10-11 (links in the table).

**First, thank you.** LazyMapLayers' host script is about 6,000 lines of After Effects scripting, and
it runs in EffectCraft with a compatibility layer of a few hundred lines. All 369 kinds of expression
LazyMapLayers generates (map projections, pins, routes, labels along paths, a 3D camera) give the same
results in EffectCraft as After Effects' maths, and nearly every one of LazyMapLayers' own test suites
passes. The issues below are the gaps that layer has to work around.

## How these were tested

- **EffectCraft 0.8.0, Windows x64**, the release's portable zip
  (`effectcraft-0.8.0-windows-x64-portable.zip`), `effectcraft-cli --version` = `effectcraft-cli 0.8.0`.
  `crates/script/src/prelude.js` is the same on `main` as at the `v0.8.0` tag (`f953cd2`) on 2026-10-11.
- Every repro below was re-run on 2026-10-11 with
  `effectcraft-cli script repro.jsx --empty` (headless). The "Actual" blocks are its output.
- Repros that read files need the file next to a project, because headless scripts may only read the
  project's folder: `effectcraft-cli script repro.jsx folder/project.ecproj`.
- Code links point at the `v0.8.0` tag.

## Already reported

None of these is reported yet (searched open and closed issues and pull requests on 2026-10-11 for
each API name and topic). Related, not duplicates:

- [#284](https://github.com/storytold/effectcraft/issues/284) (closed) keeps *Levels of Undo* at 99,
  as After Effects does. Issue 3 is about something else: an undo group should be one level however
  many commands it holds.
- [#84](https://github.com/storytold/effectcraft/pull/84) (merged) made text render with a PostScript
  name, and it does (checked below). Issue 9 is only about what the scripting API reports back.

## Issues

| # | Title | Issue |
|---|---|---|
| 1 | Scripting: `Layer.comment`, marker parameters and `sourcePointToComp` silently do nothing | [#808](https://github.com/storytold/effectcraft/issues/808) |
| 2 | Expressions: `layer.source` is undefined; a layer from a Layer Control has no `transform`; errors are not reported | [#809](https://github.com/storytold/effectcraft/issues/809) |
| 3 | Undo: an undo group with more commands than *Levels of Undo* is not one undo step | [#810](https://github.com/storytold/effectcraft/issues/810) |
| 4 | Scripting: every access returns a new object (`layer.containingComp === comp` is false) | [#811](https://github.com/storytold/effectcraft/issues/811) |
| 5 | Scripting: `app.executeCommand(16)` is not Undo (EffectCraft's own command numbers) | [#812](https://github.com/storytold/effectcraft/issues/812) |
| 6 | Scripting: replacing a layer's source, image sequences and proxies | [#813](https://github.com/storytold/effectcraft/issues/813) |
| 7 | Keyframes: `removeKey` gets slower with every key on the property (removing 1,000 keys takes 18 s) | [#814](https://github.com/storytold/effectcraft/issues/814) |
| 8 | Scripting: After Effects matchNames for stroke Dashes and text Path Options | [#815](https://github.com/storytold/effectcraft/issues/815) |
| 9 | Scripting: smaller gaps (`saveFrameToPng`, `layer.position`, `app.fonts`, `Folder.temp`, `$.getenv`, `File.rename`, `e.line`) | [#816](https://github.com/storytold/effectcraft/issues/816) |
| 10 | Scripting: `File` with `encoding = "BINARY"` turns byte 0x89 into U+FFFD | [#817](https://github.com/storytold/effectcraft/issues/817) |

---

## 1. Scripting: `Layer.comment`, marker parameters and `sourcePointToComp` silently do nothing

Posted as [#808](https://github.com/storytold/effectcraft/issues/808).

**What happens.** Three calls succeed without an error and change nothing:

- `layer.comment = "..."` is ignored. `Layer` has a `comment` getter and no setter
  ([prelude.js#L1052](https://github.com/storytold/effectcraft/blob/f953cd2855bf36beffa6a4d608e9bf4b226e9442/crates/script/src/prelude.js#L1052)),
  although the engine command `layer.setComment` exists and `Item.comment` has a setter.
- `MarkerValue.setParameters(...)` is dropped unless the marker also has a `cuePointName`: the
  `cuePoint` (which carries the parameters) is only sent when there is a name
  ([prelude.js#L952](https://github.com/storytold/effectcraft/blob/f953cd2855bf36beffa6a4d608e9bf4b226e9442/crates/script/src/prelude.js#L952)).
- `Layer.sourcePointToComp` and `compPointToSource` are `function (p) { return p; }`
  ([prelude.js#L1179](https://github.com/storytold/effectcraft/blob/f953cd2855bf36beffa6a4d608e9bf4b226e9442/crates/script/src/prelude.js#L1179)).

**What After Effects does.** Sets the layer comment; keeps a marker's parameters with or without a cue
point name; converts between the layer's source and comp coordinates with the layer's transform (and
its parents').

**Repro.**

```js
var comp = app.project.items.addComp("Repro", 1920, 1080, 1, 10, 25);
var layer = comp.layers.addSolid([1, 0, 0], "S", 200, 100, 1);
layer.comment = "hello";
writeLn("comment: " + JSON.stringify(layer.comment));

var markers = layer.property("ADBE Marker");
var plain = new MarkerValue("shot 1");
plain.setParameters({ lml: "shot", index: "1" });
markers.setValueAtTime(1, plain);
var named = new MarkerValue("shot 2");
named.cuePointName = "cue";
named.setParameters({ lml: "shot", index: "2" });
markers.setValueAtTime(2, named);
writeLn("no cue point name: " + JSON.stringify(markers.keyValue(1).getParameters()));
writeLn("with cue point name: " + JSON.stringify(markers.keyValue(2).getParameters()));

layer.transform.position.setValue([400, 300]);
layer.transform.scale.setValue([50, 50]);
writeLn("sourcePointToComp([0, 0]) = " + layer.sourcePointToComp([0, 0]));
writeLn("compPointToSource([400, 300]) = " + layer.compPointToSource([400, 300]));
```

**Expected (After Effects).**

```
comment: "hello"
no cue point name: {"lml":"shot","index":"1"}
with cue point name: {"lml":"shot","index":"2"}
sourcePointToComp([0, 0]) = 350,275
compPointToSource([400, 300]) = 100,50
```

**Actual (EffectCraft 0.8.0).**

```
comment: ""
no cue point name: {}
with cue point name: {"lml":"shot","index":"2"}
sourcePointToComp([0, 0]) = 0,0
compPointToSource([400, 300]) = 400,300
```

**How LazyMapLayers works around it** (`host/compat.jsx`): adds a `comment` setter that calls
`layer.setComment`; replaces `MarkerProperty.setValueAtTime` so that a marker with parameters and no
name goes in as a cue point with an empty name; implements both point conversions from the layer's
anchor point, position, scale and rotation and its parents' at the comp's current time (2D only).

---

## 2. Expressions: `layer.source` is undefined; a layer from a Layer Control has no `transform`; errors are not reported

Posted as [#809](https://github.com/storytold/effectcraft/issues/809).

**What happens.** In expressions:

- `layer.source` is `undefined` for every layer (a solid, a precomp layer), so `layer.source.width`
  and `.height` throw. `layer.width` and `layer.height` work.
- A layer reached through a Layer Control, `effect("Map")(1)`, has no working `transform`:
  `effect("Map")(1).transform` throws `TypeError: not a callable function`. `effect("Map")(1).scale`
  works, and `thisComp.layer("Solid").transform.scale` works.
- The same layer's `name` is `"Layer"` instead of the layer's name.
- A failing expression silently keeps the property's own value and `expressionError` stays `""`,
  even for `throw new Error("boom")`. So nothing in the UI or in scripts shows that the expression
  failed.

**What After Effects does.** `source` is the layer's source item (a `Comp` or `Footage` object with
`width`, `height`, `duration`...); a layer from a Layer Control is a full layer with `transform` and
its own `name`; a failing expression shows its error (the warning banner) and `expressionError`
holds the message.

**Repro.** Each case puts the result, or the error, into a text layer's Source Text:

```js
var comp = app.project.items.addComp("Repro", 1920, 1080, 1, 10, 25);
var solid = comp.layers.addSolid([0, 0, 1], "Solid", 200, 100, 1);
var txt = comp.layers.addText("x");
var ctrl = txt.property("ADBE Effect Parade").addProperty("ADBE Layer Control");
ctrl.name = "Map";
ctrl.property(1).setValue(solid.index);
var st = txt.property("ADBE Text Properties").property("ADBE Text Document");
var cases = [
  'thisComp.layer("Solid").source',
  'thisComp.layer("Solid").source.width',
  'thisComp.layer("Solid").name',
  'effect("Map")(1).name',
  'thisComp.layer("Solid").transform.scale',
  'effect("Map")(1).transform.scale',
  'effect("Map")(1).scale'
];
for (var i = 0; i < cases.length; i++) {
  st.expression = 'try { var r = ' + cases[i] + '; "ok: " + r; } catch (e) { "threw: " + e; }';
  writeLn(cases[i] + "  ->  " + st.valueAtTime(0, false).text);
}

var rot = comp.layers.addNull().transform.rotation;
rot.setValue(7);
rot.expression = 'throw new Error("boom")';
writeLn("failing expression: value " + rot.valueAtTime(0, false) + ", expressionError " + JSON.stringify(rot.expressionError));
```

**Expected (After Effects).**

```
thisComp.layer("Solid").source  ->  ok: (the solid's Footage object)
thisComp.layer("Solid").source.width  ->  ok: 200
thisComp.layer("Solid").name  ->  ok: Solid
effect("Map")(1).name  ->  ok: Solid
thisComp.layer("Solid").transform.scale  ->  ok: 100,100
effect("Map")(1).transform.scale  ->  ok: 100,100
effect("Map")(1).scale  ->  ok: 100,100
failing expression: value 7, expressionError "Error: boom" (and the expression is flagged)
```

**Actual (EffectCraft 0.8.0).**

```
thisComp.layer("Solid").source  ->  ok: undefined
thisComp.layer("Solid").source.width  ->  threw: TypeError: cannot convert 'null' or 'undefined' to object
thisComp.layer("Solid").name  ->  ok: Solid
effect("Map")(1).name  ->  ok: Layer
thisComp.layer("Solid").transform.scale  ->  ok: 100,100
effect("Map")(1).transform.scale  ->  threw: TypeError: not a callable function
effect("Map")(1).scale  ->  ok: 100,100
failing expression: value 7, expressionError ""
```

**How LazyMapLayers works around it** (`host/compat.jsx`, `rewriteExpression`, applied by
`host/compat-post.jsx` to the expressions LazyMapLayers writes, never to the user's own): rewrites
`.source.width` / `.source.height` to `.width` / `.height` (which are the source's size for a precomp
layer) and `.transform.scale` to `.scale`. Because errors are silent, every generated expression was
checked against After Effects' maths on real EffectCraft layers (`tools/check-expressions.ts`).

---

## 3. Undo: an undo group with more commands than *Levels of Undo* is not one undo step

Posted as [#810](https://github.com/storytold/effectcraft/issues/810).

**What happens.** With *Settings ▸ General ▸ Levels of Undo* at 32 (the default), a script's undo
group of 40 commands does not become one undo step: one Undo removes only the last command. Each
command seems to take one level of the undo history even inside a group, so a group larger than the
history cannot be undone as a whole. With 20 commands it works.

**What After Effects does.** An undo group is one entry in the undo history, whatever it holds; one
Undo reverts all of it. *Levels of Undo* counts those entries.

**Repro.** (`setValuesAtTimes` with N keys is N commands.)

```js
function run(n) {
  var comp = app.project.items.addComp("Undo " + n, 1920, 1080, 1, 10, 25);
  var prop = comp.layers.addNull().transform.rotation;
  var times = [], values = [];
  for (var i = 0; i < n; i++) { times.push(i / 25); values.push(i); }
  app.beginUndoGroup("Add " + n + " keys");
  prop.setValuesAtTimes(times, values);
  app.endUndoGroup();
  writeLn(n + " keys added: numKeys = " + prop.numKeys);
  app.executeCommand(app.findMenuCommandId("Undo"));
  writeLn("after one Undo: numKeys = " + prop.numKeys);
}
run(20);
run(40);
```

**Expected (After Effects).**

```
20 keys added: numKeys = 20
after one Undo: numKeys = 0
40 keys added: numKeys = 40
after one Undo: numKeys = 0
```

**Actual (EffectCraft 0.8.0).**

```
20 keys added: numKeys = 20
after one Undo: numKeys = 0
40 keys added: numKeys = 40
after one Undo: numKeys = 39
```

**How LazyMapLayers works around it.** It cannot: a map with many labels, a flight or a shot list
is more than 32 commands. The README tells users to raise *Levels of Undo* to 99, which helps up to
98 commands. Small actions (a map, a pin, a view key) are one undo step as in After Effects.

---

## 4. Scripting: every access returns a new object (`layer.containingComp === comp` is false)

Posted as [#811](https://github.com/storytold/effectcraft/issues/811).

**What happens.** Every access builds a new wrapper object, so comparing objects never works:
`layer.containingComp === comp`, `comp.layer(1) === comp.layer(1)`, `child.parent === layer` and
`app.project.item(1) === app.project.item(1)` are all `false`. Scripts written for After Effects
compare objects this way all the time (finding a layer's children, checking that a layer is in a
comp). `Layer.containingComp` also builds `new CompItem(this.__comp)` directly
([prelude.js#L1011](https://github.com/storytold/effectcraft/blob/f953cd2855bf36beffa6a4d608e9bf4b226e9442/crates/script/src/prelude.js#L1011))
instead of going through `__item`, as other item getters do.

**What After Effects does.** The same project item or layer is the same object, so all four are
`true`.

**Repro.**

```js
var comp = app.project.items.addComp("Identity", 1920, 1080, 1, 10, 25);
var a = comp.layers.addNull();
var b = comp.layers.addNull();
b.parent = a;
writeLn("a.containingComp === comp: " + (a.containingComp === comp));
writeLn("comp.layer(1) === comp.layer(1): " + (comp.layer(1) === comp.layer(1)));
writeLn("b.parent === a: " + (b.parent === a));
writeLn("app.project.item(1) === app.project.item(1): " + (app.project.item(1) === app.project.item(1)));
```

**Expected (After Effects).** All four `true`.

**Actual (EffectCraft 0.8.0).** All four `false`.

**How LazyMapLayers works around it** (`host/compat.jsx`, "one object per item and layer"): one cache
of item and layer objects keyed by id (layers by comp and id), used by the `__item` and `__layer`
factories, a `containingComp` getter that goes through `__item`, and wrappers around every method of
`ItemCollection`, `LayerCollection`, `Project`, `CompItem`, `Layer` and `AVLayer` that return items or
layers.

---

## 5. Scripting: `app.executeCommand(16)` is not Undo (EffectCraft's own command numbers)

Posted as [#812](https://github.com/storytold/effectcraft/issues/812).

**What happens.** `app.executeCommand(number)` treats the number as a position in EffectCraft's own
command list ([prelude.js#L1802](https://github.com/storytold/effectcraft/blob/f953cd2855bf36beffa6a4d608e9bf4b226e9442/crates/script/src/prelude.js#L1802)),
so After Effects' menu command ids run something else. `16` (Edit ▸ Undo in After Effects) is
`roto.model.remove` in EffectCraft 0.8.0. `app.findMenuCommandId("Undo")` returns 22, so scripts that
look ids up by name work; scripts with a hard-coded After Effects id (common, because
`findMenuCommandId` depends on the UI language in After Effects) do not, and the numbers will shift
whenever a command is added.

**What After Effects does.** `16` is Undo; ids are stable across versions and languages.

**Repro.**

```js
var comp = app.project.items.addComp("Exec", 1920, 1080, 1, 10, 25);
var prop = comp.layers.addNull().transform.rotation;
prop.setValueAtTime(1, 45);
try { app.executeCommand(16); } catch (e) { writeLn("executeCommand(16) threw: " + e.message); }
writeLn("keys after executeCommand(16): " + prop.numKeys);
writeLn("findMenuCommandId('Undo') = " + app.findMenuCommandId("Undo"));
```

**Expected (After Effects).**

```
keys after executeCommand(16): 0
findMenuCommandId('Undo') = 16
```

**Actual (EffectCraft 0.8.0).**

```
executeCommand(16) threw: invalid parameters for `roto.model.remove`: missing `id`
keys after executeCommand(16): 1
findMenuCommandId('Undo') = 22
```

**Suggestion.** A table from After Effects' menu ids to EffectCraft command names for the common
commands (`executeCommand` could take an id from that table first), so numbered calls keep working
and stay stable.

**How LazyMapLayers works around it** (`host/compat.jsx`): `app.executeCommand(16)` is sent as
`edit.undo`; other numbers go through unchanged.

---

## 6. Scripting: replacing a layer's source, image sequences and proxies

Posted as [#813](https://github.com/storytold/effectcraft/issues/813).

**What happens.**

- `AVLayer.replaceSource` throws `replaceSource is not supported yet`
  ([prelude.js#L1181](https://github.com/storytold/effectcraft/blob/f953cd2855bf36beffa6a4d608e9bf4b226e9442/crates/script/src/prelude.js#L1181)),
  and no engine command changes a layer's source (Alt-drag replace in After Effects).
- `FootageItem.replaceWithSequence`, `setProxy`, `setProxyWithSequence` and `setProxyToNone` do not
  exist, although EffectCraft has the commands (`file.replaceFootage`, `file.setProxy`,
  `file.useProxy`, `file.setProxyNone`).
- `FootageItem.proxySource` and `useProxy` are fixed stubs (`null` and `false`, no setter;
  [prelude.js#L1377](https://github.com/storytold/effectcraft/blob/f953cd2855bf36beffa6a4d608e9bf4b226e9442/crates/script/src/prelude.js#L1377)).
- `footage.mainSource` is a new object on every read and has no `conformFrameRate`, so
  `footage.mainSource.conformFrameRate = 12` does nothing (EffectCraft has `file.interpretFootage`).

**What After Effects does.** All of these exist and work; `mainSource.conformFrameRate` reads and sets
the frame rate the footage is interpreted at.

**Repro.** Put two PNGs `frame_0001.png`, `frame_0002.png` in a folder with a saved project and run
`effectcraft-cli script repro.jsx folder/project.ecproj` (change `dir`):

```js
var dir = "C:/path/to/folder";
function t(label, f) { var r; try { r = "ok: " + f(); } catch (e) { r = "threw: " + e.message; } writeLn(label + "  ->  " + r); }
var comp = app.project.items.addComp("Repro", 1920, 1080, 1, 10, 25);
var solid = comp.layers.addSolid([1, 0, 0], "S", 200, 100, 1);
var other = app.project.items.addComp("Other", 400, 300, 1, 10, 25);
t("solid.replaceSource(other, false)", function () { solid.replaceSource(other, false); return solid.source.name; });
t("typeof replaceWithSequence", function () { return typeof FootageItem.prototype.replaceWithSequence; });
t("typeof setProxyWithSequence", function () { return typeof FootageItem.prototype.setProxyWithSequence; });
t("typeof setProxyToNone", function () { return typeof FootageItem.prototype.setProxyToNone; });
var io = new ImportOptions(new File(dir + "/frame_0001.png"));
io.sequence = true;
var item = app.project.importFile(io);
t("mainSource === mainSource", function () { return item.mainSource === item.mainSource; });
t("mainSource.conformFrameRate = 12, then read", function () { item.mainSource.conformFrameRate = 12; return item.mainSource.conformFrameRate; });
```

**Expected (After Effects).**

```
solid.replaceSource(other, false)  ->  ok: Other
typeof replaceWithSequence  ->  ok: function
typeof setProxyWithSequence  ->  ok: function
typeof setProxyToNone  ->  ok: function
mainSource === mainSource  ->  ok: true
mainSource.conformFrameRate = 12, then read  ->  ok: 12
```

**Actual (EffectCraft 0.8.0).**

```
solid.replaceSource(other, false)  ->  threw: replaceSource is not supported yet
typeof replaceWithSequence  ->  ok: undefined
typeof setProxyWithSequence  ->  ok: undefined
typeof setProxyToNone  ->  ok: undefined
mainSource === mainSource  ->  ok: false
mainSource.conformFrameRate = 12, then read  ->  ok: undefined
```

**How LazyMapLayers works around it** (`host/compat.jsx`): the footage methods call
`file.replaceFootage`, `file.setProxy` / `file.useProxy` / `file.setProxyNone`; `proxySource` and
`useProxy` are kept in a line of the item's comment; setting `conformFrameRate` calls
`file.interpretFootage`. `replaceSource` adds a new layer with the new source in the old one's place
and copies its timing, transform, effects (values, keys, easing, expressions), switches, name,
comment, parent and children; masks, layer styles and track mattes are not carried over. That is the
part that really needs EffectCraft: an engine command that changes a layer's source.

Also seen in the earlier session, not re-run here: when a footage item is replaced by a render of
another size or length, its layers keep their old anchor point and out point (After Effects keeps
the layer centred on its source and as long as it).

---

## 7. Keyframes: `removeKey` gets slower with every key on the property (removing 1,000 keys takes 18 s)

Posted as [#814](https://github.com/storytold/effectcraft/issues/814).

**What happens.** `Property.removeKey` costs time in proportion to the number of keys on the
property, so removing all keys one by one is quadratic: 3 ms per call with 100 keys, 40 ms with 1,000,
82 ms with 2,000, and removing 1,000 keys takes 18 seconds. LazyMapLayers puts a key on every frame
of a camera move (a 40 s shot at 25 fps is 1,000 keys), and re-applying a shot first removes the old
keys.

`keys.delete` can remove many keys in one command, but only through an undocumented `__keys`
parameter (its entry in `effectcraft-cli commands` lists no parameters).

Adding keys is fast headless (0.18 ms a key), but in the app over the control channel each key was
about 2.8 ms in the earlier session (not re-measured here), and there is no command that adds many
keys at once.

**What After Effects does.** Removing a key does not depend on how many other keys the property has
in any noticeable way.

**Repro.**

```js
var comp = app.project.items.addComp("Keys", 1920, 1080, 1, 100, 25);
var sizes = [100, 1000, 2000];
for (var s = 0; s < sizes.length; s++) {
  var prop = comp.layers.addNull().transform.rotation;
  var times = [], values = [];
  for (var i = 0; i < sizes[s]; i++) { times.push(i / 25); values.push(i); }
  prop.setValuesAtTimes(times, values);
  var t = Date.now();
  for (var k = 0; k < 50; k++) prop.removeKey(prop.numKeys);
  writeLn(sizes[s] + " keys: " + ((Date.now() - t) / 50).toFixed(1) + " ms per removeKey");
}
```

**Expected.** About the same time per call for each size.

**Actual (EffectCraft 0.8.0, headless, Windows x64).**

```
100 keys: 3.0 ms per removeKey
1000 keys: 40.5 ms per removeKey
2000 keys: 81.5 ms per removeKey
```

**How LazyMapLayers works around it** (`host/compat.jsx`, `Property.__lmlecRemoveKeys`, used from
`host/compat-post.jsx`): removes a whole range in one `keys.delete` call with
`{ comp, __keys: [{ layer, prop, index }, ...] }`. It would be good to have that parameter documented
(or a public `Property.removeKeys(first, last)`), and a batch command for adding keys.

**A difference to mention, not necessarily a bug:** EffectCraft puts every key on a frame. At 25 fps
a key asked for at 3.5 s lands at 3.48 s and one at 3.51 s at 3.52 s; After Effects keeps keys
between frames when a script asks for them. LazyMapLayers allows for it.

---

## 8. Scripting: After Effects matchNames for stroke Dashes and text Path Options

Posted as [#815](https://github.com/storytold/effectcraft/issues/815).

**What happens.**

- A stroke's Dashes group always holds three properties with the matchNames `dash`, `gap` and
  `offset`. `dashes.property("ADBE Vector Stroke Dash 1")` is `null`, and
  `dashes.addProperty("ADBE Vector Stroke Dash 1")` throws `Can not add a property to "Dashes"`.
- A text layer's Path Options children are `path`, `reversePath`, `perpendicular`,
  `forceAlignment`, `firstMargin`, `lastMargin`, so `property("ADBE Text Path")` and
  `property("ADBE Text Perpendicular To Path")` are `null`.

**What After Effects does.** The Dashes group starts empty; `addProperty("ADBE Vector Stroke Dash 1")`
(then `"ADBE Vector Stroke Gap 1"`, `"ADBE Vector Stroke Offset"`) adds them. Path Options are
`ADBE Text Path`, `ADBE Text Reverse Path`, `ADBE Text Perpendicular To Path`,
`ADBE Text Force Align Path`, `ADBE Text First Margin`, `ADBE Text Last Margin`.

**Repro.**

```js
function t(label, f) { var r; try { r = "ok: " + f(); } catch (e) { r = "threw: " + e.message; } writeLn(label + "  ->  " + r); }
function names(g) { var a = []; for (var i = 1; i <= g.numProperties; i++) a.push(g.property(i).matchName); return a.join(", "); }
var comp = app.project.items.addComp("Names", 1920, 1080, 1, 10, 25);
var contents = comp.layers.addShape().property("ADBE Root Vectors Group");
contents.addProperty("ADBE Vector Shape - Rect");
var dashes = contents.addProperty("ADBE Vector Graphic - Stroke").property("ADBE Vector Stroke Dashes");
t("Dashes children", function () { return names(dashes); });
t('addProperty("ADBE Vector Stroke Dash 1")', function () { return dashes.addProperty("ADBE Vector Stroke Dash 1").matchName; });
var pathOptions = comp.layers.addText("Along a path").property("ADBE Text Properties").property("ADBE Text Path Options");
t("Path Options children", function () { return names(pathOptions); });
t('property("ADBE Text Path")', function () { var p = pathOptions.property("ADBE Text Path"); return p && p.matchName; });
```

**Expected (After Effects).**

```
Dashes children  ->  ok:
addProperty("ADBE Vector Stroke Dash 1")  ->  ok: ADBE Vector Stroke Dash 1
Path Options children  ->  ok: ADBE Text Path, ADBE Text Reverse Path, ADBE Text Perpendicular To Path, ADBE Text Force Align Path, ADBE Text First Margin, ADBE Text Last Margin
property("ADBE Text Path")  ->  ok: ADBE Text Path
```

**Actual (EffectCraft 0.8.0).**

```
Dashes children  ->  ok: dash, gap, offset
addProperty("ADBE Vector Stroke Dash 1")  ->  threw: Can not add a property to "Dashes"
Path Options children  ->  ok: path, reversePath, perpendicular, forceAlignment, firstMargin, lastMargin
property("ADBE Text Path")  ->  ok: null
```

**How LazyMapLayers works around it** (`host/compat.jsx`): `PropertyGroup.property` and
`addProperty` map the After Effects names to EffectCraft's in those two groups (adding a dash returns
the existing `dash`). Using the After Effects matchNames in EffectCraft itself would also keep `.aep`
and preset imports and expressions such as `content("Stroke 1").dash` consistent.

---

## 9. Scripting: smaller gaps

Posted as [#816](https://github.com/storytold/effectcraft/issues/816).

Each of these is small; together they are what most After Effects scripts trip over first.

| API | EffectCraft 0.8.0 | After Effects |
|---|---|---|
| `CompItem.saveFrameToPng(time, file)` | `undefined` | writes the frame (EffectCraft has `comp.saveFrameAs`) |
| `layer.anchorPoint`, `position`, `scale`, `rotation`, `opacity` | `undefined` | the transform properties (`layer.transform.position` works) |
| `app.fonts` | `undefined` | font list, `getFontsByPostScriptName` |
| `TextDocument.font = "Georgia-Italic"`, then read back | `font` and `fontFamily` `"Georgia-Italic"`, `fontStyle` `"Regular"` | `font` `"Georgia-Italic"`, `fontFamily` `"Georgia"`, `fontStyle` `"Italic"` |
| `Folder.temp` | `null` ([prelude.js#L254](https://github.com/storytold/effectcraft/blob/f953cd2855bf36beffa6a4d608e9bf4b226e9442/crates/script/src/prelude.js#L254)) | the temp folder |
| `Folder.userData` | `undefined` | the user's application data folder |
| `$.getenv(name)` | `undefined` | the environment variable |
| `File.prototype.rename(name)` | throws `File.rename is not supported` | renames the file |
| `e.line`, `e.lineNumber` of a caught error | `undefined` (the `stack` is there and correct) | `e.line` is the failing line |

The text itself renders in the right face with a PostScript name (Georgia Italic for
`"Georgia-Italic"`, thanks to #84); only what the scripting API reports is different.

**Repro.**

```js
function t(label, f) { var r; try { r = "ok: " + f(); } catch (e) { r = "threw: " + e.message; } writeLn(label + "  ->  " + r); }
var comp = app.project.items.addComp("Gaps", 1920, 1080, 1, 10, 25);
var solid = comp.layers.addSolid([1, 0, 0], "S", 200, 100, 1);
t("typeof comp.saveFrameToPng", function () { return typeof comp.saveFrameToPng; });
t("solid.position", function () { return solid.position; });
t("app.fonts", function () { return app.fonts; });
var prop = comp.layers.addText("Georgia").property("ADBE Text Properties").property("ADBE Text Document");
var doc = prop.value; doc.font = "Georgia-Italic"; prop.setValue(doc);
t("font / fontFamily / fontStyle", function () { var d = prop.value; return [d.font, d.fontFamily, d.fontStyle].join(" / "); });
t("Folder.temp", function () { return Folder.temp; });
t("Folder.userData", function () { return Folder.userData; });
t("typeof $.getenv", function () { return typeof $.getenv; });
t("File.rename", function () { return new File("x.txt").rename("y.txt"); });
try { null.boom = 1; } catch (e) { writeLn("e.line: " + e.line + ", e.lineNumber: " + e.lineNumber); }
```

**Actual (EffectCraft 0.8.0).**

```
typeof comp.saveFrameToPng  ->  ok: undefined
solid.position  ->  ok: undefined
app.fonts  ->  ok: undefined
font / fontFamily / fontStyle  ->  ok: Georgia-Italic / Georgia-Italic / Regular
Folder.temp  ->  ok: null
Folder.userData  ->  ok: undefined
typeof $.getenv  ->  ok: undefined
File.rename  ->  threw: File.rename is not supported
e.line: undefined, e.lineNumber: undefined
```

**How LazyMapLayers works around it** (`host/compat.jsx`, `host/compat-post.jsx`):
`saveFrameToPng` opens the comp and calls `comp.saveFrameAs`; the transform shortcuts read
`layer.transform`; `app.fonts.getFontsByPostScriptName` and the `TextDocument.font` setter match a
PostScript name to an installed family and style from the `text.fonts` command; errors get `e.line`
from the first frame of `e.stack`. The companion program passes paths in, so the host does not need
`Folder.temp`, `Folder.userData`, `$.getenv` or `File.rename`.

---

## 10. Scripting: `File` with `encoding = "BINARY"` turns byte 0x89 into U+FFFD

Posted as [#817](https://github.com/storytold/effectcraft/issues/817).

**What happens.** File I/O is text only. Reading a PNG with `encoding = "BINARY"` decodes it as
UTF-8: its first byte 0x89 comes back as U+FFFD. In the earlier session (in the app, with *Allow
Scripts to Write Files and Access Network* on), `File.copy` and writing with `"BINARY"` turned 0x89
into the bytes EF BF BD, so a copied PNG was corrupt.

**What After Effects does.** With `"BINARY"` each character is one byte (0 to 255) both ways, and
`File.copy` copies the bytes.

**Repro.** Put a PNG `sig.bin` next to a saved project and run
`effectcraft-cli script repro.jsx folder/project.ecproj` (change `dir`):

```js
var dir = "C:/path/to/folder";
var f = new File(dir + "/sig.bin");
f.encoding = "BINARY";
f.open("r");
var s = f.read();
f.close();
var codes = [];
for (var i = 0; i < s.length; i++) codes.push(s.charCodeAt(i).toString(16));
writeLn(codes.join(" "));
```

**Expected (After Effects).** `89 50 4e 47 d a 1a a`

**Actual (EffectCraft 0.8.0).** `fffd 50 4e 47 d a 1a a`

**How LazyMapLayers works around it.** Its companion program (Node) copies and writes binary files;
the host script only reads and writes text.

---

## Checked and not filed

These came up in the earlier session but did not reproduce on 0.8.0 headless, so they are left out
until they can be shown:

- **Nested undo groups.** An inner `endUndoGroup` was thought to close the outer group. Headless, a
  group with one or three nested groups inside is one undo step. (LazyMapLayers still sends only the
  outermost group, which is harmless.)
- **`fromComp()` in expressions.** It works on Rotation, on a shape path with `createPath`, and on a
  layer from a Layer Control. It only keeps the property's value inside the layer's own Position
  expression, which depends on itself.
- **Stack frames pointing at the start of a function.** Frames now give the failing statement's line
  and column (`at inner (repro.jsx:8:3)`); only `e.line` is missing (issue 9).
- **Fonts falling back to Inter with a PostScript name.** Text renders in Georgia Italic with
  `"Georgia-Italic"` (#84); see issue 9 for what the API reports.
- **Keyframe values stored as 32-bit floats.** Static values, keys on Rotation, Slider and Point
  Controls, values read in expressions and values after saving and reopening all keep
  `23.123456789`. It may happen only in the app or in a path not tried here.
- **A detailed shape layer adding about 0.75 s to a frame.** A shape layer with one 20,000-point
  path renders in 18 ms (`effectcraft-cli bench`); LazyMapLayers' country outlines have many paths and
  expressions, so this needs a better repro.

**One expression engine.** EffectCraft runs every expression in its JavaScript engine; there is no
Legacy ExtendScript engine to choose. Not a bug: LazyMapLayers' expressions run in both, so this made
no difference.
