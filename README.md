# LazyMapLayers for EffectCraft

LazyMapLayers (the map design and map animation panel for After Effects) running in
[EffectCraft](https://github.com/storytold/effectcraft), the open-source After Effects-style
compositor written in Rust.

This folder holds only what EffectCraft needs on top of LazyMapLayers. The After Effects version in
`../LazyMapLayers` stays as it is: this version is built from it.

## How it works

EffectCraft has no HTML extension panels (CEP), but it runs After Effects-style scripts and has a
control channel for other programs. So LazyMapLayers runs in two parts, as it does in After Effects:

```
 panel window (Edge or Chrome)          local companion (Node)              EffectCraft
 LazyMapLayers' own panel: preview,  -> app/server.mjs: files, downloads, -> its script engine runs
 maps, renders, everything          <- the host calls                    <- LazyMapLayers' host script
                                                                            (with host/compat.jsx)
```

- **Host.** LazyMapLayers' unchanged host script runs in EffectCraft's script engine, wrapped in a
  compatibility layer (`host/compat.jsx` before it, `host/compat-post.jsx` after it) that fills the
  gaps in EffectCraft 0.8.0's After Effects scripting and expression API.
- **Panel.** LazyMapLayers' own panel, built from its sources with two modules swapped: the CEP
  bridge (`panel/cep.ts`) and the PMTiles file reader (`panel/nodeFileSource.ts`). It opens in an app
  window of Microsoft Edge (InPrivate, so no sign-in or sync) or Google Chrome.
- **Companion.** `app/server.mjs` serves the panel on `127.0.0.1`, answers its file calls, streams
  its downloads, and sends each host call to EffectCraft over EffectCraft's control channel
  (`effectcraft --control 9877`). It starts EffectCraft with the control channel when it is not
  running, and stops when the panel window closes.

## What you need

- **EffectCraft 0.8.0** or newer, installed (or `EFFECTCRAFT_APP` set to `effectcraft.exe`).
- **Node.js 22** or newer.
- **Microsoft Edge** or **Google Chrome** (for the panel window).
- **LazyMapLayers** next to this folder (`../LazyMapLayers`), built once (`node tools/build.mjs` in
  it): its `dist/` holds the host script and the bundled data, and its `node_modules` the build tools.

## Start

1. Close EffectCraft if it is open (it has to start with its control channel).
2. Double-click **`Start LazyMapLayers.cmd`** (macOS and Linux: `./start-lazymaplayers.sh`).
   EffectCraft opens, then the LazyMapLayers panel window. Closing the panel window stops the
   companion; EffectCraft stays open.
3. **Once:** in EffectCraft, **Edit ▸ Preferences ▸ Scripting & Expressions**, turn on **Allow Scripts
   to Write Files and Access Network**. EffectCraft's scripts can otherwise read only the project's
   own folder, and the rendered maps live in LazyMapLayers' data folder. Without it the panel says
   so when a render is imported.

The first start builds `dist/` if it is missing. After LazyMapLayers itself changes, build again:

```
node tools/build.mjs
```

## Data

- This version keeps its renders, render queue, drafts and settings in
  `%APPDATA%\LazyMapLayers for EffectCraft` (macOS: `~/Library/Application Support/LazyMapLayers for EffectCraft`).
- The downloads are **shared** with the After Effects version: `offline`, `regions`, `terrain`,
  `history`, `imagery`, `boundaries`, `osm`, `satellite` and `districts` under this version's data
  folder are read from and written to the After Effects version's data folder
  (`%APPDATA%\LazyMapLayers`). A region or offline pack downloaded in either version is there in both.
  `LMLEC_AE_DATA` points the companion at another folder for them.

## What works

LazyMapLayers' own in-app test suites, run in EffectCraft 0.8.0 through this version
(`tools/run-suites.mjs`), and every kind of generated expression compared with After Effects' maths
on real EffectCraft layers (`tools/check-expressions.ts`: 369 of 369).

| Suite | What | In EffectCraft |
|---|---|---|
| H1 | Host API through the bridge, one undo step per action | 9 / 9 |
| P1, C1 | Pins and the matched 3D camera against the camera maths | pass |
| E1 | End to end | pass |
| R1 | Renderer, passes, cache, preview proxy over the final render | pass but one check (see below) |
| LN1, RD1 | A scene made longer; renders on disk | pass |
| G1, G2 | Globe, globe pins | pass |
| AT1, MF1 | Your own layers attached to a place; scale bar, north arrow, graticule | pass |
| RT1, DR1 | Routes, travellers, dashed lines; drawn paths as routes | pass |
| SL1, HL1 | Outlines as shape layers; highlights as their own pass | pass (SL1: slow, see below) |
| LB2 – LB6 | Label template, keep-out zones, nature names, names inside Paris along their streets, oceans on a globe | pass |
| LD1, LD2 | Label designs of your own, with each place's picture | pass |
| FO1, FB1, LK1 | A map that follows another; the feature browser; your own looks | pass |
| DT1, DT2, DT3, HT1 | Numbers on the map, categories and years, prisms, heat | pass |
| OW1, WB1, SAT1 | The offline world, cities and roads at zooms 7 – 9, satellite imagery | pass |
| SH1 | The shot list: 601 frames match the camera maths | pass but speed (see below) |
| DU1 | A copied scene gets its own map | pass but undo (see below) |
| S1, S4 | Renderer speed: 83 ms a frame at 1080p, 268 ms at 4K | measured |

## Known limitations (EffectCraft 0.8.0)

Things the compatibility layer cannot change; they need EffectCraft itself.

- **Undo of large actions.** An undo group with more commands than EffectCraft's *Levels of Undo*
  (32 by default, 99 at most) does not become one undo step: only its last steps undo, one by one.
  Small actions (a map, a pin, a view key) are one undo step as in After Effects; labels, flights and
  shot lists are not. Raising **Settings ▸ General ▸ Levels of Undo** to 99 helps up to 98 commands.
- **Keyframe speed.** Each keyframe is one engine command (about 3 ms): applying a long shot list
  takes seconds, not milliseconds. Removing keys is fast (a whole range in one command).
- **Keys on whole frames.** EffectCraft puts every keyframe on a frame; After Effects allows keys
  between frames. A key asked for at 3.5 s in a 25 fps comp lands on a frame.
- **Single precision.** Keyframe values are stored as 32-bit floats (about 5 cm on the ground for a
  latitude); the generated expressions already allow for it.
- **One expression engine.** EffectCraft runs every expression in its JavaScript engine; there is no
  Legacy ExtendScript engine to choose.
- **Shape layers render slowly.** A detailed country outline as a shape layer adds most of a second
  to an EffectCraft frame.
- **Fonts.** Fonts After Effects carries itself (Myriad Pro and others) are not on the system;
  labels and callouts use the next font in their list that is installed.
- **Replacing a layer's source** (used when a copied scene gets its own map, and for pictures in a
  label design) is done by putting a new layer in the old one's place. Its transform, timing, effects
  (values, keys, easing, expressions), switches, name, comment, parent and children come along; its
  masks, layer styles and track matte do not.
