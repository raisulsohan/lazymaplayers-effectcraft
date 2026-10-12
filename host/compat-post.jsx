/*
 * LazyMapLayers for EffectCraft: loaded after the LazyMapLayers host script. Every expression the
 * host writes goes through LML.pins.setExpression; here it is rewritten for EffectCraft first
 * (LMLEC.rewriteExpression in compat.jsx). Property.expression itself cannot be wrapped: EffectCraft
 * defines it as a fixed property.
 */
(function () {
    if (!LMLEC.active || typeof LML === "undefined" || LML.effectcraft) return;
    var setExpression = LML.pins.setExpression;
    LML.pins.setExpression = function (prop, code, errors, label, check) {
        return setExpression(prop, code ? LMLEC.rewriteExpression(code) : code, errors, label, check);
    };
    LMLEC.fixes.push("generated expressions rewritten");

    // app.version stays "26.0 (EffectCraft 0.8.0)": the Self-test reads the After Effects version EffectCraft
    // stands for from its start, and the panel's host line picks out the name (tools/build.mjs).
    var ping = LML.api.ping;
    LML.api.ping = function () {
        var info = ping();
        info.effectcraft = { compat: LMLEC.fixes };
        return info;
    };

    /*
     * The Self-test samples the rendered frame with sampleImage(); in EffectCraft 0.8.0 that gives
     * [0, 0, 0, 0] on a footage layer (and a precomp holding one), which an opaque frame never is. Then
     * no sample is reported, and the Self-test says the pixels were not compared instead of failing.
     */
    if (LML.selfTest && LML.selfTest.run) {
        var selfTestRun = LML.selfTest.run;
        LML.selfTest.run = function (args) {
            var out = selfTestRun(args);
            var s = out && out.sample;
            if (s && s.length >= 4 && s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) out.sample = null;
            return out;
        };
        LMLEC.fixes.push("Self-test: no pixel comparison where sampleImage reads footage as empty");
    }

    /*
     * When a render of another size replaces a pass's footage (a half-size preview, then the final),
     * After Effects keeps the layer centred on its source; EffectCraft 0.8.0 keeps the old anchor point,
     * which shifts the picture. The host scales and centres the layer for an anchor at the source's
     * middle, so that is where it goes.
     */
    var importPass = LML.basemap.importPass;
    LML.basemap.importPass = function (mapComp, mapId, sequence, quality, stamp) {
        var result = importPass(mapComp, mapId, sequence, quality, stamp);
        var layer = mapComp.layer(result.layerIndex);
        var footage = layer.source;
        var anchor = layer.property("ADBE Transform Group").property("ADBE Anchor Point");
        var middle = [footage.width / 2, footage.height / 2];
        var now = anchor.value;
        if (Math.abs(now[0] - middle[0]) > 0.01 || Math.abs(now[1] - middle[1]) > 0.01) {
            LML.basemap.withUnlocked(layer, function () {
                anchor.setValue(now.length > 2 ? [middle[0], middle[1], now[2]] : middle);
            });
        }
        // A longer render (or one whose frame rate was only now conformed) runs the layer to its end.
        var end = Math.min(mapComp.duration, layer.startTime + footage.duration);
        if (layer.outPoint < end - 0.5 / mapComp.frameRate) {
            LML.basemap.withUnlocked(layer, function () {
                layer.outPoint = end;
            });
        }
        return result;
    };
    LMLEC.fixes.push("pass layers centred on their footage and as long as it");

    /*
     * Keys are removed a whole range at a time (Property.__lmlecRemoveKeys in compat.jsx): one by one
     * they take about 38 ms each in EffectCraft. The host's own loops then find nothing left to remove.
     */
    LML.shots.clearKeys = function (layer, control, from, to, eps) {
        var prop = LML.map.controlValueProperty(layer, control.name);
        if (!prop) return { removed: 0, how: "missing" };
        var range = LML.shots.keyRange(prop, from, to, eps);
        if (!range) return { removed: 0, how: "none" };
        return { removed: prop.__lmlecRemoveKeys(range.first, range.last), how: "removed" };
    };
    var copyControl = LML.follow.copyControl;
    LML.follow.copyControl = function (from, to, comp) {
        to.__lmlecRemoveKeys(1, to.numKeys);
        return copyControl(from, to, comp);
    };
    var setControlKeys = LML.api.setControlKeys;
    LML.api.setControlKeys = function (args) {
        // One undo step, as in After Effects: the host's own undo group sits inside this one.
        app.beginUndoGroup("LazyMapLayers: Animate " + args.name);
        try {
            var prop = LML.map.controlValueProperty(LML.pins.findMapLayer(args.mapId), args.name);
            if (prop) prop.__lmlecRemoveKeys(1, prop.numKeys);
            return setControlKeys(args);
        } finally {
            app.endUndoGroup();
        }
    };
    LMLEC.fixes.push("keys removed a range at a time");

    /*
     * replaceSource in compat.jsx puts a new layer in the old one's place; property objects taken from
     * the layer before it are the old layer's. fillImages reads the placeholder's Scale before and sets
     * it after, so here it takes the property again after the swap (otherwise the same as the host's).
     */
    LML.labels.fillImages = function (comp, images) {
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            var field = LML.labels.imageFieldOf(layer);
            if (!field) continue;
            var path = images && images.hasOwnProperty(field) ? images[field] : null;
            var footage = path ? LML.labels.imageFootage(path) : null;
            if (!footage || !layer.source) {
                layer.enabled = false;
                continue;
            }
            var old = layer.property("ADBE Transform Group").property("ADBE Scale").value;
            var boxW = layer.source.width * Math.abs(old[0]) / 100;
            var boxH = layer.source.height * Math.abs(old[1]) / 100;
            var fieldName = layer.name;
            layer.replaceSource(footage, false);
            layer.name = fieldName;
            var scale = layer.property("ADBE Transform Group").property("ADBE Scale");
            var fit = Math.min(boxW / footage.width, boxH / footage.height) * 100;
            var next = [fit * (old[0] < 0 ? -1 : 1), fit * (old[1] < 0 ? -1 : 1)];
            if (old.length > 2) next.push(old[2]);
            if (scale.numKeys === 0) scale.setValue(next);
            layer.enabled = true;
        }
    };
    LMLEC.fixes.push("label pictures fitted after their layer is replaced");

    /*
     * EffectCraft's errors have no line attribute, only a stack; LML.call reports e.line, so each API
     * function gives its errors the line where they happened (a line of
     * dist/host/lazymaplayers-effectcraft.jsx).
     */
    var names = [];
    for (var key in LML.api) if (LML.api.hasOwnProperty(key) && typeof LML.api[key] === "function") names.push(key);
    for (var n = 0; n < names.length; n++) {
        (function (name, fn) {
            LML.api[name] = function () {
                try {
                    return fn.apply(this, arguments);
                } catch (e) {
                    if (e && typeof e === "object" && !e.line && !e.lmlCode && e.stack) {
                        var where = /:(\d+):\d+\)?\s*$/m.exec(String(e.stack).split("\n")[0]);
                        if (where) e.line = Number(where[1]);
                    }
                    throw e;
                }
            };
        })(names[n], LML.api[names[n]]);
    }
    LML.effectcraft = { compat: LMLEC.fixes };
})();