- **Your own imagery test.** LazyMapLayers' OI1 test starts a tile server inside the panel, which a
  browser window cannot; the feature itself (imagery from a server on this computer) uses the
  companion's downloads.

## The compatibility layer

`host/compat.jsx` (before the host script) and `host/compat-post.jsx` (after it). Every fix is
listed in the panel's `ping` (`effectcraft.compat`) and works only in EffectCraft; nothing changes in
After Effects. They use EffectCraft's own engine commands, never its files.

| EffectCraft 0.8.0 | Here |
|---|---|
| `Layer.comment` cannot be written (every LazyMapLayers tag lives there) | written with `layer.setComment` |
| Expressions: `layer.source.width/height`, `layer.transform.scale` and `fromComp()` fail silently (the property keeps its own value) | the expressions LazyMapLayers writes use `layer.width/height`, `layer.scale` and the inverse of `toComp()` |
| A new object on every access (`a.containingComp === b.containingComp` is false) | one object per item and layer |
| Nested undo groups: an inner end closes the group | only the outermost group reaches EffectCraft |
| `app.executeCommand(16)` is not Undo (EffectCraft's own numbering) | After Effects' Undo id is translated |
| `sourcePointToComp`, `compPointToSource` return the point unchanged | the layer's 2D transform and its parents' |
| Marker parameters are dropped without a cue point name | kept as a cue point with an empty name |
| `CompItem.saveFrameToPng` missing | Composition ▸ Save Frame As |
| Removing a key takes about 38 ms | a whole range in one command |
| Dashes and text path options have other matchNames | the After Effects names find them |
| `AVLayer.replaceSource` "not supported yet" | a new layer in the old one's place |
| `layer.anchorPoint`, `layer.position`… missing | read from `layer.transform` |
| `FootageItem.replaceWithSequence`, `setProxyWithSequence`, `setProxyToNone` missing; `proxySource`, `useProxy` fixed stubs; `mainSource.conformFrameRate` has no effect | EffectCraft's Replace Footage, Proxy and Interpret Footage commands |
| No `app.fonts`; `TextDocument.font` takes a family, not a PostScript name | PostScript names matched to installed families and styles |
| A pass layer keeps its old anchor point and out point when a render of another size or length replaces its footage | centred and as long as its footage |
| Errors carry no line number | the line, from the stack |

## Security

- The companion listens on `127.0.0.1` only, accepts only its own `Host`, and every call needs the
  random token written into the page it served: other web pages cannot use it.
- EffectCraft's control channel has no authentication (EffectCraft's own documentation says to turn
  it on only while it is used). It is on while EffectCraft runs from `Start LazyMapLayers`.
- **Allow Scripts to Write Files and Access Network** lets every script you run in EffectCraft do so,
  not only LazyMapLayers.

## For developers

```
node tools/build.mjs [--test]             # dist/; --test turns LazyMapLayers' test automation on
node app/server.mjs [--port 5190] [--control 9877] [--no-launch] [--no-window]
node tools/check-expressions.ts [--per-kind 6] [--raw]   # every generated expression in EffectCraft
node tools/run-suites.mjs 9333 --fresh H1 P1 SH1          # LazyMapLayers' in-app suites (test build,
                                                          # window started with LMLEC_DEBUG_PORT=9333)
node tools/inspect.mjs [--frame "Map Scene" 2 out.png]    # what is in the open project; a rendered frame
node tools/call.mjs listMaps '{}'                          # one host call
node tools/replay.mjs saved-call.js                        # a saved panel call, with its stack
node tools/probe-expressions.ts                            # expression features one by one
```

`tools/ec.ts` finds `effectcraft-cli` (`EFFECTCRAFT_CLI`, then the usual install folders).
